import { generateHash } from '../utils/cryptoUtils';

/**
 * Next versions of a published document.
 *
 * Once a document is published its row means only "the policy in force". A
 * change is a next version: a DocumentVersion row with its own state, its own
 * editors and its own approvals, while every reader of the live policy keeps
 * reading the document row, which changes only when the next version is
 * published. One next version is open at a time, so the live copy it started
 * from can never move under it and nothing ever needs merging.
 *
 * The version it replaces is kept, never overwritten, as Superseded: its text
 * or file, its hash and its signatures stay, so "which policy applied on 3
 * March?" has an answer, and its retention clock starts on the day it was
 * replaced. History only moves forward: an old version is never republished;
 * going back means starting a next version from its content.
 *
 * Pure, so every rule here runs without a database.
 */

export const OPEN_STATES = ['Draft', 'InReview', 'Approved', 'Returned'] as const;
export const VERSION_STATES = [...OPEN_STATES, 'Published', 'Superseded', 'Discarded'] as const;
export const CHANGE_TYPES = ['Minor', 'Major'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const isOpenState = (state: string | null | undefined): boolean => (OPEN_STATES as readonly string[]).includes(String(state));
/** States in which the draft can still be written to or proposals changed. */
export const isEditableState = (state: string | null | undefined): boolean => state === 'Draft' || state === 'Returned';

/** The major number of a version: 1 for "1.4". */
export const majorOf = (version: string | null | undefined): number => {
  const n = parseInt(String(version ?? '').split('.')[0], 10);
  return Number.isFinite(n) ? n : 0;
};
/** The minor number of a version: 4 for "1.4". */
const minorOf = (version: string | null | undefined): number => {
  const n = parseInt(String(version ?? '').split('.')[1] ?? '0', 10);
  return Number.isFinite(n) ? n : 0;
};

/** 1.0 becomes 1.1 for a Minor change and 2.0 for a Major one. */
export function nextNumber(live: string, changeType: string): string {
  const major = majorOf(live);
  return changeType === 'Major' ? `${major + 1}.0` : `${major}.${minorOf(live) + 1}`;
}

/**
 * Whether a signature on one version covers another: within the same major
 * version it does (an acknowledgement of 1.0 counts for every 1.x); a Major
 * version asks everyone again.
 */
export const sameMajor = (a: string | null | undefined, b: string | null | undefined): boolean => majorOf(a) === majorOf(b);

/** The hash of what a version says: its text and its file, as approvals sign them. */
export const versionHash = (content: string | null | undefined, fileUrl: string | null | undefined): string =>
  generateHash(`${content ?? ''}|${fileUrl ?? ''}`);

/** How a replaced version is labelled wherever it is shown or printed. */
export function supersededLabel(supersededAt: Date, by: string): string {
  const day = supersededAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `Superseded on ${day} by v${by} — not in force`;
}

// ─── Proposed link changes ──────────────────────────────────────────────────

/**
 * Links describe the policy in force, so a next version proposes changes to
 * them and they apply only at publish: adding "now covers A.8.12" before the
 * new text is approved would overstate the live policy.
 */
export interface LinkChanges {
  add: { target: 'control' | 'risk' | 'clause'; id: string; note: string | null }[];
  remove: string[];
}

export const NO_LINK_CHANGES: LinkChanges = { add: [], remove: [] };

export function readLinkChanges(raw: string | null | undefined): LinkChanges {
  try {
    const v = JSON.parse(String(raw ?? ''));
    return {
      add: Array.isArray(v?.add) ? v.add : [],
      remove: Array.isArray(v?.remove) ? v.remove.map(String) : [],
    };
  } catch {
    return NO_LINK_CHANGES;
  }
}

/** Checks the shape of proposed link changes; whether the records exist is the caller's query. */
export function checkLinkChanges(body: unknown): { ok: true; value: LinkChanges } | { ok: false; message: string } {
  const b = (body ?? {}) as any;
  const add = Array.isArray(b.add) ? b.add : [];
  const remove = Array.isArray(b.remove) ? b.remove : [];
  if (add.length + remove.length > 200) return { ok: false, message: 'Propose at most 200 link changes in one version.' };
  const out: LinkChanges = { add: [], remove: [...new Set(remove.map(String).filter(Boolean))] as string[] };
  for (const a of add) {
    const target = String(a?.target ?? '');
    if (target !== 'control' && target !== 'risk' && target !== 'clause') {
      return { ok: false, message: 'A link to add names a control, a risk or a clause.' };
    }
    const id = String(a?.id ?? '').trim();
    if (!id) return { ok: false, message: 'A link to add names the record.' };
    out.add.push({ target, id, note: a?.note ? String(a.note).trim().slice(0, 500) : null });
  }
  return { ok: true, value: out };
}

// ─── Acknowledgements at publish ────────────────────────────────────────────

/**
 * Who is asked to acknowledge when a next version is published.
 *
 * Requests still open (unsigned) for an earlier version are closed as
 * superseded: nobody is asked to sign a policy no longer in force. A Major
 * version asks the whole audience again. A Minor version asks nobody who has
 * signed within the same major version; those whose request was still open
 * are asked again for the new version, and anyone new to the audience is
 * asked for the first time.
 */
export function planAcknowledgements(input: {
  previousVersion: string;
  newVersion: string;
  audienceIds: readonly string[];
  /** Requests not yet superseded, with whether they were signed. */
  openRequests: readonly { userId: string; version: string; signed: boolean }[];
  /** People who signed any version of this document, with the version. */
  signatures: readonly { userId: string; version: string | null }[];
}): { supersede: { userId: string; version: string }[]; ask: string[] } {
  const supersede = input.openRequests.filter((r) => !r.signed && r.version !== input.newVersion)
    .map((r) => ({ userId: r.userId, version: r.version }));
  const audience = [...new Set(input.audienceIds)];
  if (!sameMajor(input.previousVersion, input.newVersion)) {
    return { supersede, ask: audience };
  }
  const covered = new Set(input.signatures.filter((s) => sameMajor(s.version, input.newVersion)).map((s) => s.userId));
  return { supersede, ask: audience.filter((id) => !covered.has(id)) };
}
