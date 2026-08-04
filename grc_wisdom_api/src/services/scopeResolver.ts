import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';

/**
 * Per-operating-model tenant scope resolution (TRD §2.1).
 *
 * Every list/read endpoint must filter by the tenant IDs this returns rather
 * than hardcoding `where: { tenantId: req.user.tenantId }` — that filter is
 * correct for a single-entity Branch but wrong for the SaaS control plane
 * (which needs break-glass across all customers) and wrong for Holding /
 * Multibranch / Franchise (which need their whole subtree).
 */

export type ScopeKind = 'PLATFORM' | 'SUBTREE' | 'SELF';

export interface TenantScope {
  kind: ScopeKind;
  /** Tenant IDs the caller may read. Empty array means "no restriction" only when kind === 'PLATFORM'. */
  tenantIds: string[];
  /** True when the caller is reading outside their own tenant (break-glass). */
  isCrossTenant: boolean;
  ownTenantId: string;
}

/** Operating-model types that grant platform-wide break-glass. */
const PLATFORM_TYPES = new Set(['SAAS', 'SAAS_UNIT']);

/** Operating-model types whose scope is their own materialized-path subtree. */
const SUBTREE_TYPES = new Set(['HOLDING', 'MULTIBRANCH', 'FRANCHISE', 'PARTNER']);

/**
 * Resolves which tenants the caller may read.
 * Pure lookup — call `auditCrossTenantRead` separately when the result is used.
 */
export async function resolveTenantScope(userTenantId: string): Promise<TenantScope> {
  const own = await prisma.tenant.findUnique({
    where: { id: userTenantId },
    select: { id: true, type: true, path: true },
  });

  if (!own) {
    return { kind: 'SELF', tenantIds: [userTenantId], isCrossTenant: false, ownTenantId: userTenantId };
  }

  if (PLATFORM_TYPES.has(own.type)) {
    const all = await prisma.tenant.findMany({ select: { id: true } });
    return {
      kind: 'PLATFORM',
      tenantIds: all.map((t) => t.id),
      isCrossTenant: all.length > 1,
      ownTenantId: userTenantId,
    };
  }

  if (SUBTREE_TYPES.has(own.type)) {
    // Materialized path makes the subtree a single indexed prefix query.
    const subtree = await prisma.tenant.findMany({
      where: { path: { startsWith: own.path } },
      select: { id: true },
    });
    const ids = subtree.length > 0 ? subtree.map((t) => t.id) : [own.id];
    return {
      kind: 'SUBTREE',
      tenantIds: ids,
      isCrossTenant: ids.length > 1,
      ownTenantId: userTenantId,
    };
  }

  // BRANCH and anything unrecognized: own tenant only, no downward reach.
  return { kind: 'SELF', tenantIds: [own.id], isCrossTenant: false, ownTenantId: userTenantId };
}

/**
 * Prisma `where` fragment for the resolved scope.
 * Use as: `where: { ...tenantWhere(scope), status: 'OPEN' }`
 */
export function tenantWhere(scope: TenantScope): { tenantId?: { in: string[] } } {
  return { tenantId: { in: scope.tenantIds } };
}

/**
 * Records a break-glass read so a customer asking "who looked at our data?"
 * has an answer. Fire-and-forget by design: a logging failure must not block
 * a read, but it is reported loudly.
 */
export async function auditCrossTenantRead(
  scope: TenantScope,
  actorId: string,
  resource: string
): Promise<void> {
  if (scope.kind !== 'PLATFORM' || !scope.isCrossTenant) return;
  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: scope.ownTenantId,
        actorId,
        action: 'PLATFORM_CROSS_TENANT_READ',
        subjectType: 'Tenant',
        subjectId: scope.ownTenantId,
        payload: { resource, tenantCount: scope.tenantIds.length },
      });
    });
  } catch (err) {
    console.error('[CRITICAL] break-glass read could not be audit-logged:', err);
  }
}

/**
 * Guard for writes: confirms a target tenant is inside the caller's scope.
 * Returns false when the write should be rejected with 403.
 */
export function canWriteToTenant(scope: TenantScope, targetTenantId: string): boolean {
  return scope.tenantIds.includes(targetTenantId);
}
