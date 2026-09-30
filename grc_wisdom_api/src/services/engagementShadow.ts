import { prisma } from '../db';
import { currentRoute } from './requestContext';

/**
 * The engagement guard in shadow (consulting engagement, sprint 5).
 *
 * Rules that will refuse a delivery firm's request once an organisation goes
 * live are evaluated now and counted, never enforced. One row per engagement,
 * rule and route, with a first-seen time, a last-seen time and a count; IDs
 * only, never request content; kept 90 days after last seen. It is kept apart
 * from the audit trail, which is hash-chained and permanent and records what
 * happened, where one list page could otherwise add hundreds of entries.
 *
 * Recording never affects the request: it is not awaited, and a failure is
 * swallowed after one retry.
 */

export const SHADOW_RULES: Record<string, string> = {
  'member-required':
    'A person from the firm read the engagement without being an approved member of it.',
  'role-required':
    'A person from the firm changed something their engagement role would not allow, or without a role.',
};

export const SHADOW_RETENTION_DAYS = 90;

export function recordShadow(args: {
  projectId: string; clientTenantId: string; firmTenantId: string | null; rule: keyof typeof SHADOW_RULES;
}): void {
  const route = currentRoute();
  const where = { projectId_rule_route: { projectId: args.projectId, rule: args.rule, route } };
  const bump = { count: { increment: 1 }, lastSeenAt: new Date() };
  prisma.engagementShadowRefusal.upsert({
    where,
    create: {
      projectId: args.projectId, clientTenantId: args.clientTenantId, firmTenantId: args.firmTenantId,
      rule: args.rule, route,
    },
    update: bump,
  })
    // Two first sightings at once: one creates, the other lands here.
    .catch(() => prisma.engagementShadowRefusal.update({ where, data: bump }))
    .catch(() => undefined);
}

/** Deletes what has not been seen for 90 days. */
export async function pruneShadow(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SHADOW_RETENTION_DAYS * 86_400_000);
  const gone = await prisma.engagementShadowRefusal.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
  return gone.count;
}
