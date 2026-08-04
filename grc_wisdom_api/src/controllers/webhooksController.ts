import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import crypto from 'crypto';

export const registerWebhook = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const { url, events } = req.body;

    if (!tenantId) {
      res.status(401).json({ status: 'error', message: 'Unauthorized' });
      return;
    }

    // 1. Generate a signing secret for HMAC SHA-256
    const secret = crypto.randomBytes(32).toString('hex');

    // 2. Save to DB
    /*
    const newWebhook = await prisma.webhookEndpoint.create({
      data: {
        tenantId,
        url,
        secret,
        events
      }
    });
    */

    res.status(201).json({
      status: 'success',
      message: 'Webhook registered successfully.',
      data: {
        url,
        events,
        signingSecret: secret // Partner must save this to verify incoming payloads
      }
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
