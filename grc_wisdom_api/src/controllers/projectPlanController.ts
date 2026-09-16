import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { guardProject, notFound, readOnly, isFrozen, frozen } from '../services/projectGuard';
import { recomputeProject } from '../services/projectRollup';
import { resolveTenantScope } from '../services/scopeResolver';
import { projectWhere } from '../services/projectAccess';
import { notify } from '../services/notificationService';
import {
  assignmentAudience, bucketWork, bucketRank, summarise, WORK_BUCKETS,
} from '../services/myWork';
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
  guardProject(req.user!, projectId);

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
                    standard: { select: { id: true, code: true, title: true } },
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
      projectRef: project.ref,
      projectName: project.name,
      projectStatus: project.status,
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

/**
 * Tell the people whose work just changed hands.
 *
 * This controller had no notification of any kind: a task could be created
 * with an assignee, or handed from one person to another, and the only trace
 * was an audit row nobody reads. Being told in a meeting was the mechanism.
 *
 * Called inside the caller's transaction so nobody is told about an assignment
 * that rolled back, and both ends of a reassignment are told -- see
 * assignmentAudience for why the outgoing person matters as much as the
 * incoming one.
 */
async function tellAboutAssignment(
  tx: any,
  args: {
    actorId: string;
    tenantId: string;
    projectRef: string;
    taskId: string;
    taskRef: string;
    taskName: string;
    dueDate: Date | null;
    previousAssigneeId: string | null;
    nextAssigneeId: string | null;
  },
): Promise<void> {
  const audience = assignmentAudience({
    previousAssigneeId: args.previousAssigneeId,
    nextAssigneeId: args.nextAssigneeId,
  });
  if (audience.length === 0) return;

  const due = args.dueDate
    ? ` Due ${new Date(args.dueDate).toISOString().slice(0, 10)}.`
    : ' No due date has been set.';

  await notify(tx, audience.map((a) => ({
    tenantId: args.tenantId,
    recipientId: a.recipientId,
    actorId: args.actorId,
    event: a.kind === 'Assigned' ? 'PROJECT_TASK_ASSIGNED' : 'PROJECT_TASK_UNASSIGNED',
    subjectType: 'ProjectTask',
    subjectId: args.taskId,
    title: a.kind === 'Assigned'
      ? `${args.taskRef} is now yours: ${args.taskName}`
      : `${args.taskRef} is no longer yours: ${args.taskName}`,
    body: a.kind === 'Assigned'
      ? `On ${args.projectRef}.${due}`
      : `On ${args.projectRef}. It has been given to somebody else.`,
    link: 'my-work',
  })));
}

// ─── One person's work, across every engagement ───────────────────

/**
 * Every task assigned to the caller, wherever it lives.
 *
 * ProjectTask has carried @@index([assigneeId, status]) since the module was
 * written and no query in the API used it. Every multi-row task query was
 * scoped to one project, so the product could answer "what is in this plan" and
 * could not answer "what do I have to do" — which is the question somebody
 * actually opens the product with. GET /api/projects/commitments looks like the
 * answer and is not: it aggregates ProjectMember rows for everyone in scope and
 * reads no task at all, so it reports who is over-allocated, never what anybody
 * has to do.
 *
 * Scoped by assignee AND by what the caller may read. The first is the point;
 * the second is because a task can be reassigned to somebody whose access to
 * the engagement has since been withdrawn, and their own inbox must not become
 * the back door to it.
 */
export const myWork = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const userId = str(req.user!.id);
    const now = new Date();
    const includeDone = String(req.query.includeDone || '') === 'true';

    const tasks = await prisma.projectTask.findMany({
      where: {
        assigneeId: userId,
        project: {
          ...projectWhere(scope),
          status: { notIn: ['Closed', 'Cancelled'] },
        },
        ...(includeDone ? {} : { status: { notIn: ['Done', 'Verified'] } }),
      },
      select: {
        id: true, ref: true, name: true, status: true, completionPercent: true,
        dueDate: true, priority: true, side: true,
        phase: { select: { id: true, name: true } },
        project: {
          select: {
            id: true, ref: true, name: true, status: true,
            tenant: { select: { name: true } },
            providerTenant: { select: { name: true } },
          },
        },
        impediments: {
          where: { kind: 'Blocker', resolvedAt: null },
          select: { id: true, ref: true, title: true, owingSide: true },
        },
      },
      orderBy: [{ dueDate: 'asc' }],
      take: 300,
    });

    const rows = tasks.map((tk) => {
      const bucket = bucketWork(
        { status: tk.status, dueDate: tk.dueDate, blockers: tk.impediments.length },
        now,
      );
      return {
        id: tk.id,
        ref: tk.ref,
        name: tk.name,
        status: tk.status,
        completionPercent: tk.completionPercent,
        dueDate: tk.dueDate,
        priority: tk.priority,
        side: tk.side,
        bucket,
        phase: tk.phase,
        project: {
          id: tk.project.id,
          ref: tk.project.ref,
          name: tk.project.name,
          status: tk.project.status,
          client: tk.project.tenant?.name ?? null,
          provider: tk.project.providerTenant?.name ?? null,
        },
        // Named, not counted. "Blocked" with no blocker on the row is the
        // status everyone asks about and nobody can answer.
        blockers: tk.impediments,
      };
    });

    // Bucket first, then the due date inside it. Sorting by date alone would
    // put work the reader cannot start at the top of their day.
    rows.sort((a, b) => {
      const byBucket = bucketRank(a.bucket) - bucketRank(b.bucket);
      if (byBucket !== 0) return byBucket;
      if (!a.dueDate) return b.dueDate ? 1 : 0;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    res.json({
      status: 'success',
      buckets: WORK_BUCKETS,
      summary: summarise(rows.map((r) => r.bucket)),
      tasks: rows,
    });
  } catch (error: any) {
    console.error('[My Work Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load your work' });
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

      await tellAboutAssignment(tx, {
        actorId: str(req.user!.id),
        tenantId: project.tenantId,
        projectRef: project.ref,
        taskId: created.id,
        taskRef: created.ref,
        taskName: created.name,
        dueDate: created.dueDate,
        previousAssigneeId: null,
        nextAssigneeId: created.assigneeId,
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

      // This handler is also the reassignment path. Both ends are told: one
      // person has work they did not have, and the other has stopped being
      // answerable for something they may still think is theirs.
      if (data.assigneeId !== undefined) {
        await tellAboutAssignment(tx, {
          actorId: userId,
          tenantId: project.tenantId,
          projectRef: project.ref,
          taskId,
          taskRef: updated.ref,
          taskName: updated.name,
          dueDate: updated.dueDate,
          previousAssigneeId: existing.assigneeId,
          nextAssigneeId: data.assigneeId,
        });
      }

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
      select: {
        id: true, projectId: true, ref: true, name: true,
        // Both directions. A task in the middle of a chain has one of each, and
        // checking only one would let exactly that task be deleted silently.
        dependsOn: { select: { id: true, predecessor: { select: { ref: true } } } },
        blocksTasks: { select: { id: true, successor: { select: { ref: true } } } },
      },
    });
    if (!existing) { notFound(res); return; }

    const { project, canWrite } = await authorise(req, existing.projectId);
    if (!project) { notFound(res); return; }
    if (!canWrite) { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    // The database would cascade these away without a word, and a plan that
    // quietly loses its shape is worse than one that refuses to change: delete
    // the middle of A -> B -> C and you are left with A and C, unlinked, with
    // nobody aware the sequence is gone. Same reasoning as PHASE_NOT_EMPTY —
    // make the operator break it deliberately.
    const links = [
      ...existing.dependsOn.map((d) => `waits on ${d.predecessor.ref}`),
      ...existing.blocksTasks.map((d) => `blocks ${d.successor.ref}`),
    ];
    if (links.length > 0) {
      res.status(409).json({
        status: 'error',
        code: 'TASK_SEQUENCED',
        message: `${existing.ref} is part of the plan's sequence (${links.join(', ')}). `
          + 'Remove those dependencies first — deleting it would leave the tasks '
          + 'either side unlinked without anyone noticing.',
        dependencies: links.length,
      });
      return;
    }

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
    // Served rather than duplicated in the client. createTask rejects anything
    // outside these two lists, and a fourth hardcoded copy is how a screen
    // comes to offer a value the server answers 400 for -- which has already
    // happened three times in this codebase with status strings.
    priorities: PRIORITIES,
    sides: SIDES,
  });
};
