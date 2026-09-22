/**
 * Matters, the documents they hold, and the record that they did.
 *
 * The rules are in services/legalHold and run without a database. This does
 * the loading, the writing, the freeze flag and the audit entry.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import {
  planMatter, planHoldPlacement, planRelease, summariseMatter, heldForDays,
  stillFrozen, isLegacyHold, MAX_DOCUMENTS_PER_ACTION, MATTER_STATUSES,
} from '../services/legalHold';

const SUBJECT_MATTER = 'LegalMatter';
const SUBJECT_DOCUMENT = 'Document';

const str = (v: unknown): string => String(v ?? '');

/**
 * Bring Document.legalHoldAt into line with what actually holds this document.
 *
 * Eight handlers refuse a frozen document by reading that one column, so it
 * stays as the flag and is derived here. Counting matters: a document caught
 * by two investigations must not thaw when the first one ends.
 */
async function syncFreeze(
  tx: any,
  documentId: string,
  actorId: string,
): Promise<boolean> {
  const active = await tx.legalHold.count({
    where: { documentId, releasedAt: null },
  });
  const frozen = stillFrozen(active);

  if (frozen) {
    const doc = await tx.document.findUnique({
      where: { id: documentId },
      select: { legalHoldAt: true },
    });
    // Only stamp a document that is not already frozen, so re-holding does not
    // move the date the freeze began.
    if (!doc?.legalHoldAt) {
      const first = await tx.legalHold.findFirst({
        where: { documentId, releasedAt: null },
        orderBy: { placedAt: 'asc' },
        include: { matter: { select: { reference: true } } },
      });
      await tx.document.update({
        where: { id: documentId },
        data: {
          legalHoldAt: first?.placedAt ?? new Date(),
          legalHoldBy: actorId,
          legalHoldMatter: first?.matter?.reference ?? null,
          legalHoldReason: first?.reason ?? null,
        },
      });
    }
  } else {
    await tx.document.update({
      where: { id: documentId },
      data: {
        legalHoldAt: null, legalHoldBy: null,
        legalHoldMatter: null, legalHoldReason: null,
      },
    });
  }

  return frozen;
}

// ─── Matters ────────────────────────────────────────────────────────────────

export const listMatters = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;

    const matters = await prisma.legalMatter.findMany({
      where: { tenantId },
      include: {
        openedBy: { select: { id: true, name: true } },
        releasedBy: { select: { id: true, name: true } },
        holds: { select: { releasedAt: true } },
      },
      orderBy: [{ status: 'asc' }, { openedAt: 'desc' }],
    });

    // Documents frozen by the old four-column hold, with no matter behind
    // them. They stay frozen; taking the freeze off records somebody
    // deliberately froze would be the worst possible reading of this change.
    const frozen = await prisma.document.findMany({
      where: { tenantId, legalHoldAt: { not: null } },
      select: {
        id: true, code: true, title: true, legalHoldAt: true,
        legalHoldMatter: true, legalHoldReason: true,
        _count: { select: { legalHolds: { where: { releasedAt: null } } } },
      },
    });
    const legacy = frozen.filter((d) => isLegacyHold({
      legalHoldAt: d.legalHoldAt,
      activeHoldCount: d._count.legalHolds,
    }));

    res.json({
      status: 'success',
      count: matters.length,
      statuses: MATTER_STATUSES,
      maxPerAction: MAX_DOCUMENTS_PER_ACTION,
      matters: matters.map((m) => ({
        id: m.id,
        reference: m.reference,
        title: m.title,
        description: m.description,
        status: m.status,
        openedBy: m.openedBy,
        openedAt: m.openedAt,
        releasedBy: m.releasedBy,
        releasedAt: m.releasedAt,
        releaseReason: m.releaseReason,
        summary: summariseMatter(m.holds),
      })),
      // Surfaced rather than left invisible: these are frozen and nothing
      // lists them, so they can be moved onto a matter.
      legacyHolds: legacy.map((d) => ({
        id: d.id,
        code: d.code,
        title: d.title,
        matter: d.legalHoldMatter,
        reason: d.legalHoldReason,
        heldAt: d.legalHoldAt,
      })),
    });
  } catch (error: any) {
    console.error('[Legal Matters Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load legal matters' });
  }
};

export const createMatter = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;

    const existing = await prisma.legalMatter.findMany({
      where: { tenantId },
      select: { reference: true },
    });

    const plan = planMatter({
      reference: req.body?.reference,
      title: req.body?.title,
      takenReferences: existing.map((m) => m.reference),
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.legalMatter.create({
        data: {
          tenantId,
          reference: plan.reference,
          title: plan.title,
          description: str(req.body?.description).trim() || null,
          openedById: userId,
        },
      });
      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'LEGAL_MATTER_OPENED',
        subjectType: SUBJECT_MATTER,
        subjectId: row.id,
        payload: { reference: row.reference, title: row.title },
      });
      return row;
    });

    res.status(201).json({ status: 'success', matter: created });
  } catch (error: any) {
    console.error('[Legal Matter Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to open the matter' });
  }
};

export const getMatter = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const id = str(req.params.id);

    const matter = await prisma.legalMatter.findFirst({
      where: { id, tenantId },
      include: {
        openedBy: { select: { id: true, name: true } },
        releasedBy: { select: { id: true, name: true } },
        holds: {
          include: {
            document: { select: { id: true, code: true, title: true, status: true, classification: true } },
            placedBy: { select: { id: true, name: true } },
            releasedBy: { select: { id: true, name: true } },
          },
          orderBy: { placedAt: 'desc' },
        },
      },
    });
    if (!matter) { res.status(404).json({ status: 'error', message: 'Matter not found' }); return; }

    res.json({
      status: 'success',
      matter: {
        id: matter.id,
        reference: matter.reference,
        title: matter.title,
        description: matter.description,
        status: matter.status,
        openedBy: matter.openedBy,
        openedAt: matter.openedAt,
        releasedBy: matter.releasedBy,
        releasedAt: matter.releasedAt,
        releaseReason: matter.releaseReason,
      },
      summary: summariseMatter(matter.holds),
      // Released holds are returned alongside active ones on purpose. The
      // record of having been held is the thing releasing used to destroy.
      holds: matter.holds.map((h) => ({
        id: h.id,
        document: h.document,
        reason: h.reason,
        placedBy: h.placedBy,
        placedAt: h.placedAt,
        releasedBy: h.releasedBy,
        releasedAt: h.releasedAt,
        releaseReason: h.releaseReason,
        heldForDays: heldForDays(h),
        active: !h.releasedAt,
      })),
    });
  } catch (error: any) {
    console.error('[Legal Matter Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the matter' });
  }
};

// ─── Placing holds ──────────────────────────────────────────────────────────

export const placeHolds = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = str(req.params.id);

    const matter = await prisma.legalMatter.findFirst({ where: { id, tenantId } });
    if (!matter) { res.status(404).json({ status: 'error', message: 'Matter not found' }); return; }

    const requested: string[] = Array.isArray(req.body?.documentIds)
      ? req.body.documentIds.map(String)
      : [];

    const [found, active] = await Promise.all([
      prisma.document.findMany({
        where: { id: { in: requested }, tenantId },
        select: { id: true, code: true },
      }),
      prisma.legalHold.findMany({
        where: { matterId: id, releasedAt: null },
        select: { documentId: true },
      }),
    ]);

    const plan = planHoldPlacement({
      matterStatus: matter.status,
      requested,
      found: found.map((d) => d.id),
      activeForMatter: active.map((h) => h.documentId),
      reason: req.body?.reason,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const codeOf = new Map(found.map((d) => [d.id, d.code]));

    await prisma.$transaction(async (tx) => {
      for (const documentId of plan.place) {
        // A matter that held this document before and released it gets its
        // row reopened rather than a second one, so the unique key holds and
        // the history stays one thread per matter and document.
        await tx.legalHold.upsert({
          where: { matterId_documentId: { matterId: id, documentId } },
          create: {
            tenantId, matterId: id, documentId,
            placedById: userId, reason: plan.reason,
          },
          update: {
            placedById: userId,
            placedAt: new Date(),
            reason: plan.reason,
            releasedAt: null,
            releasedById: null,
            releaseReason: null,
          },
        });
        await syncFreeze(tx, documentId, userId);
      }

      if (plan.place.length > 0) {
        await writeAudit(tx, {
          tenantId,
          actorId: userId,
          action: 'LEGAL_HOLD_PLACED',
          subjectType: SUBJECT_MATTER,
          subjectId: id,
          payload: {
            reference: matter.reference,
            reason: plan.reason,
            // Codes, not uuids. An auditor reading this should not have to
            // resolve forty identifiers to learn what was frozen.
            documents: plan.place.map((d) => codeOf.get(d) || d),
            count: plan.place.length,
          },
        });
      }
    });

    res.json({
      status: 'success',
      placed: plan.place.length,
      alreadyHeld: plan.alreadyHeld.length,
      warnings: plan.warnings,
    });
  } catch (error: any) {
    console.error('[Legal Hold Place Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to place the hold' });
  }
};

// ─── Releasing ──────────────────────────────────────────────────────────────

/** One document off one matter. Others may still hold it. */
export const releaseHold = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const holdId = str(req.params.holdId);

    const hold = await prisma.legalHold.findFirst({
      where: { id: holdId, tenantId },
      include: {
        matter: { select: { id: true, reference: true } },
        document: { select: { id: true, code: true } },
      },
    });
    if (!hold) { res.status(404).json({ status: 'error', message: 'Hold not found' }); return; }

    const plan = planRelease({
      activeHolds: hold.releasedAt ? 0 : 1,
      reason: req.body?.reason,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const frozen = await prisma.$transaction(async (tx) => {
      await tx.legalHold.update({
        where: { id: holdId },
        data: { releasedAt: new Date(), releasedById: userId, releaseReason: plan.reason },
      });
      const stillHeld = await syncFreeze(tx, hold.documentId, userId);

      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'LEGAL_HOLD_RELEASED',
        subjectType: SUBJECT_DOCUMENT,
        subjectId: hold.documentId,
        payload: {
          documentId: hold.documentId,
          code: hold.document.code,
          reference: hold.matter.reference,
          reason: plan.reason,
          // The part that matters operationally: whether the document is
          // actually free now, or still held by another matter.
          stillFrozen: stillHeld,
        },
      });
      return stillHeld;
    });

    res.json({
      status: 'success',
      stillFrozen: frozen,
      message: frozen
        ? 'Released from this matter. The document is still held by another matter and stays frozen.'
        : 'Released. The document is no longer frozen.',
    });
  } catch (error: any) {
    console.error('[Legal Hold Release Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to release the hold' });
  }
};

/** The whole matter: every document it still holds. */
export const releaseMatter = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = str(req.params.id);

    const matter = await prisma.legalMatter.findFirst({
      where: { id, tenantId },
      include: { holds: { where: { releasedAt: null }, select: { id: true, documentId: true } } },
    });
    if (!matter) { res.status(404).json({ status: 'error', message: 'Matter not found' }); return; }

    const plan = planRelease({
      // A matter with nothing held is still closeable if it is open: the
      // refusal is for a matter already released, not an empty one.
      activeHolds: matter.status === 'Open' ? Math.max(1, matter.holds.length) : 0,
      reason: req.body?.reason,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const stillFrozenAfter = await prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.legalHold.updateMany({
        where: { matterId: id, releasedAt: null },
        data: { releasedAt: now, releasedById: userId, releaseReason: plan.reason },
      });
      await tx.legalMatter.update({
        where: { id },
        data: {
          status: 'Released',
          releasedAt: now,
          releasedById: userId,
          releaseReason: plan.reason,
        },
      });

      const stayFrozen: string[] = [];
      for (const h of matter.holds) {
        const frozen = await syncFreeze(tx, h.documentId, userId);
        if (frozen) stayFrozen.push(h.documentId);
      }

      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'LEGAL_MATTER_RELEASED',
        subjectType: SUBJECT_MATTER,
        subjectId: id,
        payload: {
          reference: matter.reference,
          reason: plan.reason,
          released: matter.holds.length,
          stillFrozenElsewhere: stayFrozen.length,
        },
      });
      return stayFrozen.length;
    });

    res.json({
      status: 'success',
      released: matter.holds.length,
      stillFrozenElsewhere: stillFrozenAfter,
      message: stillFrozenAfter > 0
        ? `Matter released. ${stillFrozenAfter} of its documents remain frozen by another matter.`
        : 'Matter released. Its documents are no longer frozen.',
    });
  } catch (error: any) {
    console.error('[Legal Matter Release Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to release the matter' });
  }
};

// ─── What holds one document ────────────────────────────────────────────────

export const documentHolds = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const id = str(req.params.id);

    const doc = await prisma.document.findFirst({
      where: { id, tenantId },
      select: { id: true, code: true, legalHoldAt: true, legalHoldMatter: true, legalHoldReason: true },
    });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }

    const holds = await prisma.legalHold.findMany({
      where: { documentId: id },
      include: {
        matter: { select: { id: true, reference: true, title: true, status: true } },
        placedBy: { select: { id: true, name: true } },
        releasedBy: { select: { id: true, name: true } },
      },
      orderBy: { placedAt: 'desc' },
    });

    res.json({
      status: 'success',
      frozen: Boolean(doc.legalHoldAt),
      legacyHold: isLegacyHold({
        legalHoldAt: doc.legalHoldAt,
        activeHoldCount: holds.filter((h) => !h.releasedAt).length,
      }),
      legacyMatter: doc.legalHoldMatter,
      summary: summariseMatter(holds),
      holds: holds.map((h) => ({
        id: h.id,
        matter: h.matter,
        reason: h.reason,
        placedBy: h.placedBy,
        placedAt: h.placedAt,
        releasedBy: h.releasedBy,
        releasedAt: h.releasedAt,
        releaseReason: h.releaseReason,
        heldForDays: heldForDays(h),
        active: !h.releasedAt,
      })),
    });
  } catch (error: any) {
    console.error('[Document Holds Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load what holds this document' });
  }
};
