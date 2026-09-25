import { Prisma } from '@prisma/client';
import { generateHash } from '../utils/cryptoUtils';
import { prisma } from '../db';

export const GENESIS_HASH =
  'GENESIS_HASH_0000000000000000000000000000000000000000000000000000000000000000';

type TxClient = Prisma.TransactionClient;

/**
 * Keeps the audit chain's advisory locks apart from any other advisory lock
 * the database might be asked for: the key is hash(tenantId) under this seed.
 */
const AUDIT_LOCK_SEED = 20260925;

export interface AuditEntry {
  tenantId: string;
  actorId: string | null;
  action: string;
  /** e.g. "Document", "Invoice" — used by the SoD engine for O(indexed) lookups. */
  subjectType?: string;
  /** uuid of the affected record. Populate whenever there is one. */
  subjectId?: string;
  payload: Record<string, unknown>;
}

/**
 * WORM Hash-Chained Audit Writer.
 *
 * MUST be called inside the same prisma.$transaction as the business write
 * (TRD §6.1: the audit row and the business row commit or fail together).
 * Called with the client itself, it opens a transaction of its own, because
 * the lock below lasts only as long as the transaction holding it.
 *
 * One append at a time per organisation. This read the last entry and chained
 * to it with nothing stopping a second request doing the same in the same
 * instant: both chained to one entry, the chain forked, and every verifier
 * reported the organisation's trail as tampered though nothing had changed.
 * One platform screen sends several audited requests at once, so it happened
 * in ordinary use (QA-029). The advisory lock is held until this transaction
 * commits, so the next writer for the same organisation waits and then reads
 * this entry as its predecessor; other organisations do not wait. The unique
 * (tenantId, chainSeq) index is the backstop: if two ever took the same
 * position, the second write would fail rather than fork.
 */
export async function writeAudit(tx: TxClient, entry: AuditEntry): Promise<void> {
  // Recognised by identity. A transaction client carries a $transaction of its
  // own at runtime, so testing for the method wrapped every write in a second
  // transaction on a second connection — and a burst of writes then held the
  // whole pool waiting on itself until the transactions timed out.
  if ((tx as unknown) === prisma) {
    return prisma.$transaction((t) => writeAudit(t, entry));
  }

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${entry.tenantId}::text, ${AUDIT_LOCK_SEED}::bigint))`;

  // By position, not by time: `timestamp` is when a row landed, and two rows
  // can land in either order. Rows without a position (written by a process
  // older than chainSeq) are passed over rather than read as position zero.
  const lastLog = await tx.auditLog.findFirst({
    where: { tenantId: entry.tenantId, chainSeq: { not: null } },
    orderBy: { chainSeq: 'desc' },
    select: { currentHash: true, chainSeq: true },
  });

  const previousHash = lastLog?.currentHash || GENESIS_HASH;
  const chainSeq = (lastLog?.chainSeq ?? 0) + 1;
  const payloadString = JSON.stringify(entry.payload);
  const timestampStr = new Date().toISOString();
  const currentHash = generateHash(
    `${previousHash}:${entry.action}:${payloadString}:${timestampStr}`
  );

  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      action: entry.action,
      subjectType: entry.subjectType ?? null,
      subjectId: entry.subjectId ?? null,
      payload: payloadString,
      previousHash,
      currentHash,
      // The instant the hash covers, stored because the hash covers it.
      //
      // This line is the whole fix. timestampStr went into the digest and
      // nowhere else, so `timestamp` took @default(now()) from Postgres a few
      // milliseconds later and the verifier — which recomputes from the stored
      // timestamp — could never reproduce the digest. Measured against a
      // database this product wrote itself, the first row of the busiest
      // tenant needed a timestamp 5 ms earlier than the one stored, and every
      // tenant holding audit rows was reported TAMPERED.
      hashedAt: new Date(timestampStr),
      chainSeq,
      wormLocked: true,
    },
  });
}
