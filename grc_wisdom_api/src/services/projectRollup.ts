import { derivePhaseStatus, isComplete } from './projectLifecycle';

/**
 * Progress arithmetic for the delivery tree, and the only writer of
 * ProjectPhase.reportedProgress, ProjectPhase.verifiedProgress,
 * ProjectPhase.status, Project.reportedProgress and Project.verifiedProgress.
 *
 * Those columns are stored rather than computed per read because recomputing a
 * whole tree on every list query is wasteful, and they are written from exactly
 * one function because a value assigned by whichever controller last touched a
 * task is a value that drifts. This mirrors riskScoring.recomputeResidual,
 * which owns Risk.residualScore on the same principle.
 *
 * Two numbers, not one — the distinction the module exists to make:
 *
 *   reported  what the people doing the work say is done
 *   verified  what an independent reviewer has confirmed
 *
 * In slice 2 nothing can be verified yet, so `verified` is legitimately zero
 * everywhere. Slice 3 changes one predicate below and the arithmetic, the
 * callers and the columns all stay as they are.
 */

// ─── The two dimensions ─────────────────────────────────────────────────────

/** The fields the rollup needs from a task. Deliberately minimal. */
export interface RollupTask {
  status: string;
  completionPercent: number;
  weight: number;
}

type CompletionFn = (t: RollupTask) => number;

/**
 * What the owner claims. A finished task counts fully; anything else counts
 * whatever percentage was reported against it.
 */
const reportedCompletion: CompletionFn = (t) =>
  isComplete(t.status) ? 100 : clampPercent(t.completionPercent);

/**
 * What a reviewer has confirmed.
 *
 * Slice 2 has no verification states, so this returns zero for every task and
 * verified progress is zero throughout — which is accurate, not a placeholder.
 * A phase reading 100% reported and 0% verified is exactly the honest answer
 * before anybody has checked anything.
 *
 * Slice 3 replaces the body with `t.status === 'Verified' ? 100 : 0`, plus the
 * rule that a task not requiring verification counts once complete.
 */
const verifiedCompletion: CompletionFn = () => 0;

// ─── Pure arithmetic ────────────────────────────────────────────────────────

const clampPercent = (n: number): number => Math.min(100, Math.max(0, Math.round(n || 0)));

/**
 * Weighted mean completion across a set of tasks, 0-100.
 *
 * Weight is by task `weight`, not by count: ten trivial tasks should not
 * outweigh the one that produces the ISMS scope statement. A task with weight
 * zero or below is treated as weight one rather than silently vanishing from
 * the denominator.
 */
export function weightedProgress(tasks: readonly RollupTask[], completion: CompletionFn): number {
  if (tasks.length === 0) return 0;

  let weighted = 0;
  let total = 0;
  for (const t of tasks) {
    const w = t.weight > 0 ? t.weight : 1;
    weighted += w * completion(t);
    total += w;
  }
  return total === 0 ? 0 : clampPercent(weighted / total);
}

/** Reported and verified together, so callers cannot compute one and forget the other. */
export function progressPair(tasks: readonly RollupTask[]): { reported: number; verified: number } {
  return {
    reported: weightedProgress(tasks, reportedCompletion),
    verified: weightedProgress(tasks, verifiedCompletion),
  };
}

/**
 * Roll phase figures up to the project.
 *
 * Each phase contributes in proportion to the work it contains, not equally: a
 * phase of twenty tasks and a phase of two are not each half the project.
 *
 * Weighting this way makes the hierarchy consistent — the project figure equals
 * what you would get averaging every task in one flat pass. That property is
 * worth having and is asserted in the test suite, because a rollup where the
 * levels disagree is a rollup nobody can explain to a steering committee.
 */
export function rollUpPhases(
  phases: readonly { totalWeight: number; reported: number; verified: number }[],
): { reported: number; verified: number } {
  if (phases.length === 0) return { reported: 0, verified: 0 };

  let wr = 0;
  let wv = 0;
  let total = 0;
  for (const p of phases) {
    const w = p.totalWeight > 0 ? p.totalWeight : 0;
    wr += w * p.reported;
    wv += w * p.verified;
    total += w;
  }
  // Phases exist but hold no tasks: nothing has been planned, so nothing is done.
  if (total === 0) return { reported: 0, verified: 0 };
  return { reported: clampPercent(wr / total), verified: clampPercent(wv / total) };
}

/** Sum of task weights, used as a phase's contribution to the project. */
export const totalWeight = (tasks: readonly RollupTask[]): number =>
  tasks.reduce((sum, t) => sum + (t.weight > 0 ? t.weight : 1), 0);

// ─── Persistence ────────────────────────────────────────────────────────────

export interface RollupResult {
  projectId: string;
  reportedProgress: number;
  verifiedProgress: number;
  phases: { id: string; reported: number; verified: number; status: string }[];
}

/**
 * Recompute a project's tree and persist it.
 *
 * Call inside the same transaction as whatever changed a task — creating,
 * deleting, restatusing or reweighting one — so the stored figures are never
 * observable in a state that disagrees with the tasks that produced them.
 *
 * `tx` is typed loosely for the same reason riskScoring does it: Prisma's
 * transaction client type is awkward to name and the alternative is every
 * caller casting at the call site.
 */
export async function recomputeProject(tx: any, projectId: string): Promise<RollupResult> {
  const phases = await tx.projectPhase.findMany({
    where: { projectId },
    select: {
      id: true,
      status: true,
      tasks: { select: { status: true, completionPercent: true, weight: true } },
    },
  });

  const computed = phases.map((phase: any) => {
    const pair = progressPair(phase.tasks);
    return {
      id: phase.id,
      previousStatus: phase.status,
      status: derivePhaseStatus(phase.tasks),
      reported: pair.reported,
      verified: pair.verified,
      totalWeight: totalWeight(phase.tasks),
    };
  });

  // One update per phase rather than one per task: a phase's figures depend on
  // all of its tasks, so there is nothing finer to write.
  await Promise.all(computed.map((c: any) =>
    tx.projectPhase.update({
      where: { id: c.id },
      data: { reportedProgress: c.reported, verifiedProgress: c.verified, status: c.status },
    }),
  ));

  const project = rollUpPhases(computed);

  await tx.project.update({
    where: { id: projectId },
    data: { reportedProgress: project.reported, verifiedProgress: project.verified },
  });

  return {
    projectId,
    reportedProgress: project.reported,
    verifiedProgress: project.verified,
    phases: computed.map((c: any) => ({
      id: c.id, reported: c.reported, verified: c.verified, status: c.status,
    })),
  };
}
