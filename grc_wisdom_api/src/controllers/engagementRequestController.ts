import { Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { readPage, pageInfo } from '../utils/paging';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { getEffectivePermissions, CAP } from '../services/capabilityEngine';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { roleMay, roleRefusal, EngagementAction } from '../services/engagementRules';
import { firmAccess, FirmAccess } from '../services/engagementFirmAccess';
import { bindingScope, registerScope, Scope } from '../services/engagementScope';
import { isEnded } from '../services/engagementAfterClose';
import { hierarchyOf } from '../services/scopeResolver';
import { decodeUpload, putEvidence, resolveEvidencePath, verifyStoredHash } from '../services/evidenceStore';
import { checkEvidenceFile, sniffMime, EVIDENCE_CLASSIFICATIONS } from '../services/projectEvidence';
import {
  REQUEST_KINDS, ANSWER_KINDS, AWAITING_ANSWER, LIVE, TESTS, checkReview, parseDay, overdueDays, dueDuringHold,
  resolveTarget, answerClassifications, acceptedClauseIds,
} from '../services/engagementRequests';
import { createRequests } from '../services/engagementRequestStore';
import { nextImpedimentRef } from './projectImpedimentController';
import {
  str, send, notFound, loadEngagement, clientSide, flagFor, HELD_READ_ONLY, Engagement,
} from './engagementController';

/**
 * Information requests (consulting engagement, sprint 8).
 *
 * The firm's Lead and Consultants ask; its Reviewers see. The organisation's
 * assignee or project manager answers, by uploading a file, linking evidence
 * it already holds, a published document or a record the scope already
 * shares, or in words, or declines with a reason. The firm reviews: evidence
 * against four tests, and every return says what is missing. Answers belong
 * to the organisation; the firm reads them through the request, only while
 * its access is open, and downloads only where the organisation allows.
 *
 * Every write is on both organisations' trails: the organisation's in full,
 * the firm's as a summary.
 */

type Access =
  | { ok: true; e: Engagement; side: 'Client'; userId: string; manager: boolean }
  | { ok: true; e: Engagement; side: 'Provider'; userId: string; firm: FirmAccess }
  | { ok: false; status: number; code?: string; message: string };

/** The engagement and which side the caller reads it from; anyone else gets a 404. */
async function access(req: AuthenticatedRequest): Promise<Access> {
  const e = await loadEngagement(str(req.params.projectId));
  const userId = str(req.user!.id);
  if (!e) return { ok: false, status: 404, message: 'Engagement not found' };
  if (await clientSide(req, e)) {
    const refusal = await flagFor(e);
    if (refusal) return { ok: false, ...refusal };
    const perms = await getEffectivePermissions(userId);
    return { ok: true, e, side: 'Client', userId, manager: perms.capabilities.includes(CAP.MANAGE_PROJECT) };
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

const fail = (res: Response, a: { status: number; code?: string; message: string }) => send(res, a);

/**
 * Both organisations' trails, written against the request (or the blocker it
 * became), so its history can be read from the record itself: the
 * organisation's in full, the firm's a summary naming the client.
 */
async function requestTrails(tx: any, args: {
  e: Engagement; actorId: string; action: string; subjectType: string; subjectId: string;
  payload: Record<string, unknown>; firmPayload?: Record<string, unknown>;
}) {
  await writeAudit(tx, {
    tenantId: args.e.tenantId, actorId: args.actorId, action: args.action, subjectType: args.subjectType, subjectId: args.subjectId,
    payload: { projectRef: args.e.ref, projectId: args.e.id, ...args.payload },
  });
  if (args.e.providerTenantId && args.e.providerTenantId !== args.e.tenantId) {
    await writeAudit(tx, {
      tenantId: args.e.providerTenantId, actorId: args.actorId, action: args.action, subjectType: args.subjectType, subjectId: args.subjectId,
      payload: { projectRef: args.e.ref, clientTenantId: args.e.tenantId, ...(args.firmPayload ?? args.payload) },
    });
  }
}

/** Whether the firm person may do this now: their role, the engagement running, inside their dates. */
function firmMay(a: Access, action: EngagementAction): { status: number; code?: string; message: string } | null {
  if (!a.ok || a.side !== 'Provider') return { status: 403, code: 'FIRM_ACTS', message: 'Only the delivery firm does this.' };
  if (!roleMay(a.firm.role, action)) return roleRefusal(a.firm.role, action);
  if (!a.firm.acts) {
    if (a.e.status === 'OnHold') return HELD_READ_ONLY;
    if (isEnded(a.e.status)) return { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` };
    return { status: 403, code: 'OUTSIDE_ACCESS', message: 'Your access to this engagement is not open today.' };
  }
  return null;
}

/** The organisation's work on a request: not while held, not once ended. */
function running(e: Engagement): { status: number; code?: string; message: string } | null {
  if (e.status === 'OnHold') return { status: 409, code: 'ON_HOLD', message: 'This engagement is on hold. Requests wait until it resumes.' };
  if (isEnded(e.status)) return { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${e.status}.` };
  return null;
}

const SELECT = {
  id: true, ref: true, kind: true, title: true, criteria: true, targetType: true, targetId: true, targetLabel: true,
  periodFrom: true, periodTo: true, dueDate: true, status: true, raisedAt: true, closedAt: true, closeNote: true,
  importedFrom: true, scopeChangeId: true, assigneeId: true, raisedById: true,
  raisedBy: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true, email: true } },
  closedBy: { select: { name: true } },
  _count: { select: { answers: true, reviews: true } },
} as const;

type Holds = { startedAt: Date; endedAt: Date | null }[];
const holdsOf = (projectId: string): Promise<Holds> => prisma.projectHold.findMany({ where: { projectId }, select: { startedAt: true, endedAt: true } });

function decorate(r: any, holds: Holds, now: Date) {
  const waiting = AWAITING_ANSWER.includes(r.status);
  return {
    ...r,
    overdueDays: waiting ? overdueDays(r.dueDate, holds, now) : 0,
    dueDuringHold: waiting && dueDuringHold(r.dueDate, holds),
  };
}

async function loadRequest(projectId: string, id: string) {
  return prisma.informationRequest.findFirst({ where: { id, projectId }, select: SELECT });
}

/** The client's people who may be given a request: the engagement's organisation-side team. */
async function teamMember(projectId: string, userId: string): Promise<boolean> {
  const m = await prisma.projectMember.findFirst({
    where: { projectId, userId, side: 'Client', active: true, user: { status: 'Active' } }, select: { id: true },
  });
  return Boolean(m);
}

// ─── Reading ────────────────────────────────────────────────────────────────

/** GET /api/engagements/:projectId/requests — the requests, newest first, and what the caller may do. */
export const listRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    const status = str(req.query.status);
    const now = new Date();
    if (str(req.query.overdue) === '1') {
      // Every request waiting past its due day, the hold days not counted.
      const [rows, holds] = await Promise.all([
        prisma.informationRequest.findMany({
          where: { projectId: a.e.id, status: { in: AWAITING_ANSWER }, dueDate: { lt: now } }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], select: SELECT,
        }),
        holdsOf(a.e.id),
      ]);
      const overdue = rows.map((r) => decorate(r, holds, now)).filter((r) => r.overdueDays > 0);
      const blocked = new Set((await prisma.projectImpediment.findMany({
        where: { informationRequestId: { in: overdue.map((r) => r.id) }, resolvedAt: null }, select: { informationRequestId: true },
      })).map((b) => b.informationRequestId));
      res.json({
        status: 'success', side: a.side,
        requests: overdue.map((r) => ({ ...r, blockerRecorded: blocked.has(r.id) })),
        can: {
          recordBlocker: !running(a.e) && ((a.side === 'Provider' && a.firm.acts && a.firm.role === 'Lead') || (a.side === 'Client' && a.manager)),
        },
      });
      return;
    }
    const where = { projectId: a.e.id, ...(status ? { status } : {}) };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const [total, rows, holds, counts, bound] = await Promise.all([
      prisma.informationRequest.count({ where }),
      prisma.informationRequest.findMany({ where, orderBy: [{ raisedAt: 'desc' }, { id: 'asc' }], skip: page.skip, take: page.take, select: SELECT }),
      holdsOf(a.e.id),
      prisma.informationRequest.groupBy({ by: ['status'], where: { projectId: a.e.id }, _count: { _all: true } }),
      prisma.projectStandard.findMany({ where: { projectId: a.e.id }, select: { standardId: true } }),
    ]);
    const waiting = await prisma.informationRequest.findMany({
      where: { projectId: a.e.id, status: { in: AWAITING_ANSWER }, dueDate: { lt: now } }, select: { dueDate: true },
    });
    const summary: Record<string, number> = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
    summary.overdue = waiting.filter((w) => overdueDays(w.dueDate, holds, now) > 0).length;
    summary.acceptedClauses = (await acceptedClauseIds(a.e.id, bound.map((b) => b.standardId))).length;
    const firmCan = (action: EngagementAction) => a.side === 'Provider' && !firmMay(a, action);
    res.json({
      status: 'success',
      side: a.side,
      paging: pageInfo(total, page),
      summary,
      requests: rows.map((r) => decorate(r, holds, now)),
      can: {
        raise: firmCan('request'), import: firmCan('request'), scopeChange: firmCan('request'), review: firmCan('review'),
        recordBlocker: (a.side === 'Provider' && a.firm.acts && a.firm.role === 'Lead') || (a.side === 'Client' && a.manager),
        manage: a.side === 'Client' && a.manager,
      },
    });
  } catch (error: any) {
    console.error('[Requests List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the requests' });
  }
};

/** GET /api/engagements/:projectId/requests/:requestId — one request with its answers, files, reviews and blockers. */
export const getRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    const r = await loadRequest(a.e.id, str(req.params.requestId));
    if (!r) { notFound(res, 'Request'); return; }
    const [answers, reviews, links, blockers, holds] = await Promise.all([
      prisma.requestAnswer.findMany({
        where: { requestId: r.id }, orderBy: { version: 'desc' },
        select: {
          id: true, version: true, kind: true, text: true, documentId: true, register: true, recordId: true, recordLabel: true,
          answeredAt: true, replacedAt: true, answeredBy: { select: { name: true } },
        },
      }),
      prisma.requestReview.findMany({
        where: { requestId: r.id }, orderBy: { reviewedAt: 'desc' },
        select: {
          id: true, answerId: true, relevant: true, complete: true, coversPeriod: true, authentic: true, testNotes: true,
          outcome: true, note: true, reviewedAt: true, reviewer: { select: { name: true } },
        },
      }),
      prisma.evidenceLink.findMany({ where: { targetType: 'Request', targetId: r.id }, orderBy: { linkedAt: 'asc' } }),
      prisma.projectImpediment.findMany({ where: { informationRequestId: r.id }, select: { id: true, ref: true, resolvedAt: true } }),
      holdsOf(a.e.id),
    ]);
    const files = await describeItems(links);
    // Where else the organisation uses each file: its own business, shown to it alone.
    const elsewhere = a.side === 'Client' && files.length > 0 ? await prisma.evidenceLink.findMany({
      where: {
        OR: files.map((f) => ({ itemKind: f.itemKind, itemId: f.itemId })), targetType: { in: ['Task', 'Control'] }, removedAt: null,
      },
      select: { id: true, itemKind: true, itemId: true, targetType: true, targetId: true, linkedAt: true, linkedBy: { select: { name: true } } },
    }) : [];
    const labels = await targetLabels(elsewhere);
    const documents = answers.some((x) => x.documentId) ? await prisma.document.findMany({
      where: { id: { in: answers.map((x) => x.documentId!).filter(Boolean) } }, select: { id: true, code: true, title: true, version: true },
    }) : [];
    const now = new Date();
    const live = LIVE.includes(r.status);
    const isAssignee = a.side === 'Client' && r.assigneeId === a.userId;
    res.json({
      status: 'success',
      side: a.side,
      request: decorate(r, holds, now),
      tests: TESTS,
      answers: answers.map((ans) => ({
        ...ans,
        document: documents.find((d) => d.id === ans.documentId) ?? null,
        files: files.filter((f) => f.answerId === ans.id).map((f) => ({
          ...f,
          ...(a.side === 'Client' ? {
            alsoLinkedTo: elsewhere.filter((l) => l.itemKind === f.itemKind && l.itemId === f.itemId)
              .map((l) => ({ id: l.id, targetType: l.targetType, label: labels.get(`${l.targetType}:${l.targetId}`) ?? l.targetId, linkedAt: l.linkedAt, linkedBy: l.linkedBy?.name })),
          } : {}),
        })),
      })),
      reviews: reviews.map((v) => ({ ...v, testNotes: JSON.parse(v.testNotes || '{}') })),
      blockers,
      documentAccess: a.e.documentAccess === 'Download' ? 'Download' : 'View',
      can: {
        answer: a.side === 'Client' && live && (isAssignee || a.manager) && !running(a.e),
        decline: a.side === 'Client' && AWAITING_ANSWER.includes(r.status) && (isAssignee || a.manager) && !running(a.e),
        reassign: a.side === 'Client' && live && (isAssignee || a.manager) && !isEnded(a.e.status),
        moveDue: a.side === 'Client' && live && a.manager && !isEnded(a.e.status),
        review: a.side === 'Provider' && r.status === 'Answered' && !firmMay(a, 'review'),
        withdraw: a.side === 'Provider' && live && !firmMay(a, 'request') && (r.raisedById === a.userId || a.firm.role === 'Lead'),
        recordBlocker: AWAITING_ANSWER.includes(r.status) && overdueDays(r.dueDate, holds, now) > 0 && blockers.every((b) => b.resolvedAt)
          && !running(a.e) && ((a.side === 'Provider' && a.firm.acts && a.firm.role === 'Lead') || (a.side === 'Client' && a.manager)),
        link: a.side === 'Client' && a.manager,
      },
    });
  } catch (error: any) {
    console.error('[Request Read Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the request' });
  }
};

/** The files behind a set of links: name, size, hash and when it was stored. */
async function describeItems(links: { id: string; itemKind: string; itemId: string; answerId: string | null; linkedAt: Date; removedAt: Date | null }[]) {
  const itemIds = links.filter((l) => l.itemKind === 'EvidenceItem').map((l) => l.itemId);
  const evidenceIds = links.filter((l) => l.itemKind === 'ProjectEvidence').map((l) => l.itemId);
  const [items, evidence] = await Promise.all([
    itemIds.length ? prisma.evidenceItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, title: true, fileName: true, fileSize: true, mimeType: true, sha256: true, classification: true, uploadedAt: true },
    }) : [],
    evidenceIds.length ? prisma.projectEvidence.findMany({
      where: { id: { in: evidenceIds } },
      select: { id: true, title: true, fileName: true, fileSize: true, mimeType: true, sha256: true, classification: true, uploadedAt: true },
    }) : [],
  ]);
  const byId = new Map<string, (typeof items)[number]>([
    ...items.map((i) => [`EvidenceItem:${i.id}`, i] as [string, (typeof items)[number]]),
    ...evidence.map((i) => [`ProjectEvidence:${i.id}`, i] as [string, (typeof items)[number]]),
  ]);
  return links.map((l) => {
    const f = byId.get(`${l.itemKind}:${l.itemId}`);
    return {
      linkId: l.id, answerId: l.answerId, itemKind: l.itemKind, itemId: l.itemId,
      title: f?.title ?? null, fileName: f?.fileName ?? null, fileSize: f?.fileSize ?? null, mimeType: f?.mimeType ?? null,
      sha256: f?.sha256 ?? null, classification: f?.classification ?? null, storedAt: f?.uploadedAt ?? null,
    };
  });
}

/** Readable names for the tasks and controls evidence is linked to. */
async function targetLabels(links: { targetType: string; targetId: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const taskIds = links.filter((l) => l.targetType === 'Task').map((l) => l.targetId);
  const implIds = links.filter((l) => l.targetType === 'Control').map((l) => l.targetId);
  const [tasks, impls] = await Promise.all([
    taskIds.length ? prisma.projectTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, ref: true, name: true } }) : [],
    implIds.length ? prisma.controlImplementation.findMany({ where: { id: { in: implIds } }, select: { id: true, control: { select: { code: true, title: true } } } }) : [],
  ]);
  tasks.forEach((t) => out.set(`Task:${t.id}`, `${t.ref} · ${t.name}`));
  impls.forEach((i) => out.set(`Control:${i.id}`, `${i.control.code} · ${i.control.title}`));
  return out;
}

/** GET /api/engagements/requests/mine — what the organisation's person is asked for, across engagements. */
export const myRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const where = { assigneeId: str(req.user!.id), status: { in: AWAITING_ANSWER } };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const now = new Date();
    const [total, rows] = await Promise.all([
      prisma.informationRequest.count({ where }),
      prisma.informationRequest.findMany({
        where, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], skip: page.skip, take: page.take,
        select: {
          id: true, ref: true, kind: true, title: true, dueDate: true, status: true, targetLabel: true,
          project: { select: { id: true, ref: true, name: true, status: true, providerTenant: { select: { name: true } }, holds: { select: { startedAt: true, endedAt: true } } } },
        },
      }),
    ]);
    res.json({
      status: 'success',
      paging: pageInfo(total, page),
      requests: rows.map(({ project, ...r }) => ({
        ...r, overdueDays: overdueDays(r.dueDate, project.holds, now),
        project: { id: project.id, ref: project.ref, name: project.name, status: project.status, firm: project.providerTenant?.name ?? null },
      })),
    });
  } catch (error: any) {
    console.error('[My Requests Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load your requests' });
  }
};

// ─── Raising ────────────────────────────────────────────────────────────────

/**
 * The checks every new request passes, on screen and in an import: the kind,
 * a title, a due date inside the raising person's own access dates, the
 * period, an assignee from the engagement's team, a target inside the scope,
 * and no open request already asking the same thing.
 */
export async function checkNewRequest(args: {
  e: Engagement; raiserId: string; scope: Scope | null; body: any; byRef?: boolean; now?: Date;
}): Promise<{ ok: true; value: import('../services/engagementRequestStore').NewRequest } | { ok: false; status: number; code: string; message: string; scopeChange?: unknown }> {
  const b = args.body || {};
  const now = args.now ?? new Date();
  const kind = str(b.kind);
  if (!(REQUEST_KINDS as readonly string[]).includes(kind)) return { ok: false, status: 400, code: 'BAD_KIND', message: `A request asks for ${REQUEST_KINDS.join(', ').toLowerCase()}.` };
  const title = str(b.title).trim().slice(0, 300);
  if (title.length < 3) return { ok: false, status: 400, code: 'TITLE_REQUIRED', message: 'Say what you are asking for.' };
  const due = parseDay(b.dueDate);
  if (due === null || due === 'bad') return { ok: false, status: 400, code: 'BAD_DUE_DATE', message: 'Give a due date.' };
  const today = parseDay(now) as Date;
  if (due.getTime() < today.getTime()) return { ok: false, status: 400, code: 'DUE_IN_PAST', message: 'The due date has already passed.' };
  const raiser = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: args.e.id, userId: args.raiserId } }, select: { accessFrom: true, accessTo: true },
  });
  if (raiser?.accessTo && due.getTime() > raiser.accessTo.getTime()) {
    return { ok: false, status: 400, code: 'DUE_OUTSIDE_ACCESS', message: `The due date is after your access ends (${raiser.accessTo.toISOString().slice(0, 10)}).` };
  }
  if (raiser?.accessFrom && due.getTime() < (parseDay(raiser.accessFrom) as Date).getTime()) {
    return { ok: false, status: 400, code: 'DUE_OUTSIDE_ACCESS', message: 'The due date is before your access starts.' };
  }
  const from = parseDay(b.periodFrom);
  const to = parseDay(b.periodTo);
  if (from === 'bad' || to === 'bad') return { ok: false, status: 400, code: 'BAD_PERIOD', message: 'Give the period as dates.' };
  if (from && to && to.getTime() < from.getTime()) return { ok: false, status: 400, code: 'BAD_PERIOD', message: 'The period ends before it starts.' };
  let assigneeId = args.e.managerId;
  if (b.assigneeId) {
    if (!(await teamMember(args.e.id, str(b.assigneeId)))) {
      return { ok: false, status: 400, code: 'NOT_ON_TEAM', message: 'Propose someone the organisation has put on this engagement.' };
    }
    assigneeId = str(b.assigneeId);
  }
  const target = await resolveTarget({
    projectId: args.e.id, clientTenantId: args.e.tenantId, scope: args.scope, targetType: str(b.targetType || 'Engagement'),
    target: b.targetType === 'Register' ? (b.targetId ?? b.register) : b.targetId, byRef: args.byRef, now,
  });
  if (!target.ok) return target;
  const twin = await prisma.informationRequest.findFirst({
    where: {
      projectId: args.e.id, kind, targetType: target.targetType, targetId: target.targetId, status: { in: LIVE },
      title: { equals: title, mode: 'insensitive' },
    },
    select: { ref: true },
  });
  if (twin) return { ok: false, status: 409, code: 'DUPLICATE_REQUEST', message: `${twin.ref} already asks for this and is still open.` };
  return {
    ok: true,
    value: {
      kind, title, criteria: b.criteria ? str(b.criteria).trim().slice(0, 4000) : null,
      targetType: target.targetType, targetId: target.targetId, targetLabel: target.label,
      periodFrom: from, periodTo: to, dueDate: due, assigneeId,
    },
  };
}

/** POST /api/engagements/:projectId/requests — the firm's Lead or a Consultant asks. */
export const raiseRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    const refusal = firmMay(a, 'request');
    if (refusal) { fail(res, refusal); return; }
    // The target by id, or by reference as typed (TSK-0001, ISO27001 A.5.15, AC-04, Vendors).
    const b = req.body || {};
    const byRef = b.targetRef !== undefined && b.targetRef !== null && b.targetRef !== '';
    const checked = await checkNewRequest({
      e: a.e, raiserId: a.userId, scope: await bindingScope(a.e.id), byRef,
      body: byRef ? { ...b, targetId: b.targetRef } : b,
    });
    if (!checked.ok) {
      res.status(checked.status).json({ status: 'error', code: checked.code, message: checked.message, ...(checked.scopeChange ? { scopeChange: checked.scopeChange } : {}) });
      return;
    }
    const [made] = await prisma.$transaction((tx) => createRequests(tx, {
      e: a.e, raisedById: a.userId, requests: [checked.value], action: 'ENGAGEMENT_REQUEST_RAISED',
    }));
    res.status(201).json({ status: 'success', request: made });
  } catch (error: any) {
    console.error('[Request Raise Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to raise the request' });
  }
};

// ─── Answering ──────────────────────────────────────────────────────────────

class Refused extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

/**
 * POST /api/engagements/:projectId/requests/:requestId/answer — the assignee
 * or the project manager answers. A second answer replaces the first; the
 * first stays in the history with its files and their hashes.
 */
export const answerRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    if (a.side !== 'Client') { send(res, { status: 403, code: 'CLIENT_ANSWERS', message: 'The organisation answers its requests.' }); return; }
    const r = await loadRequest(a.e.id, str(req.params.requestId));
    if (!r) { notFound(res, 'Request'); return; }
    if (r.assigneeId !== a.userId && !a.manager) {
      send(res, { status: 403, code: 'NOT_YOURS', message: `${r.ref} is assigned to ${r.assignee.name}. They or the project manager answer it.` });
      return;
    }
    { const s = running(a.e); if (s) { fail(res, s); return; } }
    if (!LIVE.includes(r.status)) { send(res, { status: 409, code: 'REQUEST_SETTLED', message: `${r.ref} is ${r.status.toLowerCase()}.` }); return; }

    const b = req.body || {};
    const kind = str(b.kind);
    if (!(ANSWER_KINDS as readonly string[]).includes(kind)) { send(res, { status: 400, message: `Answer with ${ANSWER_KINDS.join(', ')}.` }); return; }
    const text = b.text ? str(b.text).trim().slice(0, 4000) : null;
    const scope = await bindingScope(a.e.id);
    const allowed = answerClassifications(scope);
    const ceiling = allowed[allowed.length - 1];

    // What the answer points at, checked before anything is written.
    let upload: { bytes: Buffer; fileName: string; title: string; classification: string; sha256: string } | null = null;
    let item: { itemKind: string; itemId: string } | null = null;
    let answerData: { documentId?: string; register?: string; recordId?: string; recordLabel?: string } = {};
    if (kind === 'Upload') {
      const fileName = str(b.fileName).trim();
      if (!fileName || !b.fileData) { send(res, { status: 400, message: 'Choose the file to upload.' }); return; }
      let bytes: Buffer;
      try { bytes = decodeUpload(str(b.fileData)); } catch { send(res, { status: 400, message: 'fileData is not valid base64' }); return; }
      const fileRefusal = checkEvidenceFile(fileName, bytes.length);
      if (fileRefusal) { send(res, { status: 400, ...fileRefusal }); return; }
      const classification = str(b.classification || 'Internal');
      if (!(EVIDENCE_CLASSIFICATIONS as readonly string[]).includes(classification)) {
        send(res, { status: 400, message: `classification must be one of: ${EVIDENCE_CLASSIFICATIONS.join(', ')}` }); return;
      }
      if (!allowed.includes(classification)) {
        send(res, { status: 409, code: 'ABOVE_CEILING', message: `This engagement shares up to ${ceiling}. Answer with something at or below it, or ask for a scope change.` });
        return;
      }
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      // The same file already held: link it rather than store a second copy.
      const same = await prisma.evidenceItem.findFirst({ where: { tenantId: a.e.tenantId, sha256 }, select: { id: true, title: true, fileName: true, uploadedAt: true } })
        ?? await prisma.projectEvidence.findFirst({
          where: { sha256, withdrawnAt: null, project: { tenantId: a.e.tenantId } }, select: { id: true, title: true, fileName: true, uploadedAt: true },
        }).then((p) => (p ? { ...p, kind: 'ProjectEvidence' } : null));
      if (same) {
        res.status(409).json({
          status: 'error', code: 'SAME_FILE',
          message: `This file is already held as "${same.title}". Link that one instead of storing a copy.`,
          existing: { itemKind: (same as any).kind ?? 'EvidenceItem', itemId: same.id, title: same.title, fileName: same.fileName, storedAt: same.uploadedAt },
        });
        return;
      }
      upload = { bytes, fileName, title: str(b.title || fileName).trim().slice(0, 200), classification, sha256 };
    } else if (kind === 'Evidence') {
      const itemKind = str(b.itemKind);
      const itemId = str(b.itemId);
      const found = itemKind === 'EvidenceItem'
        ? await prisma.evidenceItem.findFirst({ where: { id: itemId, tenantId: a.e.tenantId }, select: { classification: true } })
        : itemKind === 'ProjectEvidence'
          ? await prisma.projectEvidence.findFirst({ where: { id: itemId, withdrawnAt: null, project: { tenantId: a.e.tenantId } }, select: { classification: true } })
          : null;
      if (!found) { send(res, { status: 404, message: 'That evidence was not found.' }); return; }
      if (!allowed.includes(found.classification)) {
        send(res, { status: 409, code: 'ABOVE_CEILING', message: `That evidence is ${found.classification}; this engagement shares up to ${ceiling}. Ask for a scope change.` });
        return;
      }
      item = { itemKind, itemId };
    } else if (kind === 'Document') {
      const reg = registerScope(scope, 'Documents');
      const doc = await prisma.document.findFirst({
        where: { id: str(b.documentId), status: 'PUBLISHED', ...(reg ? { tenantId: { in: reg.tenantIds } } : { tenantId: a.e.tenantId }) },
        select: { id: true, code: true, title: true, classification: true },
      });
      if (!doc) { send(res, { status: 404, message: 'Link a published document of your organisation.' }); return; }
      if (!reg || !reg.classifications.includes(doc.classification)) {
        send(res, { status: 409, code: 'OUT_OF_SCOPE', message: 'That document is not shared by this engagement\'s scope. A scope change adds it.' });
        return;
      }
      answerData = { documentId: doc.id, recordLabel: `${doc.code} · ${doc.title}` };
    } else if (kind === 'Record') {
      const register = str(b.register);
      if (register !== 'Risks' && register !== 'Assets') { send(res, { status: 400, message: 'Link a record from the risks or assets register.' }); return; }
      const reg = registerScope(scope, register);
      if (!reg) { send(res, { status: 409, code: 'OUT_OF_SCOPE', message: `The ${register.toLowerCase()} register is not shared by this engagement's scope.` }); return; }
      const rec = register === 'Risks'
        ? await prisma.risk.findFirst({ where: { id: str(b.recordId), tenantId: { in: reg.tenantIds } }, select: { ref: true, title: true } })
          .then((x) => (x ? { label: `${x.ref} · ${x.title}` } : null))
        : await prisma.asset.findFirst({ where: { id: str(b.recordId), tenantId: { in: reg.tenantIds }, classification: { in: reg.classifications } }, select: { ref: true, name: true } })
          .then((x) => (x ? { label: `${x.ref} · ${x.name}` } : null));
      if (!rec) { send(res, { status: 404, message: 'That record is not shared by this engagement\'s scope.' }); return; }
      answerData = { register, recordId: str(b.recordId), recordLabel: rec.label };
    } else if (!text || text.length < 3) {
      send(res, { status: 400, message: 'Write the answer.' }); return;
    }

    const stored = upload ? putEvidence(upload.bytes) : null;
    const now = new Date();
    const answer = await prisma.$transaction(async (tx) => {
      const moved = await tx.informationRequest.updateMany({ where: { id: r.id, status: { in: LIVE } }, data: { status: 'Answered' } });
      if (moved.count === 0) throw new Refused(409, 'REQUEST_SETTLED', 'The request was settled while you were answering. Reload it.');
      const previous = await tx.requestAnswer.findFirst({ where: { requestId: r.id, replacedAt: null }, select: { id: true, version: true } });
      if (previous) await tx.requestAnswer.update({ where: { id: previous.id }, data: { replacedAt: now } });
      const last = await tx.requestAnswer.findFirst({ where: { requestId: r.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const row = await tx.requestAnswer.create({
        data: { requestId: r.id, version: (last?.version ?? 0) + 1, kind, text, answeredById: a.userId, answeredAt: now, ...answerData },
      });
      if (upload && stored) {
        const ev = await tx.evidenceItem.create({
          data: {
            tenantId: a.e.tenantId, title: upload.title, storageKey: stored.storageKey, fileName: upload.fileName, fileSize: stored.byteLength,
            mimeType: sniffMime(stored.head, upload.fileName), sha256: stored.sha256, classification: upload.classification, uploadedById: a.userId,
          },
          select: { id: true },
        });
        item = { itemKind: 'EvidenceItem', itemId: ev.id };
      }
      if (item) {
        await tx.evidenceLink.create({
          data: { tenantId: a.e.tenantId, ...item, targetType: 'Request', targetId: r.id, answerId: row.id, projectId: a.e.id, linkedById: a.userId },
        });
      }
      await requestTrails(tx, {
        e: a.e, actorId: a.userId, action: 'ENGAGEMENT_REQUEST_ANSWERED', subjectType: 'InformationRequest', subjectId: r.id,
        payload: {
          requestId: r.id, request: r.ref, version: row.version, kind, replacedVersion: previous?.version ?? null,
          ...(stored ? { fileName: upload!.fileName, sha256: stored.sha256 } : {}), ...(item ? { item } : {}), ...answerData,
        },
        firmPayload: { requestId: r.id, request: r.ref, version: row.version, kind },
      });
      await notify(tx, [{
        tenantId: a.e.providerTenantId!, recipientId: r.raisedById, actorId: a.userId, event: 'ENGAGEMENT_REQUEST_ANSWERED',
        subjectType: 'Project', subjectId: a.e.id,
        title: `${r.ref} answered: ${r.title}`, body: `${a.e.tenant?.name} answered on ${a.e.ref}. Review it from the Requests tab.`, link: 'project-delivery',
      }]);
      return row;
    });
    res.status(201).json({ status: 'success', answer: { id: answer.id, version: answer.version } });
  } catch (error: any) {
    if (error instanceof Refused) { res.status(error.status).json({ status: 'error', code: error.code, message: error.message, ...error.extra }); return; }
    console.error('[Request Answer Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to answer the request' });
  }
};

/** POST /api/engagements/:projectId/requests/:requestId/decline — the organisation says no, with a reason. */
export const declineRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    if (a.side !== 'Client') { send(res, { status: 403, code: 'CLIENT_ANSWERS', message: 'The organisation answers its requests.' }); return; }
    const r = await loadRequest(a.e.id, str(req.params.requestId));
    if (!r) { notFound(res, 'Request'); return; }
    if (r.assigneeId !== a.userId && !a.manager) { send(res, { status: 403, code: 'NOT_YOURS', message: `${r.ref} is assigned to ${r.assignee.name}.` }); return; }
    { const s = running(a.e); if (s) { fail(res, s); return; } }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    await settle(a, r, { from: AWAITING_ANSWER, to: 'Declined', reason, action: 'ENGAGEMENT_REQUEST_DECLINED' }, {
      tenantId: a.e.providerTenantId!, recipientId: r.raisedById, title: `${r.ref} declined: ${r.title}`, body: reason,
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Refused) { res.status(error.status).json({ status: 'error', code: error.code, message: error.message }); return; }
    console.error('[Request Decline Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to decline the request' });
  }
};

/** POST /api/engagements/:projectId/requests/:requestId/withdraw — the firm no longer needs it. */
export const withdrawRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    const refusal = firmMay(a, 'request');
    if (refusal) { fail(res, refusal); return; }
    const r = await loadRequest(a.e.id, str(req.params.requestId));
    if (!r) { notFound(res, 'Request'); return; }
    if (a.side === 'Provider' && r.raisedById !== a.userId && a.firm.role !== 'Lead') {
      send(res, { status: 403, code: 'NOT_YOURS', message: 'The person who raised it, or the firm\'s Lead, withdraws a request.' }); return;
    }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    await settle(a, r, { from: LIVE, to: 'Withdrawn', reason, action: 'ENGAGEMENT_REQUEST_WITHDRAWN' }, {
      tenantId: a.e.tenantId, recipientId: r.assigneeId, title: `${r.ref} withdrawn by the firm: ${r.title}`, body: reason,
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Refused) { res.status(error.status).json({ status: 'error', code: error.code, message: error.message }); return; }
    console.error('[Request Withdraw Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to withdraw the request' });
  }
};

async function settle(
  a: Extract<Access, { ok: true }>, r: { id: string; ref: string },
  move: { from: string[]; to: string; reason: string; action: string },
  tell: { tenantId: string; recipientId: string; title: string; body: string },
) {
  await prisma.$transaction(async (tx) => {
    const moved = await tx.informationRequest.updateMany({
      where: { id: r.id, status: { in: move.from } },
      data: { status: move.to, closedById: a.userId, closedAt: new Date(), closeNote: move.reason },
    });
    if (moved.count === 0) throw new Refused(409, 'REQUEST_SETTLED', `${r.ref} can no longer be ${move.to.toLowerCase()}.`);
    await requestTrails(tx, {
      e: a.e, actorId: a.userId, action: move.action, subjectType: 'InformationRequest', subjectId: r.id,
      payload: { requestId: r.id, request: r.ref, reason: move.reason },
    });
    await notify(tx, [{ ...tell, actorId: a.userId, event: move.action, subjectType: 'Project', subjectId: a.e.id, link: 'project-delivery' }]);
  });
}

// ─── Reviewing ──────────────────────────────────────────────────────────────

/** POST /api/engagements/:projectId/requests/:requestId/review — the firm accepts or returns the answer. */
export const reviewRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    const refusal = firmMay(a, 'review');
    if (refusal) { fail(res, refusal); return; }
    const r = await loadRequest(a.e.id, str(req.params.requestId));
    if (!r) { notFound(res, 'Request'); return; }
    if (r.status !== 'Answered') { send(res, { status: 409, code: 'NOTHING_TO_REVIEW', message: `${r.ref} has no answer waiting for review.` }); return; }
    const checked = checkReview(r.kind, req.body);
    if (!checked.ok) { send(res, { status: 400, code: checked.code, message: checked.message }); return; }
    const v = checked.value;
    await prisma.$transaction(async (tx) => {
      const current = await tx.requestAnswer.findFirst({ where: { requestId: r.id, replacedAt: null }, select: { id: true, version: true } });
      if (!current) throw new Refused(409, 'NOTHING_TO_REVIEW', `${r.ref} has no answer waiting for review.`);
      const moved = await tx.informationRequest.updateMany({ where: { id: r.id, status: 'Answered' }, data: { status: v.outcome } });
      if (moved.count === 0) throw new Refused(409, 'NOTHING_TO_REVIEW', 'The answer changed while you were reviewing it. Reload it.');
      await tx.requestReview.create({
        data: {
          requestId: r.id, answerId: current.id, reviewerId: a.userId, outcome: v.outcome, note: v.note,
          relevant: v.tests.relevant ?? null, complete: v.tests.complete ?? null, coversPeriod: v.tests.coversPeriod ?? null,
          authentic: v.tests.authentic ?? null, testNotes: JSON.stringify(v.testNotes),
        },
      });
      await requestTrails(tx, {
        e: a.e, actorId: a.userId, subjectType: 'InformationRequest', subjectId: r.id,
        action: v.outcome === 'Accepted' ? 'ENGAGEMENT_REQUEST_ACCEPTED' : 'ENGAGEMENT_REQUEST_RETURNED',
        payload: { requestId: r.id, request: r.ref, answerVersion: current.version, tests: v.tests, testNotes: v.testNotes, note: v.note },
      });
      await notify(tx, [{
        tenantId: a.e.tenantId, recipientId: r.assigneeId, actorId: a.userId,
        event: v.outcome === 'Accepted' ? 'ENGAGEMENT_REQUEST_ACCEPTED' : 'ENGAGEMENT_REQUEST_RETURNED',
        subjectType: 'Project', subjectId: a.e.id,
        title: v.outcome === 'Accepted' ? `${r.ref} accepted by the firm` : `${r.ref} returned by the firm: something is missing`,
        body: v.note ?? r.title, link: 'project-delivery',
      }]);
    });
    res.json({ status: 'success', outcome: v.outcome });
  } catch (error: any) {
    if (error instanceof Refused) { res.status(error.status).json({ status: 'error', code: error.code, message: error.message }); return; }
    console.error('[Request Review Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to review the answer' });
  }
};

// ─── Who answers, and by when ───────────────────────────────────────────────

/**
 * PATCH /api/engagements/:projectId/requests/:requestId/assignee { assigneeId }
 *
 * The project manager can always reassign; the assignee can hand it to a
 * colleague of the organisation who works on projects, and the project
 * manager is told.
 */
export const reassignRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    if (a.side !== 'Client') { send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'The organisation decides who answers.' }); return; }
    const r = await loadRequest(a.e.id, str(req.params.requestId));
    if (!r) { notFound(res, 'Request'); return; }
    const handing = r.assigneeId === a.userId && !a.manager;
    if (r.assigneeId !== a.userId && !a.manager) { send(res, { status: 403, code: 'NOT_YOURS', message: 'The assignee or the project manager hands it on.' }); return; }
    if (!LIVE.includes(r.status)) { send(res, { status: 409, code: 'REQUEST_SETTLED', message: `${r.ref} is ${r.status.toLowerCase()}.` }); return; }
    if (isEnded(a.e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` }); return; }
    const to = str(req.body?.assigneeId);
    if (to === r.assigneeId) { res.json({ status: 'success', changed: false }); return; }
    const own = await hierarchyOf(a.e.tenantId);
    const person = await prisma.user.findFirst({ where: { id: to, status: 'Active', tenantId: { in: own } }, select: { id: true, name: true } });
    if (!person) { send(res, { status: 400, code: 'NOT_A_COLLEAGUE', message: 'Choose an active person of the organisation.' }); return; }
    const perms = await getEffectivePermissions(person.id);
    if (!perms.capabilities.includes(CAP.EXECUTE_PROJECT_WORK) && !perms.capabilities.includes(CAP.MANAGE_PROJECT)) {
      send(res, { status: 400, code: 'CANNOT_ANSWER', message: `${person.name}'s role does not include project work, so they could not answer it.` }); return;
    }
    const note = req.body?.note ? str(req.body.note).trim().slice(0, 500) : null;
    await prisma.$transaction(async (tx) => {
      await tx.informationRequest.update({ where: { id: r.id }, data: { assigneeId: person.id } });
      await requestTrails(tx, {
        e: a.e, actorId: a.userId, action: 'ENGAGEMENT_REQUEST_REASSIGNED', subjectType: 'InformationRequest', subjectId: r.id,
        payload: { requestId: r.id, request: r.ref, from: r.assignee.name, to: person.name, handedOn: handing, note },
        firmPayload: { requestId: r.id, request: r.ref, to: person.name },
      });
      await notify(tx, [
        { tenantId: a.e.tenantId, recipientId: person.id, actorId: a.userId, event: 'ENGAGEMENT_REQUEST_RAISED', subjectType: 'Project', subjectId: a.e.id,
          title: `${r.ref} is now yours: ${r.title}`, body: note ?? `Due ${r.dueDate.toISOString().slice(0, 10)}.`, link: 'project-delivery' },
        ...(handing ? [{ tenantId: a.e.tenantId, recipientId: a.e.managerId, actorId: a.userId, event: 'ENGAGEMENT_REQUEST_REASSIGNED', subjectType: 'Project', subjectId: a.e.id,
          title: `${r.assignee.name} handed ${r.ref} to ${person.name}`, body: note ?? r.title, link: 'project-delivery' }] : []),
      ]);
    });
    res.json({ status: 'success', changed: true });
  } catch (error: any) {
    console.error('[Request Reassign Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to reassign the request' });
  }
};

/** PATCH /api/engagements/:projectId/requests/:requestId/due { dueDate, reason } — the project manager moves it. */
export const moveRequestDue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    if (a.side !== 'Client' || !a.manager) { send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'The organisation\'s project manager moves due dates.' }); return; }
    const r = await loadRequest(a.e.id, str(req.params.requestId));
    if (!r) { notFound(res, 'Request'); return; }
    if (!LIVE.includes(r.status)) { send(res, { status: 409, code: 'REQUEST_SETTLED', message: `${r.ref} is ${r.status.toLowerCase()}.` }); return; }
    if (isEnded(a.e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` }); return; }
    const due = parseDay(req.body?.dueDate);
    if (due === null || due === 'bad') { send(res, { status: 400, message: 'Give the new due date.' }); return; }
    if (due.getTime() < (parseDay(new Date()) as Date).getTime()) { send(res, { status: 400, code: 'DUE_IN_PAST', message: 'The new due date has already passed.' }); return; }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    await prisma.$transaction(async (tx) => {
      // A new due date earns its own reminder and due-date notice.
      await tx.informationRequest.update({ where: { id: r.id }, data: { dueDate: due, reminderSentAt: null, dueNoticeAt: null } });
      await requestTrails(tx, {
        e: a.e, actorId: a.userId, action: 'ENGAGEMENT_REQUEST_DUE_MOVED', subjectType: 'InformationRequest', subjectId: r.id,
        payload: { requestId: r.id, request: r.ref, from: r.dueDate, to: due, reason },
      });
      await notify(tx, [
        { tenantId: a.e.tenantId, recipientId: r.assigneeId, actorId: a.userId, event: 'ENGAGEMENT_REQUEST_DUE_MOVED', subjectType: 'Project', subjectId: a.e.id,
          title: `${r.ref} is now due ${due.toISOString().slice(0, 10)}`, body: reason, link: 'project-delivery' },
        { tenantId: a.e.providerTenantId!, recipientId: r.raisedById, actorId: a.userId, event: 'ENGAGEMENT_REQUEST_DUE_MOVED', subjectType: 'Project', subjectId: a.e.id,
          title: `${r.ref} is now due ${due.toISOString().slice(0, 10)}`, body: reason, link: 'project-delivery' },
      ]);
    });
    res.json({ status: 'success', dueDate: due });
  } catch (error: any) {
    console.error('[Request Due Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to move the due date' });
  }
};

/**
 * POST /api/engagements/:projectId/requests/:requestId/blocker — an overdue
 * request recorded as a blocker owed by the organisation, by the firm's Lead
 * or the project manager. Never done by itself: an overdue request is only
 * shown until someone records it.
 */
export const recordRequestBlocker = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    const lead = a.side === 'Provider' && a.firm.acts && a.firm.role === 'Lead';
    const pm = a.side === 'Client' && a.manager;
    if (!lead && !pm) { send(res, { status: 403, code: 'LEAD_OR_PM', message: 'The firm\'s Lead or the project manager records an overdue request as a blocker.' }); return; }
    { const s = running(a.e); if (s) { fail(res, s); return; } }
    const r = await loadRequest(a.e.id, str(req.params.requestId));
    if (!r) { notFound(res, 'Request'); return; }
    const days = AWAITING_ANSWER.includes(r.status) ? overdueDays(r.dueDate, await holdsOf(a.e.id)) : 0;
    if (days <= 0) { send(res, { status: 409, code: 'NOT_OVERDUE', message: `${r.ref} is not overdue.` }); return; }
    const open = await prisma.projectImpediment.findFirst({ where: { informationRequestId: r.id, resolvedAt: null }, select: { ref: true } });
    if (open) { send(res, { status: 409, code: 'ALREADY_RECORDED', message: `${open.ref} already records it.` }); return; }
    const task = r.targetType === 'Task' && r.targetId
      ? await prisma.projectTask.findFirst({ where: { id: r.targetId, projectId: a.e.id }, select: { id: true, phaseId: true, assigneeId: true } })
      : null;
    const ref = await nextImpedimentRef(a.e.id);
    const now = new Date();
    const imp = await prisma.$transaction(async (tx) => {
      const row = await tx.projectImpediment.create({
        data: {
          projectId: a.e.id, taskId: task?.id ?? null, phaseId: task?.phaseId ?? null, ref, kind: 'Blocker',
          category: 'ClientDependency', owingSide: 'Client', severity: 'Medium',
          title: `${r.ref} overdue: ${r.title}`.slice(0, 300),
          description: `Asked ${r.raisedAt.toISOString().slice(0, 10)}, due ${r.dueDate.toISOString().slice(0, 10)}, ${days} day(s) overdue when recorded.`,
          raisedById: a.userId, raisedAt: now, informationRequestId: r.id,
        },
        select: { id: true, ref: true },
      });
      await requestTrails(tx, {
        e: a.e, actorId: a.userId, action: 'PROJECT_BLOCKER_RAISED', subjectType: 'ProjectImpediment', subjectId: row.id,
        payload: { impedimentId: row.id, impediment: row.ref, fromRequest: r.ref, owingSide: 'Client', overdueDays: days },
      });
      await notify(tx, [...new Set([a.e.managerId, a.e.ownerId, r.assigneeId, task?.assigneeId].filter(Boolean) as string[])].map((rid) => ({
        tenantId: a.e.tenantId, recipientId: rid, actorId: a.userId, event: 'PROJECT_BLOCKER_RAISED', subjectType: 'ProjectImpediment', subjectId: row.id,
        title: `${row.ref}: ${r.ref} overdue on ${a.e.name}`, body: 'Recorded as a blocker owed by the organisation.', link: 'project-delivery',
      })));
      return row;
    });
    res.status(201).json({ status: 'success', impediment: imp });
  } catch (error: any) {
    console.error('[Request Blocker Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the blocker' });
  }
};

// ─── Files ──────────────────────────────────────────────────────────────────

/**
 * GET /api/engagements/:projectId/requests/:requestId/files/:linkId — a file
 * of an answer. The firm gets it only through the request, only while its
 * access is open, and to keep only where the organisation allows downloads.
 * A file that no longer matches its hash is not served.
 */
export const requestFile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    const link = await prisma.evidenceLink.findFirst({
      where: { id: str(req.params.linkId), targetType: 'Request', targetId: str(req.params.requestId), projectId: a.e.id },
    });
    if (!link) { notFound(res, 'File'); return; }
    const preview = str(req.query.disposition) === 'preview';
    if (!preview && a.side === 'Provider' && a.e.documentAccess !== 'Download') {
      send(res, { status: 403, code: 'VIEW_ONLY', message: `${a.e.tenant?.name || 'The organisation'} shares files on this engagement to view only.` });
      return;
    }
    const f = link.itemKind === 'EvidenceItem'
      ? await prisma.evidenceItem.findUnique({ where: { id: link.itemId }, select: { storageKey: true, sha256: true, fileName: true, mimeType: true } })
      : await prisma.projectEvidence.findUnique({ where: { id: link.itemId }, select: { storageKey: true, sha256: true, fileName: true, mimeType: true } });
    if (!f) { notFound(res, 'File'); return; }
    const full = resolveEvidencePath(f.storageKey);
    if (!full) { send(res, { status: 410, code: 'FILE_MISSING', message: 'The stored file is no longer on disk.' }); return; }
    if (verifyStoredHash(f.storageKey, f.sha256) !== true) {
      send(res, { status: 409, code: 'FILE_ALTERED', message: 'This file no longer matches the hash taken at upload, so it is not served.' });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: a.e.tenantId, actorId: a.userId, action: 'ENGAGEMENT_REQUEST_FILE_READ', subjectType: 'EvidenceLink', subjectId: link.id,
        payload: { projectRef: a.e.ref, requestId: link.targetId, fileName: f.fileName, sha256: f.sha256, side: a.side, via: preview ? 'PREVIEW' : 'DOWNLOAD' },
      });
    });
    res.setHeader('Content-Type', f.mimeType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (preview) {
      res.setHeader('Content-Disposition', `inline; filename="${f.fileName.replace(/["\r\n]/g, '')}"`);
      res.sendFile(full);
    } else {
      res.download(full, f.fileName);
    }
  } catch (error: any) {
    console.error('[Request File Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to deliver the file' });
  }
};

// ─── Evidence links ─────────────────────────────────────────────────────────

/**
 * POST /api/engagements/:projectId/evidence-links { itemKind, itemId, targetType, targetId }
 *
 * One evidence file used again: linked to a task of this engagement or to one
 * of the organisation's controls, with who linked it and when. Informational:
 * it does not count as the task's evidence for verification, nor in a
 * control's validation.
 */
export const linkEvidence = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    if (a.side !== 'Client' || !a.manager) { send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'The organisation links its own evidence.' }); return; }
    const b = req.body || {};
    const itemKind = str(b.itemKind);
    const itemId = str(b.itemId);
    const owned = itemKind === 'EvidenceItem'
      ? await prisma.evidenceItem.findFirst({ where: { id: itemId, tenantId: a.e.tenantId }, select: { id: true } })
      : itemKind === 'ProjectEvidence'
        ? await prisma.projectEvidence.findFirst({ where: { id: itemId, project: { tenantId: a.e.tenantId } }, select: { id: true } })
        : null;
    if (!owned) { notFound(res, 'Evidence'); return; }
    const targetType = str(b.targetType);
    // By id, or by reference as typed: a task's ref, a control's code.
    const ref = b.targetRef ? str(b.targetRef).trim() : null;
    const target = targetType === 'Task'
      ? await prisma.projectTask.findFirst({ where: { projectId: a.e.id, ...(ref ? { ref } : { id: str(b.targetId) }) }, select: { id: true } })
      : targetType === 'Control'
        ? await prisma.controlImplementation.findFirst({
          where: { tenantId: { in: await hierarchyOf(a.e.tenantId) }, ...(ref ? { control: { code: ref } } : { id: str(b.targetId) }) }, select: { id: true },
        })
        : null;
    if (!target) { send(res, { status: 400, code: 'BAD_TARGET', message: 'Link it to a task of this engagement or to one of your controls.' }); return; }
    const targetId = target.id;
    const twin = await prisma.evidenceLink.findFirst({ where: { itemKind, itemId, targetType, targetId, removedAt: null }, select: { id: true } });
    if (twin) { send(res, { status: 409, code: 'ALREADY_LINKED', message: 'It is already linked there.' }); return; }
    const link = await prisma.$transaction(async (tx) => {
      const row = await tx.evidenceLink.create({
        data: { tenantId: a.e.tenantId, itemKind, itemId, targetType, targetId, projectId: a.e.id, linkedById: a.userId },
        select: { id: true },
      });
      await writeAudit(tx, {
        tenantId: a.e.tenantId, actorId: a.userId, action: 'EVIDENCE_LINKED', subjectType: 'EvidenceLink', subjectId: row.id,
        payload: { projectRef: a.e.ref, itemKind, itemId, targetType, targetId },
      });
      return row;
    });
    res.status(201).json({ status: 'success', link });
  } catch (error: any) {
    console.error('[Evidence Link Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to link the evidence' });
  }
};

/** POST /api/engagements/:projectId/evidence-links/:linkId/remove — the link goes, the file stays. */
export const unlinkEvidence = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    if (a.side !== 'Client' || !a.manager) { send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'The organisation links its own evidence.' }); return; }
    const link = await prisma.evidenceLink.findFirst({ where: { id: str(req.params.linkId), tenantId: a.e.tenantId, projectId: a.e.id } });
    if (!link) { notFound(res, 'Link'); return; }
    // An answer's files are its history; replacing the answer is the way to change them.
    if (link.targetType === 'Request') { send(res, { status: 409, code: 'ANSWER_LINK', message: 'A file of an answer stays with it. Replace the answer instead.' }); return; }
    await prisma.$transaction(async (tx) => {
      const moved = await tx.evidenceLink.updateMany({ where: { id: link.id, removedAt: null }, data: { removedAt: new Date(), removedById: a.userId } });
      if (moved.count === 0) throw new Refused(409, 'ALREADY_REMOVED', 'That link was already removed.');
      await writeAudit(tx, {
        tenantId: a.e.tenantId, actorId: a.userId, action: 'EVIDENCE_UNLINKED', subjectType: 'EvidenceLink', subjectId: link.id,
        payload: { projectRef: a.e.ref, itemKind: link.itemKind, itemId: link.itemId, targetType: link.targetType, targetId: link.targetId },
      });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Refused) { res.status(error.status).json({ status: 'error', code: error.code, message: error.message }); return; }
    console.error('[Evidence Unlink Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to remove the link' });
  }
};

/**
 * GET /api/engagements/:projectId/evidence-choices — what the organisation can
 * answer with: evidence files it already holds, newest first and paged, and
 * the task files of this engagement.
 */
export const evidenceChoices = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { fail(res, a); return; }
    if (a.side !== 'Client') { notFound(res); return; }
    const search = str(req.query.search).trim();
    const where = {
      tenantId: a.e.tenantId,
      ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' as const } }, { fileName: { contains: search, mode: 'insensitive' as const } }] } : {}),
    };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const [total, items, taskFiles] = await Promise.all([
      prisma.evidenceItem.count({ where }),
      prisma.evidenceItem.findMany({
        where, orderBy: [{ uploadedAt: 'desc' }, { id: 'asc' }], skip: page.skip, take: page.take,
        select: { id: true, title: true, fileName: true, classification: true, uploadedAt: true, sha256: true },
      }),
      prisma.projectEvidence.findMany({
        where: { projectId: a.e.id, withdrawnAt: null }, orderBy: { uploadedAt: 'desc' },
        select: { id: true, ref: true, title: true, fileName: true, classification: true, uploadedAt: true, sha256: true, task: { select: { ref: true } } },
      }),
    ]);
    res.json({ status: 'success', paging: pageInfo(total, page), items, taskFiles });
  } catch (error: any) {
    console.error('[Evidence Choices Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load your evidence' });
  }
};

export { access as requestAccess, firmMay };
