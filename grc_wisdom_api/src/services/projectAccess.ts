import { TenantScope } from './scopeResolver';

/**
 * Who may see which delivery project.
 *
 * A project is visible from two directions, and this is the only place that
 * knows it:
 *
 *   - the CLIENT tenant, which owns the programme, and
 *   - the PROVIDER tenant, when a consulting partner is delivering it.
 *
 * Neither appears in the other's `scope.tenantIds`: a partner is not inside its
 * client's subtree and never will be. So the ordinary `tenantWhere(scope)` used
 * everywhere else in the codebase is not sufficient here, and a controller that
 * reached for it would silently hide every engagement from the consultant doing
 * the work.
 *
 * The shape is not new. `sharedServiceController` already resolves a
 * provider-owned record that consumers can also see, with the same OR. This is
 * that pattern applied to engagements.
 *
 * Keeping it in one exported function rather than inline in each handler is
 * deliberate: the cross-tenant IDOR found in `usageController` happened because
 * tenant filtering was a convention every controller had to remember, and one
 * did not.
 */

/** Prisma `where` fragment restricting Project rows to what this caller may read. */
export function projectWhere(scope: TenantScope): {
  OR: [{ tenantId: { in: string[] } }, { providerTenantId: { in: string[] } }];
} {
  return {
    OR: [
      { tenantId: { in: scope.tenantIds } },
      { providerTenantId: { in: scope.tenantIds } },
    ],
  };
}

/**
 * Whether this caller may create or modify a project belonging to `tenantId`.
 *
 * Write access is narrower than read: a consulting partner can see and work an
 * engagement, but the client's own tenant is the only one that may create a
 * project against itself. Otherwise a partner could open programmes inside a
 * customer's estate without the customer ever asking.
 */
export function canWriteProject(scope: TenantScope, clientTenantId: string): boolean {
  return scope.tenantIds.includes(clientTenantId);
}

/**
 * Whether `project` is one this caller may read.
 *
 * For use after a `findUnique` where re-querying with the scope filter would be
 * wasteful. Takes only the two fields it needs so callers can `select` narrowly.
 */
export function canReadProject(
  scope: TenantScope,
  project: { tenantId: string; providerTenantId: string | null },
): boolean {
  if (scope.tenantIds.includes(project.tenantId)) return true;
  return project.providerTenantId !== null
    && scope.tenantIds.includes(project.providerTenantId);
}

/**
 * Which side of the engagement this caller sits on.
 *
 * Drives what the interface offers — a provider submits deliverables, a client
 * accepts them — and later, in slice 3, which actions the verification workflow
 * will allow. Returns null when the caller can see the project through neither
 * route, which callers should treat as "not found" rather than "forbidden": a
 * 403 confirms the project exists.
 */
export function sideOf(
  scope: TenantScope,
  project: { tenantId: string; providerTenantId: string | null },
): 'Client' | 'Provider' | null {
  // Client wins when a tenant is somehow both, which happens only for the
  // platform control plane reading across the estate. Owning the data is the
  // stronger claim.
  if (scope.tenantIds.includes(project.tenantId)) return 'Client';
  if (project.providerTenantId && scope.tenantIds.includes(project.providerTenantId)) {
    return 'Provider';
  }
  return null;
}
