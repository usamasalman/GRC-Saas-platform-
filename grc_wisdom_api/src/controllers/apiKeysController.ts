import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import crypto from 'crypto';

export const generateApiKey = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const { name, scopes } = req.body;

    if (!tenantId) {
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    // 1. Generate a secure random string for the API Key
    const rawApiKey = `grc_live_${crypto.randomBytes(32).toString('hex')}`;
    
    // 2. Hash it for secure storage (never store raw API keys)
    const keyHash = crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const secretPrefix = rawApiKey.substring(0, 16);

    // 3. Save to DB
    /*
    const newKey = await prisma.apiKey.create({
      data: {
        tenantId,
        name,
        keyHash,
        secretPrefix,
        scopes
      }
    });
    */

    res.status(201).json({
      status: 'success',
      message: 'API Key generated successfully. Please copy it now. It will not be shown again.',
      data: {
        rawApiKey,
        name,
        secretPrefix,
        scopes
      }
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
