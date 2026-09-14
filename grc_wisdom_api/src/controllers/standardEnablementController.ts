import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import {
  resolveTenantScope, auditCrossTenantRead, StaleTenantError,
} from '../services/scopeResolver';
import { planEnablement, Pair } from '../services/standardEnablement';

/**
 * Enabling standards across an estate, from the control plane.
 *
 * The owner's complaint was that the SaaS portal "is not interlink and not
 * enable anything from the saas platform like standard enabling from saas to
 * all service or let say all tenants". Single-tenant enablement already worked
 * through POST /standards/enable -- the endpoint has always read an optional
 * tenantId -- but no screen ever sent one, and enabling a framework across
 * forty entities meant forty requests, each of which could fail on its own.
 *
 * These three handlers give the control plane what it was missing: one read
 * that answers "who is assessed against what", and one write each way that
 * takes a set and reports on every member of it.
 *
 * The admission decision is not here. It is planEnablement, which is pure and
 * pinned by scripts/verify/standards-enablement-test.js without a database.
 * What is here is loading rows, calling it, and writing what it says.
 */

/** Tenants and standards the caller may see, loaded once for a request. */
async function loadScope(req: AuthenticatedRequest) {
  const scope = await resolveTenantScope(req.user!);
  const [tenants, standards] = await Promise.all([
    prisma.tenant.findMany({
      where: { id: { in: scope.tenantIds } },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    }),
    prisma.standard.findMany({
      // The same visibility rule listStandards applies: published by the
      // platform, or authored somewhere inside this caller's scope. A private
      // framework belonging to another organisation is not here, so it cannot
      // be named in a plan.
      where: { OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }] },
      select: { id: true, code: true, title: true, version: true, tenantId: true },
      orderBy: { code: 'asc' },
    }),
  ]);
  return { scope, tenants, standards };
}

/**
 * Which entities are assessed against which frameworks.
 *
 * No capability guard, matching every other read in this module: GET
 * /api/grc/standards is unguarded too, and the rows are the same rows. Scope is
 * what limits it, and a platform caller reading across customers is recorded.
 */
export const getEnablementMatrix = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { scope, tenants, standards } = await loadScope(req);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.standards.matrix');

    const enablements = await prisma.tenantStandardEnablement.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      select: { tenantId: true, standardId: true, applicability: true, enabledAt: true },
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      tenants,
      standards,
      // A flat list rather than a matrix of every pairing: forty entities by
      // thirty standards is twelve hundred cells, nearly all of them empty, and
      // the screen builds whichever view it wants from this.
      enablements,
    });
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Enablement Matrix Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the enablement matrix' });
  }
};

/** The pairings among those requested that already exist. */
async function existingPairs(tenantIds: string[], standardIds: string[]) {
  return prisma.tenantStandardEnablement.findMany({
    where: { tenantId: { in: tenantIds }, standardId: { in: standardIds } },
    select: { id: true, tenantId: true, standardId: true },
  });
}

/** Body ids, defensively: a JSON body can carry anything. */
function idsFrom(raw: any): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string' && x.length > 0).map(String);
  if (typeof raw === 'string' && raw) return [raw];
  return [];
}

export const bulkEnableStandards = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantIds = idsFrom(req.body?.tenantIds);
    const standardIds = idsFrom(req.body?.standardIds);
    const { applicability } = req.body || {};

    const { scope, tenants, standards } = await loadScope(req);
    const existing = await existingPairs(tenantIds, standardIds);

    const plan = planEnablement({
      mode: 'enable',
      scopeTenantIds: scope.tenantIds,
      requestedTenantIds: tenantIds,
      requestedStandardIds: standardIds,
      targets: tenants,
      standards,
      existing,
      applicability,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    // One transaction per tenant, not one for the whole batch.
    //
    // The audit chain is per tenant: writeAudit reads that tenant's last hash
    // and writes the next link. Wrapping every tenant in one transaction would
    // mean one entity's failure silently rolls back another entity's committed
    // and audited change, and the operator would be told nothing happened when
    // some of it had. Per-tenant commits make the report accurate.
    const enabled: Pair[] = [];
    const failed: (Pair & { message: string })[] = [];

    const byTenant = new Map<string, Pair[]>();
    for (const p of plan.apply) {
      if (!byTenant.has(p.tenantId)) byTenant.set(p.tenantId, []);
      byTenant.get(p.tenantId)!.push(p);
    }

    for (const [tenantId, pairs] of byTenant) {
      try {
        await prisma.$transaction(async (tx) => {
          for (const p of pairs) {
            await tx.tenantStandardEnablement.create({
              data: {
                tenantId,
                standardId: p.standardId,
                applicability: plan.applicability,
              },
            });
            // Keyed to the target tenant, inside the transaction, field named
            // payload. The customer's own WORM trail is where this belongs;
            // stamping the operator's tenant would make it unreadable from the
            // side that needs it.
            await writeAudit(tx, {
              tenantId,
              actorId: req.user!.id,
              action: 'STANDARD_ENABLED',
              subjectType: 'Standard',
              subjectId: p.standardId,
              payload: { code: p.standardCode, applicability: plan.applicability, batch: true },
            });
          }
        });
        enabled.push(...pairs);
      } catch (err: any) {
        // A pairing created between the plan and the write is the outcome the
        // caller wanted, so it is a skip rather than a failure.
        const message = err?.code === 'P2002'
          ? 'Already enabled'
          : 'Could not be enabled';
        if (err?.code === 'P2002') plan.skip.push(...pairs);
        else failed.push(...pairs.map((p) => ({ ...p, message })));
      }
    }

    res.status(200).json({
      status: 'success',
      counts: { enabled: enabled.length, alreadyEnabled: plan.skip.length, failed: failed.length },
      enabled,
      alreadyEnabled: plan.skip,
      failed,
    });
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Bulk Enable Standards Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to enable standards' });
  }
};

export const bulkDisableStandards = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantIds = idsFrom(req.body?.tenantIds);
    const standardIds = idsFrom(req.body?.standardIds);

    const { scope, tenants, standards } = await loadScope(req);
    const existing = await existingPairs(tenantIds, standardIds);

    const plan = planEnablement({
      mode: 'disable',
      scopeTenantIds: scope.tenantIds,
      requestedTenantIds: tenantIds,
      requestedStandardIds: standardIds,
      targets: tenants,
      standards,
      existing,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const rowId = new Map(existing.map((e) => [`${e.tenantId} ${e.standardId}`, e.id]));
    const disabled: Pair[] = [];
    const failed: (Pair & { message: string })[] = [];

    const byTenant = new Map<string, Pair[]>();
    for (const p of plan.apply) {
      if (!byTenant.has(p.tenantId)) byTenant.set(p.tenantId, []);
      byTenant.get(p.tenantId)!.push(p);
    }

    for (const [tenantId, pairs] of byTenant) {
      try {
        await prisma.$transaction(async (tx) => {
          for (const p of pairs) {
            const id = rowId.get(`${p.tenantId} ${p.standardId}`);
            if (!id) continue;
            await tx.tenantStandardEnablement.delete({ where: { id } });
            await writeAudit(tx, {
              tenantId,
              actorId: req.user!.id,
              action: 'STANDARD_DISABLED',
              subjectType: 'Standard',
              subjectId: p.standardId,
              payload: { code: p.standardCode, batch: true },
            });
          }
        });
        disabled.push(...pairs);
      } catch (err: any) {
        // Someone else disabled it first. The row is gone, which is the
        // outcome asked for.
        if (err?.code === 'P2025') plan.skip.push(...pairs);
        else failed.push(...pairs.map((p) => ({ ...p, message: 'Could not be disabled' })));
      }
    }

    res.status(200).json({
      status: 'success',
      counts: { disabled: disabled.length, notEnabled: plan.skip.length, failed: failed.length },
      disabled,
      notEnabled: plan.skip,
      failed,
    });
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Bulk Disable Standards Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to disable standards' });
  }
};
