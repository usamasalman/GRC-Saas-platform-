import { Response, NextFunction } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';

/**
 * RBAC capability engine (TRD §3.1).
 *
 * Replaces ad-hoc `role.includes('admin')` string matching. A permission check
 * is two independent questions:
 *   1. does the user's Role grant this capability?   ← this file
 *   2. is the target record inside their scope?      ← services/scopeResolver
 *
 * Fail-closed: a user with no Role row, or an unknown capability, is denied.
 */

export class CapabilityDenied extends Error {
  readonly httpStatus = 403;
  readonly code = 'CAPABILITY_DENIED';
  constructor(public readonly capability: string, public readonly roleName: string) {
    super(`Your role "${roleName}" does not grant the capability "${capability}".`);
    this.name = 'CapabilityDenied';
  }
}

/** Canonical capability keys referenced from application code. */
export const CAP = {
  MANAGE_TENANT: 'create-or-manage-a-tenant',
  ADD_USER: 'add-a-user-with-role-based-access',
  MAINTAIN_ROLES: 'maintain-roles-and-permissions',
  TRANSFER_USER: 'transfer-a-user-between-branches-or-entities',
  MONITOR_SECURITY: 'monitor-security-and-handle-incidents',
  GOVERN_FLAG: 'govern-a-feature-flag',
  PUBLISH_MODULE: 'publish-or-enable-a-module',
  MANAGE_SUBSCRIPTION: 'manage-a-subscription',
  SELECT_PLAN: 'create-or-select-a-commercial-plan',
  REVIEW_INVOICE: 'generate-or-review-an-invoice',
  RECONCILE_PAYMENT: 'record-and-reconcile-a-payment',
  MONITOR_QUOTAS: 'monitor-resource-usage-and-quotas',
  MANAGE_IMPLEMENTATION: 'manage-a-control-implementation-and-evidence',
  ENABLE_STANDARD: 'import-or-enable-a-standard',
  ASSESS_RISK: 'assess-and-treat-a-risk',
  EXECUTE_AUDIT: 'plan-and-execute-an-audit',
  ASSESS_VENDOR: 'assess-and-remediate-a-vendor',
  MAINTAIN_ASSET: 'maintain-an-asset',
  VERSION_DOCUMENT: 'create-import-and-version-a-document',
  SIGN_DOCUMENT: 'review-approve-and-digitally-sign-a-document',
  RETENTION_HOLD: 'apply-retention-and-legal-hold',
  RESOLVE_TICKETS: 'manage-and-resolve-support-tickets',
  CREATE_TICKET: 'create-an-itsm-ticket',
  REPORT: 'generate-and-distribute-a-report',
  OPERATE_SECURITY_SERVICES: 'operate-wisdom-eye-and-eye-phish',
  ONBOARD_TOOL: 'onboard-or-purchase-an-open-source-tool',
} as const;

export interface EffectivePermissions {
  userId: string;
  roleId: string | null;
  roleName: string;
  roleKey: string | null;
  isSystemRole: boolean;
  capabilities: string[];
}

function parseGrants(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Resolves a user's effective capability set from their linked Role.
 * Users with no `roleId` resolve to an empty grant list (fail-closed).
 */
export async function getEffectivePermissions(userId: string): Promise<EffectivePermissions> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      roleId: true,
      roleRef: { select: { id: true, key: true, name: true, capabilityGrants: true, isSystem: true } },
    },
  });

  if (!user) {
    return { userId, roleId: null, roleName: 'unknown', roleKey: null, isSystemRole: false, capabilities: [] };
  }
  if (!user.roleRef) {
    return { userId, roleId: null, roleName: user.role, roleKey: null, isSystemRole: false, capabilities: [] };
  }

  return {
    userId,
    roleId: user.roleRef.id,
    roleName: user.roleRef.name,
    roleKey: user.roleRef.key,
    isSystemRole: user.roleRef.isSystem,
    capabilities: parseGrants(user.roleRef.capabilityGrants),
  };
}

/** Direct check, for use inside a controller that already loaded the user. */
export async function hasCapability(userId: string, capability: string): Promise<boolean> {
  const eff = await getEffectivePermissions(userId);
  return eff.capabilities.includes(capability);
}

/**
 * As above for a set of alternatives, in one permission load rather than one
 * per capability. Used where authorisation is primarily by record ownership
 * and a capability is only the fallback route in.
 */
export async function hasAnyCapability(userId: string, capabilities: string[]): Promise<boolean> {
  const eff = await getEffectivePermissions(userId);
  return capabilities.some((c) => eff.capabilities.includes(c));
}

/**
 * Route middleware. Place after requireAuth:
 *   router.post('/', requireCapability(CAP.MANAGE_TENANT), createTenant)
 *
 * Note: an impersonated caller can never reach a write route — requireAuth
 * rejects those first — so this needs no impersonation special-casing.
 */
export function requireCapability(capability: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        res.status(401).json({ status: 'error', message: 'Authentication required' });
        return;
      }
      const eff = await getEffectivePermissions(req.user.id);
      if (!eff.capabilities.includes(capability)) {
        res.status(403).json({
          status: 'error',
          code: 'CAPABILITY_DENIED',
          capability,
          role: eff.roleName,
          message: eff.roleId
            ? `Your role "${eff.roleName}" does not grant "${capability}".`
            : `No role is assigned to your account, so no capabilities are granted.`,
        });
        return;
      }
      next();
    } catch (err) {
      console.error('[Capability Check Error]:', err);
      res.status(500).json({ status: 'error', message: 'Permission check failed' });
    }
  };
}

/** Any-of variant for endpoints reachable by several distinct roles. */
export function requireAnyCapability(...capabilities: string[]) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        res.status(401).json({ status: 'error', message: 'Authentication required' });
        return;
      }
      const eff = await getEffectivePermissions(req.user.id);
      if (!capabilities.some((c) => eff.capabilities.includes(c))) {
        res.status(403).json({
          status: 'error',
          code: 'CAPABILITY_DENIED',
          capability: capabilities.join(' | '),
          role: eff.roleName,
          message: `Your role "${eff.roleName}" grants none of: ${capabilities.join(', ')}.`,
        });
        return;
      }
      next();
    } catch (err) {
      console.error('[Capability Check Error]:', err);
      res.status(500).json({ status: 'error', message: 'Permission check failed' });
    }
  };
}

// ─── Delegation ceiling ────────────────────────────────────────────────────

/**
 * An administrator may only hand out privileges they themselves hold.
 *
 * Without this rule, any holder of `maintain-roles-and-permissions` — a set
 * that reaches down to Branch Admin — can assign Platform Super Admin to a
 * colleague, or mint a custom role granting privileges they lack. Both are
 * escalation to platform level from inside a single branch.
 *
 * Platform-scope operators are exempt: they are the root of trust and must be
 * able to provision a customer's Billing Admin without holding billing rights
 * themselves. Every tenant-scoped actor is bound by the ceiling.
 */
export async function excessCapabilities(
  actorId: string,
  actorTenantId: string,
  requested: string[],
): Promise<string[]> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: actorTenantId },
    select: { type: true },
  });
  // SAAS and SAAS_UNIT operate the platform itself.
  if (tenant && (tenant.type === 'SAAS' || tenant.type === 'SAAS_UNIT')) return [];

  const eff = await getEffectivePermissions(actorId);
  const held = new Set(eff.capabilities);
  return [...new Set(requested)].filter((c) => !held.has(c));
}

/** Capability keys a role grants, tolerating malformed stored JSON. */
export function capabilitiesOfRole(role: { capabilityGrants: string } | null): string[] {
  if (!role) return [];
  return parseGrants(role.capabilityGrants);
}
