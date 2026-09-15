/**
 * Which frameworks an engagement is actually being run against.
 *
 * Project.frameworks is a JSON array of free text: ["ISO27001"]. "ISO 27001",
 * "iso27001" and a typo are three different values, none of them resolves to a
 * Standard row, and nothing downstream can follow one to a clause. So the
 * sentence the product is for — "we enable the standard which they required"
 * and the plan is built against it — had no representation the database could
 * answer a question about.
 *
 * The damage was not confined to display. The certification-readiness report
 * worked out which standards an engagement was in scope for by reading the
 * clause links its own tasks already held:
 *
 *     const standardIds = [...new Set(
 *       tasks.flatMap((t) => t.clauseLinks.map((l) => l.clause.standard.id)),
 *     )];
 *
 * The denominator was built from the numerator. A project with no clause links
 * named no standards, so it had no clauses in scope, so it had no gaps — and
 * the readiness paper printed "Clauses in scope with no task at all: 0" for the
 * engagement that had mapped nothing at all. A second framework named in
 * `frameworks` but never mapped disappeared from the report entirely. That
 * document goes to a certification body.
 *
 * ProjectStandard binds a project to Standard rows. The binding is the
 * denominator; the links are the numerator; and where there is no binding the
 * report says so rather than reporting zero.
 *
 * Pure, and with no Prisma import, so every refusal runs without a database.
 */

/**
 * A cap, not a limit anybody will reach. An engagement genuinely run against
 * twenty-five frameworks is not a project, and the number exists so a
 * malformed request cannot ask the database for an unbounded IN clause.
 */
export const MAX_STANDARDS = 25;

export interface StandardCandidate {
  id: string;
  code: string;
  title: string;
  /** Null for a platform standard, available to every tenant. */
  tenantId: string | null;
  /** Whether the engagement's CLIENT tenant has enabled it. */
  enabled: boolean;
  /**
   * Full | Partial | Not applicable, from the enablement row. Null when the
   * standard is not enabled at all, where `enabled` is the refusal that fires.
   */
  applicability: string | null;
}

export interface StandardsRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface StandardsDecision {
  ok: true;
  /** Ids to bind that are not bound yet. */
  add: string[];
  /** Ids bound today that the caller has left out. */
  remove: string[];
  /** Ids bound today that the caller kept. */
  keep: string[];
}

/**
 * What this engagement should be bound to, given what the caller asked for.
 *
 * Refusals are ordered by how badly each would go wrong if allowed. The last
 * one is the one worth reading twice: unbinding a standard whose clauses this
 * project's tasks still point at would leave those links dangling outside the
 * engagement's declared scope, and the readiness report would then count
 * clauses of a framework the project claims not to be running against.
 */
export function planStandardBinding(input: {
  /** The engagement's client tenant — whose enablements and private frameworks count. */
  projectTenantId: string;
  /** Standards the caller named, in request order. Duplicates are tolerated. */
  requested: readonly string[];
  /** The rows that were found for those ids. A missing id is simply absent. */
  found: readonly StandardCandidate[];
  /** What the project is bound to today. */
  bound: readonly string[];
  /**
   * Standard ids this project's tasks already hold clause links into. Removing
   * one of these is refused rather than cascading.
   */
  inUse: readonly string[];
}): StandardsRefusal | StandardsDecision {
  // Order-preserving dedupe: asking for the same framework twice is a client
  // quirk, not an error worth a 400.
  const wanted: string[] = [];
  for (const raw of input.requested) {
    const id = String(raw || '').trim();
    if (id && !wanted.includes(id)) wanted.push(id);
  }

  if (wanted.length > MAX_STANDARDS) {
    return {
      ok: false,
      status: 400,
      code: 'TOO_MANY_STANDARDS',
      message: `An engagement can be bound to at most ${MAX_STANDARDS} frameworks; `
        + `${wanted.length} were named.`,
    };
  }

  const byId = new Map(input.found.map((s) => [s.id, s]));

  const missing = wanted.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'STANDARD_NOT_FOUND',
      message: `${missing.length} of the frameworks named do not exist.`,
    };
  }

  // A private framework belongs to the organisation that authored it. Binding
  // an engagement to somebody else's would let its clause text be read through
  // this project's screens by anyone who can see the engagement — including,
  // on consultant-led work, the delivery partner.
  const foreign = wanted
    .map((id) => byId.get(id)!)
    .filter((s) => s.tenantId !== null && s.tenantId !== input.projectTenantId);
  if (foreign.length > 0) {
    return {
      ok: false,
      status: 403,
      code: 'STANDARD_OUT_OF_SCOPE',
      message: 'You cannot run this engagement against another organisation\'s private '
        + `framework (${[...new Set(foreign.map((s) => s.code))].join(', ')}).`,
    };
  }

  // Enablement is the organisation's own statement that a framework applies to
  // it. Binding an engagement to a framework the client has not enabled would
  // make the project the back door around that decision, and the readiness
  // report would then measure them against something nobody adopted.
  const notEnabled = wanted.map((id) => byId.get(id)!).filter((s) => !s.enabled);
  if (notEnabled.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'STANDARD_NOT_ENABLED',
      message: `${[...new Set(notEnabled.map((s) => s.code))].join(', ')} `
        + `${notEnabled.length === 1 ? 'is' : 'are'} not enabled for this organisation. `
        + 'Enable the framework under Organization Standards first — an engagement cannot '
        + 'adopt a framework on the organisation\'s behalf.',
    };
  }

  // "Not applicable" is the organisation's recorded judgement that a framework
  // does not apply to it. An engagement run against one would contradict the
  // statement of applicability the same organisation signs, and the readiness
  // report would measure them against clauses they have formally excluded.
  const excluded = wanted
    .map((id) => byId.get(id)!)
    .filter((s) => s.applicability === 'Not applicable');
  if (excluded.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'STANDARD_NOT_APPLICABLE',
      message: `${[...new Set(excluded.map((s) => s.code))].join(', ')} `
        + `${excluded.length === 1 ? 'is' : 'are'} marked "Not applicable" for this `
        + 'organisation. Change that under Organization Standards if the engagement really '
        + 'is being run against it — an engagement should not contradict the statement of '
        + 'applicability the organisation signs.',
    };
  }

  const bound = [...new Set(input.bound.map(String))];
  const remove = bound.filter((id) => !wanted.includes(id));

  const stillUsed = remove.filter((id) => input.inUse.includes(id));
  if (stillUsed.length > 0) {
    const names = stillUsed.map((id) => byId.get(id)?.code || id);
    return {
      ok: false,
      status: 409,
      code: 'STANDARD_IN_USE',
      message: `Tasks on this engagement are still mapped to clauses of ${names.join(', ')}. `
        + 'Unmap those tasks first. Removing the framework while the links remain would leave '
        + 'the readiness report counting clauses of a framework the engagement says it is not '
        + 'being run against.',
    };
  }

  return {
    ok: true,
    add: wanted.filter((id) => !bound.includes(id)),
    remove,
    keep: wanted.filter((id) => bound.includes(id)),
  };
}

// ─── What the readiness report is allowed to say ────────────────────────────

export interface ReadinessScope {
  /** The standards whose clauses form the denominator. */
  standardIds: string[];
  /**
   * Whether a gap count may be stated at all. False means the engagement has
   * not been bound to anything resolvable, so the number of clauses nothing
   * addresses is unknown — which is not the same as zero.
   */
  stated: boolean;
  /** Why not, in the report's own voice. Null when the figure stands. */
  caveat: string | null;
}

/**
 * Whether this engagement's coverage can be measured, and against what.
 *
 * The rule the build plan states for this document: never print a figure the
 * data cannot support. "No gaps" and "we have not looked" render identically
 * as a zero, and only one of them is a reason to go to certification.
 */
export function readinessScope(input: {
  /** Standards the engagement is bound to, from ProjectStandard. */
  boundStandardIds: readonly string[];
  /** The legacy free-text column, for engagements created before the binding. */
  legacyFrameworks: readonly string[];
}): ReadinessScope {
  const standardIds = [...new Set(input.boundStandardIds.map(String).filter(Boolean))];
  if (standardIds.length > 0) {
    return { standardIds, stated: true, caveat: null };
  }

  const legacy = input.legacyFrameworks.map((f) => String(f).trim()).filter(Boolean);
  if (legacy.length > 0) {
    return {
      standardIds: [],
      stated: false,
      caveat: `This engagement names ${legacy.join(', ')} as its frameworks, but as free text `
        + 'that does not resolve to a framework in the library. Coverage cannot be measured '
        + 'until the engagement is bound to the frameworks themselves, and this report states '
        + 'no readiness figure until it is.',
    };
  }

  return {
    standardIds: [],
    stated: false,
    caveat: 'This engagement is not bound to any framework, so there is no set of clauses to '
      + 'measure it against. Nothing here should be read as evidence of readiness — a gap '
      + 'count of zero would mean nothing has been looked at, not that nothing is missing.',
  };
}

/**
 * Clause ids a task may legitimately be mapped to.
 *
 * Narrower than "any clause the client tenant can see", which is what the link
 * endpoint accepted before an engagement could declare its own scope. Mapping
 * work to a clause of a framework this engagement is not being run against
 * puts a row in the traceability report that the denominator does not contain,
 * and a coverage figure whose numerator and denominator come from different
 * sets is worse than no figure.
 */
export function clausesInScope(input: {
  boundStandardIds: readonly string[];
  clauses: readonly { id: string; standardId: string; code: string; ref: string }[];
}): { allowed: string[]; rejected: { code: string; ref: string }[] } {
  const bound = new Set(input.boundStandardIds.map(String));
  const allowed: string[] = [];
  const rejected: { code: string; ref: string }[] = [];
  for (const c of input.clauses) {
    if (bound.has(c.standardId)) allowed.push(c.id);
    else rejected.push({ code: c.code, ref: c.ref });
  }
  return { allowed, rejected };
}
