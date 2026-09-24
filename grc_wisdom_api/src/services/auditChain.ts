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

export interface ChainResult {
  tenantId: string;
  tenantName: string;
  logCount: number;
  verifiedCount: number;
  unverifiableCount: number;
  verifiableFrom: Date | null;
  status: 'VALID' | 'VALID_SINCE' | 'UNVERIFIABLE' | 'TAMPERED';
  firstTamperedLogId: string | null;
}

export async function verifyTenantChain(t: { id: string; name: string }): Promise<ChainResult> {
  let chainValid = true;
  let tamperedLogId: string | null = null;
  let unverifiable = 0;
  let verified = 0;
  let verifiableFrom: Date | null = null;
  let expectedHash = GENESIS_HASH;
  const logCount = await prisma.auditLog.count({ where: { tenantId: t.id } });

  // In batches, carrying the chain's last hash from one batch to the next.
  // This read the whole history of every organisation into memory at once:
  // +225 MB for 200,000 rows in one click, and an audit trail only grows
  // (QA-022). Same order as the writer (timestamp), with the id to keep
  // ties stable across batch boundaries; only the columns the check needs.
  let cursor: string | undefined;
  batches: for (;;) {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId: t.id },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      take: AUDIT_VERIFY_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, action: true, payload: true, currentHash: true, hashedAt: true, timestamp: true },
    });
    if (logs.length === 0) break;
    cursor = logs[logs.length - 1].id;

    for (const log of logs) {
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
        continue;
      }

      if (!log.hashedAt) {
        // A mismatch on a row that never stored what it hashed proves
        // nothing either way. Carry the chain forward on what the row
        // recorded, and count it, rather than accusing it.
        unverifiable += 1;
        expectedHash = log.currentHash;
        continue;
      }

      chainValid = false;
      tamperedLogId = log.id;
      break batches;
    }
    if (logs.length < AUDIT_VERIFY_BATCH) break;
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
    verifiableFrom,
    status: !chainValid
      ? 'TAMPERED'
      : unverifiable > 0
        ? (verified > 0 ? 'VALID_SINCE' : 'UNVERIFIABLE')
        : 'VALID',
    firstTamperedLogId: tamperedLogId,
  };
}
