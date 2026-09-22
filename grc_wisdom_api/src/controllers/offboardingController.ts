/**
 * Offboarding, and the handover that has to happen first.
 *
 * The rules and the classification are in services/offboarding and run without
 * a database. This does the counting, the moving and the audit entry.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import {
  planOffboarding, planApprovalHandover, summariseHandover,
  HANDOVER_TARGETS, WITHDRAW_TARGETS,
  type HandoverCount, type PersonFacts,
} from '../services/offboarding';

const SUBJECT_USER = 'User';
const str = (v: unknown): string => String(v ?? '');

/**
 * ~25 updateMany statements plus the withdrawals and one audit append.
 *
 * Prisma's interactive transactions default to five seconds and nothing in
 * this API sets otherwise, so a tenant of any size would hit P2028 and roll
 * the whole handover back having done nothing. Raised deliberately, because a
 * partial handover is the one outcome worse than a slow one.
 */
const HANDOVER_TIMEOUT_MS = 30_000;

const PERSON_SELECT = { id: true, tenantId: true, status: true, name: true, email: true } as const;

/** The predicate for one target, always scoped to the tenant where possible. */
function whereFor(
  target: { column: string; where?: Record<string, unknown>; tenantScoped: boolean },
  personId: string,
  tenantId: string,
): Record<string, unknown> {
  const where: Record<string, unknown> = { [target.column]: personId, ...(target.where || {}) };
  // Belt and braces. Every id here came from a tenant-scoped lookup, but a
  // handover that lost its tenant filter would reassign another organisation's
  // records, and that is not a mistake worth leaving to one layer.
  if (target.tenantScoped) where.tenantId = tenantId;
  return where;
}

async function countHoldings(personId: string, tenantId: string): Promise<HandoverCount[]> {
  const counts: HandoverCount[] = [];
  for (const target of HANDOVER_TARGETS) {
    const delegate = (prisma as any)[target.model];
    if (!delegate || typeof delegate.count !== 'function') continue;
    const count = await delegate.count({ where: whereFor(target, personId, tenantId) });
    counts.push({ label: target.label, model: target.model, column: target.column, count });
  }
  return counts;
}

/**
 * What would happen, before it happens.
 *
 * An offboarding moves every risk, control, document, project and open ticket
 * somebody held. Doing that on a confirm dialog alone asks an administrator to
 * authorise a blast radius they were never shown.
 */
export const previewOffboarding = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const id = str(req.params.id);

    const leaver = await prisma.user.findFirst({ where: { id, tenantId }, select: PERSON_SELECT });
    if (!leaver) { res.status(404).json({ status: 'error', message: 'That person is not in this organisation.' }); return; }

    const [counts, acknowledgements, checkouts] = await Promise.all([
      countHoldings(id, tenantId),
      prisma.acknowledgementRequest.count({ where: { userId: id } }),
      prisma.document.count({ where: { tenantId, checkedOutBy: id } }),
    ]);

    res.json({
      status: 'success',
      leaver: { id: leaver.id, name: leaver.name, email: leaver.email, status: leaver.status },
      summary: summariseHandover(counts),
      withdraw: {
        acknowledgementRequests: acknowledgements,
        checkedOutDocuments: checkouts,
        what: WITHDRAW_TARGETS,
      },
      // Said plainly, because it is the part an administrator is most likely to
      // assume works the other way.
      note: 'History stays with this person. Approvals they signed, policies they '
        + 'acknowledged, versions they wrote and audit entries they caused keep their name.',
    });
  } catch (error: any) {
    console.error('[Offboarding Preview Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to work out what this person holds' });
  }
};

export const offboardUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const actorId = req.user!.id;
    const id = str(req.params.id);
    const successorId = str(req.body?.successorId).trim();

    const [leaver, successor] = await Promise.all([
      prisma.user.findFirst({ where: { id, tenantId }, select: PERSON_SELECT }),
      successorId
        ? prisma.user.findFirst({ where: { id: successorId }, select: PERSON_SELECT })
        : Promise.resolve(null),
    ]);

    const plan = planOffboarding({
      actorId,
      leaver: leaver as PersonFacts | null,
      successor: successor as PersonFacts | null,
      reason: req.body?.reason,
    });
    if (!plan.ok) {
      res.status(plan.status).json({ status: 'error', code: plan.code, message: plan.message });
      return;
    }

    // Separation of duties on the approvals that are about to move. Handing a
    // pending signature to somebody who wrote the version would create a
    // document that the approve endpoint then refuses forever.
    const pending = await prisma.approvalQueue.findMany({
      where: { approverId: id, status: 'PENDING' },
      select: { id: true, documentId: true },
    });

    const approvalRows = [];
    for (const row of pending) {
      const [doc, others] = await Promise.all([
        prisma.document.findUnique({
          where: { id: row.documentId },
          select: {
            version: true,
            versions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdById: true, editors: { select: { userId: true } } },
            },
          },
        }),
        prisma.approvalQueue.findMany({
          where: { documentId: row.documentId, approverId: { not: id } },
          select: { approverId: true },
        }),
      ]);
      const v = doc?.versions?.[0];
      const editorIds = [
        ...(v?.createdById ? [v.createdById] : []),
        ...(v?.editors || []).map((e) => e.userId),
      ];
      approvalRows.push({
        id: row.id,
        documentId: row.documentId,
        editorIds,
        otherApproverIds: others.map((o) => o.approverId),
      });
    }

    const approvals = planApprovalHandover(approvalRows, successor!.id);
    const withdrawIds = approvals.withdraw.map((w) => w.id);

    const moved = await prisma.$transaction(async (tx) => {
      const counts: HandoverCount[] = [];

      for (const target of HANDOVER_TARGETS) {
        const delegate = (tx as any)[target.model];
        if (!delegate || typeof delegate.updateMany !== 'function') continue;

        const where = whereFor(target, id, tenantId);
        // The approvals the successor may not hold are excluded here and
        // withdrawn below, rather than moved and then refused at signing time.
        if (target.model === 'approvalQueue' && withdrawIds.length > 0) {
          where.id = { notIn: withdrawIds };
        }

        const result = await delegate.updateMany({ where, data: { [target.column]: successor!.id } });
        counts.push({
          label: target.label, model: target.model, column: target.column, count: result.count,
        });
      }

      // Withdraw what cannot be moved.
      if (withdrawIds.length > 0) {
        await tx.approvalQueue.deleteMany({ where: { id: { in: withdrawIds } } });
      }
      const acks = await tx.acknowledgementRequest.deleteMany({ where: { userId: id } });
      const checkouts = await tx.document.updateMany({
        where: { tenantId, checkedOutBy: id },
        data: { checkedOutBy: null, checkedOutAt: null, isLockedOut: false },
      });

      await tx.user.update({
        where: { id },
        data: {
          status: 'Inactive',
          offboardedAt: new Date(),
          offboardedById: actorId,
          successorId: successor!.id,
          // Ends the session as well as the account. setUserStatus already
          // does this for a suspension; an offboarding that left a live
          // refresh token would leave the person working for a week.
          refreshTokenHash: null,
          refreshTokenExpiresAt: null,
        },
      });

      const summary = summariseHandover(counts);

      // One entry naming both people. writeAudit hashes only the previous
      // hash, the action, the payload and a timestamp, so two entries with the
      // same action and payload inside one millisecond collide on the unique
      // currentHash — which is a second reason not to write one per model.
      await writeAudit(tx, {
        tenantId,
        actorId,
        action: 'USER_OFFBOARDED',
        subjectType: SUBJECT_USER,
        subjectId: id,
        payload: {
          leaver: { id: leaver!.id, name: leaver!.name, email: leaver!.email },
          successor: { id: successor!.id, name: successor!.name, email: successor!.email },
          reason: plan.reason,
          recordsMoved: summary.total,
          movedByKind: summary.moving.map((c) => ({ what: c.label, count: c.count })),
          acknowledgementRequestsWithdrawn: acks.count,
          checkoutsReleased: checkouts.count,
          // Named, not counted: withdrawing an approval changes the quorum for
          // that document, and whoever reads this later needs to know which.
          approvalsWithdrawn: approvals.withdraw,
        },
      });

      return { summary, acks: acks.count, checkouts: checkouts.count };
    }, { timeout: HANDOVER_TIMEOUT_MS });

    res.json({
      status: 'success',
      message: `${leaver!.name} has been offboarded. ${moved.summary.total} record`
        + `${moved.summary.total === 1 ? '' : 's'} now name ${successor!.name}.`,
      summary: moved.summary,
      acknowledgementRequestsWithdrawn: moved.acks,
      checkoutsReleased: moved.checkouts,
      approvalsWithdrawn: approvals.withdraw,
    });
  } catch (error: any) {
    console.error('[Offboarding Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to offboard this person. Nothing was changed.' });
  }
};
