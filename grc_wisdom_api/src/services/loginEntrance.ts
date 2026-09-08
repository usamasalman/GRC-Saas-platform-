/**
 * Which sign-in page an account belongs to.
 *
 * The platform operator's control plane and a customer's workspace are
 * different products that happen to share a database, and they shared a door.
 * Signing into the wrong one was possible and confusing, and the operator's
 * entrance was listed on the customer's page for anyone to find.
 *
 * Pure, so it is tested without a database — the rest of authController cannot
 * be imported without one.
 */

/** Tenant types that belong to the platform operator rather than a customer. */
export const PLATFORM_TENANT_TYPES = ['SAAS', 'SAAS_UNIT'] as const;

export type Entrance = 'platform' | 'tenant';

/**
 * An unrecognised or missing tenant type resolves to the customer entrance.
 *
 * The default has to be the side with nothing privileged behind it. A new
 * tenant type added next year should not quietly become an operator account
 * because nobody remembered to update a list.
 */
export function entranceFor(tenantType: string | null | undefined): Entrance {
  const type = String(tenantType || '').toUpperCase();
  return (PLATFORM_TENANT_TYPES as readonly string[]).includes(type) ? 'platform' : 'tenant';
}

/**
 * Whether this account may sign in at the entrance it is trying.
 *
 * An absent or unrecognised `entrance` is treated as matching. Older clients
 * and the password-reset flow post without it, and breaking their sign-in to
 * enforce a page separation would be a poor trade for what this is — a
 * separation of audiences, not a security boundary.
 */
export function checkEntrance(
  tenantType: string | null | undefined,
  requested: unknown,
): { ok: true } | { ok: false; belongs: Entrance; message: string } {
  if (requested !== 'platform' && requested !== 'tenant') return { ok: true };

  const belongs = entranceFor(tenantType);
  if (belongs === requested) return { ok: true };

  return {
    ok: false,
    belongs,
    // Names which entrance, deliberately not where it is. An operator has been
    // given their own address; anyone else reading this has already supplied a
    // working operator password and is not learning a URL from it.
    message: belongs === 'platform'
      ? 'This account signs in through the platform operator entrance, not here.'
      : 'This is the platform operator entrance. Sign in at the main login page.',
  };
}
