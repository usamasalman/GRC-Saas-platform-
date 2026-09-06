import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { canReadProject, canWriteProject } from '../services/projectAccess';
import { recomputeProject } from '../services/projectRollup';
import {
  TASK_STATUSES, checkTaskTransition, taskTiming, isComplete,
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

/** TSK-0001, sequential per project. */
async function nextTaskRef(projectId: string): Promise<string> {
  const count = await prisma.projectTask.count({ where: { projectId } });
  return `TSK-${String(count + 1).padStart(4, '0')}`;
}

/**
 * Load a project and decide what this caller may do with it.
 *
 * Every handler here begins the same way, and the alternative — each one
 * remembering to check both read and write — is how the cross-tenant hole in
 * usageController happened.
 */
async function authorise(req: AuthenticatedRequest, projectId: string) {
  const scope = await resolveTenantScope(str(req.user!.tenantId));
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, tenantId: true, providerTenantId: true, ref: true, status: true },
  });
  if (!project || !canReadProject(scope, project)) return { project: null, canWrite: false, scope };
  return { project, canWrite: canWriteProject(scope, project.tenantId), scope };
}

/** Not found and not permitted read the same, so a 403 cannot confirm existence. */
const notFound = (res: Response) =>
  res.status(404).json({ status: 'error', message: 'Project not found' });

const readOnly = (res: Response) =>
  res.status(403).json({
    status: 'error',
    code: 'READ_ONLY_ENGAGEMENT',
    message: 'You can view this engagement but not change it.',
  });

/** Closed work is a record. Adding to it after the fact would rewrite history. */
function isFrozen(status: string): boolean {
  return status === 'Closed' || status === 'Cancelled';
}

const frozen = (res: Response, projectStatus: string) =>
  res.status(409).json({
    status: 'error',
    code: 'PROJECT_FROZEN',
    message: `This project is ${projectStatus}. Reopen it before changing the plan.`,
  });

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
            assignee: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    const now = new Date();
    const decorated = phases.map((ph) => {
      const tasks = ph.tasks.map((t) => ({ ...t, timing: taskTiming(t, now) }));
      return {
        ...ph,
        tasks,
        // The per-phase counts the drill-down in section 5 asks for, computed
        // here so every client shows the same numbers.
        counts: {
          total: tasks.length,
          done: tasks.filter((t) => isComplete(t.status)).length,
          inProgress: tasks.filter((t) => t.status === 'InProgress').length,
          blocked: tasks.filter((t) => t.status === 'Blocked').length,
          overdue: tasks.filter((t) => t.timing.overdue).length,
        },
      };
    });

    const allTasks = decorated.flatMap((p) => p.tasks);

    res.json({
      status: 'success',
      projectId: project.id,
      phases: decorated,
      totals: {
        phases: decorated.length,
        tasks: allTasks.length,
        done: allTasks.filter((t) => isComplete(t.status)).length,
        blocked: allTasks.filter((t) => t.status === 'Blocked').length,
        overdue: allTasks.filter((t) => t.timing.overdue).length,
        dueSoon: allTasks.filter((t) => t.timing.dueSoon).length,
      },
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
      startDate, dueDate, weight, sequence,
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
        assigneeId: true, completionPercent: true,
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
      const refusal = checkTaskTransition(existing.status, str(b.status));
      if (refusal) {
        res.status(refusal.code === 'UNKNOWN_STATUS' ? 400 : 409).json({
          status: 'error', code: refusal.code, message: refusal.message,
        });
        return;
      }
      data.status = str(b.status);

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
    const PLANNING = ['name', 'description', 'assigneeId', 'priority', 'side',
                      'department', 'weight', 'sequence', 'startDate', 'dueDate'];
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
      task: { ...result.updated, timing: taskTiming(result.updated) },
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

/** The statuses a client may offer, so the interface never invents one. */
export const taskStatuses = (_req: AuthenticatedRequest, res: Response): void => {
  res.json({ status: 'success', statuses: TASK_STATUSES });
};
