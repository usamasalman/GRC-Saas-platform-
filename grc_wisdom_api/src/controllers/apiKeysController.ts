import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import crypto from 'crypto';
import { prisma } from '../db';

/**
 * Issue an API key for system-to-system access.
 *
 * The persistence step used to be commented out, so this returned a key that
 * was never stored — it told the caller "copy it now, it will not be shown
 * again" and then discarded it, leaving a credential that could never
 * authenticate and never be revoked.
 */
export const generateApiKey = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const { name, scopes, expiresAt } = req.body || {};

    if (!tenantId) {
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({
        status: 'error',
        message: 'A name is required so this key can be identified and revoked later.',
      });
      return;
    }

    // Only the hash is stored. The raw value exists in this response and nowhere else.
    const rawApiKey = `grc_live_${crypto.randomBytes(32).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const secretPrefix = rawApiKey.substring(0, 16);

    const scopeList = Array.isArray(scopes) ? scopes : [];

    const created = await prisma.apiKey.create({
      data: {
        tenantId,
        name: name.trim(),
        keyHash,
        secretPrefix,
        scopes: JSON.stringify(scopeList),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      select: { id: true, name: true, secretPrefix: true, scopes: true, expiresAt: true, createdAt: true },
    });

    res.status(201).json({
      status: 'success',
      message: 'API key created. Copy it now — it is not stored and cannot be shown again.',
      data: { ...created, rawApiKey },
    });
  } catch (error: any) {
    console.error('[API Key Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create API key' });
  }
};

/** Keys for the caller's tenant. Never returns keyHash. */
export const listApiKeys = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    const keys = await prisma.apiKey.findMany({
      where: { tenantId },
      select: {
        id: true, name: true, secretPrefix: true, scopes: true,
        isActive: true, expiresAt: true, lastUsedAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ status: 'success', count: keys.length, keys });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list API keys' });
  }
};

/**
 * Revoke a key.
 *
 * Deactivated rather than deleted so the audit trail still explains what a
 * lastUsedAt timestamp in the logs referred to.
 */
export const revokeApiKey = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const id = String(req.params.id);
    if (!tenantId) {
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    // Scoped by tenantId as well as id, so one tenant cannot revoke another's key.
    const result = await prisma.apiKey.updateMany({
      where: { id, tenantId },
      data: { isActive: false },
    });

    if (result.count === 0) {
      res.status(404).json({ status: 'error', message: 'API key not found' });
      return;
    }

    res.json({ status: 'success', message: 'API key revoked' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to revoke API key' });
  }
};
