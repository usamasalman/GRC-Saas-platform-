import { prisma } from '../db';
import { DAY_MS, accessOpen } from './engagementRules';

/**
 * After an engagement closes (consulting engagement, sprint 7).
 *
 * The delivery firm may still read a closed engagement, read-only, until a
 * window the organisation sets ends: 0 to 365 days, 90 unless it says
 * otherwise. The days are set ahead on the engagement and confirmed in the
 * Close dialog; at close they become a fixed moment, which only the
 * organisation can then extend (never past 365 days after close) or revoke.
 *
 * A person's own end date stays separate from it: whoever still had access at
 * the moment of close keeps read-only access until the window ends; someone
 * removed, or whose dates had ended, does not get it back. A firm working on
 * a follow-on may also read the engagement before it, read-only, while that
 * follow-on runs, if the organisation put it in scope.
 */

export const DEFAULT_CLOSE_WINDOW_DAYS = 90;
export const MAX_CLOSE_WINDOW_DAYS = 365;
export const ENDED_STATUSES = ['Closed', 'Cancelled'];

export const isEnded = (status: string): boolean => ENDED_STATUSES.includes(status);

export const windowDaysOf = (p: { closeWindowDays: number | null }): number => p.closeWindowDays ?? DEFAULT_CLOSE_WINDOW_DAYS;

export const validWindowDays = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CLOSE_WINDOW_DAYS ? n : null;
};

/**
 * When the firm's read-only access ends: the moment fixed at close or set
 * since; for an engagement closed before sprint 7, the days from its close.
 */
export function closeWindowEnd(p: { actualEndDate: Date | null; closeAccessUntil: Date | null; closeWindowDays: number | null }): Date | null {
  if (p.closeAccessUntil) return p.closeAccessUntil;
  if (!p.actualEndDate) return null;
  return new Date(p.actualEndDate.getTime() + windowDaysOf(p) * DAY_MS);
}

/** The latest the window may run to: 365 days after close. */
export const latestWindowEnd = (closedAt: Date): Date => new Date(closedAt.getTime() + MAX_CLOSE_WINDOW_DAYS * DAY_MS);

/** Whether a person keeps read-only access after close: they still had access at the close. */
export const keepsAfterClose = (m: { accessFrom: Date | null; accessTo: Date | null }, closedAt: Date): boolean => accessOpen(m, closedAt);

/**
 * Whether this person may read a closed engagement because a follow-on they
 * are approved on, still running and inside their dates, put it in scope.
 */
export async function readsThroughFollowOn(projectId: string, userId: string, now: Date = new Date()): Promise<boolean> {
  const rows = await prisma.projectMember.findMany({
    where: {
      userId, side: 'Provider', memberStatus: 'Approved', active: true,
      project: { previousProjectId: projectId, previousInScope: true, status: { notIn: ENDED_STATUSES } },
    },
    select: { accessFrom: true, accessTo: true },
    take: 5,
  });
  return rows.some((m) => accessOpen(m, now));
}
