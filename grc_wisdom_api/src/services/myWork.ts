/**
 * One person's work, across every engagement, and who to tell when it moves.
 *
 * Two gaps this closes, both of the same kind: the machinery existed and
 * nothing connected it.
 *
 * Being GIVEN a task told nobody. projectPlanController does not import the
 * notification service at all -- createTask writes assigneeId and goes straight
 * to the audit entry, and updateTask, which is also the reassignment path, does
 * the same. So the way somebody learned they had work was being told in a
 * meeting. The ticket module next door already does this correctly, on the same
 * notify() helper.
 *
 * And there was no way to ask "what is assigned to me". ProjectTask carries
 * @@index([assigneeId, status]) -- an index that exists for exactly one
 * question -- and no query in the API used it: every multi-row task query is
 * scoped to a single project. GET /api/projects/commitments looked like the
 * answer but is not: it aggregates ProjectMember rows for everyone in scope and
 * reads no task at all, so it reports who is over-allocated, never what anybody
 * has to do.
 *
 * Pure, and with no Prisma import, so every rule runs without a database.
 */

// --- Who hears about an assignment ------------------------------------------

export type AssignmentKind = 'Assigned' | 'Unassigned';

export interface AssignmentEvent {
  recipientId: string;
  kind: AssignmentKind;
}

/**
 * Who to tell when a task changes hands.
 *
 * Both ends of a reassignment, because each half is news to someone: one person
 * has work they did not have, and the other has stopped being answerable for
 * something they may still believe is theirs. Telling only the new assignee is
 * how two people both think a task is theirs, or neither does.
 *
 * The actor is not filtered here -- notify() already drops self-notification,
 * and doing it twice would hide the case where somebody assigns work to
 * themselves and away from someone else.
 */
export function assignmentAudience(input: {
  previousAssigneeId: string | null | undefined;
  nextAssigneeId: string | null | undefined;
}): AssignmentEvent[] {
  const before = input.previousAssigneeId || null;
  const after = input.nextAssigneeId || null;

  if (before === after) return [];

  const out: AssignmentEvent[] = [];
  if (after) out.push({ recipientId: after, kind: 'Assigned' });
  if (before) out.push({ recipientId: before, kind: 'Unassigned' });
  return out;
}

// --- What the person can actually do about it -------------------------------

/**
 * Ordered by what the reader can act on, NOT by urgency alone.
 *
 * The distinction matters more than it looks. A list that sorts by lateness
 * puts a task at the top that is overdue AND blocked on somebody else -- work
 * the reader cannot start. Telling someone "you have five things overdue" when
 * three of them are waiting on another organisation is the same defect as a
 * report printing a figure the data cannot support: it reads as an instruction
 * and it is not one.
 *
 * So the two states where the person cannot act are their own buckets, counted
 * separately, and everything else is ordered by how late it is.
 */
export const WORK_BUCKETS = [
  'SentBack',
  'Overdue',
  'DueSoon',
  'Open',
  'WithReviewer',
  'Blocked',
  'Done',
] as const;

export type WorkBucket = (typeof WORK_BUCKETS)[number];

export interface WorkTask {
  status: string;
  dueDate: Date | string | null;
  /** Open blockers against this task. */
  blockers: number;
}

/** Statuses that mean the work is finished as far as the assignee is concerned. */
const FINISHED = ['Done', 'Verified'];

/** How many days ahead counts as "soon". Matches the plan screen's own window. */
export const DUE_SOON_DAYS = 7;

/**
 * A due date is a calendar date, not an instant, and so is "today".
 *
 * The first version of this compared local midnights, which is wrong in both
 * directions: a due date is stored as UTC midnight, so west of Greenwich
 * new Date('2026-09-16') lands on the 15th locally and a task due today reads
 * as overdue from the moment it is created. The same mistake as formatting a
 * phase window as an instant, one layer down — see utils/calendarDate on the
 * frontend, which exists for it.
 *
 * So the stored value is read by its calendar parts and the reader's clock by
 * theirs, and the two are compared as day numbers.
 */
const DATE_HEAD = /^(\d{4})-(\d{2})-(\d{2})/;

const dueDay = (d: Date | string): number => {
  const parts = DATE_HEAD.exec(String(d instanceof Date ? d.toISOString() : d));
  if (parts) return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const x = new Date(String(d));
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
};

/** The reader's own day, from their own clock. */
const todayFor = (now: Date): number =>
  Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

/**
 * Which bucket a task belongs in for the person it is assigned to.
 *
 * Order of tests is the rule. Blocked and WithReviewer are checked before
 * lateness precisely because being late does not make them actionable.
 */
export function bucketWork(t: WorkTask, now: Date): WorkBucket {
  if (FINISHED.includes(t.status)) return 'Done';

  // Cannot act: a reviewer has it.
  if (t.status === 'SubmittedForVerification') return 'WithReviewer';

  // Cannot act: something is in the way, and it is owed by somebody.
  if (t.status === 'Blocked' || t.blockers > 0) return 'Blocked';

  // Came back with a reason. Someone is waiting on this specifically.
  if (t.status === 'Rejected') return 'SentBack';

  if (!t.dueDate) return 'Open';

  const due = dueDay(t.dueDate);
  const today = todayFor(now);
  if (due < today) return 'Overdue';

  const days = Math.round((due - today) / 86_400_000);
  return days <= DUE_SOON_DAYS ? 'DueSoon' : 'Open';
}

/** Where each bucket sits in the list. Lower sorts first. */
const RANK: Record<WorkBucket, number> = {
  SentBack: 0,
  Overdue: 1,
  DueSoon: 2,
  Open: 3,
  WithReviewer: 4,
  Blocked: 5,
  Done: 6,
};

export const bucketRank = (b: WorkBucket): number => RANK[b];

export interface WorkSummary {
  /** Buckets the reader can do something about, totalled. */
  needsYou: number;
  /** Buckets where the next move belongs to somebody else. */
  waitingOnOthers: number;
  byBucket: Record<WorkBucket, number>;
}

/**
 * The headline, split the only way that does not mislead.
 *
 * "You have 11 open items" is useless when 6 of them are with a reviewer. The
 * two totals are kept apart so nobody has to subtract one from the other to
 * find out what their afternoon looks like.
 */
export function summarise(buckets: readonly WorkBucket[]): WorkSummary {
  const byBucket = WORK_BUCKETS.reduce((acc, b) => {
    acc[b] = 0;
    return acc;
  }, {} as Record<WorkBucket, number>);

  for (const b of buckets) byBucket[b] += 1;

  return {
    needsYou: byBucket.SentBack + byBucket.Overdue + byBucket.DueSoon + byBucket.Open,
    waitingOnOthers: byBucket.WithReviewer + byBucket.Blocked,
    byBucket,
  };
}
