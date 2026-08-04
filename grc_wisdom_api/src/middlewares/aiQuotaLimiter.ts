import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';

// Mock in-memory store for AI query counts
const tenantAiQueries = new Map<string, number>();

/**
 * Middleware that limits how many AI/LLM queries a Tenant can make per month
 * based on their Commercial Plan.
 */
export const aiQuotaLimiter = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    
    if (!tenantId) {
      res.status(401).json({ status: 'error', message: 'Unauthorized. Tenant context missing.' });
      return;
    }

    // In reality, fetch the tenant's current plan and usage from Prisma
    // const usage = await prisma.aiUsage.findUnique({ where: { tenantId }});
    // const plan = await prisma.subscription.findFirst({ where: { tenantId, status: 'ACTIVE' }, include: { plan: true }});
    
    const allowedLimit = 500; // Mock limit from plan
    const currentUsage = tenantAiQueries.get(tenantId) || 0;

    if (currentUsage >= allowedLimit) {
      res.status(429).json({ 
        status: 'error', 
        message: 'AI Quota Exceeded. Please upgrade your commercial plan to ask more questions.' 
      });
      return;
    }

    // Increment usage
    tenantAiQueries.set(tenantId, currentUsage + 1);

    next();
  } catch (error) {
    next(error);
  }
};
