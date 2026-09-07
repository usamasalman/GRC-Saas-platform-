import {
  schedule, derivedStatus, parseFrameworks,
} from './projectSchedule';
import { taskCounts, taskTiming, isComplete, requiresVerification, VERIFICATION_SLA_DAYS } from './projectLifecycle';
import { slippage, attribute } from './projectDelay';
import { evidenceStanding, clauseCoverage } from './projectEvidence';

/**
 * Everything the five delivery reports read, shaped once.
 *
 * Pure: it takes rows and returns figures. The queries live in the controller;
 * this is the layer that decides what the numbers MEAN, which is the part worth
 * testing without a database.
 *
 * One shape serves all five reports on purpose. Five loaders would be five
 * chances for two reports to disagree about how many tasks are blocked, and a
 * steering pack whose status report and phase report give different totals is
 * one nobody trusts again.
 */

export interface ReportProject {
  id: string;
  ref: string;
  name: string;
  status: string;
  health: string;
  healthNote: string | null;
  projectType: string;
  frameworks: string;
  reportedProgress: number;
  verifiedProgress: number;
  verificationPolicy: string;
  startDate: Date;
  targetEndDate: Date;
  actualEndDate: Date | null;
  baselineStartDate: Date | null;
  baselineTargetEndDate: Date | null;
  baselineVersion: number;
  closureNote: string | null;
}

/** The headline a steering committee reads first. */
export interface StatusFigures {
  reported: number;
  verified: number;
  /** Points of claimed work nobody independent has confirmed. */
  unverifiedGap: number;
  elapsedPercent: number;
  daysRemaining: number;
  overdue: boolean;
  daysOverdue: number;
  derived: string;
  /** The manager's opinion, and whether it disagrees with the arithmetic. */
  health: string;
  healthDisagrees: boolean;
  /** Days the end date has moved from the plan that was agreed. */
  scheduleSlipDays: number;
  baselined: boolean;
}

/**
 * The two numbers a committee actually needs, plus the disagreement between
 * opinion and arithmetic.
 *
 * `healthDisagrees` exists because Project.health is a judgement and
 * derivedStatus() is a calculation, and where they part company is the single
 * most informative thing on the page. A project 80% done and Red because the
 * remaining 20% is the hard part is exactly what a committee must hear, and a
 * report showing only one of the two hides it.
 */
export function statusFigures(p: ReportProject, now: Date = new Date()): StatusFigures {
  const s = schedule(p, now);
  const derived = derivedStatus(p, s);

  // Amber and Red are concerns; OnTrack and Completed are not. A manager
  // flagging concern the arithmetic cannot see, or arithmetic flagging what the
  // manager has not, are both worth surfacing — so this is symmetrical.
  const managerConcerned = p.health === 'Amber' || p.health === 'Red';
  const arithmeticConcerned = derived === 'AtRisk' || derived === 'Delayed';

  const slip = p.baselineTargetEndDate
    ? Math.round(
      (p.targetEndDate.getTime() - p.baselineTargetEndDate.getTime()) / 86_400_000,
    )
    : 0;

  return {
    reported: p.reportedProgress,
    verified: p.verifiedProgress,
    unverifiedGap: Math.max(0, p.reportedProgress - p.verifiedProgress),
    elapsedPercent: s.elapsedPercent,
    daysRemaining: s.remainingDays,
    overdue: s.overdue,
    daysOverdue: s.daysOverdue,
    derived,
    health: p.health,
    healthDisagrees: managerConcerned !== arithmeticConcerned,
    scheduleSlipDays: slip,
    baselined: p.baselineTargetEndDate !== null,
  };
}

/**
 * Two attention lists, deliberately not merged.
 *
 * An overdue task and a task sitting past the verification window are both
 * late, and they are late on two different people. Merging them produces a
 * chase list that sends the project manager to the assignee when the work has
 * been finished for a week and is waiting on a reviewer — which is how a
 * reviewer's queue becomes invisible.
 */
export interface AttentionLists<T> {
  /** Past the due date and still owed by whoever is doing it. */
  overdue: T[];
  /** Delivered, and sitting with a reviewer longer than the window allows. */
  awaitingReview: T[];
  /** Sent back and not yet picked up again. */
  rejected: T[];
  /** Stopped, with a recorded reason. */
  blocked: T[];
}

export function attentionLists<T extends {
  status: string; dueDate: Date | null; submittedAt?: Date | null;
}>(tasks: readonly T[], now: Date = new Date()): AttentionLists<T> {
  const out: AttentionLists<T> = { overdue: [], awaitingReview: [], rejected: [], blocked: [] };
  for (const t of tasks) {
    const timing = taskTiming(t, now);
    if (timing.overdue) out.overdue.push(t);
    if (timing.verificationOverdue) out.awaitingReview.push(t);
    if (t.status === 'Rejected') out.rejected.push(t);
    if (t.status === 'Blocked') out.blocked.push(t);
  }
  return out;
}

// ─── The audit verification section ─────────────────────────────────────────

export interface VerifiedTaskRow {
  ref: string;
  name: string;
  acceptedBy: string;
  acceptedSide: string;
  acceptedAt: Date | null;
  round: number;
  /** How many times it went back before it was accepted. */
  rejections: number;
  evidenceSeen: number;
  /** Evidence attached after the acceptance it appears to support. */
  evidenceAddedLater: number;
  /**
   * Whether the acceptor was demonstrably someone other than the doer and the
   * person who put the work forward.
   *
   * Three states, not two. `null` means it could not be established from the
   * record — and an unverifiable control is not a passed control, so it must
   * never be presented as one.
   */
  independent: boolean | null;
}

/**
 * The rows an auditor tests the verified figure against.
 *
 * `independent` is computed rather than asserted. Separation of duties is
 * enforced when a verification is recorded, so in practice it is always true —
 * but a report that says "we enforce this" is worth nothing to a sceptical
 * reader, and one that shows the acceptor differed from the doer on every line
 * lets them check it themselves. If it is ever false, that is the most
 * important row in the document.
 */
export function verificationRows(
  tasks: readonly {
    ref: string;
    name: string;
    status: string;
    assigneeId: string | null;
    submittedById: string | null;
    verifiedById: string | null;
    verifiedAt: Date | null;
    verificationRound: number;
    verifications: readonly {
      outcome: string; round: number; actorId: string; actorSide: string; createdAt: Date;
    }[];
    evidence: readonly { uploadedInRound: number; withdrawnAt: Date | null }[];
  }[],
  nameOf: (id: string | null) => string,
): VerifiedTaskRow[] {
  return tasks
    .filter((t) => t.status === 'Verified')
    .map((t) => {
      const accepted = [...t.verifications].reverse().find((v) => v.outcome === 'Accepted');
      const standings = t.evidence.map((e) => evidenceStanding(e, t));

      // The submitter is read from the verification history for the SAME round,
      // not from ProjectTask.submittedById. That column is nulled on withdraw
      // and on reopen, so comparing against it would sometimes be comparing
      // against null — which is trivially "not equal" and would report
      // independence without having checked anything.
      const submission = accepted
        ? t.verifications.find((v) => v.outcome === 'Submitted' && v.round === accepted.round)
        : undefined;

      const submitterId = submission?.actorId ?? t.submittedById;

      return {
        ref: t.ref,
        name: t.name,
        acceptedBy: nameOf(accepted?.actorId ?? t.verifiedById),
        acceptedSide: accepted?.actorSide ?? '—',
        acceptedAt: t.verifiedAt,
        round: t.verificationRound,
        rejections: t.verifications.filter((v) => v.outcome === 'Rejected').length,
        evidenceSeen: standings.filter((s) => s === 'Seen').length,
        evidenceAddedLater: standings.filter((s) => s === 'AddedLater').length,
        independent: !accepted || !submitterId
          ? null
          : accepted.actorId !== t.assigneeId && accepted.actorId !== submitterId,
      };
    });
}

/**
 * The one figure an auditor checks before reading anything else.
 *
 * A single acceptance that was not independent invalidates the verified
 * percentage as an assurance claim, so it is counted rather than described.
 */
export function verificationIntegrity(rows: readonly VerifiedTaskRow[]): {
  verifiedCount: number;
  independentCount: number;
  notIndependent: number;
  unestablished: number;
  withEvidenceAddedLater: number;
  acceptedFirstTime: number;
  clean: boolean;
} {
  // Counted apart from failures, because they mean different things: one is a
  // control that did not hold, the other a control whose operation cannot be
  // demonstrated. Both stop the set being clean — an auditor cannot rely on
  // what cannot be shown — but conflating them would tell the reader the wrong
  // thing to go and look at.
  const notIndependent = rows.filter((r) => r.independent === false).length;
  const unestablished = rows.filter((r) => r.independent === null).length;
  const addedLater = rows.filter((r) => r.evidenceAddedLater > 0).length;
  return {
    verifiedCount: rows.length,
    independentCount: rows.filter((r) => r.independent === true).length,
    notIndependent,
    unestablished,
    withEvidenceAddedLater: addedLater,
    acceptedFirstTime: rows.filter((r) => r.rejections === 0).length,
    clean: notIndependent === 0 && unestablished === 0 && addedLater === 0,
  };
}

/**
 * Complete AND independently confirmed.
 *
 * The predicate the audit report uses for clause coverage, in place of
 * isComplete. clauseCoverage() otherwise calls a clause "satisfied" once every
 * task mapped to it is finished — reviewed or not — which for a sceptical
 * reader is the same conflation the claimed/confirmed split exists to prevent,
 * one level down. A certification body is not interested in what somebody
 * ticked.
 */
export const isConfirmed = (status: string): boolean => status === 'Verified';

// ─── Traceability gaps ──────────────────────────────────────────────────────

/**
 * Clauses of an enabled standard that NO task maps to.
 *
 * The most useful thing a traceability report can say, and the only part of it
 * that requires looking at what is absent rather than what is present. A
 * coverage figure computed only over mapped clauses always looks good; the
 * clause nobody planned for is the one that surfaces in a certification audit.
 */
export function unmappedClauses(
  allClauses: readonly { id: string; ref: string; title: string; standardCode: string }[],
  mappedClauseIds: ReadonlySet<string>,
): { standardCode: string; ref: string; title: string }[] {
  return allClauses
    .filter((c) => !mappedClauseIds.has(c.id))
    .map((c) => ({ standardCode: c.standardCode, ref: c.ref, title: c.title }))
    .sort((a, b) => (a.standardCode + a.ref).localeCompare(b.standardCode + b.ref));
}

export { taskCounts, taskTiming, isComplete, requiresVerification, attribute, slippage, clauseCoverage, parseFrameworks, VERIFICATION_SLA_DAYS };
