import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { notify } from '../services/notificationService';
import { resolveTenantScope } from '../services/scopeResolver';
import { canWriteProject } from '../services/projectAccess';
import { featureStates, CONSULTING_FLAG } from '../services/featureFlags';
import { isDeliveryStyle, isEngagementRole, DAY_MS } from '../services/engagementRules';
import { str, Conflict, send, notFound, loadEngagement, clientSide, flagFor, bothTrails } from './engagementController';

/**
 * Moving engagements that named a firm the old way onto approved members
 * (consulting engagement, sprint 6). A one-time step, done by the
 * organisation on one screen before its rules are enforced.
 *
 * Proposed: every active person of the firm on the engagement's team, and
 * the firm's people who worked on it without being on the team, assigned to
 * its tasks or writing to the organisation's trail about it, since the old
 * way let the whole firm in and the team screen could not name the firm's
 * people. The one marked Accountable in RACI is proposed as Lead, everyone
 * else as Consultant, nobody as Reviewer unless the organisation chooses it.
 * Access runs from the approval to the engagement's current target end;
 * nobody gets an open-ended window. A relationship is made if there is none,
 * accepted on the organisation's behalf and marked as migrated, with no
 * invitation. Scope version 1 reproduces the access the firm had: the
 * engagement itself, none of the client's registers.
 *
 * Neither automatic nor a re-invitation: nobody would have approved access
 * granted automatically, and re-inviting would stop live work for an
 * invitation that expires in 14 days. Closed engagements are not migrated;
 * their access follows the after-close rules (sprint 7).
 */

const OLD_WAY = { deliveryStyle: null, migratedAt: null, providerTenantId: { not: null }, status: { notIn: ['Closed', 'Cancelled'] } };

type Source = 'Team' | 'Assigned' | 'Acted';
interface Proposed {
  userId: string; memberId: string | null; name: string; email: string; source: Source;
  raci: string | null; roleLabel: string | null; engagementRole: 'Lead' | 'Consultant';
}

/** Who from the firm the old way let work on this engagement, by the strongest source. */
async function proposalFor(db: any, p: { id: string; tenantId: string; providerTenantId: string }): Promise<Proposed[]> {
  const [team, tasks] = await Promise.all([
    db.projectMember.findMany({
      where: { projectId: p.id, side: 'Provider', active: true },
      orderBy: { addedAt: 'asc' },
      select: { id: true, raci: true, roleLabel: true, user: { select: { id: true, name: true, email: true, status: true, tenantId: true } } },
    }),
    db.projectTask.findMany({
      where: { projectId: p.id },
      select: { id: true, assignee: { select: { id: true, name: true, email: true, status: true, tenantId: true } } },
    }),
  ]);
  const acted = await db.auditLog.findMany({
    where: {
      tenantId: p.tenantId, subjectId: { in: [p.id, ...tasks.map((t: any) => t.id)] },
      actor: { tenantId: p.providerTenantId, status: 'Active' },
    },
    distinct: ['actorId'],
    select: { actor: { select: { id: true, name: true, email: true } } },
  });
  const out = new Map<string, Proposed>();
  const firm = (u: { status: string; tenantId: string } | null) => Boolean(u && u.status === 'Active' && u.tenantId === p.providerTenantId);
  for (const m of team) {
    if (!firm(m.user)) continue;
    out.set(m.user.id, {
      userId: m.user.id, memberId: m.id, name: m.user.name, email: m.user.email, source: 'Team',
      raci: m.raci, roleLabel: m.roleLabel, engagementRole: 'Consultant',
    });
  }
  for (const t of tasks) {
    if (!firm(t.assignee) || out.has(t.assignee.id)) continue;
    out.set(t.assignee.id, {
      userId: t.assignee.id, memberId: null, name: t.assignee.name, email: t.assignee.email, source: 'Assigned',
      raci: null, roleLabel: null, engagementRole: 'Consultant',
    });
  }
  for (const a of acted) {
    if (!a.actor || out.has(a.actor.id)) continue;
    out.set(a.actor.id, {
      userId: a.actor.id, memberId: null, name: a.actor.name, email: a.actor.email, source: 'Acted',
      raci: null, roleLabel: null, engagementRole: 'Consultant',
    });
  }
  const list = [...out.values()];
  const accountable = list.find((x) => x.source === 'Team' && x.raci === 'A');
  if (accountable) accountable.engagementRole = 'Lead';
  return list;
}

/** GET /api/engagements/migration — the organisation's engagements set up the old way, each with its proposal. */
export const migrationProposals = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const rows = (await prisma.project.findMany({
      where: { ...OLD_WAY, tenantId: { in: scope.tenantIds } },
      orderBy: [{ targetEndDate: 'asc' }, { ref: 'asc' }],
      select: {
        id: true, ref: true, name: true, status: true, tenantId: true, providerTenantId: true, targetEndDate: true,
        tenant: { select: { name: true } }, providerTenant: { select: { name: true } },
      },
    })).filter((p) => canWriteProject(scope, p.tenantId));
    // A migrated engagement is a consulting one: consulting on for both sides.
    const on = await featureStates(CONSULTING_FLAG, [...new Set(rows.flatMap((p) => [p.tenantId, p.providerTenantId!]))]);
    const relationships = rows.length === 0 ? [] : await prisma.providerRelationship.findMany({
      where: { OR: rows.map((p) => ({ clientTenantId: p.tenantId, firmTenantId: p.providerTenantId! })) },
      select: { clientTenantId: true, firmTenantId: true },
    });
    const related = new Set(relationships.map((r) => `${r.clientTenantId}|${r.firmTenantId}`));
    const engagements = [];
    for (const p of rows) {
      engagements.push({
        id: p.id, ref: p.ref, name: p.name, status: p.status, client: p.tenant.name, firm: p.providerTenant?.name ?? null,
        targetEndDate: p.targetEndDate,
        relationshipExists: related.has(`${p.tenantId}|${p.providerTenantId}`),
        blocked: !on.get(p.tenantId)
          ? `Consulting is not switched on for ${p.tenant.name}.`
          : !on.get(p.providerTenantId!) ? `Consulting is not switched on for ${p.providerTenant?.name}.` : null,
        proposal: (await proposalFor(prisma, { id: p.id, tenantId: p.tenantId, providerTenantId: p.providerTenantId! }))
          .map((x) => ({ ...x, accessTo: p.targetEndDate })),
      });
    }
    res.json({ status: 'success', engagements });
  } catch (error: any) {
    console.error('[Engagement Migration List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the engagements to migrate' });
  }
};

/**
 * POST /api/engagements/:projectId/migrate — the organisation confirms, once:
 * who is kept and as what, and the delivery style. Team members left out lose
 * their place on the team, with the reason recorded; both trails record it.
 */
export const migrateEngagement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e || !(await clientSide(req, e))) { notFound(res); return; }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    if (e.deliveryStyle !== null || e.migratedAt || !e.providerTenantId) {
      send(res, { status: 409, code: 'NOT_OLD_WAY', message: 'Only an engagement that named its firm the old way is migrated.' }); return;
    }
    if (['Closed', 'Cancelled'].includes(e.status)) {
      send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: 'A closed engagement is not migrated; the after-close rules will apply.' }); return;
    }
    const style = req.body?.deliveryStyle ?? 'ConsultantLed';
    if (!isDeliveryStyle(style)) { send(res, { status: 400, message: 'deliveryStyle must be ClientLed or ConsultantLed.' }); return; }
    const kept: { userId: string; engagementRole: string }[] = [];
    for (const k of Array.isArray(req.body?.members) ? req.body.members : []) {
      const role = str(k?.engagementRole);
      if (!k?.userId || !isEngagementRole(role)) { send(res, { status: 400, message: 'Each person kept needs a role: Lead, Consultant or Reviewer.' }); return; }
      if (!kept.some((x) => x.userId === str(k.userId))) kept.push({ userId: str(k.userId), engagementRole: role });
    }
    if (kept.filter((k) => k.engagementRole === 'Lead').length > 1) {
      send(res, { status: 400, code: 'ONE_LEAD', message: 'An engagement has one Lead.' }); return;
    }
    if (kept.length > 0 && !kept.some((k) => k.engagementRole === 'Lead')) {
      send(res, { status: 400, code: 'LEAD_REQUIRED', message: 'Choose who leads for the firm.' }); return;
    }

    const actorId = str(req.user!.id);
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`engagement:${e.id}`}))`;
      const proposed = await proposalFor(tx, { id: e.id, tenantId: e.tenantId, providerTenantId: e.providerTenantId! });
      const byUser = new Map(proposed.map((x) => [x.userId, x]));
      if (kept.some((k) => !byUser.has(k.userId))) {
        throw new Conflict('NOT_PROPOSED', 'Keep only people the proposal lists: the firm\'s people who worked on this engagement.');
      }
      const moved = await tx.project.updateMany({
        where: { id: e.id, deliveryStyle: null, migratedAt: null },
        data: { deliveryStyle: style, migratedAt: now, migratedById: actorId },
      });
      if (moved.count === 0) throw new Conflict('ALREADY_MIGRATED', 'This engagement has just been migrated.');
      const relationship = await tx.providerRelationship.findUnique({
        where: { clientTenantId_firmTenantId: { clientTenantId: e.tenantId, firmTenantId: e.providerTenantId! } },
        select: { id: true },
      });
      if (!relationship) {
        await tx.providerRelationship.create({
          data: { clientTenantId: e.tenantId, firmTenantId: e.providerTenantId!, status: 'Active', migratedAt: now, migratedById: actorId },
        });
      }
      const approval = {
        memberStatus: 'Approved', origin: 'Migration', nominatedAt: now, decidedById: actorId, decidedAt: now,
        accessFrom: now, accessTo: e.targetEndDate, active: true,
      };
      for (const k of kept) {
        const x = byUser.get(k.userId)!;
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: e.id, userId: k.userId } },
          update: { ...approval, engagementRole: k.engagementRole, side: 'Provider' },
          create: {
            ...approval, projectId: e.id, userId: k.userId, side: 'Provider', engagementRole: k.engagementRole,
            roleLabel: x.roleLabel || k.engagementRole, raci: 'R',
          },
        });
      }
      const dropped = proposed.filter((x) => x.memberId && !kept.some((k) => k.userId === x.userId));
      for (const d of dropped) {
        await tx.projectMember.update({
          where: { id: d.memberId! },
          data: {
            memberStatus: 'Rejected', active: false, origin: 'Migration', decidedById: actorId, decidedAt: now,
            decisionNote: 'Not kept when the engagement was migrated.',
          },
        });
      }
      const standards = await tx.projectStandard.findMany({ where: { projectId: e.id }, select: { standardId: true } });
      await tx.engagementScopeVersion.create({
        data: {
          projectId: e.id, version: 1, status: 'Binding', origin: 'Migration',
          entityIds: JSON.stringify([e.tenantId]), frameworkIds: JSON.stringify(standards.map((s) => s.standardId)),
          services: '[]', classificationCeiling: 'Internal',
          validFrom: e.startDate, validTo: new Date(e.targetEndDate.getTime() + 30 * DAY_MS),
          note: 'Version 1 reproduces the access the firm had: the engagement itself, none of the registers.',
          draftedById: actorId, approvedById: actorId, approvedAt: now,
        },
      });
      const lead = kept.find((k) => k.engagementRole === 'Lead');
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_MIGRATED',
        payload: {
          deliveryStyle: style, relationshipCreated: !relationship,
          kept: kept.map((k) => ({ person: byUser.get(k.userId)!.name, source: byUser.get(k.userId)!.source, engagementRole: k.engagementRole })),
          notKept: proposed.filter((x) => !kept.some((k) => k.userId === x.userId)).map((x) => x.name),
          lead: lead ? byUser.get(lead.userId)!.name : null, accessTo: e.targetEndDate,
        },
      });
      await notify(tx, kept.map((k) => ({
        tenantId: e.providerTenantId!, recipientId: k.userId, actorId, event: 'ENGAGEMENT_PERSON_APPROVED',
        subjectType: 'Project', subjectId: e.id,
        title: `You are approved on ${e.ref} as ${k.engagementRole}`,
        body: `${e.tenant?.name} moved this engagement onto approved people. Your access runs to ${e.targetEndDate.toISOString().slice(0, 10)}.`,
        link: 'project-delivery',
      })));
      return { kept: kept.length, notKept: proposed.length - kept.length, relationshipCreated: !relationship };
    });
    res.json({ status: 'success', ...result, deliveryStyle: style });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Migrate Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to migrate the engagement' });
  }
};
