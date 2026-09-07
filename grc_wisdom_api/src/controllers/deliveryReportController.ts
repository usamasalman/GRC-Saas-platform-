import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { guardProject, notFound } from '../services/projectGuard';
import {
  ReportDocument, ReportSection, ReportFormat, FORMATS, MIME,
  Provenance, fileNameFor, stampOf,
} from '../services/reportDocument';
import { renderPdf } from '../services/renderPdf';
import { renderDocx } from '../services/renderDocx';
import { renderXlsx } from '../services/renderXlsx';
import { brandingFor, logoBytesFor } from './brandingController';
import { effectiveMarking, selectSections } from '../services/tenantBranding';
import { documentHash, snapshotOf, documentRefFor } from '../services/reportIssue';
import {
  statusFigures, attentionLists, verificationRows, verificationIntegrity,
  unmappedClauses, taskCounts, attribute, slippage, clauseCoverage,
  parseFrameworks, isComplete, isConfirmed, requiresVerification, taskTiming,
} from '../services/deliveryReportData';
import { hasEverHadEvidence, evidenceStanding } from '../services/projectEvidence';

/**
 * The five delivery reports.
 *
 * Each answers to a named reader making a named decision, and each is built as
 * a ReportDocument that the three renderers already know how to draw — so
 * adding one costs no renderer change.
 *
 * Three rules run through all of them.
 *
 * Nothing here recomputes a stored figure. projectRollup is the sole writer of
 * every progress column; a report deriving its own would eventually disagree
 * with the plan screen, and the disagreement would be discovered in front of a
 * committee.
 *
 * Wherever a claimed figure appears, the confirmed one appears beside it. A
 * reader who can skim past the second number will.
 *
 * And a percentage is never printed without the standard it was measured
 * against. Under verificationPolicy 'None' the two figures are equal by
 * construction and the second carries no assurance at all — printing "100%
 * verified" there would be a lie told by the layout rather than by anyone.
 */

const str = (v: unknown): string => String(v ?? '');
const pct = (n: number) => `${n}%`;
const day = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : '—';

/** Slip is meaningless without an agreed date to slip from. */
const slipText = (baselined: boolean, days: number) =>
  !baselined ? 'Not baselined' : days === 0 ? 'On plan' : days > 0 ? `+${days}d` : `${days}d`;

/**
 * What the verified figure is worth, given the standard it was measured to.
 *
 * Under 'None' the two numbers are identical by construction, so the second is
 * arithmetic rather than assurance. Saying so next to it is the difference
 * between a report and a misleading one.
 */
function assuranceNote(policy: string): string {
  switch (policy) {
    case 'EveryTask':
      return 'Every task requires an independent reviewer before it counts as confirmed.';
    case 'EvidenceTasks':
      return 'Tasks that produced a deliverable require an independent reviewer. '
        + 'Tasks producing nothing count as confirmed once complete.';
    case 'SelectedTasks':
      return 'Only tasks marked for review require an independent reviewer. '
        + 'The rest count as confirmed once complete.';
    default:
      return 'This engagement does not carry out independent verification. The '
        + 'confirmed figure therefore equals the claimed figure and carries no '
        + 'assurance of its own.';
  }
}

function badFormat(res: Response) {
  res.status(400).json({
    status: 'error',
    code: 'UNSUPPORTED_FORMAT',
    message: `format must be one of: ${FORMATS.join(', ')}`,
  });
}

const formatOf = (req: AuthenticatedRequest): ReportFormat | null => {
  const raw = String(req.query.format || 'pdf').toLowerCase();
  return (FORMATS as string[]).includes(raw) ? (raw as ReportFormat) : null;
};

// ─── The shared load ────────────────────────────────────────────────────────

/**
 * Everything the five reports read, in one query.
 *
 * One loader rather than five, because five would be five chances for two
 * reports to disagree about how many tasks are blocked — and a steering pack
 * whose status report and phase report give different totals is one nobody
 * trusts again.
 */
async function loadEngagement(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true, ref: true, name: true, status: true, health: true, healthNote: true,
      projectType: true, frameworks: true, reportedProgress: true, verifiedProgress: true,
      verificationPolicy: true, startDate: true, targetEndDate: true, actualEndDate: true,
      baselineStartDate: true, baselineTargetEndDate: true, baselineVersion: true,
      baselineSetAt: true, closureNote: true, tenantId: true, providerTenantId: true,
      owner: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true } },
      sponsor: { select: { id: true, name: true } },
      tenant: { select: { name: true } },
      providerTenant: { select: { name: true } },
      phases: {
        orderBy: [{ sequence: 'asc' }],
        select: {
          id: true, sequence: true, name: true, objectives: true, status: true,
          startDate: true, targetEndDate: true, baselineTargetEndDate: true,
          reportedProgress: true, verifiedProgress: true,
          owner: { select: { id: true, name: true } },
          tasks: {
            orderBy: [{ sequence: 'asc' }],
            select: {
              id: true, ref: true, name: true, status: true, completionPercent: true,
              weight: true, priority: true, side: true, department: true,
              startDate: true, dueDate: true, completedAt: true,
              baselineDueDate: true, verificationOverride: true, verificationRound: true,
              submittedAt: true, verifiedAt: true,
              assigneeId: true, submittedById: true, verifiedById: true,
              assignee: { select: { id: true, name: true } },
              submittedBy: { select: { id: true, name: true } },
              verifiedBy: { select: { id: true, name: true } },
              verifications: {
                orderBy: { createdAt: 'asc' },
                select: {
                  round: true, outcome: true, actorId: true, actorSide: true,
                  note: true, createdAt: true,
                  actor: { select: { id: true, name: true } },
                },
              },
              evidence: {
                select: {
                  id: true, ref: true, title: true, classification: true, side: true,
                  fileName: true, sha256: true, uploadedInRound: true, uploadedAt: true,
                  withdrawnAt: true, withdrawnReason: true,
                  uploadedBy: { select: { name: true } },
                },
              },
              clauseLinks: {
                select: {
                  clauseId: true,
                  clause: {
                    select: {
                      id: true, ref: true, title: true,
                      standard: { select: { id: true, code: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      impediments: {
        orderBy: [{ raisedAt: 'asc' }],
        select: {
          id: true, ref: true, kind: true, category: true, owingSide: true,
          severity: true, title: true, description: true, impactDays: true,
          expectedClearDate: true, raisedAt: true, resolvedAt: true, resolutionNote: true,
          raisedBy: { select: { name: true } },
          task: { select: { ref: true } },
          phase: { select: { name: true } },
        },
      },
    },
  });
}

type Engagement = NonNullable<Awaited<ReturnType<typeof loadEngagement>>>;

const allTasks = (e: Engagement) => e.phases.flatMap((p) => p.tasks);

/** Names resolved from what the query already loaded, not by a second lookup. */
function nameLookup(e: Engagement): (id: string | null) => string {
  const names = new Map<string, string>();
  for (const t of allTasks(e)) {
    for (const v of t.verifications) if (v.actor) names.set(v.actor.id, v.actor.name);
    if (t.assignee) names.set(t.assignee.id, t.assignee.name);
    if (t.verifiedBy) names.set(t.verifiedBy.id, t.verifiedBy.name);
    if (t.submittedBy) names.set(t.submittedBy.id, t.submittedBy.name);
  }
  return (id) => (id ? names.get(id) || 'Unknown' : '—');
}

// ─── Section builders, one per report ───────────────────────────────────────

/**
 * What this committee is being asked to decide.
 *
 * Nothing in the schema stores a decision request, so these are composed from
 * the conditions only a steering committee can clear.
 *
 * Filtered to CLIENT-owed blockers deliberately. A committee handed every open
 * impediment as a "decision" learns to skip the section, because most of them
 * are not theirs to make - a provider-capacity blocker is a report, not a
 * request.
 *
 * The empty case is stated rather than omitted: an absent section is
 * indistinguishable from an oversight, and a manager who genuinely needs
 * nothing should be on record saying so.
 */
function decisionsRequested(
  e: Engagement, f: ReturnType<typeof statusFigures>, now: Date,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];

  for (const i of e.impediments) {
    if (i.kind !== 'Blocker' || i.resolvedAt || i.owingSide !== 'Client') continue;
    out.push({
      label: 'Clear ' + i.ref + ': ' + i.title,
      value: 'Owed by the client since ' + day(i.raisedAt) + '. '
        + (i.expectedClearDate ? 'Expected clear ' + day(i.expectedClearDate) + '. ' : '')
        + 'Until it clears the work behind it cannot move.',
    });
  }

  const waiting = allTasks(e).filter((t) => taskTiming(t as any, now).verificationOverdue);
  if (waiting.length) {
    out.push({
      label: 'Name a reviewer for ' + waiting.length + ' delivered task(s)',
      value: 'These were finished on time and are waiting on a reviewer, not on '
        + 'the people doing the work. The constraint is review capacity.',
    });
  }

  if (f.baselined && f.scheduleSlipDays > 0) {
    out.push({
      label: 'Accept or refuse a ' + f.scheduleSlipDays + '-day movement in the end date',
      value: 'The agreed plan (v' + e.baselineVersion + ') targets '
        + day(e.baselineTargetEndDate) + '; the engagement is working to '
        + day(e.targetEndDate) + '. Accepting means rebaselining, which resets '
        + 'what future slip is measured against.',
    });
  }

  const scope = e.impediments.filter((i) => i.category === 'ScopeChange' && !i.resolvedAt);
  if (scope.length) {
    out.push({
      label: 'Authorise ' + scope.length + ' scope change(s) and their cost',
      value: scope.map((i) => i.ref + ': ' + i.title).join('; '),
    });
  }

  if (out.length === 0) {
    out.push({
      label: 'No decision is asked',
      value: 'The engagement manager reports nothing this period requiring the '
        + 'authority of this committee.',
    });
  }
  return out;
}

/**
 * The steering committee's paper.
 *
 * Leads with the two figures side by side and the gap between them stated as
 * its own number, because a committee that reads "87% complete" behaves
 * differently from one that reads "87% claimed, 41% confirmed, 46 points
 * unconfirmed" — and the third phrasing is the only one that cannot be skimmed.
 */
function statusSections(e: Engagement, now: Date): ReportSection[] {
  const f = statusFigures(e as any, now);
  const tasks = allTasks(e);
  const counts = taskCounts(tasks, now);
  const openImpediments = e.impediments.filter((i) => i.kind === 'Blocker' && !i.resolvedAt);
  const att = attribute(e.impediments as any, now);

  const sections: ReportSection[] = [
    {
      kind: 'fields',
      title: 'Where this engagement stands',
      fields: [
        { label: 'Engagement', value: `${e.ref} — ${e.name}` },
        { label: 'Client', value: e.tenant?.name ?? '—' },
        { label: 'Delivered by', value: e.providerTenant?.name ?? 'The organisation itself' },
        { label: 'Status', value: e.status },
        { label: 'Target date', value: day(e.targetEndDate) },
        {
          label: 'Against the agreed date',
          value: slipText(f.baselined, f.scheduleSlipDays)
            + (e.baselineVersion > 1 ? ` (plan v${e.baselineVersion})` : ''),
        },
        {
          label: 'Time',
          value: f.overdue
            ? `${f.daysOverdue} days past target`
            : `${f.daysRemaining} days remaining, ${pct(f.elapsedPercent)} elapsed`,
        },
      ],
    },
    {
      kind: 'fields',
      title: 'Two readings of the same engagement',
      fields: [
        // ONE field, one string. Two adjacent fields can be separated by eye,
        // by highlighter, or by copy-and-paste into minutes; fused, the
        // flattering number cannot travel without the other.
        {
          label: 'Progress',
          value: f.unverifiedGap === 0
            ? pct(f.reported) + ' reported, all of it independently confirmed'
            : pct(f.reported) + ' reported / ' + pct(f.verified)
              + ' independently confirmed \u2014 ' + f.unverifiedGap
              + ' points claimed but not confirmed',
        },
        { label: 'What confirmation means here', value: assuranceNote(e.verificationPolicy) },
        // Project.health DEFAULTS to Green, so an untouched field and a
        // considered assessment are indistinguishable in the data. Printing a
        // bare "Green" launders one into the other.
        {
          label: 'Manager judgement \u2014 an opinion, entered by a person',
          value: e.healthNote
            ? e.health + ' \u2014 ' + e.healthNote
            : e.health + ' (no note recorded)',
        },
        // The arithmetic prints its own inputs, so it reads as an argument
        // rather than as a second opinion. A committee shown a bare "At Risk"
        // beside a human "Green" defaults to the human, who is in the room.
        {
          label: 'Schedule arithmetic \u2014 computed, nobody entered this',
          value: f.derived + ' \u2014 ' + pct(f.elapsedPercent)
            + ' of the calendar spent against ' + pct(f.reported) + ' of work reported',
        },
        {
          label: 'Reading',
          value: (f.healthDisagrees
            ? 'These two disagree, and the disagreement is the point of this section. '
            : 'These two agree. ')
            + 'The arithmetic is calculated from the reported figure, never the '
            + 'confirmed one, so it is the optimistic reading: against confirmed '
            + 'progress the drift is '
            + Math.max(0, f.elapsedPercent - f.verified) + ' points.',
        },
      ],
    },
    // Placed ahead of every table on purpose. A committee reading top-down with
    // four papers runs out of time from the bottom, and this is the only
    // section that produces an output rather than an impression.
    {
      kind: 'fields',
      title: 'Decisions requested of this committee',
      fields: decisionsRequested(e, f, now),
    },
    {
      kind: 'fields',
      title: 'Time lost, and to whom',
      fields: [
        { label: 'Total days lost', value: String(att.totalDays) },
        { label: 'Owed by the client', value: String(att.bySide.Client ?? 0) },
        { label: 'Owed by the provider', value: String(att.bySide.Provider ?? 0) },
        { label: 'Owed by a third party', value: String(att.bySide.ThirdParty ?? 0) },
        { label: 'Still open', value: `${att.openCount} blocker(s), ${att.openDays} day(s) and counting` },
        {
          label: 'Reading these figures',
          value: 'An open blocker is costed to today, so the same unresolved '
            + 'blocker reports a larger number every month - that is it '
            + 'continuing, not new damage. Days are gross: recovery by one side '
            + 'is never netted against days attributed to the other.',
        },
      ],
    },
  ];

  if (openImpediments.length > 0) {
    sections.push({
      kind: 'table',
      title: 'Blockers open now',
      columns: [
        { header: 'Ref', key: 'ref', width: 10 },
        { header: 'What is blocking', key: 'title', width: 46 },
        { header: 'Owed by', key: 'owingSide', width: 12 },
        { header: 'Open since', key: 'raised', width: 12 },
        { header: 'Severity', key: 'severity', width: 10 },
      ],
      rows: openImpediments.map((i) => ({
        ref: i.ref, title: i.title, owingSide: i.owingSide,
        raised: day(i.raisedAt), severity: i.severity,
      })),
    });
  }

  sections.push({
    kind: 'table',
    title: 'Where the work stands, by phase',
    columns: [
      { header: '#', key: 'seq', width: 5 },
      { header: 'Phase', key: 'name', width: 34 },
      { header: 'Status', key: 'status', width: 13 },
      { header: 'Claimed', key: 'reported', width: 10 },
      { header: 'Confirmed', key: 'verified', width: 11 },
      { header: 'Target', key: 'target', width: 12 },
    ],
    rows: e.phases.map((p) => ({
      seq: p.sequence, name: p.name, status: p.status,
      reported: pct(p.reportedProgress), verified: pct(p.verifiedProgress),
      target: day(p.targetEndDate),
    })),
  });

  sections.push({
    kind: 'fields',
    title: 'Assurance reach',
    fields: [
      { label: 'Tasks in the plan', value: String(counts.total) },
      { label: 'Complete', value: String(counts.done) },
      { label: 'Requiring independent review', value: String(counts.needsVerification) },
      { label: 'Independently confirmed', value: String(counts.verified) },
      { label: 'Waiting on a reviewer', value: String(counts.awaitingVerification) },
      { label: 'Sent back for rework', value: String(counts.rejected) },
      { label: 'Overdue', value: String(counts.overdue) },
    ],
  });

  return sections;
}

/**
 * The phase owner's weekly chase list.
 *
 * Four separate tables rather than one, because "late" is four different
 * situations owed by four different people. Merging them sends the manager to
 * the assignee for work that has been finished for a week and is sitting with a
 * reviewer — which is exactly how a reviewer's queue stays invisible.
 */
function phaseSections(e: Engagement, phaseId: string, now: Date): ReportSection[] | null {
  const p = e.phases.find((x) => x.id === phaseId);
  if (!p) return null;

  const att = attentionLists(p.tasks as any, now);
  const counts = taskCounts(p.tasks as any, now);
  const phaseImpediments = e.impediments.filter(
    (i) => i.phase?.name === p.name && i.kind === 'Blocker' && !i.resolvedAt,
  );

  const taskRow = (t: any) => ({
    ref: t.ref,
    name: t.name,
    who: t.assignee?.name ?? 'Unassigned',
    due: day(t.dueDate),
    status: t.status,
  });

  const sections: ReportSection[] = [
    {
      kind: 'fields',
      title: 'Phase and plan',
      fields: [
        { label: 'Engagement', value: `${e.ref} — ${e.name}` },
        { label: 'Phase', value: `${p.sequence}. ${p.name}` },
        { label: 'Owner', value: p.owner?.name ?? '—' },
        { label: 'Window', value: `${day(p.startDate)} to ${day(p.targetEndDate)}` },
        {
          label: 'Against the agreed date',
          value: p.baselineTargetEndDate
            ? slipText(true, Math.round(
              (p.targetEndDate.getTime() - p.baselineTargetEndDate.getTime()) / 86_400_000))
            : 'Not baselined',
        },
        // Deliberately the phase's own status, from the rollup. derivedStatus()
        // speaks the project's vocabulary — Draft, Closed, Cancelled — and a
        // phase status of Complete matches none of it, so a finished phase past
        // its date would fall through and print as Delayed.
        { label: 'Status', value: p.status },
        { label: 'Claimed', value: pct(p.reportedProgress) },
        { label: 'Confirmed', value: pct(p.verifiedProgress) },
      ],
    },
    {
      kind: 'fields',
      title: 'Where the phase stands this week',
      fields: [
        { label: 'Tasks', value: String(counts.total) },
        { label: 'Complete', value: String(counts.done) },
        { label: 'In progress', value: String(counts.inProgress) },
        { label: 'Overdue — the assignee owes these', value: String(att.overdue.length) },
        { label: 'With a reviewer too long', value: String(att.awaitingReview.length) },
        { label: 'Sent back', value: String(att.rejected.length) },
        { label: 'Blocked', value: String(att.blocked.length) },
      ],
    },
  ];

  const COLUMNS = [
    { header: 'Ref', key: 'ref', width: 10 },
    { header: 'Task', key: 'name', width: 42 },
    { header: 'Who', key: 'who', width: 20 },
    { header: 'Due', key: 'due', width: 12 },
    { header: 'Status', key: 'status', width: 22 },
  ];

  if (att.overdue.length) {
    sections.push({
      kind: 'table', title: 'Overdue — the assignee owes these',
      columns: COLUMNS, rows: att.overdue.map(taskRow),
    });
  }
  if (att.awaitingReview.length) {
    sections.push({
      kind: 'table',
      title: 'With a reviewer — delivered, and waiting too long',
      // `who` names whoever SUBMITTED it, not a reviewer: verifiedById is only
      // written when the decision is made, so while a task waits there is no
      // reviewer to name. This column says who to ask, not who owes it.
      columns: COLUMNS,
      rows: att.awaitingReview.map((t: any) => ({
        ...taskRow(t),
        who: t.submittedBy?.name ?? t.assignee?.name ?? '—',
        status: `Submitted ${day(t.submittedAt)}`,
      })),
    });
  }
  if (att.rejected.length) {
    sections.push({
      kind: 'table', title: 'Sent back — with the doer again',
      columns: COLUMNS, rows: att.rejected.map(taskRow),
    });
  }
  if (att.blocked.length) {
    sections.push({
      kind: 'table', title: 'Blocked — waiting on an impediment',
      columns: COLUMNS, rows: att.blocked.map(taskRow),
    });
  }
  if (phaseImpediments.length) {
    sections.push({
      kind: 'table',
      title: 'Impediments against this phase',
      columns: [
        { header: 'Ref', key: 'ref', width: 10 },
        { header: 'What', key: 'title', width: 46 },
        { header: 'Owed by', key: 'owingSide', width: 12 },
        { header: 'Since', key: 'raised', width: 12 },
      ],
      rows: phaseImpediments.map((i) => ({
        ref: i.ref, title: i.title, owingSide: i.owingSide, raised: day(i.raisedAt),
      })),
    });
  }

  // Work nobody can chase, because nobody owns it or nothing is due. Small and
  // easy to leave out, and the reason a plan quietly stops being a plan.
  const unchaseable = p.tasks.filter(
    (t) => !isComplete(t.status) && (!t.assigneeId || !t.dueDate),
  );
  if (unchaseable.length) {
    sections.push({
      kind: 'table',
      title: 'Cannot be chased — no owner or no date',
      columns: COLUMNS, rows: unchaseable.map(taskRow),
    });
  }

  return sections;
}

/**
 * The artefact an external auditor reads.
 *
 * The verification section exists so a sceptical reader can TEST the confirmed
 * figure rather than take it. Separation of duties is enforced when a
 * verification is recorded, so `independent` is true on every row in practice —
 * but a report asserting "we enforce this" is worth nothing to an auditor, and
 * one showing the acceptor differed from the doer on every line lets them check
 * it themselves.
 */
function auditSections(e: Engagement, now: Date): ReportSection[] {
  const tasks = allTasks(e);
  const nameOf = nameLookup(e);
  const rows = verificationRows(tasks as any, nameOf);
  const integrity = verificationIntegrity(rows);
  const counts = taskCounts(tasks, now);

  // Coverage measured against CONFIRMED work, not merely finished work.
  // clauseCoverage's default predicate admits Done, which would call a clause
  // satisfied once every task mapped to it was ticked — for this reader that is
  // the same conflation the claimed/confirmed split exists to prevent, one
  // level down. A certification body is not interested in what somebody ticked.
  const traced = tasks.map((t) => ({
    id: t.id,
    status: t.status,
    clauseLinks: t.clauseLinks.map((l) => ({
      clauseId: l.clauseId, standardCode: l.clause.standard.code,
    })),
  }));
  const claimedCoverage = clauseCoverage(traced, isComplete);
  const confirmedCoverage = clauseCoverage(traced, isConfirmed);

  const sections: ReportSection[] = [
    {
      kind: 'fields',
      title: 'Engagement',
      fields: [
        { label: 'Reference', value: e.ref },
        { label: 'Name', value: e.name },
        { label: 'Client', value: e.tenant?.name ?? '—' },
        { label: 'Delivered by', value: e.providerTenant?.name ?? 'The organisation itself' },
        { label: 'Type', value: e.projectType },
        { label: 'Frameworks in scope', value: parseFrameworks(e.frameworks).join(', ') || '—' },
        { label: 'Period', value: `${day(e.startDate)} to ${day(e.actualEndDate || e.targetEndDate)}` },
        { label: 'Status at export', value: e.status },
        { label: 'Accountable', value: e.owner?.name ?? '—' },
        { label: 'Managed by', value: e.manager?.name ?? '—' },
      ],
    },
    {
      kind: 'fields',
      title: 'The basis of the confirmed figure',
      fields: [
        { label: 'Verification policy', value: e.verificationPolicy },
        { label: 'What that means', value: assuranceNote(e.verificationPolicy) },
        { label: 'Work claimed complete', value: pct(e.reportedProgress) },
        { label: 'Independently confirmed', value: pct(e.verifiedProgress) },
        { label: 'Tasks requiring review', value: String(counts.needsVerification) },
        { label: 'Tasks confirmed', value: String(integrity.verifiedCount) },
        { label: 'Confirmed at the first attempt', value: String(integrity.acceptedFirstTime) },
        {
          label: 'Acceptances by someone other than the doer',
          value: `${integrity.independentCount} of ${integrity.verifiedCount}`,
        },
        {
          label: 'Acceptances failing that test',
          value: integrity.notIndependent === 0
            ? 'None'
            : `${integrity.notIndependent} — see the table below`,
        },
        // Counted apart from failures, because they are different findings. An
        // unverifiable control is not a passed control, and presenting it as
        // one is the error this row exists to prevent.
        {
          label: 'Acceptances that could not be tested',
          value: integrity.unestablished === 0
            ? 'None'
            : `${integrity.unestablished} — the record does not establish who put `
              + 'the work forward, so independence cannot be demonstrated',
        },
        {
          label: 'Evidence attached after its acceptance',
          value: integrity.withEvidenceAddedLater === 0
            ? 'None'
            : `${integrity.withEvidenceAddedLater} task(s)`,
        },
      ],
    },
  ];

  sections.push({
    kind: 'fields',
    title: 'Traceability, on the same two readings',
    fields: [
      { label: 'Clauses the plan maps to', value: String(claimedCoverage.clausesCovered) },
      {
        label: 'Clauses whose every task is finished',
        value: String(claimedCoverage.clausesSatisfied),
      },
      {
        label: 'Clauses whose every task was independently confirmed',
        value: String(confirmedCoverage.clausesSatisfied),
      },
      {
        label: 'Why the last two differ',
        value: 'The middle figure counts work somebody marked finished. The last '
          + 'counts only work a second person confirmed. Where they differ, the '
          + 'difference is work this organisation has asserted and nobody has '
          + 'checked.',
      },
    ],
  });

  if (rows.length) {
    sections.push({
      kind: 'table',
      title: 'Verification record — every confirmed task',
      columns: [
        { header: 'Task', key: 'ref', width: 10 },
        { header: 'Accepted by', key: 'by', width: 22 },
        { header: 'Side', key: 'side', width: 10 },
        { header: 'On', key: 'on', width: 12 },
        { header: 'Attempts', key: 'attempts', width: 9 },
        { header: 'Independent', key: 'independent', width: 12 },
      ],
      rows: rows.map((r) => ({
        ref: r.ref, by: r.acceptedBy, side: r.acceptedSide, on: day(r.acceptedAt),
        attempts: r.rejections + 1,
        independent: r.independent === true ? 'Yes'
          : r.independent === false ? 'NO — SEE NOTE'
            : 'Cannot be established',
      })),
    });
  }

  const standingEvidence = tasks.flatMap((t) =>
    t.evidence.map((ev) => ({ task: t, ev, standing: evidenceStanding(ev, t as any) })));

  if (standingEvidence.length) {
    sections.push({
      kind: 'table',
      title: 'Evidence held',
      columns: [
        { header: 'Ref', key: 'ref', width: 10 },
        { header: 'Task', key: 'task', width: 10 },
        { header: 'Evidence', key: 'title', width: 38 },
        { header: 'Class', key: 'cls', width: 13 },
        { header: 'Standing', key: 'standing', width: 18 },
        { header: 'SHA-256 (first 16)', key: 'hash', width: 20 },
      ],
      rows: standingEvidence.map(({ task, ev, standing }) => ({
        ref: ev.ref, task: task.ref, title: ev.title, cls: ev.classification,
        standing: standing === 'AddedLater' ? 'ADDED AFTER SIGN-OFF' : standing,
        hash: (ev.sha256 || '').slice(0, 16),
      })),
    });
  }

  return sections;
}

/**
 * The paper read at a contract review, by both parties.
 *
 * One of them will not like it, so every figure has to be defensible line by
 * line — which is why the gross total and the net position are both stated,
 * with the difference explained. A reader who spots the discrepancy unaided
 * concludes the report is wrong.
 */
function delaySections(e: Engagement, now: Date): ReportSection[] {
  const att = attribute(e.impediments as any, now);
  const tasks = allTasks(e);

  const slipped = tasks
    .map((t) => ({ t, s: slippage(t as any) }))
    .filter((x) => x.s.slipped);
  const netTaskSlip = slipped.reduce((n, x) => n + x.s.slipDays, 0);

  const sections: ReportSection[] = [
    {
      kind: 'fields',
      title: 'Engagement',
      fields: [
        { label: 'Engagement', value: `${e.ref} — ${e.name}` },
        { label: 'Client', value: e.tenant?.name ?? '—' },
        { label: 'Delivered by', value: e.providerTenant?.name ?? 'The organisation itself' },
        { label: 'Agreed end date', value: day(e.baselineTargetEndDate) },
        { label: 'Current end date', value: day(e.targetEndDate) },
        { label: 'Plan version', value: String(e.baselineVersion) },
      ],
    },
    {
      kind: 'fields',
      title: 'Days lost, and to whom',
      fields: [
        { label: 'Owed by the client', value: String(att.bySide.Client ?? 0) },
        { label: 'Owed by the provider', value: String(att.bySide.Provider ?? 0) },
        { label: 'Owed by a third party', value: String(att.bySide.ThirdParty ?? 0) },
        { label: 'Total recorded', value: String(att.totalDays) },
        { label: 'Episodes', value: `${att.resolvedCount} closed, ${att.openCount} open` },
        // Both numbers, and the reason they differ. Charges are gross: a date
        // pulled back in is never refunded, because the recovery was somebody's
        // work and netting it off would let one side's effort silently cancel
        // days attributed to the other.
        { label: 'Net movement across tasks', value: `${netTaskSlip} day(s)` },
        {
          label: 'Why those two differ',
          value: 'Recorded days are gross. Where a date slipped and was later '
            + 'partly recovered, both the loss and the recovery happened — the '
            + 'recovery was somebody\'s work, and netting it off would let one '
            + 'party\'s effort cancel days attributed to the other. The gross '
            + 'figure is therefore the higher of the two whenever anything was '
            + 'pulled back in.',
        },
      ],
    },
  ];

  const byCategory = Object.entries(att.byCategory).sort((a, b) => b[1] - a[1]);
  if (byCategory.length) {
    sections.push({
      kind: 'table',
      title: 'Days lost by cause',
      columns: [
        { header: 'Cause', key: 'cause', width: 26 },
        { header: 'Days', key: 'days', width: 10 },
      ],
      rows: byCategory.map(([cause, days]) => ({
        cause: cause.replace(/([a-z])([A-Z])/g, '$1 $2'), days,
      })),
    });
  }

  if (e.impediments.length) {
    sections.push({
      kind: 'table',
      title: 'Every impediment recorded',
      columns: [
        { header: 'Ref', key: 'ref', width: 10 },
        { header: 'What', key: 'title', width: 40 },
        { header: 'Cause', key: 'category', width: 20 },
        { header: 'Owed by', key: 'owingSide', width: 12 },
        { header: 'Days', key: 'days', width: 8 },
        { header: 'State', key: 'state', width: 14 },
      ],
      rows: e.impediments.map((i) => ({
        ref: i.ref,
        title: i.title,
        category: i.category.replace(/([a-z])([A-Z])/g, '$1 $2'),
        owingSide: i.owingSide,
        days: i.impactDays ?? '—',
        state: i.kind === 'Delay' ? 'Recorded'
          : i.resolvedAt ? `Cleared ${day(i.resolvedAt)}` : 'Open',
      })),
    });
  }

  if (slipped.length) {
    sections.push({
      kind: 'table',
      title: 'Tasks whose date moved past the agreed one',
      columns: [
        { header: 'Ref', key: 'ref', width: 10 },
        { header: 'Task', key: 'name', width: 42 },
        { header: 'Agreed', key: 'agreed', width: 12 },
        { header: 'Now', key: 'now', width: 12 },
        { header: 'Slip', key: 'slip', width: 8 },
      ],
      rows: slipped.map(({ t, s }) => ({
        ref: t.ref, name: t.name,
        agreed: day(t.baselineDueDate), now: day(t.dueDate), slip: `+${s.slipDays}d`,
      })),
    });
  }

  return sections;
}

/**
 * The compliance officer's certification-readiness paper.
 *
 * The gap direction nobody asks for is the useful one: clauses of an enabled
 * standard that NO task maps to. A coverage figure computed only over mapped
 * clauses always looks good, and the clause nobody planned for is the one that
 * surfaces in the certification audit.
 */
async function evidenceSections(e: Engagement, now: Date): Promise<ReportSection[]> {
  const tasks = allTasks(e);

  const coverage = clauseCoverage(
    tasks.map((t) => ({
      id: t.id,
      status: t.status,
      clauseLinks: t.clauseLinks.map((l) => ({
        clauseId: l.clauseId, standardCode: l.clause.standard.code,
      })),
    })),
    isComplete,
  );

  const mappedIds = new Set(tasks.flatMap((t) => t.clauseLinks.map((l) => l.clauseId)));
  const standardIds = [...new Set(
    tasks.flatMap((t) => t.clauseLinks.map((l) => l.clause.standard.id)),
  )];

  // Only clauses of standards this engagement actually touches. Listing every
  // clause of every standard in the library would bury the real gaps.
  const allClauses = standardIds.length
    ? await prisma.standardClause.findMany({
      where: { standardId: { in: standardIds } },
      select: {
        id: true, ref: true, title: true,
        standard: { select: { code: true } },
      },
    })
    : [];

  const gaps = unmappedClauses(
    allClauses.map((c) => ({
      id: c.id, ref: c.ref, title: c.title, standardCode: c.standard.code,
    })),
    mappedIds,
  );

  const sections: ReportSection[] = [
    {
      kind: 'fields',
      title: 'Engagement',
      fields: [
        { label: 'Engagement', value: `${e.ref} — ${e.name}` },
        { label: 'Client', value: e.tenant?.name ?? '—' },
        { label: 'Frameworks in scope', value: parseFrameworks(e.frameworks).join(', ') || '—' },
        { label: 'Status at export', value: e.status },
      ],
    },
    {
      kind: 'fields',
      title: 'How far the plan traces',
      fields: [
        { label: 'Clauses the plan maps to', value: String(coverage.clausesCovered) },
        {
          label: 'Clauses whose every task is finished',
          value: String(coverage.clausesSatisfied),
        },
        // The distinction the report exists to protect. Mistaking the first for
        // the second walks into a certification audit believing you are covered.
        {
          label: 'The difference',
          value: 'A clause the plan MAPS TO is an intention. A clause whose every '
            + 'mapped task is finished is something you can defend. Only the '
            + 'second figure is evidence of anything.',
        },
        { label: 'Clauses in scope with no task at all', value: String(gaps.length) },
        { label: 'Tasks carrying a clause link', value: `${coverage.tasksMapped} of ${coverage.tasksTotal}` },
      ],
    },
  ];

  const perStandard = Object.entries(coverage.byStandard);
  if (perStandard.length) {
    sections.push({
      kind: 'table',
      title: 'By framework',
      columns: [
        { header: 'Framework', key: 'code', width: 18 },
        { header: 'Clauses mapped', key: 'covered', width: 16 },
        { header: 'Clauses defensible', key: 'satisfied', width: 18 },
      ],
      rows: perStandard.map(([code, c]) => ({
        code, covered: c.covered, satisfied: c.satisfied,
      })),
    });
  }

  if (gaps.length) {
    sections.push({
      kind: 'table',
      title: 'Clauses in scope that no task addresses',
      columns: [
        { header: 'Framework', key: 'std', width: 16 },
        { header: 'Clause', key: 'ref', width: 14 },
        { header: 'Title', key: 'title', width: 52 },
      ],
      rows: gaps.map((g) => ({ std: g.standardCode, ref: g.ref, title: g.title })),
    });
  }

  const links = tasks.flatMap((t) => t.clauseLinks.map((l) => ({ t, l })));
  if (links.length) {
    sections.push({
      kind: 'table',
      title: 'What addresses each clause',
      columns: [
        { header: 'Framework', key: 'std', width: 14 },
        { header: 'Clause', key: 'clause', width: 12 },
        { header: 'Task', key: 'ref', width: 10 },
        { header: 'Work', key: 'name', width: 38 },
        { header: 'State', key: 'status', width: 20 },
        { header: 'Evidence', key: 'evidence', width: 10 },
      ],
      rows: links.map(({ t, l }) => ({
        std: l.clause.standard.code,
        clause: l.clause.ref,
        ref: t.ref,
        name: t.name,
        status: t.status,
        evidence: t.evidence.filter((ev) => !ev.withdrawnAt).length,
      })),
    });
  }

  const evidence = tasks.flatMap((t) =>
    t.evidence.map((ev) => ({ t, ev, standing: evidenceStanding(ev, t as any) })));
  if (evidence.length) {
    sections.push({
      kind: 'table',
      title: 'Evidence register',
      columns: [
        { header: 'Ref', key: 'ref', width: 10 },
        { header: 'Evidence', key: 'title', width: 38 },
        { header: 'Task', key: 'task', width: 10 },
        { header: 'Produced by', key: 'side', width: 12 },
        { header: 'Class', key: 'cls', width: 13 },
        { header: 'Standing', key: 'standing', width: 18 },
      ],
      rows: evidence.map(({ t, ev, standing }) => ({
        ref: ev.ref, title: ev.title, task: t.ref, side: ev.side,
        cls: ev.classification,
        standing: standing === 'AddedLater' ? 'ADDED AFTER SIGN-OFF' : standing,
      })),
    });
  }

  return sections;
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

const REPORTS: Record<string, { name: string; key: string }> = {
  status: { name: 'Engagement Status Report', key: 'delivery-status' },
  phase: { name: 'Phase Delivery Report', key: 'delivery-phase' },
  audit: { name: 'Delivery Audit Report', key: 'delivery-audit' },
  delay: { name: 'Delay and Impediment Report', key: 'delivery-delay' },
  evidence: { name: 'Evidence and Traceability Report', key: 'delivery-evidence' },
};

/**
 * Build, record and send one delivery report.
 *
 * The record is written whether or not the caller asked for a formal issue: a
 * plain export is a disclosure — somebody now holds a copy of the client's
 * unremediated weaknesses — and a register with no row for it cannot answer who
 * has one.
 */
export const exportDeliveryReport = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const kind = str(req.params.kind);
    const meta = REPORTS[kind];
    if (!meta) {
      res.status(404).json({
        status: 'error',
        code: 'UNKNOWN_REPORT',
        message: `report must be one of: ${Object.keys(REPORTS).join(', ')}`,
      });
      return;
    }

    const format = formatOf(req);
    if (!format) { badFormat(res); return; }

    const { project: guarded } = await guardProject(
      str(req.user!.tenantId), str(req.params.id),
    );
    if (!guarded) { notFound(res); return; }

    const e = await loadEngagement(guarded.id);
    if (!e) { notFound(res); return; }

    const now = new Date();
    let sections: ReportSection[] | null;

    if (kind === 'phase') {
      const phaseId = str(req.query.phaseId);
      if (!phaseId) {
        res.status(400).json({
          status: 'error',
          code: 'PHASE_REQUIRED',
          message: 'A phase report needs ?phaseId=',
        });
        return;
      }
      sections = phaseSections(e, phaseId, now);
      if (!sections) {
        res.status(404).json({ status: 'error', message: 'Phase not found on this engagement' });
        return;
      }
    } else if (kind === 'status') sections = statusSections(e, now);
    else if (kind === 'audit') sections = auditSections(e, now);
    else if (kind === 'delay') sections = delaySections(e, now);
    else sections = await evidenceSections(e, now);

    // The report is issued in the CLIENT's name even when a consultant pressed
    // the button — see chromeFor in reportController for the reasoning.
    const [branding, logo, user] = await Promise.all([
      brandingFor(e.tenantId),
      logoBytesFor(e.tenantId),
      prisma.user.findUnique({
        where: { id: str(req.user!.id) }, select: { name: true, email: true },
      }),
    ]);
    const r = branding?.resolved;

    const issued = str(req.query.issue) === 'true';
    const issueNumber = issued
      ? await prisma.reportIssue.count({
        where: { tenantId: e.tenantId, reportKey: meta.key, projectId: e.id, issued: true },
      }) + 1
      : 0;

    const provenance: Provenance = {
      reportName: meta.name,
      tenantName: r?.displayName ?? e.tenant?.name ?? 'Unknown',
      generatedBy: `${user?.name ?? 'Unknown'} <${user?.email ?? ''}>`,
      scopeKind: 'Engagement',
      subjectRef: `${e.ref} — ${e.name}`,
      subjectStatus: e.status,
    };

    const document: ReportDocument = {
      provenance,
      sections: selectSections(
        sections,
        req.query.sections ? String(req.query.sections).split(',') : undefined,
      ),
      chrome: {
        displayName: r?.displayName ?? e.tenant?.name ?? 'Unknown',
        brandColour: r?.brandColour ?? '#0F7A5A',
        textColour: r?.textColour ?? '#0F7A5A',
        marking: effectiveMarking(
          r?.marking ?? 'Confidential',
          req.query.marking ? String(req.query.marking) : null,
        ),
        footerText: r?.footerText ?? null,
        logo,
        documentRef: documentRefFor(meta.key, now, issued ? issueNumber : null),
        generatedAt: now,
      },
    };

    const buf = format === 'pdf' ? await renderPdf(document)
      : format === 'docx' ? await renderDocx(document)
        : await renderXlsx(document);

    const hash = documentHash(document);
    const snapshot = snapshotOf({
      reported: e.reportedProgress,
      verified: e.verifiedProgress,
      status: e.status,
      health: e.health,
      policy: e.verificationPolicy,
      baselineVersion: e.baselineVersion,
      daysLost: attribute(e.impediments as any, now).totalDays,
    });

    const fileName = fileNameFor(meta.name, format, e.ref);

    await prisma.$transaction(async (tx) => {
      await tx.reportIssue.create({
        data: {
          tenantId: e.tenantId,
          reportKey: meta.key,
          reportName: meta.name,
          projectId: e.id,
          documentRef: document.chrome!.documentRef,
          issueNumber,
          format,
          marking: document.chrome!.marking,
          fileName,
          fileBytes: buf.length,
          documentHash: hash,
          issued,
          snapshot,
          issuedById: str(req.user!.id),
          issuedAt: now,
        },
      });

      // Into the WORM chain as well, so the queryable-but-mutable register is
      // notarised by the immutable-but-unqueryable log.
      await writeAudit(tx, {
        tenantId: e.tenantId,
        actorId: str(req.user!.id),
        action: issued ? 'DELIVERY_REPORT_ISSUED' : 'DELIVERY_REPORT_EXPORTED',
        subjectType: 'Project',
        subjectId: e.id,
        payload: {
          projectRef: e.ref, report: meta.key, format,
          documentRef: document.chrome!.documentRef,
          documentHash: hash, issueNumber, marking: document.chrome!.marking,
        },
      });
    });

    res.setHeader('Content-Type', MIME[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Document-Ref', document.chrome!.documentRef);
    res.send(buf);
  } catch (error: any) {
    console.error('[Delivery Report Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the report' });
  }
};

/**
 * The register: what has left this engagement, and in what state.
 *
 * A disclosure log. Somebody holding a copy of an organisation's unremediated
 * weaknesses is a fact worth being able to look up.
 */
export const getReportRegister = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const { project } = await guardProject(str(req.user!.tenantId), str(req.params.id));
    if (!project) { notFound(res); return; }

    const where: any = { projectId: project.id };
    if (str(req.query.issued) === 'true') where.issued = true;

    const rows = await prisma.reportIssue.findMany({
      where,
      orderBy: { issuedAt: 'desc' },
      take: 200,
      select: {
        id: true, reportKey: true, reportName: true, documentRef: true,
        issueNumber: true, format: true, marking: true, fileName: true,
        fileBytes: true, documentHash: true, issued: true, snapshot: true,
        issuedAt: true,
        issuedBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({
      status: 'success',
      projectId: project.id,
      reports: Object.entries(REPORTS).map(([k, v]) => ({ kind: k, name: v.name })),
      register: rows,
      summary: {
        total: rows.length,
        issued: rows.filter((r) => r.issued).length,
        exports: rows.filter((r) => !r.issued).length,
      },
    });
  } catch (error: any) {
    console.error('[Report Register Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the report register' });
  }
};
