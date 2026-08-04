import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { hasCapability, CAP } from '../services/capabilityEngine';

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

// ─── LIST (scope-aware register) ───────────────────────────────────────────

export const listSessions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const sessions = await prisma.impersonationSession.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        requestedBy: { select: { id: true, name: true, email: true, role: true } },
        subjectUser: { select: { id: true, name: true, email: true, role: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });

    const now = Date.now();
    res.json({
      status: 'success',
      scope: scope.kind,
      count: sessions.length,
      sessions: sessions.map((s) => ({
        ...s,
        // Derived so the UI never has to recompute expiry logic.
        isLive: s.status === 'ACTIVE' && !!s.expiresAt && s.expiresAt.getTime() > now,
        minutesRemaining: s.status === 'ACTIVE' && s.expiresAt
          ? Math.max(0, Math.round((s.expiresAt.getTime() - now) / 60000))
          : null,
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
        payload: { subjectEmail: subject.email, reason, ticketRef: ticketRef || null, durationMins: duration },
      });
      return created;
    });

    res.status(201).json({
      status: 'success',
      message: `Request submitted. An administrator at ${subject.tenant.name} must approve it.`,
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
