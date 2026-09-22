/**
 * Applying the read decision, and recording that a read happened.
 *
 * The decision itself is pure and lives in services/documentAccess.ts. This is
 * the half that needs Postgres: what the viewer holds, who was issued the
 * document, and the access row. Kept out of the controller because two
 * controllers ask the same question — opening a document and listing what it
 * governs are both reads of the same record, and a policy enforced in one of
 * them is not enforced.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { getEffectivePermissions } from './capabilityEngine';
import {
  readDecision,
  recordingIsMandatory,
  chainWorthy,
  accessDay,
  ACCESS_ACTION,
  type ReadVerdict,
  type ReadViewer,
  type AccessVia,
} from './documentAccess';

const SUBJECT_DOCUMENT = 'Document';

/** The columns the decision needs, and nothing else. */
export const READ_GUARD_SELECT = {
  id: true,
  tenantId: true,
  ownerId: true,
  status: true,
  classification: true,
  audienceKind: true,
} as const;

export interface GuardableDocument {
  id: string;
  tenantId: string;
  ownerId: string;
  status: string;
  classification: string | null;
  audienceKind: string | null;
}

/** One capability lookup, reused across every document in a listing. */
export async function viewerFor(userId: string, tenantId: string): Promise<ReadViewer> {
  const eff = await getEffectivePermissions(userId);
  return { id: userId, tenantId, capabilities: eff.capabilities };
}

/**
 * Which of these documents this person was issued at publication.
 *
 * One query for the whole page rather than one per row: a listing of 400
 * documents must not become 400 round trips because reads became guarded.
 */
export async function audienceMembership(
  userId: string,
  documentIds: readonly string[],
): Promise<Set<string>> {
  if (documentIds.length === 0) return new Set();
  const rows = await prisma.acknowledgementRequest.findMany({
    where: { userId, documentId: { in: [...documentIds] } },
    select: { documentId: true },
  });
  return new Set(rows.map((r) => r.documentId));
}

/**
 * The decision for one document the caller has already loaded.
 *
 * `approverIds` comes from the approvals the caller included; passing them
 * rather than re-querying keeps the common path at the query count it had.
 */
export function decideRead(
  viewer: ReadViewer,
  doc: GuardableDocument,
  approverIds: readonly string[],
  inAudience: boolean,
): ReadVerdict {
  return readDecision(viewer, {
    id: doc.id,
    tenantId: doc.tenantId,
    ownerId: doc.ownerId,
    status: doc.status,
    classification: doc.classification,
    approverIds,
    inAudience,
    audienceKind: doc.audienceKind,
  });
}

/**
 * Load one document, decide, and say what the handler should do.
 *
 * A refusal is a 404 carrying the same message as a genuine miss. The packet's
 * test is that a Restricted document is INVISIBLE, and a 403 saying "you may
 * not read this" confirms the document exists, its id is real and somebody
 * thought it worth protecting. That is the disclosure the marking exists to
 * prevent, so the two cases are deliberately indistinguishable from outside.
 */
export const NOT_FOUND_MESSAGE = 'Document not found';

export async function loadReadable(
  documentId: string,
  userId: string,
  tenantId: string,
): Promise<{ doc: GuardableDocument; verdict: ReadVerdict } | null> {
  const doc = await prisma.document.findFirst({
    where: { id: documentId, tenantId },
    select: READ_GUARD_SELECT,
  });
  if (!doc) return null;

  const [viewer, approvals] = await Promise.all([
    viewerFor(userId, tenantId),
    prisma.approvalQueue.findMany({
      where: { documentId },
      select: { approverId: true },
    }),
  ]);

  const approverIds = approvals.map((a) => a.approverId);
  // Only asked when it can still change the answer. A document the owner or an
  // approver is opening is already decided, and most reads are those.
  const needsAudience = doc.ownerId !== userId && !approverIds.includes(userId);
  const inAudience = needsAudience
    ? (await audienceMembership(userId, [documentId])).has(documentId)
    : false;

  const verdict = decideRead(viewer, doc, approverIds, inAudience);
  return verdict.allowed ? { doc, verdict } : null;
}

// ─── Recording ──────────────────────────────────────────────────────────────

/**
 * Record that this person opened this document.
 *
 * The insert is attempted FIRST and a unique violation is the answer, not an
 * error: the window either opened now or was already open, and no separate
 * "does a row exist" query can say which without a race. A new window on a
 * Confidential or Restricted document also appends to the WORM chain — at most
 * one entry per person per document per day, with the actor and the subject in
 * the payload, which is what keeps the chain's @unique currentHash from
 * colliding on two identical reads in the same millisecond.
 *
 * Returns false when nothing could be recorded. The caller decides what that
 * means: for a marked document, refusing the read.
 */
export async function recordAccess(input: {
  tenantId: string;
  documentId: string;
  userId: string;
  classification: string | null;
  basis: string;
  via: AccessVia;
  now: Date;
}): Promise<boolean> {
  const day = accessDay(input.now);
  const classification = String(input.classification ?? '');
  const isDownload = input.via === 'DOWNLOAD';
  // The reader pane reaches the download endpoint straight after getDocument
  // has already recorded the open. It still opens a window if none exists, so
  // no delivery goes unrecorded, but it must not increment a read that is
  // already counted — otherwise every Views figure is exactly doubled.
  const isPreview = input.via === 'PREVIEW';

  try {
    let openedNow = true;
    try {
      await prisma.documentAccess.create({
        data: {
          tenantId: input.tenantId,
          documentId: input.documentId,
          userId: input.userId,
          day,
          classification,
          basis: input.basis,
          views: isDownload ? 0 : 1,
          downloads: isDownload ? 1 : 0,
          firstAt: input.now,
          lastAt: input.now,
        },
      });
    } catch (e: any) {
      const clash = e instanceof Prisma.PrismaClientKnownRequestError
        ? e.code === 'P2002'
        : e?.code === 'P2002';
      if (!clash) throw e;
      openedNow = false;
      await prisma.documentAccess.update({
        where: {
          documentId_userId_day: {
            documentId: input.documentId,
            userId: input.userId,
            day,
          },
        },
        data: {
          lastAt: input.now,
          views: isDownload || isPreview ? undefined : { increment: 1 },
          downloads: isDownload ? { increment: 1 } : undefined,
        },
      });
    }

    if (openedNow && chainWorthy(classification)) {
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          tenantId: input.tenantId,
          actorId: input.userId,
          action: ACCESS_ACTION,
          subjectType: SUBJECT_DOCUMENT,
          subjectId: input.documentId,
          // actorId and documentId are in the payload on purpose: writeAudit
          // hashes the payload but NOT the actor or the subject columns, so
          // without them two people opening the same document in the same
          // millisecond would hash identically and the @unique currentHash
          // would kill one of the transactions.
          //
          // The code and the classification are deliberately NOT here.
          // GET /api/audit-logs is guarded by requireAuth alone and returns
          // raw payloads to any tenant member, so naming the marking and the
          // human-readable code in this entry would hand back through the
          // audit log exactly what the guard withholds. The document id is
          // enough for anyone entitled to resolve it, and they have
          // /:id/access, which is narrowed to the owner and the records team.
          payload: {
            actorId: input.userId,
            documentId: input.documentId,
            basis: input.basis,
            via: input.via,
            day,
          },
        });
      });
    }

    return true;
  } catch (error: any) {
    console.error('[Document Access Record Error]:', error);
    return false;
  }
}

/**
 * Whether a failure to record must stop the read.
 *
 * Re-exported so a controller states the policy by name instead of comparing
 * classification strings itself.
 */
export { recordingIsMandatory };
