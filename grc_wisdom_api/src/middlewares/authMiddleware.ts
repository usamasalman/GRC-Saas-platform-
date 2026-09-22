import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Extend Express Request type to include the authenticated user payload
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
    /**
     * Present only inside a read-only impersonation session. `user.id` is the
     * *subject* (customer user) so existing scoped queries return their view,
     * while this records who is really driving.
     */
    impersonation?: {
      sessionId: string;
      actorId: string;
      actorEmail: string;
    };
  };
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ status: 'error', message: 'Authentication required. No token provided.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error('[Error]: JWT_SECRET is not defined in environment variables.');
      res.status(500).json({ status: 'error', message: 'Internal Server Error' });
      return;
    }

    const decoded = jwt.verify(token, secret) as any;

    req.user = {
      id: decoded.id,
      tenantId: decoded.tenantId,
      role: decoded.role,
    };

    // ── The token names an organisation that still has to exist ────────────
    //
    // Checked here rather than left to each controller, because the failure it
    // catches is silent everywhere else: a token whose tenant is gone resolves
    // to a scope over a dead id, every list filters to nothing, and the caller
    // gets 200 with an empty array on every screen. That is indistinguishable
    // from having lost all their data, and it is the exact symptom reported
    // after the old container start-up wiped and reseeded the database.
    //
    // One indexed lookup on a primary key, once per request, to turn a silent
    // wrong answer into a 401 that tells the user what to do about it.
    {
      const { prisma } = await import('../db');
      const [tenant, actor] = await Promise.all([
        prisma.tenant.findUnique({
          where: { id: String(decoded.tenantId) },
          select: { id: true, suspendedAt: true, suspendedReason: true },
        }),
        // ── The account itself ──────────────────────────────────────────────
        //
        // User.status was read by nothing in the auth path: login never
        // consulted it, this middleware never loaded the User row, and refresh
        // checked only the token. So suspending somebody, or marking them
        // Inactive, did not stop them working -- they kept full access until
        // their access token expired, and a suspension that clears the refresh
        // token still leaves fifteen minutes.
        //
        // Offboarding is what forced the issue: ending a leaver's access is
        // the whole point, and it cannot be done by a status column nothing
        // reads. One indexed primary-key lookup, alongside the tenant one that
        // was already here.
        prisma.user.findUnique({
          where: { id: String(decoded.userId ?? decoded.id ?? '') },
          select: { status: true },
        }),
      ]);

      // Refused only on a status this deliberately blocks. An account whose
      // row could not be read at all falls through to the tenant checks below
      // rather than locking every user out of a working system over a
      // transient database error -- the same call this file already makes for
      // rejectIfMustChangePassword.
      if (actor && (actor.status === 'Suspended' || actor.status === 'Inactive')) {
        res.status(403).json({
          status: 'error',
          code: actor.status === 'Inactive' ? 'ACCOUNT_CLOSED' : 'ACCOUNT_SUSPENDED',
          message: actor.status === 'Inactive'
            ? 'This account has been closed. Its work was handed over to somebody else.'
            : 'This account is suspended. Speak to an administrator.',
        });
        return;
      }
      if (!tenant) {
        res.status(401).json({
          status: 'error',
          code: 'STALE_TENANT',
          message: 'Your session refers to an organisation that no longer exists. '
            + 'Sign in again.',
        });
        return;
      }

      // ── Suspension, enforced here and only here ─────────────────────────
      //
      // One place, for the same reason the stale-tenant check is one place: a
      // suspension enforced route by route is a suspension that the next route
      // added will not have. Every authenticated request already pays for this
      // lookup; the two extra columns are free.
      //
      // 403 and not 401: the credential is perfectly good, and telling the
      // browser to clear it and sign in again would send the user round a loop
      // that ends at the same refusal with less information. The reason is
      // included because "contact your administrator" is useless to someone who
      // does not know what happened.
      if (tenant.suspendedAt) {
        const { suspensionMessage } = await import('../services/tenantSuspension');
        res.status(403).json({
          status: 'error',
          code: 'TENANT_SUSPENDED',
          message: suspensionMessage(tenant.suspendedReason),
        });
        return;
      }
    }

    // ── Impersonation: validate live, then hard-block every write ──────────
    // Enforced here rather than per-route so a new route cannot forget it.
    if (decoded.imp) {
      const { prisma } = await import('../db');
      const session = await prisma.impersonationSession.findUnique({
        where: { id: decoded.imp.sessionId },
        select: { status: true, expiresAt: true, subjectUserId: true },
      });

      if (!session || session.status !== 'ACTIVE') {
        res.status(401).json({
          status: 'error',
          code: 'IMPERSONATION_NOT_ACTIVE',
          message: 'This impersonation session is no longer active.',
        });
        return;
      }
      if (!session.expiresAt || session.expiresAt < new Date()) {
        // Flip to EXPIRED so the register reflects reality without a cron job.
        await prisma.impersonationSession.update({
          where: { id: decoded.imp.sessionId },
          data: { status: 'EXPIRED', endedAt: new Date(), endedReason: 'Time limit reached' },
        }).catch(() => undefined);
        res.status(401).json({
          status: 'error',
          code: 'IMPERSONATION_EXPIRED',
          message: 'This impersonation session has expired.',
        });
        return;
      }
      if (session.subjectUserId !== decoded.id) {
        res.status(401).json({ status: 'error', message: 'Impersonation token does not match its session.' });
        return;
      }

      if (WRITE_METHODS.has(req.method)) {
        res.status(403).json({
          status: 'error',
          code: 'IMPERSONATION_READ_ONLY',
          message: 'Impersonation sessions are read-only. Exit the session to make changes as yourself.',
        });
        return;
      }

      req.user.impersonation = {
        sessionId: decoded.imp.sessionId,
        actorId: decoded.imp.actorId,
        actorEmail: decoded.imp.actorEmail,
      };
    }

    next();
  } catch (error) {
    console.error('[Auth Error]:', error);
    res.status(401).json({ status: 'error', message: 'Invalid or expired token.' });
  }
};

/**
 * Middleware to enforce tenant isolation.
 * Ensures that if a user tries to pass a tenant_id in a body or query,
 * it absolutely matches the tenant_id cryptographically verified in their JWT.
 */
/**
 * Blocks any authenticated action when the user has an outstanding forced
 * password change. Excluded routes: /api/auth/change-password, /api/auth/logout,
 * /api/auth/me (mounted separately so this middleware doesn't apply to them).
 *
 * Callers add this AFTER requireAuth on any protected route they want gated.
 */
export const rejectIfMustChangePassword = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user?.id) { next(); return; }
    // Lazy import to avoid a middleware ↔ db.ts cycle at module init.
    const { prisma } = await import('../db');
    const u = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { mustChangePassword: true },
    });
    if (u?.mustChangePassword) {
      res.status(428).json({
        status: 'error',
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your password before performing this action.',
      });
      return;
    }
    next();
  } catch {
    // Fail open on lookup errors — the login already validated identity.
    next();
  }
};

export const enforceTenantIsolation = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  if (!req.user || !req.user.tenantId) {
    res.status(401).json({ status: 'error', message: 'Unauthorized. Tenant context missing.' });
    return;
  }

  // If the request contains a tenantId parameter, ensure it matches the user's authorized tenant.
  const requestedTenantId = req.body?.tenantId || req.query?.tenantId || req.params?.tenantId;
  
  if (requestedTenantId && requestedTenantId !== req.user.tenantId) {
    res.status(403).json({ 
      status: 'error', 
      message: 'Forbidden. Cross-tenant data access is strictly prohibited.' 
    });
    return;
  }

  next();
};

/**
 * Restricts a route to the platform operator's own tenants.
 *
 * Capability alone is not a sufficient gate for tooling that bypasses the
 * tenant scope resolver — the database console reads and writes every table
 * directly, so a customer-side role that acquires the capability by any means
 * would otherwise reach every tenant's data.
 */
export const requirePlatformTenant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.user?.tenantId) {
      res.status(401).json({ status: 'error', message: 'Authentication required' });
      return;
    }
    // Lazy import, matching the rest of this file — avoids a middleware ↔ db cycle.
    const { prisma } = await import('../db');
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { type: true },
    });
    if (!tenant || (tenant.type !== 'SAAS' && tenant.type !== 'SAAS_UNIT')) {
      res.status(403).json({
        status: 'error',
        code: 'PLATFORM_ONLY',
        message: 'This is a platform operations tool and is not available to tenant accounts.',
      });
      return;
    }
    next();
  } catch {
    res.status(500).json({ status: 'error', message: 'Authorization check failed' });
  }
};
