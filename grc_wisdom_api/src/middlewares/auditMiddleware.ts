import { Prisma } from '@prisma/client';
import { generateHash } from '../utils/cryptoUtils';

export const GENESIS_HASH =
  'GENESIS_HASH_0000000000000000000000000000000000000000000000000000000000000000';

type TxClient = Prisma.TransactionClient;

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
 *
 * SQLite serializes writers at the file level, so per-tenant chain integrity
 * is safe in dev. In production Postgres, wrap the tenant read+write in a
 * SERIALIZABLE tx or take an advisory lock on the tenantId.
 */
export async function writeAudit(tx: TxClient, entry: AuditEntry): Promise<void> {
  const lastLog = await tx.auditLog.findFirst({
    where: { tenantId: entry.tenantId },
    orderBy: { timestamp: 'desc' },
    select: { currentHash: true },
  });

  const previousHash = lastLog?.currentHash || GENESIS_HASH;
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
      wormLocked: true,
    },
  });
}
