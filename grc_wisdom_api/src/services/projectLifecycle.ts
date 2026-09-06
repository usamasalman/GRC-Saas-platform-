import { checkBlockRouting } from './projectDelay';

/**
 * Declared state machines for the delivery tree, and the derived facts that
 * depend on where a task sits in time rather than what somebody set.
 *
 * Pure: no Prisma, no request, no ambient clock. The transition tables are data
 * so slices extend them by adding entries rather than editing branches.
 *
 * This mirrors services/riskLifecycle.ts, which already proves the pattern: a
 * table of legal moves beats a chain of ifs that nobody can audit.
 */

// ─── Task ───────────────────────────────────────────────────────────────────

/**
 * Stored task states.
 *
 * There is deliberately no `Delayed`. Lateness is a function of dueDate and
 * today: storing it means a scanner has to keep it true, and the value is wrong
 * between runs. It is derived in `taskTiming` instead.
 *
 * Done and Verified are both terminal and are not alternatives a user picks
 * between — which one a task can reach is decided by whether it requires
 * verification. See `checkVerificationRule`.
 */
export const TASK_STATUSES = [
  'NotStarted',
  'InProgress',
  'Blocked',
  'Done',
  'SubmittedForVerification',
  'Verified',
  'Rejected',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Legal task moves.
 *
 * Done and Verified are both reversible — work is reopened often enough that
 * refusing it would just produce duplicate tasks — but reopening verified work
 * is a management act that goes through its own endpoint, because it discards
 * an independent confirmation and that should leave a record.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  NotStarted: ['InProgress', 'Blocked'],
  InProgress: ['Blocked', 'Done', 'SubmittedForVerification', 'NotStarted'],
  Blocked: ['InProgress', 'NotStarted'],
  Done: ['InProgress'],
  // A submission is settled by a reviewer, or taken back by whoever made it.
  SubmittedForVerification: ['Verified', 'Rejected', 'InProgress'],
  Verified: ['InProgress'],
  // Rejected work is ordinary work again: pick it up, or park it.
  Rejected: ['InProgress', 'Blocked'],
};

/**
 * The three states only the verification endpoints may write.
 *
 * A task's status is otherwise editable through PATCH /tasks/:id, which is the
 * same call an assignee uses to report a percentage. Letting that call also
 * carry `status: "Verified"` would make separation of duties a condition buried
 * in a large handler rather than a property of the routing table — and the one
 * control this whole module exists to provide is that the person who did the
 * work is not the person who confirms it.
 */
export const VERIFICATION_STATES = [
  'SubmittedForVerification', 'Verified', 'Rejected',
] as const;

/**
 * Whether a status means the work itself is finished.
 *
 * Verified counts: it is Done that somebody checked. Kept as a function rather
 * than an equality test so every caller learns both in one place instead of
 * growing its own `|| status === 'Verified'`.
 */
export function isComplete(status: string): boolean {
  return status === 'Done' || status === 'Verified';
}

/**
 * Whether the assignee has finished with it — nothing further is owed by them.
 *
 * Wider than `isComplete` by one state: work sitting with a reviewer was handed
 * over on time or it was not, and continuing to count it against the person who
 * delivered it blames the wrong party for the reviewer's queue. Reviewer latency
 * is measured separately, by `verificationAge`.
 */
export function isDelivered(status: string): boolean {
  return isComplete(status) || status === 'SubmittedForVerification';
}

// ─── Verification policy ────────────────────────────────────────────────────

/**
 * How much of an engagement needs independent confirmation.
 *
 *   EveryTask      every task goes through a reviewer
 *   EvidenceTasks  a task requires a reviewer once it carries evidence
 *   SelectedTasks  only tasks the manager marks — the default
 *   None           the engagement does not do independent verification
 *
 * EvidenceTasks is the one worth explaining. It says: if this work produced
 * something, somebody independent looks at it. Work that produced nothing to
 * look at is not sent to a reviewer who would have nothing to review. It is the
 * setting most consulting engagements actually want, because it targets
 * verification at deliverables without a manager having to tick each one.
 */
export const VERIFICATION_POLICIES = [
  'EveryTask', 'EvidenceTasks', 'SelectedTasks', 'None',
] as const;
export type VerificationPolicy = (typeof VERIFICATION_POLICIES)[number];

/**
 * Does this task need a reviewer?
 *
 * The project sets a default and the task may override it. Resolving the two at
 * read time rather than stamping a boolean on each task at creation is what
 * makes the policy mean something: switching an engagement to EveryTask halfway
 * through raises the bar on the work already planned, which is the only
 * behaviour a compliance officer would expect from a setting with that name.
 *
 * `hasEvidence` is resolved by the caller and passed in rather than looked up
 * here. This file has no database handle by design — the 201-assertion suite
 * runs it straight off dist/ with no Postgres anywhere — and a query hidden
 * inside a pure predicate would end that.
 *
 * `None` wins over a task-level `true`. A policy saying the engagement does not
 * do independent verification should not be quietly reintroduced by a flag left
 * on one task, and nothing is lost — the override is still stored, so switching
 * the policy back restores it.
 */
export function requiresVerification(
  policy: string,
  override: boolean | null | undefined,
  hasEvidence = false,
): boolean {
  // None is checked first and stays first. It is a statement about the whole
  // engagement, and a task-level flag — or a file somebody attached — must not
  // quietly switch a workflow back on that the engagement turned off.
  if (policy === 'None') return false;
  if (override === true || override === false) return override;
  if (policy === 'EvidenceTasks') return hasEvidence;
  return policy === 'EveryTask';
}

// ─── Transition checking ────────────────────────────────────────────────────

export interface TransitionRefusal {
  code: 'ILLEGAL_TRANSITION' | 'UNKNOWN_STATUS' | 'VERIFICATION_REQUIRED'
      | 'VERIFICATION_NOT_REQUIRED' | 'USE_VERIFICATION_ENDPOINT' | 'SELF_VERIFICATION'
      | 'USE_IMPEDIMENT_ENDPOINT';
  message: string;
}

/**
 * Returns null when the move is allowed by the table, or a refusal explaining
 * why not.
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

/**
 * Whether the move is consistent with the task's verification requirement.
 *
 * Two symmetrical refusals, and both matter:
 *
 *   - work that needs a reviewer cannot be marked Done, or the second number
 *     could be bypassed by choosing the other terminal state;
 *   - work that does not need one cannot be submitted, or a reviewer's queue
 *     fills with things nobody asked them to look at.
 */
export function checkVerificationRule(
  to: string,
  needsVerification: boolean,
): TransitionRefusal | null {
  if (to === 'Done' && needsVerification) {
    return {
      code: 'VERIFICATION_REQUIRED',
      message: 'This task needs independent verification. Submit it for review '
        + 'rather than marking it done.',
    };
  }
  if (to === 'SubmittedForVerification' && !needsVerification) {
    return {
      code: 'VERIFICATION_NOT_REQUIRED',
      message: 'This task does not require verification. Mark it done, or ask a '
        + 'project manager to flag it for review first.',
    };
  }
  return null;
}

/**
 * Whether an ordinary task update may carry this status change, or whether it
 * belongs to one of the verification endpoints.
 *
 * Everything entering the verification lane, and everything leaving a state a
 * reviewer put the task into, is routed away from PATCH so that each of those
 * changes writes a verification record. Rejected is deliberately not included:
 * rejected work is ordinary work again, and picking it back up is not a
 * verification decision.
 */
export function checkVerificationRouting(from: string, to: string): TransitionRefusal | null {
  const entering = (VERIFICATION_STATES as readonly string[]).includes(to);
  const leavingSettled = from === 'SubmittedForVerification' || from === 'Verified';

  if (!entering && !leavingSettled) return null;

  const endpoint = to === 'SubmittedForVerification' ? 'submit'
    : (to === 'Verified' || to === 'Rejected') ? 'verify'
      : 'return';

  return {
    code: 'USE_VERIFICATION_ENDPOINT',
    message: `Verification is not set through a task update. Use `
      + `POST /api/projects/tasks/:id/${endpoint}.`,
  };
}

/**
 * Separation of duties: the person who did the work does not confirm it.
 *
 * This is the control the dual progress figure rests on. If a consultant can
 * accept their own deliverable then "verified" means nothing more than
 * "reported", the two numbers converge, and the module's whole claim collapses.
 *
 * So it is enforced structurally rather than configured: there is no setting
 * that turns it off, and there is no role — including platform break-glass —
 * that is exempt. A tenant that wants no verification at all sets the policy to
 * None and gets a single honest number instead of two dishonest ones.
 */
export function checkSeparationOfDuties(actor: {
  actorId: string;
  assigneeId: string | null;
  submittedById: string | null;
}): TransitionRefusal | null {
  if (actor.assigneeId && actor.actorId === actor.assigneeId) {
    return {
      code: 'SELF_VERIFICATION',
      message: 'You cannot verify a task assigned to you. Independent '
        + 'verification is the point of the second figure.',
    };
  }
  if (actor.submittedById && actor.actorId === actor.submittedById) {
    return {
      code: 'SELF_VERIFICATION',
      message: 'You submitted this task, so you cannot also verify it.',
    };
  }
  return null;
}

/**
 * The complete verdict on a status change made through an ordinary task update,
 * with the three checks in the order that produces the most useful message.
 *
 * Composed here rather than in the controller so the ORDER is testable without
 * a database. It matters more than it looks: checking the transition table
 * first answers a PATCH of `status: "Verified"` with "a task cannot go from
 * InProgress to Verified" — true, and it sends the reader off to submit the
 * task and be refused a second time, when the useful answer was "verification
 * has its own endpoint" all along.
 *
 *   rule     a task needing a reviewer cannot be marked Done, and an exempt
 *            one cannot be submitted. Said first, because "use the submit
 *            endpoint" followed by "this needs no verification" is two round
 *            trips to reach one sentence.
 *   routing  anything in the verification lane belongs to another endpoint.
 *   block    so does Blocked, in both directions — it is the one status that
 *            appears on a steering report and explains nothing, so it is
 *            reached by recording what the blocker is.
 *   table    everything else, including an invented status name.
 */
export function checkTaskUpdate(
  from: string,
  to: string,
  needsVerification: boolean,
): TransitionRefusal | null {
  return checkVerificationRule(to, needsVerification)
    || checkVerificationRouting(from, to)
    || checkBlockRouting(from, to)
    || checkTaskTransition(from, to);
}

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
 *
 * The verification gate needed no new rule: because a task awaiting a reviewer
 * is not complete, a phase holding one cannot read Complete.
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

// ─── Derived timing ─────────────────────────────────────────────────────────

export interface TaskTiming {
  /** Past its due date and still owed by the assignee. */
  overdue: boolean;
  daysOverdue: number;
  /** Due within the window and not delivered — the "needs attention" bucket. */
  dueSoon: boolean;
  daysUntilDue: number | null;
  /** Days this task has been sitting with a reviewer, null when it is not. */
  awaitingVerificationDays: number | null;
  /** Waiting on a reviewer longer than the review window allows. */
  verificationOverdue: boolean;
}

/** How far ahead counts as "due soon" on the plan screen. */
export const DUE_SOON_DAYS = 7;

/**
 * How long a submission may sit before the reviewer is the one holding the
 * project up. Separate from the task's own due date on purpose: those are two
 * different people's obligations and merging them hides whichever is at fault.
 */
export const VERIFICATION_SLA_DAYS = 5;

const MS_PER_DAY = 86_400_000;

/**
 * Lateness, derived rather than stored.
 *
 * A task with no due date is never overdue: absence of a date is not a missed
 * one, and treating it as late would fill the dashboard with noise nobody can
 * clear.
 */
export function taskTiming(
  task: { status: string; dueDate: Date | null; submittedAt?: Date | null },
  now: Date = new Date(),
): TaskTiming {
  const awaiting = task.status === 'SubmittedForVerification' && task.submittedAt
    ? Math.max(0, Math.floor((now.getTime() - task.submittedAt.getTime()) / MS_PER_DAY))
    : null;

  const review = {
    awaitingVerificationDays: awaiting,
    verificationOverdue: awaiting !== null && awaiting > VERIFICATION_SLA_DAYS,
  };

  if (!task.dueDate || isDelivered(task.status)) {
    return { overdue: false, daysOverdue: 0, dueSoon: false, daysUntilDue: null, ...review };
  }

  const diffDays = Math.ceil((task.dueDate.getTime() - now.getTime()) / MS_PER_DAY);

  if (diffDays < 0) {
    return {
      overdue: true, daysOverdue: Math.abs(diffDays), dueSoon: false, daysUntilDue: diffDays,
      ...review,
    };
  }
  return {
    overdue: false,
    daysOverdue: 0,
    dueSoon: diffDays <= DUE_SOON_DAYS,
    daysUntilDue: diffDays,
    ...review,
  };
}

// ─── Counts ─────────────────────────────────────────────────────────────────

export interface TaskCounts {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  overdue: number;
  dueSoon: number;
  awaitingVerification: number;
  rejected: number;
  verified: number;
  /** Tasks that will need a reviewer before they can count as verified. */
  needsVerification: number;
}

/**
 * The per-phase and per-project tallies, computed in one place.
 *
 * Both the plan endpoint and the rollup return these. Counting in each of them
 * separately is how two screens end up disagreeing about how many tasks are
 * blocked, which is a bug report nobody can reproduce.
 */
export function taskCounts(
  tasks: readonly {
    status: string;
    dueDate: Date | null;
    submittedAt?: Date | null;
    needsVerification?: boolean;
  }[],
  now: Date = new Date(),
): TaskCounts {
  const counts: TaskCounts = {
    total: tasks.length,
    done: 0, inProgress: 0, blocked: 0, overdue: 0, dueSoon: 0,
    awaitingVerification: 0, rejected: 0, verified: 0, needsVerification: 0,
  };

  for (const t of tasks) {
    if (isComplete(t.status)) counts.done += 1;
    if (t.status === 'Verified') counts.verified += 1;
    if (t.status === 'InProgress') counts.inProgress += 1;
    if (t.status === 'Blocked') counts.blocked += 1;
    if (t.status === 'Rejected') counts.rejected += 1;
    if (t.status === 'SubmittedForVerification') counts.awaitingVerification += 1;
    if (t.needsVerification) counts.needsVerification += 1;

    const timing = taskTiming(t, now);
    if (timing.overdue) counts.overdue += 1;
    if (timing.dueSoon) counts.dueSoon += 1;
  }

  return counts;
}
