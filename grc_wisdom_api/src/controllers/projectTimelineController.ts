import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { guardProject, notFound, readOnly, isFrozen, frozen } from '../services/projectGuard';
import { isComplete, taskTiming } from '../services/projectLifecycle';
import { slippage } from '../services/projectDelay';
import {
  DEPENDENCY_KINDS, checkDependency, detectCycle, criticalPath,
  scheduleViolations, crossSideLinks, downstreamOf, topologicalOrder,
} from '../services/projectDependency';

/**
 * The timeline: what waits on what, and where a slip costs the end date.
 *
 * The question this answers is the one a steering committee actually asks and
 * that no amount of task-level detail could reach — if this task moves, does
 * the engagement move? Before there were edges, a plan was an ordered list with
 * dates on it and the answer lived in somebody's head.
 *
 * A cycle is refused when the link is created rather than found later by a
 * scheduler that cannot terminate. Everything else is reported, not enforced:
 * dates are set by people who know things the plan does not, and a plan that
 * refuses to record an inconvenient truth stops being used.
 */

const str = (v: unknown): string => String(v ?? '');

const EDGE_SELECT = {
  id: true, predecessorId: true, successorId: true, kind: true,
  lagDays: true, note: true, linkedAt: true,
  linkedBy: { select: { id: true, name: true } },
} as const;

/** Every edge on the engagement, in one indexed read. */
async function edgesFor(projectId: string) {
  return prisma.projectDependency.findMany({
    where: { projectId },
    select: EDGE_SELECT,
    orderBy: { linkedAt: 'asc' },
  });
}

// ─── The timeline ───────────────────────────────────────────────────────────

/**
 * Everything a timeline view needs, computed once.
 *
 * The critical path, the handovers that cross sides, and the dates that do not
 * respect their own dependencies — all derived, none stored. A stored critical
 * path is wrong the moment anybody moves a date, and nothing here is expensive
 * enough to justify a column that has to be kept true.
 */
export const getTimeline = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project } = await guardProject(str(req.user!.tenantId), str(req.params.id));
    if (!project) { notFound(res); return; }

    const [phases, edges] = await Promise.all([
      prisma.projectPhase.findMany({
        where: { projectId: project.id },
        orderBy: [{ sequence: 'asc' }],
        select: {
          id: true, sequence: true, name: true, status: true,
          startDate: true, targetEndDate: true, baselineTargetEndDate: true,
          reportedProgress: true, verifiedProgress: true,
          tasks: {
            orderBy: [{ sequence: 'asc' }],
            select: {
              id: true, ref: true, name: true, status: true, side: true,
              startDate: true, dueDate: true, baselineDueDate: true,
              completionPercent: true, weight: true,
              assignee: { select: { id: true, name: true } },
            },
          },
        },
      }),
      edgesFor(project.id),
    ]);

    const tasks = phases.flatMap((p) => p.tasks);
    const now = new Date();

    const cp = criticalPath(tasks as any, edges as any);
    const violations = scheduleViolations(tasks as any, edges as any);
    const handovers = crossSideLinks(tasks as any, edges as any, cp.onPath);

    // Reported rather than refused: data can predate the check, or arrive by
    // import. A reader is told which tasks to break, not that "a cycle exists".
    const cycle = detectCycle(edges as any);

    const byId = new Map(tasks.map((t) => [t.id, t]));
    const label = (id: string) => {
      const t = byId.get(id);
      return t ? `${t.ref} ${t.name}` : id;
    };

    res.json({
      status: 'success',
      projectId: project.id,
      phases: phases.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) => ({
          ...t,
          timing: taskTiming(t as any, now),
          slippage: slippage(t as any),
          onCriticalPath: cp.onPath.has(t.id),
          // Everything that moves if this does — the answer to the only
          // question anybody asks about a slipping task.
          blocks: [...downstreamOf(edges as any, t.id)],
        })),
      })),
      dependencies: edges,
      criticalPath: {
        taskIds: cp.path,
        labels: cp.path.map(label),
        lengthDays: cp.lengthDays,
      },
      // Both ends on the path: one handover that can move the end date is the
      // highest-risk item on a consultant-led engagement.
      handovers: handovers.map((h) => ({
        ...h,
        predecessor: label(h.predecessorId),
        successor: label(h.successorId),
      })),
      violations: violations.map((v) => ({
        ...v,
        predecessor: label(v.predecessorId),
        successor: label(v.successorId),
      })),
      cycle: cycle ? cycle.map(label) : null,
      summary: {
        tasks: tasks.length,
        dependencies: edges.length,
        onCriticalPath: cp.path.length,
        criticalDays: cp.lengthDays,
        crossSideHandovers: handovers.length,
        criticalHandovers: handovers.filter((h) => h.onCriticalPath).length,
        scheduleViolations: violations.length,
        // Work with no edge either way is work whose position in the plan
        // nobody has stated. It is not necessarily wrong, but it is invisible
        // to every question this endpoint answers.
        unsequenced: tasks.filter((t) => !edges.some(
          (e) => e.predecessorId === t.id || e.successorId === t.id,
        )).length,
      },
      vocabulary: { kinds: DEPENDENCY_KINDS },
    });
  } catch (error: any) {
    console.error('[Timeline Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the timeline' });
  }
};

// ─── Linking ────────────────────────────────────────────────────────────────

export const linkTasks = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { project, canWrite, side } = await guardProject(
      str(req.user!.tenantId), str(req.params.id),
    );
    if (!project) { notFound(res); return; }
    if (!canWrite && side !== 'Provider') { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const b = req.body || {};
    const predecessorId = str(b.predecessorId);
    const successorId = str(b.successorId);
    if (!predecessorId || !successorId) {
      res.status(400).json({
        status: 'error', message: 'predecessorId and successorId are required',
      });
      return;
    }

    if (predecessorId === successorId) {
      res.status(400).json({
        status: 'error',
        code: 'SELF_DEPENDENCY',
        message: 'A task cannot depend on itself.',
      });
      return;
    }

    // Both ends must belong to THIS engagement. A dependency spanning two
    // projects would make one plan's critical path depend on work the other
    // plan's owner can reschedule without ever seeing the consequence.
    const ends = await prisma.projectTask.findMany({
      where: { id: { in: [predecessorId, successorId] }, projectId: project.id },
      select: { id: true, ref: true, name: true },
    });
    if (ends.length !== 2) {
      res.status(400).json({
        status: 'error',
        code: 'CROSS_PROJECT',
        message: 'Both tasks must belong to this engagement.',
      });
      return;
    }

    const edges = await edgesFor(project.id);
    const lagDays = b.lagDays === undefined ? 0 : Number(b.lagDays);
    const kind = b.kind ? str(b.kind) : 'FinishToStart';

    const refusal = checkDependency(edges as any, {
      predecessorId, successorId, kind, lagDays,
    });
    if (refusal) {
      res.status(refusal.code === 'CYCLE' || refusal.code === 'DUPLICATE' ? 409 : 400)
        .json({ status: 'error', code: refusal.code, message: refusal.message });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const link = await tx.projectDependency.create({
        data: {
          projectId: project.id,
          predecessorId,
          successorId,
          kind,
          lagDays: Math.round(lagDays),
          note: b.note ? str(b.note) : null,
          linkedById: str(req.user!.id),
        },
        select: EDGE_SELECT,
      });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_DEPENDENCY_LINKED',
        subjectType: 'Project',
        subjectId: project.id,
        payload: {
          projectRef: project.ref, kind, lagDays,
          predecessor: ends.find((t) => t.id === predecessorId)?.ref,
          successor: ends.find((t) => t.id === successorId)?.ref,
        },
      });
      return link;
    });

    res.status(201).json({ status: 'success', dependency: created });
  } catch (error: any) {
    console.error('[Dependency Link Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to link the tasks' });
  }
};

export const unlinkTasks = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const link = await prisma.projectDependency.findUnique({
      where: { id: str(req.params.dependencyId) },
      select: {
        id: true, projectId: true,
        predecessor: { select: { ref: true } },
        successor: { select: { ref: true } },
      },
    });
    if (!link) { notFound(res); return; }

    const { project, canWrite, side } = await guardProject(
      str(req.user!.tenantId), link.projectId,
    );
    if (!project) { notFound(res); return; }
    if (!canWrite && side !== 'Provider') { readOnly(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    await prisma.$transaction(async (tx) => {
      await tx.projectDependency.delete({ where: { id: link.id } });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_DEPENDENCY_UNLINKED',
        subjectType: 'Project',
        subjectId: project.id,
        payload: {
          projectRef: project.ref,
          predecessor: link.predecessor.ref,
          successor: link.successor.ref,
        },
      });
    });

    res.json({ status: 'success', message: 'Dependency removed' });
  } catch (error: any) {
    console.error('[Dependency Unlink Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to remove the dependency' });
  }
};

/**
 * What moves if this task moves.
 *
 * Answered for one task on demand rather than for all of them in the timeline,
 * because a manager asks it about the task in front of them and the full answer
 * for every task is a payload nobody reads.
 */
export const getImpact = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const task = await prisma.projectTask.findUnique({
      where: { id: str(req.params.taskId) },
      select: { id: true, projectId: true, ref: true, name: true, dueDate: true },
    });
    if (!task) { notFound(res); return; }

    const { project } = await guardProject(str(req.user!.tenantId), task.projectId);
    if (!project) { notFound(res); return; }

    const edges = await edgesFor(project.id);
    const downstream = downstreamOf(edges as any, task.id);

    const affected = downstream.size
      ? await prisma.projectTask.findMany({
        where: { id: { in: [...downstream] } },
        orderBy: [{ dueDate: 'asc' }],
        select: {
          id: true, ref: true, name: true, status: true, side: true, dueDate: true,
          assignee: { select: { id: true, name: true } },
        },
      })
      : [];

    const allTasks = await prisma.projectTask.findMany({
      where: { projectId: project.id },
      select: { id: true, startDate: true, dueDate: true, status: true },
    });
    const cp = criticalPath(allTasks as any, edges as any);

    res.json({
      status: 'success',
      task: { id: task.id, ref: task.ref, name: task.name, dueDate: task.dueDate },
      onCriticalPath: cp.onPath.has(task.id),
      blocks: affected,
      summary: {
        directlyBlocks: edges.filter((e) => e.predecessorId === task.id).length,
        blocksInTotal: downstream.size,
        // Work already finished cannot be pushed by an upstream slip, so
        // counting it would overstate what a delay actually costs.
        stillMovable: affected.filter((t) => !isComplete(t.status)).length,
      },
    });
  } catch (error: any) {
    console.error('[Impact Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to compute the impact' });
  }
};
