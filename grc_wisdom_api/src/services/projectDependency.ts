/**
 * What has to happen before what, and where a slip costs the whole plan.
 *
 * Pure: no Prisma, no request, no ambient clock. Graph code is exactly the kind
 * that looks right and is wrong on the third case — a cycle check that misses a
 * long loop, a critical path off by one edge — and none of it needs Postgres to
 * prove.
 *
 * The question this exists to answer is the one a steering committee actually
 * asks: if this task slips, does the end date slip? Without edges, a plan is an
 * ordered list with dates on it, and that question has no answer in the data.
 */

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/**
 *   FinishToStart   the successor starts after the predecessor finishes
 *   StartToStart    they may run together, but not before it begins
 *   FinishToFinish  the successor cannot finish until the predecessor has
 *
 * StartToFinish is deliberately absent — the fourth textbook type, almost never
 * used correctly, and an enum value picked by mistake produces a plan that is
 * wrong in a way nobody can see.
 */
export const DEPENDENCY_KINDS = [
  'FinishToStart', 'StartToStart', 'FinishToFinish',
] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export interface Edge {
  predecessorId: string;
  successorId: string;
  kind: string;
  lagDays: number;
}

export interface DependencyRefusal {
  code: 'SELF_DEPENDENCY' | 'CYCLE' | 'UNKNOWN_KIND' | 'NEGATIVE_LAG'
      | 'CROSS_PROJECT' | 'DUPLICATE';
  message: string;
}

// ─── The check that matters ─────────────────────────────────────────────────

/**
 * Would adding this edge close a loop?
 *
 * A cycle makes a plan unschedulable: every task in it waits on itself by some
 * route, no start date can be derived, and a naive scheduler runs forever. So
 * it is refused when the link is made rather than discovered later by something
 * that hangs.
 *
 * Implemented as a reachability search from the SUCCESSOR: if the predecessor
 * is already reachable by following edges forward from the successor, then
 * adding predecessor → successor closes a loop. This finds loops of any length,
 * which a check that only compared the two endpoints would not — and a
 * three-task loop is exactly what a person builds without noticing.
 */
export function wouldCycle(
  edges: readonly Edge[],
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) return true;

  const forward = new Map<string, string[]>();
  for (const e of edges) {
    const list = forward.get(e.predecessorId) || [];
    list.push(e.successorId);
    forward.set(e.predecessorId, list);
  }

  const seen = new Set<string>();
  const stack = [successorId];
  while (stack.length) {
    const at = stack.pop()!;
    if (at === predecessorId) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const next of forward.get(at) || []) stack.push(next);
  }
  return false;
}

/**
 * Every cycle already present in a set of edges.
 *
 * Not used to refuse a link — `wouldCycle` does that, and cheaper. This is for
 * telling a reader that an existing plan is broken, which can happen to data
 * that predates the check or arrives by import.
 */
export function detectCycle(edges: readonly Edge[]): string[] | null {
  const forward = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.predecessorId);
    nodes.add(e.successorId);
    const list = forward.get(e.predecessorId) || [];
    list.push(e.successorId);
    forward.set(e.predecessorId, list);
  }

  const WHITE = 0; const GREY = 1; const BLACK = 2;
  const colour = new Map<string, number>();
  const parent = new Map<string, string>();
  for (const n of nodes) colour.set(n, WHITE);

  // Iterative rather than recursive: a long chain of tasks is a deep stack, and
  // a plan that crashes the scheduler because somebody made a hundred-step
  // sequence is a worse failure than the cycle it was looking for.
  for (const start of nodes) {
    if (colour.get(start) !== WHITE) continue;
    const stack: { node: string; index: number }[] = [{ node: start, index: 0 }];
    colour.set(start, GREY);

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const children = forward.get(frame.node) || [];

      if (frame.index >= children.length) {
        colour.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const child = children[frame.index++];

      if (colour.get(child) === GREY) {
        // Walk the parent chain back to the child to name the loop, so a reader
        // is told which tasks to break rather than that "a cycle exists".
        const loop = [child];
        let at = frame.node;
        while (at !== child && loop.length < nodes.size + 1) {
          loop.push(at);
          at = parent.get(at) || child;
        }
        loop.push(child);
        return loop.reverse();
      }
      if (colour.get(child) === WHITE) {
        colour.set(child, GREY);
        parent.set(child, frame.node);
        stack.push({ node: child, index: 0 });
      }
    }
  }
  return null;
}

/** Validates one proposed link against the graph it would join. */
export function checkDependency(
  edges: readonly Edge[],
  proposed: { predecessorId: string; successorId: string; kind?: string; lagDays?: number },
): DependencyRefusal | null {
  if (proposed.predecessorId === proposed.successorId) {
    return {
      code: 'SELF_DEPENDENCY',
      message: 'A task cannot wait on itself.',
    };
  }
  if (proposed.kind && !(DEPENDENCY_KINDS as readonly string[]).includes(proposed.kind)) {
    return {
      code: 'UNKNOWN_KIND',
      message: `kind must be one of: ${DEPENDENCY_KINDS.join(', ')}.`,
    };
  }
  if (proposed.lagDays !== undefined && proposed.lagDays < 0) {
    return {
      code: 'NEGATIVE_LAG',
      message: 'Lag cannot be negative. A task that starts before its predecessor '
        + 'finishes is an overlap somebody should agree to explicitly, not a '
        + 'negative number hidden in a dependency.',
    };
  }
  if (edges.some((e) => e.predecessorId === proposed.predecessorId
    && e.successorId === proposed.successorId)) {
    return { code: 'DUPLICATE', message: 'That dependency already exists.' };
  }
  if (wouldCycle(edges, proposed.predecessorId, proposed.successorId)) {
    return {
      code: 'CYCLE',
      message: 'That link would make the plan wait on itself: the task you are '
        + 'making this depend on already comes after it, by some route. Nothing '
        + 'in a loop can ever be scheduled.',
    };
  }
  return null;
}

// ─── Scheduling ─────────────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  startDate: Date | null;
  dueDate: Date | null;
  status: string;
}

const MS_PER_DAY = 86_400_000;
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * MS_PER_DAY);
const days = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);

/**
 * Tasks in an order where every predecessor comes before its successors.
 *
 * Returns null when the graph has a cycle, because there is no such order —
 * callers must not receive a partial one and treat it as complete.
 */
export function topologicalOrder(
  taskIds: readonly string[],
  edges: readonly Edge[],
): string[] | null {
  const indegree = new Map<string, number>();
  const forward = new Map<string, string[]>();
  for (const id of taskIds) indegree.set(id, 0);

  for (const e of edges) {
    if (!indegree.has(e.predecessorId) || !indegree.has(e.successorId)) continue;
    forward.set(e.predecessorId, [...(forward.get(e.predecessorId) || []), e.successorId]);
    indegree.set(e.successorId, (indegree.get(e.successorId) || 0) + 1);
  }

  const ready = [...taskIds].filter((id) => indegree.get(id) === 0);
  const out: string[] = [];
  while (ready.length) {
    const at = ready.shift()!;
    out.push(at);
    for (const next of forward.get(at) || []) {
      const left = (indegree.get(next) || 0) - 1;
      indegree.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  return out.length === taskIds.length ? out : null;
}

export interface ScheduleViolation {
  successorId: string;
  predecessorId: string;
  kind: string;
  /** Days the successor's date sits before where the dependency allows. */
  byDays: number;
  reason: string;
}

/**
 * Dependencies the dates do not actually respect.
 *
 * Deliberately reported rather than enforced. Dates are set by people who know
 * things the plan does not — a task genuinely starting early because its
 * predecessor finished early is normal, and refusing the date would teach them
 * to delete the dependency instead, which loses the information entirely.
 *
 * A plan that cannot record an inconvenient truth stops being used.
 */
export function scheduleViolations(
  tasks: readonly ScheduledTask[],
  edges: readonly Edge[],
): ScheduleViolation[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: ScheduleViolation[] = [];

  for (const e of edges) {
    const p = byId.get(e.predecessorId);
    const s = byId.get(e.successorId);
    if (!p || !s) continue;

    if (e.kind === 'FinishToStart') {
      if (!p.dueDate || !s.startDate) continue;
      const earliest = addDays(p.dueDate, e.lagDays);
      if (s.startDate < earliest) {
        out.push({
          successorId: s.id, predecessorId: p.id, kind: e.kind,
          byDays: days(s.startDate, earliest),
          reason: 'starts before the task it waits on finishes',
        });
      }
    } else if (e.kind === 'StartToStart') {
      if (!p.startDate || !s.startDate) continue;
      const earliest = addDays(p.startDate, e.lagDays);
      if (s.startDate < earliest) {
        out.push({
          successorId: s.id, predecessorId: p.id, kind: e.kind,
          byDays: days(s.startDate, earliest),
          reason: 'starts before the task it runs alongside begins',
        });
      }
    } else if (e.kind === 'FinishToFinish') {
      if (!p.dueDate || !s.dueDate) continue;
      const earliest = addDays(p.dueDate, e.lagDays);
      if (s.dueDate < earliest) {
        out.push({
          successorId: s.id, predecessorId: p.id, kind: e.kind,
          byDays: days(s.dueDate, earliest),
          reason: 'finishes before the task it waits on finishes',
        });
      }
    }
  }
  return out;
}

// ─── The critical path ──────────────────────────────────────────────────────

export interface CriticalPathResult {
  /** Task ids on the longest chain, in order. Empty when nothing is dated. */
  path: string[];
  /** Calendar days the chain spans. */
  lengthDays: number;
  /** Every task on it, for a cheap membership test. */
  onPath: Set<string>;
}

/**
 * The longest chain of dependent work, by calendar duration.
 *
 * This is what makes a slip meaningful rather than merely annoying. A task off
 * the critical path can run late without moving the end date; a task on it
 * cannot. A committee asking "does this slip matter" is asking exactly this,
 * and before there were edges there was no way to answer.
 *
 * Undated tasks contribute zero duration rather than being dropped, so a chain
 * through a task nobody has scheduled is still reported as a chain — its length
 * simply understates. Dropping it would silently shorten the path and report
 * the wrong tasks as critical.
 */
export function criticalPath(
  tasks: readonly ScheduledTask[],
  edges: readonly Edge[],
): CriticalPathResult {
  const order = topologicalOrder(tasks.map((t) => t.id), edges);
  // A cyclic graph has no longest path; refusing to guess is the only honest
  // answer, and checkDependency stops one being created in the first place.
  if (!order) return { path: [], lengthDays: 0, onPath: new Set() };

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const duration = (id: string): number => {
    const t = byId.get(id);
    if (!t || !t.startDate || !t.dueDate) return 0;
    return Math.max(0, days(t.startDate, t.dueDate));
  };

  const incoming = new Map<string, Edge[]>();
  for (const e of edges) {
    incoming.set(e.successorId, [...(incoming.get(e.successorId) || []), e]);
  }

  const best = new Map<string, number>();
  const cameFrom = new Map<string, string | null>();

  for (const id of order) {
    let longest = 0;
    let from: string | null = null;
    for (const e of incoming.get(id) || []) {
      const through = (best.get(e.predecessorId) || 0) + Math.max(0, e.lagDays);
      if (through > longest) { longest = through; from = e.predecessorId; }
    }
    best.set(id, longest + duration(id));
    cameFrom.set(id, from);
  }

  let endId: string | null = null;
  let lengthDays = 0;
  for (const [id, len] of best) {
    if (len > lengthDays) { lengthDays = len; endId = id; }
  }

  const path: string[] = [];
  let at = endId;
  while (at) {
    path.unshift(at);
    at = cameFrom.get(at) ?? null;
  }

  return { path, lengthDays, onPath: new Set(path) };
}

// ─── Where a slip gets contested ────────────────────────────────────────────

export interface CrossSideLink {
  predecessorId: string;
  successorId: string;
  /** The side that owes the work being waited ON. */
  waitingOn: string;
  /** The side that is waiting. */
  waiting: string;
  onCriticalPath: boolean;
}

/**
 * Dependencies where one side is waiting on the other.
 *
 * The single most useful thing this module produces, and the reason it belongs
 * in a GRC delivery product rather than a task tracker. Slice 4 exists because
 * every steering meeting on consultant-led work argues about whose fault a slip
 * was; a cross-side dependency is precisely where such a slip is manufactured,
 * and one sitting on the critical path is the highest-risk item on the
 * engagement — a single handover that moves the end date.
 *
 * Same-side links are not returned. A provider waiting on its own work is
 * ordinary sequencing, and listing it would bury the handovers that are not.
 */
export function crossSideLinks(
  tasks: readonly { id: string; side: string }[],
  edges: readonly Edge[],
  critical: ReadonlySet<string>,
): CrossSideLink[] {
  const sideOf = new Map(tasks.map((t) => [t.id, t.side]));
  const out: CrossSideLink[] = [];

  for (const e of edges) {
    const p = sideOf.get(e.predecessorId);
    const s = sideOf.get(e.successorId);
    if (!p || !s || p === s) continue;

    out.push({
      predecessorId: e.predecessorId,
      successorId: e.successorId,
      waitingOn: p,
      waiting: s,
      // Both ends must be on the path: a handover into a critical task from an
      // uncritical one has slack on the giving side, and calling that critical
      // would send attention to work that can safely be late.
      onCriticalPath: critical.has(e.predecessorId) && critical.has(e.successorId),
    });
  }
  return out;
}

/**
 * How far a slip in one task would propagate.
 *
 * Everything downstream of it, transitively — the answer to "if this moves,
 * what else moves". Returned as a set rather than a count because a manager
 * wants the list, and a count without the list is a number nobody can act on.
 */
export function downstreamOf(edges: readonly Edge[], taskId: string): Set<string> {
  const forward = new Map<string, string[]>();
  for (const e of edges) {
    forward.set(e.predecessorId, [...(forward.get(e.predecessorId) || []), e.successorId]);
  }

  const out = new Set<string>();
  const stack = [...(forward.get(taskId) || [])];
  while (stack.length) {
    const at = stack.pop()!;
    if (out.has(at)) continue;
    out.add(at);
    for (const next of forward.get(at) || []) stack.push(next);
  }
  return out;
}
