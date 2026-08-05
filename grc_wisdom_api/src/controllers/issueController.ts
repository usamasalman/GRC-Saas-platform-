import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { checkSod, SodViolation } from '../services/sodEngine';
import { createIssueRecord } from '../services/issueFactory';

const SUBJ_ISSUE = 'Issue';

/** Internal audit issues are raised against an engagement, never created directly. */
const EXTERNAL_SOURCES = ['ExternalAudit', 'Regulator', 'SelfIdentified', 'Incident', 'RiskAssessment'];
const RESPONSE_TYPES = ['Agree', 'PartiallyAgree', 'Disagree'];
const RATINGS = ['High', 'Medium', 'Low'];

/** Default remediation window when no explicit target date is agreed. */
const TARGET_DAYS: Record<string, number> = { High: 30, Medium: 60, Low: 90 };
const DAY_MS = 86_400_000;

type AgingIssue = {
  identifiedDate: Date;
  targetCloseDate: Date | null;
  riskRating: string;
  status: string;
};

/**
 * Aging is derived, never stored — a stored `isOverdue` flag goes stale the
 * moment the clock moves past it.
 */
export function computeAging(issue: AgingIssue, now = new Date()) {
  const identified = issue.identifiedDate.getTime();
  const target = issue.targetCloseDate
    ? issue.targetCloseDate.getTime()
    : identified + (TARGET_DAYS[issue.riskRating] ?? 60) * DAY_MS;

  const ageDays = Math.max(0, Math.floor((now.getTime() - identified) / DAY_MS));
  const isClosed = issue.status === 'Closed';
  const daysOverdue = isClosed ? 0 : Math.max(0, Math.floor((now.getTime() - target) / DAY_MS));

  return {
    ageDays,
    targetDate: new Date(target),
    isOverdue: daysOverdue > 0,
    daysOverdue,
    ageBucket: ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+',
  };
}

/** Issues awaiting a management response have not started remediation yet. */
const AWAITING_RESPONSE = ['Open', 'Reopened'];

// ─── Register ──────────────────────────────────────────────────────────────

/**
 * One register for every source. Aging and escalation are computed the same
 * way regardless of where the issue came from — that is the point of holding
 * them in a single table rather than per-source silos.
 */
export const listIssues = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.issues.list');

    const { source, status, riskRating, overdue } = req.query as Record<string, string | undefined>;
    const where: any = { tenantId: { in: scope.tenantIds } };
    if (source) where.source = source;
    if (status) where.status = status;
    if (riskRating) where.riskRating = riskRating;

    const rows = await prisma.issue.findMany({
      where,
      include: {
        raisedBy: { select: { id: true, name: true, email: true } },
        capOwner: { select: { id: true, name: true, email: true } },
        respondedBy: { select: { id: true, name: true, email: true } },
        closedBy: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
        audit: { select: { id: true, ref: true, title: true } },
      },
      orderBy: [{ status: 'asc' }, { identifiedDate: 'asc' }],
      take: 500,
    });

    let issues = rows.map((i) => ({ ...i, aging: computeAging(i) }));
    if (overdue === 'true') issues = issues.filter((i) => i.aging.isOverdue);

    const open = issues.filter((i) => i.status !== 'Closed');
    const bySource: Record<string, number> = {};
    for (const i of issues) bySource[i.source] = (bySource[i.source] ?? 0) + 1;

    res.json({
      status: 'success',
      scope: scope.kind,
      count: issues.length,
      totals: {
        total: issues.length,
        open: open.length,
        overdue: open.filter((i) => i.aging.isOverdue).length,
        awaitingResponse: open.filter((i) => AWAITING_RESPONSE.includes(i.status)).length,
        disputed: open.filter((i) => i.status === 'Disputed').length,
        escalated: open.filter((i) => i.escalationLevel > 0).length,
        highOpen: open.filter((i) => i.riskRating === 'High').length,
        closureRate: issues.length > 0
          ? Math.round(((issues.length - open.length) / issues.length) * 100)
          : 100,
      },
      bySource,
      issues,
    });
  } catch (error: any) {
    console.error('[Issue List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list issues' });
  }
};

/**
 * Create an issue that did not come from an internal audit engagement —
 * a regulator letter, an external audit report, a self-identified gap or an
 * incident. Internal audit findings are raised against their engagement so
 * they inherit the engagement reference and the workpaper trail.
 */
export const createIssue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { source, sourceReference, title, recommendation, riskRating, condition, targetCloseDate, tenantId } = req.body || {};

    if (!source || !EXTERNAL_SOURCES.includes(source)) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_SOURCE',
        message: `source must be one of: ${EXTERNAL_SOURCES.join(', ')}. Internal audit findings are raised against their engagement.`,
      });
      return;
    }
    if (!title || !recommendation) {
      res.status(400).json({ status: 'error', message: 'title and recommendation are required' });
      return;
    }
    if (riskRating && !RATINGS.includes(riskRating)) {
      res.status(400).json({ status: 'error', message: `riskRating must be one of: ${RATINGS.join(', ')}` });
      return;
    }
    // A regulator or external-audit issue is traceable to its source document.
    if ((source === 'Regulator' || source === 'ExternalAudit') && !sourceReference) {
      res.status(400).json({
        status: 'error',
        code: 'SOURCE_REFERENCE_REQUIRED',
        message: `A ${source} issue must cite its source document (sourceReference), e.g. the regulator letter or report reference.`,
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const target = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(target)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }

    const issue = await prisma.$transaction(async (tx) => createIssueRecord(tx, {
      tenantId: target,
      source,
      sourceReference: sourceReference ? String(sourceReference).trim() : null,
      title: String(title).trim(),
      condition: condition ? String(condition).trim() : null,
      recommendation: String(recommendation).trim(),
      riskRating: riskRating || 'Medium',
      raisedById: req.user!.id,
      targetCloseDate: targetCloseDate ? new Date(targetCloseDate) : null,
    }));

    res.status(201).json({ status: 'success', issue: { ...issue, aging: computeAging(issue) } });
  } catch (error: any) {
    console.error('[Issue Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create issue' });
  }
};

// ─── Management response ───────────────────────────────────────────────────

/**
 * Management formally accepts or disputes the issue and commits their own
 * action plan. This is what separates an audit report from an accusation:
 * remediation cannot begin until the accountable owner has gone on record.
 *
 * The person who raised the issue cannot supply the response — an auditor
 * writing management's acceptance defeats the purpose.
 */
export const respondToIssue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { responseType, responseNarrative, managementActionPlan } = req.body || {};

    if (!responseType || !RESPONSE_TYPES.includes(responseType)) {
      res.status(400).json({ status: 'error', message: `responseType must be one of: ${RESPONSE_TYPES.join(', ')}` });
      return;
    }
    if (!responseNarrative) {
      res.status(400).json({ status: 'error', message: 'responseNarrative is required — management must state its position' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const issue = await prisma.issue.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!issue) { res.status(404).json({ status: 'error', message: 'Issue not found' }); return; }

    if (!AWAITING_RESPONSE.includes(issue.status)) {
      res.status(409).json({
        status: 'error',
        code: 'ALREADY_RESPONDED',
        message: `${issue.ref} already has a management response (current status: ${issue.status}).`,
      });
      return;
    }
    if (issue.raisedById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'The person who raised the issue cannot write management\'s response to it.',
      });
      return;
    }
    // Agreeing without committing to do anything is not a response.
    if (responseType !== 'Disagree' && !managementActionPlan) {
      res.status(400).json({
        status: 'error',
        code: 'ACTION_PLAN_REQUIRED',
        message: `A response of ${responseType} must include a managementActionPlan describing what will be done.`,
      });
      return;
    }

    const nextStatus = responseType === 'Disagree' ? 'Disputed' : 'Responded';

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.issue.update({
        where: { id },
        data: {
          responseType,
          responseNarrative: String(responseNarrative).trim(),
          managementActionPlan: managementActionPlan ? String(managementActionPlan).trim() : null,
          respondedById: req.user!.id,
          respondedAt: new Date(),
          status: nextStatus,
        },
      });
      await writeAudit(tx, {
        tenantId: issue.tenantId, actorId: req.user!.id, action: 'ISSUE_MANAGEMENT_RESPONSE',
        subjectType: SUBJ_ISSUE, subjectId: id,
        payload: { ref: issue.ref, responseType, status: nextStatus },
      });
      return u;
    });

    res.json({
      status: 'success',
      message: responseType === 'Disagree'
        ? `${issue.ref} disputed by management — escalation required, no corrective action plan will be assigned.`
        : `${issue.ref} accepted (${responseType}) — ready for a corrective action plan.`,
      issue: { ...updated, aging: computeAging(updated) },
    });
  } catch (error: any) {
    console.error('[Issue Respond Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record management response' });
  }
};

// ─── Corrective action plan ────────────────────────────────────────────────

/** A CAP can only follow an accepted management response. */
export const assignCap = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { capOwnerId, capDueDate, capDescription } = req.body || {};

    const scope = await resolveTenantScope(req.user!.tenantId);
    const issue = await prisma.issue.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!issue) { res.status(404).json({ status: 'error', message: 'Issue not found' }); return; }

    if (issue.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Closed issues are immutable — reopen first' });
      return;
    }
    if (issue.status === 'Disputed') {
      res.status(409).json({
        status: 'error',
        code: 'ISSUE_DISPUTED',
        message: `${issue.ref} is disputed by management. Resolve the dispute through escalation before assigning a corrective action plan.`,
      });
      return;
    }
    if (!issue.responseType) {
      res.status(409).json({
        status: 'error',
        code: 'NO_MANAGEMENT_RESPONSE',
        message: `${issue.ref} has no management response yet. Management must accept the issue before a corrective action plan is assigned.`,
      });
      return;
    }

    const ownerId = capOwnerId || issue.capOwnerId;
    const dueDate = capDueDate ? new Date(capDueDate) : issue.capDueDate;
    if (!ownerId || !dueDate) {
      res.status(400).json({ status: 'error', message: 'A CAP requires both capOwnerId and capDueDate' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.issue.update({
        where: { id },
        data: {
          capOwnerId: ownerId,
          capDueDate: dueDate,
          capDescription: capDescription ? String(capDescription).trim() : issue.capDescription,
          status: 'CAPAssigned',
        },
      });
      await writeAudit(tx, {
        tenantId: issue.tenantId, actorId: req.user!.id, action: 'ISSUE_CAP_ASSIGNED',
        subjectType: SUBJ_ISSUE, subjectId: id,
        payload: { ref: issue.ref, capOwnerId: ownerId, capDueDate: dueDate },
      });
      return u;
    });

    res.json({ status: 'success', message: `CAP assigned on ${issue.ref}`, issue: { ...updated, aging: computeAging(updated) } });
  } catch (error: any) {
    console.error('[Issue CAP Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to assign corrective action plan' });
  }
};

/** The CAP owner declares remediation complete; closure still needs validation. */
export const submitForClosure = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { evidenceNote } = req.body || {};

    const scope = await resolveTenantScope(req.user!.tenantId);
    const issue = await prisma.issue.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!issue) { res.status(404).json({ status: 'error', message: 'Issue not found' }); return; }
    if (issue.status !== 'CAPAssigned') {
      res.status(409).json({
        status: 'error',
        code: 'NO_CAP',
        message: `Only issues with an assigned CAP can be submitted for closure (current: ${issue.status}).`,
      });
      return;
    }
    if (!evidenceNote) {
      res.status(400).json({ status: 'error', message: 'evidenceNote is required — state what was remediated and where the evidence sits' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.issue.update({ where: { id }, data: { status: 'PendingClosure' } });
      await writeAudit(tx, {
        tenantId: issue.tenantId, actorId: req.user!.id, action: 'ISSUE_SUBMITTED_FOR_CLOSURE',
        subjectType: SUBJ_ISSUE, subjectId: id,
        payload: { ref: issue.ref, evidenceNote },
      });
      return u;
    });

    res.json({ status: 'success', message: `${issue.ref} submitted for independent validation`, issue: { ...updated, aging: computeAging(updated) } });
  } catch (error: any) {
    console.error('[Issue Submit Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit issue for closure' });
  }
};

// ─── Closure ───────────────────────────────────────────────────────────────

/**
 * Independent closure validation: whoever raised the issue cannot close it.
 * Enforced explicitly and through the data-driven SoD rule.
 */
export const closeIssue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { note } = req.body || {};
    if (!note) {
      res.status(400).json({ status: 'error', message: 'A closure note is required — it is the validation evidence' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const issue = await prisma.issue.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!issue) { res.status(404).json({ status: 'error', message: 'Issue not found' }); return; }
    if (issue.status !== 'PendingClosure') {
      res.status(409).json({ status: 'error', message: `Only issues pending closure can be closed (current: ${issue.status})` });
      return;
    }
    if (issue.raisedById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'Independent closure required: whoever raised an issue cannot close it.',
      });
      return;
    }
    // Validating your own remediation is the same conflict from the other side.
    if (issue.capOwnerId === req.user!.id || issue.respondedById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'Independent closure required: the owner of the corrective action cannot validate their own remediation.',
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await checkSod(tx, {
        tenantId: issue.tenantId,
        actorId: req.user!.id,
        guardedAction: 'ISSUE_CLOSED',
        subjectType: SUBJ_ISSUE,
        subjectId: id,
      });
      const u = await tx.issue.update({
        where: { id },
        data: { status: 'Closed', closedById: req.user!.id, closedAt: new Date(), closureNote: String(note).trim() },
      });
      await writeAudit(tx, {
        tenantId: issue.tenantId, actorId: req.user!.id, action: 'ISSUE_CLOSED',
        subjectType: SUBJ_ISSUE, subjectId: id,
        payload: { ref: issue.ref, note },
      });
      return u;
    });

    res.json({ status: 'success', message: `${issue.ref} closed`, issue: { ...updated, aging: computeAging(updated) } });
  } catch (error: any) {
    if (error instanceof SodViolation) {
      res.status(403).json({ status: 'error', code: error.code, rule: error.ruleKey, message: error.message });
      return;
    }
    console.error('[Issue Close Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to close issue' });
  }
};

export const reopenIssue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body || {};
    if (!reason) { res.status(400).json({ status: 'error', message: 'reason is required to reopen an issue' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const issue = await prisma.issue.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!issue) { res.status(404).json({ status: 'error', message: 'Issue not found' }); return; }
    if (issue.status !== 'Closed') {
      res.status(409).json({ status: 'error', message: 'Only closed issues can be reopened' });
      return;
    }

    // Reopening voids the previous response — remediation failed, so management
    // must go on record again before a new CAP is accepted.
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.issue.update({
        where: { id },
        data: {
          status: 'Reopened',
          reopenedCount: issue.reopenedCount + 1,
          closedById: null,
          closedAt: null,
          closureNote: null,
          responseType: null,
          responseNarrative: null,
          managementActionPlan: null,
          respondedById: null,
          respondedAt: null,
        },
      });
      await writeAudit(tx, {
        tenantId: issue.tenantId, actorId: req.user!.id, action: 'ISSUE_REOPENED',
        subjectType: SUBJ_ISSUE, subjectId: id,
        payload: { ref: issue.ref, reason, reopenedCount: issue.reopenedCount + 1 },
      });
      return u;
    });

    res.json({
      status: 'success',
      message: `${issue.ref} reopened (count: ${updated.reopenedCount}) — a fresh management response is required`,
      issue: { ...updated, aging: computeAging(updated) },
    });
  } catch (error: any) {
    console.error('[Issue Reopen Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reopen issue' });
  }
};

/**
 * Escalate a disputed or overdue issue. Level 1 is executive management,
 * level 2 the audit committee — the route an auditor takes when management
 * will not accept a risk the auditor considers material.
 */
export const escalateIssue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body || {};
    if (!reason) { res.status(400).json({ status: 'error', message: 'reason is required to escalate an issue' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const issue = await prisma.issue.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!issue) { res.status(404).json({ status: 'error', message: 'Issue not found' }); return; }
    if (issue.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Closed issues cannot be escalated' });
      return;
    }

    // Escalation is for issues that are stuck: disputed, or past their date.
    const aging = computeAging(issue);
    if (issue.status !== 'Disputed' && !aging.isOverdue) {
      res.status(409).json({
        status: 'error',
        code: 'NOT_ESCALATABLE',
        message: `${issue.ref} is neither disputed nor overdue (${aging.daysOverdue} days overdue). Escalation is reserved for stuck issues.`,
      });
      return;
    }
    if (issue.escalationLevel >= 2) {
      res.status(409).json({
        status: 'error',
        code: 'MAX_ESCALATION',
        message: `${issue.ref} is already at the audit committee — there is no higher level.`,
      });
      return;
    }

    const level = issue.escalationLevel + 1;
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.issue.update({ where: { id }, data: { escalationLevel: level } });
      await writeAudit(tx, {
        tenantId: issue.tenantId, actorId: req.user!.id, action: 'ISSUE_ESCALATED',
        subjectType: SUBJ_ISSUE, subjectId: id,
        payload: { ref: issue.ref, level, reason, daysOverdue: aging.daysOverdue },
      });
      return u;
    });

    res.json({
      status: 'success',
      message: `${issue.ref} escalated to ${level === 1 ? 'executive management' : 'the audit committee'}`,
      issue: { ...updated, aging: computeAging(updated) },
    });
  } catch (error: any) {
    console.error('[Issue Escalate Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to escalate issue' });
  }
};
