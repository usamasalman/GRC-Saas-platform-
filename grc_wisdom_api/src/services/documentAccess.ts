/**
 * Who may read a document, and the record that they did.
 *
 * `Document.classification` held one of four words on every row and nothing
 * anywhere branched on it. It was a caller-supplied FILTER in listDocuments
 * (`if (classification) where.classification = classification` — passing
 * `?classification=Restricted` SELECTED the restricted ones), a stored string,
 * and a line printed into the export banner above the footer that reads
 * "END OF DOCUMENT — CONFIDENTIAL GRC RECORD". The three read endpoints had
 * `{ tenantId }` as their entire access decision, so any tenant member could
 * open any document by id — a Restricted policy, or somebody else's unapproved
 * draft, together with every acknowledger's name and email.
 *
 * Nothing recorded the read either. Of 222 audit writes in the API, four are
 * read-shaped and none is a document; `getDocument` and `downloadDocument`
 * open no transaction at all. "Who read this Restricted policy" had no query
 * behind it because there were no rows to find.
 *
 * ── Clearance is a relationship here, not an attribute ──────────────────────
 *
 * There is no clearance field on User, Role or Capability, and adding one is
 * the obvious move that breaks a live system: a column nobody has set yet
 * defaults either to "everyone is cleared" (a no-op that only looks like a
 * control) or to "nobody is cleared" (every Restricted document goes dark
 * overnight, including for its own author). Both are worse than what is here.
 *
 * So reach is computed from the records that already name a person — owner,
 * assigned approver, published audience — plus the records-management tier.
 * Need-to-know, expressed by the relationships the document already has. It
 * needs no new field, no admin screen, and no default that can lock a tenant
 * out of its own library.
 *
 * ── The ordering is the one that already exists ─────────────────────────────
 *
 * REPORT_MARKINGS in tenantBranding ranks these exact four words and is
 * already load-bearing (effectiveMarking refuses to downgrade an export's
 * marking). Its own comment says it "matches the classification vocabulary the
 * document and evidence modules already use". Defining a second ranking here
 * would be the third one in the codebase and the first to disagree with the
 * others, so this imports it. That module is pure, so this one stays pure.
 *
 * Pure, and with no Prisma import, so every refusal runs without a database.
 */

import {
  REPORT_MARKINGS,
  normaliseMarking,
  type ReportMarking,
} from './tenantBranding';

/** Public | Internal | Confidential | Restricted, least to most restricted. */
export const CLASSIFICATIONS = REPORT_MARKINGS;
export type Classification = ReportMarking;

/**
 * The word to show for a stored value.
 *
 * Named for this module's subject rather than re-used under the report's name,
 * so a reader of the document code is not sent to a reporting module to learn
 * what a classification is.
 */
export const normaliseClassification = normaliseMarking;

/**
 * Rank, as position in the shared vocabulary.
 *
 * An unrecognised word is not an error: `classification` is a bare String with
 * no database default, and two seed files write "Internal" while nothing
 * validates the column. normaliseMarking maps anything unknown to
 * "Confidential", which under the rules below means "somebody must be named" —
 * the safe direction, and the one that keeps a typo from publishing a document
 * to the whole organisation.
 */
export function classificationRank(value: string | null | undefined): number {
  return (CLASSIFICATIONS as readonly string[]).indexOf(normaliseMarking(value));
}

/**
 * The rank at which tenant membership stops being enough.
 *
 * Public and Internal stay readable by the organisation, which is what they
 * mean and what they did yesterday. Confidential and above need a reason.
 */
export const NEED_TO_KNOW_FROM: Classification = 'Confidential';

/** Statuses in which a document is still the author's working copy. */
export const UNISSUED_STATUSES = ['DRAFT', 'RETURNED'] as const;

/**
 * Why a reader was let in. Recorded on the access row, so the history says not
 * only who read a document but what entitled them to.
 */
export const READ_BASES = [
  'owner',
  'approver',
  'governance',
  'audience',
  'tenant',
  'legacy-publication',
] as const;
export type ReadBasis = (typeof READ_BASES)[number];

export interface ReadViewer {
  id: string;
  tenantId: string;
  /** Effective capability keys. Empty is a legitimate value, not a bug. */
  capabilities: readonly string[];
}

export interface ReadSubject {
  id: string;
  tenantId: string;
  ownerId: string;
  status: string;
  classification: string | null;
  /** Approvers assigned to this document, at any queue status. */
  approverIds: readonly string[];
  /**
   * Whether this person was issued the document at publication — an
   * AcknowledgementRequest row naming them, for any published version.
   */
  inAudience: boolean;
  /**
   * The audience recorded at publication, if any.
   *
   * Deliberately no publishedAt here. It is null on every row published before
   * migration 20260916000000, which is exactly the population the legacy rule
   * below protects, so a decision that consulted it would be wrong precisely
   * where it matters. Status is the column that has always been written.
   */
  audienceKind: string | null;
}

export interface ReadVerdict {
  allowed: boolean;
  basis: ReadBasis | null;
  /**
   * Why, in words. Never returned to a refused caller — a refusal that
   * explains itself confirms the document exists, which is the one thing an
   * invisible document must not do. Recorded, and shown to people who are let
   * in, so a compliance manager reading the access history can see it.
   */
  reason: string;
}

/**
 * The capability that sees everything.
 *
 * Deliberately the narrowest document capability, not the broadest. Three
 * roles hold apply-retention-and-legal-hold — compliance-manager,
 * compliance-approver, group-compliance-manager — and its own operations
 * (legal hold, force-release) already presuppose sight of the document. The
 * authoring capability is held by eleven roles including client-contributor
 * and vendor-owner; granting those sight of every Restricted policy would make
 * the classification decorative again.
 */
export const READ_EVERYTHING = 'apply-retention-and-legal-hold';

/**
 * May this person read this document?
 *
 * Ordered so the cheapest and most certain answers come first, and so that a
 * person never loses their own document to a rule about somebody else's.
 */
export function readDecision(viewer: ReadViewer, doc: ReadSubject): ReadVerdict {
  // Another organisation's record. The Prisma where-clause already prevents
  // this; stated here so the rule is one a test can hold, rather than a
  // property of whichever query happens to be written next.
  if (doc.tenantId !== viewer.tenantId) {
    return { allowed: false, basis: null, reason: 'Belongs to another organisation.' };
  }

  if (doc.ownerId === viewer.id) {
    return { allowed: true, basis: 'owner', reason: 'Owns this document.' };
  }

  if (doc.approverIds.includes(viewer.id)) {
    return {
      allowed: true,
      basis: 'approver',
      reason: 'Assigned to approve this document.',
    };
  }

  if (viewer.capabilities.includes(READ_EVERYTHING)) {
    return {
      allowed: true,
      basis: 'governance',
      reason: 'Holds retention and legal hold, which governs the whole library.',
    };
  }

  // An unapproved draft is the author's working copy, whatever it is marked.
  // Reading somebody's half-written policy and acting on it is the failure
  // this prevents; classification does not come into it.
  if ((UNISSUED_STATUSES as readonly string[]).includes(doc.status)) {
    return {
      allowed: false,
      basis: null,
      reason: 'Still being written, and not yet submitted for approval.',
    };
  }

  if (classificationRank(doc.classification) < classificationRank(NEED_TO_KNOW_FROM)) {
    return {
      allowed: true,
      basis: 'tenant',
      reason: `Marked ${normaliseMarking(doc.classification)}, which the organisation may read.`,
    };
  }

  if (doc.inAudience) {
    return {
      allowed: true,
      basis: 'audience',
      reason: 'Was issued this document when it was published.',
    };
  }

  // Published before anyone recorded an audience.
  //
  // Publishing wrote one status string until audiences existed, so live
  // tenants hold PUBLISHED documents with no audienceKind and no
  // AcknowledgementRequest rows. Under the old code every one of them was
  // readable by the whole organisation. Treating that absence as "nobody" would
  // take away access that people have today, on a rule they were never told
  // about, and the first sign of it would be a policy nobody can open.
  //
  // So the old reach is preserved and named. It is reported as a gap rather
  // than hidden: openAudienceGap below is what a compliance manager sees, and
  // publishing again records an audience and ends this basis for that document.
  //
  // Keyed on STATUS, not on publishedAt. publishedAt was added by migration
  // 20260916000000 as a nullable column with no backfill, and publishDocument
  // is its only writer -- so it is null on precisely the rows this clause
  // exists to protect. Keying on it inverted the rule: every policy a live
  // tenant published before that migration and marked Confidential or above
  // would have gone dark for the whole organisation on deploy, silently, and
  // openAudienceGap would not even have reported it. `status` has been on the
  // table since the beginning.
  if (doc.status === 'PUBLISHED' && !doc.audienceKind) {
    return {
      allowed: true,
      basis: 'legacy-publication',
      reason: 'Published before audiences were recorded, so its reach is still everyone.',
    };
  }

  return {
    allowed: false,
    basis: null,
    reason: `Marked ${normaliseMarking(doc.classification)} and issued to named people, `
      + 'who do not include this reader.',
  };
}

/**
 * Whether a document is readable by the whole organisation only because
 * nobody recorded who it was published to.
 *
 * Said separately from the verdict because it is a finding, not a decision: it
 * is the list of documents whose marking is not yet doing anything.
 */
export function openAudienceGap(doc: {
  status: string;
  classification: string | null;
  audienceKind: string | null;
}): boolean {
  return doc.status === 'PUBLISHED'
    && !doc.audienceKind
    && classificationRank(doc.classification) >= classificationRank(NEED_TO_KNOW_FROM);
}

// ─── Recording the read ─────────────────────────────────────────────────────

/**
 * How reads are recorded, and why not one audit row per request.
 *
 * The WORM chain cannot carry a row per GET, for four reasons that are all in
 * writeAudit rather than in theory:
 *
 *   Every append first reads the tenant's head with `orderBy timestamp desc`,
 *   and AuditLog has no index on (tenantId, timestamp). Reads would quickly be
 *   most of the table, so read auditing would slow down every OTHER audit
 *   write as well as itself.
 *
 *   The read-then-append is not serialized. writeAudit's own comment says so:
 *   in Postgres it needs a SERIALIZABLE tx or an advisory lock, and no call
 *   site takes one. Two concurrent appends share a previousHash and fork the
 *   chain. Concurrent writes are rare; concurrent reads are the normal case.
 *
 *   currentHash is @unique and is computed from previousHash, action, payload
 *   and an ISO-millisecond timestamp — not from the actor or the subject. Two
 *   identical reads in the same millisecond after the same head collide, and
 *   the unique constraint kills one transaction.
 *
 *   A failed audit fails the operation at 221 of 222 call sites. Opening a
 *   policy should not 500 because the log had a hiccup.
 *
 * So a read is recorded as a WINDOW: one row per person per document per UTC
 * day, in its own indexed table, with counters for repeats. That is the
 * complete, queryable history. A WORM entry is then written only when a window
 * OPENS and only for Confidential and above — at most one per person per
 * document per day, with the actor and the document in the payload, which
 * makes the collision above impossible by construction and keeps the chain
 * proportional to access that anybody would ask about.
 */
export const ACCESS_ACTION = 'DOCUMENT_ACCESSED';

/**
 * How the document was reached.
 *
 * PREVIEW is the reader pane, which fetches through the download endpoint.
 * It is a third kind rather than a VIEW because opening a document in the UI
 * calls getDocument AND then the preview, so counting the preview as a view
 * made every "Views" figure exactly twice the number of times the document
 * had been opened. A preview opens a window if none is open — so fetching it
 * directly is still recorded, and nothing delivers bytes unrecorded — but it
 * never increments a counter for a read already counted.
 */
export const ACCESS_VIA = ['VIEW', 'PREVIEW', 'DOWNLOAD'] as const;
export type AccessVia = (typeof ACCESS_VIA)[number];

const DATE_HEAD = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * The UTC calendar day a read falls in, as "YYYY-MM-DD".
 *
 * UTC parts, not a local midnight: the same read must land in the same window
 * whichever server handles it, and a local-midnight day number puts a 23:30
 * read in Riyadh on a different day from the row it should increment.
 */
export function accessDay(now: Date | string): string {
  const iso = now instanceof Date ? now.toISOString() : String(now);
  const parts = DATE_HEAD.exec(iso);
  if (parts) return `${parts[1]}-${parts[2]}-${parts[3]}`;
  const d = new Date(String(now));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Whether failing to record this read is a reason to refuse it.
 *
 * The split an auditor would draw. For an Internal document, losing a log line
 * is a nuisance and blocking the read would be worse. For a Confidential or
 * Restricted one, "we handed it over and cannot say to whom" is the exact
 * failure the record exists to prevent, so the read does not happen.
 */
export function recordingIsMandatory(classification: string | null | undefined): boolean {
  return classificationRank(classification) >= classificationRank(NEED_TO_KNOW_FROM);
}

/**
 * Whether opening this window belongs in the tamper-evident chain.
 *
 * Same threshold as above, said separately because they are different
 * questions and a later change to one should not silently move the other.
 */
export function chainWorthy(classification: string | null | undefined): boolean {
  return classificationRank(classification) >= classificationRank(NEED_TO_KNOW_FROM);
}

// ─── Reporting it back ──────────────────────────────────────────────────────

export interface AccessRow {
  userId: string;
  day: string;
  views: number;
  downloads: number;
  basis: string;
  firstAt: Date | string;
  lastAt: Date | string;
}

export interface AccessSummary {
  /** Distinct people who have opened it. */
  readers: number;
  /** Distinct person-days. */
  windows: number;
  views: number;
  downloads: number;
  /** People who downloaded the file, as opposed to only reading on screen. */
  downloaders: number;
  /**
   * Said rather than derived from a zero. A document nobody has opened and a
   * document whose reads were never recorded look identical in a count, and
   * only one of them is a finding.
   */
  neverOpened: boolean;
}

export function summariseAccess(rows: readonly AccessRow[]): AccessSummary {
  const readers = new Set<string>();
  const downloaders = new Set<string>();
  let views = 0;
  let downloads = 0;

  for (const r of rows) {
    readers.add(r.userId);
    views += Number(r.views) || 0;
    downloads += Number(r.downloads) || 0;
    if ((Number(r.downloads) || 0) > 0) downloaders.add(r.userId);
  }

  return {
    readers: readers.size,
    windows: rows.length,
    views,
    downloads,
    downloaders: downloaders.size,
    neverOpened: rows.length === 0,
  };
}
