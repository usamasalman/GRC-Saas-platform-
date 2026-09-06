/**
 * Declared state machines for the delivery tree, and the derived facts that
 * depend on where a task sits in time rather than what somebody set.
 *
 * Pure: no Prisma, no request, no ambient clock. The transition tables are data
 * so later slices extend them by adding entries rather than editing branches —
 * slice 3 opens the verification states, and nothing here changes shape.
 *
 * This mirrors services/riskLifecycle.ts, which already proves the pattern: a
 * table of legal moves beats a chain of ifs that nobody can audit.
 */

// ─── Task ───────────────────────────────────────────────────────────────────

/**
 * Stored task states, slice 2.
 *
 * There is deliberately no `Delayed`. Lateness is a function of dueDate and
 * today: storing it means a scanner has to keep it true, and the value is wrong
 * between runs. It is derived in `taskTiming` instead.
 */
export const TASK_STATUSES = ['NotStarted', 'InProgress', 'Blocked', 'Done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Legal task moves.
 *
 * Done is reachable from InProgress or Blocked, and reversible — work is
 * reopened often enough that refusing it would just produce duplicate tasks.
 * Slice 3 inserts SubmittedForVerification between InProgress and Done, at
 * which point Done stops being settable by the assignee at all.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  NotStarted: ['InProgress', 'Blocked'],
  InProgress: ['Blocked', 'Done', 'NotStarted'],
  Blocked: ['InProgress', 'NotStarted'],
  Done: ['InProgress'],
};

// ─── Phase ──────────────────────────────────────────────────────────────────

export const PHASE_STATUSES = ['NotStarted', 'InProgress', 'Blocked', 'Complete'] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

/**
 * A phase's status is a reading of its tasks, not an independent field.
 *
 * A phase whose status disagrees with the tasks underneath it is worse than no
 * status: it is a number that looks authoritative and is not. So this is
 * computed by the rollup on every change and never set by hand.
 *
 * Blocked outranks InProgress deliberately. A phase with four tasks moving and
 * one stuck is a phase that needs attention, and reporting it as InProgress
 * hides the only fact worth surfacing.
 */
export function derivePhaseStatus(
  tasks: readonly { status: string }[],
): PhaseStatus {
  if (tasks.length === 0) return 'NotStarted';
  if (tasks.every((t) => isComplete(t.status))) return 'Complete';
  if (tasks.some((t) => t.status === 'Blocked')) return 'Blocked';
  if (tasks.some((t) => t.status !== 'NotStarted')) return 'InProgress';
  return 'NotStarted';
}

/**
 * Whether a status means the work itself is finished.
 *
 * Kept as a function rather than an equality check because slice 3 adds
 * Verified, which is also complete, and every caller should learn that in one
 * place rather than growing its own `|| status === 'Verified'`.
 */
export function isComplete(status: string): boolean {
  return status === 'Done';
}

// ─── Transition checking ────────────────────────────────────────────────────

export interface TransitionRefusal {
  code: 'ILLEGAL_TRANSITION' | 'UNKNOWN_STATUS';
  message: string;
}

/**
 * Returns null when the move is allowed, or a refusal explaining why not.
 *
 * Returning the reason rather than throwing lets the controller answer with a
 * 409 and a sentence a person can act on, instead of a stack trace and a 500.
 */
export function checkTaskTransition(from: string, to: string): TransitionRefusal | null {
  if (!TASK_STATUSES.includes(to as TaskStatus)) {
    return {
      code: 'UNKNOWN_STATUS',
      message: `"${to}" is not a task status. Use one of: ${TASK_STATUSES.join(', ')}.`,
    };
  }
  if (from === to) return null;

  const allowed = TASK_TRANSITIONS[from as TaskStatus];
  if (!allowed) {
    return { code: 'UNKNOWN_STATUS', message: `Task is in an unrecognised state "${from}".` };
  }
  if (!allowed.includes(to as TaskStatus)) {
    return {
      code: 'ILLEGAL_TRANSITION',
      message: allowed.length === 0
        ? `A task that is ${from} cannot be moved.`
        : `A task cannot go from ${from} to ${to}. Allowed from here: ${allowed.join(', ')}.`,
    };
  }
  return null;
}

// ─── Derived timing ─────────────────────────────────────────────────────────

export interface TaskTiming {
  /** Past its due date and not finished. */
  overdue: boolean;
  daysOverdue: number;
  /** Due within the window and not finished — the "needs attention" bucket. */
  dueSoon: boolean;
  daysUntilDue: number | null;
}

/** How far ahead counts as "due soon" on the plan screen. */
export const DUE_SOON_DAYS = 7;

/**
 * Lateness, derived rather than stored.
 *
 * A task with no due date is never overdue: absence of a date is not a missed
 * one, and treating it as late would fill the dashboard with noise nobody can
 * clear.
 */
export function taskTiming(
  task: { status: string; dueDate: Date | null },
  now: Date = new Date(),
): TaskTiming {
  if (!task.dueDate || isComplete(task.status)) {
    return { overdue: false, daysOverdue: 0, dueSoon: false, daysUntilDue: null };
  }

  const msPerDay = 86_400_000;
  const diffDays = Math.ceil((task.dueDate.getTime() - now.getTime()) / msPerDay);

  if (diffDays < 0) {
    return { overdue: true, daysOverdue: Math.abs(diffDays), dueSoon: false, daysUntilDue: diffDays };
  }
  return {
    overdue: false,
    daysOverdue: 0,
    dueSoon: diffDays <= DUE_SOON_DAYS,
    daysUntilDue: diffDays,
  };
}
