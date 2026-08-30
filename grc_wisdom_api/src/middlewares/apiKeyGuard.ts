import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import crypto from 'crypto';
import { prisma } from '../db';

/**
 * Validates system-to-system Public API requests using the `x-api-key` header.
 *
 * The previous implementation compared the caller's key against a hardcoded
 * constant — 'live_secret_key_12345' — and, on a match, injected
 * `{ role: 'SYSTEM', tenantId: 'HOLDING_1' }`. Anyone who read the repository
 * held a system credential for a fixed tenant. It was mounted on no route,
 * which is the only reason it was not an active breach, but a stub like that
 * becomes one the moment someone wires it up.
 *
 * This validates against the ApiKey table, which already stores a SHA-256
 * keyHash, an isActive flag, an expiry and a tenant.
 */
export const apiKeyGuard = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      res.status(401).json({ status: 'error', message: 'Unauthorized. Missing x-api-key header.' });
      return;
    }

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const record = await prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        tenantId: true,
        isActive: true,
        expiresAt: true,
        scopes: true,
      },
    });

    // One message for absent, revoked and expired keys alike — distinguishing
    // them tells a caller whether a key ever existed.
    if (!record || !record.isActive || (record.expiresAt && record.expiresAt.getTime() < Date.now())) {
      res.status(401).json({ status: 'error', message: 'Invalid API Key.' });
      return;
    }

    // Best-effort usage stamp. A failure here must not reject a valid request.
    prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => { /* not worth failing the request over */ });

    // The tenant comes from the key record, so a key can only ever act inside
    // the tenant it was issued for.
    req.user = {
      id: `api-key:${record.id}`,
      tenantId: record.tenantId,
      role: 'SYSTEM',
    };

    next();
  } catch (error) {
    next(error);
  }
};
