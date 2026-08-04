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
