import { Response } from 'express';
import { prisma } from '../db';
import { readPage, pageInfo } from '../utils/paging';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { canWriteProject } from '../services/projectAccess';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { accessOpen, accessNotStarted } from '../services/engagementRules';
import { readScope, registerScope, ScopeService } from '../services/engagementScope';
import { str, send, notFound, loadEngagement, clientSide, flagFor, bothTrails } from './engagementController';

/**
 * Scope and external access (consulting engagement, sprint 6): the
 * organisation's view of who from outside can see what, the access review
 * that confirms it, and the "Shared with <firm>" marker on its own records.
 * Revoking a person is the engagement's existing remove, one side being
 * enough.
 */

const LIVE = ['Draft', 'Active', 'OnHold'];

/**
 * GET /api/engagements/external-access — every engagement of the
 * organisation that a firm delivers: the firm's people with their role,
 * dates and last activity on the organisation's trail, the binding scope,
 * the document setting and the last access review.
 */
export const externalAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const page = readPage(req.query as Record<string, unknown>, 50);
    const where = { tenantId: { in: scope.tenantIds }, providerTenantId: { not: null }, status: { in: LIVE } };
    const [total, rows] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where, orderBy: [{ targetEndDate: 'asc' }, { ref: 'asc' }], skip: page.skip, take: page.take,
        select: {
          id: true, ref: true, name: true, status: true, tenantId: true, deliveryStyle: true, migratedAt: true, documentAccess: true,
          targetEndDate: true,
          providerTenant: { select: { name: true } },
          members: {
            where: { side: 'Provider', active: true, memberStatus: { in: ['Nominated', 'Approved'] } },
            orderBy: { nominatedAt: 'asc' },
            select: {
              id: true, userId: true, engagementRole: true, memberStatus: true, accessFrom: true, accessTo: true,
              user: { select: { name: true, email: true } },
            },
          },
          scopeVersions: {
            where: { status: 'Binding' }, orderBy: { version: 'desc' }, take: 1,
            select: {
              id: true, version: true, status: true, entityIds: true, frameworkIds: true, services: true,
              classificationCeiling: true, validFrom: true, validTo: true,
            },
          },
          accessReviews: {
            orderBy: { reviewedAt: 'desc' }, take: 1,
            select: { reviewedAt: true, note: true, reviewedBy: { select: { name: true } } },
          },
        },
      }),
    ]);
    // Last activity: the latest entry each person wrote to the organisation's trail.
    const people = [...new Set(rows.flatMap((p) => p.members.map((m) => m.userId)))];
    const last = people.length === 0 ? [] : await prisma.auditLog.groupBy({
      by: ['actorId'], where: { tenantId: { in: scope.tenantIds }, actorId: { in: people } }, _max: { timestamp: true },
    });
    const lastOf = new Map(last.map((l) => [l.actorId, l._max.timestamp]));
    const now = new Date();
    res.json({
      status: 'success',
      engagements: rows.map((p) => {
        const binding = p.scopeVersions[0] ? readScope(p.scopeVersions[0]) : null;
        return {
          id: p.id, ref: p.ref, name: p.name, status: p.status, firm: p.providerTenant?.name ?? null,
          deliveryStyle: p.deliveryStyle, migrated: Boolean(p.migratedAt), documentAccess: p.documentAccess === 'Download' ? 'Download' : 'View',
          // Named the old way: the whole firm reads the engagement until it is migrated.
          oldWay: p.deliveryStyle === null,
          canDecide: canWriteProject(scope, p.tenantId),
          scope: binding ? {
            version: binding.version, services: binding.services, classificationCeiling: binding.classificationCeiling,
            entities: binding.entityIds.length, frameworks: binding.frameworkIds.length, validFrom: binding.validFrom, validTo: binding.validTo,
          } : null,
          lastReview: p.accessReviews[0] ? { by: p.accessReviews[0].reviewedBy?.name ?? null, at: p.accessReviews[0].reviewedAt, note: p.accessReviews[0].note } : null,
          people: p.members.map((m) => ({
            memberId: m.id, name: m.user.name, email: m.user.email, engagementRole: m.engagementRole, memberStatus: m.memberStatus,
            accessFrom: m.accessFrom, accessTo: m.accessTo,
            state: m.memberStatus !== 'Approved' ? 'AwaitingApproval' : accessNotStarted(m, now) ? 'NotStarted' : accessOpen(m, now) ? 'Open' : 'Ended',
            lastActivity: lastOf.get(m.userId) ?? null,
          })),
        };
      }),
      paging: pageInfo(total, page),
    });
  } catch (error: any) {
    console.error('[External Access Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load external access' });
  }
};

/** POST /api/engagements/:projectId/access-review — the organisation confirms who from outside sees what. */
export const confirmAccessReview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e || !(await clientSide(req, e)) || !e.providerTenantId) { notFound(res); return; }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    const note = str(req.body?.note).trim();
    if (!noteIsEnough(note)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Add a note — at least ${MIN_NOTE} characters.` }); return; }
    const actorId = str(req.user!.id);
    const people = await prisma.projectMember.count({
      where: { projectId: e.id, side: 'Provider', active: true, memberStatus: 'Approved' },
    });
    await prisma.$transaction(async (tx) => {
      await tx.engagementAccessReview.create({ data: { projectId: e.id, outcome: 'Confirmed', note, reviewedById: actorId } });
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_ACCESS_REVIEWED',
        payload: { outcome: 'Confirmed', people, note },
        firmPayload: { outcome: 'Confirmed', people },
      });
    });
    res.status(201).json({ status: 'success' });
  } catch (error: any) {
    console.error('[Access Review Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the access review' });
  }
};

const MARKED: Record<string, ScopeService> = { Document: 'Documents', Risk: 'Risks', Asset: 'Assets' };

/**
 * GET /api/engagements/shared-with?subjectType=Document|Risk|Asset&ids=a,b
 * — for the organisation's own registers: which firms each of these records
 * is shared with now, through a binding scope. At most 200 ids.
 */
export const sharedWith = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const subjectType = str(req.query.subjectType);
    const service = MARKED[subjectType];
    if (!service) { send(res, { status: 400, message: 'subjectType must be Document, Risk or Asset.' }); return; }
    const ids = [...new Set(str(req.query.ids).split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 200);
    const scope = await resolveTenantScope(req.user!);
    if (ids.length === 0) { res.json({ status: 'success', sharedWith: {} }); return; }
    const where = { id: { in: ids }, tenantId: { in: scope.tenantIds } };
    const records: { id: string; tenantId: string; classification?: string }[] = subjectType === 'Document'
      ? await prisma.document.findMany({ where, select: { id: true, tenantId: true, classification: true } })
      : subjectType === 'Asset'
        ? await prisma.asset.findMany({ where, select: { id: true, tenantId: true, classification: true } })
        : await prisma.risk.findMany({ where, select: { id: true, tenantId: true } });
    const bindings = await prisma.engagementScopeVersion.findMany({
      where: { status: 'Binding', project: { tenantId: { in: scope.tenantIds }, providerTenantId: { not: null }, status: { in: LIVE } } },
      select: {
        id: true, version: true, status: true, entityIds: true, frameworkIds: true, services: true,
        classificationCeiling: true, validFrom: true, validTo: true,
        project: { select: { providerTenant: { select: { name: true } } } },
      },
    });
    const now = new Date();
    const open = bindings
      .map((b) => ({ firm: b.project.providerTenant?.name ?? '', reg: registerScope(readScope(b), service, now) }))
      .filter((b) => b.reg && b.firm);
    const out: Record<string, string[]> = {};
    for (const r of records) {
      const firms = [...new Set(open.filter((b) => b.reg!.tenantIds.includes(r.tenantId)
        && (r.classification === undefined || b.reg!.classifications.includes(r.classification))).map((b) => b.firm))];
      if (firms.length > 0) out[r.id] = firms;
    }
    res.json({ status: 'success', sharedWith: out });
  } catch (error: any) {
    console.error('[Shared With Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load what is shared' });
  }
};
