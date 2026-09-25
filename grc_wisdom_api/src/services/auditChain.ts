import { prisma } from '../db';
import { generateHash } from '../utils/cryptoUtils';
// Imported rather than repeated as a literal. The verifier's copy and the
// writer's copy were two separate strings that happened to match.
import { GENESIS_HASH } from '../middlewares/auditMiddleware';

/**
 * Verify one organisation's audit hash chain.
 *
 * The one verifier. The database console and the platform security screen both
 * call it, because they are asked the same question. The security screen had
 * its own: it read the oldest 100 rows on the whole platform, organisations
 * interleaved, and compared each row's link with whatever row came before it —
 * so any two organisations writing on the same day made it report tampering on
 * a clean trail, it never recomputed a digest (a changed payload passed), and
 * row 101 onwards was never looked at while the screen announced the chain
 * valid "up to current tip" (QA-027).
 *
 * A row is verified against `hashedAt` — the instant the digest covers —
 * rather than against `timestamp`, the instant the row landed. Those are
 * milliseconds apart, and checking the digest against the wrong one is why
 * this endpoint used to report every tenant's trail as TAMPERED.
 *
 * Rows written before hashedAt existed never stored the value they hashed.
 * They are unverifiable by construction, which is a different statement from
 * tampered, and saying the harsher one about a compliance record nobody
 * touched is its own kind of false reporting. The chain continues through
 * them on their stored hash, so one legacy row at the start of a tenant's
 * history no longer hides everything written since.
 */

/** Rows read per query when verifying the audit chain; memory stays flat as the trail grows. */
export const AUDIT_VERIFY_BATCH = 1000;

/**
 * How far back a fork's parent is looked for. Entries written together chain
 * to an entry a few places back, never a thousand; a bounded window keeps
 * memory flat, and an entry claiming a parent further back than this is not
 * given the benefit of the doubt.
 */
const FORK_WINDOW = 1000;

export interface ChainResult {
  tenantId: string;
  tenantName: string;
  logCount: number;
  verifiedCount: number;
  unverifiableCount: number;
  /** Entries chained to an earlier entry than the one before them, each intact (QA-029). */
  forkedCount: number;
  verifiableFrom: Date | null;
  status: 'VALID' | 'VALID_SINCE' | 'UNVERIFIABLE' | 'FORKED' | 'TAMPERED';
  firstTamperedLogId: string | null;
}

export async function verifyTenantChain(t: { id: string; name: string }): Promise<ChainResult> {
  let chainValid = true;
  let tamperedLogId: string | null = null;
  let unverifiable = 0;
  let verified = 0;
  let forked = 0;
  let verifiableFrom: Date | null = null;
  let expectedHash = GENESIS_HASH;
  const logCount = await prisma.auditLog.count({ where: { tenantId: t.id } });

  // The hashes of the entries just read, oldest first, for recognising a fork.
  const recent = new Set<string>([GENESIS_HASH]);
  const recentOrder: string[] = [GENESIS_HASH];
  const remember = (hash: string) => {
    recent.add(hash);
    recentOrder.push(hash);
    if (recentOrder.length > FORK_WINDOW) recent.delete(recentOrder.shift()!);
  };

  // In batches (QA-022), in chain order (QA-029); see chainRows below.
  for await (const log of chainRows(t.id)) {
    // hashedAt when the row has one. `timestamp` otherwise, because a few
    // legacy rows were written by a path that stored the value it hashed
    // and those do verify — reporting them as unverifiable would throw
    // away a real check to keep the code shorter.
    const sealed = log.hashedAt ?? log.timestamp;
    const computed = generateHash(
      `${expectedHash}:${log.action}:${log.payload}:${new Date(sealed).toISOString()}`
    );

    if (computed === log.currentHash) {
      verified += 1;
      if (!verifiableFrom) verifiableFrom = sealed;
      expectedHash = log.currentHash;
      remember(log.currentHash);
      continue;
    }

    if (!log.hashedAt) {
      // A mismatch on a row that never stored what it hashed proves
      // nothing either way. Carry the chain forward on what the row
      // recorded, and count it, rather than accusing it.
      unverifiable += 1;
      expectedHash = log.currentHash;
      remember(log.currentHash);
      continue;
    }

    // A fork from before appends were serialised: an entry whose order was
    // inferred, intact against the predecessor it recorded, and that
    // predecessor an entry just read. Two requests chained to the same
    // entry; nothing was changed. Only inferred-order entries qualify —
    // from chainSeq on, the writer cannot fork, so a fork there is an
    // entry that was put there, and is reported as tampering.
    const forkParent = log.orderInferred && recent.has(log.previousHash)
      && generateHash(`${log.previousHash}:${log.action}:${log.payload}:${new Date(sealed).toISOString()}`) === log.currentHash;
    if (forkParent) {
      forked += 1;
      expectedHash = log.currentHash;
      remember(log.currentHash);
      continue;
    }

    chainValid = false;
    tamperedLogId = log.id;
    break;
  }

  return {
    tenantId: t.id,
    tenantName: t.name,
    logCount,
    verifiedCount: verified,
    // Named rather than folded into the count, because "142 rows, 3 of
    // them unverifiable" is a finding somebody may need to explain to an
    // assessor, and a single VALID would bury it.
    unverifiableCount: unverifiable,
    forkedCount: forked,
    verifiableFrom,
    status: !chainValid
      ? 'TAMPERED'
      : forked > 0
        ? 'FORKED'
        : unverifiable > 0
          ? (verified > 0 ? 'VALID_SINCE' : 'UNVERIFIABLE')
          : 'VALID',
    firstTamperedLogId: tamperedLogId,
  };
}

const CHAIN_COLUMNS = {
  id: true, action: true, payload: true, previousHash: true, currentHash: true,
  hashedAt: true, timestamp: true, orderInferred: true,
} as const;

/**
 * An organisation's entries in chain order, a batch at a time.
 *
 * This read the whole history of every organisation into memory at once:
 * +225 MB for 200,000 rows in one click, and an audit trail only grows
 * (QA-022). Positioned entries are read by position range, which the unique
 * (tenantId, chainSeq) index serves directly; a cursor over a nullable sort
 * column can stop early at a NULL without saying so. Entries with no position
 * — written by a process older than chainSeq — follow, in landing order.
 */
async function* chainRows(tenantId: string) {
  let after = 0;
  for (;;) {
    const rows = await prisma.auditLog.findMany({
      where: { tenantId, chainSeq: { gt: after } },
      orderBy: { chainSeq: 'asc' },
      take: AUDIT_VERIFY_BATCH,
      select: { ...CHAIN_COLUMNS, chainSeq: true },
    });
    yield* rows;
    if (rows.length < AUDIT_VERIFY_BATCH) break;
    after = rows[rows.length - 1].chainSeq!;
  }
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.auditLog.findMany({
      where: { tenantId, chainSeq: null },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: AUDIT_VERIFY_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: CHAIN_COLUMNS,
    });
    yield* rows;
    if (rows.length < AUDIT_VERIFY_BATCH) break;
    cursor = rows[rows.length - 1].id;
  }
}
