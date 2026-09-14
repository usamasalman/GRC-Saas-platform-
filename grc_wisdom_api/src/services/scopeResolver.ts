import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { CAP, getEffectivePermissions } from './capabilityEngine';

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

/** Operating-model types that can grant platform-wide break-glass. */
const PLATFORM_TYPES = new Set(['SAAS', 'SAAS_UNIT']);

/**
 * The duties that are only meaningful exercised across tenants.
 *
 * Sitting in the platform tenant used to be the whole test, so every user
 * record created there could read every customer's data whatever their job
 * was. That is tracker issue 8: an Engagement Manager asking why he is looking
 * at the issues of clients he has nothing to do with.
 *
 * Each of the seven platform roles holds at least one of these -- tenant
 * administration, roles, flags, modules, the commercial relationship, security,
 * the service desk, the tool marketplace -- so none of them loses anything. A
 * user in the platform tenant holding none of them is not platform staff, and
 * now reads the platform tenant only.
 *
 * This narrows break-glass. It does not narrow anything else: outside a
 * platform tenant the capability is not consulted at all, so a finance manager
 * in a customer organisation keeps exactly the subtree they had.
 */
const PLATFORM_DUTIES: readonly string[] = [
  CAP.MANAGE_TENANT,
  CAP.MAINTAIN_ROLES,
  CAP.GOVERN_FLAG,
  CAP.PUBLISH_MODULE,
  CAP.MANAGE_SUBSCRIPTION,
  CAP.SELECT_PLAN,
  CAP.REVIEW_INVOICE,
  CAP.RECONCILE_PAYMENT,
  CAP.MONITOR_QUOTAS,
  CAP.MONITOR_SECURITY,
  CAP.RESOLVE_TICKETS,
  CAP.ONBOARD_TOOL,
  CAP.OPERATE_SECURITY_SERVICES,
];

/**
 * Who is asking. `req.user` satisfies this as it stands.
 *
 * `capabilities` is optional because almost no caller has them to hand and the
 * answer is only needed inside a platform tenant, which is rare. When it is
 * needed and absent, the grants are read from the database -- the same source
 * requireCapability reads, so the scope and the route guards cannot disagree.
 */
export interface ScopeActor {
  id: string;
  tenantId: string;
  capabilities?: string[] | null;
}

/**
 * Whether this caller's duties justify reading across tenants.
 *
 * Pure, and exported so the decision can be tested against the whole role
 * matrix without a database.
 */
export function hasPlatformDuty(capabilities: readonly string[] | null | undefined): boolean {
  if (!capabilities || capabilities.length === 0) return false;
  return PLATFORM_DUTIES.some((c) => capabilities.includes(c));
}

/** Operating-model types whose scope is their own materialized-path subtree. */
const SUBTREE_TYPES = new Set(['HOLDING', 'MULTIBRANCH', 'FRANCHISE', 'PARTNER']);

/**
 * The caller's token points at a tenant that is not there any more.
 *
 * Distinct from an ordinary authorisation failure because the cause and the
 * remedy are different: nothing is wrong with the credential, the world moved
 * underneath it, and signing in again fixes it.
 */
export class StaleTenantError extends Error {
  readonly tenantId: string;

  constructor(tenantId: string) {
    super('Your session refers to an organisation that no longer exists. Sign in again.');
    this.name = 'StaleTenantError';
    this.tenantId = tenantId;
  }
}

/**
 * Resolves which tenants the caller may read.
 * Pure lookup — call `auditCrossTenantRead` separately when the result is used.
 */
export async function resolveTenantScope(actor: ScopeActor): Promise<TenantScope> {
  const userTenantId = actor.tenantId;
  const own = await prisma.tenant.findUnique({
    where: { id: userTenantId },
    select: { id: true, type: true, path: true },
  });

  if (!own) {
    // A token naming a tenant that no longer exists is not a usable session.
    //
    // Returning SELF scope over the dead id — which this used to do — makes
    // every query filter `tenantId IN [deadId]`, match nothing, and answer 200
    // with an empty list. The user then sees every screen blank and concludes
    // their data was deleted, when in a recoverable case it is sitting intact
    // under a different tenant. Silence is the worst possible answer here: it
    // is indistinguishable from total data loss and it cannot be acted on.
    //
    // Throwing sends a 401 instead, the browser clears the stale token, and
    // signing in again mints one naming a tenant that exists.
    throw new StaleTenantError(userTenantId);
  }

  if (PLATFORM_TYPES.has(own.type)) {
    // Being in the platform tenant is necessary and no longer sufficient. An
    // API key resolves to no user and therefore no duty, which matches what
    // apiKeyGuard already promises: a key acts inside the tenant it was issued
    // for.
    const capabilities = actor.capabilities
      ?? (await getEffectivePermissions(actor.id).catch(() => null))?.capabilities
      ?? null;

    if (hasPlatformDuty(capabilities)) {
      const all = await prisma.tenant.findMany({ select: { id: true } });
      return {
        kind: 'PLATFORM',
        tenantIds: all.map((t) => t.id),
        isCrossTenant: all.length > 1,
        ownTenantId: userTenantId,
      };
    }

    // Platform tenant, no platform duty: the platform's own records and
    // nothing else. Never an empty list -- a scope that matches nothing reads
    // as deleted data, which is the failure StaleTenantError exists to avoid.
    return { kind: 'SELF', tenantIds: [own.id], isCrossTenant: false, ownTenantId: userTenantId };
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
