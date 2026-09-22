/**
 * How long a record is kept, and when it may be destroyed.
 *
 * The menu has offered "Retention Schedules" since the beginning and it
 * rendered the audit log: AppShell routed 'retention', 'legal-hold', 'logs'
 * and 'hash-check' to the same AuditLogViewer, so three Governance entries
 * were one page. Nothing computed a disposal date, because there was nothing
 * to compute one from -- no schedule model, no column, no endpoint.
 *
 * The promise was made in four other places as well. platformCatalogue ships
 * the DMS module with `config: { autoArchiveDays: 365, defaultRetentionYears: 7 }`
 * and nothing anywhere reads either number. The System Health screen reported
 * a job called "Evidence Expiry & Retention Reminder Worker" as Idle, with a
 * last run eight hours ago and a duration of 890ms, for a worker that does not
 * exist. An operator asking whether retention was running was told it ran at
 * six this morning.
 *
 * ── Disposal destroys the content, not the record ───────────────────────────
 *
 * Seven foreign keys cascade off Document: approvals and their signatures,
 * acknowledgements, acknowledgement requests, version lineage, version
 * editors, read history and governance links. Deleting the row to dispose of
 * a document would therefore destroy the evidence that it existed, that it was
 * approved, and that people signed to say they had read it -- which is the
 * opposite of what disposing of a record means. In records management the
 * content is destroyed and the metadata survives, so that the organisation can
 * still show what it held, under what schedule, and that disposal was
 * authorised.
 *
 * So disposal here nulls the content, removes the file from disk, and stamps
 * the row. Everything that proves the document's history stays.
 *
 * ── Months, and UTC ─────────────────────────────────────────────────────────
 *
 * A period is a whole number of months in an Int column, which is the
 * convention already in the schema: auditCycleMonths Int @default(24) is
 * literally a two-year schedule. Three services already add months to a date
 * -- assetRiskScoring, riskScoring, vendorRisk -- and all three use local-time
 * accessors, so the answer depends on the server's timezone. None is reused.
 *
 * Pure, and with no Prisma import, so every refusal runs without a database.
 */

/** What starts the clock. */
export const RETENTION_TRIGGERS = ['Published', 'Archived', 'Created'] as const;
export type RetentionTrigger = (typeof RETENTION_TRIGGERS)[number];

/**
 * Bounds on a period.
 *
 * A zero-month schedule would make a document disposable the moment it was
 * published, which is a policy nobody means and an accident somebody could
 * make once. The ceiling is a hundred years: beyond that the number is being
 * used to say "never", and a schedule that means never should not be a
 * schedule at all.
 */
export const MIN_RETAIN_MONTHS = 1;
export const MAX_RETAIN_MONTHS = 1200;

/**
 * The default, taken from the number the platform already publishes.
 *
 * platformCatalogue advertises defaultRetentionYears: 7 for the document
 * module and nothing read it. Seven years is eighty-four months.
 */
export const DEFAULT_RETAIN_MONTHS = 84;

/** How long before the disposal date a document enters the review queue. */
export const DEFAULT_REVIEW_WINDOW_DAYS = 30;
export const MAX_REVIEW_WINDOW_DAYS = 365;

// ─── Dates ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** The UTC day a moment falls on, as a day number. Comparable with ===. */
export function utcDay(value: Date | string): number {
  const d = value instanceof Date ? value : new Date(String(value));
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Add whole months in the UTC frame, clamping to the end of the month.
 *
 * 31 January plus one month is 28 February, not 3 March. JavaScript's own
 * setMonth rolls over, which is why the three existing helpers in this
 * codebase quietly produce a date in the following month for any record
 * whose clock started on the 29th, 30th or 31st.
 */
export function addMonthsUtc(from: Date | string, months: number): Date {
  const d = from instanceof Date ? from : new Date(String(from));
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  const targetMonth = month + Math.trunc(months);
  // Day 0 of the month after the target is the last day of the target month.
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(
    year,
    targetMonth,
    Math.min(day, lastDayOfTarget),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  ));
}

/**
 * When this document may be destroyed, given the moment its clock started.
 *
 * Returns null when the trigger has not happened yet -- an unpublished
 * document on a Published schedule has no disposal date, and saying "now plus
 * seven years" for it would put a date on a record whose clock has not begun.
 */
export function disposalDateFor(
  startedAt: Date | string | null | undefined,
  retainMonths: number,
): Date | null {
  if (!startedAt) return null;
  const start = startedAt instanceof Date ? startedAt : new Date(String(startedAt));
  if (Number.isNaN(start.getTime())) return null;
  if (!Number.isFinite(retainMonths) || retainMonths < MIN_RETAIN_MONTHS) return null;
  return addMonthsUtc(start, Math.trunc(retainMonths));
}

/** The moment a schedule's clock starts, for one document. */
export function triggerMomentFor(
  trigger: string,
  doc: { createdAt?: Date | string | null; publishedAt?: Date | string | null; archivedAt?: Date | string | null },
): Date | string | null {
  if (trigger === 'Published') return doc.publishedAt ?? null;
  if (trigger === 'Archived') return doc.archivedAt ?? null;
  return doc.createdAt ?? null;
}

// ─── Where a document stands ────────────────────────────────────────────────

/**
 * Said as a word rather than derived from a date comparison at each call site,
 * because "held" and "not scheduled" are not points on the same line as "due"
 * and a caller that only compared dates would render both as "not due yet".
 */
export const DISPOSITION_STATES = [
  'Held',
  'Disposed',
  'NotScheduled',
  'Due',
  'DueSoon',
  'NotDue',
] as const;
export type DispositionState = (typeof DISPOSITION_STATES)[number];

export interface RetainedDocument {
  disposalDueAt: Date | string | null;
  /** Set while a legal hold is in force. The hard block. */
  legalHoldAt: Date | string | null;
  disposedAt: Date | string | null;
  reviewWindowDays?: number | null;
}

/**
 * Held comes first on purpose.
 *
 * A document under legal hold that is also past its disposal date is HELD, not
 * DUE. Showing it as due would put it in a queue whose whole purpose is to be
 * worked through, and the one thing that must not happen to it is disposal.
 */
export function dispositionState(doc: RetainedDocument, now: Date): DispositionState {
  if (doc.disposedAt) return 'Disposed';
  if (doc.legalHoldAt) return 'Held';
  if (!doc.disposalDueAt) return 'NotScheduled';

  const due = utcDay(doc.disposalDueAt);
  const today = utcDay(now);
  if (due <= today) return 'Due';

  const window = Math.max(0, Number(doc.reviewWindowDays ?? DEFAULT_REVIEW_WINDOW_DAYS));
  return due - today <= window * DAY_MS ? 'DueSoon' : 'NotDue';
}

/** Whether this state belongs in the queue a person works through. */
export function inDispositionQueue(state: DispositionState): boolean {
  return state === 'Due' || state === 'DueSoon';
}

/** Days until disposal; negative once it is overdue. Null when unscheduled. */
export function daysUntilDisposal(doc: RetainedDocument, now: Date): number | null {
  if (!doc.disposalDueAt) return null;
  return Math.round((utcDay(doc.disposalDueAt) - utcDay(now)) / DAY_MS);
}

// ─── Refusals ───────────────────────────────────────────────────────────────

export interface RetentionRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface ScheduleDecision {
  ok: true;
  code: string;
  name: string;
  retainMonths: number;
  trigger: RetentionTrigger;
  reviewWindowDays: number;
}

/** Whether this is a schedule an organisation can actually be held to. */
export function planSchedule(input: {
  code: unknown;
  name: unknown;
  retainMonths: unknown;
  trigger: unknown;
  reviewWindowDays?: unknown;
  /** Codes already in use in this tenant, excluding the one being edited. */
  takenCodes: readonly string[];
}): RetentionRefusal | ScheduleDecision {
  const code = String(input.code ?? '').trim().toUpperCase();
  if (!code) {
    return { ok: false, status: 400, code: 'SCHEDULE_CODE_REQUIRED', message: 'A schedule needs a short code, such as RET-7Y.' };
  }
  if (code.length > 32) {
    return { ok: false, status: 400, code: 'SCHEDULE_CODE_TOO_LONG', message: 'A schedule code is at most 32 characters.' };
  }
  if (input.takenCodes.map((c) => String(c).toUpperCase()).includes(code)) {
    return {
      ok: false,
      status: 409,
      code: 'SCHEDULE_CODE_TAKEN',
      message: `A schedule with code ${code} already exists. Two schedules with one code cannot be told apart in a disposal record.`,
    };
  }

  const name = String(input.name ?? '').trim();
  if (!name) {
    return { ok: false, status: 400, code: 'SCHEDULE_NAME_REQUIRED', message: 'A schedule needs a name people will recognise.' };
  }

  const months = Number(input.retainMonths);
  if (!Number.isFinite(months) || Math.trunc(months) !== months) {
    return { ok: false, status: 400, code: 'BAD_RETAIN_MONTHS', message: 'A retention period is a whole number of months.' };
  }
  if (months < MIN_RETAIN_MONTHS) {
    return {
      ok: false,
      status: 400,
      code: 'RETAIN_TOO_SHORT',
      message: 'A retention period is at least one month. A zero-month schedule would make a document disposable the moment it was published.',
    };
  }
  if (months > MAX_RETAIN_MONTHS) {
    return {
      ok: false,
      status: 400,
      code: 'RETAIN_TOO_LONG',
      message: `A retention period is at most ${MAX_RETAIN_MONTHS} months. Beyond a hundred years the number means "never", and a record kept forever is a decision to record, not a schedule.`,
    };
  }

  const trigger = String(input.trigger ?? '').trim();
  if (!(RETENTION_TRIGGERS as readonly string[]).includes(trigger)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_TRIGGER',
      message: `A schedule starts counting from one of: ${RETENTION_TRIGGERS.join(', ')}.`,
    };
  }

  const rawWindow = input.reviewWindowDays;
  const window = rawWindow === undefined || rawWindow === null || rawWindow === ''
    ? DEFAULT_REVIEW_WINDOW_DAYS
    : Number(rawWindow);
  if (!Number.isFinite(window) || window < 0 || window > MAX_REVIEW_WINDOW_DAYS) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_REVIEW_WINDOW',
      message: `The review window is between 0 and ${MAX_REVIEW_WINDOW_DAYS} days.`,
    };
  }

  return {
    ok: true,
    code,
    name,
    retainMonths: months,
    trigger: trigger as RetentionTrigger,
    reviewWindowDays: Math.trunc(window),
  };
}

export interface DisposalDecision {
  ok: true;
  reason: string;
  /** Said back so the audit entry records what the schedule was at the time. */
  state: DispositionState;
}

/**
 * Whether this document may be destroyed now.
 *
 * The legal hold check is first and is absolute. It is the one refusal in this
 * module that exists to survive somebody being certain they want to proceed:
 * a document under hold is evidence in a matter, and destroying it is the
 * failure the whole feature is built to prevent.
 */
export function planDisposal(input: {
  doc: RetainedDocument;
  reason: unknown;
  now: Date;
  /** True when the caller holds apply-retention-and-legal-hold. */
  mayDispose: boolean;
}): RetentionRefusal | DisposalDecision {
  const state = dispositionState(input.doc, input.now);

  if (state === 'Held') {
    return {
      ok: false,
      // 423 Locked, the status this codebase already returns for a document
      // frozen by a legal hold, rather than a second way of saying the same
      // thing.
      status: 423,
      code: 'DOCUMENT_ON_LEGAL_HOLD',
      message: 'This document is under legal hold and cannot be disposed of. Release the hold first, which is itself recorded.',
    };
  }

  if (!input.mayDispose) {
    return {
      ok: false,
      status: 403,
      code: 'DISPOSAL_NOT_PERMITTED',
      message: 'Disposing of a record requires retention and legal hold.',
    };
  }

  if (state === 'Disposed') {
    return { ok: false, status: 409, code: 'ALREADY_DISPOSED', message: 'This document has already been disposed of.' };
  }

  if (state === 'NotScheduled') {
    return {
      ok: false,
      status: 400,
      code: 'NO_SCHEDULE',
      message: 'Nothing says when this document should be destroyed. Give it a retention schedule first, so the disposal record can name the rule it was carried out under.',
    };
  }

  if (state !== 'Due') {
    return {
      ok: false,
      status: 409,
      code: 'NOT_YET_DUE',
      message: 'This document is not due for disposal yet. Destroying a record ahead of its schedule is the same failure as keeping one past it.',
    };
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length < 4) {
    return {
      ok: false,
      status: 400,
      code: 'DISPOSAL_REASON_REQUIRED',
      message: 'Say why this record is being destroyed. The reason is the disposal record.',
    };
  }

  return { ok: true, reason, state };
}

// ─── Counting the queue ─────────────────────────────────────────────────────

export interface DispositionSummary {
  due: number;
  dueSoon: number;
  held: number;
  notScheduled: number;
  disposed: number;
  /**
   * Said rather than left to a zero. A tenant with no schedules and a tenant
   * whose schedules are all satisfied both show an empty queue, and only one
   * of them has retention.
   */
  noSchedulesDefined: boolean;
}

export function summariseDisposition(
  docs: readonly RetainedDocument[],
  now: Date,
  scheduleCount: number,
): DispositionSummary {
  let due = 0;
  let dueSoon = 0;
  let held = 0;
  let notScheduled = 0;
  let disposed = 0;

  for (const d of docs) {
    switch (dispositionState(d, now)) {
      case 'Due': due += 1; break;
      case 'DueSoon': dueSoon += 1; break;
      case 'Held': held += 1; break;
      case 'NotScheduled': notScheduled += 1; break;
      case 'Disposed': disposed += 1; break;
      default: break;
    }
  }

  return { due, dueSoon, held, notScheduled, disposed, noSchedulesDefined: scheduleCount === 0 };
}
