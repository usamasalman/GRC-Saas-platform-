import { Response } from 'express';
import { prisma } from '../db';
import { readPage, pageInfo } from '../utils/paging';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { firmAccess, FirmAccess } from '../services/engagementFirmAccess';
import { bindingScope, registerScope, Scope, ScopeService } from '../services/engagementScope';
import { accessOpen } from '../services/engagementRules';
import { isEnded } from '../services/engagementAfterClose';
import {
  SCOPED_SUBJECTS, SubjectType, Side, visibilitiesFor, sideReads, checkThreadStart, checkPost, decisionRefusal,
  retractRefusal, postingRefusal, checkMentions, threadRef, CONVERT_TARGETS,
} from '../services/engagementDiscussions';
import { str, send, notFound, loadEngagement, clientSide, flagFor, HELD_READ_ONLY, Engagement } from './engagementController';

/**
 * Threads on an engagement (consulting engagement, sprint 9).
 *
 * Each side reads the Engagement threads and its own internal ones, and
 * nothing decides that but the thread's visibility, fixed when it started.
 * A firm-internal post never reaches the organisation: not in a list, not in
 * a count, not as a notification, not on its audit trail; a client-internal
 * one never reaches the firm. A thread about a shared document, risk or
 * asset is the firm's to read only while the scope still shares it.
 */

type Access =
  | { ok: true; e: Engagement; side: 'Client'; userId: string; manager: boolean; scope: Scope | null }
  | { ok: true; e: Engagement; side: 'Provider'; userId: string; firm: FirmAccess; scope: Scope | null }
  | { ok: false; status: number; code?: string; message: string };

async function access(req: AuthenticatedRequest): Promise<Access> {
  const e = await loadEngagement(str(req.params.projectId));
  const userId = str(req.user!.id);
  if (!e) return { ok: false, status: 404, message: 'Engagement not found' };
  if (await clientSide(req, e)) {
    const refusal = await flagFor(e);
    if (refusal) return { ok: false, ...refusal };
    return { ok: true, e, side: 'Client', userId, manager: e.managerId === userId || e.ownerId === userId, scope: await bindingScope(e.id) };
  }
  if (e.providerTenantId && e.providerTenantId === req.user!.tenantId) {
    const firm = await firmAccess(e, userId);
    if (firm.reads) {
      const refusal = await flagFor(e);
      if (refusal) return { ok: false, ...refusal };
      return { ok: true, e, side: 'Provider', userId, firm, scope: await bindingScope(e.id) };
    }
  }
  return { ok: false, status: 404, message: 'Engagement not found' };
}
type Ok = Extract<Access, { ok: true }>;

/** Whether the caller may write in threads now. */
function writeRefusal(a: Ok): { status: number; code?: string; message: string } | null {
  if (isEnded(a.e.status)) return { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}; its threads are read only.` };
  if (a.side === 'Provider' && !a.firm.acts) {
    if (a.e.status === 'OnHold') return HELD_READ_ONLY;
    return { status: 403, code: 'OUTSIDE_ACCESS', message: 'Your access to this engagement is not open today.' };
  }
  return null;
}

const SERVICE: Record<string, ScopeService> = { Document: 'Documents', Risk: 'Risks', Asset: 'Assets' };

/** Of these subject ids, the ones the binding scope shares today. */
async function sharedIds(scope: Scope | null, type: string, ids: string[]): Promise<Set<string>> {
  const reg = registerScope(scope, SERVICE[type]);
  if (!reg || !ids.length) return new Set();
  if (type === 'Document') {
    const rows = await prisma.document.findMany({
      where: { id: { in: ids }, tenantId: { in: reg.tenantIds }, classification: { in: reg.classifications }, status: { not: 'ARCHIVED' } }, select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }
  if (type === 'Risk') {
    const rows = await prisma.risk.findMany({ where: { id: { in: ids }, tenantId: { in: reg.tenantIds } }, select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }
  const rows = await prisma.asset.findMany({ where: { id: { in: ids }, tenantId: { in: reg.tenantIds }, classification: { in: reg.classifications } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/**
 * The subject, named, if this side may start a thread of this visibility on
 * it. A shared record is named in an Engagement thread, or by the firm, only
 * while the scope shares it; the organisation's own internal threads may be
 * about any record it holds.
 */
async function resolveSubject(a: Ok, type: SubjectType, id: string, visibility: string): Promise<{ id: string | null; label: string } | null> {
  if (type === 'Engagement') return { id: null, label: `${a.e.ref} · ${a.e.name}` };
  if (!id) return null;
  if (type === 'Task') {
    const t = await prisma.projectTask.findFirst({ where: { id, projectId: a.e.id }, select: { id: true, ref: true, name: true } });
    return t ? { id: t.id, label: `${t.ref} ${t.name}` } : null;
  }
  if (type === 'Request') {
    const r = await prisma.informationRequest.findFirst({ where: { id, projectId: a.e.id }, select: { id: true, ref: true, title: true } });
    return r ? { id: r.id, label: `${r.ref} ${r.title}` } : null;
  }
  const mustBeShared = a.side === 'Provider' || visibility === 'Engagement';
  if (mustBeShared && !(await sharedIds(a.scope, type, [id])).has(id)) return null;
  const own = [a.e.tenantId, ...(registerScope(a.scope, SERVICE[type])?.tenantIds ?? [])];
  if (type === 'Document') {
    const d = await prisma.document.findFirst({ where: { id, tenantId: { in: own } }, select: { id: true, code: true, title: true } });
    return d ? { id: d.id, label: `${d.code} ${d.title}` } : null;
  }
  if (type === 'Risk') {
    const r = await prisma.risk.findFirst({ where: { id, tenantId: { in: own } }, select: { id: true, ref: true, title: true } });
    return r ? { id: r.id, label: `${r.ref} ${r.title}` } : null;
  }
  const s = await prisma.asset.findFirst({ where: { id, tenantId: { in: own } }, select: { id: true, ref: true, name: true } });
  return s ? { id: s.id, label: `${s.ref} ${s.name}` } : null;
}

/** Everyone who can read a thread of this visibility, by id, with names. */
async function readersOf(e: Engagement, visibility: string): Promise<Map<string, { name: string; side: Side }>> {
  const out = new Map<string, { name: string; side: Side }>();
  if (visibility !== 'FirmInternal') {
    const client = await prisma.projectMember.findMany({
      where: { projectId: e.id, side: 'Client', active: true, user: { status: 'Active' } }, select: { user: { select: { id: true, name: true } } },
    });
    for (const m of client) out.set(m.user.id, { name: m.user.name, side: 'Client' });
    const leads = await prisma.user.findMany({ where: { id: { in: [e.managerId, e.ownerId].filter(Boolean) as string[] }, status: 'Active' }, select: { id: true, name: true } });
    for (const u of leads) out.set(u.id, { name: u.name, side: 'Client' });
  }
  if (visibility !== 'ClientInternal' && !isEnded(e.status)) {
    const firm = await prisma.projectMember.findMany({
      where: { projectId: e.id, side: 'Provider', memberStatus: 'Approved', active: true, user: { status: 'Active' } },
      select: { accessFrom: true, accessTo: true, user: { select: { id: true, name: true } } },
    });
    for (const m of firm) if (accessOpen(m)) out.set(m.user.id, { name: m.user.name, side: 'Provider' });
  }
  return out;
}

/** The trail(s) a thread's activity belongs on: never the side that cannot read it. */
async function threadTrails(tx: any, a: Ok, visibility: string, args: { action: string; subjectId: string; payload: Record<string, unknown> }) {
  if (visibility !== 'FirmInternal') {
    await writeAudit(tx, {
      tenantId: a.e.tenantId, actorId: a.userId, action: args.action, subjectType: 'DiscussionThread', subjectId: args.subjectId,
      payload: { projectRef: a.e.ref, projectId: a.e.id, visibility, ...args.payload },
    });
  }
  if (visibility !== 'ClientInternal' && a.e.providerTenantId && a.e.providerTenantId !== a.e.tenantId) {
    await writeAudit(tx, {
      tenantId: a.e.providerTenantId, actorId: a.userId, action: args.action, subjectType: 'DiscussionThread', subjectId: args.subjectId,
      payload: { projectRef: a.e.ref, clientTenantId: a.e.tenantId, visibility, ...args.payload },
    });
  }
}

const THREAD_SELECT = {
  id: true, ref: true, subjectType: true, subjectId: true, subjectLabel: true, title: true, visibility: true, status: true,
  convertedToType: true, convertedToId: true, convertedToLabel: true, convertedAt: true, resolvedAt: true,
  createdAt: true, lastPostAt: true, createdById: true, createdBy: { select: { name: true } },
  _count: { select: { posts: true } },
} as const;

/** A thread this caller may read, or null (a 404). */
async function readableThread(a: Ok, threadId: string) {
  const t = await prisma.discussionThread.findFirst({ where: { id: threadId, projectId: a.e.id }, select: THREAD_SELECT });
  if (!t || !sideReads(a.side, t.visibility)) return null;
  if (a.side === 'Provider' && SCOPED_SUBJECTS.includes(t.subjectType as SubjectType)
    && !(await sharedIds(a.scope, t.subjectType, [t.subjectId ?? ''])).has(t.subjectId ?? '')) return null;
  return t;
}

/** Notifies the people named and the thread's starter, if they can read it and did not write it. */
async function tellReaders(tx: any, a: Ok, thread: { id: string; ref: string; title: string; createdById: string }, readers: Map<string, { side: Side }>, mentioned: string[], kind: string) {
  const rows: any[] = [];
  for (const id of mentioned) {
    if (id === a.userId || !readers.has(id)) continue;
    rows.push({ id, event: 'ENGAGEMENT_THREAD_MENTION', title: `You were named in ${thread.ref}: ${thread.title}` });
  }
  if (thread.createdById !== a.userId && readers.has(thread.createdById) && !mentioned.includes(thread.createdById)) {
    rows.push({ id: thread.createdById, event: 'ENGAGEMENT_THREAD_REPLY', title: `${kind === 'Decision' ? 'A decision' : 'A reply'} in ${thread.ref}: ${thread.title}` });
  }
  if (!rows.length) return;
  const people = await tx.user.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, tenantId: true } });
  const tenantOf = new Map<string, string>(people.map((p: { id: string; tenantId: string }) => [p.id, p.tenantId]));
  await notify(tx, rows.filter((r) => tenantOf.has(r.id)).map((r) => ({
    tenantId: tenantOf.get(r.id)!, recipientId: r.id, actorId: a.userId, event: r.event,
    subjectType: 'DiscussionThread', subjectId: thread.id, title: r.title, body: `${a.e.ref} · ${a.e.name}`, link: 'delivery',
  })));
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/** GET /api/engagements/:projectId/threads — the threads this side reads. */
export const listThreads = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const page = readPage(req.query as Record<string, unknown>, 50);
    const where: any = { projectId: a.e.id, visibility: { in: visibilitiesFor(a.side) } };
    if (req.query.subjectType) where.subjectType = str(req.query.subjectType);
    if (req.query.subjectId) where.subjectId = str(req.query.subjectId);
    if (req.query.status) where.status = str(req.query.status);
    // The firm reads threads on shared records only while they are shared.
    if (a.side === 'Provider') {
      const scoped = await prisma.discussionThread.findMany({
        where: { ...where, subjectType: { in: [...SCOPED_SUBJECTS] } }, select: { subjectType: true, subjectId: true },
      });
      const hidden: string[] = [];
      for (const type of SCOPED_SUBJECTS) {
        const ids = [...new Set(scoped.filter((t) => t.subjectType === type).map((t) => t.subjectId ?? ''))];
        const ok = await sharedIds(a.scope, type, ids);
        hidden.push(...ids.filter((id) => !ok.has(id)));
      }
      // NOT IN drops rows whose subject is empty, so those are kept by name.
      if (hidden.length) where.AND = [{ OR: [{ subjectId: null }, { subjectId: { notIn: hidden } }] }];
    }
    const [total, threads] = await Promise.all([
      prisma.discussionThread.count({ where }),
      prisma.discussionThread.findMany({ where, orderBy: [{ lastPostAt: 'desc' }, { id: 'asc' }], skip: page.skip, take: page.take, select: THREAD_SELECT }),
    ]);
    res.json({
      status: 'success', side: a.side, visibilities: visibilitiesFor(a.side), canWrite: !writeRefusal(a),
      threads, paging: pageInfo(total, page),
    });
  } catch (error: any) {
    console.error('[Threads Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the threads' });
  }
};

/**
 * GET /api/engagements/:projectId/threads/subjects?type=Task — what this side
 * may start a thread about, of one kind: the engagement's tasks and requests,
 * and the records its scope shares.
 */
export const threadSubjects = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const type = str(req.query.type);
    const q = str(req.query.q).trim();
    const like = q ? { contains: q, mode: 'insensitive' as const } : undefined;
    let rows: { id: string; label: string }[] = [];
    if (type === 'Task') {
      const t = await prisma.projectTask.findMany({ where: { projectId: a.e.id, ...(like ? { OR: [{ name: like }, { ref: like }] } : {}) }, select: { id: true, ref: true, name: true }, orderBy: { ref: 'asc' }, skip: 0, take: 50 });
      rows = t.map((x) => ({ id: x.id, label: `${x.ref} ${x.name}` }));
    } else if (type === 'Request') {
      const r = await prisma.informationRequest.findMany({ where: { projectId: a.e.id, ...(like ? { OR: [{ title: like }, { ref: like }] } : {}) }, select: { id: true, ref: true, title: true }, orderBy: { ref: 'asc' }, skip: 0, take: 50 });
      rows = r.map((x) => ({ id: x.id, label: `${x.ref} ${x.title}` }));
    } else if (type === 'Document' || type === 'Risk' || type === 'Asset') {
      const reg = registerScope(a.scope, SERVICE[type]);
      if (reg) {
        if (type === 'Document') {
          const d = await prisma.document.findMany({ where: { tenantId: { in: reg.tenantIds }, classification: { in: reg.classifications }, status: { not: 'ARCHIVED' }, ...(like ? { OR: [{ title: like }, { code: like }] } : {}) }, select: { id: true, code: true, title: true }, orderBy: { code: 'asc' }, skip: 0, take: 50 });
          rows = d.map((x) => ({ id: x.id, label: `${x.code} ${x.title}` }));
        } else if (type === 'Risk') {
          const r = await prisma.risk.findMany({ where: { tenantId: { in: reg.tenantIds }, ...(like ? { OR: [{ title: like }, { ref: like }] } : {}) }, select: { id: true, ref: true, title: true }, orderBy: { ref: 'asc' }, skip: 0, take: 50 });
          rows = r.map((x) => ({ id: x.id, label: `${x.ref} ${x.title}` }));
        } else {
          const s = await prisma.asset.findMany({ where: { tenantId: { in: reg.tenantIds }, classification: { in: reg.classifications }, ...(like ? { OR: [{ name: like }, { ref: like }] } : {}) }, select: { id: true, ref: true, name: true }, orderBy: { ref: 'asc' }, skip: 0, take: 50 });
          rows = s.map((x) => ({ id: x.id, label: `${x.ref} ${x.name}` }));
        }
      }
    } else {
      send(res, { status: 400, message: 'Ask for Task, Request, Document, Risk or Asset.' }); return;
    }
    res.json({ status: 'success', subjects: rows });
  } catch (error: any) {
    console.error('[Thread Subjects Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load what a thread can be about' });
  }
};

/** POST /api/engagements/:projectId/threads — start one, with its first post. */
export const startThread = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const refusal = writeRefusal(a);
    if (refusal) { send(res, refusal); return; }
    const b = req.body || {};
    const checked = checkThreadStart({ side: a.side, visibility: b.visibility, subjectType: b.subjectType, title: b.title, body: b.body, kind: b.kind });
    if (!checked.ok) { send(res, checked); return; }
    if (checked.kind === 'Decision') {
      const no = decisionRefusal({ visibility: checked.visibility, side: a.side, clientManager: a.side === 'Client' && a.manager, firmRole: a.side === 'Provider' ? a.firm.role : null });
      if (no) { send(res, no); return; }
    }
    const subject = await resolveSubject(a, checked.subjectType, str(b.subjectId), checked.visibility);
    if (!subject) { notFound(res, 'Subject'); return; }
    const readers = await readersOf(a.e, checked.visibility);
    const mentions = checkMentions(b.mentions, new Set(readers.keys()));
    if (!mentions.ok) { send(res, mentions); return; }

    const thread = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`threads:${a.e.id}`}))`;
      const ref = threadRef((await tx.discussionThread.count({ where: { projectId: a.e.id } })) + 1);
      const t = await tx.discussionThread.create({
        data: {
          projectId: a.e.id, ref, subjectType: checked.subjectType, subjectId: subject.id, subjectLabel: subject.label,
          title: checked.title, visibility: checked.visibility, createdById: a.userId,
          posts: {
            create: {
              kind: checked.kind, body: checked.body, authorId: a.userId, side: a.side,
              mentions: { create: mentions.ids.map((userId) => ({ userId })) },
            },
          },
        },
        select: { id: true, ref: true, title: true, createdById: true },
      });
      await threadTrails(tx, a, checked.visibility, {
        action: 'ENGAGEMENT_THREAD_STARTED', subjectId: t.id,
        payload: { ref, title: checked.title, subject: subject.label, subjectType: checked.subjectType, kind: checked.kind, mentions: mentions.ids.length },
      });
      await tellReaders(tx, a, t, readers, mentions.ids, checked.kind);
      return t;
    });
    res.status(201).json({ status: 'success', thread });
  } catch (error: any) {
    console.error('[Thread Start Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to start the thread' });
  }
};

/** GET /api/engagements/:projectId/threads/:threadId — the thread, its posts, who can be named, and what the caller may do. */
export const getThread = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const t = await readableThread(a, str(req.params.threadId));
    if (!t) { notFound(res, 'Thread'); return; }
    const [posts, readers] = await Promise.all([
      prisma.discussionPost.findMany({
        where: { threadId: t.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true, kind: true, body: true, side: true, createdAt: true, authorId: true, retractedAt: true, retractReason: true,
          author: { select: { name: true } }, mentions: { select: { user: { select: { id: true, name: true } } } },
        },
      }),
      readersOf(a.e, t.visibility),
    ]);
    const writable = !writeRefusal(a) && !postingRefusal(t);
    const decides = !decisionRefusal({ visibility: t.visibility, side: a.side, clientManager: a.side === 'Client' && a.manager, firmRole: a.side === 'Provider' ? a.firm.role : null });
    res.json({
      status: 'success', side: a.side, thread: t,
      posts: posts.map((p) => ({ ...p, mentions: p.mentions.map((m) => m.user), mine: p.authorId === a.userId })),
      mentionable: [...readers.entries()].filter(([id]) => id !== a.userId).map(([id, r]) => ({ id, name: r.name, side: r.side })),
      can: {
        post: writable, decide: writable && decides,
        resolve: !writeRefusal(a) && t.status !== 'Converted' && (t.createdById === a.userId || decides),
        convert: writable && t.status === 'Open',
        convertTo: a.side === 'Client' ? ['Task'] : (a.firm.role === 'Reviewer' ? [] : ['Request']),
      },
    });
  } catch (error: any) {
    console.error('[Thread Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the thread' });
  }
};

/** POST /api/engagements/:projectId/threads/:threadId/posts — a reply. */
export const addPost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const t = await readableThread(a, str(req.params.threadId));
    if (!t) { notFound(res, 'Thread'); return; }
    const refusal = writeRefusal(a) || postingRefusal(t);
    if (refusal) { send(res, refusal); return; }
    const post = checkPost({ kind: req.body?.kind, body: req.body?.body });
    if (!post.ok) { send(res, post); return; }
    if (post.kind === 'Decision') {
      const no = decisionRefusal({ visibility: t.visibility, side: a.side, clientManager: a.side === 'Client' && a.manager, firmRole: a.side === 'Provider' ? a.firm.role : null });
      if (no) { send(res, no); return; }
    }
    const readers = await readersOf(a.e, t.visibility);
    const mentions = checkMentions(req.body?.mentions, new Set(readers.keys()));
    if (!mentions.ok) { send(res, mentions); return; }
    const made = await prisma.$transaction(async (tx) => {
      const p = await tx.discussionPost.create({
        data: { threadId: t.id, kind: post.kind, body: post.body, authorId: a.userId, side: a.side, mentions: { create: mentions.ids.map((userId) => ({ userId })) } },
        select: { id: true },
      });
      await tx.discussionThread.update({ where: { id: t.id }, data: { lastPostAt: new Date(), ...(t.status === 'Resolved' ? { status: 'Open', resolvedAt: null, resolvedById: null } : {}) } });
      await threadTrails(tx, a, t.visibility, {
        action: post.kind === 'Decision' ? 'ENGAGEMENT_THREAD_DECISION' : 'ENGAGEMENT_THREAD_POSTED', subjectId: t.id,
        payload: { ref: t.ref, postId: p.id, kind: post.kind, mentions: mentions.ids.length, ...(post.kind === 'Decision' ? { decision: post.body.slice(0, 500) } : {}) },
      });
      await tellReaders(tx, a, t, readers, mentions.ids, post.kind);
      return p;
    });
    res.status(201).json({ status: 'success', post: made });
  } catch (error: any) {
    console.error('[Thread Post Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to post' });
  }
};

/** POST /api/engagements/:projectId/threads/:threadId/posts/:postId/retract { reason } — the words stay, marked. */
export const retractPost = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const t = await readableThread(a, str(req.params.threadId));
    if (!t) { notFound(res, 'Thread'); return; }
    const refusal = writeRefusal(a);
    if (refusal) { send(res, refusal); return; }
    const p = await prisma.discussionPost.findFirst({ where: { id: str(req.params.postId), threadId: t.id }, select: { id: true, authorId: true, retractedAt: true, kind: true } });
    if (!p) { notFound(res, 'Post'); return; }
    const reason = str(req.body?.reason).trim();
    const no = retractRefusal(p, a.userId, reason);
    if (no) { send(res, no); return; }
    await prisma.$transaction(async (tx) => {
      const done = await tx.discussionPost.updateMany({ where: { id: p.id, retractedAt: null }, data: { retractedAt: new Date(), retractedById: a.userId, retractReason: reason.slice(0, 500) } });
      if (done.count === 0) throw Object.assign(new Error('retracted'), { code: 'ALREADY_RETRACTED' });
      await threadTrails(tx, a, t.visibility, { action: 'ENGAGEMENT_THREAD_POST_RETRACTED', subjectId: t.id, payload: { ref: t.ref, postId: p.id, kind: p.kind, reason } });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error?.code === 'ALREADY_RETRACTED') { send(res, { status: 409, code: 'ALREADY_RETRACTED', message: 'This post has already been retracted.' }); return; }
    console.error('[Thread Retract Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to retract the post' });
  }
};

/** POST /api/engagements/:projectId/threads/:threadId/status { status: Resolved | Open } — by its starter, or whoever records decisions. */
export const setThreadStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const t = await readableThread(a, str(req.params.threadId));
    if (!t) { notFound(res, 'Thread'); return; }
    const refusal = writeRefusal(a);
    if (refusal) { send(res, refusal); return; }
    const status = str(req.body?.status);
    if (status !== 'Resolved' && status !== 'Open') { send(res, { status: 400, message: 'A thread is Resolved or Open.' }); return; }
    if (t.status === 'Converted') { send(res, { status: 409, code: 'CONVERTED', message: `This thread became ${t.convertedToLabel}.` }); return; }
    const decides = !decisionRefusal({ visibility: 'Engagement', side: a.side, clientManager: a.side === 'Client' && a.manager, firmRole: a.side === 'Provider' ? a.firm.role : null });
    if (t.createdById !== a.userId && !decides) {
      send(res, { status: 403, code: 'NOT_YOURS', message: 'The person who started the thread, the project manager or the firm\'s Lead resolves it.' }); return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.discussionThread.update({
        where: { id: t.id },
        data: status === 'Resolved' ? { status, resolvedAt: new Date(), resolvedById: a.userId } : { status, resolvedAt: null, resolvedById: null },
      });
      await threadTrails(tx, a, t.visibility, { action: status === 'Resolved' ? 'ENGAGEMENT_THREAD_RESOLVED' : 'ENGAGEMENT_THREAD_REOPENED', subjectId: t.id, payload: { ref: t.ref } });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    console.error('[Thread Status Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to change the thread' });
  }
};

/**
 * POST /api/engagements/:projectId/threads/:threadId/convert { type: Task | Request, id }
 *
 * The task or request is made through the route that already makes it, with
 * all of that route's rules; this links the thread to it and closes the
 * discussion there.
 */
export const convertThread = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await access(req);
    if (!a.ok) { send(res, a); return; }
    const t = await readableThread(a, str(req.params.threadId));
    if (!t) { notFound(res, 'Thread'); return; }
    const refusal = writeRefusal(a) || postingRefusal(t);
    if (refusal) { send(res, refusal); return; }
    const type = str(req.body?.type);
    if (!(CONVERT_TARGETS as readonly string[]).includes(type)) { send(res, { status: 400, message: 'A thread becomes a Task or a Request.' }); return; }
    const id = str(req.body?.id);
    const target = type === 'Task'
      ? await prisma.projectTask.findFirst({ where: { id, projectId: a.e.id }, select: { id: true, ref: true, name: true } }).then((x) => x && { id: x.id, label: `${x.ref} ${x.name}` })
      : await prisma.informationRequest.findFirst({ where: { id, projectId: a.e.id }, select: { id: true, ref: true, title: true } }).then((x) => x && { id: x.id, label: `${x.ref} ${x.title}` });
    if (!target) { notFound(res, type); return; }
    await prisma.$transaction(async (tx) => {
      const done = await tx.discussionThread.updateMany({
        where: { id: t.id, status: { not: 'Converted' } },
        data: { status: 'Converted', convertedToType: type, convertedToId: target.id, convertedToLabel: target.label, convertedAt: new Date(), convertedById: a.userId },
      });
      if (done.count === 0) throw Object.assign(new Error('converted'), { code: 'CONVERTED' });
      await threadTrails(tx, a, t.visibility, { action: 'ENGAGEMENT_THREAD_CONVERTED', subjectId: t.id, payload: { ref: t.ref, to: type, target: target.label } });
    });
    res.json({ status: 'success', convertedTo: { type, ...target } });
  } catch (error: any) {
    if (error?.code === 'CONVERTED') { send(res, { status: 409, code: 'CONVERTED', message: 'This thread has already been converted.' }); return; }
    console.error('[Thread Convert Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to convert the thread' });
  }
};
