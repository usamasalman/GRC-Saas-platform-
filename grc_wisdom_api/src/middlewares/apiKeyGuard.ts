import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';
import crypto from 'crypto';

/**
 * Validates system-to-system Public API requests using the `x-api-key` header.
 * Bypasses standard JWT authentication.
 */
export const apiKeyGuard = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      res.status(401).json({ status: 'error', message: 'Unauthorized. Missing x-api-key header.' });
      return;
    }

    // 1. Hash the provided key to match against DB
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // 2. Query the DB (Mocked here)
    // const keyRecord = await prisma.apiKey.findUnique({ where: { keyHash } });
    
    // MOCK Validation
    const mockKeyHash = crypto.createHash('sha256').update('live_secret_key_12345').digest('hex');
    
    if (keyHash !== mockKeyHash) {
      res.status(401).json({ status: 'error', message: 'Invalid API Key.' });
      return;
    }

    // 3. Check if active and not expired
    // if (!keyRecord.isActive || (keyRecord.expiresAt && keyRecord.expiresAt < new Date())) { return 401 }

    // 4. Inject the API Key's bounded Tenant context into the request
    req.user = {
      id: 'system_api_key',
      tenantId: 'HOLDING_1', // keyRecord.tenantId
      role: 'SYSTEM'
    };

    next();
  } catch (error) {
    next(error);
  }
};
