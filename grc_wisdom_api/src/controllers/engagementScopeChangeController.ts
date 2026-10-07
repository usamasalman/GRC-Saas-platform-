import { Response } from 'express';
import { prisma } from '../db';
import { readPage, pageInfo } from '../utils/paging';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { DAY_MS } from '../services/engagementRules';
import { bindingScope, checkScopeDraft, readScope, SCOPE_SERVICES, NEVER_SHARED } from '../services/engagementScope';
import { CLASSIFICATIONS, classificationRank } from '../services/documentAccess';
import { hierarchyOf } from '../services/scopeResolver';
import { createRequests } from '../services/engagementRequestStore';
import { requestAccess, firmMay, checkNewRequest } from './engagementRequestController';
import { str, Conflict, send, notFound, bothTrails, Engagement } from './engagementController';

/**
 * Scope changes (consulting engagement, sprint 8): the firm asks for more
 * than the scope shares, usually because a request could not be raised.
 *
 * Only the organisation decides. Its approval drafts the next scope version,
 * drafted in the approver's name, so the version is approved by someone else
 * of the organisation (the sprint 6 rule) and nothing widens until it binds.
 * A rejected request, or a draft discarded, stays in the history. When the
 * version binds, the request that waited for it is raised.
 */

const list = (raw: string | null | undefined): string[] => { try { return JSON.parse(raw || '[]'); } catch { return []; } };

/** GET /api/engagements/:projectId/scope-changes — both sides. */
export const listScopeChanges = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await requestAccess(req);
    if (!a.ok) { send(res, a); return; }
    const where = { projectId: a.e.id };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const [total, rows] = await Promise.all([
      prisma.scopeChangeRequest.count({ where }),
      prisma.scopeChangeRequest.findMany({
        where, orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }], skip: page.skip, take: page.take,
        select: {
          id: true, ref: true, services: true, entityIds: true, frameworkIds: true, classificationCeiling: true, reason: true,
          pendingRequest: true, status: true, requestedAt: true, decidedAt: true, decisionNote: true, scopeVersionId: true, raisedRequestId: true,
          requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } },
        },
      }),
    ]);
    const ids = [...new Set(rows.flatMap((r) => [...list(r.entityIds)]))];
    const fw = [...new Set(rows.flatMap((r) => list(r.frameworkIds)))];
    const [tenants, standards] = await Promise.all([
      ids.length ? prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [],
      fw.length ? prisma.standard.findMany({ where: { id: { in: fw } }, select: { id: true, code: true } }) : [],
    ]);
    const name = new Map([...tenants.map((t) => [t.id, t.name] as const), ...standards.map((s) => [s.id, s.code] as const)]);
    res.json({
      status: 'success',
      paging: pageInfo(total, page),
      scopeChanges: rows.map((r) => {
        const pending = r.pendingRequest ? JSON.parse(r.pendingRequest) : null;
        return {
          ...r, services: list(r.services),
          entities: list(r.entityIds).map((id) => ({ id, name: name.get(id) ?? id })),
          frameworks: list(r.frameworkIds).map((id) => ({ id, name: name.get(id) ?? id })),
          pendingRequest: pending ? { kind: pending.kind, title: pending.title } : null,
        };
      }),
      can: { ask: a.side === 'Provider' && !firmMay(a, 'request'), decide: a.side === 'Client' && a.manager },
    });
  } catch (error: any) {
    console.error('[Scope Change List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the scope changes' });
  }
};

/** POST /api/engagements/:projectId/scope-changes — the firm asks, with what to add and why. */
export const askScopeChange = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await requestAccess(req);
    if (!a.ok) { send(res, a); return; }
    const refusal = firmMay(a, 'request');
    if (refusal) { send(res, refusal); return; }
    const b = req.body || {};
    const reason = str(b.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    const services = [...new Set((Array.isArray(b.services) ? b.services : []).map(String))] as string[];
    const entityIds = [...new Set((Array.isArray(b.entityIds) ? b.entityIds : []).map(String))] as string[];
    const frameworkIds = [...new Set((Array.isArray(b.frameworkIds) ? b.frameworkIds : []).map(String))] as string[];
    const ceiling = b.classificationCeiling ? str(b.classificationCeiling) : null;
    if (services.some((s) => (NEVER_SHARED as readonly string[]).includes(s))) {
      send(res, { status: 400, code: 'NEVER_SHARED', message: 'Audit Programme and Billing are never shared with a consulting firm.' }); return;
    }
    if (services.some((s) => !(SCOPE_SERVICES as readonly string[]).includes(s))) {
      send(res, { status: 400, code: 'UNKNOWN_SERVICE', message: `Registers that can be shared: ${SCOPE_SERVICES.join(', ')}.` }); return;
    }
    if (ceiling && !(CLASSIFICATIONS as readonly string[]).includes(ceiling)) {
      send(res, { status: 400, code: 'BAD_CEILING', message: `The ceiling is one of ${CLASSIFICATIONS.join(', ')}.` }); return;
    }
    const own = new Set(await hierarchyOf(a.e.tenantId));
    if (entityIds.some((id) => !own.has(id))) {
      send(res, { status: 400, code: 'OUTSIDE_HIERARCHY', message: 'A scope reaches only the organisation and the entities beneath it.' }); return;
    }
    const current = await bindingScope(a.e.id);
    const adds = {
      services: services.filter((s) => !current?.services.includes(s)),
      entityIds: entityIds.filter((id) => !current?.entityIds.includes(id)),
      frameworkIds: frameworkIds.filter((id) => !current?.frameworkIds.includes(id)),
      ceiling: ceiling && classificationRank(ceiling) > classificationRank(current?.classificationCeiling ?? 'Internal') ? ceiling : null,
    };
    if (!adds.services.length && !adds.entityIds.length && !adds.frameworkIds.length && !adds.ceiling) {
      send(res, { status: 400, code: 'NOTHING_TO_ADD', message: 'The scope already shares all of that.' }); return;
    }
    // A request that waits for the change: checked now except for its target,
    // which is checked again when the new scope binds.
    let pending: Record<string, unknown> | null = null;
    if (b.pendingRequest) {
      const p = b.pendingRequest;
      pending = {
        kind: str(p.kind), title: str(p.title).trim().slice(0, 300), criteria: p.criteria ? str(p.criteria).slice(0, 4000) : null,
        // The target by id, or by reference as typed (byRef).
        targetType: str(p.targetType || 'Engagement'),
        targetId: p.targetRef ? str(p.targetRef) : p.targetId ? str(p.targetId) : null,
        byRef: Boolean(p.targetRef || p.byRef),
        periodFrom: p.periodFrom || null, periodTo: p.periodTo || null, dueDate: str(p.dueDate), assigneeId: p.assigneeId ? str(p.assigneeId) : null,
      };
    }
    const made = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scope-changes:${a.e.id}`}))`;
      const n = await tx.scopeChangeRequest.count({ where: { projectId: a.e.id } });
      const row = await tx.scopeChangeRequest.create({
        data: {
          projectId: a.e.id, ref: `SCR-${String(n + 1).padStart(3, '0')}`, reason,
          services: JSON.stringify(adds.services), entityIds: JSON.stringify(adds.entityIds), frameworkIds: JSON.stringify(adds.frameworkIds),
          classificationCeiling: adds.ceiling, pendingRequest: pending ? JSON.stringify(pending) : null, requestedById: a.userId,
        },
        select: { id: true, ref: true },
      });
      await bothTrails(tx, {
        e: a.e, firmTenantId: a.e.providerTenantId, actorId: a.userId, action: 'ENGAGEMENT_SCOPE_CHANGE_ASKED',
        payload: { scopeChangeId: row.id, scopeChange: row.ref, ...adds, reason, waitingRequest: pending ? pending.title : null },
      });
      await notify(tx, [a.e.managerId, a.e.ownerId].map((recipientId) => ({
        tenantId: a.e.tenantId, recipientId, actorId: a.userId, event: 'ENGAGEMENT_SCOPE_CHANGE_ASKED', subjectType: 'Project', subjectId: a.e.id,
        title: `${a.e.providerTenant?.name} asks to widen the scope of ${a.e.ref}`,
        body: `${row.ref}: ${reason}`, link: 'project-delivery',
      })));
      return row;
    });
    res.status(201).json({ status: 'success', scopeChange: made });
  } catch (error: any) {
    console.error('[Scope Change Ask Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to ask for the scope change' });
  }
};

/**
 * POST /api/engagements/:projectId/scope-changes/:id/approve — the
 * organisation agrees, which drafts the next scope version in the approver's
 * name. Someone else of the organisation approves that version on the Scope
 * tab; until then nothing is shared that was not before.
 */
export const approveScopeChange = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await requestAccess(req);
    if (!a.ok) { send(res, a); return; }
    if (a.side !== 'Client' || !a.manager) { send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'Only the organisation decides its scope.' }); return; }
    if (['Closed', 'Cancelled'].includes(a.e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: 'This engagement has ended.' }); return; }
    const sc = await prisma.scopeChangeRequest.findFirst({ where: { id: str(req.params.id), projectId: a.e.id } });
    if (!sc) { notFound(res, 'Scope change'); return; }
    if (sc.status !== 'Pending') { send(res, { status: 409, code: 'NOT_PENDING', message: `${sc.ref} is ${sc.status.toLowerCase()}.` }); return; }
    const current = await bindingScope(a.e.id);
    const ceiling = sc.classificationCeiling ?? current?.classificationCeiling ?? 'Internal';
    const proposal = {
      entityIds: [...new Set([...(current?.entityIds ?? [a.e.tenantId]), ...list(sc.entityIds)])],
      frameworkIds: [...new Set([...(current?.frameworkIds ?? []), ...list(sc.frameworkIds)])],
      services: [...new Set([...(current?.services ?? []), ...list(sc.services)])],
      classificationCeiling: ceiling,
      validFrom: current?.validFrom ?? a.e.startDate,
      validTo: current?.validTo ?? new Date(a.e.targetEndDate.getTime() + 30 * DAY_MS),
      note: `From ${sc.ref}: ${sc.reason}`.slice(0, 500),
    };
    const checked = await checkScopeDraft(a.e.tenantId, proposal);
    if (!checked.ok) { send(res, { status: 409, code: checked.code, message: `The change cannot be drafted: ${checked.message}` }); return; }
    const v = checked.value;
    const note = req.body?.note ? str(req.body.note).trim().slice(0, 500) : null;
    const version = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scope:${a.e.id}`}))`;
      const open = await tx.engagementScopeVersion.findFirst({ where: { projectId: a.e.id, status: 'Draft' }, select: { version: true } });
      if (open) throw new Conflict('DRAFT_OPEN', `Version ${open.version} is waiting for approval. Approve or discard it first.`);
      const last = await tx.engagementScopeVersion.findFirst({ where: { projectId: a.e.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const draft = await tx.engagementScopeVersion.create({
        data: {
          projectId: a.e.id, version: (last?.version ?? 0) + 1, status: 'Draft', origin: 'ScopeChange',
          entityIds: JSON.stringify(v.entityIds), frameworkIds: JSON.stringify(v.frameworkIds), services: JSON.stringify(v.services),
          classificationCeiling: v.classificationCeiling, validFrom: v.validFrom, validTo: v.validTo, note: v.note,
          draftedById: a.userId,
        },
        select: { id: true, version: true },
      });
      const moved = await tx.scopeChangeRequest.updateMany({
        where: { id: sc.id, status: 'Pending' },
        data: { status: 'Drafted', decidedById: a.userId, decidedAt: new Date(), decisionNote: note, scopeVersionId: draft.id },
      });
      if (moved.count === 0) throw new Conflict('NOT_PENDING', `${sc.ref} has just been decided. Reload it.`);
      await bothTrails(tx, {
        e: a.e, firmTenantId: a.e.providerTenantId, actorId: a.userId, action: 'ENGAGEMENT_SCOPE_CHANGE_APPROVED',
        payload: { scopeChangeId: sc.id, scopeChange: sc.ref, draftVersion: draft.version, note },
      });
      // The second approval belongs to someone else of the organisation.
      const others = [a.e.managerId, a.e.ownerId].filter((id) => id !== a.userId);
      await notify(tx, [...new Set(others)].map((recipientId) => ({
        tenantId: a.e.tenantId, recipientId, actorId: a.userId, event: 'ENGAGEMENT_SCOPE_CHANGE_APPROVED', subjectType: 'Project', subjectId: a.e.id,
        title: `Scope version ${draft.version} of ${a.e.ref} needs a second approval`,
        body: `Drafted from ${sc.ref}. Approve or discard it on the Scope tab.`, link: 'project-delivery',
      })));
      return draft.version;
    });
    res.json({ status: 'success', draftVersion: version });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Scope Change Approve Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to approve the scope change' });
  }
};

/** POST /api/engagements/:projectId/scope-changes/:id/reject — the organisation says no, with a reason. */
export const rejectScopeChange = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await requestAccess(req);
    if (!a.ok) { send(res, a); return; }
    if (a.side !== 'Client' || !a.manager) { send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'Only the organisation decides its scope.' }); return; }
    const sc = await prisma.scopeChangeRequest.findFirst({ where: { id: str(req.params.id), projectId: a.e.id }, select: { id: true, ref: true, status: true, requestedById: true } });
    if (!sc) { notFound(res, 'Scope change'); return; }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    await prisma.$transaction(async (tx) => {
      const moved = await tx.scopeChangeRequest.updateMany({
        where: { id: sc.id, status: 'Pending' }, data: { status: 'Rejected', decidedById: a.userId, decidedAt: new Date(), decisionNote: reason },
      });
      if (moved.count === 0) throw new Conflict('NOT_PENDING', `${sc.ref} is no longer waiting for a decision.`);
      await bothTrails(tx, {
        e: a.e, firmTenantId: a.e.providerTenantId, actorId: a.userId, action: 'ENGAGEMENT_SCOPE_CHANGE_REJECTED',
        payload: { scopeChangeId: sc.id, scopeChange: sc.ref, reason },
      });
      await notify(tx, [{
        tenantId: a.e.providerTenantId!, recipientId: sc.requestedById, actorId: a.userId, event: 'ENGAGEMENT_SCOPE_CHANGE_REJECTED',
        subjectType: 'Project', subjectId: a.e.id, title: `${sc.ref} was not agreed`, body: reason, link: 'project-delivery',
      }]);
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Scope Change Reject Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reject the scope change' });
  }
};

// ─── When the drafted version is decided (called from the scope routes) ─────

/**
 * The version a scope change drafted has bound: the change is approved, and
 * the request that waited for it is raised, checked against the new scope,
 * in the raiser's name. If it can no longer be raised as asked (its due date
 * has passed, say) the change still stands and the trail says why.
 */
export async function scopeVersionBound(tx: any, args: { e: Engagement; versionId: string; actorId: string }): Promise<void> {
  const sc = await tx.scopeChangeRequest.findFirst({ where: { projectId: args.e.id, scopeVersionId: args.versionId, status: 'Drafted' } });
  if (!sc) return;
  let raised: string | null = null;
  let notRaised: string | null = null;
  if (sc.pendingRequest) {
    const row = await tx.engagementScopeVersion.findUnique({
      where: { id: args.versionId },
      select: { id: true, version: true, status: true, entityIds: true, frameworkIds: true, services: true, classificationCeiling: true, validFrom: true, validTo: true },
    });
    const pending = JSON.parse(sc.pendingRequest);
    const checked = await checkNewRequest({
      e: args.e, raiserId: sc.requestedById, scope: row ? { ...readScope(row), status: 'Binding' } : null, body: pending, byRef: Boolean(pending.byRef),
    });
    if (checked.ok) {
      const [made] = await createRequests(tx, {
        e: args.e, raisedById: sc.requestedById, requests: [{ ...checked.value, scopeChangeId: sc.id }],
        action: 'ENGAGEMENT_REQUEST_RAISED', source: { fromScopeChange: sc.ref },
      });
      raised = made.id;
    } else {
      notRaised = checked.message;
    }
  }
  await tx.scopeChangeRequest.update({ where: { id: sc.id }, data: { status: 'Approved', raisedRequestId: raised } });
  await bothTrails(tx, {
    e: args.e, firmTenantId: args.e.providerTenantId, actorId: args.actorId, action: 'ENGAGEMENT_SCOPE_CHANGE_BOUND',
    payload: { scopeChangeId: sc.id, scopeChange: sc.ref, requestRaised: Boolean(raised), ...(notRaised ? { requestNotRaised: notRaised } : {}) },
  });
  await notify(tx, [{
    tenantId: args.e.providerTenantId!, recipientId: sc.requestedById, actorId: args.actorId, event: 'ENGAGEMENT_SCOPE_CHANGE_BOUND',
    subjectType: 'Project', subjectId: args.e.id, title: `${sc.ref} is approved: the scope of ${args.e.ref} is wider`,
    body: raised ? 'The request that waited for it has been raised.' : notRaised ? `The request that waited could not be raised: ${notRaised}` : 'See the Scope tab.',
    link: 'project-delivery',
  }]);
}

/** The draft a scope change made was discarded: the change is rejected, and stays in the history. */
export async function scopeVersionDiscarded(tx: any, args: { e: Engagement; versionId: string; actorId: string; reason: string }): Promise<void> {
  const sc = await tx.scopeChangeRequest.findFirst({ where: { projectId: args.e.id, scopeVersionId: args.versionId, status: 'Drafted' } });
  if (!sc) return;
  await tx.scopeChangeRequest.update({
    where: { id: sc.id }, data: { status: 'Rejected', decisionNote: `Draft discarded: ${args.reason}`.slice(0, 1000) },
  });
  await writeAudit(tx, {
    tenantId: args.e.tenantId, actorId: args.actorId, action: 'ENGAGEMENT_SCOPE_CHANGE_REJECTED', subjectType: 'ScopeChangeRequest', subjectId: sc.id,
    payload: { scopeChange: sc.ref, draftDiscarded: true, reason: args.reason },
  });
  await notify(tx, [{
    tenantId: args.e.providerTenantId!, recipientId: sc.requestedById, actorId: args.actorId, event: 'ENGAGEMENT_SCOPE_CHANGE_REJECTED',
    subjectType: 'Project', subjectId: args.e.id, title: `${sc.ref} was not agreed`, body: args.reason, link: 'project-delivery',
  }]);
}
