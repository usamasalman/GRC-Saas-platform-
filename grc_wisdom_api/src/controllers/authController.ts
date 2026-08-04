import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { generateMfaSecret, generateQrCodeUrl, verifyMfaToken } from '../utils/mfaUtils';

const JWT_SECRET = process.env.JWT_SECRET as string;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 7;
const MFA_CHALLENGE_TTL = '5m';

// ─── Helpers ────────────────────────────────────────────────────────────────

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueAccessToken(user: { id: string; email: string; role: string; tenantId: string }): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

async function issueRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: { refreshTokenHash: hashRefreshToken(token), refreshTokenExpiresAt: expiresAt },
  });
  return token;
}

function resolvePortal(user: { context: string | null; email: string }): string {
  const ctx = user.context;
  if (ctx === 'GRC Wisdom SaaS Control Plane') return 'saas';
  if (ctx === 'Al Noor Holding Group') return 'holding';
  if (ctx === 'OmniOps') return 'multibranch';
  if (ctx === 'Hayat National Hospital — Madinah') return 'branch';
  if (ctx === 'Global Bank — Information Security') return 'document';
  if (ctx === 'GRC Consulting Partners') return 'partner';
  if (ctx === 'RetailCo Franchise Network') return 'franchise';
  if (user.email === 'marcus.thorne@auditco.com') return 'auditor';
  return 'saas';
}

function toUserResponse(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    tenantName: user.tenant?.name || null,
    mfaEnabled: user.mfaEnabled,
    mustChangePassword: user.mustChangePassword || false,
    portal: resolvePortal(user),
    // Fields the app shell / mock engine render in the sidebar and navbar.
    context: user.context || null,
    branch: user.branch || null,
    department: user.department || null,
    profile: user.profile || null,
  };
}

// ─── Login (bcrypt-verified; MFA gate if enabled) ───────────────────────────

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      res.status(400).json({ status: 'error', message: 'Email and password are required' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
      include: { tenant: true },
    });

    if (!user || !user.passwordHash) {
      res.status(401).json({ status: 'error', message: 'Invalid credentials' });
      return;
    }

    const passwordMatches = await bcrypt.compare(String(password), user.passwordHash);
    if (!passwordMatches) {
      res.status(401).json({ status: 'error', message: 'Invalid credentials' });
      return;
    }

    // If MFA is enabled, issue a short-lived challenge token instead of a full session.
    if (user.mfaEnabled && user.mfaSecret) {
      const mfaToken = jwt.sign(
        { id: user.id, purpose: 'mfa_challenge' },
        JWT_SECRET,
        { expiresIn: MFA_CHALLENGE_TTL }
      );
      res.json({ status: 'mfa_required', mfaToken });
      return;
    }

    const token = issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);

    res.json({ status: 'success', token, refreshToken, user: toUserResponse(user) });
  } catch (error: any) {
    console.error('[Auth Error]:', error);
    res.status(500).json({ status: 'error', message: 'Internal authentication server error' });
  }
};

// ─── MFA Challenge Verification (completes login when MFA is enabled) ───────

export const mfaChallenge = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mfaToken, token: totp } = req.body || {};
    if (!mfaToken || !totp) {
      res.status(400).json({ status: 'error', message: 'mfaToken and token are required' });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(mfaToken, JWT_SECRET);
    } catch {
      res.status(401).json({ status: 'error', message: 'MFA challenge expired. Please login again.' });
      return;
    }

    if (decoded.purpose !== 'mfa_challenge') {
      res.status(401).json({ status: 'error', message: 'Invalid MFA token' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { tenant: true },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      res.status(401).json({ status: 'error', message: 'MFA is not enabled for this account' });
      return;
    }

    if (!verifyMfaToken(String(totp), user.mfaSecret)) {
      res.status(401).json({ status: 'error', message: 'Invalid MFA code' });
      return;
    }

    const accessToken = issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);
    res.json({ status: 'success', token: accessToken, refreshToken, user: toUserResponse(user) });
  } catch (error: any) {
    console.error('[MFA Challenge Error]:', error);
    res.status(500).json({ status: 'error', message: 'MFA verification failed' });
  }
};

// ─── Refresh Token (rotates refresh + issues new access) ────────────────────

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      res.status(400).json({ status: 'error', message: 'refreshToken is required' });
      return;
    }

    const tokenHash = hashRefreshToken(String(refreshToken));
    const user = await prisma.user.findFirst({
      where: { refreshTokenHash: tokenHash },
      include: { tenant: true },
    });

    if (!user || !user.refreshTokenExpiresAt || user.refreshTokenExpiresAt < new Date()) {
      res.status(401).json({ status: 'error', message: 'Refresh token invalid or expired' });
      return;
    }

    // Rotate: issue new access + new refresh, invalidate old refresh atomically.
    const newAccess = issueAccessToken(user);
    const newRefresh = await issueRefreshToken(user.id);
    res.json({ status: 'success', token: newAccess, refreshToken: newRefresh });
  } catch (error: any) {
    console.error('[Refresh Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to refresh token' });
  }
};

// ─── Logout (invalidate refresh token) ──────────────────────────────────────

export const logout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
      });
    }
    res.json({ status: 'success', message: 'Logged out' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to logout' });
  }
};

// ─── Register (admin-invited only per TRD §8.2 — this creates the *first* admin) ──

export const registerAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, name, password, tenantName } = req.body || {};
    if (!email || !name || !password) {
      res.status(400).json({ status: 'error', message: 'email, name, and password are required' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) {
      res.status(409).json({ status: 'error', message: 'A user with this email already exists' });
      return;
    }

    let tenant = await prisma.tenant.findFirst();
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { name: tenantName || 'New Organization', type: 'Enterprise', path: '/' },
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        name,
        passwordHash,
        tenantId: tenant.id,
        role: 'Tenant Admin',
        context: tenant.name,
        status: 'Active',
      },
      include: { tenant: true },
    });

    const token = issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);
    res.status(201).json({ status: 'success', token, refreshToken, user: toUserResponse(user) });
  } catch (error: any) {
    console.error('[Register Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to register admin' });
  }
};

// ─── Current user ───────────────────────────────────────────────────────────

export const me = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!user) {
      res.status(404).json({ status: 'error', message: 'User not found' });
      return;
    }

    res.json({ status: 'success', user: toUserResponse(user) });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch user profile' });
  }
};

export const getMe = me;

// ─── MFA Setup (generate secret + QR; stored disabled until verified) ───────

export const setupMfa = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ status: 'error', message: 'User not found' });
      return;
    }

    const { secret, otpauthUrl } = generateMfaSecret(user.email);
    const qrDataUrl = await generateQrCodeUrl(otpauthUrl);

    await prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: secret, mfaEnabled: false },
    });

    res.json({ status: 'success', secret, otpauthUrl, qrDataUrl });
  } catch (error: any) {
    console.error('[MFA Setup Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to setup MFA' });
  }
};

// ─── MFA Verify (activates MFA once the user proves possession of the secret) ──

export const verifyMfa = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { token } = req.body || {};
    if (!token) {
      res.status(400).json({ status: 'error', message: 'token is required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecret) {
      res.status(400).json({ status: 'error', message: 'MFA setup has not been initiated' });
      return;
    }

    if (!verifyMfaToken(String(token), user.mfaSecret)) {
      res.status(401).json({ status: 'error', message: 'Invalid MFA code' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true },
    });

    res.json({ status: 'success', message: 'MFA enabled successfully' });
  } catch (error: any) {
    console.error('[MFA Verify Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to verify MFA' });
  }
};

// ─── Change password (authenticated user) ──────────────────────────────────

export const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      res.status(400).json({ status: 'error', message: 'currentPassword and newPassword are required' });
      return;
    }
    if (String(newPassword).length < 8) {
      res.status(400).json({ status: 'error', message: 'New password must be at least 8 characters' });
      return;
    }
    if (currentPassword === newPassword) {
      res.status(400).json({ status: 'error', message: 'New password must differ from current password' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) { res.status(404).json({ status: 'error', message: 'User not found' }); return; }

    const ok = await bcrypt.compare(String(currentPassword), user.passwordHash).catch(() => false);
    if (!ok) {
      res.status(401).json({ status: 'error', message: 'Current password is incorrect' });
      return;
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
        refreshTokenHash: null,       // force re-login on other sessions
        refreshTokenExpiresAt: null,
      },
    });

    res.json({ status: 'success', message: 'Password changed. Existing sessions have been invalidated.' });
  } catch (error: any) {
    console.error('[Change Password Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to change password' });
  }
};

// ─── Public demo-identity list (safe fields only — no hashes) ──────────────

export const listDemoIdentities = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { status: 'Active' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        context: true,
        branch: true,
        department: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ status: 'success', count: users.length, users });
  } catch (error: any) {
    console.error('[Demo Identities Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list demo identities' });
  }
};

// ─── Tenant user directory (for approver dropdowns) ─────────────────────────

export const listTenantUsers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const users = await prisma.user.findMany({
      where: { tenantId, status: 'Active' },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    res.json({ status: 'success', users });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to fetch tenant users' });
  }
};
