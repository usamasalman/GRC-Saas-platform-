/**
 * A legal hold as a matter, not a string on a document.
 *
 * A hold was four columns -- legalHoldMatter, legalHoldReason, legalHoldBy,
 * legalHoldAt -- and the matter was free text typed per document. Three
 * consequences followed, and all three are what this packet is for:
 *
 *   One document could be held by ONE matter. applyLegalHold returns 409 if
 *   legalHoldAt is already set, so a document relevant to two investigations
 *   could only be recorded against one of them, and releasing that one
 *   unfroze it for the other.
 *
 *   There was no matter. "Ivanov v. Acme" typed on forty documents was forty
 *   strings, so nobody could ask what a matter covered, and a typo on the
 *   fortieth silently made it a different matter.
 *
 *   Releasing destroyed the history. releaseLegalHold nulls all four columns,
 *   so a released document carries no trace of having been held. The audit log
 *   keeps an entry, but the document cannot answer "were you ever frozen, for
 *   what, and between when and when" -- which is the question asked at the end
 *   of a matter, not during it.
 *
 * And none of the three endpoints had a caller. The Legal Hold menu entry
 * rendered AuditLogViewer, the same component 'retention' and 'logs' rendered.
 *
 * ── Document.legalHoldAt stays ──────────────────────────────────────────────
 *
 * Eight handlers refuse a frozen document by reading that one column:
 * update, checkout, checkin, submit, approve, publish, archive and delete.
 * Rewriting them to consult a join table would put eight enforcement sites at
 * risk to gain nothing, so the column stays as the frozen flag and becomes
 * derived: set when the first hold is placed, cleared only when the LAST one
 * is released. A document held by two matters stays frozen when one ends.
 *
 * Pure, and with no Prisma import, so every refusal runs without a database.
 */

export const MATTER_STATUSES = ['Open', 'Released'] as const;
export type MatterStatus = (typeof MATTER_STATUSES)[number];

/**
 * A cap per request. A blast-radius limit, not a performance one: placing a
 * hold freezes every document named against edits, approval, publication,
 * archiving and deletion, and a mis-aimed bulk action is the expensive
 * mistake here.
 */
export const MAX_DOCUMENTS_PER_ACTION = 500;

export interface HoldRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

// ─── The matter ─────────────────────────────────────────────────────────────

export interface MatterDecision {
  ok: true;
  reference: string;
  title: string;
}

export function planMatter(input: {
  reference: unknown;
  title: unknown;
  /** References already used in this tenant, excluding the one being edited. */
  takenReferences: readonly string[];
}): HoldRefusal | MatterDecision {
  const reference = String(input.reference ?? '').trim().toUpperCase();
  if (!reference) {
    return {
      ok: false,
      status: 400,
      code: 'MATTER_REFERENCE_REQUIRED',
      message: 'A matter needs a reference, such as LIT-2026-004. It is what the hold on each document points at.',
    };
  }
  if (reference.length > 64) {
    return { ok: false, status: 400, code: 'MATTER_REFERENCE_TOO_LONG', message: 'A matter reference is at most 64 characters.' };
  }
  if (input.takenReferences.map((r) => String(r).toUpperCase()).includes(reference)) {
    return {
      ok: false,
      status: 409,
      code: 'MATTER_REFERENCE_TAKEN',
      message: `A matter with reference ${reference} already exists. Hold the documents against that one rather than opening a second matter with the same name.`,
    };
  }

  const title = String(input.title ?? '').trim();
  if (title.length < 3) {
    return {
      ok: false,
      status: 400,
      code: 'MATTER_TITLE_REQUIRED',
      message: 'A matter needs a title somebody will recognise in a year.',
    };
  }

  return { ok: true, reference, title };
}

// ─── Placing a hold ─────────────────────────────────────────────────────────

export interface HoldPlacementDecision {
  ok: true;
  /** Documents to place a hold on, that this matter does not already hold. */
  place: string[];
  /** Named, and already held by this matter. Not an error. */
  alreadyHeld: string[];
  reason: string;
  warnings: string[];
}

export function planHoldPlacement(input: {
  matterStatus: string;
  /** Ids the caller asked for, in request order. Duplicates are tolerated. */
  requested: readonly string[];
  /** Ids that exist in this tenant. A missing one is simply absent. */
  found: readonly string[];
  /** Ids this matter already holds and has not released. */
  activeForMatter: readonly string[];
  reason: unknown;
}): HoldRefusal | HoldPlacementDecision {
  if (input.matterStatus !== 'Open') {
    return {
      ok: false,
      status: 409,
      code: 'MATTER_NOT_OPEN',
      message: 'This matter has been released. Adding documents to a closed matter would record a hold that nothing is enforcing.',
    };
  }

  const wanted: string[] = [];
  for (const raw of input.requested) {
    const id = String(raw || '').trim();
    if (id && !wanted.includes(id)) wanted.push(id);
  }

  if (wanted.length === 0) {
    return { ok: false, status: 400, code: 'NOTHING_TO_HOLD', message: 'Name at least one document to hold.' };
  }
  if (wanted.length > MAX_DOCUMENTS_PER_ACTION) {
    return {
      ok: false,
      status: 400,
      code: 'TOO_MANY_DOCUMENTS',
      message: `At most ${MAX_DOCUMENTS_PER_ACTION} documents can be held in one request; ${wanted.length} were named.`,
    };
  }

  const found = new Set(input.found.map(String));
  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'DOCUMENT_NOT_FOUND',
      message: `${missing.length} of the documents named do not exist in this organisation. Nothing was held — a hold that silently skipped what it could not find would leave somebody believing a document was frozen.`,
    };
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length < 4) {
    return {
      ok: false,
      status: 400,
      code: 'HOLD_REASON_REQUIRED',
      message: 'Say why these records are being held. The reason is what the hold is defended with.',
    };
  }

  const active = new Set(input.activeForMatter.map(String));
  const place = wanted.filter((id) => !active.has(id));
  const alreadyHeld = wanted.filter((id) => active.has(id));

  const warnings: string[] = [];
  if (place.length === 0) {
    warnings.push('Every document named is already held by this matter. Nothing changed.');
  } else if (alreadyHeld.length > 0) {
    warnings.push(
      `${alreadyHeld.length} of them ${alreadyHeld.length === 1 ? 'was' : 'were'} already held by this matter and ${alreadyHeld.length === 1 ? 'was' : 'were'} not held twice.`,
    );
  }

  return { ok: true, place, alreadyHeld, reason, warnings };
}

// ─── Releasing ──────────────────────────────────────────────────────────────

export interface ReleaseDecision {
  ok: true;
  reason: string;
}

export function planRelease(input: {
  /** Whether there is anything still held to release. */
  activeHolds: number;
  reason: unknown;
}): HoldRefusal | ReleaseDecision {
  if (input.activeHolds === 0) {
    return {
      ok: false,
      status: 409,
      code: 'NOTHING_HELD',
      message: 'Nothing is currently held here.',
    };
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length < 4) {
    return {
      ok: false,
      status: 400,
      code: 'RELEASE_REASON_REQUIRED',
      message: 'Say why the hold is being lifted. A release with no reason is the entry nobody can explain later.',
    };
  }

  return { ok: true, reason };
}

// ─── Whether a document is frozen ───────────────────────────────────────────

/**
 * Whether the document should still be frozen once this release is applied.
 *
 * The whole reason a hold is a record rather than a flag: a document caught by
 * two matters must not thaw when the first one ends. Counting is the entire
 * rule, and it is here rather than in a Prisma query so it can be proved.
 */
export function stillFrozen(activeHoldsAfterRelease: number): boolean {
  return activeHoldsAfterRelease > 0;
}

/**
 * A document frozen by the old four-column hold, with no matter behind it.
 *
 * Holds placed before matters existed set legalHoldAt and wrote a free-text
 * matter string; they have no LegalHold row. Those documents stay frozen --
 * taking the freeze off records somebody deliberately froze would be the worst
 * possible reading of this change -- and remain releasable through the
 * per-document endpoint that placed them. Reported, so they can be moved onto
 * a matter rather than sitting in a state nothing lists.
 */
export function isLegacyHold(doc: {
  legalHoldAt: Date | string | null;
  activeHoldCount: number;
}): boolean {
  return Boolean(doc.legalHoldAt) && doc.activeHoldCount === 0;
}

// ─── Reporting ──────────────────────────────────────────────────────────────

export interface MatterSummary {
  documentsHeld: number;
  documentsReleased: number;
  total: number;
  /**
   * Said rather than derived from a zero. A matter that has never held
   * anything and a matter whose holds have all been released are different
   * things, and only the first is somebody forgetting to add the documents.
   */
  neverHeldAnything: boolean;
}

export function summariseMatter(
  holds: readonly { releasedAt: Date | string | null }[],
): MatterSummary {
  const documentsHeld = holds.filter((h) => !h.releasedAt).length;
  const documentsReleased = holds.filter((h) => h.releasedAt).length;
  return {
    documentsHeld,
    documentsReleased,
    total: holds.length,
    neverHeldAnything: holds.length === 0,
  };
}

/** How long a hold lasted, in whole days. Null while it is still in force. */
export function heldForDays(hold: {
  placedAt: Date | string;
  releasedAt: Date | string | null;
}): number | null {
  if (!hold.releasedAt) return null;
  const from = new Date(String(hold.placedAt instanceof Date ? hold.placedAt.toISOString() : hold.placedAt));
  const to = new Date(String(hold.releasedAt instanceof Date ? hold.releasedAt.toISOString() : hold.releasedAt));
  const day = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(0, Math.round((day(to) - day(from)) / 86_400_000));
}
