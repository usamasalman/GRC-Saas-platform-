import { Response } from 'express';
import { resolveDocumentFile, servedTypeOf } from '../services/documentFiles';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { generateHash } from '../utils/cryptoUtils';
import { hasCapability, capabilitiesOfRole, CAP } from '../services/capabilityEngine';
import { checkSod } from '../services/sodEngine';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { planPublication, AUDIENCE_KINDS } from '../services/documentPublication';
import { CLASSIFICATIONS } from '../services/documentAccess';
import { loadReadable, NOT_FOUND_MESSAGE } from '../services/documentReadGuard';
import { versionEditorIds, selfApprovalRefusal, approversWhoDidNotEdit } from '../services/documentEditors';
import { planDocumentLinks } from '../services/documentLinks';
import { recomputeDisposalDue } from './retentionController';
import { loadCandidates } from './documentLinkController';
import {
  CHANGE_TYPES, isOpenState, isEditableState, nextNumber, versionHash, supersededLabel, sameMajor,
  readLinkChanges, checkLinkChanges, planAcknowledgements,
} from '../services/documentVersions';

/**
 * Next versions of a published document (Documents: next versions).
 *
 * The document row stays the live policy; its next version is a version row
 * with its own state, editors and approvals. Every route here works on that
 * row and leaves the live document alone until the next version is published,
 * in one transaction that copies it in and keeps the replaced version as
 * Superseded. A legal hold freezes the live copy and the open version alike.
 *
 * Documents never published are untouched: they keep today's flow on the
 * document itself.
 */

const SUBJECT = 'Document';
const str = (v: unknown): string => String(v ?? '');
const send = (res: Response, status: number, code: string, message: string) => res.status(status).json({ status: 'error', code, message });
const frozen = (doc: { legalHoldAt?: Date | null }) => Boolean(doc.legalHoldAt);

class Refused extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const VERSION_SELECT = {
  id: true, documentId: true, versionNumber: true, changeType: true, summary: true, content: true,
  fileUrl: true, fileName: true, fileSize: true, fileType: true, fileHash: true, createdAt: true, createdById: true,
  state: true, baseVersion: true, baseHash: true, startedById: true, startReason: true,
  proposedTitle: true, proposedClassification: true, proposedCategory: true, proposedAudienceKind: true,
  proposedAudienceValue: true, proposedLinks: true, checkedOutById: true, checkedOutAt: true, submittedAt: true,
  publishedAt: true, publishedById: true, supersededAt: true, supersededBy: true, discardedAt: true, discardReason: true,
  disposalDueAt: true, disposedAt: true,
  editors: { select: { userId: true, via: true, editedAt: true, user: { select: { name: true } } } },
} as const;

/**
 * The document, if the caller may read it; otherwise null, a 404 to the caller.
 * Writing or signing a next version never reaches a document its marking keeps
 * from the person: a draft of a Restricted policy is as restricted as the policy.
 */
async function loadDoc(req: AuthenticatedRequest) {
  const id = str(req.params.id);
  const tenantId = req.user!.tenantId;
  if (!(await loadReadable(id, str(req.user!.id), tenantId))) return null;
  return prisma.document.findFirst({ where: { id, tenantId } });
}
type Doc = NonNullable<Awaited<ReturnType<typeof loadDoc>>>;

async function openVersion(doc: Doc) {
  if (!doc.openVersionId) return null;
  return prisma.documentVersion.findFirst({ where: { id: doc.openVersionId, documentId: doc.id }, select: VERSION_SELECT });
}

/** The active people of the organisation who can approve documents, by name. */
async function signers(tenantId: string): Promise<{ id: string; name: string }[]> {
  const people = await prisma.user.findMany({
    where: { tenantId, status: 'Active' },
    select: { id: true, name: true, roleRef: { select: { capabilityGrants: true } } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return people.filter((p) => capabilitiesOfRole(p.roleRef).includes(CAP.SIGN_DOCUMENT)).map((p) => ({ id: p.id, name: p.name }));
}

/** Whether the caller may manage the document's versions: its owner, or someone who versions documents. */
async function mayManage(doc: Doc, userId: string): Promise<boolean> {
  return doc.ownerId === userId || hasCapability(userId, CAP.VERSION_DOCUMENT);
}

// ─── Start ──────────────────────────────────────────────────────────────────

/**
 * POST /api/documents/:id/next-version { changeType, reason, fromVersionId? }
 *
 * Only on a published document with no open version and no legal hold. The
 * draft starts as an exact copy of what is live (from the document row, not
 * its latest version row, since the library's edit can change the text without
 * a check-in), with its number fixed by the change type.
 *
 * Going back is going forward: a superseded version is never republished, but
 * a next version can start from its text. It is still compared with, and
 * replaces, the version in force.
 */
export const startNextVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const doc = await loadDoc(req);
    if (!doc) { send(res, 404, 'NOT_FOUND', 'Document not found'); return; }
    if (!(await mayManage(doc, userId))) { send(res, 403, 'NOT_PERMITTED', 'The owner, or someone who versions documents, starts a next version.'); return; }
    const version = await beginNextVersion({
      doc, userId, changeType: req.body?.changeType, reason: req.body?.reason, fromVersionId: req.body?.fromVersionId,
    });
    res.status(201).json({ status: 'success', version });
  } catch (error: any) {
    if (error instanceof Refused) { send(res, error.status, error.code, error.message); return; }
    console.error('[Next Version Start Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to start the next version' });
  }
};

/**
 * Starts a next version, in one transaction with whatever the caller adds to
 * it (a suggestion pulled in as its source). Throws Refused with the reason.
 * Who may start it is the caller's decision: the document's owner or someone
 * who versions documents here; the engagement's project manager for a
 * suggestion.
 */
export async function beginNextVersion(args: {
  doc: Doc; userId: string; changeType: unknown; reason: unknown; fromVersionId?: unknown;
  within?: (tx: any, row: { id: string; versionNumber: string }) => Promise<void>;
}): Promise<{ id: string; versionNumber: string }> {
  const { doc, userId } = args;
  if (doc.status !== 'PUBLISHED') {
    throw new Refused(409, 'NOT_PUBLISHED', `Only a published document has a next version; this one is ${doc.status}. Edit it as it is.`);
  }
  if (frozen(doc)) throw new Refused(423, 'LEGAL_HOLD', 'This document is under legal hold. Nothing about it can change until the hold is released.');
  if (doc.openVersionId) throw new Refused(409, 'VERSION_OPEN', 'This document already has an open next version. Work on that one, or discard it first.');
  const changeType = str(args.changeType || 'Minor');
  if (!(CHANGE_TYPES as readonly string[]).includes(changeType)) throw new Refused(400, 'BAD_CHANGE_TYPE', 'A next version is Minor or Major.');
  const reason = str(args.reason).trim();
  if (!noteIsEnough(reason)) throw new Refused(400, 'REASON_REQUIRED', `Say why it is being revised — at least ${MIN_NOTE} characters.`);
  let source: { versionNumber: string; content: string | null; fileUrl: string | null; fileName: string | null; fileSize: number | null; fileType: string | null } = { ...doc, versionNumber: doc.version };
  const fromVersionId = str(args.fromVersionId).trim();
  if (fromVersionId) {
    const earlier = await prisma.documentVersion.findFirst({
      where: { id: fromVersionId, documentId: doc.id, state: 'Superseded', disposedAt: null },
      select: { versionNumber: true, content: true, fileUrl: true, fileName: true, fileSize: true, fileType: true },
    });
    if (!earlier) throw new Refused(404, 'NOT_FOUND', 'Start from a superseded version of this document that has not been disposed of.');
    source = earlier;
  }

  const number = nextNumber(doc.version, changeType);
  const baseHash = versionHash(doc.content, doc.fileUrl);
  const startHash = versionHash(source.content, source.fileUrl);
  const why = fromVersionId ? `From v${source.versionNumber}: ${reason}` : reason;
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.documentVersion.create({
        data: {
          documentId: doc.id, versionNumber: number, changeType, state: 'Draft',
          content: source.content, fileUrl: source.fileUrl, fileName: source.fileName, fileSize: source.fileSize, fileType: source.fileType,
          fileHash: startHash, baseVersion: doc.version, baseHash, startedById: userId, startReason: why.slice(0, 2000),
          proposedTitle: doc.title, proposedClassification: doc.classification, proposedCategory: doc.category,
          proposedAudienceKind: doc.audienceKind, proposedAudienceValue: doc.audienceValue,
        },
        select: { id: true, versionNumber: true },
      });
      // One open version: the document names it, and only if none is named yet.
      const named = await tx.document.updateMany({ where: { id: doc.id, openVersionId: null }, data: { openVersionId: row.id } });
      if (named.count === 0) throw new Refused(409, 'VERSION_OPEN', 'Someone has just started a next version of this document.');
      await writeAudit(tx, {
        tenantId: doc.tenantId, actorId: userId, action: 'DOCUMENT_VERSION_STARTED', subjectType: SUBJECT, subjectId: doc.id,
        payload: {
          code: doc.code, from: doc.version, to: number, changeType, baseHash, reason,
          startedFrom: fromVersionId ? { version: source.versionNumber, hash: startHash } : null,
        },
      });
      if (args.within) await args.within(tx, row);
      return row;
    });
  } catch (error: any) {
    // The one-open-version index: two starts at the same moment.
    if (error?.code === 'P2002') throw new Refused(409, 'VERSION_OPEN', 'Someone has just started a next version of this document.');
    throw error;
  }
}

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * GET /api/documents/:id/next-version — the open next version, for the people
 * who manage or approve it: its text, its proposals, its editors, its
 * approvals so far, and the approvers of the version in force to offer again.
 */
export const getNextVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const doc = await loadDoc(req);
    if (!doc) { send(res, 404, 'NOT_FOUND', 'Document not found'); return; }
    const v = await openVersion(doc);
    const approverHere = v ? await prisma.approvalQueue.count({ where: { versionId: v.id, approverId: userId } }) : 0;
    const manage = await mayManage(doc, userId);
    if (!manage && !approverHere && !(await hasCapability(userId, CAP.SIGN_DOCUMENT))) {
      send(res, 404, 'NOT_FOUND', 'Document not found'); return;
    }
    if (!v) {
      res.json({
        status: 'success', version: null, live: { version: doc.version },
        can: { start: manage && doc.status === 'PUBLISHED' && !frozen(doc) },
        numbers: { Minor: nextNumber(doc.version, 'Minor'), Major: nextNumber(doc.version, 'Major') },
      });
      return;
    }
    const [approvals, previous, everyoneWhoSigns, holder, starter, suggestions] = await Promise.all([
      prisma.approvalQueue.findMany({
        where: { versionId: v.id }, orderBy: { sequenceOrder: 'asc' },
        select: { id: true, approverId: true, status: true, sequenceOrder: true, decision: true, reason: true, reviewedAt: true, createdAt: true, approver: { select: { name: true } } },
      }),
      // Who signed the version in force, offered again; separation of duties is
      // still checked against this version's editors when it is submitted.
      prisma.approvalQueue.findMany({
        where: { documentId: doc.id, status: 'APPROVED', OR: [{ versionId: null }, { version: { versionNumber: doc.version } }] },
        select: { approverId: true, approver: { select: { name: true } } },
        distinct: ['approverId'],
      }),
      signers(doc.tenantId),
      v.checkedOutById ? prisma.user.findUnique({ where: { id: v.checkedOutById }, select: { name: true } }) : null,
      v.startedById ? prisma.user.findUnique({ where: { id: v.startedById }, select: { name: true } }) : null,
      // Suggestions from engagements pulled into this version: its sources.
      prisma.documentSuggestion.findMany({
        where: { versionId: v.id }, orderBy: { createdAt: 'asc' },
        select: {
          id: true, ref: true, section: true, currentWording: true, proposedWording: true, reason: true, documentVersion: true,
          wordingAppliedAt: true, projectId: true, author: { select: { name: true } }, project: { select: { ref: true, name: true } },
        },
      }),
    ]);
    const editors = versionEditorIds({ createdById: v.createdById, editors: v.editors });
    const changes = readLinkChanges(v.proposedLinks);
    // What each proposed addition is, so the screen can name it.
    const added = {
      control: changes.add.filter((a) => a.target === 'control').map((a) => a.id),
      risk: changes.add.filter((a) => a.target === 'risk').map((a) => a.id),
      clause: changes.add.filter((a) => a.target === 'clause').map((a) => a.id),
    };
    const [ctl, rsk, cls] = await Promise.all([
      added.control.length ? prisma.control.findMany({ where: { id: { in: added.control } }, select: { id: true, code: true, title: true } }) : [],
      added.risk.length ? prisma.risk.findMany({ where: { id: { in: added.risk } }, select: { id: true, ref: true, title: true } }) : [],
      added.clause.length ? prisma.standardClause.findMany({ where: { id: { in: added.clause } }, select: { id: true, ref: true, title: true, standard: { select: { code: true } } } }) : [],
    ]);
    const labelOf = (a: { target: string; id: string }): string => {
      if (a.target === 'control') { const c = ctl.find((x) => x.id === a.id); return c ? `${c.code} — ${c.title}` : a.id; }
      if (a.target === 'risk') { const r = rsk.find((x) => x.id === a.id); return r ? `${r.ref} — ${r.title}` : a.id; }
      const c = cls.find((x) => x.id === a.id);
      return c ? `${c.standard.code} ${c.ref} — ${c.title}` : a.id;
    };
    const blocked = new Set([doc.ownerId, ...editors]);
    const inRound = (a: { createdAt: Date }) => Boolean(v.submittedAt) && a.createdAt.getTime() >= v.submittedAt!.getTime();
    res.json({
      status: 'success',
      live: { version: doc.version, title: doc.title, classification: doc.classification, category: doc.category, content: doc.content, fileName: doc.fileName, hash: versionHash(doc.content, doc.fileUrl) },
      version: {
        ...v,
        proposedLinks: { add: changes.add.map((a) => ({ ...a, label: labelOf(a) })), remove: changes.remove },
        editors: v.editors.map((e) => ({ userId: e.userId, name: e.user.name, via: e.via, editedAt: e.editedAt })),
        checkedOutBy: holder?.name ?? null,
        startedBy: starter?.name ?? null,
        suggestions,
        liveMoved: versionHash(doc.content, doc.fileUrl) !== v.baseHash,
      },
      approvals,
      // The current round only: rows stamped with the last submission.
      approved: approvals.filter((a) => a.status === 'APPROVED' && inRound(a)).length,
      approvers: approvals.filter((a) => a.status !== 'WITHDRAWN' && inRound(a)).length,
      // Earlier approvers offered again, if they can still sign and did not write this version.
      suggestedApprovers: previous.filter((p) => !blocked.has(p.approverId) && everyoneWhoSigns.some((s) => s.id === p.approverId))
        .map((p) => ({ id: p.approverId, name: p.approver.name })),
      approverChoices: everyoneWhoSigns.filter((s) => !blocked.has(s.id)),
      can: {
        edit: manage && isEditableState(v.state) && !frozen(doc),
        checkIn: v.checkedOutById === userId,
        submit: manage && isEditableState(v.state) && !v.checkedOutById && !frozen(doc),
        publish: v.state === 'Approved' && !frozen(doc) && (await hasCapability(userId, CAP.SIGN_DOCUMENT)),
        discard: (doc.ownerId === userId || manage) && isOpenState(v.state),
      },
    });
  } catch (error: any) {
    console.error('[Next Version Read Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the next version' });
  }
};

// ─── Proposals ──────────────────────────────────────────────────────────────

/**
 * PATCH /api/documents/:id/next-version { changeType?, proposedTitle?,
 * proposedClassification?, proposedCategory?, proposedAudienceKind?,
 * proposedAudienceValue?, proposedLinks? }
 *
 * Proposals apply to the document only at publish. The change type, and so
 * the number, can change until the version is submitted.
 */
export const updateNextVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const doc = await loadDoc(req);
    if (!doc) { send(res, 404, 'NOT_FOUND', 'Document not found'); return; }
    if (!(await mayManage(doc, userId))) { send(res, 403, 'NOT_PERMITTED', 'The owner, or someone who versions documents, changes a next version.'); return; }
    if (frozen(doc)) { send(res, 423, 'LEGAL_HOLD', 'This document is under legal hold.'); return; }
    const v = await openVersion(doc);
    if (!v) { send(res, 404, 'NO_OPEN_VERSION', 'This document has no open next version.'); return; }
    if (!isEditableState(v.state)) { send(res, 409, 'NOT_EDITABLE', `Version ${v.versionNumber} is ${v.state}; it changes only while a draft or returned.`); return; }
    const b = req.body || {};
    const data: Record<string, unknown> = {};
    if (b.changeType !== undefined) {
      if (!(CHANGE_TYPES as readonly string[]).includes(str(b.changeType))) { send(res, 400, 'BAD_CHANGE_TYPE', 'A next version is Minor or Major.'); return; }
      data.changeType = str(b.changeType);
      data.versionNumber = nextNumber(v.baseVersion || doc.version, str(b.changeType));
    }
    if (b.proposedTitle !== undefined) {
      const t = str(b.proposedTitle).trim();
      if (t.length < 3) { send(res, 400, 'BAD_TITLE', 'A title is at least 3 characters.'); return; }
      data.proposedTitle = t.slice(0, 300);
    }
    if (b.proposedClassification !== undefined) {
      // Checked, not normalised: an unknown word would otherwise become Confidential unseen.
      const c = str(b.proposedClassification);
      if (!(CLASSIFICATIONS as readonly string[]).includes(c)) {
        send(res, 400, 'BAD_CLASSIFICATION', `The classification is one of ${CLASSIFICATIONS.join(', ')}.`); return;
      }
      data.proposedClassification = c;
    }
    if (b.proposedCategory !== undefined) data.proposedCategory = str(b.proposedCategory).trim().slice(0, 120) || doc.category;
    if (b.proposedAudienceKind !== undefined) {
      const k = str(b.proposedAudienceKind);
      if (!(AUDIENCE_KINDS as readonly string[]).includes(k)) { send(res, 400, 'BAD_AUDIENCE', `The audience is one of ${AUDIENCE_KINDS.join(', ')}.`); return; }
      data.proposedAudienceKind = k;
      data.proposedAudienceValue = k === 'Everyone' ? null : str(b.proposedAudienceValue).trim() || null;
    }
    if (b.proposedLinks !== undefined) {
      const checked = checkLinkChanges(b.proposedLinks);
      if (!checked.ok) { send(res, 400, 'BAD_LINKS', checked.message); return; }
      // Each addition checked as adding it now would be: it exists, it belongs here.
      for (const target of ['control', 'risk', 'clause'] as const) {
        const ids = checked.value.add.filter((a) => a.target === target).map((a) => a.id);
        if (!ids.length) continue;
        const plan = planDocumentLinks({
          documentTenantId: doc.tenantId, documentStatus: 'DRAFT', target, requested: ids,
          found: await loadCandidates(target, ids, doc.tenantId), existing: [],
        });
        if (!plan.ok) { send(res, plan.status, plan.code, plan.message); return; }
      }
      const own = new Set((await prisma.documentLink.findMany({ where: { documentId: doc.id }, select: { id: true } })).map((l) => l.id));
      if (checked.value.remove.some((id) => !own.has(id))) { send(res, 400, 'BAD_LINKS', 'Only this document\'s own links can be removed.'); return; }
      data.proposedLinks = JSON.stringify(checked.value);
    }
    if (Object.keys(data).length === 0) { res.json({ status: 'success', changed: false }); return; }
    await prisma.$transaction(async (tx) => {
      await tx.documentVersion.update({ where: { id: v.id }, data });
      await writeAudit(tx, {
        tenantId: doc.tenantId, actorId: userId, action: 'DOCUMENT_VERSION_PROPOSALS_CHANGED', subjectType: SUBJECT, subjectId: doc.id,
        payload: { code: doc.code, version: data.versionNumber ?? v.versionNumber, changed: Object.keys(data) },
      });
    });
    res.json({ status: 'success', changed: true });
  } catch (error: any) {
    console.error('[Next Version Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to change the next version' });
  }
};

// ─── Check out and check in ─────────────────────────────────────────────────

/** POST /api/documents/:id/next-version/checkout — the open version only; the live document is never locked. */
export const checkoutNextVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const doc = await loadDoc(req);
    if (!doc) { send(res, 404, 'NOT_FOUND', 'Document not found'); return; }
    if (!(await mayManage(doc, userId))) { send(res, 403, 'NOT_PERMITTED', 'The owner, or someone who versions documents, edits a next version.'); return; }
    if (frozen(doc)) { send(res, 423, 'LEGAL_HOLD', 'This document is under legal hold.'); return; }
    const v = await openVersion(doc);
    if (!v) { send(res, 404, 'NO_OPEN_VERSION', 'This document has no open next version.'); return; }
    if (!isEditableState(v.state)) { send(res, 409, 'NOT_EDITABLE', `Version ${v.versionNumber} is ${v.state}.`); return; }
    await prisma.$transaction(async (tx) => {
      const taken = await tx.documentVersion.updateMany({
        where: { id: v.id, checkedOutById: null }, data: { checkedOutById: userId, checkedOutAt: new Date() },
      });
      if (taken.count === 0) throw new Refused(409, 'CHECKED_OUT', 'This version is checked out by someone else.');
      await writeAudit(tx, {
        tenantId: doc.tenantId, actorId: userId, action: 'DOCUMENT_VERSION_CHECKED_OUT', subjectType: SUBJECT, subjectId: doc.id,
        payload: { code: doc.code, version: v.versionNumber },
      });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Refused) { send(res, error.status, error.code, error.message); return; }
    console.error('[Next Version Checkout Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to check out the next version' });
  }
};

/**
 * POST /api/documents/:id/next-version/checkin { content, summary? }
 *
 * Writes the open version's text, records the person as one of its editors,
 * and leaves the number where the change type put it. A revised file arrives
 * with the document upload hardening; this takes text.
 */
export const checkinNextVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const doc = await loadDoc(req);
    if (!doc) { send(res, 404, 'NOT_FOUND', 'Document not found'); return; }
    if (frozen(doc)) { send(res, 423, 'LEGAL_HOLD', 'This document is under legal hold.'); return; }
    const v = await openVersion(doc);
    if (!v) { send(res, 404, 'NO_OPEN_VERSION', 'This document has no open next version.'); return; }
    if (v.checkedOutById !== userId) { send(res, 403, 'NOT_CHECKED_OUT', 'Check the version out before checking it in.'); return; }
    if (req.body?.fileData) { send(res, 400, 'TEXT_ONLY', 'A next version takes revised text for now; a revised file follows with the upload hardening.'); return; }
    const content = str(req.body?.content);
    if (content.trim().length === 0) { send(res, 400, 'CONTENT_REQUIRED', 'The version needs its text.'); return; }
    const summary = req.body?.summary ? str(req.body.summary).trim().slice(0, 2000) : v.summary;
    await prisma.$transaction(async (tx) => {
      await tx.documentVersion.update({
        where: { id: v.id },
        data: { content, summary, fileHash: versionHash(content, v.fileUrl), checkedOutById: null, checkedOutAt: null },
      });
      await tx.documentVersionEditor.upsert({
        where: { versionId_userId: { versionId: v.id, userId } },
        create: { versionId: v.id, userId, via: 'CHECKIN' },
        update: { editedAt: new Date() },
      });
      await writeAudit(tx, {
        tenantId: doc.tenantId, actorId: userId, action: 'DOCUMENT_VERSION_CHECKED_IN', subjectType: SUBJECT, subjectId: doc.id,
        payload: { code: doc.code, version: v.versionNumber, hash: versionHash(content, v.fileUrl) },
      });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    console.error('[Next Version Checkin Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to check in the next version' });
  }
};

// ─── Submit ─────────────────────────────────────────────────────────────────

/**
 * POST /api/documents/:id/next-version/submit { summary, approverIds? }
 *
 * The change summary ("what changed and why") is required. Approval rows
 * point at the version; the owner and the version's editors cannot approve.
 * The document stays PUBLISHED throughout.
 */
export const submitNextVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const doc = await loadDoc(req);
    if (!doc) { send(res, 404, 'NOT_FOUND', 'Document not found'); return; }
    if (!(await mayManage(doc, userId))) { send(res, 403, 'NOT_PERMITTED', 'The owner, or someone who versions documents, submits a next version.'); return; }
    if (frozen(doc)) { send(res, 423, 'LEGAL_HOLD', 'This document is under legal hold.'); return; }
    const v = await openVersion(doc);
    if (!v) { send(res, 404, 'NO_OPEN_VERSION', 'This document has no open next version.'); return; }
    if (!isEditableState(v.state)) { send(res, 409, 'NOT_EDITABLE', `Version ${v.versionNumber} is ${v.state}.`); return; }
    if (v.checkedOutById) { send(res, 409, 'CHECKED_OUT', 'Check the version in before submitting it.'); return; }
    const summary = str(req.body?.summary).trim();
    if (!noteIsEnough(summary)) { send(res, 400, 'SUMMARY_REQUIRED', `Say what changed and why — at least ${MIN_NOTE} characters.`); return; }

    const editors = versionEditorIds({ createdById: v.createdById, editors: v.editors });
    // Only people who can sign are asked: anyone else would hold the version in review for ever.
    const eligible = new Set((await signers(doc.tenantId)).map((s) => s.id));
    const chosen = Array.isArray(req.body?.approverIds) ? (req.body.approverIds as unknown[]).map(str).filter(Boolean) : [];
    if (chosen.some((id) => !eligible.has(id))) {
      send(res, 400, 'NOT_A_SIGNER', 'Every approver must be an active person of the organisation who can approve documents.'); return;
    }
    const blocked = chosen.filter((id) => id === doc.ownerId || editors.includes(id));
    if (blocked.length) {
      send(res, 403, 'SELF_APPROVAL', 'The owner, and anyone who edited this version, cannot approve it. Choose someone else.'); return;
    }
    const approvers = chosen.length > 0
      ? approversWhoDidNotEdit(chosen, editors, doc.ownerId)
      : approversWhoDidNotEdit([...eligible], editors, doc.ownerId).slice(0, 3);
    if (approvers.length === 0) { send(res, 400, 'NO_APPROVER', 'At least one approver who did not write this version, and is not its owner, is needed.'); return; }

    // One moment stamps the round: its rows and the version share it, so an
    // earlier round's signatures (on earlier text) are history, not progress.
    const round = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.approvalQueue.deleteMany({ where: { versionId: v.id, status: 'PENDING' } });
      await tx.approvalQueue.createMany({
        data: approvers.map((approverId, i) => ({
          documentId: doc.id, versionId: v.id, approverId, sequenceOrder: i + 1, status: 'PENDING', createdAt: round,
        })),
      });
      const moved = await tx.documentVersion.updateMany({
        where: { id: v.id, state: { in: ['Draft', 'Returned'] } }, data: { state: 'InReview', summary, submittedAt: round },
      });
      if (moved.count === 0) throw new Refused(409, 'NOT_EDITABLE', 'The version changed while you were submitting it. Reload it.');
      await writeAudit(tx, {
        tenantId: doc.tenantId, actorId: userId, action: 'DOCUMENT_VERSION_SUBMITTED', subjectType: SUBJECT, subjectId: doc.id,
        payload: { code: doc.code, version: v.versionNumber, approverIds: approvers, summary },
      });
      await notify(tx, approvers.map((recipientId) => ({
        tenantId: doc.tenantId, recipientId, actorId: userId, event: 'DOCUMENT_VERSION_SUBMITTED', subjectType: SUBJECT, subjectId: doc.id,
        title: `Approve ${doc.code} v${v.versionNumber}`, body: summary, link: 'tasks',
      })));
    });
    res.json({ status: 'success', message: `Version ${v.versionNumber} submitted to ${approvers.length} approver(s).` });
  } catch (error: any) {
    if (error instanceof Refused) { send(res, error.status, error.code, error.message); return; }
    console.error('[Next Version Submit Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit the next version' });
  }
};

// ─── Approve and reject (called by the document's approve and reject routes) ─

/**
 * One approver signs a next version: the version's own text and file, with the
 * same step-up, sequence and separation-of-duties checks as a document; the
 * version's editors cannot sign it. All signed, the version is Approved and
 * the live document is unchanged.
 */
export async function approveVersion(args: {
  doc: Doc; approval: { id: string; sequenceOrder: number; versionId: string };
  userId: string; userRole: string; decision?: string; ip: string; userAgent: string;
}): Promise<{ allApproved: boolean; signatureHash: string; version: string }> {
  const v = await prisma.documentVersion.findUnique({ where: { id: args.approval.versionId }, select: VERSION_SELECT });
  if (!v || v.state !== 'InReview') throw new Refused(409, 'NOT_IN_REVIEW', 'That version is not waiting for approval.');
  const earlier = await prisma.approvalQueue.findFirst({
    where: { versionId: v.id, status: 'PENDING', sequenceOrder: { lt: args.approval.sequenceOrder } },
  });
  if (earlier) throw new Refused(409, 'SEQUENCE', 'An earlier approver in the sequence must decide first');
  const timestamp = new Date().toISOString();
  const contentHash = generateHash(`${v.content ?? ''}|${v.fileUrl || ''}`);
  const signatureHash = generateHash(`APPROVE:${args.doc.id}:${v.versionNumber}:${contentHash}:${args.userId}:${args.userRole}:${timestamp}`);
  const allApproved = await prisma.$transaction(async (tx) => {
    const refusal = selfApprovalRefusal(args.userId, versionEditorIds({ createdById: v.createdById, editors: v.editors }));
    if (refusal) throw Object.assign(new Error(refusal.message), { status: refusal.status, code: refusal.code });
    await checkSod(tx, {
      tenantId: args.doc.tenantId, actorId: args.userId, guardedAction: 'DOCUMENT_APPROVED', subjectType: SUBJECT, subjectId: args.doc.id,
    });
    await tx.approvalQueue.update({
      where: { id: args.approval.id },
      data: {
        status: 'APPROVED', decision: args.decision || 'Approved', signatureHash, signerRole: args.userRole,
        sessionInfo: `IP:${args.ip}|UA:${args.userAgent.substring(0, 80)}`, reviewedAt: new Date(),
      },
    });
    const remaining = await tx.approvalQueue.count({ where: { versionId: v.id, status: 'PENDING' } });
    if (remaining === 0) await tx.documentVersion.update({ where: { id: v.id }, data: { state: 'Approved' } });
    await writeAudit(tx, {
      tenantId: args.doc.tenantId, actorId: args.userId, action: 'DOCUMENT_VERSION_APPROVED', subjectType: SUBJECT, subjectId: args.doc.id,
      payload: { code: args.doc.code, version: v.versionNumber, signatureHash, contentHash, allApproved: remaining === 0 },
    });
    return remaining === 0;
  });
  return { allApproved, signatureHash, version: v.versionNumber };
}

/** One approver returns a next version: it goes back to Returned; the live document is untouched. */
export async function rejectVersion(args: {
  doc: Doc; approval: { id: string; versionId: string }; userId: string; reason?: string;
}): Promise<string> {
  const v = await prisma.documentVersion.findUnique({ where: { id: args.approval.versionId }, select: { id: true, versionNumber: true, state: true } });
  if (!v || v.state !== 'InReview') throw new Refused(409, 'NOT_IN_REVIEW', 'That version is not waiting for approval.');
  await prisma.$transaction(async (tx) => {
    await tx.approvalQueue.update({
      where: { id: args.approval.id }, data: { status: 'REJECTED', reason: args.reason || 'Rejected by reviewer', reviewedAt: new Date() },
    });
    await tx.documentVersion.update({ where: { id: v.id }, data: { state: 'Returned' } });
    await writeAudit(tx, {
      tenantId: args.doc.tenantId, actorId: args.userId, action: 'DOCUMENT_VERSION_RETURNED', subjectType: SUBJECT, subjectId: args.doc.id,
      payload: { code: args.doc.code, version: v.versionNumber, reason: args.reason ?? null },
    });
  });
  return v.versionNumber;
}

export { Refused as VersionRefused };

// ─── Publish ────────────────────────────────────────────────────────────────

/**
 * POST /api/documents/:id/next-version/publish { audienceKind?, audienceValue? }
 *
 * One transaction: the replaced version is kept as Superseded (snapshotting
 * the live row first if its text no longer matches its version row); the
 * approved version is copied into the document with its proposals and link
 * changes; open acknowledgement requests for replaced versions are closed as
 * superseded and the audience is asked as the Major/Minor rule says; any
 * search chunks are cleared so nothing quotes the replaced text; readers and
 * the owners of distributed copies are told.
 */
export const publishNextVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const doc = await loadDoc(req);
    if (!doc) { send(res, 404, 'NOT_FOUND', 'Document not found'); return; }
    if (frozen(doc)) { send(res, 423, 'LEGAL_HOLD', 'This document is under legal hold and cannot be published.'); return; }
    const v = await openVersion(doc);
    if (!v) { send(res, 404, 'NO_OPEN_VERSION', 'This document has no open next version.'); return; }
    if (v.state !== 'Approved') { send(res, 409, 'NOT_APPROVED', `Version ${v.versionNumber} is ${v.state}; only an approved version is published.`); return; }

    const [users, requests, signatures] = await Promise.all([
      prisma.user.findMany({ where: { tenantId: doc.tenantId }, select: { id: true, name: true, status: true, department: true, role: true } }),
      prisma.acknowledgementRequest.findMany({ where: { documentId: doc.id, supersededAt: null }, select: { userId: true, version: true } }),
      prisma.acknowledgement.findMany({ where: { documentId: doc.id }, select: { userId: true, version: true } }),
    ]);
    const plan = planPublication({
      document: { status: 'APPROVED', version: v.versionNumber, publishedVersion: doc.publishedVersion },
      kind: req.body?.audienceKind ?? v.proposedAudienceKind ?? doc.audienceKind,
      value: req.body?.audienceValue ?? v.proposedAudienceValue ?? doc.audienceValue,
      users, alreadyAsked: [],
    });
    if (!plan.ok) { send(res, plan.status, plan.code, plan.message); return; }
    const signedKey = new Set(signatures.map((s) => `${s.userId}@${s.version ?? ''}`));
    const acks = planAcknowledgements({
      previousVersion: doc.version, newVersion: v.versionNumber, audienceIds: plan.recipientIds,
      openRequests: requests.map((r) => ({ ...r, signed: signedKey.has(`${r.userId}@${r.version}`) })),
      signatures,
    });
    const changes = readLinkChanges(v.proposedLinks);
    // Checked again: a record proposed weeks ago may have gone since.
    for (const target of ['control', 'risk', 'clause'] as const) {
      const ids = changes.add.filter((a) => a.target === target).map((a) => a.id);
      if (!ids.length) continue;
      const check = planDocumentLinks({
        documentTenantId: doc.tenantId, documentStatus: 'DRAFT', target, requested: ids,
        found: await loadCandidates(target, ids, doc.tenantId), existing: [],
      });
      if (!check.ok) {
        // Publishing without it would publish something other than what was approved.
        send(res, 409, 'LINKS_CHANGED', `A proposed link can no longer be made: ${check.message} Discard this version and start again without it.`); return;
      }
    }
    const now = new Date();
    const liveHash = versionHash(doc.content, doc.fileUrl);
    const newHash = versionHash(v.content, v.fileUrl);

    const result = await prisma.$transaction(async (tx) => {
      // The version being replaced, kept exactly as it was while in force.
      // A row of the original flow has no state; NOT IN would skip it.
      const liveRow = await tx.documentVersion.findFirst({
        where: {
          documentId: doc.id, versionNumber: doc.version, id: { not: v.id },
          OR: [{ state: null }, { state: 'Published' }],
        },
        orderBy: { createdAt: 'desc' }, select: { id: true, content: true, fileUrl: true },
      });
      // Its disposal date is set below, with the document's, from the day it was replaced.
      const superseded = { state: 'Superseded', supersededAt: now, supersededBy: v.versionNumber };
      let supersededId: string;
      if (liveRow && versionHash(liveRow.content, liveRow.fileUrl) === liveHash) {
        await tx.documentVersion.update({ where: { id: liveRow.id }, data: superseded });
        supersededId = liveRow.id;
      } else {
        // The live text was changed without a check-in: keep what was actually in force.
        const snap = await tx.documentVersion.create({
          data: {
            documentId: doc.id, versionNumber: doc.version, changeType: 'Minor', summary: 'The text in force when it was replaced',
            content: doc.content, fileUrl: doc.fileUrl, fileName: doc.fileName, fileSize: doc.fileSize, fileType: doc.fileType,
            fileHash: liveHash, publishedAt: doc.publishedAt, publishedById: doc.publishedById, ...superseded,
          },
          select: { id: true },
        });
        supersededId = snap.id;
      }

      const moved = await tx.documentVersion.updateMany({
        where: { id: v.id, state: 'Approved' }, data: { state: 'Published', publishedAt: now, publishedById: userId },
      });
      if (moved.count === 0) throw new Refused(409, 'NOT_APPROVED', 'The version changed while you were publishing it. Reload it.');
      await tx.document.update({
        where: { id: doc.id },
        data: {
          content: v.content ?? '', fileUrl: v.fileUrl, fileName: v.fileName, fileSize: v.fileSize, fileType: v.fileType,
          version: v.versionNumber, publishedVersion: v.versionNumber, publishedAt: now, publishedById: userId,
          title: v.proposedTitle ?? doc.title, classification: v.proposedClassification ?? doc.classification,
          category: v.proposedCategory ?? doc.category, audienceKind: plan.kind, audienceValue: plan.value, openVersionId: null,
        },
      });

      if (changes.remove.length) await tx.documentLink.deleteMany({ where: { documentId: doc.id, id: { in: changes.remove } } });
      if (changes.add.length) {
        await tx.documentLink.createMany({
          data: changes.add.map((a) => ({
            documentId: doc.id, controlId: a.target === 'control' ? a.id : null, riskId: a.target === 'risk' ? a.id : null,
            clauseId: a.target === 'clause' ? a.id : null, note: a.note, linkedById: userId,
          })),
          skipDuplicates: true,
        });
      }

      // The live document's Published clock restarts; search drops the replaced text.
      await recomputeDisposalDue(tx as any, doc.id);
      await tx.documentChunk.deleteMany({ where: { documentId: doc.id } });

      for (const s of acks.supersede) {
        await tx.acknowledgementRequest.updateMany({
          where: { documentId: doc.id, userId: s.userId, version: s.version, supersededAt: null },
          data: { supersededAt: now, supersededBy: v.versionNumber },
        });
      }
      if (acks.ask.length) {
        await tx.acknowledgementRequest.createMany({
          data: acks.ask.map((uid) => ({ documentId: doc.id, version: v.versionNumber, userId: uid, requestedById: userId })),
          skipDuplicates: true,
        });
      }

      await writeAudit(tx, {
        tenantId: doc.tenantId, actorId: userId, action: 'DOCUMENT_VERSION_SUPERSEDED', subjectType: SUBJECT, subjectId: doc.id,
        payload: {
          code: doc.code, superseded: { version: doc.version, hash: liveHash, versionRowId: supersededId },
          by: { version: v.versionNumber, hash: newHash }, requestsSuperseded: acks.supersede.length,
        },
      });
      await writeAudit(tx, {
        tenantId: doc.tenantId, actorId: userId, action: 'DOCUMENT_PUBLISHED', subjectType: SUBJECT, subjectId: doc.id,
        payload: {
          documentId: doc.id, version: v.versionNumber, audienceKind: plan.kind, audienceValue: plan.value, asked: acks.ask.length,
          linksAdded: changes.add.length, linksRemoved: changes.remove.length,
        },
      });
      await notify(tx, acks.ask.map((recipientId) => ({
        tenantId: doc.tenantId, recipientId, actorId: userId, event: 'DOCUMENT_PUBLISHED', subjectType: SUBJECT, subjectId: doc.id,
        title: `Please read and acknowledge: ${v.proposedTitle ?? doc.title}`,
        body: `${doc.code} v${v.versionNumber} replaces v${doc.version}. You have been asked to confirm you have read it.`,
        link: 'acknowledgements',
      })));
      // Copies distributed to subsidiaries are theirs to adopt; they are told.
      const copies = await tx.document.findMany({ where: { inheritedFromId: doc.id }, select: { id: true, tenantId: true, ownerId: true, code: true } });
      await notify(tx, copies.map((c) => ({
        tenantId: c.tenantId, recipientId: c.ownerId, actorId: userId, event: 'DOCUMENT_MASTER_REVISED', subjectType: SUBJECT, subjectId: c.id,
        title: `The master of ${c.code} has a new version, v${v.versionNumber}`,
        body: 'Adopting it is your decision: start a next version of your copy if it should follow.', link: 'library',
      })));
      const pulled = await tx.documentSuggestion.findMany({
        where: { versionId: v.id, status: 'Pulled' },
        select: { id: true, ref: true, projectId: true, authorId: true, author: { select: { tenantId: true } }, project: { select: { ref: true, providerTenantId: true } } },
      });
      if (pulled.length) {
        await tx.documentSuggestion.updateMany({
          where: { id: { in: pulled.map((p) => p.id) } },
          data: { status: 'Accepted', acceptedInto: v.versionNumber, decidedAt: now, decidedById: userId },
        });
        await writeAudit(tx, {
          tenantId: doc.tenantId, actorId: userId, action: 'ENGAGEMENT_SUGGESTIONS_ACCEPTED', subjectType: SUBJECT, subjectId: doc.id,
          payload: { code: doc.code, version: v.versionNumber, suggestions: pulled.map((p) => `${p.project.ref}/${p.ref}`) },
        });
        // Each firm's trail names its own suggestions only.
        const firms = new Map<string, string[]>();
        for (const p of pulled) if (p.project.providerTenantId) firms.set(p.project.providerTenantId, [...(firms.get(p.project.providerTenantId) ?? []), `${p.project.ref}/${p.ref}`]);
        for (const [firmTenantId, refs] of firms) {
          await writeAudit(tx, {
            tenantId: firmTenantId, actorId: userId, action: 'ENGAGEMENT_SUGGESTIONS_ACCEPTED', subjectType: SUBJECT, subjectId: doc.id,
            payload: { code: doc.code, version: v.versionNumber, clientTenantId: doc.tenantId, suggestions: refs },
          });
        }
        await notify(tx, pulled.map((p) => ({
          tenantId: p.author.tenantId, recipientId: p.authorId, actorId: userId, event: 'ENGAGEMENT_SUGGESTION_ACCEPTED',
          subjectType: 'DocumentSuggestion', subjectId: p.id,
          title: `${p.ref} accepted into ${doc.code} v${v.versionNumber}`, body: 'Your suggestion is in the published version.', link: 'project-delivery',
        })));
      }
      return { asked: acks.ask.length, superseded: acks.supersede.length };
    });
    res.json({
      status: 'success', message: `Version ${v.versionNumber} is now in force; v${doc.version} is superseded.`,
      version: v.versionNumber, asked: result.asked, requestsSuperseded: result.superseded,
      // Said by the Major/Minor rule, not the first-publication warnings, which would say everyone is asked again.
      acknowledgements: sameMajor(doc.version, v.versionNumber)
        ? `A minor version: whoever acknowledged v${doc.version.split('.')[0]}.x is not asked again; ${result.asked} asked.`
        : `A major version: everyone in the audience is asked again; ${result.asked} asked.`,
    });
  } catch (error: any) {
    if (error instanceof Refused) { send(res, error.status, error.code, error.message); return; }
    console.error('[Next Version Publish Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to publish the next version' });
  }
};

// ─── Discard ────────────────────────────────────────────────────────────────

/**
 * POST /api/documents/:id/next-version/discard { reason } — the owner drops
 * the open version. It is kept as Discarded for the trail; approvals not yet
 * given are withdrawn.
 */
export const discardNextVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const doc = await loadDoc(req);
    if (!doc) { send(res, 404, 'NOT_FOUND', 'Document not found'); return; }
    const owner = await prisma.user.findUnique({ where: { id: doc.ownerId }, select: { status: true } });
    // The owner discards; if the owner is no longer active, whoever versions documents can.
    const allowed = doc.ownerId === userId || (owner?.status !== 'Active' && (await hasCapability(userId, CAP.VERSION_DOCUMENT)));
    if (!allowed) { send(res, 403, 'OWNER_DISCARDS', 'The document\'s owner discards its next version.'); return; }
    const v = await openVersion(doc);
    if (!v) { send(res, 404, 'NO_OPEN_VERSION', 'This document has no open next version.'); return; }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, 400, 'REASON_REQUIRED', `Say why — at least ${MIN_NOTE} characters.`); return; }
    await prisma.$transaction(async (tx) => {
      const moved = await tx.documentVersion.updateMany({
        where: { id: v.id, state: { in: ['Draft', 'InReview', 'Approved', 'Returned'] } },
        data: { state: 'Discarded', discardedAt: new Date(), discardedById: userId, discardReason: reason, checkedOutById: null, checkedOutAt: null },
      });
      if (moved.count === 0) throw new Refused(409, 'NOT_OPEN', 'That version is no longer open.');
      await tx.approvalQueue.updateMany({ where: { versionId: v.id, status: 'PENDING' }, data: { status: 'WITHDRAWN', reason: 'Version discarded', reviewedAt: new Date() } });
      await tx.document.update({ where: { id: doc.id }, data: { openVersionId: null } });
      // Suggestions pulled into it are open again, to pull into the next one.
      await tx.documentSuggestion.updateMany({
        where: { versionId: v.id, status: 'Pulled' },
        data: { status: 'Open', versionId: null, pulledAt: null, pulledById: null, wordingAppliedAt: null },
      });
      await writeAudit(tx, {
        tenantId: doc.tenantId, actorId: userId, action: 'DOCUMENT_VERSION_DISCARDED', subjectType: SUBJECT, subjectId: doc.id,
        payload: { code: doc.code, version: v.versionNumber, state: v.state, reason },
      });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Refused) { send(res, error.status, error.code, error.message); return; }
    console.error('[Next Version Discard Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to discard the next version' });
  }
};

// ─── An earlier version ─────────────────────────────────────────────────────

/**
 * GET /api/documents/:id/versions/:versionId/download — one version as it
 * was. A superseded version is printed with "Superseded on … by v… — not in
 * force". Readers of the document see the versions that were in force; the
 * open, returned or discarded drafts only to the people who manage or approve
 * them. A disposed version has nothing left to give.
 */
export const downloadVersion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const doc = await loadDoc(req);
    if (!doc) { send(res, 404, 'NOT_FOUND', NOT_FOUND_MESSAGE); return; }
    const v = await prisma.documentVersion.findFirst({ where: { id: str(req.params.versionId), documentId: doc.id }, select: VERSION_SELECT });
    if (!v) { send(res, 404, 'NOT_FOUND', 'Version not found'); return; }
    const wasInForce = v.state === null || v.state === 'Published' || v.state === 'Superseded';
    if (!wasInForce && !(await mayManage(doc, userId)) && !(await hasCapability(userId, CAP.SIGN_DOCUMENT))) {
      send(res, 404, 'NOT_FOUND', 'Version not found'); return;
    }
    if (v.disposedAt) { send(res, 410, 'DISPOSED', `Version ${v.versionNumber} was disposed of under the retention schedule; only its record remains.`); return; }
    const label = v.state === 'Superseded' && v.supersededAt && v.supersededBy ? supersededLabel(v.supersededAt, v.supersededBy) : null;
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: doc.tenantId, actorId: userId, action: 'DOCUMENT_VERSION_DOWNLOADED', subjectType: SUBJECT, subjectId: doc.id,
        payload: { code: doc.code, version: v.versionNumber, state: v.state },
      });
    });
    // A header carries ASCII only; the printed label keeps its dash.
    if (label) res.setHeader('X-Version-Status', label.replace(/—/g, '-'));
    // A stored file of that version, where it has one of its own.
    // Typed and sandboxed as deliverDocument serves the live file: an old .html
    // or .svg must not go out as a page that runs script.
    const full = v.content ? null : resolveDocumentFile(v.fileUrl);
    if (full) {
      res.setHeader('Content-Type', servedTypeOf(v.fileUrl, v.fileType, full));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.download(full, label ? `${doc.code}_v${v.versionNumber}_SUPERSEDED_${v.fileName || 'file'}` : (v.fileName || `${doc.code}_v${v.versionNumber}`));
      return;
    }
    const text = [
      `Document        : ${doc.code} — ${doc.title}`,
      `Version         : v${v.versionNumber}`,
      `Status          : ${label ?? (v.state ?? 'Version history')}`,
      `Hash (SHA-256)  : ${versionHash(v.content, v.fileUrl)}`,
      '',
      v.content ?? '',
    ].join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.code.replace(/[^a-zA-Z0-9_-]/g, '_')}_v${v.versionNumber}${label ? '_SUPERSEDED' : ''}.txt"`);
    res.send(text);
  } catch (error: any) {
    console.error('[Version Download Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to download the version' });
  }
};
