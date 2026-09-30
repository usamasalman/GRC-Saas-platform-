import { prisma } from '../db';

/**
 * Whether a platform feature flag is on for an organisation.
 *
 * Flags were stored and edited on the Feature Flags screen, and nothing on the
 * server read them, so none switched anything on or off. This is the read
 * (consulting engagement, sprint 4): the organisation's own override when it
 * has one, otherwise the flag's platform-wide status. A platform-wide status
 * past its expiry date counts as off; an override is a deliberate decision
 * about one organisation and stands until it is changed. The rollout
 * percentage is not read here: a percentage needs a stable way to bucket
 * organisations, and the flags that use this are switched per organisation.
 *
 * A flag that does not exist is off, so a missing catalogue entry can only
 * ever hide a feature, never expose one.
 */

/** The consulting layer: invitations, relationships, nominations, delivery style. */
export const CONSULTING_FLAG = 'Consulting Engagements';

export interface FlagRow { status: string; expiryDate: Date | null }

export function flagOnFor(flag: FlagRow | null, override: { enabled: boolean } | null, now: Date = new Date()): boolean {
  if (!flag) return false;
  if (override) return override.enabled;
  if (flag.expiryDate && flag.expiryDate < now) return false;
  return flag.status === 'Enabled';
}

/** The flag's state for each organisation named. */
export async function featureStates(key: string, tenantIds: readonly string[]): Promise<Map<string, boolean>> {
  const ids = [...new Set(tenantIds.filter(Boolean))];
  const flag = await prisma.featureFlag.findUnique({
    where: { key },
    select: { status: true, expiryDate: true, overrides: { where: { tenantId: { in: ids } }, select: { tenantId: true, enabled: true } } },
  });
  const now = new Date();
  const byTenant = new Map((flag?.overrides || []).map((o) => [o.tenantId, o]));
  return new Map(ids.map((id) => [id, flagOnFor(flag, byTenant.get(id) ?? null, now)]));
}

export async function isFeatureOn(key: string, tenantId: string): Promise<boolean> {
  return (await featureStates(key, [tenantId])).get(tenantId) === true;
}

/**
 * The refusal when a feature is off for any of the organisations an action
 * involves, or null when it is on for all of them. The route refuses; hiding
 * a screen is not the control.
 */
export async function featureRefusal(
  key: string,
  parties: readonly { tenantId: string; who: string }[],
): Promise<{ status: 403; code: 'FEATURE_OFF'; message: string } | null> {
  const states = await featureStates(key, parties.map((p) => p.tenantId));
  const off = parties.filter((p) => !states.get(p.tenantId));
  if (off.length === 0) return null;
  return {
    status: 403,
    code: 'FEATURE_OFF',
    message: `${key} is not switched on for ${off.map((p) => p.who).join(' or ')}. `
      + 'The platform turns it on per organisation, on the Feature Flags screen.',
  };
}
