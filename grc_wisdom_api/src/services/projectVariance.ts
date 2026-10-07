import { isComplete } from './projectLifecycle';
import { impedimentCost } from './projectDelay';
import { criticalPath, Edge } from './projectDependency';

/**
 * Planned, actual and variance, and what caused the variance.
 *
 * Pure: no Prisma, no request, no ambient clock. The Gantt tab and the two
 * steering reports read the same figures from buildSchedule, so a committee
 * never sees one number on screen and another on paper (consulting
 * engagement, sprint 2).
 *
 *   planned   the plan first agreed at "Agree plan & activate". A rebaseline
 *             re-agrees the dates but never rewrites these; the distance it
 *             moved them is one of the causes below.
 *   actual    from the day the task first moved to In progress to the day it
 *             was completed. Unfinished work shows a forecast finish instead:
 *             its current due date, or today once that date has passed, since
 *             work not yet done cannot finish in the past.
 *   variance  actual (or forecast) finish minus planned finish, in whole days;
 *             negative is early.
 *
 * The causes of a positive variance always add up to it, at every level:
 *
 *   onHold       days the project was on hold inside the work's window, taken
 *                first, because they are nobody's delay;
 *   client, provider, thirdParty
 *                days the impediment ledger charges to each side (blockers and
 *                recorded slips), shared pro rata when they exceed what is
 *                left;
 *   rebaseline   how far a rebaseline moved the agreed finish, for what the
 *                sides do not already explain;
 *   unattributed the rest. Shown, never hidden: a split that balances by
 *                construction proves nothing unless the remainder is visible.
 *
 * A late task can be late because the work it waits on was. So a task, a
 * phase and the project each draw their candidate causes from the chain of
 * work that actually set their finish: the task itself and, through the
 * dependency links, whichever predecessor finished last, and so on back.
 */

const MS_PER_DAY = 86_400_000;

export const CAUSES = ['onHold', 'client', 'provider', 'thirdParty', 'rebaseline', 'unattributed'] as const;
export type Cause = (typeof CAUSES)[number];
export type Causes = Record<Cause, number>;
type SideCauses = Pick<Causes, 'client' | 'provider' | 'thirdParty'>;

const SIDE_CAUSE: Record<string, keyof SideCauses> = {
  Client: 'client', Provider: 'provider', ThirdParty: 'thirdParty',
};

export const zeroCauses = (): Causes => ({
  onHold: 0, client: 0, provider: 0, thirdParty: 0, rebaseline: 0, unattributed: 0,
});

export const sumCauses = (c: Causes): number => CAUSES.reduce((s, k) => s + c[k], 0);

/** Whole calendar days (UTC), so a date and a timestamp on the same day agree. */
const dayOf = (d: Date): number => Math.floor(d.getTime() / MS_PER_DAY);
export const daysFrom = (from: Date, to: Date): number => dayOf(to) - dayOf(from);
const later = (a: Date | null, b: Date | null): Date | null => (!a ? b : !b ? a : (a > b ? a : b));
const earlier = (a: Date | null, b: Date | null): Date | null => (!a ? b : !b ? a : (a < b ? a : b));

// ─── The parts ──────────────────────────────────────────────────────────────

export interface HoldSpan { startedAt: Date; endedAt: Date | null }

/** Days on hold inside [from, to]; a hold still open runs to `now`. */
export function holdDaysWithin(
  holds: readonly HoldSpan[], from: Date | null, to: Date | null, now: Date,
): number {
  if (!from || !to || to < from) return 0;
  let total = 0;
  for (const h of holds) {
    const start = h.startedAt > from ? h.startedAt : from;
    const end = earlier(h.endedAt ?? now, to)!;
    total += Math.max(0, daysFrom(start, end));
  }
  return total;
}

export interface LedgerEntry {
  kind: string;
  category: string;
  owingSide: string;
  impactDays: number | null;
  raisedAt: Date;
  resolvedAt: Date | null;
}

/** Days the ledger charges to each side, costed the way the Delays tab costs them. */
export function sideDays(entries: readonly LedgerEntry[], now: Date): SideCauses {
  const out: SideCauses = { client: 0, provider: 0, thirdParty: 0 };
  for (const e of entries) {
    const cause = SIDE_CAUSE[e.owingSide];
    if (cause) out[cause] += impedimentCost(e, now);
  }
  return out;
}

const addSides = (a: SideCauses, b: SideCauses): SideCauses => ({
  client: a.client + b.client, provider: a.provider + b.provider, thirdParty: a.thirdParty + b.thirdParty,
});

/**
 * Shares a positive variance among the candidate causes, in order, so the
 * parts always add up to the whole. Zero or early has no causes.
 */
export function allocate(varianceDays: number | null, raw: Omit<Causes, 'unattributed'>): Causes {
  const out = zeroCauses();
  if (varianceDays === null || varianceDays <= 0) return out;
  let left = varianceDays;

  out.onHold = Math.min(Math.max(0, raw.onHold), left);
  left -= out.onHold;

  const sides = (['client', 'provider', 'thirdParty'] as const).map((k) => ({ k, v: Math.max(0, raw[k]) }));
  const owed = sides.reduce((s, x) => s + x.v, 0);
  if (owed <= left) {
    for (const { k, v } of sides) out[k] = v;
    left -= owed;
  } else {
    // Pro rata in whole days; the largest remainders take the odd days, so
    // the shares add up exactly.
    const shares = sides.map(({ k, v }) => ({ k, exact: (v * left) / owed }));
    let given = 0;
    for (const s of shares) { out[s.k] = Math.floor(s.exact); given += out[s.k]; }
    const byRemainder = [...shares].sort(
      (a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)),
    );
    for (let i = 0; given < left; i += 1, given += 1) out[byRemainder[i % byRemainder.length].k] += 1;
    left = 0;
  }

  out.rebaseline = Math.min(Math.max(0, raw.rebaseline), left);
  left -= out.rebaseline;
  out.unattributed = left;
  return out;
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface TaskInput {
  id: string;
  status: string;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  actualStartDate: Date | null;
  baselineStartDate: Date | null;
  baselineDueDate: Date | null;
  firstBaselineStartDate: Date | null;
  firstBaselineDueDate: Date | null;
}

export interface PhaseInput {
  id: string;
  startDate: Date;
  targetEndDate: Date;
  baselineTargetEndDate: Date | null;
  firstBaselineTargetEndDate: Date | null;
  tasks: readonly TaskInput[];
}

export interface ProjectInput {
  startDate: Date;
  targetEndDate: Date;
  baselineStartDate: Date | null;
  baselineTargetEndDate: Date | null;
  baselineVersion: number;
  firstBaselineStartDate: Date | null;
  firstBaselineTargetEndDate: Date | null;
}

export interface LedgerRow extends LedgerEntry {
  taskId: string | null;
  phaseId: string | null;
}

// ─── Outputs ────────────────────────────────────────────────────────────────

export interface Span { start: Date | null; finish: Date | null }

export interface Figures {
  /** The plan first agreed. */
  planned: Span;
  /** The finish as agreed now, after any rebaseline. */
  agreedFinish: Date | null;
  /** When the work ran; a forecast while any of it is unfinished. */
  actual: Span & { forecast: boolean };
  /** Actual or forecast finish minus planned finish; null when either is unknown. */
  varianceDays: number | null;
  /** Adds up to the variance when it is positive; all zero otherwise. */
  causes: Causes;
}

export interface TaskFigures extends Figures {
  /** The ledger's days by side for this task alone, before any sharing. */
  owed: SideCauses;
  /** The predecessors whose own days were drawn on, nearest first. */
  drivenBy: string[];
}

export interface Schedule {
  project: Figures & { firstPlanKnown: boolean };
  phases: (Figures & { id: string })[];
  tasks: Map<string, TaskFigures>;
  criticalPath: string[];
}

// ─── Building ───────────────────────────────────────────────────────────────

/** A task's finish: when it was completed, or a forecast. */
export function taskFinish(
  t: Pick<TaskInput, 'status' | 'completedAt' | 'dueDate'>, now: Date,
): { finish: Date | null; forecast: boolean } {
  if (isComplete(t.status) && t.completedAt) return { finish: t.completedAt, forecast: false };
  if (!t.dueDate) return { finish: null, forecast: true };
  return { finish: t.dueDate < now ? now : t.dueDate, forecast: true };
}

/**
 * The chain of work that set `endId`'s finish: at each step, the predecessor
 * that finished last. Ends at a task with no predecessors, and never loops.
 */
export function drivingChain(
  endId: string,
  finishOf: (id: string) => Date | null,
  predecessors: ReadonlyMap<string, readonly string[]>,
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let at: string | null = endId;
  while (at && !seen.has(at)) {
    chain.push(at);
    seen.add(at);
    let next: string | null = null;
    for (const p of predecessors.get(at) || []) {
      const f = finishOf(p);
      if (f && (!next || f > (finishOf(next) as Date))) next = p;
    }
    at = next;
  }
  return chain;
}

const rawFor = (onHold: number, sides: SideCauses, plannedFinish: Date | null, agreedFinish: Date | null) => ({
  onHold,
  ...sides,
  rebaseline: plannedFinish && agreedFinish ? Math.max(0, daysFrom(plannedFinish, agreedFinish)) : 0,
});

/**
 * Every figure the Gantt and the reports print, from one set of rows.
 */
export function buildSchedule(input: {
  project: ProjectInput;
  phases: readonly PhaseInput[];
  ledger: readonly LedgerRow[];
  holds: readonly HoldSpan[];
  edges: readonly Edge[];
  now?: Date;
}): Schedule {
  const now = input.now ?? new Date();
  const tasks = input.phases.flatMap((p) => p.tasks);

  const predecessors = new Map<string, string[]>();
  for (const e of input.edges) {
    predecessors.set(e.successorId, [...(predecessors.get(e.successorId) || []), e.predecessorId]);
  }
  const ledgerByTask = new Map<string, LedgerRow[]>();
  for (const l of input.ledger) {
    if (l.taskId) ledgerByTask.set(l.taskId, [...(ledgerByTask.get(l.taskId) || []), l]);
  }

  // Pass one: each task on its own.
  const base = new Map<string, {
    planned: Span; agreedFinish: Date | null; actual: Span & { forecast: boolean };
    varianceDays: number | null; owed: SideCauses;
  }>();
  for (const t of tasks) {
    const planned = {
      start: t.firstBaselineStartDate ?? t.baselineStartDate,
      finish: t.firstBaselineDueDate ?? t.baselineDueDate,
    };
    const { finish, forecast } = taskFinish(t, now);
    base.set(t.id, {
      planned,
      agreedFinish: t.baselineDueDate,
      actual: { start: t.actualStartDate, finish, forecast },
      varianceDays: planned.finish && finish ? daysFrom(planned.finish, finish) : null,
      owed: sideDays(ledgerByTask.get(t.id) || [], now),
    });
  }
  const finishOf = (id: string) => base.get(id)?.actual.finish ?? null;
  const chainSides = (chain: readonly string[]) => chain.reduce(
    (s, id) => addSides(s, base.get(id)?.owed ?? { client: 0, provider: 0, thirdParty: 0 }),
    { client: 0, provider: 0, thirdParty: 0 },
  );

  // Pass two: each task's causes, drawn from the chain that set its finish.
  const taskFigures = new Map<string, TaskFigures>();
  for (const t of tasks) {
    const b = base.get(t.id)!;
    const chain = drivingChain(t.id, finishOf, predecessors);
    const windowStart = b.actual.start ?? b.planned.start ?? b.planned.finish;
    const raw = rawFor(
      holdDaysWithin(input.holds, windowStart, b.actual.finish, now),
      chainSides(chain), b.planned.finish, b.agreedFinish,
    );
    const drivenBy = chain.slice(1).filter((id) => {
      const o = base.get(id)!.owed;
      return o.client + o.provider + o.thirdParty > 0;
    });
    taskFigures.set(t.id, { ...b, causes: allocate(b.varianceDays, raw), drivenBy });
  }

  // A level's finish is its latest task finish; its causes come from the
  // chain behind that task, plus the ledger raised against the level itself.
  const level = (args: {
    levelTasks: readonly TaskInput[];
    plannedStart: Date | null;
    plannedFinish: Date | null;
    agreedFinish: Date | null;
    levelLedger: readonly LedgerEntry[];
  }): Figures => {
    let finish: Date | null = null;
    let lastId: string | null = null;
    let forecast = false;
    let start: Date | null = null;
    let plannedFallback: Date | null = null;
    for (const t of args.levelTasks) {
      const f = taskFigures.get(t.id)!;
      if (f.actual.finish && (!finish || f.actual.finish > finish)) { finish = f.actual.finish; lastId = t.id; }
      if (f.actual.forecast && f.actual.finish) forecast = true;
      start = earlier(start, f.actual.start);
      plannedFallback = later(plannedFallback, f.planned.finish);
    }
    const plannedFinish = args.plannedFinish ?? plannedFallback;
    const varianceDays = plannedFinish && finish ? daysFrom(plannedFinish, finish) : null;
    const sides = addSides(
      lastId ? chainSides(drivingChain(lastId, finishOf, predecessors)) : { client: 0, provider: 0, thirdParty: 0 },
      sideDays(args.levelLedger, now),
    );
    const raw = rawFor(
      holdDaysWithin(input.holds, start ?? args.plannedStart, finish, now),
      sides, plannedFinish, args.agreedFinish,
    );
    return {
      planned: { start: args.plannedStart, finish: plannedFinish },
      agreedFinish: args.agreedFinish,
      actual: { start, finish, forecast },
      varianceDays,
      causes: allocate(varianceDays, raw),
    };
  };

  const phases = input.phases.map((p) => ({
    id: p.id,
    ...level({
      levelTasks: p.tasks,
      plannedStart: p.startDate,
      plannedFinish: p.firstBaselineTargetEndDate ?? p.baselineTargetEndDate,
      agreedFinish: p.baselineTargetEndDate,
      levelLedger: input.ledger.filter((l) => !l.taskId && l.phaseId === p.id),
    }),
  }));

  const pr = input.project;
  const project = {
    ...level({
      levelTasks: tasks,
      plannedStart: pr.firstBaselineStartDate ?? pr.baselineStartDate ?? pr.startDate,
      plannedFinish: pr.firstBaselineTargetEndDate ?? pr.baselineTargetEndDate,
      agreedFinish: pr.baselineTargetEndDate,
      levelLedger: input.ledger.filter((l) => !l.taskId && !l.phaseId),
    }),
    // False only for an engagement rebaselined before first plans were kept.
    firstPlanKnown: pr.baselineVersion <= 1 || pr.firstBaselineTargetEndDate !== null,
  };

  const cp = criticalPath(tasks.map((t) => ({
    id: t.id, startDate: t.startDate, dueDate: t.dueDate, status: t.status,
  })), input.edges);

  return { project, phases, tasks: taskFigures, criticalPath: cp.path };
}

// ─── Words ──────────────────────────────────────────────────────────────────

const CAUSE_WORDS: Record<Cause, string> = {
  onHold: 'on hold',
  client: 'client',
  provider: 'provider',
  thirdParty: 'third party',
  rebaseline: 'rebaseline',
  unattributed: 'unattributed',
};

/** "+5 days", "On plan", "2 days early", or why there is no figure. */
export function varianceWords(f: Pick<Figures, 'varianceDays' | 'actual'>): string {
  if (f.varianceDays === null) return 'No agreed date to measure from';
  const tail = f.actual.forecast ? ' (forecast)' : '';
  if (f.varianceDays === 0) return `On plan${tail}`;
  const n = Math.abs(f.varianceDays);
  return (f.varianceDays > 0 ? `+${n} day${n === 1 ? '' : 's'}` : `${n} day${n === 1 ? '' : 's'} early`) + tail;
}

/** "5 client, 1 provider", in the fixed order of CAUSES; empty when nothing is owed. */
export function causeWords(c: Causes): string {
  return CAUSES.filter((k) => c[k] > 0).map((k) => `${c[k]} ${CAUSE_WORDS[k]}`).join(', ');
}
