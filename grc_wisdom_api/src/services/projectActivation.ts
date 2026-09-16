/**
 * Agreeing a plan, and closing what it delivered.
 *
 * Every project is created Draft and nothing in the product could move one out
 * of it: no screen issued PATCH /api/projects/:id, POST /:id/close or
 * POST /:id/rebaseline, all three of which were fully implemented and routed.
 * So stampBaseline never ran, baselineSetAt was null on every engagement in
 * existence, and every slippage figure in the product was measured against
 * nothing. Every exported report also carried "DRAFT — figures are provisional"
 * permanently, because draftNotice() suppresses that banner only for a Closed
 * engagement and no engagement could ever become one.
 *
 * The rules live here rather than in the controller because they are the ones
 * worth arguing about, and they run without a database.
 *
 * The rule most worth arguing about is NO_PLAN_TO_AGREE. Activating an empty
 * plan looks harmless: stampBaseline copies the project's own two dates and
 * iterates zero phases and zero tasks. But isBaselined() then reports true
 * forever, so every task added afterwards is baselined AT ITS OWN DUE DATE the
 * moment it is created — and a task whose baseline is its current date can
 * never slip. Activate early and the engagement is structurally incapable of
 * reporting a slip for the rest of its life, with nothing on any screen to say
 * so. Refusing costs one sentence; the alternative is unrecoverable without a
 * rebaseline nobody knows to perform.
 */

/** Long enough that an empty string and a full stop cannot become the record. */
export const MIN_NOTE = 10;

export interface ActivationFacts {
  /** Draft | Active | OnHold | Closed | Cancelled */
  status: string;
  startDate: Date;
  targetEndDate: Date;
  baselineSetAt: Date | null;
  phaseCount: number;
  taskCount: number;
  /**
   * Tasks carrying no due date. They are baselined to null and therefore can
   * never be reported as slipped — the baseline covers fewer of them than the
   * task count suggests.
   */
  tasksWithoutDueDate: number;
}

export interface LifecycleRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface ActivationDecision {
  ok: true;
  /** Things the person should see before agreeing, not reasons to refuse. */
  warnings: string[];
}

/**
 * Whether this engagement's plan can be agreed, and what the person agreeing
 * should be told first.
 *
 * Refusals in order of how badly each would go wrong if allowed.
 */
export function planActivation(
  p: ActivationFacts,
  now: Date,
): LifecycleRefusal | ActivationDecision {
  if (p.status === 'Closed' || p.status === 'Cancelled') {
    return {
      ok: false,
      status: 409,
      code: 'PROJECT_FROZEN',
      message: `This engagement is ${p.status}. A finished engagement is a record, not a plan.`,
    };
  }

  if (p.status === 'Active') {
    return {
      ok: false,
      status: 409,
      code: 'ALREADY_ACTIVE',
      message: 'This engagement is already running. To agree a different plan, rebaseline it — '
        + 'that records the change and increments the version, which activating again would not.',
    };
  }

  // Resuming is not renegotiating. OnHold -> Active is a legal move and keeps
  // the baseline it already has, so it must not come through here and re-stamp
  // one: that would silently erase the slip the pause caused.
  if (p.status === 'OnHold') {
    return {
      ok: false,
      status: 409,
      code: 'RESUME_DOES_NOT_REBASELINE',
      message: 'This engagement is on hold. Resuming it keeps the plan that was already '
        + 'agreed — the time it spent paused is part of its record. Rebaseline separately, '
        + 'with a reason, if the plan itself has changed.',
    };
  }

  if (p.status !== 'Draft') {
    return {
      ok: false,
      status: 409,
      code: 'ILLEGAL_TRANSITION',
      message: `An engagement cannot be activated from ${p.status}.`,
    };
  }

  // See the header. This is the refusal that stops an engagement becoming
  // permanently incapable of reporting a slip.
  if (p.taskCount === 0) {
    return {
      ok: false,
      status: 409,
      code: 'NO_PLAN_TO_AGREE',
      message: p.phaseCount === 0
        ? 'There is no plan to agree. Add the phases and tasks first — activating stamps the '
          + 'agreed dates, and stamping an empty plan produces a baseline that nothing can ever '
          + 'be measured against.'
        : `This engagement has ${p.phaseCount} phase(s) and no tasks. Activating now would agree `
          + 'a plan with no work in it, and every task added afterwards would be baselined to its '
          + 'own due date — so nothing could ever be reported as slipped.',
    };
  }

  const warnings: string[] = [];

  if (p.targetEndDate <= now) {
    warnings.push(
      'The target end date has already passed. Activating now agrees a plan that is late on '
      + 'the day it is agreed, and every slippage figure will be measured from those dates.',
    );
  }

  if (p.tasksWithoutDueDate > 0) {
    warnings.push(
      `${p.tasksWithoutDueDate} of ${p.taskCount} task(s) have no due date. A task with no due `
      + 'date is baselined to nothing and can never be reported as slipped, so the agreed plan '
      + 'covers less of this engagement than the task count suggests.',
    );
  }

  if (p.baselineSetAt !== null) {
    warnings.push(
      'This engagement already carries a baseline. Activating will replace it.',
    );
  }

  return { ok: true, warnings };
}

// ─── Closing ────────────────────────────────────────────────────────────────

export interface ClosureFacts {
  /** Closed | Cancelled */
  outcome: string;
  reportedProgress: number;
  verifiedProgress: number;
  /** Tasks not finished by any reading. */
  openTasks: number;
  awaitingVerification: number;
  needsVerification: number;
  openBlockers: number;
  baselineSetAt: Date | null;
}

/**
 * What closing this engagement will freeze, in the words the person needs
 * before they do it.
 *
 * Not refusals: closing an unfinished engagement is a legitimate and common
 * act, and a product that refuses it just produces engagements nobody ever
 * closes — which is the state this whole packet exists to end. What matters is
 * that the person sees what the permanent record will say.
 *
 * The server keeps its own refusals (the transition table and the closure
 * note). This adds nothing it enforces; it only makes the consequence visible.
 */
export function closureConcerns(f: ClosureFacts): string[] {
  const out: string[] = [];
  const verb = f.outcome === 'Cancelled' ? 'Cancelling' : 'Closing';

  if (f.openTasks > 0) {
    out.push(
      `${f.openTasks} task(s) are not finished. ${verb} records the engagement as ending with `
      + 'them outstanding, and the closure note is where that is explained.',
    );
  }

  if (f.awaitingVerification > 0) {
    out.push(
      `${f.awaitingVerification} task(s) are with a reviewer and will stay there. They will `
      + 'count as claimed but never confirmed.',
    );
  }

  if (f.openBlockers > 0) {
    out.push(`${f.openBlockers} blocker(s) are still open and will be frozen unresolved.`);
  }

  // The gap between the two figures is the whole point of keeping them apart,
  // and closing is the moment it becomes permanent.
  if (f.outcome === 'Closed' && f.reportedProgress > f.verifiedProgress) {
    out.push(
      `${f.reportedProgress}% is claimed complete and ${f.verifiedProgress}% independently `
      + `confirmed. Closing fixes that ${f.reportedProgress - f.verifiedProgress}-point gap in `
      + 'the record: the difference is work nobody independent ever checked.',
    );
  }

  if (f.outcome === 'Closed' && f.baselineSetAt === null) {
    out.push(
      'This engagement was never activated, so it has no agreed plan. Closing it means no '
      + 'slippage can be reported for it at all — there is nothing to measure the dates against.',
    );
  }

  return out;
}

/**
 * Whether a note is enough to stand as the permanent record.
 *
 * Ten characters is not a quality bar. It stops an empty string and a full stop
 * from becoming the only answer anyone ever gets to "why did this end".
 */
export function noteIsEnough(note: unknown): boolean {
  return String(note ?? '').trim().length >= MIN_NOTE;
}
