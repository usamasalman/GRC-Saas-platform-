import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { hasCapability, CAP } from '../services/capabilityEngine';
import { guardProject, notFound, readOnly, isFrozen, frozen } from '../services/projectGuard';
import { recomputeProject } from '../services/projectRollup';
import {
  requiresVerification, checkTaskTransition, checkSeparationOfDuties,
  taskTiming, VERIFICATION_SLA_DAYS,
} from '../services/projectLifecycle';

/**
 * Independent verification of delivered work — the second of the two progress
 * figures, and the reason this module is not a task tracker.
 *
 * Reported progress is a claim: someone moved a dropdown. Verified progress is
 * a decision by a person who did not do the work, recorded with their name, the
 * date, and what was being claimed at the time. An auditor asked "how do you
 * know this control was implemented" gets an answer from the second number and
 * nothing at all from the first.
 *
 * Three endpoints, because three different people act:
 *
 *   submit   the person who did the work says it is ready
 *   verify   an independent reviewer accepts or rejects it
 *   return   a submission is withdrawn, or a verification is reopened
 *
 * They are separate from PATCH /tasks/:id deliberately. That call is how an
 * assignee reports their own percentage, and if it could also carry
 * `status: "Verified"` then separation of duties would be a condition buried in
 * a large handler instead of a property of the routing table.
 */

const str = (v: unknown): string => String(v ?? '');

/** Rejections and reopenings must say why; a bare refusal comes straight back. */
const MIN_NOTE = 10;

/**
 * Load a task together with everything the verification rules need to judge it.
 *
 * Returns null rather than throwing so each handler answers 404 the same way,
 * and a task in another tenant is indistinguishable from one that never existed.
 */
async function loadTask(req: AuthenticatedRequest, taskId: string) {
  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, projectId: true, ref: true, name: true, status: true,
      assigneeId: true, submittedById: true, completionPercent: true,
      verificationOverride: true, verificationRound: true,
    },
  });
  if (!task) return null;

  const guard = await guardProject(str(req.user!.tenantId), task.projectId);
  if (!guard.project) return null;

  return {
    task,
    ...guard,
    project: guard.project,
    needsVerification: requiresVerification(
      guard.project.verificationPolicy, task.verificationOverride,
    ),
  };
}

/**
 * Write one decision to the history and update the task in the same
 * transaction, then recompute.
 *
 * Every state change in the verification lane goes through here, which is what
 * makes "show me every decision on this engagement" a single indexed query
 * rather than a reconstruction from audit-log payloads.
 */
async function record(args: {
  req: AuthenticatedRequest;
  projectId: string;
  tenantId: string;
  projectRef: string;
  taskId: string;
  taskRef: string;
  round: number;
  outcome: 'Submitted' | 'Accepted' | 'Rejected' | 'Withdrawn' | 'Reopened';
  actorSide: string;
  note: string | null;
  reportedPercent: number;
  taskData: Record<string, unknown>;
  auditAction: string;
}) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.projectTask.update({
      where: { id: args.taskId },
      data: args.taskData,
    });

    await tx.projectVerification.create({
      data: {
        projectId: args.projectId,
        taskId: args.taskId,
        round: args.round,
        outcome: args.outcome,
        actorId: str(args.req.user!.id),
        actorSide: args.actorSide,
        note: args.note,
        reportedPercent: args.reportedPercent,
      },
    });

    await writeAudit(tx, {
      tenantId: args.tenantId,
      actorId: str(args.req.user!.id),
      action: args.auditAction,
      subjectType: 'ProjectTask',
      subjectId: args.taskId,
      payload: {
        projectRef: args.projectRef,
        ref: args.taskRef,
        outcome: args.outcome,
        round: args.round,
        side: args.actorSide,
      },
    });

    const rollup = await recomputeProject(tx, args.projectId);
    return { updated, rollup };
  });
}

// ─── Submit ─────────────────────────────────────────────────────────────────

/**
 * Put a task forward for review.
 *
 * Submitting pins the reported figure at 100: you do not offer work for
 * verification and simultaneously claim it is 60% done, and leaving the field
 * editable afterwards would let the claim move underneath a reviewer who is
 * looking at it.
 */
export const submitTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadTask(req, str(req.params.taskId));
    if (!loaded) { notFound(res); return; }
    const { task, project, canWrite, side, needsVerification } = loaded;

    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const userId = str(req.user!.id);
    const isAssignee = task.assigneeId === userId;
    if (!canWrite && !isAssignee) { readOnly(res); return; }

    if (!needsVerification) {
      res.status(400).json({
        status: 'error',
        code: 'VERIFICATION_NOT_REQUIRED',
        message: 'This task does not require verification. Mark it done, or ask a '
          + 'project manager to flag it for review first.',
      });
      return;
    }

    const refusal = checkTaskTransition(task.status, 'SubmittedForVerification');
    if (refusal) {
      res.status(409).json({ status: 'error', code: refusal.code, message: refusal.message });
      return;
    }

    const round = task.verificationRound + 1;
    const now = new Date();
    const note = req.body?.note ? str(req.body.note).trim() : null;

    const result = await record({
      req,
      projectId: project.id,
      tenantId: project.tenantId,
      projectRef: project.ref,
      taskId: task.id,
      taskRef: task.ref,
      round,
      outcome: 'Submitted',
      actorSide: side || 'Client',
      note,
      reportedPercent: 100,
      taskData: {
        status: 'SubmittedForVerification',
        completionPercent: 100,
        submittedById: userId,
        submittedAt: now,
        verificationRound: round,
        // A resubmission is a fresh claim. Carrying the previous reviewer
        // forward would let a rejected task display a verifier's name.
        verifiedById: null,
        verifiedAt: null,
      },
      auditAction: 'PROJECT_TASK_SUBMITTED',
    });

    res.json({
      status: 'success',
      task: { ...result.updated, timing: taskTiming(result.updated) },
      rollup: result.rollup,
    });
  } catch (error: any) {
    console.error('[Task Submit Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit the task for verification' });
  }
};

// ─── Verify ─────────────────────────────────────────────────────────────────

/**
 * Accept or reject submitted work.
 *
 * The separation-of-duties check here is the load-bearing line of the module.
 * If the person who did the work can accept it, the two progress figures
 * converge and the second one is decoration. So it is structural: no setting
 * disables it and no role is exempt, including platform break-glass.
 */
export const verifyTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadTask(req, str(req.params.taskId));
    if (!loaded) { notFound(res); return; }
    const { task, project, side } = loaded;

    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    if (task.status !== 'SubmittedForVerification') {
      res.status(409).json({
        status: 'error',
        code: 'NOT_SUBMITTED',
        message: `This task is ${task.status}. Only work submitted for verification can be `
          + 'accepted or rejected.',
      });
      return;
    }

    const decision = str(req.body?.decision);
    if (decision !== 'Accept' && decision !== 'Reject') {
      res.status(400).json({
        status: 'error',
        message: 'decision must be either "Accept" or "Reject"',
      });
      return;
    }

    const userId = str(req.user!.id);
    const sod = checkSeparationOfDuties({
      actorId: userId,
      assigneeId: task.assigneeId,
      submittedById: task.submittedById,
    });
    if (sod) {
      res.status(403).json({ status: 'error', code: sod.code, message: sod.message });
      return;
    }

    const note = req.body?.note ? str(req.body.note).trim() : '';
    if (decision === 'Reject' && note.length < MIN_NOTE) {
      res.status(400).json({
        status: 'error',
        code: 'REASON_REQUIRED',
        message: `Say why the work was rejected — at least ${MIN_NOTE} characters. `
          + 'Work sent back without a reason comes straight back.',
      });
      return;
    }

    const now = new Date();
    const accepted = decision === 'Accept';

    const result = await record({
      req,
      projectId: project.id,
      tenantId: project.tenantId,
      projectRef: project.ref,
      taskId: task.id,
      taskRef: task.ref,
      round: task.verificationRound,
      outcome: accepted ? 'Accepted' : 'Rejected',
      actorSide: side || 'Client',
      note: note || null,
      reportedPercent: task.completionPercent,
      taskData: accepted
        ? {
          status: 'Verified',
          verifiedById: userId,
          verifiedAt: now,
          completedAt: now,
          completionPercent: 100,
        }
        : {
          status: 'Rejected',
          // Rejected work is not complete and was not verified. Leaving either
          // field set would put a reviewer's name against work they refused.
          verifiedById: null,
          verifiedAt: null,
          completedAt: null,
        },
      auditAction: accepted ? 'PROJECT_TASK_VERIFIED' : 'PROJECT_TASK_REJECTED',
    });

    res.json({
      status: 'success',
      task: { ...result.updated, timing: taskTiming(result.updated) },
      rollup: result.rollup,
    });
  } catch (error: any) {
    console.error('[Task Verify Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the verification decision' });
  }
};

// ─── Return ─────────────────────────────────────────────────────────────────

/**
 * Take a task back out of the settled lane and put it back in progress.
 *
 * One endpoint for two cases that differ in who may do it and how much it
 * costs:
 *
 *   Withdrawn  from SubmittedForVerification, by whoever submitted it or a
 *              manager. Submitting the wrong task is a slip, not an event.
 *   Reopened   from Verified, by a manager only, with a reason. This discards
 *              an independent confirmation, so the verified figure drops and
 *              the history says who decided that and why.
 */
export const returnTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadTask(req, str(req.params.taskId));
    if (!loaded) { notFound(res); return; }
    const { task, project, canWrite, side } = loaded;

    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const userId = str(req.user!.id);
    const note = req.body?.note ? str(req.body.note).trim() : '';

    if (task.status !== 'SubmittedForVerification' && task.status !== 'Verified') {
      res.status(409).json({
        status: 'error',
        code: 'NOT_RETURNABLE',
        message: `This task is ${task.status}. Only submitted or verified work can be returned `
          + 'to in progress.',
      });
      return;
    }

    const reopening = task.status === 'Verified';

    if (reopening) {
      // Discarding a verification is a management act on the owning side, not
      // something the assignee can do to clear a finding.
      const mayManage = canWrite && await hasCapability(userId, CAP.MANAGE_PROJECT);
      if (!mayManage) {
        res.status(403).json({
          status: 'error',
          code: 'REOPEN_REQUIRES_MANAGER',
          message: 'Reopening verified work discards an independent confirmation, so only '
            + 'someone managing the engagement can do it.',
        });
        return;
      }
      if (note.length < MIN_NOTE) {
        res.status(400).json({
          status: 'error',
          code: 'REASON_REQUIRED',
          message: `Say why the verification is being reopened — at least ${MIN_NOTE} characters.`,
        });
        return;
      }
    } else if (task.submittedById !== userId && !canWrite) {
      res.status(403).json({
        status: 'error',
        code: 'NOT_YOUR_SUBMISSION',
        message: 'Only the person who submitted this task, or a project manager, can withdraw it.',
      });
      return;
    }

    const result = await record({
      req,
      projectId: project.id,
      tenantId: project.tenantId,
      projectRef: project.ref,
      taskId: task.id,
      taskRef: task.ref,
      round: task.verificationRound,
      outcome: reopening ? 'Reopened' : 'Withdrawn',
      actorSide: side || 'Client',
      note: note || null,
      reportedPercent: task.completionPercent,
      taskData: {
        status: 'InProgress',
        completedAt: null,
        verifiedById: null,
        verifiedAt: null,
        submittedById: null,
        submittedAt: null,
      },
      auditAction: reopening ? 'PROJECT_TASK_REOPENED' : 'PROJECT_TASK_WITHDRAWN',
    });

    res.json({
      status: 'success',
      task: { ...result.updated, timing: taskTiming(result.updated) },
      rollup: result.rollup,
    });
  } catch (error: any) {
    console.error('[Task Return Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to return the task' });
  }
};

// ─── The queue and the record ───────────────────────────────────────────────

/**
 * What is waiting on a reviewer, what came back rejected, and every decision
 * taken so far.
 *
 * Tasks the caller may not verify are listed rather than hidden, with the
 * reason attached. An item that silently disappears from a queue because of a
 * rule the user cannot see is a support ticket; an item marked "you submitted
 * this" explains itself.
 */
export const getVerificationQueue = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const { project } = await guardProject(str(req.user!.tenantId), str(req.params.id));
    if (!project) { notFound(res); return; }

    const userId = str(req.user!.id);
    const mayVerify = await hasCapability(userId, CAP.VERIFY_PROJECT_WORK);
    const now = new Date();

    const taskFields = {
      id: true, ref: true, name: true, status: true, completionPercent: true,
      weight: true, dueDate: true, submittedAt: true, verifiedAt: true,
      verificationRound: true, assigneeId: true, submittedById: true,
      assignee: { select: { id: true, name: true } },
      submittedBy: { select: { id: true, name: true } },
      verifiedBy: { select: { id: true, name: true } },
      phase: { select: { id: true, name: true, sequence: true } },
    };

    const [awaiting, rejected, history] = await Promise.all([
      prisma.projectTask.findMany({
        where: { projectId: project.id, status: 'SubmittedForVerification' },
        orderBy: { submittedAt: 'asc' },
        select: taskFields,
      }),
      prisma.projectTask.findMany({
        where: { projectId: project.id, status: 'Rejected' },
        orderBy: { updatedAt: 'desc' },
        select: taskFields,
      }),
      prisma.projectVerification.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, round: true, outcome: true, actorSide: true, note: true,
          reportedPercent: true, createdAt: true,
          actor: { select: { id: true, name: true } },
          task: { select: { id: true, ref: true, name: true } },
        },
      }),
    ]);

    // Oldest first, so "who is holding this up" is the top row.
    const queue = awaiting.map((t) => {
      const sod = checkSeparationOfDuties({
        actorId: userId, assigneeId: t.assigneeId, submittedById: t.submittedById,
      });
      const timing = taskTiming(t, now);
      return {
        ...t,
        timing,
        canVerify: mayVerify && !sod,
        blockedReason: !mayVerify
          ? 'You do not hold the capability to verify delivery work.'
          : sod?.message || null,
      };
    });

    res.json({
      status: 'success',
      projectId: project.id,
      verificationPolicy: project.verificationPolicy,
      canVerify: mayVerify,
      slaDays: VERIFICATION_SLA_DAYS,
      queue,
      rejected: rejected.map((t) => ({ ...t, timing: taskTiming(t, now) })),
      history,
      summary: {
        awaiting: awaiting.length,
        rejected: rejected.length,
        overdueReview: queue.filter((t) => t.timing.verificationOverdue).length,
        verifiableByYou: queue.filter((t) => t.canVerify).length,
        decisions: history.length,
      },
    });
  } catch (error: any) {
    console.error('[Verification Queue Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the verification queue' });
  }
};

/**
 * Every decision on one task, oldest first — the answer to "how did this come
 * to be signed off".
 */
export const getTaskVerifications = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const loaded = await loadTask(req, str(req.params.taskId));
    if (!loaded) { notFound(res); return; }

    const history = await prisma.projectVerification.findMany({
      where: { taskId: loaded.task.id },
      orderBy: [{ round: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, round: true, outcome: true, actorSide: true, note: true,
        reportedPercent: true, createdAt: true,
        actor: { select: { id: true, name: true } },
      },
    });

    res.json({
      status: 'success',
      taskId: loaded.task.id,
      ref: loaded.task.ref,
      requiresVerification: loaded.needsVerification,
      rounds: loaded.task.verificationRound,
      history,
    });
  } catch (error: any) {
    console.error('[Task Verification History Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the verification history' });
  }
};
