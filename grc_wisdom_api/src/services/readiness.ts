/**
 * Readiness for the certification audit (consulting engagement, sprint 12).
 *
 * Readiness is computed from the records the platform already holds, never
 * typed in. For each clause the scope names, six things are checked:
 *
 *   - documented:   a published document says how (linked to the clause);
 *   - implemented:  every control mapped to it is implemented or verified;
 *   - evidenced:    the firm has accepted evidence for it, and recently;
 *   - gaps closed:  no gap from the assessment is still open;
 *   - risks treated: no risk the clause's controls treat is beyond tolerance;
 *   - records:      its controls' operating evidence spans the records period
 *                   the organisation sets (three months unless it says so),
 *                   which is what a Stage 2 audit samples.
 *
 * All six is Ready; four or five is Nearly ready; fewer is Not ready. A clause
 * assessed Not applicable is not counted. The firm's opinion and the sponsor's
 * sign-off sit beside these figures and never change them.
 *
 * Pure, so every rule here runs without a database.
 */

export const DIMENSIONS = ['documented', 'implemented', 'evidenced', 'gapsClosed', 'risksTreated', 'records'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const DIMENSION_LABEL: Record<Dimension, string> = {
  documented: 'Documented', implemented: 'Implemented', evidenced: 'Evidenced', gapsClosed: 'Gaps closed',
  risksTreated: 'Risks treated', records: 'Records period',
};
export const DEFAULT_RECORDS_MONTHS = 3;
export const MAX_RECORDS_MONTHS = 24;
/** Accepted evidence older than this is stale for readiness. */
export const EVIDENCE_FRESH_MONTHS = 12;

export type Verdict = 'Ready' | 'Nearly ready' | 'Not ready' | 'Not applicable';

const DAY = 86_400_000;
/** The day a period of months ends counting back from a moment (UTC, end-of-month clamped). */
export function monthsBefore(now: Date, months: number): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(now.getUTCDate(), last)));
}

/**
 * Whether operating evidence spans the records period: something at or before
 * its start, and something within the last month, so a control operated
 * across the period and still does. Five weeks of evidence spans five weeks.
 */
export function spansPeriod(dates: readonly Date[], months: number, now: Date): boolean {
  if (dates.length === 0) return false;
  const times = dates.map((d) => d.getTime());
  const start = monthsBefore(now, months).getTime();
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  return earliest <= start + DAY && latest >= now.getTime() - 31 * DAY;
}

/** How long evidence spans, in whole days, for a screen to say why a control is not ready. */
export const spanDays = (dates: readonly Date[]): number => (dates.length < 2 ? 0 : Math.round((Math.max(...dates.map((d) => d.getTime())) - Math.min(...dates.map((d) => d.getTime()))) / DAY));

export function verdictOf(checks: Record<Dimension, boolean>, notApplicable = false): Verdict {
  if (notApplicable) return 'Not applicable';
  const met = DIMENSIONS.filter((d) => checks[d]).length;
  if (met === DIMENSIONS.length) return 'Ready';
  if (met >= 4) return 'Nearly ready';
  return 'Not ready';
}

export function checkRecordsPeriod(v: unknown): { ok: true; months: number } | { ok: false; status: number; code: string; message: string } {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_RECORDS_MONTHS) {
    return { ok: false, status: 400, code: 'BAD_PERIOD', message: `The records period is a whole number of months from 1 to ${MAX_RECORDS_MONTHS}.` };
  }
  return { ok: true, months: n };
}

// ─── Management review (ISO 27001 9.3) ──────────────────────────────────────

/** The inputs 9.3.2 requires a management review to consider. */
export const REVIEW_INPUTS = [
  ['previousActions', 'Status of actions from previous reviews (a)'],
  ['contextChanges', 'Changes in external and internal issues (b)'],
  ['interestedParties', 'Changes in the needs and expectations of interested parties (c)'],
  ['nonconformities', 'Nonconformities and corrective actions (d1)'],
  ['monitoring', 'Monitoring and measurement results (d2)'],
  ['auditResults', 'Audit results (d3)'],
  ['objectives', 'Fulfilment of information security objectives (d4)'],
  ['feedback', 'Feedback from interested parties (e)'],
  ['riskAssessment', 'Results of risk assessment and status of the risk treatment plan (f)'],
  ['improvement', 'Opportunities for continual improvement (g)'],
] as const;
export type ReviewInput = (typeof REVIEW_INPUTS)[number][0];

export interface ReviewRecord {
  heldOn: Date | null;
  attendees: string[];
  inputs: Partial<Record<ReviewInput, string>>;
  decisions: string | null;
  status: string;
}

/** What a review still lacks before it can be recorded: every input considered, people present, decisions taken. */
export function reviewGaps(r: ReviewRecord): string[] {
  const out: string[] = [];
  if (!r.heldOn) out.push('the date it was held');
  if (r.attendees.length === 0) out.push('who attended');
  for (const [key, label] of REVIEW_INPUTS) if (!String(r.inputs[key] ?? '').trim()) out.push(label);
  if (!String(r.decisions ?? '').trim()) out.push('the decisions taken (9.3.3)');
  return out;
}

/** Whether recorded reviews satisfy 9.3: one recorded, complete, within the last twelve months. */
export function satisfies93(reviews: readonly ReviewRecord[], now: Date): boolean {
  const since = monthsBefore(now, 12).getTime();
  return reviews.some((r) => r.status === 'Recorded' && r.heldOn && r.heldOn.getTime() >= since && reviewGaps(r).length === 0);
}

export const reviewRef = (n: number): string => `MR-${String(n).padStart(4, '0')}`;
