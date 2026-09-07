import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { guardProject, notFound, readOnly, isFrozen, frozen } from '../services/projectGuard';
import { recomputeProject } from '../services/projectRollup';
import { requiresDelayReason, slippage } from '../services/projectDelay';
import {
  TASK_STATUSES, VERIFICATION_POLICIES, checkTaskUpdate, requiresVerification,
  taskTiming, taskCounts, isComplete,
} from '../services/projectLifecycle';

/**
 * The work breakdown — phases and the tasks beneath them.
 *
 * Separate from projectController so that file stays about the engagement
 * itself. Both share the same four-step shape: resolve scope, authorise, mutate
 * in a transaction, write one audit entry.
 *
 * Every mutation that can move a percentage calls recomputeProject inside the
 * same transaction, so the stored figures are never observable disagreeing with
 * the tasks that produced them.
 */

const str = (v: unknown): string => String(v ?? '');
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const SIDES = ['Client', 'Provider'];

/**
 * verificationOverride is tri-state, so it needs a parser that can tell "the
 * caller sent null on purpose" from "the caller sent nonsense".
 *
 * A sentinel rather than a thrown error because every other validation in this
 * file answers with a 400 and a sentence, and one branch that throws would be
 * the one that returns a 500 in production.
 */
export const INVALID = Symbol('invalid');

function parseOverride(v: unknown): boolean | null | typeof INVALID {
  // undefined and null both mean "follow the project policy" — a task created
  // without mentioning verification is not a malformed request.
  if (v === null || v === undefined) return null;
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return INVALID;
}

/** TSK-0001, sequential per project. */
async function nextTaskRef(projectId: string): Promise<string> {
  const count = await prisma.projectTask.count({ where: { projectId } });
  return `TSK-${String(count + 1).padStart(4, '0')}`;
}

/**
 * Load a project and decide what this caller may do with it.
 *
 * Lives in services/projectGuard so this file and the verification controller
 * cannot drift on who may touch an engagement.
 */
const authorise = (req: AuthenticatedRequest, projectId: string) =>
  guardProject(str(req.user!.tenantId), projectId);

// ─── The plan ───────────────────────────────────────────────────────────────

export const getPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project } = await authorise(req, str(req.params.id));
    if (!project) { notFound(res); return; }

    const phases = await prisma.projectPhase.findMany({
      where: { projectId: project.id },
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, sequence: true, name: true, description: true, objectives: true,
        startDate: true, targetEndDate: true, status: true,
        reportedProgress: true, verifiedProgress: true,
        owner: { select: { id: true, name: true, email: true } },
        tasks: {
          orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true, ref: true, sequence: true, name: true, description: true,
            status: true, completionPercent: true, weight: true, priority: true,
            side: true, department: true, startDate: true, dueDate: true, completedAt: true,
            verificationOverride: true, verificationRound: true,
            submittedAt: true, verifiedAt: true,
            baselineStartDate: true, baselineDueDate: true,
            assignee: { select: { id: true, name: true, email: true } },
            submittedBy: { select: { id: true, name: true } },
            verifiedBy: { select: { id: true, name: true } },
            // A blocked task that does not say what is blocking it is the row
            // everyone asks about and nobody can answer.
            evidence: {
              orderBy: { uploadedAt: 'desc' },
              select: {
                id: true, ref: true, title: true, fileName: true, fileSize: true,
                mimeType: true, classification: true, side: true,
                uploadedInRound: true, uploadedAt: true, withdrawnAt: true,
                uploadedBy: { select: { id: true, name: true } },
              },
            },
            clauseLinks: {
              select: {
                id: true, note: true,
                clause: {
                  select: {
                    id: true, ref: true, title: true,
                    standard: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            },
            impediments: {
              where: { kind: 'Blocker', resolvedAt: null },
              orderBy: { raisedAt: 'asc' },
              select: {
                id: true, ref: true, title: true, category: true,
                owingSide: true, severity: true, raisedAt: true, expectedClearDate: true,
              },
            },
          },
        },
      },
    });

    const now = new Date();
    const policy = project.verificationPolicy;

    const decorated = phases.map((ph) => {
      // needsVerification is resolved once, here, and travels with the task.
      // The alternative is every screen reimplementing the policy rule and one
      // of them getting it wrong.
      const tasks = ph.tasks.map((t) => ({
        ...t,
        needsVerification: requiresVerification(
          policy, t.verificationOverride, t.evidence.length > 0,
        ),
        timing: taskTiming(t, now),
        slippage: slippage(t),
      }));
      return { ...ph, tasks, counts: taskCounts(tasks, now) };
    });

    const allTasks = decorated.flatMap((p) => p.tasks);

    res.json({
      status: 'success',
      projectId: project.id,
      verificationPolicy: policy,
      baselined: project.baselineSetAt !== null,
      baselineVersion: project.baselineVersion,
      phases: decorated,
      totals: { phases: decorated.length, tasks: allTasks.length, ...taskCounts(allTasks, now) },
    });
  } catch (error: any) {
    console.error('[Plan Read Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the plan' });
  }
};

// ─── Phases ─────────────────────────────────────────────────────────────────

export const createPhase = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project, canWrite } = await authorise(req, str(req.params.id));
    if (!project) { notFound(res); return; }
    if (!canWrite) { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const { name, description, objectives, startDate, targetEndDate, ownerId, sequence } = req.body || {};
    if (!name || !startDate || !targetEndDate || !ownerId) {
      res.status(400).json({
        status: 'error',
        message: 'name, startDate, targetEndDate and ownerId are required',
      });
      return;
    }

    const start = new Date(startDate);
    const target = new Date(targetEndDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime()) || target < start) {
      res.status(400).json({ status: 'error', message: 'Provide valid dates with the end on or after the start' });
      return;
    }

    const owner = await prisma.user.findFirst({
      where: { id: str(ownerId), tenantId: project.tenantId },
      select: { id: true },
    });
    if (!owner) {
      res.status(400).json({ status: 'error', message: 'The phase owner must be a user of the owning organisation.' });
      return;
    }

    // Appended to the end unless a position is given. Sequence is not unique, so
    // inserting between two phases does not require renumbering the rest.
    const next = sequence !== undefined
      ? Number(sequence)
      : (await prisma.projectPhase.count({ where: { projectId: project.id } })) + 1;

    const phase = await prisma.$transaction(async (tx) => {
      const created = await tx.projectPhase.create({
        data: {
          projectId: project.id,
          sequence: next,
          name: str(name).trim(),
          description: description ? str(description) : null,
          objectives: objectives ? str(objectives) : null,
          startDate: start,
          targetEndDate: target,
          ownerId: str(ownerId),
        },
      });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_PHASE_CREATED',
        subjectType: 'ProjectPhase',
        subjectId: created.id,
        payload: { projectRef: project.ref, name: created.name, sequence: next },
      });
      return created;
    });

    res.status(201).json({ status: 'success', phase });
  } catch (error: any) {
    console.error('[Phase Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create phase' });
  }
};

export const updatePhase = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const phaseId = str(req.params.phaseId);
    const existing = await prisma.projectPhase.findUnique({
      where: { id: phaseId },
      select: { id: true, projectId: true, name: true },
    });
    if (!existing) { notFound(res); return; }

    const { project, canWrite } = await authorise(req, existing.projectId);
    if (!project) { notFound(res); return; }
    if (!canWrite) { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const b = req.body || {};
    const data: any = {};
    if (b.name !== undefined) data.name = str(b.name).trim();
    if (b.description !== undefined) data.description = b.description ? str(b.description) : null;
    if (b.objectives !== undefined) data.objectives = b.objectives ? str(b.objectives) : null;
    if (b.sequence !== undefined) data.sequence = Number(b.sequence);
    if (b.ownerId !== undefined) data.ownerId = str(b.ownerId);

    for (const field of ['startDate', 'targetEndDate'] as const) {
      if (b[field] !== undefined) {
        const d = new Date(b[field]);
        if (Number.isNaN(d.getTime())) {
          res.status(400).json({ status: 'error', message: `${field} must be a valid date` });
          return;
        }
        data[field] = d;
      }
    }

    // status is absent by design: it is derived from the tasks by the rollup, and
    // accepting it here would let a phase disagree with its own contents.
    if (b.status !== undefined) {
      res.status(400).json({
        status: 'error',
        code: 'DERIVED_FIELD',
        message: 'Phase status follows its tasks and cannot be set directly.',
      });
      return;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No changes supplied' });
      return;
    }

    const phase = await prisma.$transaction(async (tx) => {
      const updated = await tx.projectPhase.update({ where: { id: phaseId }, data });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_PHASE_UPDATED',
        subjectType: 'ProjectPhase',
        subjectId: phaseId,
        payload: { projectRef: project.ref, name: existing.name, changed: Object.keys(data) },
      });
      return updated;
    });

    res.json({ status: 'success', phase });
  } catch (error: any) {
    console.error('[Phase Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update phase' });
  }
};

export const deletePhase = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const phaseId = str(req.params.phaseId);
    const existing = await prisma.projectPhase.findUnique({
      where: { id: phaseId },
      select: { id: true, projectId: true, name: true, _count: { select: { tasks: true } } },
    });
    if (!existing) { notFound(res); return; }

    const { project, canWrite } = await authorise(req, existing.projectId);
    if (!project) { notFound(res); return; }
    if (!canWrite) { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    // Cascade would take the tasks silently. Refusing makes the operator move or
    // delete them deliberately, which is what they would want to have done.
    if (existing._count.tasks > 0) {
      res.status(409).json({
        status: 'error',
        code: 'PHASE_NOT_EMPTY',
        message: `This phase still holds ${existing._count.tasks} task(s). Move or delete them first.`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectPhase.delete({ where: { id: phaseId } });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_PHASE_DELETED',
        subjectType: 'ProjectPhase',
        subjectId: phaseId,
        payload: { projectRef: project.ref, name: existing.name },
      });
      await recomputeProject(tx, project.id);
    });

    res.json({ status: 'success', message: 'Phase deleted' });
  } catch (error: any) {
    console.error('[Phase Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete phase' });
  }
};

// ─── Tasks ──────────────────────────────────────────────────────────────────

export const createTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const phaseId = str(req.params.phaseId);
    const phase = await prisma.projectPhase.findUnique({
      where: { id: phaseId },
      select: { id: true, projectId: true, name: true },
    });
    if (!phase) { notFound(res); return; }

    const { project, canWrite } = await authorise(req, phase.projectId);
    if (!project) { notFound(res); return; }
    if (!canWrite) { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const {
      name, description, assigneeId, priority, side, department,
      startDate, dueDate, weight, sequence, verificationOverride,
    } = req.body || {};

    if (!name) {
      res.status(400).json({ status: 'error', message: 'name is required' });
      return;
    }
    if (priority && !PRIORITIES.includes(priority)) {
      res.status(400).json({ status: 'error', message: `priority must be one of: ${PRIORITIES.join(', ')}` });
      return;
    }
    if (side && !SIDES.includes(side)) {
      res.status(400).json({ status: 'error', message: `side must be one of: ${SIDES.join(', ')}` });
      return;
    }

    const parsedWeight = weight === undefined ? 1 : Number(weight);
    if (!Number.isFinite(parsedWeight) || parsedWeight < 1) {
      res.status(400).json({ status: 'error', message: 'weight must be a positive whole number' });
      return;
    }

    // null is not "unset" here — it is the third value, meaning "follow the
    // project policy", and is what the column holds by default.
    const override = parseOverride(verificationOverride);
    if (override === INVALID) {
      res.status(400).json({
        status: 'error',
        message: 'verificationOverride must be true, false, or null to follow the project policy',
      });
      return;
    }

    const baselineNow = project.baselineSetAt !== null;
    const ref = await nextTaskRef(project.id);
    const next = sequence !== undefined
      ? Number(sequence)
      : (await prisma.projectTask.count({ where: { phaseId } })) + 1;

    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.projectTask.create({
        data: {
          projectId: project.id,
          phaseId,
          ref,
          sequence: next,
          name: str(name).trim(),
          description: description ? str(description) : null,
          assigneeId: assigneeId ? str(assigneeId) : null,
          priority: priority || 'Medium',
          side: side || 'Client',
          department: department ? str(department) : null,
          weight: Math.round(parsedWeight),
          startDate: startDate ? new Date(startDate) : null,
          dueDate: dueDate ? new Date(dueDate) : null,
          // A task added to a running engagement is baselined now: its plan was
          // agreed the moment it was added. One added to a draft is not, because
          // nothing has been agreed at all — and an unbaselined task is not the
          // same as one that has slipped by zero.
          baselineStartDate: baselineNow && startDate ? new Date(startDate) : null,
          baselineDueDate: baselineNow && dueDate ? new Date(dueDate) : null,
          verificationOverride: override,
        },
      });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_TASK_CREATED',
        subjectType: 'ProjectTask',
        subjectId: created.id,
        payload: { projectRef: project.ref, ref, name: created.name, phase: phase.name },
      });
      // A new task changes the denominator, so the percentages move even though
      // nothing was completed.
      await recomputeProject(tx, project.id);
      return created;
    });

    res.status(201).json({ status: 'success', task });
  } catch (error: any) {
    console.error('[Task Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create task' });
  }
};

/**
 * Update a task.
 *
 * Two kinds of caller reach this: whoever runs the project, and whoever the task
 * is assigned to. An assignee may report on their own work — status and
 * percentage — but may not re-plan it: reassigning, reweighting or moving a due
 * date is a project decision, and a weight an assignee can raise is a progress
 * figure they can inflate.
 */
export const updateTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = str(req.params.taskId);
    const existing = await prisma.projectTask.findUnique({
      where: { id: taskId },
      select: {
        id: true, projectId: true, ref: true, name: true, status: true,
        assigneeId: true, completionPercent: true, verificationOverride: true,
        dueDate: true, baselineDueDate: true,
        // Unfiltered on purpose: the EvidenceTasks requirement follows whether
        // the task ever produced evidence, so that withdrawing a file cannot
        // remove the obligation to have the work checked.
        evidence: { select: { id: true } },
      },
    });
    if (!existing) { notFound(res); return; }

    const { project, canWrite } = await authorise(req, existing.projectId);
    if (!project) { notFound(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const userId = str(req.user!.id);
    const isAssignee = existing.assigneeId === userId;
    if (!canWrite && !isAssignee) { readOnly(res); return; }

    const b = req.body || {};
    const data: any = {};

    // ── Fields anyone working the task may change ──
    if (b.completionPercent !== undefined) {
      const pct = Number(b.completionPercent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        res.status(400).json({ status: 'error', message: 'completionPercent must be between 0 and 100' });
        return;
      }
      data.completionPercent = Math.round(pct);
    }

    if (b.status !== undefined) {
      const to = str(b.status);

      const refusal = checkTaskUpdate(existing.status, to, requiresVerification(
        project.verificationPolicy, existing.verificationOverride,
        existing.evidence.length > 0,
      ));

      if (refusal) {
        const code = refusal.code === 'UNKNOWN_STATUS'
          || refusal.code === 'VERIFICATION_NOT_REQUIRED' ? 400 : 409;
        res.status(code).json({
          status: 'error', code: refusal.code, message: refusal.message,
        });
        return;
      }
      data.status = to;

      // Finishing sets the completion and the timestamp together; reopening
      // clears the timestamp so "when was this done" cannot answer for work that
      // is in flight again.
      if (isComplete(data.status)) {
        data.completedAt = new Date();
        data.completionPercent = 100;
      } else if (isComplete(existing.status)) {
        data.completedAt = null;
        if (data.completionPercent === undefined) data.completionPercent = 0;
      }
    }

    // ── Planning fields, project managers only ──
    // verificationOverride sits here rather than with the reporting fields for
    // the same reason weight does: a flag the assignee can clear is a review
    // they can skip.
    const PLANNING = ['name', 'description', 'assigneeId', 'priority', 'side',
                      'department', 'weight', 'sequence', 'startDate', 'dueDate',
                      'verificationOverride'];
    const attemptedPlanning = PLANNING.filter((f) => b[f] !== undefined);

    if (attemptedPlanning.length > 0 && !canWrite) {
      res.status(403).json({
        status: 'error',
        code: 'PLANNING_REQUIRES_MANAGER',
        message: `You can report progress on this task, but ${attemptedPlanning.join(', ')} `
          + 'can only be changed by someone managing the project.',
      });
      return;
    }

    if (canWrite) {
      if (b.name !== undefined) data.name = str(b.name).trim();
      if (b.description !== undefined) data.description = b.description ? str(b.description) : null;
      if (b.assigneeId !== undefined) data.assigneeId = b.assigneeId ? str(b.assigneeId) : null;
      if (b.department !== undefined) data.department = b.department ? str(b.department) : null;
      if (b.sequence !== undefined) data.sequence = Number(b.sequence);

      if (b.priority !== undefined) {
        if (!PRIORITIES.includes(b.priority)) {
          res.status(400).json({ status: 'error', message: `priority must be one of: ${PRIORITIES.join(', ')}` });
          return;
        }
        data.priority = b.priority;
      }
      if (b.side !== undefined) {
        if (!SIDES.includes(b.side)) {
          res.status(400).json({ status: 'error', message: `side must be one of: ${SIDES.join(', ')}` });
          return;
        }
        data.side = b.side;
      }
      if (b.weight !== undefined) {
        const w = Number(b.weight);
        if (!Number.isFinite(w) || w < 1) {
          res.status(400).json({ status: 'error', message: 'weight must be a positive whole number' });
          return;
        }
        data.weight = Math.round(w);
      }
      if (b.verificationOverride !== undefined) {
        const override = parseOverride(b.verificationOverride);
        if (override === INVALID) {
          res.status(400).json({
            status: 'error',
            message: 'verificationOverride must be true, false, or null to follow the project policy',
          });
          return;
        }
        // Deliberately allowed on a finished task, and deliberately not
        // restatusing it. Raising the bar on work already marked Done should
        // make the verified figure fall — that is what raising the bar means —
        // and silently moving the task back to InProgress to "fix" the
        // inconsistency would hide the change from the person who made it.
        data.verificationOverride = override;
      }
      for (const field of ['startDate', 'dueDate'] as const) {
        if (b[field] !== undefined) {
          if (b[field] === null) { data[field] = null; continue; }
          const d = new Date(b[field]);
          if (Number.isNaN(d.getTime())) {
            res.status(400).json({ status: 'error', message: `${field} must be a valid date` });
            return;
          }
          data[field] = d;
        }
      }

      // A due date moving past the one that was agreed is a slip, and a plan
      // whose dates can be moved without saying why is a plan that is never
      // late. Pulling a date in stays an ordinary edit — only pushing it out
      // needs defending.
      if (requiresDelayReason(existing.baselineDueDate, existing.dueDate, data.dueDate ?? null)) {
        res.status(409).json({
          status: 'error',
          code: 'USE_RESCHEDULE_ENDPOINT',
          message: 'That date moves past the one agreed for this task. Use '
            + 'POST /api/projects/tasks/:id/reschedule, which records how many days it '
            + 'costs, why, and which side owes them.',
        });
        return;
      }
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No changes supplied' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.projectTask.update({ where: { id: taskId }, data });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: userId,
        action: 'PROJECT_TASK_UPDATED',
        subjectType: 'ProjectTask',
        subjectId: taskId,
        payload: {
          projectRef: project.ref, ref: existing.ref,
          changed: Object.keys(data),
          ...(data.status ? { from: existing.status, to: data.status } : {}),
        },
      });
      const rollup = await recomputeProject(tx, project.id);
      return { updated, rollup };
    });

    res.json({
      status: 'success',
      task: {
        ...result.updated,
        timing: taskTiming(result.updated),
        slippage: slippage(result.updated),
      },
      // Returned so the caller can repaint the whole tree from one response
      // rather than refetching the plan after every keystroke.
      rollup: result.rollup,
    });
  } catch (error: any) {
    console.error('[Task Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update task' });
  }
};

export const deleteTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const taskId = str(req.params.taskId);
    const existing = await prisma.projectTask.findUnique({
      where: { id: taskId },
      select: { id: true, projectId: true, ref: true, name: true },
    });
    if (!existing) { notFound(res); return; }

    const { project, canWrite } = await authorise(req, existing.projectId);
    if (!project) { notFound(res); return; }
    if (!canWrite) { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    // Verification rows cascade with the task, so deleting work that a reviewer
    // accepted would quietly remove a signed-off deliverable from the record —
    // and the verification report is the artefact this module exists to produce.
    // Reopening it first is the deliberate act that makes the removal visible.
    const accepted = await prisma.projectVerification.count({
      where: { taskId, outcome: 'Accepted' },
    });
    if (accepted > 0) {
      res.status(409).json({
        status: 'error',
        code: 'VERIFIED_WORK',
        message: 'This task has been independently verified. Reopen the verification '
          + 'first if it genuinely needs to be removed.',
      });
      return;
    }

    const rollup = await prisma.$transaction(async (tx) => {
      await tx.projectTask.delete({ where: { id: taskId } });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_TASK_DELETED',
        subjectType: 'ProjectTask',
        subjectId: taskId,
        payload: { projectRef: project.ref, ref: existing.ref, name: existing.name },
      });
      return recomputeProject(tx, project.id);
    });

    res.json({ status: 'success', message: 'Task deleted', rollup });
  } catch (error: any) {
    console.error('[Task Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete task' });
  }
};

/** The vocabulary a client may offer, so the interface never invents a value. */
export const taskStatuses = (_req: AuthenticatedRequest, res: Response): void => {
  res.json({
    status: 'success',
    statuses: TASK_STATUSES,
    verificationPolicies: VERIFICATION_POLICIES,
  });
};
