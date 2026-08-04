import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { checkSod, SodViolation } from '../services/sodEngine';

const SUBJ_AUDIT = 'Audit';
const SUBJ_FINDING = 'AuditFinding';
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
        findings: { select: { id: true, status: true, riskRating: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const enriched = audits.map((a) => ({
      ...a,
      findingCounts: {
        total: a.findings.length,
        open: a.findings.filter((f) => f.status !== 'Closed').length,
        closed: a.findings.filter((f) => f.status === 'Closed').length,
        high: a.findings.filter((f) => f.riskRating === 'High').length,
      },
    }));

    const allFindings = audits.flatMap((a) => a.findings);
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
        findings: {
          include: {
            raisedBy: { select: { id: true, name: true, email: true } },
            capOwner: { select: { id: true, name: true, email: true } },
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
      include: { findings: { select: { status: true } } },
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
      // An audit cannot close while any finding stays open.
      if (status === 'Closed') {
        const open = audit.findings.filter((f) => f.status !== 'Closed').length;
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
    const { criterion, condition, cause, recommendation, riskRating } = req.body || {};
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
      include: { _count: { select: { findings: true } } },
    });
    if (!audit) { res.status(404).json({ status: 'error', message: 'Audit not found' }); return; }
    if (audit.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Cannot raise a finding on a closed audit' });
      return;
    }

    const finding = await prisma.$transaction(async (tx) => {
      const created = await tx.auditFinding.create({
        data: {
          auditId: id,
          tenantId: audit.tenantId,
          ref: `${audit.ref}-F${audit._count.findings + 1}`,
          criterion: String(criterion).trim(),
          condition: String(condition).trim(),
          cause: String(cause).trim(),
          recommendation: String(recommendation).trim(),
          riskRating: riskRating || 'Medium',
          raisedById: req.user!.id,
          status: 'Open',
        },
      });
      // This audit entry is what the SoD engine matches when the same person
      // later attempts closure (rule: audit-finding-closure).
      await writeAudit(tx, {
        tenantId: audit.tenantId, actorId: req.user!.id, action: 'AUDIT_FINDING_RAISED',
        subjectType: SUBJ_FINDING, subjectId: created.id,
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

export const updateFinding = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const finding = await prisma.auditFinding.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!finding) { res.status(404).json({ status: 'error', message: 'Finding not found' }); return; }
    if (finding.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Closed findings are immutable — reopen first' });
      return;
    }

    const { capOwnerId, capDueDate, capDescription, submitForClosure } = req.body || {};
    const data: any = {};

    // A corrective action plan needs an owner and a due date (TRD §7.2).
    if (capOwnerId || capDueDate || capDescription) {
      if (!(capOwnerId || finding.capOwnerId) || !(capDueDate || finding.capDueDate)) {
        res.status(400).json({ status: 'error', message: 'A CAP requires both capOwnerId and capDueDate' });
        return;
      }
      if (capOwnerId) data.capOwnerId = capOwnerId;
      if (capDueDate) data.capDueDate = new Date(capDueDate);
      if (capDescription) data.capDescription = capDescription;
      if (finding.status === 'Open' || finding.status === 'Reopened') data.status = 'CAPAssigned';
    }

    if (submitForClosure === true) {
      if (!(data.capOwnerId || finding.capOwnerId)) {
        res.status(409).json({ status: 'error', message: 'Assign a CAP before submitting for closure' });
        return;
      }
      data.status = 'PendingClosure';
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.auditFinding.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: finding.tenantId, actorId: req.user!.id, action: 'AUDIT_FINDING_UPDATED',
        subjectType: SUBJ_FINDING, subjectId: id,
        payload: { before: { status: finding.status }, after: data },
      });
      return u;
    });

    res.json({ status: 'success', finding: updated });
  } catch (error: any) {
    console.error('[Update Finding Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update finding' });
  }
};

/**
 * Independent closure validation (TRD §7.2): the person who raised the
 * finding cannot close it. Enforced both explicitly and via the data-driven
 * SoD rule `audit-finding-closure`.
 */
export const closeFinding = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { note } = req.body || {};
    if (!note) {
      res.status(400).json({ status: 'error', message: 'A closure note is required — it is the validation evidence' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const finding = await prisma.auditFinding.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!finding) { res.status(404).json({ status: 'error', message: 'Finding not found' }); return; }
    if (finding.status !== 'PendingClosure') {
      res.status(409).json({ status: 'error', message: `Only findings pending closure can be closed (current: ${finding.status})` });
      return;
    }
    if (finding.raisedById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'Independent closure required: the auditor who raised a finding cannot close it.',
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await checkSod(tx, {
        tenantId: finding.tenantId,
        actorId: req.user!.id,
        guardedAction: 'AUDIT_FINDING_CLOSED',
        subjectType: SUBJ_FINDING,
        subjectId: id,
      });
      const u = await tx.auditFinding.update({
        where: { id },
        data: { status: 'Closed', closedById: req.user!.id, closedAt: new Date(), closureNote: String(note).trim() },
      });
      await writeAudit(tx, {
        tenantId: finding.tenantId, actorId: req.user!.id, action: 'AUDIT_FINDING_CLOSED',
        subjectType: SUBJ_FINDING, subjectId: id,
        payload: { ref: finding.ref, note },
      });
      return u;
    });

    res.json({ status: 'success', message: `${finding.ref} closed`, finding: updated });
  } catch (error: any) {
    if (error instanceof SodViolation) {
      res.status(403).json({ status: 'error', code: error.code, rule: error.ruleKey, message: error.message });
      return;
    }
    console.error('[Close Finding Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to close finding' });
  }
};

/** Reopen-if-insufficient path (TRD §7.2 explicit requirement). */
export const reopenFinding = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body || {};
    if (!reason) { res.status(400).json({ status: 'error', message: 'reason is required to reopen a finding' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const finding = await prisma.auditFinding.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!finding) { res.status(404).json({ status: 'error', message: 'Finding not found' }); return; }
    if (finding.status !== 'Closed') {
      res.status(409).json({ status: 'error', message: 'Only closed findings can be reopened' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.auditFinding.update({
        where: { id },
        data: {
          status: 'Reopened',
          reopenedCount: finding.reopenedCount + 1,
          closedById: null,
          closedAt: null,
          closureNote: null,
        },
      });
      await writeAudit(tx, {
        tenantId: finding.tenantId, actorId: req.user!.id, action: 'AUDIT_FINDING_REOPENED',
        subjectType: SUBJ_FINDING, subjectId: id,
        payload: { ref: finding.ref, reason, reopenedCount: finding.reopenedCount + 1 },
      });
      return u;
    });

    res.json({ status: 'success', message: `${finding.ref} reopened (count: ${updated.reopenedCount})`, finding: updated });
  } catch (error: any) {
    console.error('[Reopen Finding Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reopen finding' });
  }
};
