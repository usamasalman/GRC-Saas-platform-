/**
 * Threads on an engagement (consulting engagement, sprint 9).
 *
 * A thread is about one thing: the engagement itself, one of its tasks or
 * requests, or a document, risk or asset its scope shares. Who can read it is
 * fixed when it starts and never widened:
 *
 *   - Engagement      both sides;
 *   - ClientInternal  the organisation only;
 *   - FirmInternal    the firm only.
 *
 * Posts are never edited. A retraction keeps the words and says who and why,
 * so a discussion cannot be rewritten after someone has acted on it. A
 * Decision is recorded only in an Engagement thread, by the organisation's
 * project manager or owner, or by the firm's Lead. People are named only if
 * they can read the thread. A thread becomes a task, a request or a gap
 * through the routes that already create them (a gap through the gap
 * assessment, sprint 10), and is then linked to what it became.
 *
 * Pure, so every rule here runs without a database.
 */

export const VISIBILITIES = ['Engagement', 'ClientInternal', 'FirmInternal'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const SUBJECT_TYPES = ['Engagement', 'Task', 'Request', 'Document', 'Risk', 'Asset'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
/** The kinds of subject the scope shares, which an Engagement thread may name only while shared. */
export const SCOPED_SUBJECTS: readonly SubjectType[] = ['Document', 'Risk', 'Asset'];
export const POST_KINDS = ['Comment', 'Question', 'Decision', 'ReviewNote'] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const CONVERT_TARGETS = ['Task', 'Request', 'Gap'] as const;
export type Side = 'Client' | 'Provider';

export const MAX_TITLE = 200;
export const MAX_BODY = 8000;
export const MAX_MENTIONS = 20;

type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

/** The visibilities a side may start a thread with. */
export const visibilitiesFor = (side: Side): Visibility[] => (side === 'Client' ? ['Engagement', 'ClientInternal'] : ['Engagement', 'FirmInternal']);

/** Whether this side reads threads of this visibility. Nothing else decides it. */
export const sideReads = (side: Side, visibility: string): boolean => visibilitiesFor(side).includes(visibility as Visibility);

/** The thread's opening: who may start what, about what, with which first post. */
export function checkThreadStart(input: {
  side: Side; visibility: unknown; subjectType: unknown; title: unknown; body: unknown; kind: unknown;
}): { ok: true; visibility: Visibility; subjectType: SubjectType; title: string; body: string; kind: PostKind } | Refusal {
  const visibility = String(input.visibility ?? '');
  if (!(VISIBILITIES as readonly string[]).includes(visibility)) {
    return refuse(400, 'BAD_VISIBILITY', `Say who reads it: ${VISIBILITIES.join(', ')}.`);
  }
  if (!sideReads(input.side, visibility)) {
    return refuse(403, 'NOT_YOUR_SIDE', input.side === 'Client'
      ? 'Only the firm starts a firm-internal thread.'
      : 'Only the organisation starts a client-internal thread.');
  }
  const subjectType = String(input.subjectType ?? 'Engagement');
  if (!(SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
    return refuse(400, 'BAD_SUBJECT', `A thread is about ${SUBJECT_TYPES.join(', ').toLowerCase()}.`);
  }
  const title = String(input.title ?? '').trim();
  if (title.length < 3) return refuse(400, 'TITLE_REQUIRED', 'Give the thread a title of at least 3 characters.');
  if (title.length > MAX_TITLE) return refuse(400, 'TITLE_TOO_LONG', `A title is at most ${MAX_TITLE} characters.`);
  const post = checkPost({ kind: input.kind ?? 'Comment', body: input.body });
  if (!post.ok) return post;
  return { ok: true, visibility: visibility as Visibility, subjectType: subjectType as SubjectType, title, body: post.body, kind: post.kind };
}

export function checkPost(input: { kind: unknown; body: unknown }): { ok: true; kind: PostKind; body: string } | Refusal {
  const kind = String(input.kind ?? 'Comment');
  if (!(POST_KINDS as readonly string[]).includes(kind)) return refuse(400, 'BAD_KIND', `A post is a ${POST_KINDS.join(', ')}.`);
  const body = String(input.body ?? '').trim();
  if (!body) return refuse(400, 'BODY_REQUIRED', 'Say something.');
  if (body.length > MAX_BODY) return refuse(400, 'BODY_TOO_LONG', `A post is at most ${MAX_BODY} characters.`);
  return { ok: true, kind: kind as PostKind, body };
}

/**
 * Who records a Decision: in an Engagement thread only, by the organisation's
 * project manager or owner, or by the firm's Lead. A decision taken inside
 * one side is that side's business and is a comment to the other.
 */
export function decisionRefusal(input: {
  visibility: string; side: Side; clientManager: boolean; firmRole: string | null;
}): Refusal | null {
  if (input.visibility !== 'Engagement') {
    return refuse(403, 'DECISION_ENGAGEMENT_ONLY', 'A decision is recorded in a thread both sides read.');
  }
  if (input.side === 'Client' && !input.clientManager) {
    return refuse(403, 'DECISION_BY_MANAGER', 'The project manager or owner records decisions for the organisation.');
  }
  if (input.side === 'Provider' && input.firmRole !== 'Lead') {
    return refuse(403, 'DECISION_BY_LEAD', 'The firm\'s Lead records decisions for the firm.');
  }
  return null;
}

/** A post is retracted by its author, once, with a reason; its words stay. */
export function retractRefusal(post: { authorId: string; retractedAt: Date | null }, userId: string, reason: unknown): Refusal | null {
  if (post.authorId !== userId) return refuse(403, 'NOT_AUTHOR', 'Only the person who wrote a post retracts it.');
  if (post.retractedAt) return refuse(409, 'ALREADY_RETRACTED', 'This post has already been retracted.');
  if (String(reason ?? '').trim().length < 4) return refuse(400, 'REASON_REQUIRED', 'Say why it is being retracted.');
  return null;
}

/** Whether a thread still takes posts. */
export function postingRefusal(thread: { status: string; convertedToLabel: string | null }): Refusal | null {
  if (thread.status === 'Converted') {
    return refuse(409, 'CONVERTED', `This thread became ${thread.convertedToLabel ?? 'an item'}; carry on there.`);
  }
  return null;
}

/** The mentioned ids that may be named: unique, and only people who can read the thread. */
export function checkMentions(raw: unknown, readers: ReadonlySet<string>): { ok: true; ids: string[] } | Refusal {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map((x) => String(x)).filter(Boolean))];
  if (ids.length > MAX_MENTIONS) return refuse(400, 'TOO_MANY_MENTIONS', `Name at most ${MAX_MENTIONS} people in one post.`);
  const outside = ids.filter((id) => !readers.has(id));
  if (outside.length) {
    return refuse(400, 'CANNOT_SEE_THREAD', 'Only people who can read this thread can be named in it.');
  }
  return { ok: true, ids };
}

export const threadRef = (n: number): string => `THR-${String(n).padStart(4, '0')}`;
