import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { notify } from '../services/notificationService';
import { resolveTenantScope, hierarchyOf } from '../services/scopeResolver';
import { canReadEngagement } from '../services/projectGuard';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { checkScopeDraft, readScope, SCOPE_SERVICES, NEVER_SHARED } from '../services/engagementScope';
import { CLASSIFICATIONS } from '../services/documentAccess';
import { DAY_MS } from '../services/engagementRules';
import {
  str, Conflict, send, notFound, loadEngagement, clientSide, flagFor, bothTrails, Engagement,
} from './engagementController';
import { scopeVersionBound, scopeVersionDiscarded } from './engagementScopeChangeController';

/**
 * An engagement's scope (consulting engagement, sprint 6): what the
 * organisation shares with its delivery firm, versioned like risk appetite.
 *
 * The organisation drafts a version; someone else of the organisation
 * approves it, and it binds until a newer one is approved. The firm reads the
 * binding version and the ones before it, never a draft. Every step is on
 * both organisations' trails.
 */

/** Which side the caller reads from: the organisation, or a firm person the guard lets in. */
async function sideFor(req: AuthenticatedRequest, e: Engagement): Promise<'Client' | 'Provider' | null> {
  if (await clientSide(req, e)) return 'Client';
  if (!e.providerTenantId || e.providerTenantId !== req.user!.tenantId) return null;
  const scope = await resolveTenantScope(req.user!);
  return (await canReadEngagement(scope, str(req.user!.id), e)) ? 'Provider' : null;
}

const ENDED = ['Closed', 'Cancelled'];

/** GET /api/engagements/:projectId/scope — the versions, with names, and what the caller may do. */
export const getScope = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e) { notFound(res); return; }
    const side = await sideFor(req, e);
    if (!side) { notFound(res); return; }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }

    const rows = await prisma.engagementScopeVersion.findMany({
      where: { projectId: e.id, ...(side === 'Provider' ? { status: { in: ['Binding', 'Superseded'] } } : {}) },
      orderBy: { version: 'desc' },
      select: {
        id: true, version: true, status: true, entityIds: true, frameworkIds: true, services: true,
        classificationCeiling: true, validFrom: true, validTo: true, note: true, origin: true,
        draftedById: true, draftedAt: true, approvedAt: true, supersededAt: true,
        draftedBy: { select: { name: true } }, approvedBy: { select: { name: true } },
      },
    });
    const versions = rows.map((r) => ({ ...readScope(r), raw: r }));
    const hierarchy = side === 'Client' ? await hierarchyOf(e.tenantId) : [];
    const entityIds = [...new Set([...versions.flatMap((v) => v.entityIds), ...hierarchy])];
    const [tenants, enabled, projectStandards] = await Promise.all([
      prisma.tenant.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } }),
      side === 'Client'
        ? prisma.tenantStandardEnablement.findMany({
          where: { tenantId: { in: hierarchy } },
          select: { tenantId: true, standard: { select: { id: true, code: true, title: true } } },
        })
        : [],
      prisma.projectStandard.findMany({ where: { projectId: e.id }, select: { standardId: true } }),
    ]);
    const frameworkIds = [...new Set(versions.flatMap((v) => v.frameworkIds))];
    const standards = await prisma.standard.findMany({ where: { id: { in: frameworkIds } }, select: { id: true, code: true, title: true } });
    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    const codeOf = new Map([...standards, ...enabled.map((x) => x.standard)].map((s) => [s.id, `${s.code} — ${s.title}`]));
    const me = str(req.user!.id);
    const openDraft = versions.find((v) => v.status === 'Draft') || null;

    res.json({
      status: 'success',
      side,
      versions: versions.map((v) => ({
        id: v.id, version: v.version, status: v.status, origin: v.raw.origin, note: v.raw.note,
        entities: v.entityIds.map((id) => ({ id, name: nameOf.get(id) || id })),
        frameworks: v.frameworkIds.map((id) => ({ id, name: codeOf.get(id) || id })),
        services: v.services, classificationCeiling: v.classificationCeiling, validFrom: v.validFrom, validTo: v.validTo,
        draftedBy: v.raw.draftedBy?.name ?? null, draftedAt: v.raw.draftedAt,
        approvedBy: v.raw.approvedBy?.name ?? null, approvedAt: v.raw.approvedAt, supersededAt: v.raw.supersededAt,
        ...(side === 'Client' ? { canApprove: v.status === 'Draft' && v.raw.draftedById !== me } : {}),
      })),
      ...(side === 'Client' ? {
        options: {
          entities: hierarchy.map((id) => ({ id, name: nameOf.get(id) || id })),
          frameworks: [...new Map(enabled.map((x) => [x.standard.id, { id: x.standard.id, name: `${x.standard.code} — ${x.standard.title}` }])).values()],
          services: SCOPE_SERVICES, never: NEVER_SHARED, classifications: CLASSIFICATIONS,
        },
        // A first version proposes what the engagement already names.
        defaults: {
          entityIds: [e.tenantId],
          frameworkIds: projectStandards.map((p) => p.standardId),
          services: [], classificationCeiling: 'Internal',
          validFrom: e.startDate, validTo: new Date(e.targetEndDate.getTime() + 30 * DAY_MS),
        },
      } : {}),
      can: {
        draft: side === 'Client' && !openDraft && !ENDED.includes(e.status),
      },
    });
  } catch (error: any) {
    console.error('[Engagement Scope Read Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the scope' });
  }
};

/** POST /api/engagements/:projectId/scope — the organisation drafts the next version. */
export const draftScope = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e || !(await clientSide(req, e))) {
      if (e && e.providerTenantId === req.user!.tenantId) {
        send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'Only the organisation sets the scope. Ask for a change instead.' });
        return;
      }
      notFound(res); return;
    }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    if (ENDED.includes(e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: 'This engagement has ended.' }); return; }
    const checked = await checkScopeDraft(e.tenantId, req.body);
    if (!checked.ok) { send(res, { status: 400, code: checked.code, message: checked.message }); return; }
    const v = checked.value;
    const actorId = str(req.user!.id);
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scope:${e.id}`}))`;
      const open = await tx.engagementScopeVersion.findFirst({ where: { projectId: e.id, status: 'Draft' }, select: { version: true } });
      if (open) throw new Conflict('DRAFT_OPEN', `Version ${open.version} is waiting for approval. Approve or discard it first.`);
      const last = await tx.engagementScopeVersion.findFirst({ where: { projectId: e.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const row = await tx.engagementScopeVersion.create({
        data: {
          projectId: e.id, version: (last?.version ?? 0) + 1, status: 'Draft',
          entityIds: JSON.stringify(v.entityIds), frameworkIds: JSON.stringify(v.frameworkIds), services: JSON.stringify(v.services),
          classificationCeiling: v.classificationCeiling, validFrom: v.validFrom, validTo: v.validTo, note: v.note,
          draftedById: actorId,
        },
      });
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_SCOPE_DRAFTED',
        payload: {
          version: row.version, services: v.services, classificationCeiling: v.classificationCeiling,
          entities: v.entityIds.length, frameworks: v.frameworkIds.length, validFrom: v.validFrom, validTo: v.validTo,
        },
      });
      return row;
    });
    res.status(201).json({ status: 'success', version: { id: created.id, version: created.version, status: created.status } });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Scope Draft Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to draft the scope' });
  }
};

/**
 * POST /api/engagements/:projectId/scope/:versionId/approve — someone of the
 * organisation other than its drafter approves it; it binds, and the version
 * it replaces stays as the basis of the work done under it.
 */
export const approveScope = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e || !(await clientSide(req, e))) { notFound(res); return; }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    const draft = await prisma.engagementScopeVersion.findFirst({
      where: { id: str(req.params.versionId), projectId: e.id },
      select: { id: true, version: true, status: true, draftedById: true, services: true, classificationCeiling: true },
    });
    if (!draft) { notFound(res, 'Scope version'); return; }
    if (draft.status !== 'Draft') { send(res, { status: 409, code: 'NOT_A_DRAFT', message: 'Only a draft can be approved.' }); return; }
    const actorId = str(req.user!.id);
    if (draft.draftedById === actorId) {
      send(res, { status: 403, code: 'SECOND_PERSON', message: 'A scope is approved by someone other than the person who drafted it.' });
      return;
    }
    if (ENDED.includes(e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: 'This engagement has ended.' }); return; }
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`scope:${e.id}`}))`;
      const superseded = await tx.engagementScopeVersion.updateMany({
        where: { projectId: e.id, status: 'Binding' }, data: { status: 'Superseded', supersededAt: now },
      });
      const bound = await tx.engagementScopeVersion.updateMany({
        where: { id: draft.id, status: 'Draft' }, data: { status: 'Binding', approvedById: actorId, approvedAt: now },
      });
      if (bound.count === 0) throw new Conflict('NOT_A_DRAFT', 'Someone has just approved or discarded it. Reload it.');
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_SCOPE_APPROVED',
        payload: { version: draft.version, supersededPrevious: superseded.count > 0, services: JSON.parse(draft.services), classificationCeiling: draft.classificationCeiling },
      });
      const leads = e.providerTenantId ? await tx.projectMember.findMany({
        where: { projectId: e.id, engagementRole: 'Lead', memberStatus: 'Approved', active: true }, select: { userId: true },
      }) : [];
      await notify(tx, leads.map((l) => ({
        tenantId: e.providerTenantId!, recipientId: l.userId, actorId, event: 'ENGAGEMENT_SCOPE_APPROVED',
        subjectType: 'Project', subjectId: e.id,
        title: `The scope of ${e.ref} is now version ${draft.version}`,
        body: `${e.tenant?.name} approved what is shared with you. See the Scope tab.`,
        link: 'project-delivery',
      })));
      // A version drafted from a scope change: the change is approved, and the
      // request that waited for it is raised (sprint 8).
      await scopeVersionBound(tx, { e, versionId: draft.id, actorId });
    });
    res.json({ status: 'success', version: draft.version });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Scope Approve Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to approve the scope' });
  }
};

/** POST /api/engagements/:projectId/scope/:versionId/discard — a draft dropped, with a reason. */
export const discardScope = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e || !(await clientSide(req, e))) { notFound(res); return; }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    const actorId = str(req.user!.id);
    const version = await prisma.$transaction(async (tx) => {
      const row = await tx.engagementScopeVersion.findFirst({
        where: { id: str(req.params.versionId), projectId: e.id }, select: { id: true, version: true },
      });
      if (!row) throw new Conflict('NOT_FOUND', 'Scope version not found');
      const moved = await tx.engagementScopeVersion.updateMany({ where: { id: row.id, status: 'Draft' }, data: { status: 'Discarded' } });
      if (moved.count === 0) throw new Conflict('NOT_A_DRAFT', 'Only a draft can be discarded.');
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_SCOPE_DISCARDED', payload: { version: row.version, reason },
      });
      // A discarded draft of a scope change rejects the change; both stay in the history (sprint 8).
      await scopeVersionDiscarded(tx, { e, versionId: row.id, actorId, reason });
      return row.version;
    });
    res.json({ status: 'success', version });
  } catch (error: any) {
    if (error instanceof Conflict) {
      send(res, { status: error.code === 'NOT_FOUND' ? 404 : 409, code: error.code, message: error.message });
      return;
    }
    console.error('[Engagement Scope Discard Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to discard the draft' });
  }
};
