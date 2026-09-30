import { Response } from 'express';
import { prisma } from '../db';
import { readPage, pageInfo } from '../utils/paging';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { canWriteProject } from '../services/projectAccess';
import { notify } from '../services/notificationService';
import { DELIVERY_PARTNER_TYPES } from '../services/providerEngagement';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { CONSULTING_FLAG, featureRefusal, isFeatureOn } from '../services/featureFlags';
import {
  DEFAULT_DELIVERY_STYLE, invitationState, invitationExpiry, isDeliveryStyle, isEngagementRole,
  roleMay, roleRefusal,
} from '../services/engagementRules';

/**
 * Consulting engagements: the invitation, the relationship, the firm's people
 * and the delivery style (consulting engagement, sprint 4).
 *
 * Every route here refuses when the "Consulting Engagements" flag is off for
 * the organisation or the firm involved. Switching it off stops new
 * invitations and nominations; it never deletes a relationship or takes back
 * access already granted, because none of that lives on this router.
 *
 * Both organisations' trails record every step: the organisation's in full,
 * the firm's as a summary naming the client.
 */

const str = (v: unknown): string => String(v ?? '');
const FIRM_TYPES: readonly string[] = DELIVERY_PARTNER_TYPES;

class Conflict extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const send = (res: Response, r: { status: number; code?: string; message: string }) => {
  res.status(r.status).json({ status: 'error', ...(r.code ? { code: r.code } : {}), message: r.message });
};
const notFound = (res: Response, what = 'Engagement') => send(res, { status: 404, message: `${what} not found` });

const ENGAGEMENT_SELECT = {
  id: true, ref: true, name: true, status: true, tenantId: true, providerTenantId: true, deliveryStyle: true,
  startDate: true, targetEndDate: true, ownerId: true, managerId: true,
  tenant: { select: { name: true } },
  providerTenant: { select: { name: true } },
} as const;

async function loadEngagement(projectId: string) {
  return prisma.project.findUnique({ where: { id: projectId }, select: ENGAGEMENT_SELECT });
}
type Engagement = NonNullable<Awaited<ReturnType<typeof loadEngagement>>>;

/** The organisation's side: it owns the engagement. */
async function clientSide(req: AuthenticatedRequest, e: { tenantId: string }) {
  const scope = await resolveTenantScope(req.user!);
  return canWriteProject(scope, e.tenantId);
}

/** The caller's own membership of an engagement, if any. */
async function membershipOf(projectId: string, userId: string) {
  return prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { id: true, engagementRole: true, memberStatus: true, active: true, side: true },
  });
}

/** A live membership: nominated or approved, and not removed. */
const live = (m: { memberStatus: string | null; active: boolean } | null) => Boolean(
  m && m.active && (m.memberStatus === 'Nominated' || m.memberStatus === 'Approved'),
);

const flagFor = (e: Engagement, firmTenantId?: string | null) => featureRefusal(CONSULTING_FLAG, [
  { tenantId: e.tenantId, who: e.tenant?.name || 'the organisation' },
  ...((firmTenantId ?? e.providerTenantId) ? [{ tenantId: (firmTenantId ?? e.providerTenantId)!, who: e.providerTenant?.name || 'the firm' }] : []),
]);

/** One entry on each organisation's trail: the client's in full, the firm's a summary. */
async function bothTrails(tx: any, args: {
  e: { id: string; ref: string; tenantId: string };
  firmTenantId: string | null;
  actorId: string;
  action: string;
  payload: Record<string, unknown>;
  firmPayload?: Record<string, unknown>;
}) {
  await writeAudit(tx, {
    tenantId: args.e.tenantId, actorId: args.actorId, action: args.action,
    subjectType: 'Project', subjectId: args.e.id, payload: { ref: args.e.ref, ...args.payload },
  });
  if (args.firmTenantId && args.firmTenantId !== args.e.tenantId) {
    await writeAudit(tx, {
      tenantId: args.firmTenantId, actorId: args.actorId, action: args.action,
      subjectType: 'Project', subjectId: args.e.id,
      payload: { ref: args.e.ref, clientTenantId: args.e.tenantId, ...(args.firmPayload ?? args.payload) },
    });
  }
}

/** The people on each side who should hear about a step. */
async function firmAdmins(tenantId: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { tenantId, status: 'Active', role: { contains: 'admin', mode: 'insensitive' } },
    select: { id: true }, take: 25,
  });
  return users.map((u) => u.id);
}

// ─── The flag, as the screens need it ───────────────────────────────────────

/** GET /api/engagements/feature — whether to show the consulting screens to this caller. */
export const featureState = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({ status: 'success', enabled: await isFeatureOn(CONSULTING_FLAG, req.user!.tenantId) });
  } catch (error: any) {
    console.error('[Engagement Feature Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to read the feature state' });
  }
};

// ─── Invitations ────────────────────────────────────────────────────────────

/**
 * GET /api/engagements/invitations — what this organisation has sent, and what
 * this firm has received. A firm sees only the summary of an invitation it has
 * not accepted: the client, the engagement's name and dates, the style and
 * the message, never the engagement itself.
 */
export const listInvitations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const refusal = await featureRefusal(CONSULTING_FLAG, [{ tenantId: req.user!.tenantId, who: 'your organisation' }]);
    if (refusal) { send(res, refusal); return; }
    const scope = await resolveTenantScope(req.user!);
    const now = new Date();
    const SELECT = {
      id: true, projectId: true, deliveryStyle: true, message: true, status: true, invitedAt: true, expiresAt: true,
      respondedAt: true, responseNote: true, revokedAt: true, revokeReason: true,
      client: { select: { id: true, name: true } }, firm: { select: { id: true, name: true } },
      invitedBy: { select: { name: true } }, respondedBy: { select: { name: true } },
      project: { select: { ref: true, name: true, startDate: true, targetEndDate: true } },
    } as const;
    // One box per request, paged, so neither list stops at a fixed number of
    // rows (QA-021): ?box=received (the default, a firm's) or ?box=sent.
    const box = str(req.query.box) === 'sent' ? 'sent' : 'received';
    const where = box === 'sent'
      ? { clientTenantId: { in: scope.tenantIds } }
      : { firmTenantId: req.user!.tenantId };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const [rows, total] = await Promise.all([
      prisma.engagementInvitation.findMany({
        where, select: SELECT, orderBy: [{ invitedAt: 'desc' }, { id: 'asc' }], skip: page.skip, take: page.take,
      }),
      prisma.engagementInvitation.count({ where }),
    ]);
    const leadOf = new Set((await prisma.projectMember.findMany({
      where: {
        userId: req.user!.id, engagementRole: 'Lead', active: true, memberStatus: { in: ['Nominated', 'Approved'] },
        projectId: { in: rows.map((r) => r.projectId) },
      },
      select: { projectId: true },
    })).map((m) => m.projectId));
    res.json({
      status: 'success',
      box,
      paging: pageInfo(total, page),
      invitations: rows.map((i) => ({ ...i, state: invitationState(i, now), iAmLead: leadOf.has(i.projectId) })),
    });
  } catch (error: any) {
    console.error('[Engagement Invitations Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load invitations' });
  }
};

/**
 * POST /api/engagements/invitations — invite a firm to deliver an engagement.
 * To the firm's organisation, for 14 days, with the delivery style offered
 * (Client-led unless the organisation chooses otherwise).
 */
export const inviteFirm = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const b = req.body || {};
    const e = await loadEngagement(str(b.projectId));
    if (!e) { notFound(res); return; }
    if (!(await clientSide(req, e))) { notFound(res); return; }
    if (e.status === 'Closed' || e.status === 'Cancelled') {
      send(res, { status: 409, code: 'PROJECT_FROZEN', message: `This engagement is ${e.status}.` }); return;
    }
    if (e.providerTenantId) {
      send(res, { status: 409, code: 'FIRM_ALREADY_NAMED', message: `${e.providerTenant?.name || 'A firm'} already delivers this engagement.` });
      return;
    }
    const style = b.deliveryStyle ?? DEFAULT_DELIVERY_STYLE;
    if (!isDeliveryStyle(style)) { send(res, { status: 400, message: 'deliveryStyle must be ClientLed or ConsultantLed.' }); return; }
    const firm = await prisma.tenant.findUnique({
      where: { id: str(b.firmTenantId) }, select: { id: true, name: true, type: true, suspendedAt: true },
    });
    if (!firm || !FIRM_TYPES.includes(firm.type) || firm.id === e.tenantId) {
      send(res, { status: 400, code: 'NOT_A_FIRM', message: 'Invite a consulting firm: a partner organisation on the platform.' });
      return;
    }
    if (firm.suspendedAt) { send(res, { status: 409, code: 'FIRM_SUSPENDED', message: `${firm.name} is suspended.` }); return; }
    const refusal = await featureRefusal(CONSULTING_FLAG, [
      { tenantId: e.tenantId, who: e.tenant?.name || 'your organisation' }, { tenantId: firm.id, who: firm.name },
    ]);
    if (refusal) { send(res, refusal); return; }
    const message = b.message ? str(b.message).trim().slice(0, 2000) : null;
    const actorId = str(req.user!.id);
    const now = new Date();

    const created = await prisma.$transaction(async (tx) => {
      // One live invitation per engagement; checked under the engagement's
      // lock so two sent together cannot both stand.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`engagement:${e.id}`}))`;
      const pending = await tx.engagementInvitation.count({
        where: { projectId: e.id, status: 'Pending', expiresAt: { gt: now } },
      });
      if (pending > 0) throw new Conflict('INVITATION_PENDING', 'This engagement already has an invitation waiting for an answer. Revoke it first.');
      const inv = await tx.engagementInvitation.create({
        data: {
          projectId: e.id, clientTenantId: e.tenantId, firmTenantId: firm.id, deliveryStyle: style, message,
          invitedById: actorId, invitedAt: now, expiresAt: invitationExpiry(now),
        },
      });
      await tx.project.update({ where: { id: e.id }, data: { deliveryStyle: style } });
      await bothTrails(tx, {
        e, firmTenantId: firm.id, actorId, action: 'ENGAGEMENT_FIRM_INVITED',
        payload: { invitationId: inv.id, firmTenantId: firm.id, firm: firm.name, deliveryStyle: style, expiresAt: inv.expiresAt },
        firmPayload: { invitationId: inv.id, client: e.tenant?.name, deliveryStyle: style, expiresAt: inv.expiresAt },
      });
      await notify(tx, (await firmAdmins(firm.id)).map((recipientId) => ({
        tenantId: firm.id, recipientId, actorId, event: 'ENGAGEMENT_INVITATION', subjectType: 'Project', subjectId: e.id,
        title: `${e.tenant?.name} invites you to deliver ${e.name}`,
        body: `Answer by ${inv.expiresAt.toISOString().slice(0, 10)} from Invitations in project delivery.`,
        link: 'project-delivery',
      })));
      return inv;
    });
    res.status(201).json({ status: 'success', invitation: { ...created, state: invitationState(created) } });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Invite Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to send the invitation' });
  }
};

/** Loads an invitation with its engagement. */
async function loadInvitation(id: string) {
  return prisma.engagementInvitation.findUnique({
    where: { id },
    select: {
      id: true, status: true, expiresAt: true, deliveryStyle: true, firmTenantId: true, clientTenantId: true,
      firm: { select: { name: true } },
      project: { select: ENGAGEMENT_SELECT },
    },
  });
}

/** POST /api/engagements/invitations/:id/revoke — the organisation withdraws it; it stays on record. */
export const revokeInvitation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const inv = await loadInvitation(str(req.params.id));
    if (!inv || !(await clientSide(req, inv.project))) { notFound(res, 'Invitation'); return; }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) {
      send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why it is withdrawn — at least ${MIN_NOTE} characters.` }); return;
    }
    const refusal = await flagFor(inv.project, inv.firmTenantId);
    if (refusal) { send(res, refusal); return; }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      const moved = await tx.engagementInvitation.updateMany({
        where: { id: inv.id, status: 'Pending', expiresAt: { gt: new Date() } },
        data: { status: 'Revoked', revokedById: actorId, revokedAt: new Date(), revokeReason: reason },
      });
      if (moved.count === 0) throw new Conflict('NOT_PENDING', 'Only an invitation still waiting for an answer can be withdrawn.');
      await bothTrails(tx, {
        e: inv.project, firmTenantId: inv.firmTenantId, actorId, action: 'ENGAGEMENT_INVITATION_REVOKED',
        payload: { invitationId: inv.id, firm: inv.firm.name, reason },
        firmPayload: { invitationId: inv.id, client: inv.project.tenant?.name, reason },
      });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Revoke Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to withdraw the invitation' });
  }
};

/**
 * POST /api/engagements/invitations/:id/accept — the firm takes the engagement.
 *
 * Single use and only before it expires. Accepting names the firm on the
 * engagement, makes the relationship if this is the first, and nominates the
 * person accepting as the firm's Lead, for the organisation to approve.
 */
export const acceptInvitation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const inv = await loadInvitation(str(req.params.id));
    if (!inv || inv.firmTenantId !== req.user!.tenantId) { notFound(res, 'Invitation'); return; }
    const refusal = await flagFor(inv.project, inv.firmTenantId);
    if (refusal) { send(res, refusal); return; }
    const state = invitationState(inv);
    if (state === 'Expired') { send(res, { status: 409, code: 'INVITATION_EXPIRED', message: 'This invitation has expired. The organisation can send a new one.' }); return; }
    if (state !== 'Pending') { send(res, { status: 409, code: 'NOT_PENDING', message: `This invitation was ${state.toLowerCase()}.` }); return; }

    const actorId = str(req.user!.id);
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const taken = await tx.engagementInvitation.updateMany({
        where: { id: inv.id, status: 'Pending', expiresAt: { gt: now } },
        data: { status: 'Accepted', respondedById: actorId, respondedAt: now },
      });
      if (taken.count === 0) throw new Conflict('NOT_PENDING', 'This invitation has just been answered, withdrawn or expired.');
      const named = await tx.project.updateMany({
        where: { id: inv.project.id, providerTenantId: null },
        data: { providerTenantId: inv.firmTenantId, deliveryStyle: inv.deliveryStyle },
      });
      if (named.count === 0) throw new Conflict('FIRM_ALREADY_NAMED', 'Another firm already delivers this engagement.');

      const existing = await tx.providerRelationship.findUnique({
        where: { clientTenantId_firmTenantId: { clientTenantId: inv.clientTenantId, firmTenantId: inv.firmTenantId } },
      });
      const relationship = existing ?? await tx.providerRelationship.create({
        data: { clientTenantId: inv.clientTenantId, firmTenantId: inv.firmTenantId, establishedByInvitationId: inv.id },
      });

      await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: inv.project.id, userId: actorId } },
        create: {
          projectId: inv.project.id, userId: actorId, side: 'Provider', roleLabel: 'Engagement lead', raci: 'R',
          engagementRole: 'Lead', memberStatus: 'Nominated', nominatedById: actorId, nominatedAt: now,
        },
        update: {
          side: 'Provider', engagementRole: 'Lead', memberStatus: 'Nominated', nominatedById: actorId, nominatedAt: now,
          decidedById: null, decidedAt: null, decisionNote: null, active: true,
        },
      });

      await bothTrails(tx, {
        e: inv.project, firmTenantId: inv.firmTenantId, actorId, action: 'ENGAGEMENT_INVITATION_ACCEPTED',
        payload: { invitationId: inv.id, firm: inv.firm.name, deliveryStyle: inv.deliveryStyle, relationshipCreated: !existing, lead: actorId },
        firmPayload: { invitationId: inv.id, client: inv.project.tenant?.name, relationshipCreated: !existing },
      });
      await notify(tx, [inv.project.managerId, inv.project.ownerId].map((recipientId) => ({
        tenantId: inv.project.tenantId, recipientId, actorId, event: 'ENGAGEMENT_INVITATION_ACCEPTED',
        subjectType: 'Project', subjectId: inv.project.id,
        title: `${inv.firm.name} accepted ${inv.project.ref}`,
        body: 'Approve the firm\'s Lead, and each person they nominate, on the Team tab. Nobody from the firm has access until you do.',
        link: 'project-delivery',
      })));
      return { relationshipId: relationship.id, relationshipCreated: !existing };
    });
    res.json({ status: 'success', ...result, projectId: inv.project.id });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Accept Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to accept the invitation' });
  }
};

/** POST /api/engagements/invitations/:id/decline — the firm says no; it stays on record. */
export const declineInvitation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const inv = await loadInvitation(str(req.params.id));
    if (!inv || inv.firmTenantId !== req.user!.tenantId) { notFound(res, 'Invitation'); return; }
    const refusal = await flagFor(inv.project, inv.firmTenantId);
    if (refusal) { send(res, refusal); return; }
    const note = req.body?.reason ? str(req.body.reason).trim().slice(0, 2000) : null;
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      const moved = await tx.engagementInvitation.updateMany({
        where: { id: inv.id, status: 'Pending', expiresAt: { gt: new Date() } },
        data: { status: 'Declined', respondedById: actorId, respondedAt: new Date(), responseNote: note },
      });
      if (moved.count === 0) throw new Conflict('NOT_PENDING', 'Only an invitation still waiting for an answer can be declined.');
      await bothTrails(tx, {
        e: inv.project, firmTenantId: inv.firmTenantId, actorId, action: 'ENGAGEMENT_INVITATION_DECLINED',
        payload: { invitationId: inv.id, firm: inv.firm.name, reason: note },
        firmPayload: { invitationId: inv.id, client: inv.project.tenant?.name, reason: note },
      });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Decline Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to decline the invitation' });
  }
};

// ─── The firm's people ──────────────────────────────────────────────────────

/**
 * GET /api/engagements/:projectId — the engagement as both sides manage it:
 * the style, the relationship, the invitations and the firm's people with
 * where each stands. The organisation sees it all; the firm sees it once it
 * has accepted, and only its own invitations.
 */
export const getEngagement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e) { notFound(res); return; }
    const isClient = await clientSide(req, e);
    const isFirm = !isClient && e.providerTenantId !== null && e.providerTenantId === req.user!.tenantId;
    if (!isClient && !isFirm) { notFound(res); return; }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }

    const [invitations, members, relationship, mine] = await Promise.all([
      prisma.engagementInvitation.findMany({
        where: { projectId: e.id, ...(isFirm ? { firmTenantId: req.user!.tenantId } : {}) },
        orderBy: { invitedAt: 'desc' },
        select: {
          id: true, status: true, deliveryStyle: true, invitedAt: true, expiresAt: true, respondedAt: true,
          responseNote: true, revokeReason: true, firm: { select: { id: true, name: true } },
          invitedBy: { select: { name: true } }, respondedBy: { select: { name: true } },
        },
      }),
      prisma.projectMember.findMany({
        where: { projectId: e.id, engagementRole: { not: null } },
        orderBy: { nominatedAt: 'asc' },
        select: {
          id: true, engagementRole: true, memberStatus: true, roleLabel: true, active: true, accessFrom: true, accessTo: true,
          nominatedAt: true, decidedAt: true, decisionNote: true,
          user: { select: { id: true, name: true, email: true } },
          nominatedBy: { select: { name: true } }, decidedBy: { select: { name: true } },
        },
      }),
      e.providerTenantId
        ? prisma.providerRelationship.findUnique({
          where: { clientTenantId_firmTenantId: { clientTenantId: e.tenantId, firmTenantId: e.providerTenantId } },
          select: { id: true, status: true, establishedAt: true },
        })
        : null,
      membershipOf(e.id, req.user!.id),
    ]);
    const now = new Date();
    res.json({
      status: 'success',
      engagement: {
        id: e.id, ref: e.ref, name: e.name, status: e.status, deliveryStyle: e.deliveryStyle,
        client: e.tenant?.name, firm: e.providerTenant?.name ?? null,
      },
      side: isClient ? 'Client' : 'Provider',
      relationship,
      invitations: invitations.map((i) => ({ ...i, state: invitationState(i, now) })),
      members,
      me: mine && live(mine) ? { engagementRole: mine.engagementRole, memberStatus: mine.memberStatus } : null,
      can: {
        invite: isClient && !e.providerTenantId && !['Closed', 'Cancelled'].includes(e.status),
        decide: isClient,
        changeStyle: isClient && e.deliveryStyle !== null,
        nominate: isFirm && live(mine) && roleMay(mine?.engagementRole, 'nominate'),
      },
    });
  } catch (error: any) {
    console.error('[Engagement Read Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the engagement' });
  }
};

/**
 * POST /api/engagements/:projectId/nominations — the firm's Lead nominates one
 * of the firm's people as Consultant or Reviewer. The nominee has no access
 * until the organisation approves them.
 */
export const nominatePerson = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e || !e.providerTenantId || e.providerTenantId !== req.user!.tenantId) { notFound(res); return; }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    const mine = await membershipOf(e.id, req.user!.id);
    if (!live(mine) || !roleMay(mine!.engagementRole, 'nominate')) { send(res, roleRefusal(live(mine) ? mine!.engagementRole : null, 'nominate')); return; }

    const b = req.body || {};
    const role = str(b.engagementRole || 'Consultant');
    if (!isEngagementRole(role)) { send(res, { status: 400, message: 'engagementRole must be Consultant or Reviewer.' }); return; }
    if (role === 'Lead') { send(res, { status: 409, code: 'ONE_LEAD', message: 'An engagement has one Lead, and it already has one.' }); return; }
    const person = await prisma.user.findUnique({
      where: { id: str(b.userId) }, select: { id: true, name: true, tenantId: true, status: true },
    });
    if (!person || person.tenantId !== e.providerTenantId || person.status !== 'Active') {
      send(res, { status: 400, code: 'NOT_FIRM_PERSON', message: 'Nominate an active person from your own firm.' }); return;
    }
    const roleLabel = b.roleLabel ? str(b.roleLabel).trim().slice(0, 80) : role;
    const actorId = str(req.user!.id);
    const now = new Date();

    const member = await prisma.$transaction(async (tx) => {
      const existing = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId: e.id, userId: person.id } } });
      if (existing && existing.active && ['Nominated', 'Approved'].includes(existing.memberStatus || '')) {
        throw new Conflict('ALREADY_MEMBER', `${person.name} is already on this engagement.`);
      }
      if (existing && existing.side === 'Client') {
        throw new Conflict('CLIENT_MEMBER', `${person.name} is on the organisation's side of this engagement.`);
      }
      const data = {
        side: 'Provider', roleLabel, raci: 'R', engagementRole: role, memberStatus: 'Nominated',
        nominatedById: actorId, nominatedAt: now, decidedById: null, decidedAt: null, decisionNote: null, active: true,
      };
      const row = existing
        ? await tx.projectMember.update({ where: { id: existing.id }, data })
        : await tx.projectMember.create({ data: { ...data, projectId: e.id, userId: person.id } });
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_PERSON_NOMINATED',
        payload: { memberId: row.id, person: person.name, engagementRole: role },
      });
      await notify(tx, [e.managerId, e.ownerId].map((recipientId) => ({
        tenantId: e.tenantId, recipientId, actorId, event: 'ENGAGEMENT_PERSON_NOMINATED', subjectType: 'Project', subjectId: e.id,
        title: `${e.providerTenant?.name} nominated ${person.name} to ${e.ref}`,
        body: `As ${role}. They have no access until you approve them on the Team tab.`,
        link: 'project-delivery',
      })));
      return row;
    });
    res.status(201).json({ status: 'success', member });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Nominate Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to nominate' });
  }
};

/** Loads a firm member of an engagement with the engagement. */
async function loadMember(projectId: string, memberId: string) {
  const [e, m] = await Promise.all([
    loadEngagement(projectId),
    prisma.projectMember.findUnique({
      where: { id: memberId },
      select: {
        id: true, projectId: true, userId: true, engagementRole: true, memberStatus: true, active: true,
        user: { select: { name: true } },
      },
    }),
  ]);
  return e && m && m.projectId === e.id && m.engagementRole ? { e, m } : null;
}

/**
 * POST /api/engagements/:projectId/members/:memberId/approve — the
 * organisation approves one of the firm's people, with their role and access
 * window. Only the organisation's own people approve.
 */
export const approvePerson = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const found = await loadMember(str(req.params.projectId), str(req.params.memberId));
    if (!found || !(await clientSide(req, found.e))) { notFound(res, 'Member'); return; }
    const { e, m } = found;
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    const b = req.body || {};
    const role = str(b.engagementRole || m.engagementRole);
    if (!isEngagementRole(role)) { send(res, { status: 400, message: 'engagementRole must be Lead, Consultant or Reviewer.' }); return; }
    // The engagement's window by default: its start (or today) to 30 days
    // after its target end, as the design sets it.
    const from = b.accessFrom ? new Date(b.accessFrom) : new Date(Math.max(Date.now(), e.startDate.getTime()));
    const to = b.accessTo ? new Date(b.accessTo) : new Date(e.targetEndDate.getTime() + 30 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      send(res, { status: 400, message: 'Give an access window whose end is after its start.' }); return;
    }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`engagement:${e.id}`}))`;
      if (role === 'Lead') {
        const otherLead = await tx.projectMember.count({
          where: { projectId: e.id, id: { not: m.id }, engagementRole: 'Lead', active: true, memberStatus: { in: ['Nominated', 'Approved'] } },
        });
        if (otherLead > 0) throw new Conflict('ONE_LEAD', 'This engagement already has a Lead.');
      }
      const moved = await tx.projectMember.updateMany({
        where: { id: m.id, memberStatus: 'Nominated', active: true },
        data: {
          memberStatus: 'Approved', engagementRole: role, decidedById: actorId, decidedAt: new Date(),
          accessFrom: from, accessTo: to, ...(b.roleLabel ? { roleLabel: str(b.roleLabel).trim().slice(0, 80) } : {}),
        },
      });
      if (moved.count === 0) throw new Conflict('NOT_NOMINATED', 'Only a person waiting for approval can be approved.');
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_PERSON_APPROVED',
        payload: { memberId: m.id, person: m.user.name, engagementRole: role, accessFrom: from, accessTo: to },
      });
      await notify(tx, {
        tenantId: e.providerTenantId || e.tenantId, recipientId: m.userId, actorId, event: 'ENGAGEMENT_PERSON_APPROVED',
        subjectType: 'Project', subjectId: e.id,
        title: `You are approved on ${e.ref} as ${role}`,
        body: `${e.tenant?.name} approved you from ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.`,
        link: 'project-delivery',
      });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Approve Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to approve' });
  }
};

/** POST .../members/:memberId/reject — the organisation says no to a nominee, with a reason. */
export const rejectPerson = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const found = await loadMember(str(req.params.projectId), str(req.params.memberId));
    if (!found || !(await clientSide(req, found.e))) { notFound(res, 'Member'); return; }
    const { e, m } = found;
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      const moved = await tx.projectMember.updateMany({
        where: { id: m.id, memberStatus: 'Nominated', active: true },
        data: { memberStatus: 'Rejected', active: false, decidedById: actorId, decidedAt: new Date(), decisionNote: reason },
      });
      if (moved.count === 0) throw new Conflict('NOT_NOMINATED', 'Only a person waiting for approval can be turned down.');
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_PERSON_REJECTED',
        payload: { memberId: m.id, person: m.user.name, engagementRole: m.engagementRole, reason },
      });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Reject Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to turn the nominee down' });
  }
};

/**
 * POST .../members/:memberId/remove — either side takes a person off the
 * engagement: the organisation, or the firm's Lead. One side is enough.
 */
export const removePerson = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const found = await loadMember(str(req.params.projectId), str(req.params.memberId));
    if (!found) { notFound(res, 'Member'); return; }
    const { e, m } = found;
    const isClient = await clientSide(req, e);
    const isFirm = !isClient && e.providerTenantId === req.user!.tenantId;
    if (!isClient && !isFirm) { notFound(res, 'Member'); return; }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    if (isFirm) {
      const mine = await membershipOf(e.id, req.user!.id);
      if (!live(mine) || !roleMay(mine!.engagementRole, 'nominate')) { send(res, roleRefusal(live(mine) ? mine!.engagementRole : null, 'nominate')); return; }
    }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      const moved = await tx.projectMember.updateMany({
        where: { id: m.id, active: true, memberStatus: { in: ['Nominated', 'Approved'] } },
        data: { memberStatus: 'Removed', active: false, decidedById: actorId, decidedAt: new Date(), decisionNote: reason },
      });
      if (moved.count === 0) throw new Conflict('NOT_ON_ENGAGEMENT', 'That person is not on this engagement.');
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_PERSON_REMOVED',
        payload: { memberId: m.id, person: m.user.name, engagementRole: m.engagementRole, by: isClient ? 'Client' : 'Firm', reason },
      });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Remove Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to remove' });
  }
};

// ─── Delivery style ─────────────────────────────────────────────────────────

/**
 * PATCH /api/engagements/:projectId/delivery-style — only the organisation
 * changes it, with a reason, on both trails. Nothing already approved is
 * touched: who approved an item stays exactly as recorded.
 */
export const changeDeliveryStyle = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e) { notFound(res); return; }
    if (!(await clientSide(req, e))) {
      const firmSide = e.providerTenantId === req.user!.tenantId;
      if (firmSide) { send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'Only the organisation changes the delivery style.' }); return; }
      notFound(res); return;
    }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    const style = req.body?.deliveryStyle;
    if (!isDeliveryStyle(style)) { send(res, { status: 400, message: 'deliveryStyle must be ClientLed or ConsultantLed.' }); return; }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    if (e.deliveryStyle === null) { send(res, { status: 409, code: 'NOT_A_CONSULTING_ENGAGEMENT', message: 'Invite a firm first; the style is set with the invitation.' }); return; }
    if (e.deliveryStyle === style) { res.json({ status: 'success', deliveryStyle: style }); return; }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      const moved = await tx.project.updateMany({ where: { id: e.id, deliveryStyle: e.deliveryStyle }, data: { deliveryStyle: style } });
      if (moved.count === 0) throw new Conflict('STYLE_CHANGED', 'The style changed while you were deciding. Reload it.');
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_STYLE_CHANGED',
        payload: { from: e.deliveryStyle, to: style, reason, earlierApprovals: 'unchanged' },
      });
    });
    res.json({ status: 'success', deliveryStyle: style });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Engagement Style Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to change the delivery style' });
  }
};
