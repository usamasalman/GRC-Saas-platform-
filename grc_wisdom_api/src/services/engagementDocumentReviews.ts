/**
 * Document review and suggestions (consulting engagement, sprint 9).
 *
 * Review: the firm's Lead and Reviewers say of one version of a shared
 * document that it is Accepted, needs Changes requested, or is Not fit for
 * purpose, with comments anchored to the words they are about (quoted from
 * that version) or to a page of a file.
 *
 * Suggestion: the firm never edits the organisation's document. A suggestion
 * is proposed wording for a section of one published version, with the
 * reason. The organisation pulls it into its next version (starting one if
 * none is open); for a text document the proposed wording can be taken into
 * the draft, and then the firm's author is recorded as one of its editors.
 * Every suggestion ends with an outcome the firm sees: accepted into the
 * version that published it, declined with a reason, or superseded. A
 * suggestion made on an earlier version still counts, and says so.
 *
 * Pure, so every rule here runs without a database.
 */

export const REVIEW_OUTCOMES = ['Accepted', 'ChangesRequested', 'NotFitForPurpose'] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];
export const OUTCOME_LABEL: Record<ReviewOutcome, string> = {
  Accepted: 'Accepted', ChangesRequested: 'Changes requested', NotFitForPurpose: 'Not fit for purpose',
};
export const SUGGESTION_STATUSES = ['Open', 'Pulled', 'Accepted', 'Declined', 'Superseded'] as const;
export const MAX_COMMENTS = 50;
export const MAX_PAGE = 5000;

type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

export interface ReviewComment { quote: string | null; page: number | null; body: string }

/**
 * A review: an outcome, a note whenever it is not plain acceptance, and
 * comments each anchored by a quote that is really in the version reviewed,
 * or by a page.
 */
export function checkReview(input: { outcome: unknown; note: unknown; comments: unknown; content: string | null }):
  { ok: true; outcome: ReviewOutcome; note: string | null; comments: ReviewComment[] } | Refusal {
  const outcome = String(input.outcome ?? '');
  if (!(REVIEW_OUTCOMES as readonly string[]).includes(outcome)) {
    return refuse(400, 'BAD_OUTCOME', 'A review is Accepted, Changes requested or Not fit for purpose.');
  }
  const note = String(input.note ?? '').trim();
  if (outcome !== 'Accepted' && note.length < 10) {
    return refuse(400, 'NOTE_REQUIRED', 'Say what has to change, in at least 10 characters.');
  }
  const raw = Array.isArray(input.comments) ? input.comments : [];
  if (raw.length > MAX_COMMENTS) return refuse(400, 'TOO_MANY_COMMENTS', `At most ${MAX_COMMENTS} comments in one review.`);
  const comments: ReviewComment[] = [];
  for (const c of raw) {
    const body = String((c as any)?.body ?? '').trim();
    const quote = String((c as any)?.quote ?? '').trim() || null;
    const pageRaw = (c as any)?.page;
    const page = pageRaw === undefined || pageRaw === null || pageRaw === '' ? null : Number(pageRaw);
    if (!body) return refuse(400, 'COMMENT_REQUIRED', 'Every comment says something.');
    if (!quote && page === null) return refuse(400, 'ANCHOR_REQUIRED', 'Anchor every comment to the words it is about, or to a page.');
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > MAX_PAGE)) {
      return refuse(400, 'BAD_PAGE', `A page is a whole number from 1 to ${MAX_PAGE}.`);
    }
    if (quote && (input.content === null || !input.content.includes(quote))) {
      return refuse(400, 'QUOTE_NOT_FOUND', `"${quote.slice(0, 60)}" is not in the version being reviewed. Quote its words exactly, or give a page.`);
    }
    comments.push({ quote: quote ? quote.slice(0, 1000) : null, page, body: body.slice(0, 4000) });
  }
  return { ok: true, outcome: outcome as ReviewOutcome, note: note || null, comments };
}

/** A suggestion: where, the words it would replace (really in that version), the new words, and why. */
export function checkSuggestion(input: {
  section: unknown; currentWording: unknown; proposedWording: unknown; reason: unknown; content: string | null;
}): { ok: true; section: string; currentWording: string | null; proposedWording: string; reason: string } | Refusal {
  const section = String(input.section ?? '').trim();
  if (section.length < 2 || section.length > 200) return refuse(400, 'SECTION_REQUIRED', 'Name the section, in up to 200 characters.');
  const proposedWording = String(input.proposedWording ?? '').trim();
  if (!proposedWording) return refuse(400, 'WORDING_REQUIRED', 'Give the wording you propose.');
  if (proposedWording.length > 20000) return refuse(400, 'WORDING_TOO_LONG', 'Propose at most 20,000 characters at a time.');
  const currentWording = String(input.currentWording ?? '').trim() || null;
  if (currentWording && (input.content === null || !input.content.includes(currentWording))) {
    return refuse(400, 'WORDING_NOT_FOUND', 'The words to replace are not in the published version. Quote them exactly.');
  }
  if (currentWording && currentWording === proposedWording) return refuse(400, 'NO_CHANGE', 'The proposed wording is the same as the current wording.');
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 10) return refuse(400, 'REASON_REQUIRED', 'Say why, in at least 10 characters.');
  return { ok: true, section, currentWording, proposedWording, reason };
}

/**
 * Takes a suggestion's wording into the draft: the words it replaces must be
 * there exactly once, or the person editing the draft does it by hand.
 */
export function applyWording(draft: string, current: string | null, proposed: string): { ok: true; text: string } | Refusal {
  if (!current) {
    return refuse(409, 'NOTHING_TO_REPLACE', 'This suggestion does not quote words to replace. Edit the draft by hand and the suggestion stays as its reason.');
  }
  const first = draft.indexOf(current);
  if (first < 0) return refuse(409, 'NOT_IN_DRAFT', 'The words it replaces are no longer in the draft. Edit the draft by hand.');
  if (draft.indexOf(current, first + current.length) >= 0) {
    return refuse(409, 'AMBIGUOUS', 'The words it replaces appear more than once in the draft. Edit the draft by hand.');
  }
  return { ok: true, text: draft.slice(0, first) + proposed + draft.slice(first + current.length) };
}

/** What the firm sees of a suggestion's fate. */
export function suggestionOutcome(s: {
  status: string; acceptedInto: string | null; decisionReason: string | null; versionNumber: string | null;
}): string {
  if (s.status === 'Accepted') return `Accepted into v${s.acceptedInto}`;
  if (s.status === 'Declined') return `Declined: ${s.decisionReason ?? ''}`.trim();
  if (s.status === 'Superseded') return `Superseded${s.decisionReason ? `: ${s.decisionReason}` : ''}`;
  if (s.status === 'Pulled') return `In the next version${s.versionNumber ? ` (v${s.versionNumber})` : ''}`;
  return 'Open';
}

export const suggestionRef = (n: number): string => `SUG-${String(n).padStart(4, '0')}`;
