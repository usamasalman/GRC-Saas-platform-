/**
 * Retention schedules, the disposition queue, and disposal.
 *
 * The rules are in services/retention and run without a database. This does
 * the loading, the writing, the file on disk and the audit entry.
 */

import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { hasCapability, CAP } from '../services/capabilityEngine';
import {
  planSchedule, planDisposal, dispositionState, daysUntilDisposal,
  summariseDisposition, disposalDateFor, triggerMomentFor,
  RETENTION_TRIGGERS, DEFAULT_RETAIN_MONTHS, DEFAULT_REVIEW_WINDOW_DAYS,
  MIN_RETAIN_MONTHS, MAX_RETAIN_MONTHS,
} from '../services/retention';

const SUBJECT_SCHEDULE = 'RetentionSchedule';
const SUBJECT_DOCUMENT = 'Document';
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

const str = (v: unknown): string => String(v ?? '');

/** The columns the disposition rules need. */
const RETAINED_SELECT = {
  id: true,
  code: true,
  title: true,
  status: true,
  classification: true,
  disposalDueAt: true,
  legalHoldAt: true,
  legalHoldMatter: true,
  disposedAt: true,
  retentionScheduleId: true,
} as const;

/**
 * Recompute when a document may be destroyed.
 *
 * Exported because publishing and archiving both start a clock, and a disposal
 * date that is only written when a schedule is assigned would be wrong for
 * every document whose trigger fired afterwards.
 *
 * Returns the date so a caller can record it. A null is not a failure: a
 * document on a Published schedule that has not been published has no disposal
 * date, and inventing one would put a destruction date on a record whose
 * retention has not begun.
 */
export async function recomputeDisposalDue(
  tx: { document: any; retentionSchedule: any },
  documentId: string,
): Promise<Date | null> {
  const doc = await tx.document.findUnique({
    where: { id: documentId },
    select: {
      id: true, createdAt: true, publishedAt: true, archivedAt: true,
      retentionScheduleId: true,
    },
  });
  if (!doc || !doc.retentionScheduleId) return null;

  const schedule = await tx.retentionSchedule.findUnique({
    where: { id: doc.retentionScheduleId },
    select: { retainMonths: true, trigger: true },
  });
  if (!schedule) return null;

  const startedAt = triggerMomentFor(schedule.trigger, doc);
  const due = disposalDateFor(startedAt, schedule.retainMonths);
  await tx.document.update({ where: { id: documentId }, data: { disposalDueAt: due } });
  return due;
}

// ─── Schedules ──────────────────────────────────────────────────────────────

export const listSchedules = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;

    const schedules = await prisma.retentionSchedule.findMany({
      where: { tenantId },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { documents: true } },
      },
      orderBy: { code: 'asc' },
    });

    res.json({
      status: 'success',
      count: schedules.length,
      triggers: RETENTION_TRIGGERS,
      bounds: { minMonths: MIN_RETAIN_MONTHS, maxMonths: MAX_RETAIN_MONTHS },
      defaults: {
        retainMonths: DEFAULT_RETAIN_MONTHS,
        reviewWindowDays: DEFAULT_REVIEW_WINDOW_DAYS,
      },
      schedules: schedules.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        description: s.description,
        retainMonths: s.retainMonths,
        trigger: s.trigger,
        reviewWindowDays: s.reviewWindowDays,
        isDefault: s.isDefault,
        documents: s._count.documents,
        createdBy: s.createdBy,
        createdAt: s.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('[Retention Schedules Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load retention schedules' });
  }
};

export const createSchedule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;

    const existing = await prisma.retentionSchedule.findMany({
      where: { tenantId },
      select: { code: true },
    });

    const plan = planSchedule({
      code: req.body?.code,
      name: req.body?.name,
      retainMonths: req.body?.retainMonths,
      trigger: req.body?.trigger,
      reviewWindowDays: req.body?.reviewWindowDays,
      takenCodes: existing.map((s) => s.code),
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      // One default per organisation: a document that names no schedule must
      // resolve to exactly one, or "the default" is a question with two answers.
      if (req.body?.isDefault === true) {
        await tx.retentionSchedule.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const row = await tx.retentionSchedule.create({
        data: {
          tenantId,
          code: plan.code,
          name: plan.name,
          description: str(req.body?.description).trim() || null,
          retainMonths: plan.retainMonths,
          trigger: plan.trigger,
          reviewWindowDays: plan.reviewWindowDays,
          isDefault: req.body?.isDefault === true,
          createdById: userId,
        },
      });

      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'RETENTION_SCHEDULE_CREATED',
        subjectType: SUBJECT_SCHEDULE,
        subjectId: row.id,
        payload: {
          code: row.code,
          name: row.name,
          retainMonths: row.retainMonths,
          trigger: row.trigger,
          isDefault: row.isDefault,
        },
      });

      return row;
    });

    res.status(201).json({ status: 'success', schedule: created });
  } catch (error: any) {
    console.error('[Retention Schedule Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create the retention schedule' });
  }
};

export const updateSchedule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = str(req.params.id);

    const current = await prisma.retentionSchedule.findFirst({ where: { id, tenantId } });
    if (!current) {
      res.status(404).json({ status: 'error', message: 'Retention schedule not found' });
      return;
    }

    const others = await prisma.retentionSchedule.findMany({
      where: { tenantId, id: { not: id } },
      select: { code: true },
    });

    const plan = planSchedule({
      code: req.body?.code ?? current.code,
      name: req.body?.name ?? current.name,
      retainMonths: req.body?.retainMonths ?? current.retainMonths,
      trigger: req.body?.trigger ?? current.trigger,
      reviewWindowDays: req.body?.reviewWindowDays ?? current.reviewWindowDays,
      takenCodes: others.map((s) => s.code),
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (req.body?.isDefault === true) {
        await tx.retentionSchedule.updateMany({
          where: { tenantId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const row = await tx.retentionSchedule.update({
        where: { id },
        data: {
          code: plan.code,
          name: plan.name,
          description: req.body?.description === undefined
            ? current.description
            : (str(req.body?.description).trim() || null),
          retainMonths: plan.retainMonths,
          trigger: plan.trigger,
          reviewWindowDays: plan.reviewWindowDays,
          isDefault: req.body?.isDefault === undefined ? current.isDefault : req.body.isDefault === true,
        },
      });

      // Changing the period moves every disposal date that derives from it.
      // Leaving the old dates would mean the schedule said one thing and the
      // queue another, and the queue is what somebody acts on.
      const bound = await tx.document.findMany({
        where: { retentionScheduleId: id },
        select: { id: true },
      });
      for (const d of bound) {
        await recomputeDisposalDue(tx as any, d.id);
      }

      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'RETENTION_SCHEDULE_UPDATED',
        subjectType: SUBJECT_SCHEDULE,
        subjectId: id,
        payload: {
          code: row.code,
          was: { retainMonths: current.retainMonths, trigger: current.trigger },
          now: { retainMonths: row.retainMonths, trigger: row.trigger },
          documentsRedated: bound.length,
        },
      });

      return row;
    });

    res.json({ status: 'success', schedule: updated });
  } catch (error: any) {
    console.error('[Retention Schedule Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update the retention schedule' });
  }
};

// ─── Binding a schedule to a document ───────────────────────────────────────

export const assignSchedule = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = str(req.params.id);
    const scheduleId = str(req.body?.scheduleId).trim();

    const doc = await prisma.document.findFirst({
      where: { id, tenantId },
      select: { id: true, code: true, disposedAt: true, retentionScheduleId: true },
    });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }
    if (doc.disposedAt) {
      res.status(409).json({
        status: 'error',
        code: 'ALREADY_DISPOSED',
        message: 'This document has been disposed of. Its schedule is part of the disposal record and does not change.',
      });
      return;
    }

    // An empty scheduleId removes the binding rather than failing, so a
    // document can be taken off a schedule without a second endpoint.
    let schedule = null as null | { id: string; code: string; retainMonths: number; trigger: string };
    if (scheduleId) {
      schedule = await prisma.retentionSchedule.findFirst({
        where: { id: scheduleId, tenantId },
        select: { id: true, code: true, retainMonths: true, trigger: true },
      });
      if (!schedule) {
        res.status(400).json({
          status: 'error',
          code: 'SCHEDULE_NOT_FOUND',
          message: 'That retention schedule does not exist in this organisation.',
        });
        return;
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id },
        data: { retentionScheduleId: schedule ? schedule.id : null },
      });
      const due = schedule ? await recomputeDisposalDue(tx as any, id) : null;
      if (!schedule) {
        await tx.document.update({ where: { id }, data: { disposalDueAt: null } });
      }

      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: schedule ? 'DOCUMENT_RETENTION_ASSIGNED' : 'DOCUMENT_RETENTION_CLEARED',
        subjectType: SUBJECT_DOCUMENT,
        subjectId: id,
        payload: {
          documentId: id,
          code: doc.code,
          scheduleCode: schedule ? schedule.code : null,
          retainMonths: schedule ? schedule.retainMonths : null,
          trigger: schedule ? schedule.trigger : null,
          disposalDueAt: due ? due.toISOString() : null,
        },
      });

      return due;
    });

    res.json({
      status: 'success',
      scheduleId: schedule ? schedule.id : null,
      disposalDueAt: result,
      // Said, because a schedule whose trigger has not fired yet produces no
      // date, and a silent null reads as "this did not work".
      note: schedule && !result
        ? `This document is on a ${schedule.trigger} schedule and has not been ${schedule.trigger.toLowerCase()} yet, so its retention has not started.`
        : null,
    });
  } catch (error: any) {
    console.error('[Retention Assign Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to set the retention schedule' });
  }
};

// ─── The queue ──────────────────────────────────────────────────────────────

/**
 * What is due for a decision.
 *
 * Derived on read rather than by a worker. The API has exactly two background
 * timers and no cron dependency, and the System Health screen already reported
 * a retention worker that did not exist -- adding a third timer to compute a
 * date that a query can derive would be inventing a moving part.
 */
export const dispositionQueue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const now = new Date();

    const [rows, scheduleCount] = await Promise.all([
      prisma.document.findMany({
        where: { tenantId, OR: [{ disposalDueAt: { not: null } }, { legalHoldAt: { not: null } }] },
        select: {
          ...RETAINED_SELECT,
          retentionSchedule: { select: { id: true, code: true, name: true, reviewWindowDays: true } },
        },
        orderBy: [{ disposalDueAt: 'asc' }],
        take: 500,
      }),
      prisma.retentionSchedule.count({ where: { tenantId } }),
    ]);

    const withState = rows.map((d) => {
      const state = dispositionState(
        { ...d, reviewWindowDays: d.retentionSchedule?.reviewWindowDays ?? null },
        now,
      );
      return {
        id: d.id,
        code: d.code,
        title: d.title,
        status: d.status,
        classification: d.classification,
        schedule: d.retentionSchedule,
        disposalDueAt: d.disposalDueAt,
        daysUntil: daysUntilDisposal(d, now),
        legalHoldMatter: d.legalHoldMatter,
        state,
      };
    });

    res.json({
      status: 'success',
      count: withState.length,
      summary: summariseDisposition(
        rows.map((d) => ({ ...d, reviewWindowDays: d.retentionSchedule?.reviewWindowDays ?? null })),
        now,
        scheduleCount,
      ),
      // Only what a person is being asked to act on. Held rows are carried
      // separately so the reason disposal cannot proceed is visible rather
      // than the document simply being absent.
      queue: withState.filter((d) => d.state === 'Due' || d.state === 'DueSoon'),
      held: withState.filter((d) => d.state === 'Held'),
    });
  } catch (error: any) {
    console.error('[Disposition Queue Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the disposition queue' });
  }
};

// ─── Disposal ───────────────────────────────────────────────────────────────

export const disposeDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const id = str(req.params.id);

    const doc = await prisma.document.findFirst({
      where: { id, tenantId },
      select: {
        ...RETAINED_SELECT,
        fileUrl: true,
        version: true,
        retentionSchedule: { select: { code: true, name: true, retainMonths: true, reviewWindowDays: true } },
      },
    });
    if (!doc) { res.status(404).json({ status: 'error', message: 'Document not found' }); return; }

    // Checked here as well as on the route. The route guard is the gate; this
    // is the rule, and a rule that only exists as a route guard cannot be
    // tested without standing up Express.
    const mayDispose = await hasCapability(userId, CAP.RETENTION_HOLD);

    const plan = planDisposal({
      doc: { ...doc, reviewWindowDays: doc.retentionSchedule?.reviewWindowDays ?? null },
      reason: req.body?.reason,
      now: new Date(),
      mayDispose,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    const disposedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id },
        data: {
          // The content is what is destroyed. Everything that proves the
          // document existed, was approved and was read stays.
          content: '',
          fileUrl: null,
          fileName: null,
          fileSize: null,
          fileType: null,
          status: 'DISPOSED',
          disposedAt,
          disposedById: userId,
          disposalReason: plan.reason,
        },
      });

      await writeAudit(tx, {
        tenantId,
        actorId: userId,
        action: 'DOCUMENT_DISPOSED',
        subjectType: SUBJECT_DOCUMENT,
        subjectId: id,
        // The code and title are in the payload on purpose. Every other
        // document audit entry carries only a uuid, and after disposal the
        // row still exists to resolve it -- but the schedule it was destroyed
        // under is the part an auditor asks for, and it lives nowhere else
        // once the binding could be changed.
        payload: {
          documentId: id,
          code: doc.code,
          title: doc.title,
          version: doc.version,
          classification: doc.classification,
          scheduleCode: doc.retentionSchedule?.code ?? null,
          retainMonths: doc.retentionSchedule?.retainMonths ?? null,
          disposalDueAt: doc.disposalDueAt ? doc.disposalDueAt.toISOString() : null,
          reason: plan.reason,
          fileRemoved: Boolean(doc.fileUrl),
        },
      });
    });

    // The file last, and outside the transaction, because a filesystem delete
    // cannot be rolled back. If this throws the record still says disposed,
    // which is recoverable by deleting the file again; the reverse -- bytes
    // gone with no record of who authorised it -- is not.
    let fileRemoved = false;
    if (doc.fileUrl && typeof doc.fileUrl === 'string' && doc.fileUrl.startsWith('/uploads/')) {
      try {
        const fullPath = path.join(UPLOADS_DIR, doc.fileUrl.replace('/uploads/', ''));
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          fileRemoved = true;
        }
      } catch (e) {
        // Said rather than swallowed: a disposal that left the bytes on disk
        // is a disposal that did not happen, and somebody has to know.
        console.error('[Disposal File Remove Error]:', e);
      }
    }

    res.json({
      status: 'success',
      message: 'The document has been disposed of. Its approval, acknowledgement and access history remain.',
      disposedAt,
      fileRemoved,
      // Honest about the one part that can fail after the record is written.
      warning: doc.fileUrl && !fileRemoved
        ? 'The record is marked disposed but the stored file could not be removed. It must be deleted from the uploads directory.'
        : null,
    });
  } catch (error: any) {
    console.error('[Disposal Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to dispose of the document' });
  }
};
