import { Prisma } from '@prisma/client';

/**
 * When work on a task actually began.
 *
 * A task stored its planned dates, its current due date and its completion,
 * but never its start, so "planned against actual" had no actual to compare
 * (consulting engagement, sprint 1). The start is stamped the first time the
 * task moves to InProgress, from whichever path moves it there — the task
 * itself, a blocker being cleared, or a verification sending it back — and is
 * never overwritten: a task reopened in May still started in March.
 *
 * Conditional on the column being empty, inside the caller's transaction, so
 * two moves arriving together cannot both stamp it.
 */
export async function stampActualStart(
  tx: Prisma.TransactionClient,
  taskId: string,
  at: Date = new Date(),
): Promise<void> {
  await tx.projectTask.updateMany({
    where: { id: taskId, actualStartDate: null },
    data: { actualStartDate: at },
  });
}
