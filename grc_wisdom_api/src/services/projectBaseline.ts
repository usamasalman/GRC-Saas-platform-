/**
 * Stamping the plan that was agreed, as distinct from the plan being worked to.
 *
 * A due date on its own carries no information about lateness, because it is a
 * mutable field: move it and the task is on time again. The baseline is the
 * copy nobody edits, and it is what turns "this is due Friday" into "this was
 * due a fortnight ago and has moved twice".
 *
 * Written in exactly two circumstances, both deliberate acts by a person:
 *
 *   activation    the plan is agreed when the engagement starts
 *   rebaseline    the plan is agreed again, with a reason, on the record
 *
 * Never on an ordinary edit. A baseline that moves when a date moves measures
 * nothing.
 *
 * The first stamp also fills the first-agreed columns, and no later stamp
 * touches them: a rebaseline re-agrees the plan, and the distance it moved
 * the dates is the rebaseline's share of the variance on the Gantt
 * (consulting engagement, sprint 2).
 */

export interface BaselineResult {
  version: number;
  phases: number;
  tasks: number;
  setAt: Date;
}

/**
 * Copy every current date into its baseline column and bump the version.
 *
 * `tx` is typed loosely for the same reason the rollup does it: Prisma's
 * transaction client type is awkward to name and the alternative is every
 * caller casting at the call site.
 */
export async function stampBaseline(
  tx: any,
  projectId: string,
  now: Date = new Date(),
): Promise<BaselineResult> {
  // What is agreed is where the work now ends, not where its containers were
  // last set: a phase a task has overrun is agreed at the task's date.
  await stretchToWork(tx, projectId);

  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      startDate: true, targetEndDate: true, baselineVersion: true,
      firstBaselineStartDate: true, firstBaselineTargetEndDate: true,
    },
  });

  const version = (project.baselineVersion || 0) + 1;

  await tx.project.update({
    where: { id: projectId },
    data: {
      baselineStartDate: project.startDate,
      baselineTargetEndDate: project.targetEndDate,
      baselineSetAt: now,
      baselineVersion: version,
      // Only on the first agreement. A project rebaselined before these were
      // kept has lost its first plan, and does not get today's in its place.
      ...(version === 1 && !project.firstBaselineTargetEndDate
        ? { firstBaselineStartDate: project.startDate, firstBaselineTargetEndDate: project.targetEndDate }
        : {}),
    },
  });

  // Row by row rather than one updateMany, because each row copies its own
  // dates rather than sharing a value. Delivery plans run to tens of phases and
  // hundreds of tasks, not millions, and this happens twice in an engagement.
  const phases = await tx.projectPhase.findMany({
    where: { projectId },
    select: { id: true, targetEndDate: true, firstBaselineTargetEndDate: true },
  });
  await Promise.all(phases.map((p: any) =>
    tx.projectPhase.update({
      where: { id: p.id },
      data: {
        baselineTargetEndDate: p.targetEndDate,
        // A phase added after the first agreement is first agreed now.
        ...(p.firstBaselineTargetEndDate || (version > 1 && !project.firstBaselineTargetEndDate)
          ? {} : { firstBaselineTargetEndDate: p.targetEndDate }),
      },
    })));

  const tasks = await tx.projectTask.findMany({
    where: { projectId },
    select: { id: true, startDate: true, dueDate: true, firstBaselineDueDate: true },
  });
  await Promise.all(tasks.map((t: any) =>
    tx.projectTask.update({
      where: { id: t.id },
      data: {
        baselineStartDate: t.startDate,
        baselineDueDate: t.dueDate,
        ...(t.firstBaselineDueDate || (version > 1 && !project.firstBaselineTargetEndDate)
          ? {} : { firstBaselineStartDate: t.startDate, firstBaselineDueDate: t.dueDate }),
      },
    })));

  return { version, phases: phases.length, tasks: tasks.length, setAt: now };
}

/**
 * Whether a project has an agreed plan yet.
 *
 * Used to decide whether a task added now should be baselined at creation: on a
 * running engagement its plan is agreed the moment it is added, so it is, and
 * on a draft it is not, because nothing has been agreed at all.
 */
export const isBaselined = (project: { baselineSetAt: Date | null }): boolean =>
  project.baselineSetAt !== null;

/**
 * Grows each phase's end to its latest task, and the engagement's end to its
 * latest phase. Never shrinks either.
 *
 * A task could move past the end of its phase while the phase, and the
 * engagement, kept the old date, so a report printed "Against the agreed date:
 * On plan" beside a task seven days late, and a rebaseline agreed the old end
 * again. A container cannot finish before the work inside it, so its end
 * follows the work whenever a due date moves, and before any baseline is
 * stamped.
 */
export async function stretchToWork(
  tx: any,
  projectId: string,
): Promise<{ phasesMoved: number; projectEnd: Date | null }> {
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      targetEndDate: true,
      phases: { select: { id: true, targetEndDate: true, tasks: { select: { dueDate: true } } } },
    },
  });
  let phasesMoved = 0;
  let latestPhaseEnd: Date = project.targetEndDate;
  for (const p of project.phases) {
    let end: Date = p.targetEndDate;
    for (const t of p.tasks) if (t.dueDate && t.dueDate > end) end = t.dueDate;
    if (end > p.targetEndDate) {
      await tx.projectPhase.update({ where: { id: p.id }, data: { targetEndDate: end } });
      phasesMoved += 1;
    }
    if (end > latestPhaseEnd) latestPhaseEnd = end;
  }
  if (latestPhaseEnd > project.targetEndDate) {
    await tx.project.update({ where: { id: projectId }, data: { targetEndDate: latestPhaseEnd } });
    return { phasesMoved, projectEnd: latestPhaseEnd };
  }
  return { phasesMoved, projectEnd: null };
}
