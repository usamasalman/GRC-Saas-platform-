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

/**
 * Which navigation set the app shell renders for this user.
 *
 * This used to match on hardcoded demo tenant NAMES ('OmniOps', 'Al Noor
 * Holding Group', ...) and fell through to 'saas'. Once the demo tenants are
 * gone every real customer matched nothing and was handed the platform
 * control-plane navigation. Deriving it from tenant.type is data-driven and
 * survives having no seed data.
 *
 * Note this is navigation only — authorisation is enforced server-side by
 * capability, so a wrong answer here is a confusing menu, not an escalation.
 */
const PORTAL_BY_TENANT_TYPE: Record<string, string> = {
  SAAS: 'saas',
  SAAS_UNIT: 'saas',
  HOLDING: 'holding',
  MULTIBRANCH: 'multibranch',
  BRANCH: 'branch',
  PARTNER: 'partner',
  FRANCHISE: 'franchise',
  AUDITOR: 'auditor',
  DOCUMENT: 'document',
};

function resolvePortal(user: { tenant?: { type?: string | null } | null }): string {
  const type = String(user.tenant?.type || '').toUpperCase();
  // An unrecognised tenant type gets the ordinary organisation workspace, not
  // the control plane. The safe default is the least-privileged menu.
  return PORTAL_BY_TENANT_TYPE[type] || 'multibranch';
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

    // An invitation credential that was never used stops working. Otherwise a
    // temporary password handed out months ago is still a valid way in.
    if (user.mustChangePassword && user.tempPasswordExpiresAt
        && user.tempPasswordExpiresAt.getTime() < Date.now()) {
      res.status(401).json({
        status: 'error',
        code: 'TEMP_CREDENTIAL_EXPIRED',
        message: 'This temporary password has expired. Ask an administrator to reissue your invitation.',
      });
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

/**
 * First-run bootstrap — creates the very first administrator, then disables
 * itself forever.
 *
 * This endpoint is public because it has to be: on a brand-new database there
 * is no account to authenticate as. The previous version was public in a much
 * worse sense — it accepted a registration at any time and attached the new
 * account to `prisma.tenant.findFirst()`, so a stranger could POST an email and
 * a password and become Tenant Admin inside whichever real customer happened to
 * be created first.
 *
 * Two things make this safe now: it refuses once any user exists, and it links
 * the account to the platform-super-admin Role record rather than only setting
 * the role display string (a user with roleId null resolves to an empty
 * capability set and can do nothing).
 */
/**
 * Whether the platform has been initialised yet.
 *
 * Public by necessity — the login screen has to know whether to offer sign-in
 * or first-run setup before anyone can authenticate. It returns a single
 * boolean and nothing else: no counts, no emails, no tenant names. Once
 * initialised it stays true forever, so it discloses nothing an attacker could
 * not learn by simply loading the login page.
 */
export const bootstrapStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    const userCount = await prisma.user.count();
    res.json({ status: 'success', initialised: userCount > 0 });
  } catch {
    // Fail closed: if we cannot tell, do not invite anyone into setup.
    res.status(503).json({ status: 'error', initialised: true, message: 'Service unavailable' });
  }
};

export const registerAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    // The gate. Not "no admins" — no users at all. Anything else lets someone
    // race a real deployment during the window before the owner signs in.
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      res.status(403).json({
        status: 'error',
        code: 'BOOTSTRAP_CLOSED',
        message: 'This platform is already initialised. Ask an administrator for an account.',
      });
      return;
    }

    const { email, name, password, tenantName } = req.body || {};
    if (!email || !name || !password) {
      res.status(400).json({ status: 'error', message: 'email, name, and password are required' });
      return;
    }

    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      res.status(400).json({ status: 'error', message: 'Enter a valid email address' });
      return;
    }

    // The first account on the platform is the one worth protecting most.
    const pw = String(password);
    if (pw.length < 12) {
      res.status(400).json({
        status: 'error',
        code: 'WEAK_PASSWORD',
        message: 'The first administrator password must be at least 12 characters.',
      });
      return;
    }

    const role = await prisma.role.findFirst({
      where: { key: 'platform-super-admin', tenantId: null },
      select: { id: true, name: true },
    });
    if (!role) {
      // Reference data has not been provisioned, so any account created here
      // would have no capabilities. Say so plainly rather than making an
      // account that appears to work and then denies every action.
      res.status(503).json({
        status: 'error',
        code: 'NOT_PROVISIONED',
        message: 'Platform roles are not provisioned yet. Run "npm run provision" on the server first.',
      });
      return;
    }

    const tenant = await prisma.tenant.findFirst({ where: { type: { in: ['SAAS', 'SAAS_UNIT'] } } })
      ?? await prisma.tenant.create({
        data: { name: tenantName || 'GRC Wisdom Control Plane', type: 'SAAS', path: '/' },
      });

    const passwordHash = await bcrypt.hash(pw, 12);
    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        name,
        passwordHash,
        tenantId: tenant.id,
        role: role.name,
        roleId: role.id,
        context: tenant.name,
        profile: 'Platform Owner',
        status: 'Active',
      },
      include: { tenant: true },
    });

    console.log(`[Bootstrap]: first administrator created (${cleanEmail}). Endpoint now closed.`);

    const token = issueAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);
    res.status(201).json({ status: 'success', token, refreshToken, user: toUserResponse(user) });
  } catch (error: any) {
    console.error('[Bootstrap Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create the first administrator' });
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
