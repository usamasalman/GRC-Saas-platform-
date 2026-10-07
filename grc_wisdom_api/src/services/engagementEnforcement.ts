import { prisma } from '../db';
import { CONSULTING_FLAG, ENFORCEMENT_FLAG, featureStates } from './featureFlags';

/**
 * Whether an organisation's consulting rules are enforced (consulting
 * engagement, sprint 6).
 *
 * Checked against the client organisation, because enforcement protects the
 * client's data, and only where consulting is also on for it: enforcement
 * without consulting has nothing to enforce. It decides two kinds of
 * engagement, the ones that named a firm the old way and the ones migrated
 * from them; an engagement a firm joined by invitation is enforced from the
 * start (sprints 4 and 5).
 */

export async function enforcementStates(clientTenantIds: readonly string[]): Promise<Map<string, boolean>> {
  const ids = [...new Set(clientTenantIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const [enforced, consulting] = await Promise.all([
    featureStates(ENFORCEMENT_FLAG, ids),
    featureStates(CONSULTING_FLAG, ids),
  ]);
  return new Map(ids.map((id) => [id, Boolean(enforced.get(id) && consulting.get(id))]));
}

export async function isEnforcedFor(clientTenantId: string): Promise<boolean> {
  return (await enforcementStates([clientTenantId])).get(clientTenantId) === true;
}

/**
 * The client organisations, among those these firms deliver for, whose rules
 * are enforced. For the firm's lists, which are one query and cannot ask per
 * row.
 */
export async function enforcedClientsFor(firmTenantIds: readonly string[]): Promise<string[]> {
  if (firmTenantIds.length === 0) return [];
  const clients = await prisma.project.findMany({
    where: { providerTenantId: { in: [...firmTenantIds] } },
    distinct: ['tenantId'],
    select: { tenantId: true },
  });
  const states = await enforcementStates(clients.map((c) => c.tenantId));
  return [...states].filter(([, on]) => on).map(([id]) => id);
}
