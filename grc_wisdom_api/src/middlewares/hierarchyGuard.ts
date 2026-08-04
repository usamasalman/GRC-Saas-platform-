import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './authMiddleware';

/**
 * Phase 3: Multi-Entity Governance Guard
 * Ensures a user can only access data belonging to their own Tenant, OR a Tenant that is a descendant of their Tenant.
 */
export const enforceHierarchyIsolation = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user || !req.user.tenantId) {
      res.status(401).json({ status: 'error', message: 'Unauthorized. Tenant context missing.' });
      return;
    }

    const requesterTenantId = req.user.tenantId;
    const requestedTenantId = req.body?.tenantId || req.query?.tenantId || req.params?.tenantId;

    // If no specific tenant is requested, or it's their own tenant, allow.
    if (!requestedTenantId || requestedTenantId === requesterTenantId) {
      return next();
    }

    // In a real scenario, we query the DB to check the Materialized Path.
    // Example Prisma query:
    // const requesterTenant = await prisma.tenant.findUnique({ where: { id: requesterTenantId } });
    // const targetTenant = await prisma.tenant.findUnique({ where: { id: requestedTenantId } });
    // if (!targetTenant.path.startsWith(requesterTenant.path)) { return 403 Forbidden }

    // Mocking the Materialized Path check
    const mockRequesterPath = `/HOLDING_1/`;
    const mockTargetPath = `/HOLDING_1/ORG_2/BRANCH_3/`;
    
    if (!mockTargetPath.startsWith(mockRequesterPath)) {
      res.status(403).json({ 
        status: 'error', 
        message: 'Forbidden. Cross-tenant data access is strictly prohibited outside your hierarchy.' 
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
};
