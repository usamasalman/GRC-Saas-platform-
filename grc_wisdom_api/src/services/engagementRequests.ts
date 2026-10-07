import { prisma } from '../db';
import { DAY_MS } from './engagementRules';
import { hierarchyOf } from './scopeResolver';
import { Scope, ScopeService, SCOPE_SERVICES, registerScope, classificationsUpTo } from './engagementScope';

/**
 * Information requests (consulting engagement, sprint 8): what the firm asks
 * the organisation for, and the rules every route here shares.
 *
 * A request asks only for what the scope the organisation granted already
 * covers; anything wider is a scope-change request, which only the
 * organisation decides. Answers belong to the organisation and the firm sees
 * them through the request alone. The firm reviews evidence against four
 * tests; an accepted answer counts toward readiness, never toward a task or a
 * control being verified. Overdue requests are shown, never turned into a
 * delay by themselves.
 */

export const REQUEST_KINDS = ['Evidence', 'Document', 'Dataset', 'Clarification'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const TARGET_TYPES = ['Engagement', 'Task', 'Clause', 'Control', 'Register'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
export const ANSWER_KINDS = ['Upload', 'Evidence', 'Document', 'Record', 'Text'] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** Waiting for the organisation. */
export const AWAITING_ANSWER = ['Open', 'Returned'];
/** Still in play: waiting for an answer or for the firm's review. */
export const LIVE = ['Open', 'Answered', 'Returned'];
export const FINISHED = ['Accepted', 'Declined', 'Withdrawn'];

/** Days before the due date that the assignee is reminded. */
export const REMINDER_DAYS = 3;
export const MAX_IMPORT_ROWS = 500;

// ─── The four tests ─────────────────────────────────────────────────────────

export const TESTS = [
  { key: 'relevant', label: 'Relevant' },
  { key: 'complete', label: 'Complete' },
  { key: 'coversPeriod', label: 'Covers the period' },
  { key: 'authentic', label: 'Authentic and traceable' },
] as const;
export type TestKey = (typeof TESTS)[number]['key'];
export const VERDICTS = ['Pass', 'Fail', 'NotApplicable'] as const;

export interface ReviewDecision {
  outcome: 'Accepted' | 'Returned';
  note: string | null;
  tests: Partial<Record<TestKey, string>>;
  testNotes: Partial<Record<TestKey, string>>;
}

/**
 * A review as the firm submits it, checked. Evidence is judged on all four
 * tests, each Pass, Fail or Not applicable, and a Fail says why; anything
 * failed cannot be accepted. Returned always says what is missing.
 */
export function checkReview(kind: string, body: any): { ok: true; value: ReviewDecision } | { ok: false; code: string; message: string } {
  const outcome = String(body?.outcome ?? '');
  if (outcome !== 'Accepted' && outcome !== 'Returned') {
    return { ok: false, code: 'BAD_OUTCOME', message: 'The review ends as Accepted or Returned.' };
  }
  const note = body?.note ? String(body.note).trim().slice(0, 2000) : '';
  const tests: Partial<Record<TestKey, string>> = {};
  const testNotes: Partial<Record<TestKey, string>> = {};
  if (kind === 'Evidence') {
    for (const t of TESTS) {
      const v = String(body?.tests?.[t.key] ?? '');
      if (!(VERDICTS as readonly string[]).includes(v)) {
        return { ok: false, code: 'TEST_REQUIRED', message: `Judge "${t.label}": Pass, Fail or Not applicable.` };
      }
      tests[t.key] = v;
      if (v === 'Fail') {
        const n = String(body?.testNotes?.[t.key] ?? '').trim();
        if (n.length < 3) return { ok: false, code: 'FAIL_NOTE_REQUIRED', message: `Say why "${t.label}" fails.` };
        testNotes[t.key] = n.slice(0, 1000);
      }
    }
    if (outcome === 'Accepted' && Object.values(tests).includes('Fail')) {
      return { ok: false, code: 'FAILED_TEST', message: 'Evidence that fails a test is returned, not accepted.' };
    }
  }
  if (outcome === 'Returned' && note.length < 10) {
    return { ok: false, code: 'SAY_WHAT_IS_MISSING', message: 'Say what is missing — at least 10 characters.' };
  }
  return { ok: true, value: { outcome, note: note || null, tests, testNotes } };
}

// ─── Dates ──────────────────────────────────────────────────────────────────

/** A calendar day as typed, at midnight UTC; null when empty, 'bad' when not a date. */
export function parseDay(v: unknown): Date | null | 'bad' {
  if (v === undefined || v === null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return 'bad';
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

type Hold = { startedAt: Date; endedAt: Date | null };

const overlap = (from: number, to: number, h: Hold, now: number) => {
  const s = Math.max(from, h.startedAt.getTime());
  const e = Math.min(to, (h.endedAt ?? new Date(now)).getTime());
  return Math.max(0, e - s);
};

/**
 * Whole days past the due day, not counting days on hold: the due day itself
 * counts in full, and the clock stops while the engagement is held.
 */
export function overdueDays(due: Date, holds: readonly Hold[], now: Date = new Date()): number {
  const from = due.getTime() + DAY_MS;
  const to = now.getTime();
  if (to <= from) return 0;
  const held = holds.reduce((n, h) => n + overlap(from, to, h, to), 0);
  return Math.max(0, Math.ceil((to - from - held) / DAY_MS));
}

/** Whether the due day fell while the engagement was on hold. */
export const dueDuringHold = (due: Date, holds: readonly Hold[]): boolean => holds.some((h) => (
  h.startedAt.getTime() <= due.getTime() + DAY_MS && (h.endedAt === null || h.endedAt.getTime() >= due.getTime())
));

// ─── Spreadsheets ───────────────────────────────────────────────────────────

/**
 * A value that a spreadsheet would run as a formula, made inert: anything
 * starting with =, +, -, @, a tab or a carriage return gets a leading
 * apostrophe. Applied to every text cell this module writes.
 */
export const neutralise = (v: unknown): string => {
  const s = String(v ?? '');
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** One cell as text. A formula is refused rather than read as its result. */
export function cellText(v: any): { text: string } | { formula: true } {
  if (v === null || v === undefined) return { text: '' };
  if (v instanceof Date) return { text: v.toISOString().slice(0, 10) };
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return { formula: true };
    if ('richText' in v) return { text: (v.richText as any[]).map((t) => t.text).join('').trim() };
    if ('text' in v) return { text: String(v.text).trim() };
    if ('result' in v) return { formula: true };
    return { text: '' };
  }
  return { text: String(v).trim() };
}

// ─── What a request is about ────────────────────────────────────────────────

export interface ScopeAsk { services: string[]; entityIds: string[]; frameworkIds: string[] }

export type Target =
  | { ok: true; targetType: TargetType; targetId: string | null; label: string; taskId: string | null }
  | { ok: false; status: number; code: string; message: string; scopeChange?: ScopeAsk };

const outOfScope = (message: string, ask: Partial<ScopeAsk>): Target => ({
  ok: false, status: 409, code: 'OUT_OF_SCOPE', message,
  scopeChange: { services: ask.services ?? [], entityIds: ask.entityIds ?? [], frameworkIds: ask.frameworkIds ?? [] },
});

/**
 * The target of a request, checked against the binding scope. By id from the
 * screens, or by reference from an imported file: a task's ref (TSK-0001), a
 * clause as "<framework code> <clause ref>", a control's code (AC-04), a
 * register's name. Outside the scope it answers with what a scope change
 * would have to add.
 */
export async function resolveTarget(args: {
  projectId: string; clientTenantId: string; scope: Scope | null;
  targetType: string; target: string | null | undefined; byRef?: boolean; now?: Date;
}): Promise<Target> {
  const t = String(args.targetType || 'Engagement');
  const raw = String(args.target ?? '').trim();
  const now = args.now ?? new Date();
  if (!(TARGET_TYPES as readonly string[]).includes(t)) {
    return { ok: false, status: 400, code: 'BAD_TARGET', message: `A request is about the ${TARGET_TYPES.join(', ').toLowerCase()}.` };
  }
  if (t === 'Engagement') return { ok: true, targetType: 'Engagement', targetId: null, label: 'The engagement', taskId: null };
  if (!raw) return { ok: false, status: 400, code: 'TARGET_REQUIRED', message: `Name the ${t.toLowerCase()} the request is about.` };

  if (t === 'Task') {
    const task = await prisma.projectTask.findFirst({
      where: { projectId: args.projectId, ...(args.byRef ? { ref: raw } : { id: raw }) }, select: { id: true, ref: true, name: true },
    });
    if (!task) return { ok: false, status: 400, code: 'NO_SUCH_TASK', message: `There is no task ${raw} on this engagement.` };
    return { ok: true, targetType: 'Task', targetId: task.id, label: `${task.ref} · ${task.name}`, taskId: task.id };
  }

  if (t === 'Clause') {
    let clause: { id: string; ref: string; title: string; standardId: string; standard: { code: string } } | null = null;
    const select = { id: true, ref: true, title: true, standardId: true, standard: { select: { code: true } } } as const;
    if (args.byRef) {
      const m = /^(\S+)\s+(.+)$/.exec(raw);
      if (m) clause = await prisma.standardClause.findFirst({ where: { ref: m[2], standard: { code: m[1] } }, select });
    } else {
      clause = await prisma.standardClause.findUnique({ where: { id: raw }, select });
    }
    if (!clause) return { ok: false, status: 400, code: 'NO_SUCH_CLAUSE', message: `There is no clause ${raw}; write it as the framework code and the clause, e.g. ISO27001 A.5.15.` };
    const label = `${clause.standard.code} ${clause.ref} · ${clause.title}`;
    const inScope = Boolean(args.scope && args.scope.frameworkIds.includes(clause.standardId)
      && (!args.scope.validFrom || now >= args.scope.validFrom)
      && (!args.scope.validTo || now.getTime() < args.scope.validTo.getTime() + DAY_MS));
    if (!inScope) return outOfScope(`${clause.standard.code} is not in this engagement's scope.`, { frameworkIds: [clause.standardId] });
    return { ok: true, targetType: 'Clause', targetId: clause.id, label, taskId: null };
  }

  if (t === 'Control') {
    // Only the organisation's own controls: anyone else's id is not found.
    const own = await hierarchyOf(args.clientTenantId);
    const impl = await prisma.controlImplementation.findFirst({
      where: args.byRef
        ? { tenantId: { in: args.scope?.entityIds?.length ? args.scope.entityIds : [args.clientTenantId] }, control: { code: raw } }
        : { id: raw, tenantId: { in: own } },
      select: { id: true, tenantId: true, title: true, control: { select: { code: true, title: true } } },
    });
    if (!impl) return { ok: false, status: 400, code: 'NO_SUCH_CONTROL', message: `The organisation has no control ${raw} in place.` };
    const label = `${impl.control.code} · ${impl.control.title}`;
    const reg = registerScope(args.scope, 'Controls', now);
    if (!reg || !reg.tenantIds.includes(impl.tenantId)) {
      return outOfScope('The organisation\'s controls are not in this engagement\'s scope.', {
        services: reg ? [] : ['Controls'], entityIds: reg && !reg.tenantIds.includes(impl.tenantId) ? [impl.tenantId] : [],
      });
    }
    return { ok: true, targetType: 'Control', targetId: impl.id, label, taskId: null };
  }

  // A register, by its name.
  const service = SCOPE_SERVICES.find((s) => s.toLowerCase() === raw.toLowerCase());
  if (!service) return { ok: false, status: 400, code: 'NO_SUCH_REGISTER', message: `A register is one of ${SCOPE_SERVICES.join(', ')}.` };
  if (!registerScope(args.scope, service as ScopeService, now)) {
    return outOfScope(`The ${service.toLowerCase()} register is not in this engagement's scope.`, { services: [service] });
  }
  return { ok: true, targetType: 'Register', targetId: service, label: `The ${service.toLowerCase()} register`, taskId: null };
}

/** The highest classification a request's answers may carry: the scope's ceiling, Internal without one. */
export const answerClassifications = (scope: Scope | null): string[] => classificationsUpTo(scope?.classificationCeiling ?? 'Internal');

// ─── Readiness ──────────────────────────────────────────────────────────────

/**
 * Clauses of the engagement's frameworks with evidence the firm accepted: a
 * request about the clause itself, a task mapped to it or a control mapped
 * to it, accepted. A figure of its own; it changes no task, no verification
 * and no control's validation.
 */
export async function acceptedClauseIds(projectId: string, boundStandardIds: readonly string[]): Promise<string[]> {
  if (boundStandardIds.length === 0) return [];
  const accepted = await prisma.informationRequest.findMany({
    where: { projectId, status: 'Accepted', targetType: { in: ['Clause', 'Task', 'Control'] } },
    select: { targetType: true, targetId: true },
  });
  const ids = new Set<string>();
  const byType = (type: string) => accepted.filter((a) => a.targetType === type && a.targetId).map((a) => a.targetId!);
  byType('Clause').forEach((id) => ids.add(id));
  const taskIds = byType('Task');
  if (taskIds.length) {
    (await prisma.projectTaskClause.findMany({ where: { taskId: { in: taskIds } }, select: { clauseId: true } }))
      .forEach((l) => ids.add(l.clauseId));
  }
  const implIds = byType('Control');
  if (implIds.length) {
    (await prisma.controlClauseLink.findMany({
      where: { control: { implementations: { some: { id: { in: implIds } } } } }, select: { clauseId: true },
    })).forEach((l) => ids.add(l.clauseId));
  }
  if (ids.size === 0) return [];
  const inScope = await prisma.standardClause.findMany({
    where: { id: { in: [...ids] }, standardId: { in: [...boundStandardIds] } }, select: { id: true },
  });
  return inScope.map((c) => c.id);
}
