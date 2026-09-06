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
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { startDate: true, targetEndDate: true, baselineVersion: true },
  });

  const version = (project.baselineVersion || 0) + 1;

  await tx.project.update({
    where: { id: projectId },
    data: {
      baselineStartDate: project.startDate,
      baselineTargetEndDate: project.targetEndDate,
      baselineSetAt: now,
      baselineVersion: version,
    },
  });

  // Row by row rather than one updateMany, because each row copies its own
  // dates rather than sharing a value. Delivery plans run to tens of phases and
  // hundreds of tasks, not millions, and this happens twice in an engagement.
  const phases = await tx.projectPhase.findMany({
    where: { projectId },
    select: { id: true, targetEndDate: true },
  });
  await Promise.all(phases.map((p: any) =>
    tx.projectPhase.update({
      where: { id: p.id },
      data: { baselineTargetEndDate: p.targetEndDate },
    })));

  const tasks = await tx.projectTask.findMany({
    where: { projectId },
    select: { id: true, startDate: true, dueDate: true },
  });
  await Promise.all(tasks.map((t: any) =>
    tx.projectTask.update({
      where: { id: t.id },
      data: { baselineStartDate: t.startDate, baselineDueDate: t.dueDate },
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
