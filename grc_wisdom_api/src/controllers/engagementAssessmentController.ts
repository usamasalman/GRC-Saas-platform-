import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { firmAccess, FirmAccess } from '../services/engagementFirmAccess';
import { bindingScope, Scope } from '../services/engagementScope';
import { roleMay, roleRefusal, EngagementAction } from '../services/engagementRules';
import { isEnded } from '../services/engagementAfterClose';
import { createIssueRecord } from '../services/issueFactory';
import {
  checkAssessment, raisesGap, isGap, summarise, byClauseRef, RESULT_LABEL, Result,
} from '../services/gapAssessment';
import { checkEntry, registerCounts, contextRef } from '../services/contextRegister';
import { str, send, notFound, loadEngagement, clientSide, flagFor, HELD_READ_ONLY, Engagement } from './engagementController';

/**
 * Gap assessment and the context register (consulting engagement, sprint 10).
 *
 * The assessment covers the clauses of the frameworks the binding scope names,
 * for the entities it names, and nothing else. Either side assesses: the
 * firm's Lead and Consultants, or the organisation. A Partial or Missing
 * clause raises a gap in the organisation's issue register, which it answers
 * and closes there. The context register is the organisation's: the firm
 * proposes entries and sees only its own proposals; nothing it proposes counts
 * until the organisation accepts it.
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

/** Whether the caller may write now: the firm by role, both only while the engagement runs. */
function writeRefusal(a: Ok, action: EngagementAction): { status: number; code?: string; message: string } | null {
  if (isEnded(a.e.status)) return { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` };
  if (a.side === 'Provider') {
    if (!roleMay(a.firm.role, action)) return roleRefusal(a.firm.role, action);
    if (!a.firm.acts) return a.e.status === 'OnHold' ? HELD_READ_ONLY : { status: 403, code: 'OUTSIDE_ACCESS', message: 'Your access to this engagement is not open today.' };
  } else if (a.e.status === 'OnHold') {
    return { status: 409, code: 'ON_HOLD', message: 'This engagement is on hold.' };
  }
  return null;
}

/** Both trails: the organisation's in full, the firm's a summary naming the client. */
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

/** The entities and frameworks the binding scope names. */
async function scopeChoices(a: Ok) {
  const entityIds = a.scope?.entityIds?.length ? a.scope.entityIds : [];
  const frameworkIds = a.scope?.frameworkIds?.length ? a.scope.frameworkIds : [];
  const [entities, frameworks] = await Promise.all([
    entityIds.length ? prisma.tenant.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
    frameworkIds.length ? prisma.standard.findMany({ where: { id: { in: frameworkIds } }, select: { id: true, code: true, title: true }, orderBy: { code: 'asc' } }) : [],
  ]);
  return { entities, frameworks };
}

// ─── Assessment ─────────────────────────────────────────────────────────────

/**
 * GET /api/engagements/:projectId/assessment?tenantId=&standardId= — one
 * framework for one entity: every clause with its current result, its
 * reason, its gap and how often it has been assessed.
 */
export const getAssessment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const { entities, frameworks } = await scopeChoices(a);
    const tenantId = str(req.query.tenantId) || entities[0]?.id || '';
    const standardId = str(req.query.standardId) || frameworks[0]?.id || '';
    if (!entities.some((x) => x.id === tenantId) || !frameworks.some((x) => x.id === standardId)) {
      res.json({ status: 'success', side: a.side, entities, frameworks, clauses: [], summary: summarise([]), can: { assess: false } });
      return;
    }
    const [clauses, current, counts] = await Promise.all([
      prisma.standardClause.findMany({ where: { standardId }, select: { id: true, ref: true, title: true } }),
      prisma.clauseAssessment.findMany({
        where: { projectId: a.e.id, tenantId, supersededAt: null, clause: { standardId } },
        select: {
          id: true, clauseId: true, result: true, justification: true, gapType: true, issueId: true, side: true, assessedAt: true,
          assessedBy: { select: { name: true } },
        },
      }),
      prisma.clauseAssessment.groupBy({ by: ['clauseId'], where: { projectId: a.e.id, tenantId, clause: { standardId } }, _count: { _all: true } }),
    ]);
    const issueIds = current.map((c) => c.issueId).filter(Boolean) as string[];
    const issues = issueIds.length ? await prisma.issue.findMany({ where: { id: { in: issueIds } }, select: { id: true, ref: true, status: true } }) : [];
    const byClause = new Map(current.map((c) => [c.clauseId, c]));
    const times = new Map(counts.map((c) => [c.clauseId, c._count._all]));
    const rows = [...clauses].sort(byClauseRef).map((c) => {
      const cur = byClause.get(c.id) ?? null;
      return {
        ...c,
        result: cur?.result ?? null,
        resultLabel: cur ? RESULT_LABEL[cur.result as Result] : 'Not assessed',
        justification: cur?.justification ?? null,
        gapType: cur?.gapType ?? null,
        gap: cur?.issueId ? issues.find((i) => i.id === cur.issueId) ?? null : null,
        assessedBy: cur?.assessedBy?.name ?? null,
        assessedSide: cur?.side ?? null,
        assessedAt: cur?.assessedAt ?? null,
        times: times.get(c.id) ?? 0,
      };
    });
    res.json({
      status: 'success', side: a.side, entities, frameworks, tenantId, standardId,
      clauses: rows, summary: summarise(rows), can: { assess: !writeRefusal(a, 'assess') },
    });
  } catch (error: any) {
    console.error('[Assessment Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the assessment' });
  }
};

/**
 * POST /api/engagements/:projectId/assessment { tenantId, clauseId, result, justification, gapType? }
 *
 * Replaces the clause's current assessment for that entity, keeping the old
 * one as history. A gap raises an Issue in the entity's register unless one
 * is already open for it; the organisation's issue rules then apply.
 */
export const assessClause = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const refusal = writeRefusal(a, 'assess');
    if (refusal) { send(res, refusal); return; }
    const b = req.body || {};
    const tenantId = str(b.tenantId);
    if (!a.scope?.entityIds?.includes(tenantId)) { notFound(res, 'Entity'); return; }
    const clause = await prisma.standardClause.findFirst({
      where: { id: str(b.clauseId), standardId: { in: a.scope.frameworkIds ?? [] } },
      select: { id: true, ref: true, title: true, standard: { select: { code: true } } },
    });
    if (!clause) { notFound(res, 'Clause'); return; }
    const checked = checkAssessment({ result: b.result, justification: b.justification, gapType: b.gapType });
    if (!checked.ok) { send(res, checked); return; }

    const outcome = await prisma.$transaction(async (tx) => {
      // One assessment of a clause at a time per entity per engagement.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assessment:${a.e.id}:${tenantId}:${clause.id}`}))`;
      const previous = await tx.clauseAssessment.findFirst({
        where: { projectId: a.e.id, tenantId, clauseId: clause.id, supersededAt: null }, select: { id: true, issueId: true },
      });
      const openGap = previous?.issueId
        ? await tx.issue.findFirst({ where: { id: previous.issueId, status: { notIn: ['Closed', 'Cancelled'] } }, select: { id: true, ref: true } })
        : null;
      if (previous) await tx.clauseAssessment.update({ where: { id: previous.id }, data: { supersededAt: new Date() } });
      let issue = openGap;
      if (raisesGap(checked.result, openGap?.id ?? null)) {
        issue = await createIssueRecord(tx, {
          tenantId, source: 'ConsultingGap', sourceReference: `${a.e.ref} ${clause.standard.code} ${clause.ref}`,
          title: `Gap: ${clause.standard.code} ${clause.ref} ${clause.title}`.slice(0, 300),
          recommendation: checked.justification, condition: `${RESULT_LABEL[checked.result]} (${checked.gapType})`,
          criterion: `${clause.standard.code} ${clause.ref} ${clause.title}`, raisedById: a.userId, riskRating: checked.result === 'Missing' ? 'High' : 'Medium',
        });
        await tx.issue.update({ where: { id: issue!.id }, data: { projectId: a.e.id, clauseId: clause.id, gapType: checked.gapType } });
      }
      const row = await tx.clauseAssessment.create({
        data: {
          projectId: a.e.id, tenantId, clauseId: clause.id, result: checked.result, justification: checked.justification,
          gapType: checked.gapType, issueId: isGap(checked.result) || openGap ? issue?.id ?? null : null,
          assessedById: a.userId, side: a.side,
        },
        select: { id: true },
      });
      await bothTrails(tx, a, {
        action: 'ENGAGEMENT_CLAUSE_ASSESSED', subjectType: 'ClauseAssessment', subjectId: row.id,
        payload: { clause: `${clause.standard.code} ${clause.ref}`, tenantId, result: checked.result, gapType: checked.gapType, gap: issue?.ref ?? null },
      });
      if (issue && issue.id !== openGap?.id) {
        const leads = [...new Set([a.e.managerId, a.e.ownerId].filter(Boolean) as string[])];
        await notify(tx, leads.map((recipientId) => ({
          tenantId: a.e.tenantId, recipientId, actorId: a.userId, event: 'ENGAGEMENT_GAP_RAISED', subjectType: 'Issue', subjectId: issue!.id,
          title: `${issue!.ref}: gap on ${clause.standard.code} ${clause.ref}`, body: checked.justification.slice(0, 300), link: 'issues',
        })));
      }
      return { id: row.id, gap: issue ? { id: issue.id, ref: issue.ref, raised: issue.id !== openGap?.id } : null };
    });
    res.status(201).json({ status: 'success', assessment: outcome });
  } catch (error: any) {
    console.error('[Assess Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the assessment' });
  }
};

// ─── Context and interested parties ─────────────────────────────────────────

const ENTRY_SELECT = {
  id: true, ref: true, tenantId: true, kind: true, origin: true, title: true, description: true, source: true, relevance: true,
  requirements: true, status: true, projectId: true, createdAt: true, decidedAt: true, decisionNote: true,
  createdBy: { select: { name: true } }, decidedBy: { select: { name: true } },
  risks: { select: { risk: { select: { id: true, ref: true, title: true } } } },
} as const;

/** The organisations whose register this engagement reaches: the client and the entities in scope. */
const reach = (a: Ok) => [...new Set([a.e.tenantId, ...(a.scope?.entityIds ?? [])])];

/**
 * GET /api/engagements/:projectId/context — the organisation sees its
 * register for the entities in reach; the firm sees only what it proposed on
 * this engagement and what became of it. Figures count accepted entries only.
 */
export const listContext = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const where = a.side === 'Client'
      ? { tenantId: { in: reach(a) } }
      // The firm's own proposals on this engagement, never what the organisation recorded.
      : { projectId: a.e.id, createdBy: { tenantId: a.e.providerTenantId ?? '' } };
    const rows = await prisma.contextEntry.findMany({ where, orderBy: [{ kind: 'asc' }, { ref: 'asc' }], skip: 0, take: 500, select: ENTRY_SELECT });
    const { entities } = await scopeChoices(a);
    res.json({
      status: 'success', side: a.side,
      entries: rows.map((r) => ({ ...r, risks: r.risks.map((x) => x.risk) })),
      counts: registerCounts(rows),
      entities: a.side === 'Client' ? [...new Map([[a.e.tenantId, { id: a.e.tenantId, name: a.e.tenant?.name ?? 'Organisation' }], ...entities.map((x) => [x.id, x] as const)]).values()] : entities,
      can: {
        add: !writeRefusal(a, 'assess'),
        decide: a.side === 'Client' && a.leads && !isEnded(a.e.status),
      },
    });
  } catch (error: any) {
    console.error('[Context Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the context register' });
  }
};

/**
 * POST /api/engagements/:projectId/context { tenantId, kind, origin, title, description?, source, relevance, requirements?, riskIds? }
 *
 * The organisation records an entry, accepted from the start; the firm's Lead
 * or a Consultant proposes one, which counts for nothing until accepted.
 */
export const addContextEntry = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const refusal = writeRefusal(a, 'assess');
    if (refusal) { send(res, refusal); return; }
    const tenantId = str(req.body?.tenantId);
    const allowed = a.side === 'Client' ? reach(a) : (a.scope?.entityIds ?? []);
    if (!allowed.includes(tenantId)) { notFound(res, 'Entity'); return; }
    const checked = checkEntry(req.body);
    if (!checked.ok) { send(res, checked); return; }
    const f = checked.value;
    if (f.riskIds.length) {
      const found = await prisma.risk.count({ where: { id: { in: f.riskIds }, tenantId } });
      if (found !== f.riskIds.length) { send(res, { status: 400, code: 'BAD_RISKS', message: 'Link only risks of that organisation.' }); return; }
    }
    const proposed = a.side === 'Provider';
    const made = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`context:${tenantId}`}))`;
      const ref = contextRef((await tx.contextEntry.count({ where: { tenantId } })) + 1);
      const row = await tx.contextEntry.create({
        data: {
          tenantId, ref, kind: f.kind, origin: f.origin, title: f.title, description: f.description, source: f.source,
          relevance: f.relevance, requirements: f.requirements, status: proposed ? 'Proposed' : 'Accepted',
          projectId: a.e.id, createdById: a.userId,
          ...(proposed ? {} : { decidedById: a.userId, decidedAt: new Date() }),
          risks: { create: f.riskIds.map((riskId) => ({ riskId })) },
        },
        select: { id: true, ref: true, status: true },
      });
      await bothTrails(tx, a, {
        action: proposed ? 'ENGAGEMENT_CONTEXT_PROPOSED' : 'CONTEXT_ENTRY_RECORDED', subjectType: 'ContextEntry', subjectId: row.id,
        payload: { ref, tenantId, kind: f.kind, title: f.title },
      });
      if (proposed) {
        const leads = [...new Set([a.e.managerId, a.e.ownerId].filter(Boolean) as string[])];
        await notify(tx, leads.map((recipientId) => ({
          tenantId: a.e.tenantId, recipientId, actorId: a.userId, event: 'ENGAGEMENT_CONTEXT_PROPOSED', subjectType: 'ContextEntry', subjectId: row.id,
          title: `${ref}: the firm proposes ${f.kind === 'Issue' ? 'a context issue' : 'an interested party'}`, body: f.title, link: 'delivery',
        })));
      }
      return row;
    });
    res.status(201).json({ status: 'success', entry: made });
  } catch (error: any) {
    console.error('[Context Add Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the entry' });
  }
};

/** POST /api/engagements/:projectId/context/:entryId/decide { decision: Accepted | Rejected, note } — the project manager or owner. */
export const decideContextEntry = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    if (a.side !== 'Client' || !a.leads) {
      send(res, { status: 403, code: 'ORGANISATION_DECIDES', message: 'The project manager or owner accepts or rejects a proposal.' }); return;
    }
    if (isEnded(a.e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` }); return; }
    const decision = str(req.body?.decision);
    if (decision !== 'Accepted' && decision !== 'Rejected') { send(res, { status: 400, message: 'A proposal is Accepted or Rejected.' }); return; }
    const note = str(req.body?.note).trim();
    if (decision === 'Rejected' && note.length < 10) { send(res, { status: 400, code: 'REASON_REQUIRED', message: 'Say why, in at least 10 characters. The firm sees it.' }); return; }
    const entry = await prisma.contextEntry.findFirst({
      where: { id: str(req.params.entryId), projectId: a.e.id, tenantId: { in: reach(a) } }, select: { id: true, ref: true, status: true, createdById: true, createdBy: { select: { tenantId: true } } },
    });
    if (!entry) { notFound(res, 'Entry'); return; }
    if (entry.status !== 'Proposed') { send(res, { status: 409, code: 'DECIDED', message: `${entry.ref} is ${entry.status.toLowerCase()}.` }); return; }
    await prisma.$transaction(async (tx) => {
      const moved = await tx.contextEntry.updateMany({
        where: { id: entry.id, status: 'Proposed' },
        data: { status: decision, decidedById: a.userId, decidedAt: new Date(), decisionNote: note.slice(0, 2000) || null },
      });
      if (moved.count === 0) throw Object.assign(new Error('decided'), { code: 'DECIDED' });
      await bothTrails(tx, a, {
        action: decision === 'Accepted' ? 'ENGAGEMENT_CONTEXT_ACCEPTED' : 'ENGAGEMENT_CONTEXT_REJECTED', subjectType: 'ContextEntry', subjectId: entry.id,
        payload: { ref: entry.ref, note: note || null },
      });
      await notify(tx, [{
        tenantId: entry.createdBy.tenantId, recipientId: entry.createdById, actorId: a.userId, event: 'ENGAGEMENT_CONTEXT_DECIDED',
        subjectType: 'ContextEntry', subjectId: entry.id, title: `${entry.ref} ${decision.toLowerCase()}`, body: note, link: 'delivery',
      }]);
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error?.code === 'DECIDED') { send(res, { status: 409, code: 'DECIDED', message: 'That proposal has just been decided.' }); return; }
    console.error('[Context Decide Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to decide the proposal' });
  }
};


