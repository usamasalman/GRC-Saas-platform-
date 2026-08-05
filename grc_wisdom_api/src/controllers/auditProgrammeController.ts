import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { checkSod, SodViolation } from '../services/sodEngine';

const SUBJ_AUDIT = 'Audit';
const SUBJ_ISSUE = 'Issue';
const AUDIT_STATUSES = ['Planned', 'Fieldwork', 'Reporting', 'Closed'];
const RATINGS = ['High', 'Medium', 'Low'];

async function nextAuditRef(tenantId: string): Promise<string> {
  const count = await prisma.audit.count({ where: { tenantId } });
  return `AUD-${new Date().getFullYear()}-${String(count + 1).padStart(2, '0')}`;
}

// ─── Audits ────────────────────────────────────────────────────────────────

export const listAudits = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.audits.list');

    const { status } = req.query as Record<string, string | undefined>;
    const where: any = { tenantId: { in: scope.tenantIds } };
    if (status) where.status = status;

    const audits = await prisma.audit.findMany({
      where,
      include: {
        leadAuditor: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
        issues: { select: { id: true, status: true, riskRating: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const enriched = audits.map((a) => ({
      ...a,
      findingCounts: {
        total: a.issues.length,
        open: a.issues.filter((f) => f.status !== 'Closed').length,
        closed: a.issues.filter((f) => f.status === 'Closed').length,
        high: a.issues.filter((f) => f.riskRating === 'High').length,
      },
    }));

    const allFindings = audits.flatMap((a) => a.issues);
    res.json({
      status: 'success',
      scope: scope.kind,
      count: enriched.length,
      totals: {
        audits: enriched.length,
        inFieldwork: enriched.filter((a) => a.status === 'Fieldwork').length,
        closed: enriched.filter((a) => a.status === 'Closed').length,
        findings: allFindings.length,
        openFindings: allFindings.filter((f) => f.status !== 'Closed').length,
        highFindings: allFindings.filter((f) => f.riskRating === 'High' && f.status !== 'Closed').length,
        closureRate: allFindings.length > 0
          ? Math.round((allFindings.filter((f) => f.status === 'Closed').length / allFindings.length) * 100)
          : 100,
      },
      audits: enriched,
    });
  } catch (error: any) {
    console.error('[Audit List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list audits' });
  }
};

export const getAudit = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const audit = await prisma.audit.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: {
        leadAuditor: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
        issues: {
          include: {
            raisedBy: { select: { id: true, name: true, email: true } },
            capOwner: { select: { id: true, name: true, email: true } },
            respondedBy: { select: { id: true, name: true, email: true } },
            closedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!audit) { res.status(404).json({ status: 'error', message: 'Audit not found' }); return; }
    res.json({ status: 'success', audit });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch audit' });
  }
};

export const createAudit = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { title, objective, scope: auditScope, criteria, leadAuditorId, startDate, endDate, tenantId } = req.body || {};
    if (!title || !objective || !auditScope || !criteria) {
      res.status(400).json({ status: 'error', message: 'title, objective, scope and criteria are required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const target = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(target)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }

    const ref = await nextAuditRef(target);
    const audit = await prisma.$transaction(async (tx) => {
      const created = await tx.audit.create({
        data: {
          tenantId: target,
          ref,
          title: String(title).trim(),
          objective: String(objective).trim(),
          scope: String(auditScope).trim(),
          criteria: String(criteria).trim(),
          leadAuditorId: leadAuditorId || req.user!.id,
          status: 'Planned',
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
        },
      });
      await writeAudit(tx, {
        tenantId: target, actorId: req.user!.id, action: 'AUDIT_CREATED',
        subjectType: SUBJ_AUDIT, subjectId: created.id,
        payload: { ref, title, criteria },
      });
      return created;
    });

    res.status(201).json({ status: 'success', audit });
  } catch (error: any) {
    console.error('[Audit Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create audit' });
  }
};

export const updateAudit = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const audit = await prisma.audit.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { issues: { select: { status: true } } },
    });
    if (!audit) { res.status(404).json({ status: 'error', message: 'Audit not found' }); return; }

    const { status, title, objective, scope: auditScope, criteria, leadAuditorId, startDate, endDate } = req.body || {};
    const data: any = {};
    if (title) data.title = title;
    if (objective) data.objective = objective;
    if (auditScope) data.scope = auditScope;
    if (criteria) data.criteria = criteria;
    if (leadAuditorId) data.leadAuditorId = leadAuditorId;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;

    if (status) {
      if (!AUDIT_STATUSES.includes(status)) {
        res.status(400).json({ status: 'error', message: `status must be one of: ${AUDIT_STATUSES.join(', ')}` });
        return;
      }
      // IIA Std 14.5: the engagement file must be complete and independently
      // reviewed before results are communicated.
      if (status === 'Reporting') {
        const papers = await prisma.workpaper.findMany({
          where: { auditId: id },
          select: { status: true, ref: true },
        });
        const unreviewed = papers.filter((w) => w.status !== 'Reviewed');
        if (papers.length === 0) {
          res.status(409).json({
            status: 'error',
            code: 'NO_WORKPAPERS',
            message: 'The engagement has no workpapers. Results cannot be reported without an evidence file.',
          });
          return;
        }
        if (unreviewed.length > 0) {
          res.status(409).json({
            status: 'error',
            code: 'WORKPAPERS_UNREVIEWED',
            message: `${unreviewed.length} workpaper(s) are not yet reviewed (${unreviewed.map((w) => w.ref).join(', ')}). The file must be signed off before reporting.`,
          });
          return;
        }
      }
      // An audit cannot close while any finding stays open.
      if (status === 'Closed') {
        const open = audit.issues.filter((f) => f.status !== 'Closed').length;
        if (open > 0) {
          res.status(409).json({ status: 'error', message: `${open} finding(s) are still open — close them before closing the audit` });
          return;
        }
      }
      data.status = status;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.audit.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: audit.tenantId, actorId: req.user!.id, action: 'AUDIT_UPDATED',
        subjectType: SUBJ_AUDIT, subjectId: id,
        payload: { before: { status: audit.status }, after: data },
      });
      return u;
    });

    res.json({ status: 'success', audit: updated });
  } catch (error: any) {
    console.error('[Audit Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update audit' });
  }
};

// ─── Findings ──────────────────────────────────────────────────────────────

export const raiseFinding = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { title, criterion, condition, cause, recommendation, riskRating, targetCloseDate } = req.body || {};
    if (!criterion || !condition || !cause || !recommendation) {
      res.status(400).json({ status: 'error', message: 'criterion, condition, cause and recommendation are all required (TRD §7.2)' });
      return;
    }
    if (riskRating && !RATINGS.includes(riskRating)) {
      res.status(400).json({ status: 'error', message: `riskRating must be one of: ${RATINGS.join(', ')}` });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const audit = await prisma.audit.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { _count: { select: { issues: true } } },
    });
    if (!audit) { res.status(404).json({ status: 'error', message: 'Audit not found' }); return; }
    if (audit.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Cannot raise a finding on a closed audit' });
      return;
    }

    const finding = await prisma.$transaction(async (tx) => {
      const created = await tx.issue.create({
        data: {
          auditId: id,
          tenantId: audit.tenantId,
          ref: `${audit.ref}-F${audit._count.issues + 1}`,
          source: 'InternalAudit',
          title: String(title || condition).trim().slice(0, 120),
          criterion: String(criterion).trim(),
          condition: String(condition).trim(),
          cause: String(cause).trim(),
          recommendation: String(recommendation).trim(),
          riskRating: riskRating || 'Medium',
          raisedById: req.user!.id,
          status: 'Open',
          targetCloseDate: targetCloseDate ? new Date(targetCloseDate) : null,
        },
      });
      // This audit entry is what the SoD engine matches when the same person
      // later attempts closure (rule: audit-finding-closure).
      await writeAudit(tx, {
        tenantId: audit.tenantId, actorId: req.user!.id, action: 'ISSUE_RAISED',
        subjectType: SUBJ_ISSUE, subjectId: created.id,
        payload: { ref: created.ref, riskRating: riskRating || 'Medium', criterion },
      });
      return created;
    });

    res.status(201).json({ status: 'success', finding });
  } catch (error: any) {
    console.error('[Raise Finding Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to raise finding' });
  }
};
