/**
 * Publishing a document to somebody in particular.
 *
 * The premise that "Publish was never built" is wrong, and saying so precisely
 * matters. publishDocument exists, guards APPROVED, writes the status inside a
 * transaction and audits it, and the route is registered behind
 * CAP.SIGN_DOCUMENT. What it lacks is a caller: no screen in the product posts
 * to it, so through the interface a document reaches APPROVED and stops. The
 * approval handler even answers "Document fully approved and ready for
 * publication" to a client that has no control which performs it.
 *
 * What was genuinely missing is everything publication is FOR.
 *
 * There was no audience. Document carried no column naming a recipient set, and
 * no join table, role list or team existed to point at. The only thing that
 * executed as an audience was a denominator: getAcknowledgements divided
 * signatures by `user.count({ tenantId, status: 'Active' })`, so the completion
 * rate was a fraction of everybody, asserted at the call site and chosen by
 * nobody. The same assumption is made again, independently, in getDocumentStats.
 *
 * Nothing was raised. Publishing flipped a status and wrote an audit row.
 * Acknowledgement rows appear only when a person clicks a button, so the module
 * could report who had signed and could never name who had not -- which is the
 * only question an acknowledgement tracker exists to answer.
 *
 * And nobody was told. documentController imports no notification service at
 * all; a published policy reached its readers only if they happened to open the
 * screen unprompted.
 *
 * Pure, and with no Prisma import, so every rule runs without a database.
 */

/** How a recipient set is expressed. */
export const AUDIENCE_KINDS = ['Everyone', 'Department', 'Role'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

/**
 * A cap on one publication.
 *
 * Not a performance limit -- a few thousand rows is nothing. It is a
 * blast-radius limit: a request that would ask ten thousand people to read a
 * policy is more likely to be a mistake than an intention, and the refusal
 * names the number so the operator can decide deliberately.
 */
export const MAX_AUDIENCE = 2000;

export interface AudienceUser {
  id: string;
  name: string;
  /** Active | Suspended | ... — only active people are asked. */
  status: string;
  department: string | null;
  role: string | null;
}

export interface PublicationRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface PublicationDecision {
  ok: true;
  kind: AudienceKind;
  value: string | null;
  /** The people to ask, resolved. */
  recipientIds: string[];
  /** Shown before the act, not after it. */
  warnings: string[];
}

export interface DocumentFacts {
  status: string;
  version: string;
  publishedVersion: string | null;
}

/**
 * Whether this document can be published, to whom, and what the publisher
 * should be told first.
 *
 * Refusals in the order of how badly each would go wrong.
 */
export function planPublication(input: {
  document: DocumentFacts;
  kind: unknown;
  value: unknown;
  /** Everyone in the tenant, as loaded. The caller does the query. */
  users: readonly AudienceUser[];
  /** Ids that already hold a request for this version, so a re-publish is quiet. */
  alreadyAsked: readonly string[];
}): PublicationRefusal | PublicationDecision {
  const doc = input.document;

  if (doc.status !== 'APPROVED') {
    return {
      ok: false,
      status: 400,
      code: 'NOT_APPROVED',
      message: `This document is ${doc.status}. Only an approved document can be published — `
        + 'publishing is what makes it the live version people are asked to read.',
    };
  }

  const kind = String(input.kind ?? '').trim();
  if (!(AUDIENCE_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      status: 400,
      code: 'AUDIENCE_REQUIRED',
      message: `Say who this is being issued to: ${AUDIENCE_KINDS.join(', ')}. Publishing to `
        + 'nobody in particular is how a policy goes live that nobody is ever asked to read.',
    };
  }
  const audienceKind = kind as AudienceKind;

  const value = String(input.value ?? '').trim();
  if (audienceKind !== 'Everyone' && value === '') {
    return {
      ok: false,
      status: 400,
      code: 'AUDIENCE_VALUE_REQUIRED',
      message: `Name the ${audienceKind.toLowerCase()} this is being issued to.`,
    };
  }

  // Only people who can sign in are asked. A suspended account cannot
  // acknowledge anything, and counting it would make the coverage figure
  // permanently unreachable.
  const active = input.users.filter((u) => u.status === 'Active');

  const matched = audienceKind === 'Everyone'
    ? active
    : active.filter((u) => {
      const field = audienceKind === 'Department' ? u.department : u.role;
      return String(field ?? '').trim().toLowerCase() === value.toLowerCase();
    });

  if (matched.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'AUDIENCE_EMPTY',
      message: audienceKind === 'Everyone'
        ? 'This organisation has nobody active to issue the document to.'
        : `No active person is in ${audienceKind === 'Department' ? 'the' : 'the'} `
          + `${audienceKind.toLowerCase()} "${value}", so publishing to it would ask nobody `
          + 'to read this and report full coverage of an empty set.',
    };
  }

  if (matched.length > MAX_AUDIENCE) {
    return {
      ok: false,
      status: 400,
      code: 'AUDIENCE_TOO_LARGE',
      message: `That audience is ${matched.length} people, over the limit of ${MAX_AUDIENCE}. `
        + 'Issue it to a narrower audience, or raise the limit deliberately.',
    };
  }

  const asked = new Set(input.alreadyAsked.map(String));
  const fresh = matched.filter((u) => !asked.has(u.id));

  const warnings: string[] = [];

  if (fresh.length === 0) {
    warnings.push(
      'Everyone in this audience has already been asked to acknowledge this version. '
      + 'Publishing again changes nothing for them.',
    );
  } else if (asked.size > 0) {
    warnings.push(
      `${asked.size} of them were already asked and will not be asked twice.`,
    );
  }

  // The version people are asked to read is the one that was approved. If the
  // document has moved on since, that is worth knowing before it goes out.
  if (doc.publishedVersion && doc.publishedVersion !== doc.version) {
    warnings.push(
      `Version ${doc.publishedVersion} was published before. This issues ${doc.version}, and `
      + 'anyone who acknowledged the earlier one is asked again — a signature is against the '
      + 'version that was read.',
    );
  }

  return {
    ok: true,
    kind: audienceKind,
    value: audienceKind === 'Everyone' ? null : value,
    recipientIds: fresh.map((u) => u.id),
    warnings,
  };
}

// ─── What the tracker may state ─────────────────────────────────────────────

export interface Coverage {
  /** People asked. Null when nobody has been. */
  requested: number;
  signed: number;
  outstanding: number;
  /**
   * Percent signed, or null when nothing was asked.
   *
   * Null rather than zero or a hundred: with no audience there is no fraction,
   * and both of those numbers read as a finding. The previous figure divided by
   * every active user in the tenant, which meant a policy issued to the finance
   * team reported as 4% read.
   */
  percent: number | null;
  /** Why no figure, in the reader's words. Null when the figure stands. */
  caveat: string | null;
}

export function coverage(input: {
  requested: number;
  signed: number;
  /** True once the document has actually been published. */
  published: boolean;
}): Coverage {
  const requested = Math.max(0, input.requested);
  const signed = Math.min(Math.max(0, input.signed), requested);

  if (!input.published) {
    return {
      requested: 0,
      signed: 0,
      outstanding: 0,
      percent: null,
      caveat: 'This document has not been published, so nobody has been asked to acknowledge '
        + 'it. There is nothing to report coverage against.',
    };
  }

  if (requested === 0) {
    return {
      requested: 0,
      signed,
      outstanding: 0,
      percent: null,
      caveat: 'This document was published before an audience was recorded, so there is no set '
        + 'of people to measure against. Publish it again to issue it to a named audience.',
    };
  }

  return {
    requested,
    signed,
    outstanding: requested - signed,
    percent: Math.round((signed / requested) * 100),
    caveat: null,
  };
}
