/**
 * Stopping an organisation from using the platform, without destroying it.
 *
 * There was no way to do this at all: a customer who stopped paying, or was
 * being offboarded, could only be deleted — and deletion refuses while the
 * tenant holds users, documents or invoices, which every real customer does.
 * So the only available answers were "fully operational" and "impossible".
 *
 * Suspension is not a soft delete. The data stays exactly where it is, every
 * report still counts it, the operator keeps break-glass over it, and lifting
 * it is one write. What it stops is people getting in.
 *
 * Two rules do most of the work here, and both are about not breaking things:
 *
 *   A suspension reaches the subtree. A group whose branches keep trading is
 *   not suspended, so suspending one covers everything beneath it.
 *
 *   Only the decision that caused a suspension can lift it. Each row records
 *   which tenant's suspension put it there, so reactivating a group does not
 *   quietly reactivate a branch that was suspended separately and for its own
 *   reasons.
 *
 * Pure, with no Prisma import, so every case can be exercised without a
 * database — the same shape as hasPlatformDuty, judgeDeletion and
 * planEnablement.
 */

export interface SuspensionTenant {
  id: string;
  name: string;
  /** Materialized path, e.g. /GROUP_1/ORG_2/. Descendants share it as a prefix. */
  path: string;
  type: string;
  suspendedAt: Date | string | null;
  suspendedRootId: string | null;
}

export interface SuspensionRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface SuspensionPlan {
  ok: true;
  /** Tenant ids to write. Never empty — an empty plan is a refusal instead. */
  affected: { id: string; name: string }[];
  /** The tenant the operator named, which every affected row will point at. */
  rootId: string;
  rootName: string;
}

export interface SuspensionInput {
  mode: 'suspend' | 'reactivate';
  /** The tenant the operator named. */
  target: SuspensionTenant | null;
  /** Every tenant in the caller's scope, for the subtree walk. */
  inScope: readonly SuspensionTenant[];
  /** The caller, so they cannot lock themselves out. */
  actorTenantId: string;
  /** Operating-model types that run the platform itself. */
  platformTypes?: readonly string[];
}

const DEFAULT_PLATFORM_TYPES = ['SAAS', 'SAAS_UNIT'];

const isSuspended = (t: SuspensionTenant): boolean => t.suspendedAt != null;

/**
 * Which rows to change, or why not to.
 *
 * The refusals are ordered so the most dangerous mistake is caught first.
 */
export function planSuspension(input: SuspensionInput): SuspensionRefusal | SuspensionPlan {
  const {
    mode, target, inScope, actorTenantId,
    platformTypes = DEFAULT_PLATFORM_TYPES,
  } = input;

  if (!target) {
    return {
      ok: false,
      status: 404,
      code: 'TENANT_NOT_FOUND',
      message: 'That organisation was not found, or is outside your scope.',
    };
  }

  // ── The two ways to lock yourself out ──────────────────────────────────
  //
  // Both are checked before anything else, because both are unrecoverable from
  // inside the product: the suspension takes effect on the next request, which
  // is the one the operator makes to undo it.

  if (target.id === actorTenantId) {
    return {
      ok: false,
      status: 400,
      code: 'CANNOT_SUSPEND_SELF',
      message: 'You cannot suspend the organisation you are signed in to. '
        + 'The suspension would take effect on your next request, including the one to lift it.',
    };
  }

  const actor = inScope.find((t) => t.id === actorTenantId);
  if (mode === 'suspend' && actor && actor.path.startsWith(target.path)) {
    return {
      ok: false,
      status: 400,
      code: 'CANNOT_SUSPEND_ANCESTOR',
      message: `${target.name} contains the organisation you are signed in to, so suspending it `
        + 'would suspend you as well, including your ability to lift it.',
    };
  }

  if (mode === 'suspend' && platformTypes.includes(String(target.type).toUpperCase())) {
    return {
      ok: false,
      status: 400,
      code: 'CANNOT_SUSPEND_PLATFORM',
      message: `${target.name} runs the platform itself. Suspending it would take every customer `
        + 'down with it, including the control plane used to bring it back.',
    };
  }

  // ── Subtree ────────────────────────────────────────────────────────────
  // Prefix on the materialized path. The target's own path is a prefix of
  // itself, so this includes the target.
  const subtree = inScope.filter((t) => t.path.startsWith(target.path));

  if (mode === 'suspend') {
    // Already-suspended rows are left exactly as they are, whoever suspended
    // them. Re-stamping them with this decision would hand this reactivation
    // the power to lift a suspension it did not impose.
    const affected = subtree.filter((t) => !isSuspended(t));
    if (affected.length === 0) {
      return {
        ok: false,
        status: 409,
        code: 'ALREADY_SUSPENDED',
        message: `${target.name} is already suspended.`,
      };
    }
    return {
      ok: true,
      affected: affected.map((t) => ({ id: t.id, name: t.name })),
      rootId: target.id,
      rootName: target.name,
    };
  }

  // ── Reactivate ─────────────────────────────────────────────────────────
  if (!isSuspended(target)) {
    return {
      ok: false,
      status: 409,
      code: 'NOT_SUSPENDED',
      message: `${target.name} is not suspended.`,
    };
  }

  // A tenant suspended because an ancestor was suspended cannot be lifted on
  // its own; doing so would leave an operating branch inside a suspended group,
  // which is the state the cascade exists to prevent.
  if (target.suspendedRootId && target.suspendedRootId !== target.id) {
    const cause = inScope.find((t) => t.id === target.suspendedRootId);
    return {
      ok: false,
      status: 409,
      code: 'SUSPENDED_BY_ANCESTOR',
      message: `${target.name} is suspended because ${cause?.name || 'a parent organisation'} is. `
        + 'Reactivate that one instead.',
    };
  }

  // Only what this decision suspended. A branch suspended separately keeps its
  // own suspendedRootId and is untouched.
  const affected = subtree.filter((t) => isSuspended(t) && t.suspendedRootId === target.id);
  if (affected.length === 0) {
    return {
      ok: false,
      status: 409,
      code: 'NOT_SUSPENDED',
      message: `${target.name} is not suspended by a decision you can lift here.`,
    };
  }

  return {
    ok: true,
    affected: affected.map((t) => ({ id: t.id, name: t.name })),
    rootId: target.id,
    rootName: target.name,
  };
}

/**
 * What to tell someone whose organisation is suspended.
 *
 * Kept here so the sign-in refusal and the per-request refusal say the same
 * thing. Names the reason when there is one: "contact your administrator" is
 * useless to someone who does not know what happened.
 */
export function suspensionMessage(reason: string | null | undefined): string {
  const base = 'This organisation is suspended, so sign-in is unavailable.';
  const why = String(reason || '').trim();
  return why ? `${base} Reason given: ${why}` : `${base} Contact the platform operator.`;
}
