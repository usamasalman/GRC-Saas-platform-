import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { guardProject, notFound, readOnly, isFrozen, frozen } from '../services/projectGuard';
import { recomputeProject } from '../services/projectRollup';
import { checkTaskTransition } from '../services/projectLifecycle';
import {
  IMPEDIMENT_KINDS, IMPEDIMENT_CATEGORIES, OWING_SIDES, IMPEDIMENT_SEVERITIES,
  checkImpedimentInput, checkResolvable, attribute, impedimentCost, isOpen, signedDays,
  requiresDelayReason, slippage, slipCost,
} from '../services/projectDelay';

/**
 * The impediment register — what is costing this engagement time, and who owes
 * its resolution.
 *
 * Two shapes in one register, because the only report worth producing sums
 * them: a blocker is work that cannot proceed, a delay is a date that moved.
 * The first has a lifecycle; the second is a point event, recorded and closed
 * in the same instant because the time is already gone.
 *
 * `owingSide` is what makes this more than a notes field. On consultant-led
 * work every steering meeting argues about whose fault the slip was, and the
 * argument is unwinnable afterwards because nobody wrote it down at the time.
 * Recorded when the time is lost, by the person losing it, it stops being an
 * argument and becomes a sum.
 */

const str = (v: unknown): string => String(v ?? '');
const MIN_NOTE = 10;

/** IMP-0001, sequential per project. Matches the task and project conventions. */
async function nextRef(projectId: string): Promise<string> {
  const count = await prisma.projectImpediment.count({ where: { projectId } });
  return `IMP-${String(count + 1).padStart(4, '0')}`;
}

const SELECT = {
  id: true, ref: true, kind: true, category: true, owingSide: true, severity: true,
  title: true, description: true, impactDays: true, expectedClearDate: true,
  raisedAt: true, resolvedAt: true, resolutionNote: true,
  raisedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
  task: { select: { id: true, ref: true, name: true, status: true } },
  phase: { select: { id: true, name: true, sequence: true } },
} as const;

/** Adds the cost, which is a reading of the clock rather than a column. */
const decorate = (imp: any, now: Date) => ({
  ...imp,
  open: isOpen(imp),
  costDays: impedimentCost(imp, now),
});

// ─── Raise ──────────────────────────────────────────────────────────────────

/**
 * Record something costing the engagement time.
 *
 * Scope is whatever the caller attaches it to: a task, a phase, or the
 * engagement as a whole. "The client has not appointed an ISMS owner" holds up
 * a programme rather than a checkbox, and a register that can only attach to
 * tasks forces someone to invent a fake task to hang it on.
 *
 * This does not change any task status — raising a concern is not the same act
 * as stopping work. Blocking goes through blockTask, which does both.
 */
export const raiseImpediment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project, canWrite, side } = await guardProject(
      str(req.user!.tenantId), str(req.params.id),
    );
    if (!project) { notFound(res); return; }
    if (!canWrite && side !== 'Provider') { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const b = req.body || {};
    const kind = b.kind ? str(b.kind) : 'Blocker';

    const refusal = checkImpedimentInput({ kind, category: b.category, owingSide: b.owingSide });
    if (refusal) {
      res.status(400).json({ status: 'error', code: refusal.code, message: refusal.message });
      return;
    }
    if (!b.title || str(b.title).trim().length < 3) {
      res.status(400).json({ status: 'error', message: 'title is required' });
      return;
    }
    if (b.severity && !(IMPEDIMENT_SEVERITIES as readonly string[]).includes(str(b.severity))) {
      res.status(400).json({
        status: 'error',
        message: `severity must be one of: ${IMPEDIMENT_SEVERITIES.join(', ')}`,
      });
      return;
    }

    // A delay is closed at birth: the days are already spent, so the caller
    // states them and there is nothing left to clear.
    const isDelay = kind === 'Delay';
    const impactDays = b.impactDays === undefined ? null : Math.max(0, Number(b.impactDays) || 0);
    if (isDelay && impactDays === null) {
      res.status(400).json({
        status: 'error',
        code: 'IMPACT_REQUIRED',
        message: 'A recorded delay must say how many days it cost.',
      });
      return;
    }

    const scope = await resolveScope(project.id, b.taskId, b.phaseId);
    if (scope === null) {
      res.status(400).json({
        status: 'error',
        message: 'taskId or phaseId must belong to this project',
      });
      return;
    }

    const now = new Date();
    const ref = await nextRef(project.id);

    const created = await prisma.$transaction(async (tx) => {
      const imp = await tx.projectImpediment.create({
        data: {
          projectId: project.id,
          taskId: scope.taskId,
          phaseId: scope.phaseId,
          ref,
          kind,
          category: str(b.category),
          owingSide: str(b.owingSide),
          severity: b.severity ? str(b.severity) : 'Medium',
          title: str(b.title).trim(),
          description: b.description ? str(b.description) : null,
          impactDays: isDelay ? impactDays : null,
          expectedClearDate: b.expectedClearDate ? new Date(b.expectedClearDate) : null,
          raisedById: str(req.user!.id),
          raisedAt: now,
          ...(isDelay ? { resolvedAt: now, resolvedById: str(req.user!.id) } : {}),
        },
        select: SELECT,
      });

      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: isDelay ? 'PROJECT_DELAY_RECORDED' : 'PROJECT_BLOCKER_RAISED',
        subjectType: 'ProjectImpediment',
        subjectId: imp.id,
        payload: {
          projectRef: project.ref, ref, kind,
          category: b.category, owingSide: b.owingSide, impactDays,
        },
      });

      // The side that owes it cannot be notified — it is an organisation, not a
      // person — so the people accountable for the plan are told instead.
      await notify(tx, [project.managerId, project.ownerId].map((rid) => ({
        tenantId: project.tenantId,
        recipientId: rid,
        actorId: str(req.user!.id),
        event: isDelay ? 'PROJECT_DELAY_RECORDED' : 'PROJECT_BLOCKER_RAISED',
        subjectType: 'ProjectImpediment',
        subjectId: imp.id,
        title: isDelay
          ? `${ref}: ${impactDays} day(s) lost on ${project.name}`
          : `${ref}: work blocked on ${project.name}`,
        body: `${str(b.title).trim()} — owed by ${b.owingSide}.`,
        link: 'project-delivery',
      })));

      return imp;
    });

    res.status(201).json({ status: 'success', impediment: decorate(created, now) });
  } catch (error: any) {
    console.error('[Impediment Raise Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the impediment' });
  }
};

/** Confirms a supplied task or phase belongs to this project. Null means it does not. */
async function resolveScope(projectId: string, taskId: unknown, phaseId: unknown) {
  const scope: { taskId: string | null; phaseId: string | null } = { taskId: null, phaseId: null };

  if (taskId) {
    const task = await prisma.projectTask.findFirst({
      where: { id: str(taskId), projectId },
      select: { id: true, phaseId: true },
    });
    if (!task) return null;
    // A task-scoped impediment is also phase-scoped, so a phase report does not
    // have to join through every task to find what is holding it up.
    scope.taskId = task.id;
    scope.phaseId = task.phaseId;
    return scope;
  }
  if (phaseId) {
    const phase = await prisma.projectPhase.findFirst({
      where: { id: str(phaseId), projectId },
      select: { id: true },
    });
    if (!phase) return null;
    scope.phaseId = phase.id;
  }
  return scope;
}

// ─── Block ──────────────────────────────────────────────────────────────────

/**
 * Stop work on a task and say why, in one act.
 *
 * Blocked is the status that appears on a steering report and explains nothing,
 * so it is not settable on its own. The same reasoning that routes Verified
 * through a verification record routes Blocked through a blocker: the status
 * follows the record, rather than the record chasing the status.
 */
export const blockTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = str(req.params.taskId);
    const task = await prisma.projectTask.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true, phaseId: true, ref: true, name: true, status: true, assigneeId: true },
    });
    if (!task) { notFound(res); return; }

    const { project, canWrite, side } = await guardProject(str(req.user!.tenantId), task.projectId);
    if (!project) { notFound(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const userId = str(req.user!.id);
    if (!canWrite && task.assigneeId !== userId && side !== 'Provider') { readOnly(res); return; }

    const b = req.body || {};
    const refusal = checkImpedimentInput({
      kind: 'Blocker', category: b.category, owingSide: b.owingSide,
    });
    if (refusal) {
      res.status(400).json({ status: 'error', code: refusal.code, message: refusal.message });
      return;
    }
    if (!b.title || str(b.title).trim().length < 3) {
      res.status(400).json({ status: 'error', message: 'title is required — say what is blocking it' });
      return;
    }

    const move = checkTaskTransition(task.status, 'Blocked');
    if (move) {
      res.status(409).json({ status: 'error', code: move.code, message: move.message });
      return;
    }

    const now = new Date();
    const ref = await nextRef(project.id);

    const result = await prisma.$transaction(async (tx) => {
      const impediment = await tx.projectImpediment.create({
        data: {
          projectId: project.id,
          taskId: task.id,
          phaseId: task.phaseId,
          ref,
          kind: 'Blocker',
          category: str(b.category),
          owingSide: str(b.owingSide),
          severity: b.severity ? str(b.severity) : 'Medium',
          title: str(b.title).trim(),
          description: b.description ? str(b.description) : null,
          expectedClearDate: b.expectedClearDate ? new Date(b.expectedClearDate) : null,
          raisedById: userId,
          raisedAt: now,
        },
        select: SELECT,
      });

      const updated = await tx.projectTask.update({
        where: { id: task.id },
        data: { status: 'Blocked' },
      });

      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: userId,
        action: 'PROJECT_TASK_BLOCKED',
        subjectType: 'ProjectTask',
        subjectId: task.id,
        payload: {
          projectRef: project.ref, ref: task.ref, impediment: ref,
          category: b.category, owingSide: b.owingSide,
        },
      });

      await notify(tx, [project.managerId, project.ownerId, task.assigneeId].map((rid) => ({
        tenantId: project.tenantId,
        recipientId: rid,
        actorId: userId,
        event: 'PROJECT_TASK_BLOCKED',
        subjectType: 'ProjectTask',
        subjectId: task.id,
        title: `${task.ref} is blocked`,
        body: `${str(b.title).trim()} — owed by ${b.owingSide}.`,
        link: 'project-delivery',
      })));

      const rollup = await recomputeProject(tx, project.id);
      return { impediment, updated, rollup };
    });

    res.status(201).json({
      status: 'success',
      impediment: decorate(result.impediment, now),
      task: result.updated,
      rollup: result.rollup,
    });
  } catch (error: any) {
    console.error('[Task Block Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to block the task' });
  }
};

// ─── Resolve ────────────────────────────────────────────────────────────────

/**
 * Clear a blocker and stamp what it cost.
 *
 * The cost is computed at this moment and stored, rather than left derived,
 * because a blocker stops accruing when it clears — a column that keeps
 * counting from raisedAt would be wrong from the moment it started mattering.
 *
 * A task whose last open blocker clears goes back to in progress. It does not
 * go back to whatever it was before: work that was stopped is being picked up
 * again, and restoring NotStarted would lose that.
 */
export const resolveImpediment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = str(req.params.impedimentId);
    const imp = await prisma.projectImpediment.findUnique({
      where: { id },
      select: {
        id: true, ref: true, kind: true, projectId: true, taskId: true,
        raisedAt: true, resolvedAt: true, raisedById: true, title: true,
      },
    });
    if (!imp) { notFound(res); return; }

    const { project, canWrite, side } = await guardProject(str(req.user!.tenantId), imp.projectId);
    if (!project) { notFound(res); return; }
    if (!canWrite && side !== 'Provider') { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const refusal = checkResolvable(imp);
    if (refusal) {
      res.status(409).json({ status: 'error', code: refusal.code, message: refusal.message });
      return;
    }

    const note = req.body?.resolutionNote ? str(req.body.resolutionNote).trim() : '';
    if (note.length < MIN_NOTE) {
      res.status(400).json({
        status: 'error',
        code: 'REASON_REQUIRED',
        message: `Say how it was cleared — at least ${MIN_NOTE} characters. "Resolved" with `
          + 'no account of how is the entry that makes a register useless six months later.',
      });
      return;
    }

    const now = new Date();
    const userId = str(req.user!.id);
    const cost = Math.max(0, signedDays(imp.raisedAt, now));

    const result = await prisma.$transaction(async (tx) => {
      const cleared = await tx.projectImpediment.update({
        where: { id },
        data: {
          resolvedAt: now, resolvedById: userId, resolutionNote: note, impactDays: cost,
        },
        select: SELECT,
      });

      // Only the last blocker standing releases the task. Clearing one of three
      // and reporting the work as moving again would be a lie the plan screen
      // would then repeat.
      let released: any = null;
      if (imp.taskId) {
        const stillBlocked = await tx.projectImpediment.count({
          where: { taskId: imp.taskId, kind: 'Blocker', resolvedAt: null },
        });
        if (stillBlocked === 0) {
          const task = await tx.projectTask.findUnique({
            where: { id: imp.taskId }, select: { status: true },
          });
          if (task?.status === 'Blocked') {
            released = await tx.projectTask.update({
              where: { id: imp.taskId },
              data: { status: 'InProgress' },
            });
          }
        }
      }

      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: userId,
        action: 'PROJECT_BLOCKER_CLEARED',
        subjectType: 'ProjectImpediment',
        subjectId: id,
        payload: { projectRef: project.ref, ref: imp.ref, costDays: cost, released: !!released },
      });

      await notify(tx, {
        tenantId: project.tenantId,
        recipientId: imp.raisedById,
        actorId: userId,
        event: 'PROJECT_BLOCKER_CLEARED',
        subjectType: 'ProjectImpediment',
        subjectId: id,
        title: `${imp.ref} has been cleared`,
        body: `${imp.title} — ${cost} day(s) lost.`,
        link: 'project-delivery',
      });

      const rollup = await recomputeProject(tx, project.id);
      return { cleared, released, rollup };
    });

    res.json({
      status: 'success',
      impediment: decorate(result.cleared, now),
      task: result.released,
      rollup: result.rollup,
    });
  } catch (error: any) {
    console.error('[Impediment Resolve Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to clear the impediment' });
  }
};

// ─── Reschedule ─────────────────────────────────────────────────────────────

/**
 * Move a task's due date past the one that was agreed, and say why.
 *
 * The ordinary task update refuses a date that slips beyond the baseline and
 * points here, for the same reason Blocked and Verified are routed away from
 * it: a plan whose dates can be quietly moved is a plan that is never late.
 *
 * The test is against the baseline rather than against today. Moving a task
 * from day 10 to day 20 on day 3 is a slip against the agreed plan even though
 * nothing is overdue yet, and a rule that waits for the date to pass only ever
 * catches slips after they have cost something.
 *
 * Pulling a date IN needs no ceremony and goes through the ordinary update.
 */
export const rescheduleTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = str(req.params.taskId);
    const task = await prisma.projectTask.findUnique({
      where: { id: taskId },
      select: {
        id: true, projectId: true, phaseId: true, ref: true, name: true,
        dueDate: true, baselineDueDate: true, assigneeId: true,
      },
    });
    if (!task) { notFound(res); return; }

    const { project, canWrite } = await guardProject(str(req.user!.tenantId), task.projectId);
    if (!project) { notFound(res); return; }
    if (!canWrite) { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const b = req.body || {};
    if (!b.dueDate) {
      res.status(400).json({ status: 'error', message: 'dueDate is required' });
      return;
    }
    const newDue = new Date(b.dueDate);
    if (Number.isNaN(newDue.getTime())) {
      res.status(400).json({ status: 'error', message: 'dueDate must be a valid date' });
      return;
    }

    const refusal = checkImpedimentInput({
      kind: 'Delay', category: b.category, owingSide: b.owingSide,
    });
    if (refusal) {
      res.status(400).json({ status: 'error', code: refusal.code, message: refusal.message });
      return;
    }
    const reason = b.reason ? str(b.reason).trim() : '';
    if (reason.length < MIN_NOTE) {
      res.status(400).json({
        status: 'error',
        code: 'REASON_REQUIRED',
        message: `Say why the date is moving — at least ${MIN_NOTE} characters.`,
      });
      return;
    }

    // A date that is not actually slipping does not belong here; sending it
    // through would put a fictitious delay in the register.
    if (!requiresDelayReason(task.baselineDueDate, task.dueDate, newDue)) {
      res.status(400).json({
        status: 'error',
        code: 'NOT_A_SLIP',
        message: task.baselineDueDate
          ? 'That date does not move past the agreed one. Change it through the ordinary '
            + 'task update — pulling a date in needs no explanation.'
          : 'This task has no agreed date yet, so it can be planned freely through the '
            + 'ordinary task update.',
      });
      return;
    }

    // The increase in slip against the agreed date, not the distance the date
    // travelled — see slipCost. The difference matters whenever a date has
    // already moved, and only this version sums to the task's actual slippage.
    const cost = slipCost(task.baselineDueDate!, task.dueDate, newDue);

    const now = new Date();
    const ref = await nextRef(project.id);

    const result = await prisma.$transaction(async (tx) => {
      const impediment = await tx.projectImpediment.create({
        data: {
          projectId: project.id,
          taskId: task.id,
          phaseId: task.phaseId,
          ref,
          kind: 'Delay',
          category: str(b.category),
          owingSide: str(b.owingSide),
          severity: b.severity ? str(b.severity) : 'Medium',
          title: `${task.ref} moved ${cost} day(s)`,
          description: reason,
          impactDays: cost,
          raisedById: str(req.user!.id),
          raisedAt: now,
          resolvedAt: now,
          resolvedById: str(req.user!.id),
          resolutionNote: reason,
        },
        select: SELECT,
      });

      const updated = await tx.projectTask.update({
        where: { id: task.id },
        data: { dueDate: newDue },
      });

      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_TASK_RESCHEDULED',
        subjectType: 'ProjectTask',
        subjectId: task.id,
        payload: {
          projectRef: project.ref, ref: task.ref, impediment: ref,
          from: (task.dueDate || task.baselineDueDate)?.toISOString() || null,
          to: newDue.toISOString(),
          slipDays: cost, category: b.category, owingSide: b.owingSide,
        },
      });

      await notify(tx, [project.managerId, project.ownerId, task.assigneeId].map((rid) => ({
        tenantId: project.tenantId,
        recipientId: rid,
        actorId: str(req.user!.id),
        event: 'PROJECT_TASK_RESCHEDULED',
        subjectType: 'ProjectTask',
        subjectId: task.id,
        title: `${task.ref} slipped ${cost} day(s)`,
        body: `${reason} — owed by ${b.owingSide}.`,
        link: 'project-delivery',
      })));

      return { impediment, updated };
    });

    res.json({
      status: 'success',
      impediment: decorate(result.impediment, now),
      task: { ...result.updated, slippage: slippage(result.updated) },
    });
  } catch (error: any) {
    console.error('[Task Reschedule Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reschedule the task' });
  }
};

// ─── The register ───────────────────────────────────────────────────────────

/**
 * Everything costing this engagement time, and the attribution.
 *
 * The summary is the answer to the question the register exists for: of the
 * days this programme has lost, how many were owed by each side. It is computed
 * from the same rows the list shows, so a reader can always check the total by
 * counting.
 */
export const getImpediments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project } = await guardProject(str(req.user!.tenantId), str(req.params.id));
    if (!project) { notFound(res); return; }

    const where: any = { projectId: project.id };
    if (req.query.open === 'true') Object.assign(where, { kind: 'Blocker', resolvedAt: null });
    if (req.query.owingSide) where.owingSide = str(req.query.owingSide);

    const impediments = await prisma.projectImpediment.findMany({
      where,
      orderBy: [{ resolvedAt: 'asc' }, { raisedAt: 'desc' }],
      select: SELECT,
    });

    const now = new Date();

    res.json({
      status: 'success',
      projectId: project.id,
      impediments: impediments.map((i) => decorate(i, now)),
      summary: attribute(impediments as any, now),
      vocabulary: {
        kinds: IMPEDIMENT_KINDS,
        categories: IMPEDIMENT_CATEGORIES,
        owingSides: OWING_SIDES,
        severities: IMPEDIMENT_SEVERITIES,
      },
    });
  } catch (error: any) {
    console.error('[Impediment Register Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the impediment register' });
  }
};
