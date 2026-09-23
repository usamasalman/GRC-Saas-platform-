/**
 * What the background workers actually did.
 *
 * The System Health screen listed five jobs. Two of them exist. The other
 * three — a WORM chain audit, a daily standards sync, a ZATCA e-invoice signer
 * — were object literals with a `lastRun` computed as `Date.now() - 1800000`
 * and a `durationMs` of 420, so an operator asking "is the chain audit
 * running?" was told it ran half an hour ago and took 420ms. Nothing ran. The
 * two workers that do exist, the SLA escalation scanner and the risk review
 * scanner, were not on the list at all.
 *
 * Worse, the "Run now" button ran nothing. It wrote a SYSTEM_JOB_TRIGGERED
 * entry into the WORM audit log and returned
 * `{ status: 'Success', durationMs: Math.floor(Math.random() * 300) + 150 }`
 * — a random number presented as a measurement, and a success claim for work
 * that never happened, recorded permanently in the compliance record.
 *
 * This module holds the register of real workers and what each one last did.
 * It imports nothing: the store is in memory because that is honestly what it
 * is — a record of this process since it booted, which resets when the
 * container restarts, and the report says so rather than implying history.
 */

export type JobOutcome = 'Success' | 'Failed';

export interface JobDefinition {
  id: string;
  name: string;
  /** What it does, in the words an operator would use to ask about it. */
  description: string;
  intervalMs: number;
  /** The units it reports, so a run of zero can still be read as a run. */
  measures: readonly string[];
}

export interface JobRun {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: JobOutcome;
  /** Counts the scan returned, e.g. { breached: 0, escalated: 0 }. */
  counts?: Record<string, number>;
  error?: string;
  /** True when a person pressed Run now rather than the timer firing. */
  manual?: boolean;
}

/**
 * Every background worker this API actually starts.
 *
 * server.ts calls startEscalationScanner() and startRiskReviewScanner() and
 * nothing else. A row here that no timer drives is the defect this file
 * exists to have removed, so the list stays exactly as long as that one.
 */
export const JOB_DEFINITIONS: readonly JobDefinition[] = [
  {
    id: 'JOB-SLA-ESCALATION',
    name: 'SLA breach detection and escalation',
    description:
      'Finds tickets past their response or resolution target, marks them '
      + 'breached, raises the escalation level and notifies the assignee.',
    intervalMs: 5 * 60_000,
    measures: ['breached', 'escalated'],
  },
  {
    id: 'JOB-RISK-REVIEW',
    name: 'Risk acceptance expiry and review due',
    description:
      'Reopens risk acceptances whose agreed date has passed and counts the '
      + 'risks now overdue for review.',
    intervalMs: 15 * 60_000,
    measures: ['reopened', 'overdueReviews'],
  },
];

export const KNOWN_JOB_IDS: readonly string[] = JOB_DEFINITIONS.map((j) => j.id);

// ─── The store ──────────────────────────────────────────────────────────────

const runs = new Map<string, JobRun>();

export function recordRun(jobId: string, run: JobRun): void {
  runs.set(jobId, run);
}

export function lastRun(jobId: string): JobRun | null {
  return runs.get(jobId) ?? null;
}

/** Test seam. Never called by the server. */
export function resetRuns(): void {
  runs.clear();
}

/**
 * Measure a scan and record what it did, whichever way it was started.
 *
 * The duration is the elapsed time of the call. That is the only number here
 * that could be called a measurement, and it is the one the old code made up.
 */
export async function observe<T extends Record<string, number>>(
  jobId: string,
  scan: () => Promise<T>,
  opts: { manual?: boolean } = {},
): Promise<JobRun> {
  const started = new Date();
  try {
    const counts = await scan();
    const finished = new Date();
    const run: JobRun = {
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      outcome: 'Success',
      counts,
      manual: opts.manual,
    };
    recordRun(jobId, run);
    return run;
  } catch (err: any) {
    const finished = new Date();
    const run: JobRun = {
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      outcome: 'Failed',
      // A failed scan that reports Success is how the screen came to be
      // trusted for something it never checked.
      error: String(err?.message || err),
      manual: opts.manual,
    };
    recordRun(jobId, run);
    return run;
  }
}

// ─── The report ─────────────────────────────────────────────────────────────

export interface JobReport {
  id: string;
  name: string;
  description: string;
  schedule: string;
  intervalMs: number;
  measures: readonly string[];
  /** Null until it has run in THIS process. Not a zero, not a guess. */
  lastRun: string | null;
  nextRun: string | null;
  durationMs: number | null;
  counts: Record<string, number> | null;
  status: 'Idle' | 'NeverRun' | 'Failed';
  error: string | null;
  lastRunWasManual: boolean;
}

export function describeInterval(intervalMs: number): string {
  const mins = Math.round(intervalMs / 60_000);
  if (mins < 60) return `Every ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  return `Every ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * One row, built from what was recorded rather than from what would look good.
 *
 * A worker that has not run since this process started reports NeverRun and a
 * null last run. The screen says "not since restart"; it does not print a
 * plausible timestamp, which is what made the old rows impossible to question.
 */
export function describeJob(def: JobDefinition, run: JobRun | null): JobReport {
  const base = {
    id: def.id,
    name: def.name,
    description: def.description,
    schedule: describeInterval(def.intervalMs),
    intervalMs: def.intervalMs,
    measures: def.measures,
  };

  if (!run) {
    return {
      ...base,
      lastRun: null,
      // Nothing to count forward from. A next run computed from "now" would be
      // a guess dressed as a schedule.
      nextRun: null,
      durationMs: null,
      counts: null,
      status: 'NeverRun',
      error: null,
      lastRunWasManual: false,
    };
  }

  return {
    ...base,
    lastRun: run.finishedAt,
    // From the timer's last tick, which is the last finish. A manual run does
    // not reset the interval, so this stays the honest estimate either way.
    nextRun: new Date(new Date(run.finishedAt).getTime() + def.intervalMs).toISOString(),
    durationMs: run.durationMs,
    counts: run.counts ?? null,
    status: run.outcome === 'Failed' ? 'Failed' : 'Idle',
    error: run.error ?? null,
    lastRunWasManual: Boolean(run.manual),
  };
}

export function reportAllJobs(): JobReport[] {
  return JOB_DEFINITIONS.map((d) => describeJob(d, lastRun(d.id)));
}

/**
 * Whether a job id names something that can be run.
 *
 * The trigger endpoint took any string and reported success for it, so
 * "JOB-SYS-99" executed successfully too.
 */
export function planTrigger(jobId: string): {
  ok: true; id: string;
} | {
  ok: false; status: number; code: string; message: string;
} {
  const id = String(jobId ?? '').trim();
  if (!id) {
    return {
      ok: false, status: 400, code: 'JOB_REQUIRED',
      message: 'Name the job to run.',
    };
  }
  if (!KNOWN_JOB_IDS.includes(id)) {
    return {
      ok: false, status: 404, code: 'UNKNOWN_JOB',
      message: `There is no job called ${id}. This API runs ${KNOWN_JOB_IDS.join(' and ')}.`,
    };
  }
  return { ok: true, id };
}
