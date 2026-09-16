/**
 * What a policy governs.
 *
 * Linking a document to the control it mandates, the risk it treats or the
 * framework clause it satisfies is the most GRC-specific thing the brief asks
 * for, and it had no representation anywhere: five foreign keys pointed at the
 * Document table and none of them came from Control, Risk, StandardClause,
 * ControlImplementation, Issue, Audit, Asset or Vendor. Risk carries a comment
 * block headed "the linkage spine" and had no document vertebra.
 *
 * The gap was advertised rather than silent, which is worse. The user guide
 * told people to "always include framework mappings (e.g. ISO 27001, NCA ECC)
 * in the document metadata", and listed "map relevant regulatory standard
 * clauses" as phase one of the documented Document Governance Lifecycle. There
 * was no metadata field and no such step; the only place a clause could be
 * written was the free-prose body, whose own placeholder invites it. A person
 * following the documented procedure reached phase one and found it impossible.
 *
 * Two house rules this follows deliberately, because the codebase is split on
 * both and one side of each is the better precedent:
 *
 *   An id that does not resolve is a 400 naming it, the way linkClauses does --
 *   not a silent drop followed by a success count, the way setRiskControls and
 *   setServiceControls do. A caller told "3 controls linked" when they asked
 *   for five has no way to discover the other two.
 *
 *   A private framework belongs to the organisation that authored it, checked
 *   the same way projectStandards checks it. A platform standard (tenantId
 *   null) is available to everyone.
 *
 * Pure, and with no Prisma import, so every refusal runs without a database.
 */

/** What a document can be linked to. */
export const LINK_TARGETS = ['control', 'risk', 'clause'] as const;
export type LinkTarget = (typeof LINK_TARGETS)[number];

/**
 * A cap per request. Not a performance limit -- it is a blast-radius limit, and
 * the refusal names the number so the caller can split it deliberately.
 */
export const MAX_LINKS_PER_CALL = 100;

export interface LinkCandidate {
  id: string;
  /** Shown in refusals so a person can act on them: "A.5.1", "CTRL-014". */
  label: string;
  /**
   * The organisation that owns it. Null means a platform-wide library row,
   * available to every tenant -- which is how a shared control and a published
   * framework both behave.
   */
  tenantId: string | null;
}

export interface LinkRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface LinkDecision {
  ok: true;
  target: LinkTarget;
  /** Ids to link that are not linked yet. */
  add: string[];
  /** Ids that were asked for and are already linked. */
  alreadyLinked: string[];
  warnings: string[];
}

const HUMAN: Record<LinkTarget, string> = {
  control: 'control',
  risk: 'risk',
  clause: 'framework clause',
};

/**
 * Whether these targets may be linked to this document.
 *
 * Refusals in the order of how badly each would go wrong.
 */
export function planDocumentLinks(input: {
  /** The organisation that owns the document. */
  documentTenantId: string;
  /** Document status, so a frozen record cannot gain new claims. */
  documentStatus: string;
  target: unknown;
  /** Ids the caller asked for, in request order. Duplicates are tolerated. */
  requested: readonly string[];
  /** Rows found for those ids. A missing id is simply absent. */
  found: readonly LinkCandidate[];
  /** What this document already links to, for this target kind. */
  existing: readonly string[];
}): LinkRefusal | LinkDecision {
  const target = String(input.target ?? '').trim();
  if (!(LINK_TARGETS as readonly string[]).includes(target)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_LINK_TARGET',
      message: `A document can be linked to one of: ${LINK_TARGETS.join(', ')}.`,
    };
  }
  const kind = target as LinkTarget;

  if (input.documentStatus === 'ARCHIVED') {
    return {
      ok: false,
      status: 409,
      code: 'DOCUMENT_ARCHIVED',
      message: 'This document is archived. An archived policy is a record of what applied, and '
        + 'adding to what it claims to govern would rewrite that record.',
    };
  }

  // Order-preserving dedupe: asking for the same control twice is a client
  // quirk, not an error worth a 400.
  const wanted: string[] = [];
  for (const raw of input.requested) {
    const id = String(raw || '').trim();
    if (id && !wanted.includes(id)) wanted.push(id);
  }

  if (wanted.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'NOTHING_TO_LINK',
      message: `Name at least one ${HUMAN[kind]} to link.`,
    };
  }

  if (wanted.length > MAX_LINKS_PER_CALL) {
    return {
      ok: false,
      status: 400,
      code: 'TOO_MANY_LINKS',
      message: `At most ${MAX_LINKS_PER_CALL} can be linked in one request; `
        + `${wanted.length} were named.`,
    };
  }

  const byId = new Map(input.found.map((c) => [c.id, c]));

  const missing = wanted.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'LINK_TARGET_NOT_FOUND',
      message: `${missing.length} of the ${HUMAN[kind]}s named do not exist. Nothing was `
        + 'linked — a request that silently drops what it cannot resolve leaves the caller '
        + 'believing a link was made.',
    };
  }

  // A private row belongs to the organisation that authored it. Linking across
  // would let one tenant's policy claim to govern another's control, and would
  // disclose that control's existence through this document's own screens.
  const foreign = wanted
    .map((id) => byId.get(id)!)
    .filter((c) => c.tenantId !== null && c.tenantId !== input.documentTenantId);
  if (foreign.length > 0) {
    return {
      ok: false,
      status: 403,
      code: 'LINK_TARGET_OUT_OF_SCOPE',
      message: `${[...new Set(foreign.map((c) => c.label))].join(', ')} `
        + `${foreign.length === 1 ? 'belongs' : 'belong'} to another organisation. A policy can `
        + 'only govern something its own organisation holds, or a platform-wide library entry.',
    };
  }

  const already = [...new Set(input.existing.map(String))];
  const add = wanted.filter((id) => !already.includes(id));
  const alreadyLinked = wanted.filter((id) => already.includes(id));

  const warnings: string[] = [];
  if (add.length === 0) {
    warnings.push(
      `Every ${HUMAN[kind]} named is already linked to this document. Nothing changed.`,
    );
  } else if (alreadyLinked.length > 0) {
    warnings.push(
      `${alreadyLinked.length} of them ${alreadyLinked.length === 1 ? 'was' : 'were'} already `
      + 'linked and will not be linked twice.',
    );
  }

  return { ok: true, target: kind, add, alreadyLinked, warnings };
}

// ─── What the linkage actually says ─────────────────────────────────────────

export interface LinkageSummary {
  controls: number;
  risks: number;
  clauses: number;
  total: number;
  /**
   * Whether this document claims to govern anything at all.
   *
   * Said rather than derived from a zero, because a policy governing nothing is
   * a normal early state and a policy that SHOULD govern something and does not
   * is a gap — and a bare "0" does not distinguish a template from an
   * unmapped security policy.
   */
  claimsNothing: boolean;
}

export function summariseLinks(links: readonly {
  controlId?: string | null;
  riskId?: string | null;
  clauseId?: string | null;
}[]): LinkageSummary {
  const controls = links.filter((l) => l.controlId).length;
  const risks = links.filter((l) => l.riskId).length;
  const clauses = links.filter((l) => l.clauseId).length;
  return {
    controls,
    risks,
    clauses,
    total: controls + risks + clauses,
    claimsNothing: controls + risks + clauses === 0,
  };
}

/**
 * Which column a link row sets, derived from the row itself.
 *
 * Exactly one of the three is non-null by construction, and reading it back
 * this way means a renderer never has to guess from which field happens to be
 * present.
 */
export function targetOf(link: {
  controlId?: string | null;
  riskId?: string | null;
  clauseId?: string | null;
}): LinkTarget | null {
  if (link.controlId) return 'control';
  if (link.riskId) return 'risk';
  if (link.clauseId) return 'clause';
  return null;
}
