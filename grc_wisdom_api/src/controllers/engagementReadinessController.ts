import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { firmAccess, FirmAccess } from '../services/engagementFirmAccess';
import { bindingScope, Scope } from '../services/engagementScope';
import { roleMay, roleRefusal } from '../services/engagementRules';
import { isEnded } from '../services/engagementAfterClose';
import { evaluateAppetite } from '../services/riskThresholds';
import { byClauseRef } from '../services/gapAssessment';
import {
  DIMENSIONS, Dimension, verdictOf, spansPeriod, spanDays, monthsBefore, checkRecordsPeriod, DEFAULT_RECORDS_MONTHS, EVIDENCE_FRESH_MONTHS,
  REVIEW_INPUTS, reviewGaps, satisfies93, reviewRef, ReviewRecord,
} from '../services/readiness';
import { str, send, notFound, loadEngagement, clientSide, flagFor, HELD_READ_ONLY, Engagement } from './engagementController';

/**
 * Readiness and management review (consulting engagement, sprint 12).
 *
 * Readiness is computed per clause from the records already held and is
 * never typed in. The firm's Lead gives an opinion beside it; the
 * engagement's owner, as sponsor, signs off; both keep the figures as they
 * stood. A management review is the organisation's record of 9.3: the firm
 * may prepare it, the organisation records it once complete.
 */

type Access =
  | { ok: true; e: Engagement; side: 'Client'; userId: string; leads: boolean; scope: Scope | null }
  | { ok: true; e: Engagement; side: 'Provider'; userId: string; firm: FirmAccess; scope: Scope | null }
  | { ok: false; status: number; code?: string; message: string };

async function access(req: AuthenticatedRequest): Promise<Access> {
  const e = await loadEngagement(str(req.params.projectId));
  const userId = str(req.user!.id);
  if (!e) return { ok: false, status: 404, message: 'Engagement not found' };
  if (await clientSide(req, e)) {
    const refusal = await flagFor(e);
    if (refusal) return { ok: false, ...refusal };
    return { ok: true, e, side: 'Client', userId, leads: e.managerId === userId || e.ownerId === userId, scope: await bindingScope(e.id) };
  }
  if (e.providerTenantId && e.providerTenantId === req.user!.tenantId) {
    const firm = await firmAccess(e, userId);
    if (firm.reads) {
      const refusal = await flagFor(e);
      if (refusal) return { ok: false, ...refusal };
      return { ok: true, e, side: 'Provider', userId, firm, scope: await bindingScope(e.id) };
    }
  }
  return { ok: false, status: 404, message: 'Engagement not found' };
}
type Ok = Extract<Access, { ok: true }>;

function firmRefusal(a: Ok, leadOnly = false): { status: number; code?: string; message: string } | null {
  if (a.side !== 'Provider') return { status: 403, code: 'FIRM_ACTS', message: 'Only the delivery firm does this.' };
  if (leadOnly && a.firm.role !== 'Lead') return { status: 403, code: 'LEAD_ONLY', message: 'The firm\'s Lead gives the readiness opinion.' };
  if (!roleMay(a.firm.role, 'assess')) return roleRefusal(a.firm.role, 'assess');
  if (!a.firm.acts) {
    if (a.e.status === 'OnHold') return HELD_READ_ONLY;
    if (isEnded(a.e.status)) return { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` };
    return { status: 403, code: 'OUTSIDE_ACCESS', message: 'Your access to this engagement is not open today.' };
  }
  return null;
}

async function bothTrails(tx: any, a: Ok, args: { action: string; subjectType: string; subjectId: string; payload: Record<string, unknown> }) {
  await writeAudit(tx, {
    tenantId: a.e.tenantId, actorId: a.userId, action: args.action, subjectType: args.subjectType, subjectId: args.subjectId,
    payload: { projectRef: a.e.ref, projectId: a.e.id, ...args.payload },
  });
  if (a.e.providerTenantId && a.e.providerTenantId !== a.e.tenantId) {
    await writeAudit(tx, {
      tenantId: a.e.providerTenantId, actorId: a.userId, action: args.action, subjectType: args.subjectType, subjectId: args.subjectId,
      payload: { projectRef: a.e.ref, clientTenantId: a.e.tenantId, ...args.payload },
    });
  }
}

const recordsMonths = async (projectId: string) => (await prisma.project.findUnique({ where: { id: projectId }, select: { recordsPeriodMonths: true } }))?.recordsPeriodMonths ?? DEFAULT_RECORDS_MONTHS;

const parse = (s: string | null, fallback: any) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };
const asReview = (r: { heldOn: Date | null; attendees: string; inputs: string; decisions: string | null; status: string }): ReviewRecord => ({
  heldOn: r.heldOn, attendees: parse(r.attendees, []), inputs: parse(r.inputs, {}), decisions: r.decisions, status: r.status,
});

/**
 * Readiness of one framework for one entity: every clause with its six
 * checks, what is behind each, and its verdict. Exported for the reports.
 */
export async function computeReadiness(projectId: string, tenantId: string, standardId: string, now = new Date()) {
  const months = await recordsMonths(projectId);
  const clauses = (await prisma.standardClause.findMany({ where: { standardId }, select: { id: true, ref: true, title: true } })).sort(byClauseRef);
  const clauseIds = clauses.map((c) => c.id);
  const fresh = monthsBefore(now, EVIDENCE_FRESH_MONTHS);
  const [docLinks, controlLinks, assessments, ownGaps, accepted, reviews, appetites] = await Promise.all([
    prisma.documentLink.findMany({ where: { clauseId: { in: clauseIds }, document: { tenantId, status: 'PUBLISHED' } }, select: { clauseId: true, document: { select: { code: true } } } }),
    prisma.controlClauseLink.findMany({ where: { clauseId: { in: clauseIds } }, select: { clauseId: true, controlId: true } }),
    prisma.clauseAssessment.findMany({ where: { projectId, tenantId, clauseId: { in: clauseIds }, supersededAt: null }, select: { clauseId: true, result: true, issueId: true } }),
    prisma.issue.findMany({ where: { projectId, tenantId, source: 'ConsultingGap', clauseId: { in: clauseIds }, status: { notIn: ['Closed'] } }, select: { id: true, clauseId: true, ref: true } }),
    prisma.informationRequest.findMany({ where: { projectId, status: 'Accepted', closedAt: { gte: fresh }, targetType: { in: ['Clause', 'Control', 'Task'] } }, select: { targetType: true, targetId: true } }),
    prisma.managementReview.findMany({ where: { tenantId, status: 'Recorded' }, select: { heldOn: true, attendees: true, inputs: true, decisions: true, status: true } }),
    prisma.riskAppetite.findMany({ where: { tenantId, status: 'Approved', effectiveTo: null }, select: { category: true, appetiteThreshold: true, toleranceThreshold: true } }),
  ]);
  // A gap carried over from the engagement before (sprint 7) was raised
  // there; this engagement's current assessment of the clause links it.
  const carriedIds = [...new Set(assessments.map((x) => x.issueId).filter((id): id is string => Boolean(id) && !ownGaps.some((g) => g.id === id)))];
  const carriedGaps = carriedIds.length ? await prisma.issue.findMany({
    where: { id: { in: carriedIds }, tenantId, source: 'ConsultingGap', clauseId: { in: clauseIds }, status: { notIn: ['Closed'] } },
    select: { id: true, clauseId: true, ref: true },
  }) : [];
  const gaps = [...ownGaps, ...carriedGaps];
  const controlIds = [...new Set(controlLinks.map((l) => l.controlId))];
  const implementations = controlIds.length ? await prisma.controlImplementation.findMany({
    where: { tenantId, controlId: { in: controlIds } },
    select: {
      id: true, controlId: true, status: true, control: { select: { code: true } },
      evidence: { select: { createdAt: true } },
      riskLinks: { select: { risk: { select: { ref: true, category: true, residualScore: true, status: true } } } },
    },
  }) : [];
  // Accepted evidence maps to clauses the way the requests named them.
  const evidenced = new Set<string>();
  for (const r of accepted) if (r.targetType === 'Clause' && r.targetId) evidenced.add(r.targetId);
  const implIds = accepted.filter((r) => r.targetType === 'Control' && r.targetId).map((r) => r.targetId!);
  const taskIds = accepted.filter((r) => r.targetType === 'Task' && r.targetId).map((r) => r.targetId!);
  if (taskIds.length) (await prisma.projectTaskClause.findMany({ where: { taskId: { in: taskIds } }, select: { clauseId: true } })).forEach((l) => evidenced.add(l.clauseId));
  if (implIds.length) {
    // The control is shared by every entity; the evidence is this entity's only
    // when the request named this entity's implementation of it.
    const implControls = new Set((await prisma.controlImplementation.findMany({ where: { id: { in: implIds }, tenantId }, select: { controlId: true } })).map((x) => x.controlId));
    controlLinks.filter((l) => implControls.has(l.controlId)).forEach((l) => evidenced.add(l.clauseId));
  }
  const tolerance = (category: string) => appetites.find((ap) => ap.category === category) ?? null;
  const mr = satisfies93(reviews.map(asReview), now);

  const rows = clauses.map((c) => {
    const notApplicable = assessments.find((x) => x.clauseId === c.id)?.result === 'NotApplicable';
    const controls = controlLinks.filter((l) => l.clauseId === c.id).map((l) => l.controlId);
    const impls = implementations.filter((i) => controls.includes(i.controlId));
    const risks = impls.flatMap((i) => i.riskLinks.map((l) => l.risk)).filter((r) => r.status !== 'Closed');
    const beyond = risks.filter((r) => { const ap = tolerance(r.category); return ap ? evaluateAppetite(r.residualScore, ap) === 'BeyondTolerance' : false; });
    const short = impls.filter((i) => !spansPeriod(i.evidence.map((x) => x.createdAt), months, now));
    const is93 = /^9\.3/.test(c.ref);
    const checks: Record<Dimension, boolean> = {
      documented: docLinks.some((l) => l.clauseId === c.id),
      implemented: impls.length > 0 && impls.every((i) => i.status === 'Implemented' || i.status === 'Verified'),
      evidenced: evidenced.has(c.id) || (is93 && mr),
      gapsClosed: !gaps.some((g) => g.clauseId === c.id),
      risksTreated: beyond.length === 0,
      records: is93 ? mr : impls.length > 0 && short.length === 0,
    };
    return {
      id: c.id, ref: c.ref, title: c.title, checks, verdict: verdictOf(checks, notApplicable),
      why: {
        documents: docLinks.filter((l) => l.clauseId === c.id).map((l) => l.document.code),
        controls: impls.map((i) => ({ code: i.control.code, status: i.status, evidenceDays: spanDays(i.evidence.map((x) => x.createdAt)), evidenceCount: i.evidence.length })),
        openGaps: gaps.filter((g) => g.clauseId === c.id).map((g) => g.ref),
        beyondTolerance: beyond.map((r) => r.ref),
      },
    };
  });
  const summary = { Ready: 0, 'Nearly ready': 0, 'Not ready': 0, 'Not applicable': 0 } as Record<string, number>;
  for (const r of rows) summary[r.verdict] += 1;
  return { recordsPeriodMonths: months, managementReview93: mr, clauses: rows, summary };
}

// ─── Readiness ──────────────────────────────────────────────────────────────

/** GET /api/engagements/:projectId/readiness?tenantId=&standardId= */
export const getReadiness = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const entityIds = a.scope?.entityIds ?? [];
    const frameworkIds = a.scope?.frameworkIds ?? [];
    const [entities, frameworks, opinions, signOffs] = await Promise.all([
      entityIds.length ? prisma.tenant.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
      frameworkIds.length ? prisma.standard.findMany({ where: { id: { in: frameworkIds } }, select: { id: true, code: true, title: true }, orderBy: { code: 'asc' } }) : [],
      prisma.readinessOpinion.findMany({ where: { projectId: a.e.id }, orderBy: { givenAt: 'desc' }, skip: 0, take: 20, select: { id: true, verdict: true, opinion: true, conditions: true, givenAt: true, givenBy: { select: { name: true } } } }),
      prisma.readinessSignOff.findMany({ where: { projectId: a.e.id }, orderBy: { signedAt: 'desc' }, skip: 0, take: 20, select: { id: true, note: true, opinionId: true, signedAt: true, signedBy: { select: { name: true } } } }),
    ]);
    const tenantId = str(req.query.tenantId) || entities[0]?.id || '';
    const standardId = str(req.query.standardId) || frameworks[0]?.id || '';
    const computed = entities.some((x) => x.id === tenantId) && frameworks.some((x) => x.id === standardId)
      ? await computeReadiness(a.e.id, tenantId, standardId)
      : { recordsPeriodMonths: await recordsMonths(a.e.id), managementReview93: false, clauses: [], summary: {} };
    res.json({
      status: 'success', side: a.side, entities, frameworks, tenantId, standardId, ...computed, dimensions: DIMENSIONS,
      opinions, signOffs,
      can: {
        setPeriod: a.side === 'Client' && a.leads && !isEnded(a.e.status),
        opine: a.side === 'Provider' && !firmRefusal(a, true),
        signOff: a.side === 'Client' && a.e.ownerId === a.userId && !isEnded(a.e.status),
      },
    });
  } catch (error: any) {
    console.error('[Readiness Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to compute readiness' });
  }
};

/** PATCH /api/engagements/:projectId/records-period { months, reason } — the project manager or owner. */
export const setRecordsPeriod = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    if (a.side !== 'Client' || !a.leads) { send(res, { status: 403, code: 'ORGANISATION_SETS', message: 'The project manager or owner sets the records period.' }); return; }
    const checked = checkRecordsPeriod(req.body?.months);
    if (!checked.ok) { send(res, checked); return; }
    const reason = str(req.body?.reason).trim();
    if (reason.length < 10) { send(res, { status: 400, code: 'REASON_REQUIRED', message: 'Say why, in at least 10 characters.' }); return; }
    const was = await recordsMonths(a.e.id);
    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: a.e.id }, data: { recordsPeriodMonths: checked.months } });
      await bothTrails(tx, a, { action: 'ENGAGEMENT_RECORDS_PERIOD_SET', subjectType: 'Project', subjectId: a.e.id, payload: { was, now: checked.months, reason } });
    });
    res.json({ status: 'success', recordsPeriodMonths: checked.months });
  } catch (error: any) {
    console.error('[Records Period Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to set the records period' });
  }
};

/** Every entity and framework's readiness, for keeping with an opinion or a sign-off. */
async function figuresOf(a: Ok) {
  const out: any[] = [];
  for (const t of a.scope?.entityIds ?? []) {
    for (const s of a.scope?.frameworkIds ?? []) {
      const r = await computeReadiness(a.e.id, t, s);
      out.push({ tenantId: t, standardId: s, summary: r.summary, managementReview93: r.managementReview93, recordsPeriodMonths: r.recordsPeriodMonths });
    }
  }
  return out;
}

/** POST /api/engagements/:projectId/readiness/opinion { verdict, opinion, conditions? } — the firm's Lead. */
export const giveOpinion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const no = firmRefusal(a, true);
    if (no) { send(res, no); return; }
    const verdict = str(req.body?.verdict);
    if (!['Ready', 'ReadyWithConditions', 'NotReady'].includes(verdict)) { send(res, { status: 400, message: 'The opinion is Ready, Ready with conditions or Not ready.' }); return; }
    const opinion = str(req.body?.opinion).trim();
    if (opinion.length < 20) { send(res, { status: 400, code: 'OPINION_REQUIRED', message: 'Write the opinion, in at least 20 characters.' }); return; }
    const conditions = str(req.body?.conditions).trim() || null;
    if (verdict === 'ReadyWithConditions' && !conditions) { send(res, { status: 400, code: 'CONDITIONS_REQUIRED', message: 'Say what the conditions are.' }); return; }
    const figures = await figuresOf(a);
    const made = await prisma.$transaction(async (tx) => {
      const row = await tx.readinessOpinion.create({ data: { projectId: a.e.id, verdict, opinion, conditions, figures: JSON.stringify(figures), givenById: a.userId }, select: { id: true } });
      await bothTrails(tx, a, { action: 'ENGAGEMENT_READINESS_OPINION', subjectType: 'Project', subjectId: a.e.id, payload: { opinionId: row.id, verdict, figures } });
      if (a.e.ownerId) {
        await notify(tx, [{ tenantId: a.e.tenantId, recipientId: a.e.ownerId, actorId: a.userId, event: 'ENGAGEMENT_READINESS_OPINION', subjectType: 'Project', subjectId: a.e.id, title: `${a.e.ref}: the firm's readiness opinion is in`, body: verdict, link: 'project-delivery' }]);
      }
      return row;
    });
    res.status(201).json({ status: 'success', opinion: made });
  } catch (error: any) {
    console.error('[Opinion Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the opinion' });
  }
};

/** POST /api/engagements/:projectId/readiness/sign-off { note } — the engagement's owner, as sponsor. */
export const signOffReadiness = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    if (a.side !== 'Client' || a.e.ownerId !== a.userId) { send(res, { status: 403, code: 'SPONSOR_SIGNS', message: 'The engagement\'s owner, as sponsor, signs off readiness.' }); return; }
    if (isEnded(a.e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` }); return; }
    const note = str(req.body?.note).trim();
    if (note.length < 10) { send(res, { status: 400, code: 'NOTE_REQUIRED', message: 'Say what you are signing off, in at least 10 characters.' }); return; }
    const latest = await prisma.readinessOpinion.findFirst({ where: { projectId: a.e.id }, orderBy: { givenAt: 'desc' }, select: { id: true } });
    const figures = await figuresOf(a);
    const made = await prisma.$transaction(async (tx) => {
      const row = await tx.readinessSignOff.create({ data: { projectId: a.e.id, opinionId: latest?.id ?? null, note, figures: JSON.stringify(figures), signedById: a.userId }, select: { id: true } });
      await bothTrails(tx, a, { action: 'ENGAGEMENT_READINESS_SIGNED_OFF', subjectType: 'Project', subjectId: a.e.id, payload: { signOffId: row.id, opinionId: latest?.id ?? null, figures } });
      return row;
    });
    res.status(201).json({ status: 'success', signOff: made });
  } catch (error: any) {
    console.error('[Sign Off Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to sign off' });
  }
};

// ─── Management review (9.3) ────────────────────────────────────────────────

const REVIEW_SELECT = {
  id: true, ref: true, tenantId: true, projectId: true, heldOn: true, attendees: true, inputs: true, decisions: true, status: true,
  preparedAt: true, recordedAt: true, preparedBy: { select: { name: true } }, recordedBy: { select: { name: true } },
  actions: { select: { id: true, description: true, issueId: true, taskId: true, linkLabel: true } },
} as const;

const reach = (a: Ok) => [...new Set([a.e.tenantId, ...(a.scope?.entityIds ?? [])])];

function shapeReview(r: any) {
  const rec = asReview(r);
  return { ...r, attendees: rec.attendees, inputs: rec.inputs, missing: reviewGaps(rec) };
}

/** GET /api/engagements/:projectId/management-reviews — the organisation's reviews; the firm sees those prepared on this engagement. */
export const listReviews = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const where = a.side === 'Client' ? { tenantId: { in: reach(a) } } : { projectId: a.e.id };
    const rows = await prisma.managementReview.findMany({ where, orderBy: { preparedAt: 'desc' }, skip: 0, take: 100, select: REVIEW_SELECT });
    res.json({
      status: 'success', side: a.side, inputs: REVIEW_INPUTS.map(([key, label]) => ({ key, label })), reviews: rows.map(shapeReview),
      entities: (await prisma.tenant.findMany({ where: { id: { in: reach(a) } }, select: { id: true, name: true } })),
      can: { prepare: a.side === 'Client' ? !isEnded(a.e.status) : !firmRefusal(a), record: a.side === 'Client' && a.leads && !isEnded(a.e.status) },
    });
  } catch (error: any) {
    console.error('[Reviews Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the management reviews' });
  }
};

function readReviewBody(b: any) {
  const heldOn = b?.heldOn ? new Date(`${String(b.heldOn).slice(0, 10)}T00:00:00.000Z`) : null;
  const attendees = (Array.isArray(b?.attendees) ? b.attendees : []).map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 50);
  const inputs: Record<string, string> = {};
  for (const [key] of REVIEW_INPUTS) if (b?.inputs?.[key]) inputs[key] = String(b.inputs[key]).trim().slice(0, 4000);
  const decisions = String(b?.decisions ?? '').trim().slice(0, 8000) || null;
  return { heldOn: heldOn && !Number.isNaN(heldOn.getTime()) ? heldOn : null, attendees, inputs, decisions };
}

/** POST /api/engagements/:projectId/management-reviews — a draft, by the organisation or prepared by the firm. */
export const prepareReview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const no = a.side === 'Provider' ? firmRefusal(a) : (isEnded(a.e.status) ? { status: 409, message: `This engagement is ${a.e.status}.` } : null);
    if (no) { send(res, no); return; }
    const tenantId = str(req.body?.tenantId) || a.e.tenantId;
    if (!reach(a).includes(tenantId)) { notFound(res, 'Organisation'); return; }
    const body = readReviewBody(req.body);
    const made = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reviews:${tenantId}`}))`;
      const ref = reviewRef((await tx.managementReview.count({ where: { tenantId } })) + 1);
      const row = await tx.managementReview.create({
        data: { tenantId, projectId: a.e.id, ref, heldOn: body.heldOn, attendees: JSON.stringify(body.attendees), inputs: JSON.stringify(body.inputs), decisions: body.decisions, preparedById: a.userId },
        select: { id: true, ref: true },
      });
      await bothTrails(tx, a, { action: 'MANAGEMENT_REVIEW_PREPARED', subjectType: 'ManagementReview', subjectId: row.id, payload: { ref, tenantId } });
      return row;
    });
    res.status(201).json({ status: 'success', review: made });
  } catch (error: any) {
    console.error('[Review Prepare Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to prepare the review' });
  }
};

async function draftReview(a: Ok, reviewId: string) {
  return prisma.managementReview.findFirst({ where: { id: reviewId, tenantId: { in: reach(a) }, ...(a.side === 'Provider' ? { projectId: a.e.id } : {}) }, select: { ...REVIEW_SELECT, preparedById: true } });
}

/** PATCH /api/engagements/:projectId/management-reviews/:reviewId — while a draft. */
export const updateReview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const no = a.side === 'Provider' ? firmRefusal(a) : null;
    if (no) { send(res, no); return; }
    const r = await draftReview(a, str(req.params.reviewId));
    if (!r) { notFound(res, 'Review'); return; }
    if (r.status !== 'Draft') { send(res, { status: 409, code: 'RECORDED', message: `${r.ref} is recorded and does not change.` }); return; }
    const body = readReviewBody(req.body);
    await prisma.$transaction(async (tx) => {
      await tx.managementReview.update({ where: { id: r.id }, data: { heldOn: body.heldOn, attendees: JSON.stringify(body.attendees), inputs: JSON.stringify(body.inputs), decisions: body.decisions } });
      await bothTrails(tx, a, { action: 'MANAGEMENT_REVIEW_UPDATED', subjectType: 'ManagementReview', subjectId: r.id, payload: { ref: r.ref } });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    console.error('[Review Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update the review' });
  }
};

/** POST /api/engagements/:projectId/management-reviews/:reviewId/record — the organisation, once every input is considered. */
export const recordReview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    if (a.side !== 'Client' || !a.leads) { send(res, { status: 403, code: 'ORGANISATION_RECORDS', message: 'The project manager or owner records the review; the firm may prepare it.' }); return; }
    const r = await draftReview(a, str(req.params.reviewId));
    if (!r) { notFound(res, 'Review'); return; }
    if (r.status !== 'Draft') { send(res, { status: 409, code: 'RECORDED', message: `${r.ref} is already recorded.` }); return; }
    const missing = reviewGaps(asReview(r));
    if (missing.length) { send(res, { status: 400, code: 'INCOMPLETE', message: `A management review records ${missing.join('; ')}.` }); return; }
    await prisma.$transaction(async (tx) => {
      const moved = await tx.managementReview.updateMany({ where: { id: r.id, status: 'Draft' }, data: { status: 'Recorded', recordedById: a.userId, recordedAt: new Date() } });
      if (moved.count === 0) throw Object.assign(new Error('recorded'), { code: 'RECORDED' });
      await bothTrails(tx, a, { action: 'MANAGEMENT_REVIEW_RECORDED', subjectType: 'ManagementReview', subjectId: r.id, payload: { ref: r.ref, heldOn: r.heldOn } });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error?.code === 'RECORDED') { send(res, { status: 409, code: 'RECORDED', message: 'It has just been recorded.' }); return; }
    console.error('[Review Record Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the review' });
  }
};

/**
 * POST /api/engagements/:projectId/management-reviews/:reviewId/actions { description, linkRef? }
 *
 * An action the review decided, linked by reference to the issue (in the
 * review's organisation) or the engagement task that carries it. Actions are
 * added after recording too: the review itself does not change, but what
 * carries its decisions is often raised afterwards.
 */
export const addReviewAction = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    if (a.side !== 'Client') { send(res, { status: 403, code: 'ORGANISATION_ACTS', message: 'The organisation records its review actions.' }); return; }
    const r = await draftReview(a, str(req.params.reviewId));
    if (!r) { notFound(res, 'Review'); return; }
    const description = str(req.body?.description).trim();
    if (description.length < 5) { send(res, { status: 400, message: 'Describe the action.' }); return; }
    let linkLabel: string | null = null;
    let issueId: string | null = null;
    let taskId: string | null = null;
    const linkRef = str(req.body?.linkRef).trim().slice(0, 40);
    if (linkRef) {
      const i = await prisma.issue.findFirst({ where: { ref: linkRef, tenantId: r.tenantId }, select: { id: true, ref: true, title: true } });
      const t = i ? null : await prisma.projectTask.findFirst({ where: { ref: linkRef, projectId: a.e.id }, select: { id: true, ref: true, name: true } });
      if (!i && !t) { send(res, { status: 404, code: 'NO_SUCH_REFERENCE', message: `No issue of this organisation and no task of this engagement is ${linkRef}.` }); return; }
      issueId = i?.id ?? null;
      taskId = t?.id ?? null;
      linkLabel = i ? `${i.ref} ${i.title}` : `${t!.ref} ${t!.name}`;
    }
    const made = await prisma.$transaction(async (tx) => {
      const row = await tx.managementReviewAction.create({ data: { reviewId: r.id, description: description.slice(0, 2000), issueId, taskId, linkLabel }, select: { id: true } });
      await bothTrails(tx, a, { action: 'MANAGEMENT_REVIEW_ACTION_ADDED', subjectType: 'ManagementReview', subjectId: r.id, payload: { ref: r.ref, description, linked: linkLabel } });
      return row;
    });
    res.status(201).json({ status: 'success', action: made });
  } catch (error: any) {
    console.error('[Review Action Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add the action' });
  }
};
