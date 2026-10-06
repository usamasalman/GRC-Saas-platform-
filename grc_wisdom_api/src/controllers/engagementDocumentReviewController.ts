import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { firmAccess, FirmAccess } from '../services/engagementFirmAccess';
import { bindingScope, registerScope } from '../services/engagementScope';
import { roleMay, roleRefusal, EngagementAction } from '../services/engagementRules';
import { isEnded } from '../services/engagementAfterClose';
import { isEditableState, versionHash } from '../services/documentVersions';
import {
  checkReview, checkSuggestion, applyWording, suggestionOutcome, suggestionRef, OUTCOME_LABEL, ReviewOutcome,
} from '../services/engagementDocumentReviews';
import { beginNextVersion, VersionRefused } from './documentVersionController';
import { str, send, notFound, loadEngagement, clientSide, flagFor, HELD_READ_ONLY, Engagement } from './engagementController';

/**
 * Document review and suggestions (consulting engagement, sprint 9).
 *
 * Both work on documents the binding scope shares, and only while it shares
 * them: anything else is the same 404 as a document that does not exist. The
 * firm reviews and suggests; the organisation reads both, and only the
 * document's owner or the engagement's project manager or owner acts on a
 * suggestion. Every step is on both organisations' trails.
 */

type Access =
  | { ok: true; e: Engagement; side: 'Client'; userId: string; leads: boolean }
  | { ok: true; e: Engagement; side: 'Provider'; userId: string; firm: FirmAccess }
  | { ok: false; status: number; code?: string; message: string };

async function access(req: AuthenticatedRequest): Promise<Access> {
  const e = await loadEngagement(str(req.params.projectId));
  const userId = str(req.user!.id);
  if (!e) return { ok: false, status: 404, message: 'Engagement not found' };
  if (await clientSide(req, e)) {
    const refusal = await flagFor(e);
    if (refusal) return { ok: false, ...refusal };
    return { ok: true, e, side: 'Client', userId, leads: e.managerId === userId || e.ownerId === userId };
  }
  if (e.providerTenantId && e.providerTenantId === req.user!.tenantId) {
    const firm = await firmAccess(e, userId);
    if (firm.reads) {
      const refusal = await flagFor(e);
      if (refusal) return { ok: false, ...refusal };
      return { ok: true, e, side: 'Provider', userId, firm };
    }
  }
  return { ok: false, status: 404, message: 'Engagement not found' };
}
type Ok = Extract<Access, { ok: true }>;

function firmMay(a: Ok, action: EngagementAction): { status: number; code?: string; message: string } | null {
  if (a.side !== 'Provider') return { status: 403, code: 'FIRM_ACTS', message: 'Only the delivery firm does this.' };
  if (!roleMay(a.firm.role, action)) return roleRefusal(a.firm.role, action);
  if (!a.firm.acts) {
    if (a.e.status === 'OnHold') return HELD_READ_ONLY;
    if (isEnded(a.e.status)) return { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` };
    return { status: 403, code: 'OUTSIDE_ACCESS', message: 'Your access to this engagement is not open today.' };
  }
  return null;
}

const DOC_SELECT = {
  id: true, code: true, title: true, status: true, version: true, publishedVersion: true, content: true, fileUrl: true,
  tenantId: true, ownerId: true, classification: true, openVersionId: true, legalHoldAt: true,
} as const;

/** The document, if the binding scope shares it today; null is a 404 (and a refused read on the organisation's trail). */
async function sharedDoc(a: Ok, documentId: string) {
  const reg = registerScope(await bindingScope(a.e.id), 'Documents');
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: DOC_SELECT });
  if (!doc) return null;
  const shared = Boolean(reg) && reg!.tenantIds.includes(doc.tenantId) && reg!.classifications.includes(doc.classification) && doc.status !== 'ARCHIVED';
  if (shared) return doc;
  if (a.side === 'Provider' && doc.tenantId === a.e.tenantId) {
    await prisma.$transaction((tx) => writeAudit(tx, {
      tenantId: a.e.tenantId, actorId: a.userId, action: 'ENGAGEMENT_READ_REFUSED', subjectType: 'Document', subjectId: doc.id,
      payload: { ref: a.e.ref, projectId: a.e.id, actorTenantId: a.e.providerTenantId, subjectId: doc.id, reason: reg ? 'outside-scope' : 'register-not-shared' },
    }));
  }
  return null;
}
type SharedDoc = NonNullable<Awaited<ReturnType<typeof sharedDoc>>>;

const live = (d: { publishedVersion: string | null; version: string }) => d.publishedVersion || d.version;

/** Both trails: the organisation's in full, the firm's a summary naming the client. */
async function bothTrails(tx: any, a: Ok, args: { action: string; subjectType: string; subjectId: string; payload: Record<string, unknown> }) {
  await writeAudit(tx, {
    tenantId: a.e.tenantId, actorId: a.userId, action: args.action, subjectType: args.subjectType, subjectId: args.subjectId,
    payload: { projectRef: a.e.ref, projectId: a.e.id, ...args.payload },
  });
  if (a.e.providerTenantId && a.e.providerTenantId !== a.e.tenantId) {
    await writeAudit(tx, {
      tenantId: a.e.providerTenantId, actorId: a.userId, action: args.action, subjectType: args.subjectType, subjectId: args.subjectId,
      payload: { projectRef: a.e.ref, clientTenantId: a.e.tenantId, ...args.payload },
    });
  }
}

/** The document's owner and the engagement's project manager, who hear about reviews and suggestions. */
const organisationLeads = (a: Ok, doc: { ownerId: string }) => [...new Set([doc.ownerId, a.e.managerId, a.e.ownerId].filter(Boolean) as string[])];

// ─── Review ─────────────────────────────────────────────────────────────────

/** GET /api/engagements/:projectId/documents/:documentId/reviews */
export const listReviews = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const doc = await sharedDoc(a, str(req.params.documentId));
    if (!doc) { notFound(res, 'Document'); return; }
    const reviews = await prisma.documentReview.findMany({
      where: { projectId: a.e.id, documentId: doc.id }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: 0, take: 200,
      select: {
        id: true, documentVersion: true, outcome: true, note: true, createdAt: true, reviewer: { select: { name: true } },
        comments: { select: { id: true, quote: true, page: true, body: true } },
      },
    });
    res.json({
      status: 'success', side: a.side, version: live(doc),
      reviews: reviews.map((r) => ({ ...r, outcomeLabel: OUTCOME_LABEL[r.outcome as ReviewOutcome] ?? r.outcome, current: r.documentVersion === live(doc) })),
      can: { review: a.side === 'Provider' && !firmMay(a, 'docreview') },
    });
  } catch (error: any) {
    console.error('[Document Reviews Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the reviews' });
  }
};

/** POST /api/engagements/:projectId/documents/:documentId/reviews { outcome, note, comments: [{ quote | page, body }] } */
export const reviewDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const no = firmMay(a, 'docreview');
    if (no) { send(res, no); return; }
    const doc = await sharedDoc(a, str(req.params.documentId));
    if (!doc) { notFound(res, 'Document'); return; }
    const checked = checkReview({ outcome: req.body?.outcome, note: req.body?.note, comments: req.body?.comments, content: doc.content || null });
    if (!checked.ok) { send(res, checked); return; }
    const review = await prisma.$transaction(async (tx) => {
      const r = await tx.documentReview.create({
        data: {
          projectId: a.e.id, documentId: doc.id, documentVersion: live(doc), reviewerId: a.userId, outcome: checked.outcome, note: checked.note,
          comments: { create: checked.comments },
        },
        select: { id: true },
      });
      await bothTrails(tx, a, {
        action: 'ENGAGEMENT_DOCUMENT_REVIEWED', subjectType: 'Document', subjectId: doc.id,
        payload: { code: doc.code, version: live(doc), outcome: checked.outcome, comments: checked.comments.length, reviewId: r.id },
      });
      if (checked.outcome !== 'Accepted') {
        const leads = organisationLeads(a, doc);
        await notify(tx, leads.map((recipientId) => ({
          tenantId: a.e.tenantId, recipientId, actorId: a.userId, event: 'ENGAGEMENT_DOCUMENT_REVIEWED', subjectType: 'Document', subjectId: doc.id,
          title: `${doc.code} v${live(doc)}: ${OUTCOME_LABEL[checked.outcome]}`, body: checked.note ?? '', link: 'delivery',
        })));
      }
      return r;
    });
    res.status(201).json({ status: 'success', review });
  } catch (error: any) {
    console.error('[Document Review Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the review' });
  }
};

// ─── Suggestions ────────────────────────────────────────────────────────────

const SUGGESTION_SELECT = {
  id: true, ref: true, documentId: true, documentVersion: true, section: true, currentWording: true, proposedWording: true, reason: true,
  status: true, createdAt: true, pulledAt: true, wordingAppliedAt: true, acceptedInto: true, decidedAt: true, decisionReason: true,
  authorId: true, author: { select: { name: true, tenantId: true } }, decidedBy: { select: { name: true } },
  version: { select: { id: true, versionNumber: true, state: true } },
} as const;

/** GET /api/engagements/:projectId/documents/:documentId/suggestions */
export const listSuggestions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const doc = await sharedDoc(a, str(req.params.documentId));
    if (!doc) { notFound(res, 'Document'); return; }
    const rows = await prisma.documentSuggestion.findMany({
      where: { projectId: a.e.id, documentId: doc.id }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: 0, take: 200, select: SUGGESTION_SELECT,
    });
    const open = doc.openVersionId
      ? await prisma.documentVersion.findUnique({ where: { id: doc.openVersionId }, select: { id: true, versionNumber: true, state: true } })
      : null;
    const decides = a.side === 'Client' && (a.leads || doc.ownerId === a.userId);
    res.json({
      status: 'success', side: a.side, version: live(doc), documentStatus: doc.status,
      openVersion: open,
      suggestions: rows.map(({ author, ...s }) => ({
        ...s, author: author.name,
        outcome: suggestionOutcome({ ...s, versionNumber: s.version?.versionNumber ?? null }),
        // A late suggestion still counts, and says which version it was made on.
        madeOnEarlier: s.documentVersion !== live(doc),
      })),
      can: {
        suggest: a.side === 'Provider' && doc.status === 'PUBLISHED' && !firmMay(a, 'suggest'),
        decide: decides,
        pull: decides && doc.status === 'PUBLISHED' && !doc.legalHoldAt && (!open || isEditableState(open.state)),
      },
    });
  } catch (error: any) {
    console.error('[Suggestions Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the suggestions' });
  }
};

/** POST /api/engagements/:projectId/documents/:documentId/suggestions { section, currentWording?, proposedWording, reason } */
export const suggestWording = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const no = firmMay(a, 'suggest');
    if (no) { send(res, no); return; }
    const doc = await sharedDoc(a, str(req.params.documentId));
    if (!doc) { notFound(res, 'Document'); return; }
    if (doc.status !== 'PUBLISHED') {
      send(res, { status: 409, code: 'NOT_PUBLISHED', message: 'Suggestions are made on a published version. Review a draft instead.' }); return;
    }
    const b = req.body || {};
    const checked = checkSuggestion({ section: b.section, currentWording: b.currentWording, proposedWording: b.proposedWording, reason: b.reason, content: doc.content || null });
    if (!checked.ok) { send(res, checked); return; }
    const made = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`suggestions:${a.e.id}`}))`;
      const ref = suggestionRef((await tx.documentSuggestion.count({ where: { projectId: a.e.id } })) + 1);
      const s = await tx.documentSuggestion.create({
        data: {
          projectId: a.e.id, ref, documentId: doc.id, documentVersion: live(doc), authorId: a.userId,
          section: checked.section, currentWording: checked.currentWording, proposedWording: checked.proposedWording, reason: checked.reason,
        },
        select: { id: true, ref: true },
      });
      await bothTrails(tx, a, {
        action: 'ENGAGEMENT_SUGGESTION_MADE', subjectType: 'DocumentSuggestion', subjectId: s.id,
        payload: { ref, code: doc.code, version: live(doc), section: checked.section },
      });
      await notify(tx, organisationLeads(a, doc).map((recipientId) => ({
        tenantId: a.e.tenantId, recipientId, actorId: a.userId, event: 'ENGAGEMENT_SUGGESTION_MADE', subjectType: 'Document', subjectId: doc.id,
        title: `${ref}: suggested wording for ${doc.code} v${live(doc)}`, body: checked.section, link: 'delivery',
      })));
      return s;
    });
    res.status(201).json({ status: 'success', suggestion: made });
  } catch (error: any) {
    console.error('[Suggestion Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the suggestion' });
  }
};

/** A suggestion of this engagement, with its document, for the organisation to act on. */
async function suggestionToDecide(a: Ok, id: string): Promise<
  { ok: true; s: { id: string; ref: string; authorId: string; status: string; versionId: string | null; currentWording: string | null; proposedWording: string; reason: string; author: { tenantId: string } }; doc: SharedDoc }
  | { ok: false; status: number; code?: string; message: string }> {
  if (a.side !== 'Client') return { ok: false, status: 403, code: 'ORGANISATION_DECIDES', message: 'The organisation decides what happens to a suggestion.' };
  if (isEnded(a.e.status)) return { ok: false, status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` };
  const s = await prisma.documentSuggestion.findFirst({
    where: { id, projectId: a.e.id },
    select: { id: true, ref: true, documentId: true, authorId: true, status: true, versionId: true, currentWording: true, proposedWording: true, reason: true, author: { select: { tenantId: true } } },
  });
  if (!s) return { ok: false, status: 404, message: 'Suggestion not found' };
  const doc = await sharedDoc(a, s.documentId);
  if (!doc) return { ok: false, status: 404, message: 'Suggestion not found' };
  if (!a.leads && doc.ownerId !== a.userId) {
    return { ok: false, status: 403, code: 'OWNER_OR_MANAGER', message: 'The document\'s owner, or the engagement\'s project manager, decides on suggestions.' };
  }
  return { ok: true, s, doc };
}

/**
 * POST /api/engagements/:projectId/suggestions/:suggestionId/pull { changeType? }
 *
 * "Start next version from this suggestion" when none is open: the draft
 * belongs to the organisation and the suggestion is its source. "Add to the
 * open next version" when one is open and still being written.
 */
export const pullSuggestion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const found = await suggestionToDecide(a, str(req.params.suggestionId));
    if (!found.ok) { send(res, found); return; }
    const { s, doc } = found;
    if (s.status !== 'Open') { send(res, { status: 409, code: 'NOT_OPEN', message: `${s.ref} is ${s.status.toLowerCase()}.` }); return; }
    if (doc.status !== 'PUBLISHED') { send(res, { status: 409, code: 'NOT_PUBLISHED', message: 'Only a published document has a next version.' }); return; }
    if (doc.legalHoldAt) { send(res, { status: 423, code: 'LEGAL_HOLD', message: 'This document is under legal hold.' }); return; }
    const pull = async (tx: any, versionId: string, versionNumber: string, started: boolean) => {
      const moved = await tx.documentSuggestion.updateMany({
        where: { id: s.id, status: 'Open' }, data: { status: 'Pulled', versionId, pulledAt: new Date(), pulledById: a.userId },
      });
      if (moved.count === 0) throw new VersionRefused(409, 'NOT_OPEN', `${s.ref} has just been decided.`);
      await bothTrails(tx, a, {
        action: 'ENGAGEMENT_SUGGESTION_PULLED', subjectType: 'DocumentSuggestion', subjectId: s.id,
        payload: { ref: s.ref, code: doc.code, into: versionNumber, startedVersion: started },
      });
      await notify(tx, [{
        tenantId: s.author.tenantId, recipientId: s.authorId, actorId: a.userId, event: 'ENGAGEMENT_SUGGESTION_PULLED',
        subjectType: 'DocumentSuggestion', subjectId: s.id, title: `${s.ref} is in the next version of ${doc.code} (v${versionNumber})`,
        body: `${a.e.ref} · ${a.e.name}`, link: 'delivery',
      }]);
    };
    if (!doc.openVersionId) {
      const full = await prisma.document.findUnique({ where: { id: doc.id } });
      const v = await beginNextVersion({
        doc: full!, userId: a.userId, changeType: req.body?.changeType || 'Minor', reason: `From ${s.ref} (${a.e.ref}): ${s.reason}`,
        within: (tx, row) => pull(tx, row.id, row.versionNumber, true),
      });
      res.status(201).json({ status: 'success', message: `Version ${v.versionNumber} started from ${s.ref}.`, version: v });
      return;
    }
    const open = await prisma.documentVersion.findUnique({ where: { id: doc.openVersionId }, select: { id: true, versionNumber: true, state: true } });
    if (!open || !isEditableState(open.state)) {
      send(res, { status: 409, code: 'NOT_EDITABLE', message: `The open next version is ${open?.state ?? 'closed'}; a suggestion joins it while it is a draft or returned.` }); return;
    }
    await prisma.$transaction((tx) => pull(tx, open.id, open.versionNumber, false));
    res.json({ status: 'success', message: `${s.ref} added to the open next version, v${open.versionNumber}.`, version: { id: open.id, versionNumber: open.versionNumber } });
  } catch (error: any) {
    if (error instanceof VersionRefused) { send(res, { status: error.status, code: error.code, message: error.message }); return; }
    console.error('[Suggestion Pull Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to pull the suggestion in' });
  }
};

/**
 * POST /api/engagements/:projectId/suggestions/:suggestionId/apply — takes
 * the proposed wording into the draft it was pulled into. The firm's author
 * is then one of that version's editors, so separation of duties shows who
 * wrote what.
 */
export const applySuggestion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const found = await suggestionToDecide(a, str(req.params.suggestionId));
    if (!found.ok) { send(res, found); return; }
    const { s, doc } = found;
    if (s.status !== 'Pulled' || !s.versionId) { send(res, { status: 409, code: 'NOT_PULLED', message: `Pull ${s.ref} into a next version first.` }); return; }
    if (doc.legalHoldAt) { send(res, { status: 423, code: 'LEGAL_HOLD', message: 'This document is under legal hold.' }); return; }
    const v = await prisma.documentVersion.findUnique({ where: { id: s.versionId }, select: { id: true, versionNumber: true, state: true, content: true, fileUrl: true, checkedOutById: true } });
    if (!v || !isEditableState(v.state)) { send(res, { status: 409, code: 'NOT_EDITABLE', message: 'The next version is no longer being written.' }); return; }
    if (v.checkedOutById && v.checkedOutById !== a.userId) {
      send(res, { status: 409, code: 'CHECKED_OUT', message: 'Someone has the next version checked out. Ask them to check it in first.' }); return;
    }
    const applied = applyWording(v.content ?? '', s.currentWording, s.proposedWording);
    if (!applied.ok) { send(res, applied); return; }
    await prisma.$transaction(async (tx) => {
      const moved = await tx.documentVersion.updateMany({
        where: { id: v.id, state: { in: ['Draft', 'Returned'] }, content: v.content },
        data: { content: applied.text, fileHash: versionHash(applied.text, v.fileUrl) },
      });
      if (moved.count === 0) throw new VersionRefused(409, 'CHANGED', 'The draft changed while you were applying the wording. Reload it.');
      // The firm's author wrote these words, and the person applying them chose them.
      await tx.documentVersionEditor.upsert({
        where: { versionId_userId: { versionId: v.id, userId: s.authorId } },
        create: { versionId: v.id, userId: s.authorId, via: 'SUGGESTION' }, update: { editedAt: new Date() },
      });
      await tx.documentVersionEditor.upsert({
        where: { versionId_userId: { versionId: v.id, userId: a.userId } },
        create: { versionId: v.id, userId: a.userId, via: 'SUGGESTION' }, update: { editedAt: new Date() },
      });
      await tx.documentSuggestion.update({ where: { id: s.id }, data: { wordingAppliedAt: new Date() } });
      await bothTrails(tx, a, {
        action: 'ENGAGEMENT_SUGGESTION_APPLIED', subjectType: 'DocumentSuggestion', subjectId: s.id,
        payload: { ref: s.ref, code: doc.code, version: v.versionNumber, hash: versionHash(applied.text, v.fileUrl) },
      });
    });
    res.json({ status: 'success', message: `${s.ref}'s wording is in the draft of v${v.versionNumber}.` });
  } catch (error: any) {
    if (error instanceof VersionRefused) { send(res, { status: error.status, code: error.code, message: error.message }); return; }
    console.error('[Suggestion Apply Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to apply the wording' });
  }
};

/** POST /api/engagements/:projectId/suggestions/:suggestionId/decide { outcome: Declined | Superseded, reason } */
export const decideSuggestion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const found = await suggestionToDecide(a, str(req.params.suggestionId));
    if (!found.ok) { send(res, found); return; }
    const { s, doc } = found;
    const outcome = str(req.body?.outcome);
    if (outcome !== 'Declined' && outcome !== 'Superseded') { send(res, { status: 400, message: 'A suggestion is Declined or Superseded.' }); return; }
    const reason = str(req.body?.reason).trim();
    if (reason.length < 10) { send(res, { status: 400, code: 'REASON_REQUIRED', message: 'Say why, in at least 10 characters. The firm sees it.' }); return; }
    if (s.status !== 'Open' && s.status !== 'Pulled') { send(res, { status: 409, code: 'DECIDED', message: `${s.ref} is already ${s.status.toLowerCase()}.` }); return; }
    await prisma.$transaction(async (tx) => {
      const moved = await tx.documentSuggestion.updateMany({
        where: { id: s.id, status: { in: ['Open', 'Pulled'] } },
        data: { status: outcome, decisionReason: reason.slice(0, 2000), decidedAt: new Date(), decidedById: a.userId, versionId: null },
      });
      if (moved.count === 0) throw new VersionRefused(409, 'DECIDED', `${s.ref} has just been decided.`);
      await bothTrails(tx, a, {
        action: outcome === 'Declined' ? 'ENGAGEMENT_SUGGESTION_DECLINED' : 'ENGAGEMENT_SUGGESTION_SUPERSEDED', subjectType: 'DocumentSuggestion', subjectId: s.id,
        payload: { ref: s.ref, code: doc.code, reason },
      });
      await notify(tx, [{
        tenantId: s.author.tenantId, recipientId: s.authorId, actorId: a.userId, event: 'ENGAGEMENT_SUGGESTION_DECIDED',
        subjectType: 'DocumentSuggestion', subjectId: s.id, title: `${s.ref} ${outcome.toLowerCase()} on ${doc.code}`, body: reason, link: 'delivery',
      }]);
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof VersionRefused) { send(res, { status: error.status, code: error.code, message: error.message }); return; }
    console.error('[Suggestion Decide Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to decide the suggestion' });
  }
};
