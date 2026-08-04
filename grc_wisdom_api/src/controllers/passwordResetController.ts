import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

const BCRYPT_ROUNDS = 10;
const RESET_CODE_TTL_HOURS = 24;

/** Human-readable 8-char code: base32-ish, no 0/O/1/I confusion. */
function generateResetCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join('');
}

// ─── PUBLIC: user requests a reset ────────────────────────────────────────

export const requestReset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body || {};
    if (!email) {
      res.status(400).json({ status: 'error', message: 'Email is required' });
      return;
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { email: cleanEmail } });

    // Do not leak whether the email exists. Only create a request if it does.
    if (user) {
      await prisma.$transaction(async (tx) => {
        // Auto-expire any older pending request for the same user.
        await tx.passwordResetRequest.updateMany({
          where: { userId: user.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        const created = await tx.passwordResetRequest.create({
          data: {
            userId: user.id,
            requestedIp: req.ip || null,
            requestedUa: (req.headers['user-agent'] || null)?.toString().slice(0, 250) ?? null,
            status: 'PENDING',
          },
        });
        await writeAudit(tx, {
          tenantId: user.tenantId,
          actorId: user.id,
          action: 'PASSWORD_RESET_REQUESTED',
          subjectType: 'PasswordResetRequest',
          subjectId: created.id,
          payload: { email: cleanEmail },
        });
      });
    }

    res.json({
      status: 'success',
      message: 'If the account exists, an administrator will review your reset request.',
    });
  } catch (error: any) {
    console.error('[Password Reset Request Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit reset request' });
  }
};

// ─── PUBLIC: user completes the reset with the code ────────────────────────

export const completeReset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code, newPassword } = req.body || {};
    if (!email || !code || !newPassword) {
      res.status(400).json({ status: 'error', message: 'email, code, and newPassword are required' });
      return;
    }
    if (String(newPassword).length < 8) {
      res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { email: cleanEmail } });
    if (!user) {
      res.status(401).json({ status: 'error', message: 'Invalid reset code' });
      return;
    }

    const request = await prisma.passwordResetRequest.findFirst({
      where: { userId: user.id, status: 'APPROVED' },
      orderBy: { reviewedAt: 'desc' },
    });
    if (!request || !request.resetCodeHash || !request.resetCodeExpiresAt) {
      res.status(401).json({ status: 'error', message: 'Invalid reset code' });
      return;
    }
    if (request.resetCodeExpiresAt < new Date()) {
      await prisma.passwordResetRequest.update({
        where: { id: request.id },
        data: { status: 'EXPIRED' },
      });
      res.status(401).json({ status: 'error', message: 'Reset code has expired' });
      return;
    }

    const ok = await bcrypt.compare(String(code), request.resetCodeHash).catch(() => false);
    if (!ok) {
      res.status(401).json({ status: 'error', message: 'Invalid reset code' });
      return;
    }

    const newHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          mustChangePassword: false,        // they just chose one
          refreshTokenHash: null,           // invalidate any existing sessions
          refreshTokenExpiresAt: null,
        },
      });
      await tx.passwordResetRequest.update({
        where: { id: request.id },
        data: { status: 'USED', usedAt: new Date() },
      });
      await writeAudit(tx, {
        tenantId: user.tenantId,
        actorId: user.id,
        action: 'PASSWORD_RESET_COMPLETED',
        subjectType: 'PasswordResetRequest',
        subjectId: request.id,
        payload: { email: cleanEmail },
      });
    });

    res.json({ status: 'success', message: 'Password reset. You can now log in.' });
  } catch (error: any) {
    console.error('[Password Reset Complete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reset password' });
  }
};

// ─── ADMIN: list pending + recent requests ─────────────────────────────────

export const listRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const requests = await prisma.passwordResetRequest.findMany({
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
      take: 200,
      include: {
        user: { select: { id: true, email: true, name: true, role: true, tenantId: true } },
      },
    });
    // Never leak resetCodeHash.
    const safe = requests.map(({ resetCodeHash, ...r }) => r);
    res.json({ status: 'success', count: safe.length, requests: safe });
  } catch (error: any) {
    console.error('[Password Reset List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list requests' });
  }
};

// ─── ADMIN: approve — issues a one-time code returned ONCE ─────────────────

export const approveRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user!.id;
    const adminTenantId = req.user!.tenantId;
    const id = req.params.id as string;
    const { note } = req.body || {};

    const request = await prisma.passwordResetRequest.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!request) { res.status(404).json({ status: 'error', message: 'Request not found' }); return; }
    if (request.status !== 'PENDING') {
      res.status(409).json({ status: 'error', message: `Request is already in status "${request.status}"` });
      return;
    }

    const code = generateResetCode();
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_HOURS * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedById: adminId,
          reviewedAt: new Date(),
          reviewNote: note || null,
          resetCodeHash: codeHash,
          resetCodeExpiresAt: expiresAt,
        },
      });
      // Note: we do NOT set mustChangePassword here — the user picks their own
      // password when they call /password-reset/complete, so no forced change
      // is needed. The flag exists for admin-direct resets (see reset-password.ts).
      await writeAudit(tx, {
        tenantId: adminTenantId,
        actorId: adminId,
        action: 'PASSWORD_RESET_APPROVED',
        subjectType: 'PasswordResetRequest',
        subjectId: id,
        payload: { targetUserId: request.userId, targetEmail: request.user.email, expiresAt },
      });
    });

    // Return the raw code ONCE. The admin communicates it to the user out-of-band
    // (in-person, phone, encrypted chat). It is never stored in cleartext.
    res.json({
      status: 'success',
      message: 'Approved. Communicate this code to the user out-of-band; it is shown only once.',
      resetCode: code,
      expiresAt,
    });
  } catch (error: any) {
    console.error('[Password Reset Approve Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to approve request' });
  }
};

// ─── ADMIN: deny ──────────────────────────────────────────────────────────

export const denyRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user!.id;
    const adminTenantId = req.user!.tenantId;
    const id = req.params.id as string;
    const { note } = req.body || {};

    const request = await prisma.passwordResetRequest.findUnique({ where: { id } });
    if (!request) { res.status(404).json({ status: 'error', message: 'Request not found' }); return; }
    if (request.status !== 'PENDING') {
      res.status(409).json({ status: 'error', message: `Request is already in status "${request.status}"` });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetRequest.update({
        where: { id },
        data: {
          status: 'DENIED',
          reviewedById: adminId,
          reviewedAt: new Date(),
          reviewNote: note || null,
        },
      });
      await writeAudit(tx, {
        tenantId: adminTenantId,
        actorId: adminId,
        action: 'PASSWORD_RESET_DENIED',
        subjectType: 'PasswordResetRequest',
        subjectId: id,
        payload: { targetUserId: request.userId, note },
      });
    });

    res.json({ status: 'success', message: 'Request denied' });
  } catch (error: any) {
    console.error('[Password Reset Deny Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to deny request' });
  }
};
