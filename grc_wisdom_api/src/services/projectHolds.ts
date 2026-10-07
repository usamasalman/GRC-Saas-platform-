import { Prisma } from '@prisma/client';

/**
 * The days a project stood still, kept as intervals.
 *
 * Putting a project on hold only flipped its status, so when it stopped, for
 * how long and why were lost the moment it resumed (consulting engagement,
 * sprint 1). The days on hold are their own cause of variance, nobody's delay,
 * and the Gantt can only say so if the interval exists.
 *
 * One interval is open at a time. Every way out of OnHold ends it: resuming,
 * and cancelling a held project, which the transition table also allows.
 */

export type HoldEnd = { interval: 'closed' | 'unrecorded'; daysOnHold: number | null };

export async function openHold(
  tx: Prisma.TransactionClient,
  args: { projectId: string; reason: string; actorId: string; at: Date; firmAccess?: string | null },
): Promise<void> {
  await tx.projectHold.create({
    data: {
      projectId: args.projectId, reason: args.reason, startedById: args.actorId, startedAt: args.at,
      // What the delivery firm may do while held, chosen as the hold starts
      // and recorded with who chose it (sprint 5). Null when no firm.
      ...(args.firmAccess
        ? { firmAccess: args.firmAccess, firmAccessSetById: args.actorId, firmAccessSetAt: args.at }
        : {}),
    },
  });
}

/**
 * Ends the open interval. resumeReason is the reason given for resuming; a
 * cancelled project leaves it empty, since its closure note says why.
 */
export async function endHold(
  tx: Prisma.TransactionClient,
  args: { projectId: string; actorId: string; at: Date; resumeReason: string | null },
): Promise<HoldEnd> {
  const open = await tx.projectHold.findFirst({
    where: { projectId: args.projectId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  // Put on hold before intervals were recorded: when it began is not known,
  // and an invented start would be a false delay figure.
  if (!open) return { interval: 'unrecorded', daysOnHold: null };

  await tx.projectHold.update({
    where: { id: open.id },
    data: { endedAt: args.at, resumeReason: args.resumeReason, endedById: args.actorId },
  });
  return {
    interval: 'closed',
    daysOnHold: Math.round((args.at.getTime() - open.startedAt.getTime()) / 86_400_000),
  };
}
