import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, StaleTenantError } from '../services/scopeResolver';
import { planSuspension, SuspensionTenant } from '../services/tenantSuspension';

/**
 * Suspending and reactivating an organisation.
 *
 * Before this the only way to stop a customer using the platform was to delete
 * their tenant, and deletion refuses while the tenant holds users, documents or
 * invoices — which every real customer does. The available answers were
 * "fully operational" and "impossible".
 *
 * The decision is planSuspension, which is pure and pinned without a database.
 * This loads rows, calls it, writes what it says, and audits each affected
 * organisation in its own chain.
 */

const SUBJECT_TENANT = 'Tenant';

async function loadScope(req: AuthenticatedRequest) {
  const scope = await resolveTenantScope(req.user!);
  const inScope = await prisma.tenant.findMany({
    where: { id: { in: scope.tenantIds } },
    select: {
      id: true, name: true, path: true, type: true,
      suspendedAt: true, suspendedRootId: true,
    },
  });
  return { scope, inScope: inScope as SuspensionTenant[] };
}

async function apply(
  req: AuthenticatedRequest,
  res: Response,
  mode: 'suspend' | 'reactivate',
): Promise<void> {
  const targetId = String(req.params.id || '');
  const reason = String(req.body?.reason || '').trim();

  const { inScope } = await loadScope(req);
  const target = inScope.find((t) => t.id === targetId) || null;

  const plan = planSuspension({
    mode,
    target,
    inScope,
    actorTenantId: req.user!.tenantId,
  });
  if (!plan.ok) {
    res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
    return;
  }

  const ids = plan.affected.map((t) => t.id);

  // One transaction: a half-applied cascade leaves an operating branch inside a
  // suspended group, which is the exact state the cascade exists to prevent.
  // Unlike the enablement fan-out, these rows are one customer's own subtree,
  // so there is no case where one entity's failure should leave another's
  // change standing.
  await prisma.$transaction(async (tx) => {
    if (mode === 'suspend') {
      await tx.tenant.updateMany({
        where: { id: { in: ids } },
        data: {
          suspendedAt: new Date(),
          suspendedRootId: plan.rootId,
          suspendedReason: reason || null,
        },
      });
    } else {
      await tx.tenant.updateMany({
        where: { id: { in: ids } },
        data: { suspendedAt: null, suspendedRootId: null, suspendedReason: null },
      });
    }

    // One row per affected organisation, in that organisation's own chain.
    // A customer reading their own trail has to be able to see this; a single
    // row in the operator's tenant would be invisible to exactly the people it
    // happened to.
    for (const t of plan.affected) {
      await writeAudit(tx, {
        tenantId: t.id,
        actorId: req.user!.id,
        action: mode === 'suspend' ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED',
        subjectType: SUBJECT_TENANT,
        subjectId: t.id,
        payload: {
          name: t.name,
          rootId: plan.rootId,
          rootName: plan.rootName,
          direct: t.id === plan.rootId,
          reason: mode === 'suspend' ? (reason || null) : null,
        },
      });
    }
  });

  const cascaded = plan.affected.length - 1;
  res.json({
    status: 'success',
    message: mode === 'suspend'
      ? `${plan.rootName} suspended${cascaded > 0 ? `, along with ${cascaded} entit${cascaded === 1 ? 'y' : 'ies'} beneath it` : ''}.`
      : `${plan.rootName} reactivated${cascaded > 0 ? `, along with ${cascaded} entit${cascaded === 1 ? 'y' : 'ies'} beneath it` : ''}.`,
    affected: plan.affected,
  });
}

export const suspendTenant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await apply(req, res, 'suspend');
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Suspend Tenant Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to suspend the organisation' });
  }
};

export const reactivateTenant = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await apply(req, res, 'reactivate');
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Reactivate Tenant Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reactivate the organisation' });
  }
};
