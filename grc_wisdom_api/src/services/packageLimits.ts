import { Prisma } from '@prisma/client';
import { prisma } from '../db';

/**
 * What a customer's package allows, and holding every organisation to it.
 *
 * A plan card said "Named users: 5 · Enabled frameworks: 1 · Encrypted
 * storage: 5 GB" and nothing checked any of it: a customer on the smallest
 * package could enable every framework in the library and add as many people
 * as it liked (QA-031). Every addition that a package limits now passes here
 * first, and is refused — with the limit and the package named — when it would
 * go past it.
 *
 * Who a package covers. A subscription belongs to a customer's top-level
 * organisation; its subsidiaries, branches and locations have none of their
 * own and share it. So the package that governs an organisation is the nearest
 * one on the way up its tree, and what it counts is used across that whole
 * group: one framework enabled for forty branches is one framework.
 *
 * The platform's own organisations are not customers and are not limited.
 * An organisation with no package at all is not unlimited: it may not add
 * anything a package would limit until the platform assigns one.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type PackageResource = 'frameworks' | 'users' | 'storage';

const PLATFORM_TYPES = new Set(['SAAS', 'SAAS_UNIT']);
/** Users who hold a seat: signed in, or invited and able to. */
export const SEAT_STATUSES = ['Active', 'Pending'];
const GB = 1024 ** 3;
/** Keeps these advisory locks apart from the audit chain's. */
const PACKAGE_LOCK_SEED = 31031;

export class PackageLimitError extends Error {
  readonly status = 403;
  constructor(readonly code: 'PACKAGE_LIMIT' | 'NO_PACKAGE' | 'PACKAGE_LIMIT_NOT_SET', message: string) {
    super(message);
  }
}

export interface PackageLimits {
  users: number | null;
  frameworks: number | null;
  storageGb: number | null;
}

export interface PackageUsage {
  /** The organisation whose subscription this is. */
  holder: { id: string; name: string };
  plan: { id: string; name: string };
  limits: PackageLimits;
  used: { users: number; frameworks: number; storageBytes: number };
}

/**
 * The limits a plan sets. The two that live in `features` are read strictly:
 * a plan that does not state one sets none, and nothing is assumed in its
 * place — the plan card used to show "1" and "10 GB" for a plan that said
 * nothing, which is a limit nobody chose.
 */
export function planLimits(plan: { maxUsers: number; features: string }): PackageLimits {
  let f: unknown;
  try { f = JSON.parse(plan.features || 'null'); } catch { f = null; }
  const obj = f && typeof f === 'object' && !Array.isArray(f) ? f as Record<string, unknown> : {};
  const whole = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? v as number : null);
  return {
    users: whole(plan.maxUsers),
    frameworks: whole(obj.frameworks),
    storageGb: whole(obj.storageGb),
  };
}

interface TenantRow { id: string; name: string; type: string; parentId: string | null }

async function tenantTree(db: Db): Promise<Map<string, TenantRow>> {
  const rows = await db.tenant.findMany({ select: { id: true, name: true, type: true, parentId: true } });
  return new Map(rows.map((t) => [t.id, t]));
}

/** The organisation itself, or the nearest one above it, holding an active subscription. */
async function packageHolder(db: Db, tenantId: string, tree: Map<string, TenantRow>) {
  const seen = new Set<string>();
  for (let t = tree.get(tenantId); t && !seen.has(t.id); t = t.parentId ? tree.get(t.parentId) : undefined) {
    seen.add(t.id);
    if (PLATFORM_TYPES.has(t.type)) return { platform: true as const };
    const sub = await db.subscription.findFirst({
      where: { tenantId: t.id, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
      include: { plan: true },
    });
    if (sub) return { platform: false as const, holder: t, plan: sub.plan };
  }
  return null;
}

/** The holder and every organisation below it that has no package of its own. */
function coveredBy(holderId: string, tree: Map<string, TenantRow>, holds: Set<string>): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    out.push(id);
    for (const t of tree.values()) {
      if (t.parentId === id && !holds.has(t.id)) visit(t.id);
    }
  };
  visit(holderId);
  return out;
}

async function holdersOfPackages(db: Db): Promise<Set<string>> {
  const subs = await db.subscription.findMany({ where: { status: 'ACTIVE' }, select: { tenantId: true } });
  return new Set(subs.map((s) => s.tenantId));
}

async function storageBytes(db: Db, tenantIds: string[]): Promise<number> {
  if (tenantIds.length === 0) return 0;
  // A version that carries a file over from the one before points at the same
  // stored file, and a document records its current version's file again: each
  // stored file is counted once.
  const rows = await db.$queryRaw<{ bytes: bigint | number | null }[]>`
    SELECT COALESCE(SUM(size), 0) AS bytes FROM (
      SELECT DISTINCT ON (url) url, size FROM (
        SELECT d."fileUrl" AS url, d."fileSize" AS size
          FROM "Document" d
         WHERE d."tenantId" = ANY(${tenantIds}) AND d."fileUrl" IS NOT NULL AND d."fileSize" IS NOT NULL
        UNION ALL
        SELECT v."fileUrl", v."fileSize"
          FROM "DocumentVersion" v JOIN "Document" d ON d."id" = v."documentId"
         WHERE d."tenantId" = ANY(${tenantIds}) AND v."fileUrl" IS NOT NULL AND v."fileSize" IS NOT NULL
        UNION ALL
        SELECT 'evidence:' || e."id", e."fileSize"
          FROM "ProjectEvidence" e JOIN "Project" p ON p."id" = e."projectId"
         WHERE p."tenantId" = ANY(${tenantIds})
      ) files
    ) distinct_files`;
  return Number(rows[0]?.bytes ?? 0);
}

async function measure(db: Db, covered: string[]) {
  const [users, enabled, storage] = await Promise.all([
    db.user.count({ where: { tenantId: { in: covered }, status: { in: SEAT_STATUSES } } }),
    db.tenantStandardEnablement.findMany({
      where: { tenantId: { in: covered } }, select: { standardId: true }, distinct: ['standardId'],
    }),
    storageBytes(db, covered),
  ]);
  return { users, frameworks: enabled.length, frameworkIds: enabled.map((e) => e.standardId), storageBytes: storage };
}

/**
 * The package governing an organisation and what its group has used of it.
 * Null for the platform's own organisations and for one with no package.
 */
export async function packageUsage(tenantId: string, db: Db = prisma): Promise<PackageUsage | null> {
  const tree = await tenantTree(db);
  const found = await packageHolder(db, tenantId, tree);
  if (!found || found.platform) return null;
  const covered = coveredBy(found.holder.id, tree, await holdersOfPackages(db));
  const used = await measure(db, covered);
  return {
    holder: { id: found.holder.id, name: found.holder.name },
    plan: { id: found.plan.id, name: found.plan.name },
    limits: planLimits(found.plan),
    used: { users: used.users, frameworks: used.frameworks, storageBytes: used.storageBytes },
  };
}

/**
 * packageUsage for many organisations at once, each package measured once: a
 * franchise's forty locations share one package and one measurement.
 */
export async function packageUsageMany(tenantIds: string[], db: Db = prisma): Promise<Map<string, PackageUsage | null>> {
  const tree = await tenantTree(db);
  const holds = await holdersOfPackages(db);
  const measured = new Map<string, PackageUsage>();
  const out = new Map<string, PackageUsage | null>();
  for (const id of tenantIds) {
    const found = await packageHolder(db, id, tree);
    if (!found || found.platform) { out.set(id, null); continue; }
    if (!measured.has(found.holder.id)) {
      const used = await measure(db, coveredBy(found.holder.id, tree, holds));
      measured.set(found.holder.id, {
        holder: { id: found.holder.id, name: found.holder.name },
        plan: { id: found.plan.id, name: found.plan.name },
        limits: planLimits(found.plan),
        used: { users: used.users, frameworks: used.frameworks, storageBytes: used.storageBytes },
      });
    }
    out.set(id, measured.get(found.holder.id)!);
  }
  return out;
}

/**
 * Which package an organisation draws on: the holder's id, 'platform', or null
 * for none. Two organisations with the same answer share one allowance, so
 * moving a person between them changes nothing that package counts.
 */
export async function packageHolderId(tenantId: string, db: Db = prisma): Promise<string | 'platform' | null> {
  const found = await packageHolder(db, tenantId, await tenantTree(db));
  return !found ? null : found.platform ? 'platform' : found.holder.id;
}

const LABEL: Record<PackageResource, string> = {
  frameworks: 'framework', users: 'named user', storage: 'storage',
};

/**
 * Refuses, by throwing PackageLimitError, anything that would take an
 * organisation's group past its package. Call it inside the transaction that
 * makes the addition: it takes a lock per package, so two additions arriving
 * together cannot both take the last place.
 *
 *   frameworks: { standardId } — enabling a framework the group already has
 *               enabled somewhere costs nothing.
 *   users:      { adding } — seats being added (default 1).
 *   storage:    { bytes } — size of the file being stored.
 */
export async function assertPackageAllows(
  db: Prisma.TransactionClient,
  tenantId: string,
  resource: PackageResource,
  opts: { standardId?: string; adding?: number; bytes?: number } = {},
): Promise<void> {
  const tree = await tenantTree(db);
  const found = await packageHolder(db, tenantId, tree);
  if (found?.platform) return;
  const org = tree.get(tenantId)?.name || 'This organisation';
  if (!found) {
    throw new PackageLimitError('NO_PACKAGE',
      `${org} has no active package, so it cannot add ${resource === 'storage' ? 'files' : `${LABEL[resource]}s`}. `
      + 'The platform assigns a package under Subscriptions.');
  }

  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${found.holder.id}::text, ${PACKAGE_LOCK_SEED}::bigint))`;

  const limits = planLimits(found.plan);
  const pkg = `the ${found.plan.name} package${found.holder.id === tenantId ? '' : ` of ${found.holder.name}`}`;
  const limit = resource === 'users' ? limits.users : resource === 'frameworks' ? limits.frameworks : limits.storageGb;
  if (limit === null) {
    throw new PackageLimitError('PACKAGE_LIMIT_NOT_SET',
      `${pkg[0].toUpperCase()}${pkg.slice(1)} does not set a ${LABEL[resource]} limit, so nothing more can be added until `
      + 'the platform sets one under Plans & Catalogue.');
  }

  const covered = coveredBy(found.holder.id, tree, await holdersOfPackages(db));
  const used = await measure(db, covered);

  if (resource === 'frameworks') {
    if (opts.standardId && used.frameworkIds.includes(opts.standardId)) return;
    if (used.frameworks + 1 > limit) {
      throw new PackageLimitError('PACKAGE_LIMIT',
        `${pkg[0].toUpperCase()}${pkg.slice(1)} allows ${limit} framework${limit === 1 ? '' : 's'}, and `
        + `${used.frameworks} ${used.frameworks === 1 ? 'is' : 'are'} enabled. Upgrade the package to enable another.`);
    }
    return;
  }
  if (resource === 'users') {
    const adding = opts.adding ?? 1;
    if (used.users + adding > limit) {
      throw new PackageLimitError('PACKAGE_LIMIT',
        `${pkg[0].toUpperCase()}${pkg.slice(1)} allows ${limit} named user${limit === 1 ? '' : 's'}, and `
        + `${used.users} ${used.users === 1 ? 'holds' : 'hold'} a seat. Upgrade the package, or suspend a user, to add another.`);
    }
    return;
  }
  const bytes = opts.bytes ?? 0;
  if (used.storageBytes + bytes > limit * GB) {
    const gb = (n: number) => (n / GB).toFixed(n < GB ? 3 : 2);
    throw new PackageLimitError('PACKAGE_LIMIT',
      `${pkg[0].toUpperCase()}${pkg.slice(1)} allows ${limit} GB of storage, ${gb(used.storageBytes)} GB is used, `
      + `and this file is ${gb(bytes)} GB. Upgrade the package, or remove files, to store it.`);
  }
}
