/**
 * Plan templates: who sees which, what a valid one is, and how one becomes a
 * dated plan (consulting engagement, sprint 3).
 *
 * Pure: no Prisma, no request, no clock beyond the one passed in.
 *
 *   Platform  kept by the platform, read by every organisation and firm
 *   Firm      a consulting firm's own method, read only by that firm
 *   Client    an organisation's own, read by it and the entities it can see
 *
 * A template is copied into a plan, never linked. Each version is immutable:
 * saving changes makes the next version of the same family, and retiring one
 * hides it from the wizard without touching any plan made from it.
 */

const MS_PER_DAY = 86_400_000;

export const TEMPLATE_LEVELS = ['Platform', 'Firm', 'Client'] as const;
export type TemplateLevel = (typeof TEMPLATE_LEVELS)[number];
export const GENERATE_MODES = ['Once', 'PerClause', 'PerTheme'] as const;
export const TEMPLATE_SIDES = ['Client', 'Provider'] as const;

const PLATFORM_TYPES = new Set(['SAAS', 'SAAS_UNIT']);
const FIRM_TYPES = new Set(['PARTNER', 'FRANCHISE']);

/** The library a tenant's own templates belong to. */
export function levelForTenantType(type: string): TemplateLevel {
  if (PLATFORM_TYPES.has(type)) return 'Platform';
  if (FIRM_TYPES.has(type)) return 'Firm';
  return 'Client';
}

/**
 * Whether a caller may read a template. A firm's library is its own: another
 * firm, and the firm's clients, get the same 404 as for a template that does
 * not exist.
 */
export function canSeeTemplate(
  scope: { tenantIds: readonly string[] },
  t: { level: string; tenantId: string | null },
): boolean {
  if (t.level === 'Platform') return true;
  return t.tenantId !== null && scope.tenantIds.includes(t.tenantId);
}

/** Whether a caller may make a new version of a template, or retire it. */
export function canMaintainTemplate(
  caller: { tenantId: string; tenantType: string },
  t: { level: string; tenantId: string | null },
): boolean {
  if (t.level === 'Platform') return PLATFORM_TYPES.has(caller.tenantType);
  return t.tenantId === caller.tenantId;
}

// ─── Shape ──────────────────────────────────────────────────────────────────

export interface TemplateTaskBody {
  key: string;
  name: string;
  description?: string | null;
  side: string;
  durationDays: number;
  weight: number;
  needsVerification?: boolean | null;
  dependsOnKey?: string | null;
  clauses?: string[];
  generate?: string;
  deliverable?: string | null;
}

export interface TemplatePhaseBody {
  name: string;
  description?: string | null;
  durationDays: number;
  tasks: TemplateTaskBody[];
}

export interface TemplateBody {
  name: string;
  description?: string | null;
  engagementType?: string | null;
  standardCode?: string | null;
  phases: TemplatePhaseBody[];
}

const LIMITS = { phases: 30, tasksPerPhase: 100, days: 365, weight: 100, clauses: 50, text: 200 };
const ENGAGEMENT_TYPES = ['Certification', 'Readiness', 'Remediation', 'Implementation', 'Assessment'];

const text = (v: unknown, max = LIMITS.text): string | null => {
  const s = String(v ?? '').trim();
  return s && s.length <= max ? s : null;
};
const wholeDays = (v: unknown, max = LIMITS.days): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
};

/**
 * Checks a template body and returns it cleaned, or says what is wrong.
 *
 * A task may wait only on a task that comes before it in the template, which
 * is also what lets one pass compute every date and rules out a loop.
 */
export function checkTemplateBody(raw: any): { ok: true; body: TemplateBody } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  const name = text(raw?.name);
  if (!name) return bad(`name is required, up to ${LIMITS.text} characters.`);
  if (raw?.engagementType && !ENGAGEMENT_TYPES.includes(raw.engagementType)) {
    return bad(`engagementType must be one of: ${ENGAGEMENT_TYPES.join(', ')}.`);
  }
  const phasesRaw = Array.isArray(raw?.phases) ? raw.phases : [];
  if (phasesRaw.length === 0 || phasesRaw.length > LIMITS.phases) {
    return bad(`A template needs between 1 and ${LIMITS.phases} phases.`);
  }

  const seen = new Set<string>();
  const phases: TemplatePhaseBody[] = [];
  for (const [pi, p] of phasesRaw.entries()) {
    const pname = text(p?.name);
    const pdays = wholeDays(p?.durationDays);
    if (!pname || pdays === null) return bad(`Phase ${pi + 1} needs a name and a length of 1 to ${LIMITS.days} days.`);
    const tasksRaw = Array.isArray(p?.tasks) ? p.tasks : [];
    if (tasksRaw.length > LIMITS.tasksPerPhase) return bad(`Phase "${pname}" has more than ${LIMITS.tasksPerPhase} tasks.`);

    const tasks: TemplateTaskBody[] = [];
    for (const t of tasksRaw) {
      const key = text(t?.key, 40);
      const tname = text(t?.name);
      const days = wholeDays(t?.durationDays);
      const weight = t?.weight === undefined ? 1 : Number(t.weight);
      if (!key || !tname || days === null) return bad(`Every task in "${pname}" needs a key, a name and a length of 1 to ${LIMITS.days} days.`);
      if (seen.has(key)) return bad(`Task key "${key}" is used twice.`);
      if (!(TEMPLATE_SIDES as readonly string[]).includes(t?.side ?? 'Client')) return bad(`Task "${tname}": side must be Client or Provider.`);
      if (!Number.isInteger(weight) || weight < 1 || weight > LIMITS.weight) return bad(`Task "${tname}": weight must be 1 to ${LIMITS.weight}.`);
      const generate = t?.generate ?? 'Once';
      if (!(GENERATE_MODES as readonly string[]).includes(generate)) return bad(`Task "${tname}": generate must be ${GENERATE_MODES.join(', ')}.`);
      const clauses = Array.isArray(t?.clauses) ? t.clauses.map((c: unknown) => text(c, 40)).filter(Boolean) as string[] : [];
      if (clauses.length > LIMITS.clauses) return bad(`Task "${tname}" names more than ${LIMITS.clauses} clauses.`);
      if (generate !== 'Once' && clauses.length === 0) return bad(`Task "${tname}" is generated per clause but names no clauses.`);
      const dependsOnKey = t?.dependsOnKey ? String(t.dependsOnKey) : null;
      if (dependsOnKey && !seen.has(dependsOnKey)) {
        return bad(`Task "${tname}" waits on "${dependsOnKey}", which must be a task earlier in the template.`);
      }
      const nv = t?.needsVerification;
      tasks.push({
        key, name: tname, description: text(t?.description, 2000), side: t?.side ?? 'Client',
        durationDays: days, weight, needsVerification: nv === true || nv === false ? nv : null,
        dependsOnKey, clauses, generate, deliverable: text(t?.deliverable),
      });
      seen.add(key);
    }
    phases.push({ name: pname, description: text(p?.description, 2000), durationDays: pdays, tasks });
  }

  return {
    ok: true,
    body: {
      name,
      description: text(raw?.description, 2000),
      engagementType: raw?.engagementType || null,
      standardCode: text(raw?.standardCode, 40),
      phases,
    },
  };
}

// ─── Clauses ────────────────────────────────────────────────────────────────

export interface ClauseRow { id: string; ref: string; title: string }

const segments = (ref: string) => ref.split(/[.-]/).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
export function compareRefs(a: string, b: string): number {
  const x = segments(a);
  const y = segments(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] === y[i]) continue;
    if (typeof x[i] === 'number' && typeof y[i] === 'number') return (x[i] as number) - (y[i] as number);
    return String(x[i]).localeCompare(String(y[i]));
  }
  return 0;
}

/** Clauses a list of refs or prefixes names: "A.5" matches A.5.1 and A.5.15, not A.50. */
export function matchClauses(patterns: readonly string[], clauses: readonly ClauseRow[]): ClauseRow[] {
  const hit = clauses.filter((c) => patterns.some((p) => c.ref === p
    || c.ref.startsWith(`${p}.`) || c.ref.startsWith(`${p}-`)));
  return [...hit].sort((a, b) => compareRefs(a.ref, b.ref));
}

/** The theme a clause sits in: its first two segments, "A.5" for A.5.15. */
export function themeOf(ref: string): string {
  const m = /^([^.-]+)([.-])([^.-]+)/.exec(ref);
  return m ? `${m[1]}${m[2]}${m[3]}` : ref;
}

// ─── A template becomes a dated plan ────────────────────────────────────────

export interface TemplateForPlan {
  phases: {
    id: string; name: string; description: string | null; durationDays: number;
    tasks: (Omit<TemplateTaskBody, 'clauses'> & { clauses: string[] })[];
  }[];
}

export interface CustomTask { phaseId: string; name: string; side: string; durationDays: number }
export interface CustomPhase { name: string; durationDays: number; tasks: { name: string; side: string; durationDays: number }[] }

export interface PlannedTask {
  key: string;
  name: string;
  description: string | null;
  side: string;
  weight: number;
  verificationOverride: boolean | null;
  startDate: Date;
  dueDate: Date;
  clauseIds: string[];
  deliverable: string | null;
  custom: boolean;
}

export interface PlannedPhase {
  name: string;
  description: string | null;
  startDate: Date;
  targetEndDate: Date;
  tasks: PlannedTask[];
  custom: boolean;
}

export interface PlannedPlan {
  phases: PlannedPhase[];
  dependencies: { predecessorKey: string; successorKey: string }[];
  endDate: Date;
  /** Clause refs or prefixes the template names that match nothing in this framework. */
  unmatched: string[];
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * MS_PER_DAY);

/**
 * Lays a tailored template out from a start date.
 *
 * Phases run one after another. A task starts when the phase starts, or when
 * the task it waits on is due, whichever is later; the phase lasts its default
 * length or until its last task is due. A task left out is simply absent: what
 * waited on it starts with its phase.
 */
export function planFromTemplate(args: {
  template: TemplateForPlan;
  startDate: Date;
  excludePhaseIds?: readonly string[];
  excludeTaskKeys?: readonly string[];
  customTasks?: readonly CustomTask[];
  customPhases?: readonly CustomPhase[];
  clauses: readonly ClauseRow[];
}): PlannedPlan {
  const outPhases = new Set(args.excludePhaseIds || []);
  const outTasks = new Set(args.excludeTaskKeys || []);
  const dueOf = new Map<string, Date>();
  const lastInstance = new Map<string, string>();
  const dependencies: { predecessorKey: string; successorKey: string }[] = [];
  const unmatched = new Set<string>();
  const phases: PlannedPhase[] = [];
  let cursor = new Date(Date.UTC(args.startDate.getUTCFullYear(), args.startDate.getUTCMonth(), args.startDate.getUTCDate()));

  const layPhase = (
    name: string, description: string | null, durationDays: number,
    tasks: { key: string; body: Omit<PlannedTask, 'startDate' | 'dueDate'>; days: number; after: string | null }[],
    custom: boolean,
  ) => {
    const start = cursor;
    let end = addDays(start, durationDays);
    const planned: PlannedTask[] = [];
    for (const t of tasks) {
      const waitFor = t.after ? lastInstance.get(t.after) : undefined;
      const from = waitFor && dueOf.get(waitFor)! > start ? dueOf.get(waitFor)! : start;
      const due = addDays(from, t.days);
      dueOf.set(t.key, due);
      if (waitFor) dependencies.push({ predecessorKey: waitFor, successorKey: t.key });
      if (due > end) end = due;
      planned.push({ ...t.body, startDate: from, dueDate: due });
    }
    phases.push({ name, description, startDate: start, targetEndDate: end, tasks: planned, custom });
    cursor = end;
  };

  for (const p of args.template.phases) {
    if (outPhases.has(p.id)) continue;
    const tasks: { key: string; body: Omit<PlannedTask, 'startDate' | 'dueDate'>; days: number; after: string | null }[] = [];
    for (const t of p.tasks) {
      if (outTasks.has(t.key)) continue;
      const after = t.dependsOnKey && !outTasks.has(t.dependsOnKey) ? t.dependsOnKey : null;
      const matched = matchClauses(t.clauses, args.clauses);
      for (const c of t.clauses) if (matchClauses([c], args.clauses).length === 0) unmatched.add(c);

      // One task, or one per clause, or one per theme of the matched clauses.
      const groups: { suffix: string; clauses: ClauseRow[] }[] = [];
      if (t.generate === 'PerClause' && matched.length) {
        for (const c of matched) groups.push({ suffix: ` — ${c.ref} ${c.title}`, clauses: [c] });
      } else if (t.generate === 'PerTheme' && matched.length) {
        const themes = new Map<string, ClauseRow[]>();
        for (const c of matched) themes.set(themeOf(c.ref), [...(themes.get(themeOf(c.ref)) || []), c]);
        for (const [theme, cs] of themes) groups.push({ suffix: ` — ${theme}`, clauses: cs });
      } else {
        groups.push({ suffix: '', clauses: matched });
      }

      groups.forEach((g, i) => {
        const key = groups.length === 1 ? t.key : `${t.key}#${i + 1}`;
        tasks.push({
          key,
          after,
          days: t.durationDays,
          body: {
            key, name: `${t.name}${g.suffix}`, description: t.description ?? null, side: t.side,
            weight: t.weight, verificationOverride: t.needsVerification ?? null,
            clauseIds: g.clauses.map((c) => c.id), deliverable: t.deliverable ?? null, custom: false,
          },
        });
        lastInstance.set(t.key, key);
      });
    }
    (args.customTasks || []).filter((c) => c.phaseId === p.id).forEach((c, i) => {
      const key = `custom:${p.id}:${i + 1}`;
      tasks.push({
        key, after: null, days: c.durationDays,
        body: {
          key, name: c.name, description: null, side: c.side, weight: 1, verificationOverride: null,
          clauseIds: [], deliverable: null, custom: true,
        },
      });
    });
    layPhase(p.name, p.description, p.durationDays, tasks, false);
  }

  (args.customPhases || []).forEach((cp, pi) => {
    layPhase(cp.name, null, cp.durationDays, cp.tasks.map((c, i) => {
      const key = `custom-phase:${pi + 1}:${i + 1}`;
      return {
        key, after: null, days: c.durationDays,
        body: {
          key, name: c.name, description: null, side: c.side, weight: 1, verificationOverride: null,
          clauseIds: [], deliverable: null, custom: true,
        },
      };
    }), true);
  });

  return { phases, dependencies, endDate: cursor, unmatched: [...unmatched] };
}

/** Checks the wizard's custom additions. */
export function checkCustom(raw: any): { ok: true; tasks: CustomTask[]; phases: CustomPhase[] } | { ok: false; message: string } {
  const tasks: CustomTask[] = [];
  for (const t of Array.isArray(raw?.customTasks) ? raw.customTasks : []) {
    const name = text(t?.name);
    const days = wholeDays(t?.durationDays);
    if (!name || days === null || !t?.phaseId) return { ok: false, message: 'Each custom task needs a phase, a name and a length of 1 to 365 days.' };
    if (!(TEMPLATE_SIDES as readonly string[]).includes(t?.side ?? 'Client')) return { ok: false, message: `Custom task "${name}": side must be Client or Provider.` };
    tasks.push({ phaseId: String(t.phaseId), name, side: t?.side ?? 'Client', durationDays: days });
  }
  const phases: CustomPhase[] = [];
  for (const p of Array.isArray(raw?.customPhases) ? raw.customPhases : []) {
    const name = text(p?.name);
    const days = wholeDays(p?.durationDays);
    if (!name || days === null) return { ok: false, message: 'Each custom phase needs a name and a length of 1 to 365 days.' };
    const ptasks = [];
    for (const t of Array.isArray(p?.tasks) ? p.tasks : []) {
      const tname = text(t?.name);
      const tdays = wholeDays(t?.durationDays);
      if (!tname || tdays === null) return { ok: false, message: `Each task in "${name}" needs a name and a length of 1 to 365 days.` };
      ptasks.push({ name: tname, side: t?.side === 'Provider' ? 'Provider' : 'Client', durationDays: tdays });
    }
    phases.push({ name, durationDays: days, tasks: ptasks });
  }
  if (tasks.length + phases.length > 200) return { ok: false, message: 'Too many custom additions at once.' };
  return { ok: true, tasks, phases };
}

// ─── A plan becomes a template ──────────────────────────────────────────────

/**
 * A plan with the client taken out: no people, no organisation or entity
 * names, no files, no dates. What is left is the method: the phases, the
 * tasks, whose side each is, how long each took as planned, what each waits
 * on and which clauses each addresses.
 */
export function templateFromPlan(args: {
  name: string;
  description: string | null;
  engagementType: string | null;
  standardCode: string | null;
  phases: {
    name: string; description: string | null; startDate: Date; targetEndDate: Date;
    tasks: {
      id: string; name: string; description: string | null; side: string; weight: number;
      verificationOverride: boolean | null; startDate: Date | null; dueDate: Date | null; clauseRefs: string[];
    }[];
  }[];
  edges: readonly { predecessorId: string; successorId: string }[];
  /** Names to take out: the organisations, their entities, the people. */
  strip: readonly string[];
}): TemplateBody {
  const names = [...new Set(args.strip.map((s) => s.trim()).filter((s) => s.length >= 3))]
    .sort((a, b) => b.length - a.length);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clean = (s: string | null): string | null => {
    if (!s) return s;
    let out = s;
    for (const n of names) out = out.replace(new RegExp(escape(n), 'gi'), 'the organisation');
    out = out
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[date]')
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[email]');
    return out;
  };
  const days = (from: Date | null, to: Date | null, fallback: number) => {
    if (!from || !to) return fallback;
    return Math.min(LIMITS.days, Math.max(1, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)));
  };

  const keyOf = new Map<string, string>();
  let n = 0;
  for (const p of args.phases) for (const t of p.tasks) keyOf.set(t.id, `t${(n += 1)}`);
  const order = new Map([...keyOf.keys()].map((id, i) => [id, i]));

  return {
    name: args.name,
    description: clean(args.description),
    engagementType: args.engagementType,
    standardCode: args.standardCode,
    phases: args.phases.map((p) => {
      const phaseDays = days(p.startDate, p.targetEndDate, 7);
      return {
        name: clean(p.name) || 'Phase',
        description: clean(p.description),
        durationDays: phaseDays,
        tasks: p.tasks.map((t) => {
          // Only a predecessor earlier in the plan can be kept: that is the
          // rule a template holds, and the one that rules out a loop.
          const pred = args.edges
            .filter((e) => e.successorId === t.id && keyOf.has(e.predecessorId)
              && (order.get(e.predecessorId) ?? Infinity) < (order.get(t.id) ?? -1))
            .map((e) => keyOf.get(e.predecessorId)!)[0] ?? null;
          return {
            key: keyOf.get(t.id)!,
            name: clean(t.name) || 'Task',
            description: clean(t.description),
            side: t.side === 'Provider' ? 'Provider' : 'Client',
            durationDays: days(t.startDate, t.dueDate, Math.min(phaseDays, 5)),
            weight: Math.min(LIMITS.weight, Math.max(1, t.weight)),
            needsVerification: t.verificationOverride,
            dependsOnKey: pred,
            clauses: t.clauseRefs.slice(0, LIMITS.clauses),
            generate: 'Once',
            deliverable: null,
          };
        }),
      };
    }),
  };
}

// ─── Similar tasks ──────────────────────────────────────────────────────────

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'all', 'our', 'any']);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));

/**
 * Library tasks that look like what is being typed, the way a new risk shows
 * possible duplicates: the share of the typed words each one contains.
 */
export function similarTasks<T extends { name: string }>(query: string, candidates: readonly T[], limit = 6): T[] {
  const q = words(query);
  if (q.size === 0) return [];
  const seen = new Set<string>();
  return candidates
    .map((c) => {
      const w = words(c.name);
      let hit = 0;
      for (const x of q) if (w.has(x)) hit += 1;
      return { c, score: hit / q.size };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .filter((x) => {
      const k = x.c.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit)
    .map((x) => x.c);
}
