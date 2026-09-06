/**
 * Slippage against the agreed plan, and the attribution of the time lost.
 *
 * Pure: no Prisma, no request, no ambient clock. Everything here is arithmetic
 * over dates and a list of impediments, which is the part of slice 4 that can
 * be quietly wrong — a delay total that looks plausible and is not.
 *
 * The idea the module turns on: a due date on its own carries no information
 * about lateness, because it is a mutable field. Compared against a baseline it
 * becomes a measurement. Compared against a baseline AND an attributed reason
 * it becomes the only answer anyone has to "why".
 */

const MS_PER_DAY = 86_400_000;

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/**
 *   Blocker  work cannot proceed; opens, sits, is cleared
 *   Delay    a date moved; recorded and closed in the same instant
 */
export const IMPEDIMENT_KINDS = ['Blocker', 'Delay'] as const;
export type ImpedimentKind = (typeof IMPEDIMENT_KINDS)[number];

/**
 * Why the time was lost.
 *
 * Deliberately short and deliberately not free text. A register where everyone
 * types their own reason cannot be summed, and a delay register that cannot be
 * summed is a diary. Other is present because a forced-choice list with no
 * escape hatch gets the nearest wrong answer picked instead.
 */
export const IMPEDIMENT_CATEGORIES = [
  'ClientDependency',
  'ProviderCapacity',
  'ThirdParty',
  'Regulatory',
  'ScopeChange',
  'Technical',
  'Resourcing',
  'Other',
] as const;
export type ImpedimentCategory = (typeof IMPEDIMENT_CATEGORIES)[number];

/**
 * Who has to clear it — not who raised it.
 *
 * A consultant raising "waiting on the client's asset register" is the normal
 * case, and the whole value of the column is that it points away from the
 * person filling in the form.
 */
export const OWING_SIDES = ['Client', 'Provider', 'ThirdParty'] as const;
export type OwingSide = (typeof OWING_SIDES)[number];

export const IMPEDIMENT_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

// ─── Slippage ───────────────────────────────────────────────────────────────

export interface Slippage {
  /** Whether this task is part of an agreed plan at all. */
  baselined: boolean;
  /** Days the date has moved from the baseline. Negative means pulled in. */
  slipDays: number;
  /** Moved later than agreed. */
  slipped: boolean;
}

/**
 * Signed days between two dates.
 *
 * Deliberately not projectSchedule.daysBetween, which clamps at zero: a task
 * pulled two days earlier than agreed is a real and useful fact, and clamping
 * it reports the same number as a task delivered exactly on plan.
 */
export function signedDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * How far a task's date has moved from the one that was agreed.
 *
 * An unbaselined task has not slipped — it has no agreed date to slip from,
 * which is different from having slipped by zero and must not be reported as
 * being on plan.
 */
export function slippage(task: {
  dueDate: Date | null;
  baselineDueDate: Date | null;
}): Slippage {
  if (!task.baselineDueDate || !task.dueDate) {
    return { baselined: false, slipDays: 0, slipped: false };
  }
  const slipDays = signedDays(task.baselineDueDate, task.dueDate);
  return { baselined: true, slipDays, slipped: slipDays > 0 };
}

/**
 * Whether moving a due date has to be explained.
 *
 * Three conditions, and the middle one is the point: the test is against the
 * BASELINE, not against today. Moving a task from day 10 to day 20 on day 3 is
 * a slip against the agreed plan even though nothing is late yet, and a rule
 * that waits for the date to pass only ever catches slips after they have cost
 * something.
 *
 *   - an unbaselined task is still being planned, so it moves freely;
 *   - a date landing on or before the agreed one costs nobody anything;
 *   - pulling a date in never needs defending, only pushing it out does.
 */
export function requiresDelayReason(
  baselineDueDate: Date | null,
  currentDueDate: Date | null,
  newDueDate: Date | null,
): boolean {
  if (!baselineDueDate || !newDueDate) return false;
  if (newDueDate.getTime() <= baselineDueDate.getTime()) return false;
  if (currentDueDate && newDueDate.getTime() <= currentDueDate.getTime()) return false;
  return true;
}

/**
 * What moving a date to `next` costs, in days.
 *
 * Measured as the increase in slip against the AGREED date, not the distance
 * the date travelled. The two differ whenever a date has already moved, and
 * only the first one sums correctly:
 *
 *   agreed day 10, currently day 5, moving to day 20
 *     distance travelled  15 — but the plan is only 10 days behind
 *     increase in slip    10 — which is what the programme actually lost
 *
 * Charging the distance would count the earlier improvement as a fresh loss.
 *
 * The charges are GROSS, and deliberately so: a date pulled back in is never
 * refunded. Where a task slips, is partly recovered, then slips again, the
 * episodes sum to more than the net position — and that is the honest reading,
 * because the recovery was somebody's work. Netting it off would let effort by
 * one side silently cancel days attributed to the other, which is precisely the
 * accounting the owingSide column exists to prevent.
 *
 * So: the charges sum to exactly the task's slippage when nothing was ever
 * pulled in, and to more than it when something was. Both are asserted.
 */
export function slipCost(
  baselineDueDate: Date,
  currentDueDate: Date | null,
  newDueDate: Date,
): number {
  const previousSlip = currentDueDate
    ? Math.max(0, signedDays(baselineDueDate, currentDueDate))
    : 0;
  const newSlip = Math.max(0, signedDays(baselineDueDate, newDueDate));
  return Math.max(0, newSlip - previousSlip);
}

// ─── Impediment cost ────────────────────────────────────────────────────────

export interface CostedImpediment {
  kind: string;
  category: string;
  owingSide: string;
  impactDays: number | null;
  raisedAt: Date;
  resolvedAt: Date | null;
}

/**
 * What this impediment has cost so far.
 *
 * A resolved one costs what was stamped on it. An open one costs the time it
 * has been open, computed now — which is why impactDays is null while a blocker
 * is open rather than holding a number that stopped being true the moment it
 * was written.
 */
export function impedimentCost(imp: CostedImpediment, now: Date = new Date()): number {
  if (imp.impactDays !== null && imp.impactDays !== undefined) return Math.max(0, imp.impactDays);
  if (imp.resolvedAt) return Math.max(0, signedDays(imp.raisedAt, imp.resolvedAt));
  return Math.max(0, signedDays(imp.raisedAt, now));
}

/** Whether this impediment is still costing time. */
export const isOpen = (imp: { kind: string; resolvedAt: Date | null }): boolean =>
  imp.kind === 'Blocker' && !imp.resolvedAt;

export interface Attribution {
  totalDays: number;
  openCount: number;
  openDays: number;
  resolvedCount: number;
  /** Days lost per side. Every side is present, including at zero. */
  bySide: Record<string, number>;
  /** Days lost per category, sparse — only categories that cost something. */
  byCategory: Record<string, number>;
  /** The side carrying the most days, or null when nothing has been lost. */
  largestSide: string | null;
}

/**
 * Days lost, split by who owes them and why.
 *
 * The sides are all present even at zero. A report reading "Client 0, Provider
 * 12" says something a report that silently omits the client does not, and the
 * omission reads as an accusation rather than a measurement.
 */
export function attribute(
  impediments: readonly CostedImpediment[],
  now: Date = new Date(),
): Attribution {
  const bySide: Record<string, number> = {};
  for (const side of OWING_SIDES) bySide[side] = 0;
  const byCategory: Record<string, number> = {};

  let totalDays = 0;
  let openCount = 0;
  let openDays = 0;
  let resolvedCount = 0;

  for (const imp of impediments) {
    const cost = impedimentCost(imp, now);
    totalDays += cost;

    bySide[imp.owingSide] = (bySide[imp.owingSide] || 0) + cost;
    byCategory[imp.category] = (byCategory[imp.category] || 0) + cost;

    if (isOpen(imp)) {
      openCount += 1;
      openDays += cost;
    } else {
      resolvedCount += 1;
    }
  }

  let largestSide: string | null = null;
  for (const [side, days] of Object.entries(bySide)) {
    if (days > 0 && (largestSide === null || days > bySide[largestSide])) largestSide = side;
  }

  return { totalDays, openCount, openDays, resolvedCount, bySide, byCategory, largestSide };
}

// ─── Rules ──────────────────────────────────────────────────────────────────

export interface DelayRefusal {
  code: 'USE_IMPEDIMENT_ENDPOINT' | 'DELAY_REASON_REQUIRED' | 'ALREADY_RESOLVED'
      | 'NOT_A_BLOCKER' | 'UNKNOWN_CATEGORY' | 'UNKNOWN_SIDE' | 'UNKNOWN_KIND';
  message: string;
}

/**
 * Whether an ordinary task update may set or clear Blocked.
 *
 * It may not, in either direction. Blocked is the one status that appears on a
 * steering report and explains nothing, so it is reached by recording what the
 * blocker is — exactly as Verified is reached by recording who verified it. The
 * status follows the record rather than the record chasing the status.
 */
export function checkBlockRouting(
  from: string,
  to: string,
): { code: 'USE_IMPEDIMENT_ENDPOINT'; message: string } | null {
  if (to === 'Blocked') {
    return {
      code: 'USE_IMPEDIMENT_ENDPOINT',
      message: 'Blocking work needs a reason. Use POST /api/projects/tasks/:id/block, '
        + 'which records what the blocker is and who owes its resolution.',
    };
  }
  if (from === 'Blocked') {
    return {
      code: 'USE_IMPEDIMENT_ENDPOINT',
      message: 'Clear the blocker rather than the status: '
        + 'POST /api/projects/impediments/:id/resolve.',
    };
  }
  return null;
}

/** Validates the three enums a caller supplies when raising an impediment. */
export function checkImpedimentInput(input: {
  kind?: string; category?: string; owingSide?: string;
}): DelayRefusal | null {
  if (input.kind && !(IMPEDIMENT_KINDS as readonly string[]).includes(input.kind)) {
    return {
      code: 'UNKNOWN_KIND',
      message: `kind must be one of: ${IMPEDIMENT_KINDS.join(', ')}.`,
    };
  }
  if (!input.category || !(IMPEDIMENT_CATEGORIES as readonly string[]).includes(input.category)) {
    return {
      code: 'UNKNOWN_CATEGORY',
      message: `category must be one of: ${IMPEDIMENT_CATEGORIES.join(', ')}.`,
    };
  }
  if (!input.owingSide || !(OWING_SIDES as readonly string[]).includes(input.owingSide)) {
    return {
      code: 'UNKNOWN_SIDE',
      message: `owingSide must be one of: ${OWING_SIDES.join(', ')}. `
        + 'This is who has to clear it, not who raised it.',
    };
  }
  return null;
}

/**
 * Whether this impediment can be closed.
 *
 * A delay cannot: the time is already lost and there is nothing to clear.
 * Offering resolution on one would produce a register where half the rows have
 * a meaningless resolution date.
 */
export function checkResolvable(imp: {
  kind: string; resolvedAt: Date | null;
}): DelayRefusal | null {
  if (imp.kind !== 'Blocker') {
    return {
      code: 'NOT_A_BLOCKER',
      message: 'A recorded delay has already cost its time; there is nothing to resolve.',
    };
  }
  if (imp.resolvedAt) {
    return { code: 'ALREADY_RESOLVED', message: 'This blocker has already been cleared.' };
  }
  return null;
}
