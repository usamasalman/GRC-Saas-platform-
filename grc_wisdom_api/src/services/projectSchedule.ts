/**
 * Schedule arithmetic and the derived delivery status.
 *
 * Pure functions, deliberately: no Prisma, no request, no clock beyond the one
 * passed in. That makes them testable without a database, which matters because
 * these are the numbers a steering committee reads.
 *
 * Nothing here is stored. Elapsed days, remaining days and the On Track / At
 * Risk / Delayed judgement all change with the passage of time alone — a column
 * holding any of them would be wrong by morning, and wrong in a way nobody
 * notices because it still looks like a number.
 */

export interface ScheduleInput {
  startDate: Date;
  targetEndDate: Date;
  actualEndDate: Date | null;
  status: string;
}

export interface ScheduleFigures {
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  /** How far through the calendar, which is not how far through the work. */
  elapsedPercent: number;
  overdue: boolean;
  daysOverdue: number;
}

export type DeliveryStatus = 'OnTrack' | 'AtRisk' | 'Delayed' | 'Completed' | 'NotStarted';

/** Whole days between two instants, never negative. */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

/**
 * The time figures the dashboard shows.
 *
 * `now` is a parameter rather than a call to `new Date()` so a test can place
 * itself anywhere on the timeline. Callers in the request path pass nothing and
 * get the real clock.
 */
export function schedule(p: ScheduleInput, now: Date = new Date()): ScheduleFigures {
  const totalDays = daysBetween(p.startDate, p.targetEndDate);

  // A closed project stops accruing elapsed time at its actual end, not today —
  // otherwise a project finished last year keeps ageing on the dashboard.
  const endedAt = p.actualEndDate ?? now;
  const elapsedDays = Math.min(totalDays, daysBetween(p.startDate, endedAt));
  const remainingDays = Math.max(0, totalDays - elapsedDays);

  const finished = p.status === 'Closed' || p.status === 'Cancelled';
  const overdue = !p.actualEndDate && !finished && now > p.targetEndDate;

  return {
    totalDays,
    elapsedDays,
    remainingDays,
    // A zero-length project is complete by definition rather than dividing by zero.
    elapsedPercent: totalDays === 0 ? 100 : Math.round((elapsedDays / totalDays) * 100),
    overdue,
    daysOverdue: overdue ? daysBetween(p.targetEndDate, now) : 0,
  };
}

/**
 * How much the calendar may outrun the work before a project is flagged.
 *
 * Twenty points is a judgement, not a law. Below it, ordinary variance; above
 * it, the date is in trouble and someone should look. It is a named constant so
 * the number is arguable rather than buried in a comparison.
 */
export const AT_RISK_DRIFT_POINTS = 20;

/**
 * On Track | At Risk | Delayed | Completed | Not started.
 *
 * Derived from the schedule against reported progress. A project drifts into At
 * Risk through nothing but the passage of time, with nobody touching it — which
 * is exactly the signal a manual status field never gives you.
 *
 * `health` stays a separate, human judgement and is never overwritten by this:
 * a project can be 80% done and red because the remaining 20% is the hard part.
 */
export function derivedStatus(
  p: { status: string; reportedProgress: number },
  s: ScheduleFigures,
): DeliveryStatus {
  if (p.status === 'Closed') return 'Completed';
  // Cancelled work is not "completed" and not "on track" — it stopped. Reporting
  // it as Not started keeps it out of the delivery figures without inventing a
  // sixth colour for the dashboard.
  if (p.status === 'Cancelled') return 'NotStarted';
  if (p.status === 'Draft') return 'NotStarted';

  if (s.overdue) return 'Delayed';
  if (s.elapsedPercent - p.reportedProgress >= AT_RISK_DRIFT_POINTS) return 'AtRisk';
  return 'OnTrack';
}

/** Frameworks are stored as a JSON array in a text column. Bad data reads as empty. */
export function parseFrameworks(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
