import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { readPage, pageInfo } from '../utils/paging';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { hasCapability, CAP } from '../services/capabilityEngine';
import { notify } from '../services/notificationService';

const SUBJECT = 'ImpersonationSession';
const MAX_DURATION_MINS = 120;
const DEFAULT_DURATION_MINS = 30;

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not configured');
  return s;
}

/**
 * Requesting access is a support/security activity; approving it is an identity
 * governance activity inside the customer's own tenant. Both resolved through
 * the RBAC capability engine rather than by matching role names.
 */
async function canRequest(userId: string): Promise<boolean> {
  return (await hasCapability(userId, CAP.MONITOR_SECURITY))
      || (await hasCapability(userId, CAP.RESOLVE_TICKETS));
}

async function canApprove(userId: string): Promise<boolean> {
  return (await hasCapability(userId, CAP.MAINTAIN_ROLES))
      || (await hasCapability(userId, CAP.ADD_USER));
}

/**
 * The acting user's display name.
 *
 * req.user carries id, tenantId and role — not the name — so a notification
 * body built from it read "undefined approved your request". One lookup, and
 * the fallback is a description rather than a blank.
 */
async function actorName(userId: string, fallback: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name?.trim() || fallback;
}

/**
 * Who inside the customer's tenant may authorise this, by name.
 *
 * A request used to be written to the register and then wait for somebody to
 * happen to look. Nothing was sent, nobody in the target tenant was told, and
 * the requester's screen said only "awaiting customer" — so a session could sit
 * PENDING forever with the platform administrator unable to say who to chase
 * and the customer administrator with no reason to open the page.
 *
 * The same list serves both fixes: it is who gets the notification, and it is
 * what the register shows beside a pending row instead of "awaiting customer".
 * The subject of the session is excluded, because approveSession refuses them
 * anyway and offering their name as the person to chase would be wrong.
 */
async function approversFor(
  tenantId: string,
  excludeUserId: string | null,
): Promise<Array<{ id: string; name: string; email: string; role: string }>> {
  const members = await prisma.user.findMany({
    where: { tenantId, status: 'Active' },
    select: { id: true, name: true, email: true, role: true },
  });

  const out: Array<{ id: string; name: string; email: string; role: string }> = [];
  for (const m of members) {
    if (m.id === excludeUserId) continue;
    // Resolved through the capability engine, one at a time, exactly as
    // approveSession will when the person actually presses approve. Matching
    // role names here instead would let the two disagree.
    if (await canApprove(m.id)) out.push(m);
  }
  return out;
}

// ─── LIST (scope-aware register) ───────────────────────────────────────────

export const listSessions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const where = { tenantId: { in: scope.tenantIds } };
    const page = readPage(req.query as Record<string, unknown>, 200);
    const [sessions, total] = await Promise.all([prisma.impersonationSession.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        subjectUser: { select: { id: true, name: true, email: true, role: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'asc' }],
      skip: page.skip,
      take: page.take,
    }),
    prisma.impersonationSession.count({ where })]);

    // Who can act on each pending row, resolved once per tenant rather than
    // once per session. The register used to say only "awaiting customer",
    // which told the requester nothing about who to chase and gave no sign
    // when the answer was "nobody here can".
    const pendingTenants = [...new Set(
      sessions.filter((s) => s.status === 'PENDING').map((s) => s.tenantId),
    )];
    const approverIndex = new Map<string, Array<{ name: string; email: string; role: string }>>();
    for (const t of pendingTenants) {
      const subjectsHere = sessions
        .filter((s) => s.status === 'PENDING' && s.tenantId === t)
        .map((s) => s.subjectUserId);
      const list = await approversFor(t, null);
      approverIndex.set(t, list
        .filter((a) => !subjectsHere.includes(a.id))
        .map((a) => ({ name: a.name, email: a.email, role: a.role })));
    }

    const now = Date.now();
    res.json({
      status: 'success',
      scope: scope.kind,
      count: sessions.length,
      paging: pageInfo(total, page),
      sessions: sessions.map((s) => ({
        ...s,
        // Derived so the UI never has to recompute expiry logic.
        isLive: s.status === 'ACTIVE' && !!s.expiresAt && s.expiresAt.getTime() > now,
        minutesRemaining: s.status === 'ACTIVE' && s.expiresAt
          ? Math.max(0, Math.round((s.expiresAt.getTime() - now) / 60000))
          : null,
        pendingApprovers: s.status === 'PENDING' ? (approverIndex.get(s.tenantId) ?? []) : null,
      })),
    });
  } catch (error: any) {
    console.error('[Impersonation List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list impersonation sessions' });
  }
};

// ─── REQUEST ───────────────────────────────────────────────────────────────

export const requestSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.impersonation) {
      res.status(403).json({ status: 'error', message: 'Cannot request a session from inside one' });
      return;
    }
    if (!(await canRequest(req.user!.id))) {
      res.status(403).json({ status: 'error', message: 'Your role cannot request impersonation access' });
      return;
    }

    const { subjectUserId, reason, ticketRef, durationMins } = req.body || {};
    if (!subjectUserId || !reason) {
      res.status(400).json({ status: 'error', message: 'subjectUserId and reason are required' });
      return;
    }
    if (String(reason).trim().length < 10) {
      res.status(400).json({ status: 'error', message: 'reason must be at least 10 characters — it is customer-visible evidence' });
      return;
    }

    const subject = await prisma.user.findUnique({
      where: { id: subjectUserId },
      include: { tenant: { select: { id: true, name: true, type: true } } },
    });
    if (!subject) { res.status(404).json({ status: 'error', message: 'Subject user not found' }); return; }
    if (subject.id === req.user!.id) {
      res.status(400).json({ status: 'error', message: 'You cannot impersonate yourself' });
      return;
    }
    if (subject.tenantId === req.user!.tenantId) {
      res.status(400).json({ status: 'error', message: 'Impersonation is for customer tenants, not your own' });
      return;
    }

    const duration = Math.min(
      Math.max(Number(durationMins) || DEFAULT_DURATION_MINS, 5),
      MAX_DURATION_MINS
    );

    // One open request per subject at a time keeps the register unambiguous.
    const open = await prisma.impersonationSession.findFirst({
      where: { subjectUserId, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] } },
    });
    if (open) {
      res.status(409).json({
        status: 'error',
        message: `An open session already exists for this user (status ${open.status})`,
      });
      return;
    }

    // Resolved before the transaction: it is a capability lookup per member of
    // the tenant, and holding a write transaction open across it would lock the
    // session table for as long as the customer has users.
    const approvers = await approversFor(subject.tenantId, subject.id);
    const requesterName = await actorName(req.user!.id, 'A support engineer');

    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.impersonationSession.create({
        data: {
          requestedById: req.user!.id,
          subjectUserId,
          tenantId: subject.tenantId,
          reason: String(reason).trim(),
          ticketRef: ticketRef ? String(ticketRef).trim() : null,
          requestedDurationMins: duration,
          status: 'PENDING',
        },
      });
      // Logged against the CUSTOMER's tenant — they must be able to see it.
      await writeAudit(tx, {
        tenantId: subject.tenantId,
        actorId: req.user!.id,
        action: 'IMPERSONATION_REQUESTED',
        subjectType: SUBJECT,
        subjectId: created.id,
        payload: {
          subjectEmail: subject.email,
          reason,
          ticketRef: ticketRef || null,
          durationMins: duration,
          // Named in the trail as well. "Nobody approved it" and "nobody could
          // have approved it" are different findings and the entry should say
          // which one this was.
          notifiedApprovers: approvers.map((a) => a.email),
        },
      });

      // The request has to REACH somebody. Without this it was written to a
      // register and left to be noticed.
      await notify(tx, approvers.map((a) => ({
        tenantId: subject.tenantId,
        recipientId: a.id,
        actorId: req.user!.id,
        event: 'IMPERSONATION_REQUESTED',
        subjectType: SUBJECT,
        subjectId: created.id,
        title: `Support access requested for ${subject.name}`,
        body: `${requesterName} is asking to view the platform as `
          + `${subject.name} for ${duration} minutes. Reason: ${String(reason).trim()}`,
        link: 'impersonation',
      })));

      return created;
    });

    res.status(201).json({
      status: 'success',
      // Says who, not just that somebody must. A request nobody can approve is
      // reported as such rather than sitting PENDING and looking normal.
      message: approvers.length > 0
        ? `Request submitted. ${approvers.length} administrator(s) at ${subject.tenant.name} `
          + `have been notified: ${approvers.map((a) => a.name).join(', ')}.`
        : `Request submitted, but NOBODY at ${subject.tenant.name} currently holds the `
          + 'capability to approve it. It will stay pending until somebody there is granted '
          + 'Maintain roles and permissions or Add a user.',
      approvers: approvers.map((a) => ({ name: a.name, email: a.email, role: a.role })),
      session,
    });
  } catch (error: any) {
    console.error('[Impersonation Request Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to request session' });
  }
};

// ─── APPROVE (customer-side) ───────────────────────────────────────────────

export const approveSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { note } = req.body || {};

    const session = await prisma.impersonationSession.findUnique({
      where: { id },
      include: { subjectUser: { select: { email: true } } },
    });
    if (!session) { res.status(404).json({ status: 'error', message: 'Session not found' }); return; }
    if (session.status !== 'PENDING') {
      res.status(409).json({ status: 'error', message: `Session is already ${session.status}` });
      return;
    }

    // Authorization must come from inside the target tenant — a platform admin
    // approving their own request would defeat the entire control.
    if (req.user!.tenantId !== session.tenantId) {
      res.status(403).json({
        status: 'error',
        message: 'Only an administrator within the target tenant can approve this request',
      });
      return;
    }
    if (!(await canApprove(req.user!.id))) {
      res.status(403).json({ status: 'error', message: 'Your role cannot authorize impersonation access' });
      return;
    }
    if (req.user!.id === session.subjectUserId) {
      res.status(403).json({ status: 'error', message: 'The subject of a session cannot approve it' });
      return;
    }

    const approverName = await actorName(req.user!.id, 'An administrator');

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.impersonationSession.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedById: req.user!.id,
          approvedAt: new Date(),
          reviewNote: note ? String(note).trim() : null,
        },
      });
      await writeAudit(tx, {
        tenantId: session.tenantId,
        actorId: req.user!.id,
        action: 'IMPERSONATION_APPROVED',
        subjectType: SUBJECT,
        subjectId: id,
        payload: { subjectEmail: session.subjectUser.email, note: note || null },
      });
      // The requester is in another tenancy and has no reason to keep the
      // register open. Without this they learn they were approved by checking.
      await notify(tx, {
        tenantId: session.tenantId,
        recipientId: session.requestedById,
        actorId: req.user!.id,
        event: 'IMPERSONATION_APPROVED',
        subjectType: SUBJECT,
        subjectId: id,
        title: 'Support access approved',
        body: `${approverName} approved your request to view the `
          + `platform as ${session.subjectUser.email}. You may now start the session.`,
        link: 'impersonation',
      });
      return u;
    });

    res.json({ status: 'success', message: 'Approved. The requester may now start the session.', session: updated });
  } catch (error: any) {
    console.error('[Impersonation Approve Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to approve session' });
  }
};

// ─── DENY (customer-side) ──────────────────────────────────────────────────

export const denySession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { note } = req.body || {};
    if (!note) {
      res.status(400).json({ status: 'error', message: 'A reason is required to deny a request' });
      return;
    }

    const session = await prisma.impersonationSession.findUnique({ where: { id } });
    if (!session) { res.status(404).json({ status: 'error', message: 'Session not found' }); return; }
    if (session.status !== 'PENDING') {
      res.status(409).json({ status: 'error', message: `Session is already ${session.status}` });
      return;
    }
    if (req.user!.tenantId !== session.tenantId || !(await canApprove(req.user!.id))) {
      res.status(403).json({ status: 'error', message: 'Only an administrator within the target tenant can deny this request' });
      return;
    }

    const denierName = await actorName(req.user!.id, 'An administrator');

    await prisma.$transaction(async (tx) => {
      await tx.impersonationSession.update({
        where: { id },
        data: { status: 'DENIED', approvedById: req.user!.id, approvedAt: new Date(), reviewNote: String(note).trim() },
      });
      await writeAudit(tx, {
        tenantId: session.tenantId,
        actorId: req.user!.id,
        action: 'IMPERSONATION_DENIED',
        subjectType: SUBJECT,
        subjectId: id,
        payload: { note },
      });
      // A refusal is the answer most worth delivering. Left unsent, the
      // requester reads a row that stopped saying PENDING and has to work out
      // why on their own.
      await notify(tx, {
        tenantId: session.tenantId,
        recipientId: session.requestedById,
        actorId: req.user!.id,
        event: 'IMPERSONATION_DENIED',
        subjectType: SUBJECT,
        subjectId: id,
        title: 'Support access denied',
        body: `${denierName} declined your request. `
          + `Reason: ${String(note).trim()}`,
        link: 'impersonation',
      });
    });

    res.json({ status: 'success', message: 'Request denied' });
  } catch (error: any) {
    console.error('[Impersonation Deny Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to deny session' });
  }
};

// ─── START — issues the read-only dual-identity token ──────────────────────

export const startSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.impersonation) {
      res.status(403).json({ status: 'error', message: 'Already inside an impersonation session' });
      return;
    }
    const id = req.params.id as string;

    const session = await prisma.impersonationSession.findUnique({
      where: { id },
      include: {
        subjectUser: { select: { id: true, email: true, name: true, role: true, tenantId: true, status: true } },
        tenant: { select: { name: true } },
      },
    });
    if (!session) { res.status(404).json({ status: 'error', message: 'Session not found' }); return; }
    if (session.requestedById !== req.user!.id) {
      res.status(403).json({ status: 'error', message: 'Only the requester can start this session' });
      return;
    }
    if (session.status !== 'APPROVED') {
      res.status(409).json({
        status: 'error',
        message: session.status === 'PENDING'
          ? 'Awaiting customer approval'
          : `Session cannot be started from status ${session.status}`,
      });
      return;
    }
    if (session.subjectUser.status !== 'Active') {
      res.status(409).json({ status: 'error', message: 'Subject user is not active' });
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + session.requestedDurationMins * 60000);

    const actor = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { email: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.impersonationSession.update({
        where: { id },
        data: { status: 'ACTIVE', startedAt: now, expiresAt },
      });
      await writeAudit(tx, {
        tenantId: session.tenantId,
        actorId: req.user!.id,
        action: 'IMPERSONATION_STARTED',
        subjectType: SUBJECT,
        subjectId: id,
        payload: {
          subjectEmail: session.subjectUser.email,
          expiresAt,
          ip: req.ip || 'unknown',
          userAgent: (req.headers['user-agent'] || 'unknown').toString().slice(0, 120),
        },
      });
    });

    // The token's identity IS the subject, so every scoped query returns the
    // customer's exact view. `imp` carries the real operator for enforcement.
    const impersonationToken = jwt.sign(
      {
        id: session.subjectUser.id,
        email: session.subjectUser.email,
        role: session.subjectUser.role,
        tenantId: session.subjectUser.tenantId,
        purpose: 'access',
        imp: { sessionId: id, actorId: req.user!.id, actorEmail: actor?.email || 'unknown' },
      },
      jwtSecret(),
      { expiresIn: `${session.requestedDurationMins}m` }
    );

    res.json({
      status: 'success',
      message: `Read-only session started as ${session.subjectUser.email}. Expires in ${session.requestedDurationMins} minutes.`,
      impersonationToken,
      expiresAt,
      subject: {
        id: session.subjectUser.id,
        name: session.subjectUser.name,
        email: session.subjectUser.email,
        role: session.subjectUser.role,
        tenantName: session.tenant.name,
      },
    });
  } catch (error: any) {
    console.error('[Impersonation Start Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to start session' });
  }
};

// ─── END — called with the operator's own token, not the impersonation one ──

export const endSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body || {};

    const session = await prisma.impersonationSession.findUnique({ where: { id } });
    if (!session) { res.status(404).json({ status: 'error', message: 'Session not found' }); return; }
    if (session.status !== 'ACTIVE') {
      res.status(409).json({ status: 'error', message: `Session is not active (status ${session.status})` });
      return;
    }

    // The operator may end their own; the customer may revoke at any time.
    const isOperator = session.requestedById === req.user!.id;
    const isCustomerAdmin = req.user!.tenantId === session.tenantId && (await canApprove(req.user!.id));
    if (!isOperator && !isCustomerAdmin) {
      res.status(403).json({ status: 'error', message: 'Not authorized to end this session' });
      return;
    }

    const finalStatus = isOperator ? 'COMPLETED' : 'REVOKED';

    await prisma.$transaction(async (tx) => {
      await tx.impersonationSession.update({
        where: { id },
        data: {
          status: finalStatus,
          endedAt: new Date(),
          endedReason: reason ? String(reason).trim() : (isOperator ? 'Ended by operator' : 'Revoked by customer'),
        },
      });
      await writeAudit(tx, {
        tenantId: session.tenantId,
        actorId: req.user!.id,
        action: isOperator ? 'IMPERSONATION_ENDED' : 'IMPERSONATION_REVOKED',
        subjectType: SUBJECT,
        subjectId: id,
        payload: { reason: reason || null, finalStatus },
      });
    });

    res.json({ status: 'success', message: `Session ${finalStatus.toLowerCase()}`, finalStatus });
  } catch (error: any) {
    console.error('[Impersonation End Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to end session' });
  }
};

// ─── WHOAMI — lets the UI render the banner and detect an active session ───

export const currentSession = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user?.impersonation) {
      res.json({ status: 'success', impersonating: false });
      return;
    }
    const session = await prisma.impersonationSession.findUnique({
      where: { id: req.user.impersonation.sessionId },
      include: {
        subjectUser: { select: { name: true, email: true, role: true } },
        tenant: { select: { name: true } },
      },
    });
    res.json({
      status: 'success',
      impersonating: true,
      actorEmail: req.user.impersonation.actorEmail,
      sessionId: req.user.impersonation.sessionId,
      subject: session?.subjectUser || null,
      tenantName: session?.tenant?.name || null,
      expiresAt: session?.expiresAt || null,
      minutesRemaining: session?.expiresAt
        ? Math.max(0, Math.round((session.expiresAt.getTime() - Date.now()) / 60000))
        : null,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to read session state' });
  }
};
