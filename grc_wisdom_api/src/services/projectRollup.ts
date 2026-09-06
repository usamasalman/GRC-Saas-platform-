import {
  derivePhaseStatus, isComplete, requiresVerification, taskCounts, TaskCounts,
} from './projectLifecycle';

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
 * Verified can never exceed reported, for any set of tasks: every task that
 * counts toward the second figure also counts fully toward the first. That is
 * asserted in the test suite, because a project showing more verified than
 * reported would be a arithmetic bug presented as an assurance claim.
 */

// ─── The two dimensions ─────────────────────────────────────────────────────

/** The fields the rollup needs from a task. Deliberately minimal. */
export interface RollupTask {
  status: string;
  completionPercent: number;
  weight: number;
  /**
   * Resolved from the project policy and the task override before it reaches
   * here — see projectLifecycle.requiresVerification. The rollup takes the
   * answer rather than the inputs so the arithmetic stays testable without
   * knowing what a policy is.
   */
  needsVerification: boolean;
}

type CompletionFn = (t: RollupTask) => number;

/**
 * What the owner claims. A finished task counts fully; anything else counts
 * whatever percentage was reported against it.
 */
const reportedCompletion: CompletionFn = (t) =>
  isComplete(t.status) ? 100 : clampPercent(t.completionPercent);

/**
 * What has been confirmed to the standard this engagement set.
 *
 * Two branches, and the second is the one that keeps the figure honest on
 * engagements that verify only part of the work:
 *
 *   - a task needing a reviewer counts only once one has accepted it;
 *   - a task not needing one counts as soon as it is complete.
 *
 * Reading the second branch as zero instead would make verified progress a
 * measure of how much verification was configured rather than how much work is
 * confirmed, and every engagement not verifying everything would show a figure
 * that could never reach 100 no matter what anyone did.
 *
 * Note this is never partial. A percentage is a claim; verification is a
 * decision, and half a decision does not exist.
 */
const verifiedCompletion: CompletionFn = (t) =>
  t.needsVerification
    ? (t.status === 'Verified' ? 100 : 0)
    : (isComplete(t.status) ? 100 : 0);

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
  /**
   * Returned so a caller can repaint an entire tree from one mutation response
   * rather than refetching the plan. Counts travel with the percentages because
   * a client recomputing them locally is a client that will eventually disagree
   * with the server about how many tasks are blocked.
   */
  phases: {
    id: string; reported: number; verified: number; status: string; counts: TaskCounts;
  }[];
  counts: TaskCounts;
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
export async function recomputeProject(
  tx: any,
  projectId: string,
  now: Date = new Date(),
): Promise<RollupResult> {
  // The policy is read here, once, rather than passed in by each caller. Every
  // task's verification requirement depends on it, and a caller that forgot to
  // supply it would produce a plausible-looking figure computed against the
  // wrong standard.
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { verificationPolicy: true },
  });
  const policy = project?.verificationPolicy || 'SelectedTasks';

  const phases = await tx.projectPhase.findMany({
    where: { projectId },
    select: {
      id: true,
      status: true,
      tasks: {
        select: {
          status: true, completionPercent: true, weight: true,
          verificationOverride: true, dueDate: true, submittedAt: true,
          // Standing evidence only. Under the EvidenceTasks policy a withdrawn
          // file must stop satisfying the requirement, or withdrawing becomes a
          // way to keep the credit while removing the substance.
          evidence: { where: { withdrawnAt: null }, select: { id: true } },
        },
      },
    },
  });

  const computed = phases.map((phase: any) => {
    const tasks = phase.tasks.map((t: any) => ({
      ...t,
      needsVerification: requiresVerification(
        policy, t.verificationOverride, t.evidence.length > 0,
      ),
    }));
    const pair = progressPair(tasks);
    return {
      id: phase.id,
      previousStatus: phase.status,
      status: derivePhaseStatus(tasks),
      reported: pair.reported,
      verified: pair.verified,
      totalWeight: totalWeight(tasks),
      tasks,
      counts: taskCounts(tasks, now),
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

  const rolled = rollUpPhases(computed);

  await tx.project.update({
    where: { id: projectId },
    data: { reportedProgress: rolled.reported, verifiedProgress: rolled.verified },
  });

  return {
    projectId,
    reportedProgress: rolled.reported,
    verifiedProgress: rolled.verified,
    phases: computed.map((c: any) => ({
      id: c.id, reported: c.reported, verified: c.verified, status: c.status, counts: c.counts,
    })),
    counts: taskCounts(computed.flatMap((c: any) => c.tasks), now),
  };
}
