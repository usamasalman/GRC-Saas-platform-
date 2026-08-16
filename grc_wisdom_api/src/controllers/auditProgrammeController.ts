import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { checkSod, SodViolation } from '../services/sodEngine';
import {
  AUDIT_STATUSES, AUDIT_CONCLUSIONS, checkTransition, allowedNextStatuses,
} from '../services/auditLifecycle';

const SUBJ_AUDIT = 'Audit';
const SUBJ_ISSUE = 'Issue';
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

/**
 * Create an engagement that is *not* in the approved annual plan.
 *
 * The sanctioned route is `POST /plan-items/:itemId/instantiate`, which carries
 * the risk rationale and budget that justified the engagement. This endpoint is
 * the special-engagement route — a board request, a fraud investigation — which
 * IIA Std 9.4 permits but expects the CAE to be able to explain, so a written
 * reason is mandatory and the engagement is permanently marked as unplanned.
 */
export const createAudit = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { title, objective, scope: auditScope, criteria, leadAuditorId, startDate, endDate, tenantId, unplannedReason } = req.body || {};
    if (!title || !objective || !auditScope || !criteria) {
      res.status(400).json({ status: 'error', message: 'title, objective, scope and criteria are required' });
      return;
    }
    if (!unplannedReason || String(unplannedReason).trim().length < 10) {
      res.status(400).json({
        status: 'error',
        code: 'UNPLANNED_REASON_REQUIRED',
        message: 'This engagement is not in the approved annual plan. Start it from a plan item instead, or record why it is being run outside the plan (at least 10 characters).',
      });
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
          unplannedReason: String(unplannedReason).trim(),
        },
      });
      await writeAudit(tx, {
        tenantId: target, actorId: req.user!.id, action: 'AUDIT_CREATED_OUTSIDE_PLAN',
        subjectType: SUBJ_AUDIT, subjectId: created.id,
        payload: { ref, title, criteria, unplannedReason: String(unplannedReason).trim() },
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

    const {
      status, title, objective, scope: auditScope, criteria, leadAuditorId,
      startDate, endDate, conclusion, conclusionNarrative, cancellationReason,
    } = req.body || {};
    const data: any = {};
    if (title) data.title = title;
    if (objective) data.objective = objective;
    if (auditScope) data.scope = auditScope;
    if (criteria) data.criteria = criteria;
    if (leadAuditorId) data.leadAuditorId = leadAuditorId;
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;

    // The conclusion can be recorded at any point while the engagement is open.
    if (conclusion !== undefined) {
      if (!AUDIT_CONCLUSIONS.includes(conclusion)) {
        res.status(400).json({
          status: 'error',
          message: `conclusion must be one of: ${AUDIT_CONCLUSIONS.join(', ')}`,
        });
        return;
      }
      if (!conclusionNarrative) {
        res.status(400).json({
          status: 'error',
          code: 'CONCLUSION_NARRATIVE_REQUIRED',
          message: 'A conclusion needs a narrative explaining what it is based on.',
        });
        return;
      }
      if (['Closed', 'Cancelled'].includes(audit.status)) {
        res.status(409).json({
          status: 'error',
          message: `The conclusion on a ${audit.status.toLowerCase()} engagement is part of the record and cannot be rewritten.`,
        });
        return;
      }
      data.conclusion = conclusion;
      data.conclusionNarrative = String(conclusionNarrative).trim();
      data.concludedById = req.user!.id;
      data.concludedAt = new Date();
    }

    if (status) {
      if (!AUDIT_STATUSES.includes(status)) {
        res.status(400).json({ status: 'error', message: `status must be one of: ${AUDIT_STATUSES.join(', ')}` });
        return;
      }

      // Every gate below was already here. What was missing was any check that
      // the engagement was entitled to make this move at all.
      const illegal = checkTransition(audit.status, status);
      if (illegal) {
        res.status(409).json({
          status: 'error',
          code: 'INVALID_TRANSITION',
          message: illegal,
          currentStatus: audit.status,
          allowedNext: allowedNextStatuses(audit.status),
        });
        return;
      }

      if (status === 'Cancelled') {
        if (!cancellationReason) {
          res.status(400).json({
            status: 'error',
            code: 'CANCELLATION_REASON_REQUIRED',
            message: 'Abandoning an engagement has to be explained — it is part of the assurance record.',
          });
          return;
        }
        data.cancellationReason = String(cancellationReason).trim();
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
        // IIA Std 15.1: communicating results means stating a conclusion. A
        // report that lists findings without judging the control environment
        // is not a report.
        if (!audit.conclusion && !data.conclusion) {
          res.status(409).json({
            status: 'error',
            code: 'CONCLUSION_REQUIRED',
            message: `Record an overall conclusion (${AUDIT_CONCLUSIONS.join(', ')}) with its narrative before moving to Reporting.`,
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

    const { updated, coverage } = await prisma.$transaction(async (tx) => {
      const u = await tx.audit.update({ where: { id }, data });

      // Closing an engagement is the event that proves coverage, so it is the
      // event that should stamp it. `lastAuditedAt` used to be settable only by
      // hand on the entity form, which meant a just-completed entity still read
      // as "never audited" and kept climbing the plan on a +0.75 uplift until
      // someone remembered to edit it.
      let cov: { entity: string; at: Date } | null = null;
      if (data.status === 'Closed' && audit.planItemId) {
        const item = await tx.auditPlanItem.findUnique({
          where: { id: audit.planItemId },
          select: { id: true, auditableEntityId: true, auditableEntity: { select: { name: true } } },
        });
        if (item) {
          const at = new Date();
          await tx.auditableEntity.update({
            where: { id: item.auditableEntityId },
            data: { lastAuditedAt: at },
          });
          await tx.auditPlanItem.update({ where: { id: item.id }, data: { status: 'Completed' } });
          cov = { entity: item.auditableEntity.name, at };
        }
      }

      await writeAudit(tx, {
        tenantId: audit.tenantId, actorId: req.user!.id,
        action: data.status ? 'AUDIT_STATUS_CHANGED' : 'AUDIT_UPDATED',
        subjectType: SUBJ_AUDIT, subjectId: id,
        payload: {
          ref: audit.ref,
          before: { status: audit.status, conclusion: audit.conclusion },
          after: data,
          coverageStamped: cov?.entity ?? null,
        },
      });
      return { updated: u, coverage: cov };
    });

    res.json({
      status: 'success',
      message: coverage
        ? `Engagement closed. ${coverage.entity} marked as audited — its coverage uplift is cleared and the plan item is complete.`
        : undefined,
      audit: updated,
    });
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
