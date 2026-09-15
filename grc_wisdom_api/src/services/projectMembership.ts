/**
 * Who is on an engagement, and how much of them it has.
 *
 * ProjectMember models this completely — which side of the engagement a person
 * answers to, their role label, R/A/C/I, the share of their time, and an active
 * flag so removal keeps history rather than erasing it. It even carries an
 * index on [userId, active], which exists for exactly one question: which
 * projects is this person on.
 *
 * Nothing used any of it. The table is written in one place in the whole API —
 * a createMany at project creation that adds the owner and the manager — and
 * read nowhere. There is no endpoint to add, remove or change anybody, and
 * canReadProject decides access from tenant scope alone, so membership governs
 * nothing either. Meanwhile the portfolio renders a member count, so the
 * product displays the size of a set nobody can change.
 *
 * That is the owner's complaint almost word for word: "who will be inculde and
 * manage ... one person works on differrent project this will be specify that
 * organization which have the resourses".
 *
 * The decisions live here, pure and without Prisma, so every case runs without
 * a database.
 */

/** R/A/C/I against the engagement as a whole. */
export const RACI = ['R', 'A', 'C', 'I'] as const;

/** Which organisation a person answers to on this engagement. */
export const SIDES = ['Client', 'Provider'] as const;

export interface MemberRow {
  id: string;
  userId: string;
  userName: string;
  side: string;
  roleLabel: string;
  raci: string;
  allocation: number | null;
  active: boolean;
}

export interface ProjectFacts {
  id: string;
  tenantId: string;
  providerTenantId: string | null;
  ownerId: string;
  managerId: string;
  status: string;
}

export interface CandidateUser {
  id: string;
  tenantId: string;
  name: string;
}

export interface MembershipRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface MembershipDecision {
  ok: true;
  side: string;
  roleLabel: string;
  raci: string;
  allocation: number | null;
}

/** Statuses in which the team is settled and should not be rearranged casually. */
const CLOSED_STATUSES = ['Closed', 'Cancelled', 'Completed'];

function validAllocation(raw: unknown): number | null | 'invalid' {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100) return 'invalid';
  return n;
}

/**
 * Whether this person may join this engagement, and on what terms.
 *
 * The refusals in order of how badly each would go wrong.
 */
export function planMemberAdd(input: {
  project: ProjectFacts;
  /** The user being added, as loaded. Null when they do not exist. */
  candidate: CandidateUser | null;
  /** Tenants the caller may write to, from resolveTenantScope. */
  scopeTenantIds: readonly string[];
  existing: readonly MemberRow[];
  side?: unknown;
  roleLabel?: unknown;
  raci?: unknown;
  allocation?: unknown;
}): MembershipRefusal | MembershipDecision {
  const { project, candidate, scopeTenantIds, existing } = input;

  if (CLOSED_STATUSES.includes(project.status)) {
    return {
      ok: false,
      status: 409,
      code: 'PROJECT_CLOSED',
      message: `This engagement is ${project.status.toLowerCase()}. Its team is part of the record `
        + 'of what happened and is not changed afterwards.',
    };
  }

  if (!candidate) {
    return {
      ok: false,
      status: 404,
      code: 'USER_NOT_FOUND',
      message: 'That person was not found, or is outside your scope.',
    };
  }

  // A person can only be put on an engagement that their organisation is
  // actually part of — the client side or, on consultant-led work, the
  // provider. Otherwise a project becomes a route to naming someone from an
  // unrelated customer as accountable for work they cannot see.
  const belongs = candidate.tenantId === project.tenantId
    || (project.providerTenantId !== null && candidate.tenantId === project.providerTenantId);
  if (!belongs) {
    return {
      ok: false,
      status: 403,
      code: 'NOT_ON_THIS_ENGAGEMENT',
      message: `${candidate.name} belongs to an organisation that is not part of this engagement. `
        + 'Only the client and, where there is one, the delivery provider can staff it.',
    };
  }

  // And the caller has to be able to write to that organisation.
  if (!scopeTenantIds.includes(candidate.tenantId)) {
    return {
      ok: false,
      status: 403,
      code: 'OUT_OF_SCOPE',
      message: 'That person is outside your scope.',
    };
  }

  const already = existing.find((m) => m.userId === candidate.id && m.active);
  if (already) {
    return {
      ok: false,
      status: 409,
      code: 'ALREADY_A_MEMBER',
      message: `${candidate.name} is already on this engagement as ${already.roleLabel}.`,
    };
  }

  const side = String(input.side || 'Client');
  if (!(SIDES as readonly string[]).includes(side)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_SIDE',
      message: `Side must be one of: ${SIDES.join(', ')}.`,
    };
  }
  // Provider only means something when there is a provider.
  if (side === 'Provider' && project.providerTenantId === null) {
    return {
      ok: false,
      status: 400,
      code: 'NO_PROVIDER',
      message: 'This engagement has no delivery provider, so everybody on it is on the client side.',
    };
  }

  const raci = String(input.raci || 'R');
  if (!(RACI as readonly string[]).includes(raci)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_RACI',
      message: `RACI must be one of: ${RACI.join(', ')}.`,
    };
  }

  const roleLabel = String(input.roleLabel || '').trim();
  if (!roleLabel) {
    return {
      ok: false,
      status: 400,
      code: 'ROLE_REQUIRED',
      message: 'Say what this person does on the engagement — "Lead Consultant", "ISMS Manager". '
        + 'A team list of names without roles cannot be read by anybody who was not there.',
    };
  }

  const allocation = validAllocation(input.allocation);
  if (allocation === 'invalid') {
    return {
      ok: false,
      status: 400,
      code: 'BAD_ALLOCATION',
      message: 'Allocation is a whole percentage between 0 and 100, or blank where the '
        + 'organisation does not track it.',
    };
  }

  return { ok: true, side, roleLabel, raci, allocation };
}

/**
 * Whether this person may be taken off the engagement.
 *
 * The one that matters: the owner and the manager are on the team by
 * definition — createProject puts them there for that reason — so removing
 * either leaves an engagement accountable to nobody, and the product has no
 * other way to name a replacement. They go when the project record says they
 * have gone, not from the team list.
 */
export function planMemberRemove(input: {
  project: ProjectFacts;
  member: MemberRow | null;
}): MembershipRefusal | { ok: true } {
  const { project, member } = input;

  if (CLOSED_STATUSES.includes(project.status)) {
    return {
      ok: false,
      status: 409,
      code: 'PROJECT_CLOSED',
      message: `This engagement is ${project.status.toLowerCase()}. Who was on it is part of the `
        + 'record of what happened.',
    };
  }

  if (!member || !member.active) {
    return {
      ok: false,
      status: 404,
      code: 'NOT_A_MEMBER',
      message: 'That person is not on this engagement.',
    };
  }

  if (member.userId === project.ownerId || member.userId === project.managerId) {
    const which = member.userId === project.ownerId ? 'owner' : 'manager';
    return {
      ok: false,
      status: 409,
      code: 'ACCOUNTABLE_MEMBER',
      message: `${member.userName} is the engagement's ${which}, so they are on the team by `
        + `definition. Change the ${which} on the engagement itself, and the team follows.`,
    };
  }

  return { ok: true };
}

export interface Commitment {
  userId: string;
  userName: string;
  /** Active memberships, newest first is the caller's business. */
  projects: { projectId: string; projectRef: string; projectName: string; roleLabel: string; raci: string; allocation: number | null }[];
  /** Sum of stated allocations. Null when nobody stated any. */
  totalAllocation: number | null;
  /** True only when allocations were stated AND they exceed a full person. */
  overCommitted: boolean;
  /** How many of their engagements state no allocation at all. */
  unstated: number;
}

/**
 * What each person is committed to, across every engagement.
 *
 * "One person works on different projects" — the owner's words — and until now
 * nothing could answer it, despite the schema carrying an index built for the
 * question.
 *
 * Over-committed is deliberately conservative. It is true only when somebody
 * has actually stated the allocations and they add up past one person; a
 * project with no stated allocation contributes nothing and is counted
 * separately, because treating unstated as zero would report a full-time
 * person as free.
 */
export function commitments(rows: readonly {
  userId: string;
  userName: string;
  projectId: string;
  projectRef: string;
  projectName: string;
  roleLabel: string;
  raci: string;
  allocation: number | null;
}[]): Commitment[] {
  const by = new Map<string, Commitment>();

  for (const r of rows) {
    if (!by.has(r.userId)) {
      by.set(r.userId, {
        userId: r.userId,
        userName: r.userName,
        projects: [],
        totalAllocation: null,
        overCommitted: false,
        unstated: 0,
      });
    }
    const c = by.get(r.userId)!;
    c.projects.push({
      projectId: r.projectId,
      projectRef: r.projectRef,
      projectName: r.projectName,
      roleLabel: r.roleLabel,
      raci: r.raci,
      allocation: r.allocation,
    });
    if (r.allocation === null || r.allocation === undefined) c.unstated += 1;
    else c.totalAllocation = (c.totalAllocation ?? 0) + r.allocation;
  }

  for (const c of by.values()) {
    c.overCommitted = c.totalAllocation !== null && c.totalAllocation > 100;
  }

  return [...by.values()].sort((a, b) => {
    // Over-committed first, then by how much is on them, then by name so the
    // order is stable rather than whatever the database returned.
    if (a.overCommitted !== b.overCommitted) return a.overCommitted ? -1 : 1;
    const at = a.totalAllocation ?? -1;
    const bt = b.totalAllocation ?? -1;
    if (at !== bt) return bt - at;
    if (a.projects.length !== b.projects.length) return b.projects.length - a.projects.length;
    return a.userName.localeCompare(b.userName);
  });
}
