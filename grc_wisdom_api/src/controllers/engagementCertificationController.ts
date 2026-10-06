import { Response } from 'express';
import fs from 'fs';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { isEnded } from '../services/engagementAfterClose';
import { createIssueRecord } from '../services/issueFactory';
import { resolveEvidencePath, verifyStoredHash } from '../services/evidenceStore';
import {
  AUDITOR_TYPE, QUESTION_KINDS, PACK_REPORTS, checkWindow, bodyMayRead, relatedness, companyDomains, confirmationRefusal, questionRef, packRef,
} from '../services/certificationAccess';
import { produceReport, loadReportEngagement } from './deliveryReportController';
import { str, send, notFound, loadEngagement, clientSide, flagFor, Conflict, Engagement } from './engagementController';

/**
 * The certification body (consulting engagement, sprint 13).
 *
 * The organisation invites its certification body, freezes the audit pack,
 * answers the body's questions and records any nonconformity as an Issue of
 * its own with source ExternalAudit. The body reads the frozen pack and its
 * own questions, inside the days the organisation set, and nothing else:
 * every other route answers it with the 404 anyone outside the engagement
 * gets, and a read outside its days is refused on the organisation's trail.
 */

type OrgAccess = { ok: true; e: Engagement; userId: string; leads: boolean } | { ok: false; status: number; code?: string; message: string };

async function orgAccess(req: AuthenticatedRequest): Promise<OrgAccess> {
  const e = await loadEngagement(str(req.params.projectId));
  if (!e || !(await clientSide(req, e))) return { ok: false, status: 404, message: 'Engagement not found' };
  const refusal = await flagFor(e);
  if (refusal) return { ok: false, ...refusal };
  const userId = str(req.user!.id);
  return { ok: true, e, userId, leads: e.managerId === userId || e.ownerId === userId };
}
type Org = Extract<OrgAccess, { ok: true }>;

const leadsOnly = (a: Org) => (a.leads ? null : { status: 403, code: 'ORGANISATION_LEADS', message: 'The project manager or owner does this.' });

const ACCESS_SELECT = {
  id: true, projectId: true, bodyTenantId: true, status: true, accessFrom: true, accessTo: true, invitedAt: true, respondedAt: true,
  revokedAt: true, revokeReason: true, warnings: true, confirmationReason: true, invitedBy: { select: { name: true } },
} as const;

const parse = (s: string | null, fallback: any) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// ─── The organisation's side ────────────────────────────────────────────────

/** GET /api/engagements/:projectId/certification — the body's access, the frozen packs and the questions. */
export const getCertification = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await orgAccess(req);
    if (!a.ok) { send(res, a); return; }
    const [access, packs, questions, bodies] = await Promise.all([
      prisma.certificationAccess.findMany({ where: { projectId: a.e.id }, orderBy: { invitedAt: 'desc' }, skip: 0, take: 20, select: ACCESS_SELECT }),
      prisma.auditPack.findMany({ where: { projectId: a.e.id }, orderBy: { frozenAt: 'desc' }, skip: 0, take: 20, select: { id: true, ref: true, frozenAt: true, frozenBy: { select: { name: true } }, items: { select: { id: true, kind: true, name: true, documentRef: true, issueNumber: true, sha256: true, fileName: true } } } }),
      prisma.auditorQuestion.findMany({ where: { projectId: a.e.id }, orderBy: { askedAt: 'desc' }, skip: 0, take: 200, select: { id: true, ref: true, kind: true, text: true, clauseRef: true, status: true, answer: true, askedAt: true, answeredAt: true, issueId: true, askedBy: { select: { name: true } }, answeredBy: { select: { name: true } } } }),
      prisma.tenant.findMany({ where: { type: AUDITOR_TYPE, suspendedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' }, skip: 0, take: 200 }),
    ]);
    const names = new Map((await prisma.tenant.findMany({ where: { id: { in: access.map((x) => x.bodyTenantId) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
    const issues = await prisma.issue.findMany({ where: { id: { in: questions.map((q) => q.issueId).filter(Boolean) as string[] } }, select: { id: true, ref: true, status: true } });
    res.json({
      status: 'success',
      access: access.map((x) => ({ ...x, body: names.get(x.bodyTenantId) ?? 'Unknown', warnings: parse(x.warnings, []), open: bodyMayRead(x, new Date()) })),
      packs, questions: questions.map((q) => ({ ...q, issue: issues.find((i) => i.id === q.issueId) ?? null })), bodies,
      can: { invite: a.leads && !isEnded(a.e.status), freeze: a.leads, answer: true, record: a.leads },
    });
  } catch (error: any) {
    console.error('[Certification Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the certification body\'s access' });
  }
};

/**
 * POST /api/engagements/:projectId/certification { bodyTenantId, accessFrom, accessTo, confirmed?, reason? }
 *
 * A body related to the delivery firm (its people share a company mail
 * domain with the firm's) is a warning the organisation confirms with a
 * reason, recorded. One body at a time: revoke it to invite another.
 */
export const inviteBody = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await orgAccess(req);
    if (!a.ok) { send(res, a); return; }
    const no = leadsOnly(a);
    if (no) { send(res, no); return; }
    if (isEnded(a.e.status)) { send(res, { status: 409, code: 'ENGAGEMENT_ENDED', message: `This engagement is ${a.e.status}.` }); return; }
    const b = req.body || {};
    const body = await prisma.tenant.findUnique({ where: { id: str(b.bodyTenantId) }, select: { id: true, name: true, type: true, suspendedAt: true } });
    if (!body || body.type !== AUDITOR_TYPE || body.suspendedAt) { send(res, { status: 400, code: 'NOT_A_BODY', message: 'Invite a certification body: an auditor organisation on the platform.' }); return; }
    const window = checkWindow(b.accessFrom, b.accessTo, new Date());
    if (!window.ok) { send(res, window); return; }
    // Every person's domain, however many people: a few distinct values, read in one query.
    const domainsOf = async (tenantId: string) => companyDomains((await prisma.$queryRaw<{ d: string }[]>`
      SELECT DISTINCT lower(split_part(email, '@', 2)) AS d FROM "User" WHERE "tenantId" = ${tenantId}`).map((r) => r.d));
    const warnings = a.e.providerTenantId
      ? relatedness({ bodyDomains: await domainsOf(body.id), firmDomains: await domainsOf(a.e.providerTenantId), firmName: a.e.providerTenant?.name || 'the delivery firm' })
      : [];
    const refused = confirmationRefusal(warnings, b.confirmed, b.reason);
    // The warnings go back with the refusal, so the screen can show them and ask why.
    if (refused) { res.status(refused.status).json({ status: 'error', code: refused.code, message: refused.message, warnings }); return; }
    const made = await prisma.$transaction(async (tx) => {
      // Checked under the engagement's lock, so two invitations sent together cannot both stand.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`certification:${a.e.id}`}))`;
      const live = await tx.certificationAccess.count({ where: { projectId: a.e.id, status: { in: ['Invited', 'Accepted'] } } });
      if (live) throw new Conflict('ALREADY_INVITED', 'A certification body is already invited. Revoke it first.');
      const row = await tx.certificationAccess.create({
        data: {
          projectId: a.e.id, bodyTenantId: body.id, accessFrom: window.from, accessTo: window.to, invitedById: a.userId,
          warnings: JSON.stringify(warnings), confirmationReason: warnings.length ? str(b.reason).trim() : null,
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        tenantId: a.e.tenantId, actorId: a.userId, action: 'CERTIFICATION_BODY_INVITED', subjectType: 'Project', subjectId: a.e.id,
        payload: { projectRef: a.e.ref, body: body.name, bodyTenantId: body.id, from: window.from, to: window.to, warnings, reason: warnings.length ? str(b.reason).trim() : null },
      });
      await writeAudit(tx, {
        tenantId: body.id, actorId: a.userId, action: 'CERTIFICATION_BODY_INVITED', subjectType: 'Project', subjectId: a.e.id,
        payload: { projectRef: a.e.ref, clientTenantId: a.e.tenantId, from: window.from, to: window.to },
      });
      const admins = await tx.user.findMany({ where: { tenantId: body.id, status: 'Active' }, select: { id: true }, take: 25 });
      await notify(tx, admins.map((u) => ({
        tenantId: body.id, recipientId: u.id, actorId: a.userId, event: 'CERTIFICATION_INVITATION', subjectType: 'CertificationAccess', subjectId: row.id,
        title: `${a.e.tenant?.name} invites you to audit ${a.e.name}`, body: `Read-only, ${window.from.toISOString().slice(0, 10)} to ${window.to.toISOString().slice(0, 10)}.`, link: 'certification',
      })));
      return row;
    });
    res.status(201).json({ status: 'success', access: made, warnings });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Certification Invite Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to invite the certification body' });
  }
};

/** POST /api/engagements/:projectId/certification/:accessId/revoke { reason } */
export const revokeBody = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await orgAccess(req);
    if (!a.ok) { send(res, a); return; }
    const no = leadsOnly(a);
    if (no) { send(res, no); return; }
    const reason = str(req.body?.reason).trim();
    if (reason.length < 10) { send(res, { status: 400, code: 'REASON_REQUIRED', message: 'Say why, in at least 10 characters.' }); return; }
    const x = await prisma.certificationAccess.findFirst({ where: { id: str(req.params.accessId), projectId: a.e.id }, select: { id: true, status: true, bodyTenantId: true } });
    if (!x) { notFound(res, 'Access'); return; }
    if (x.status === 'Revoked' || x.status === 'Declined') { send(res, { status: 409, code: 'ENDED', message: `It is already ${x.status.toLowerCase()}.` }); return; }
    await prisma.$transaction(async (tx) => {
      // Only from a live state, so a decline that lands first is not overwritten.
      const moved = await tx.certificationAccess.updateMany({ where: { id: x.id, status: { in: ['Invited', 'Accepted'] } }, data: { status: 'Revoked', revokedById: a.userId, revokedAt: new Date(), revokeReason: reason } });
      if (moved.count === 0) throw new Conflict('ENDED', 'It has just been declined or revoked.');
      await writeAudit(tx, { tenantId: a.e.tenantId, actorId: a.userId, action: 'CERTIFICATION_BODY_REVOKED', subjectType: 'Project', subjectId: a.e.id, payload: { projectRef: a.e.ref, bodyTenantId: x.bodyTenantId, reason } });
      await writeAudit(tx, { tenantId: x.bodyTenantId, actorId: a.userId, action: 'CERTIFICATION_BODY_REVOKED', subjectType: 'Project', subjectId: a.e.id, payload: { projectRef: a.e.ref, clientTenantId: a.e.tenantId } });
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    if (error instanceof Conflict) { send(res, { status: 409, code: error.code, message: error.message }); return; }
    console.error('[Certification Revoke Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to revoke the access' });
  }
};

/**
 * POST /api/engagements/:projectId/certification/packs — freezes the audit
 * pack: the Statement of Applicability, the traceability report and the
 * readiness report, each issued, stored and hashed now.
 */
export const freezePack = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await orgAccess(req);
    if (!a.ok) { send(res, a); return; }
    const no = leadsOnly(a);
    if (no) { send(res, no); return; }
    const re = await loadReportEngagement(a.e.id);
    if (!re) { notFound(res); return; }
    const items: { reportIssueId: string; kind: string; name: string; documentRef: string; issueNumber: number; storageKey: string; sha256: string; fileName: string }[] = [];
    for (const r of PACK_REPORTS) {
      const out = await produceReport({ e: re, kind: r.kind, format: 'pdf', userId: a.userId, issued: true, keep: true });
      if (!out.ok || !out.stored) { send(res, { status: 500, message: `The ${r.name} could not be produced.` }); return; }
      items.push({ reportIssueId: out.reportIssueId, kind: r.kind, name: r.name, documentRef: out.documentRef, issueNumber: out.issueNumber, storageKey: out.stored.storageKey, sha256: out.stored.sha256, fileName: out.fileName });
    }
    const pack = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`packs:${a.e.id}`}))`;
      const ref = packRef((await tx.auditPack.count({ where: { projectId: a.e.id } })) + 1);
      const row = await tx.auditPack.create({ data: { projectId: a.e.id, ref, frozenById: a.userId, items: { create: items } }, select: { id: true, ref: true } });
      await writeAudit(tx, {
        tenantId: a.e.tenantId, actorId: a.userId, action: 'AUDIT_PACK_FROZEN', subjectType: 'Project', subjectId: a.e.id,
        payload: { projectRef: a.e.ref, pack: ref, items: items.map((i) => ({ report: i.kind, documentRef: i.documentRef, sha256: i.sha256 })) },
      });
      return row;
    });
    res.status(201).json({ status: 'success', pack });
  } catch (error: any) {
    console.error('[Pack Freeze Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to freeze the audit pack' });
  }
};

/** POST /api/engagements/:projectId/certification/questions/:questionId/answer { answer } */
export const answerQuestion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await orgAccess(req);
    if (!a.ok) { send(res, a); return; }
    const answer = str(req.body?.answer).trim();
    if (answer.length < 5) { send(res, { status: 400, message: 'Write the answer.' }); return; }
    const q = await prisma.auditorQuestion.findFirst({ where: { id: str(req.params.questionId), projectId: a.e.id }, select: { id: true, ref: true, kind: true, status: true, askedById: true, askedBy: { select: { tenantId: true } } } });
    if (!q) { notFound(res, 'Question'); return; }
    if (q.kind === 'Nonconformity') { send(res, { status: 409, code: 'RECORD_IT', message: 'A nonconformity is recorded as an issue, not answered.' }); return; }
    if (q.status !== 'Open') { send(res, { status: 409, code: 'ANSWERED', message: `${q.ref} is already answered.` }); return; }
    await prisma.$transaction(async (tx) => {
      await tx.auditorQuestion.update({ where: { id: q.id }, data: { status: 'Answered', answer: answer.slice(0, 8000), answeredById: a.userId, answeredAt: new Date() } });
      await writeAudit(tx, { tenantId: a.e.tenantId, actorId: a.userId, action: 'AUDITOR_QUESTION_ANSWERED', subjectType: 'AuditorQuestion', subjectId: q.id, payload: { projectRef: a.e.ref, ref: q.ref } });
      await notify(tx, [{ tenantId: q.askedBy.tenantId, recipientId: q.askedById, actorId: a.userId, event: 'AUDITOR_QUESTION_ANSWERED', subjectType: 'AuditorQuestion', subjectId: q.id, title: `${q.ref} answered by ${a.e.tenant?.name}`, body: '', link: 'certification' }]);
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    console.error('[Question Answer Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to answer' });
  }
};

/**
 * POST /api/engagements/:projectId/certification/questions/:questionId/record { title, criterion, condition, recommendation, riskRating? }
 *
 * The organisation records the body's nonconformity as an Issue of its own,
 * source ExternalAudit, which it then answers and closes like any other.
 */
export const recordNonconformity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await orgAccess(req);
    if (!a.ok) { send(res, a); return; }
    const no = leadsOnly(a);
    if (no) { send(res, no); return; }
    const q = await prisma.auditorQuestion.findFirst({ where: { id: str(req.params.questionId), projectId: a.e.id }, select: { id: true, ref: true, kind: true, status: true, text: true, clauseRef: true, accessId: true } });
    if (!q) { notFound(res, 'Question'); return; }
    if (q.kind !== 'Nonconformity') { send(res, { status: 409, code: 'NOT_A_NONCONFORMITY', message: 'Only a nonconformity is recorded as an issue.' }); return; }
    if (q.status !== 'Open') { send(res, { status: 409, code: 'RECORDED', message: `${q.ref} is already recorded.` }); return; }
    const b = req.body || {};
    const title = str(b.title).trim() || `Nonconformity ${q.clauseRef ?? ''}`.trim();
    const recommendation = str(b.recommendation).trim();
    if (recommendation.length < 10) { send(res, { status: 400, code: 'RECOMMENDATION_REQUIRED', message: 'Say what correction is needed, in at least 10 characters.' }); return; }
    const access = await prisma.certificationAccess.findUnique({ where: { id: q.accessId }, select: { bodyTenantId: true } });
    const bodyName = access ? (await prisma.tenant.findUnique({ where: { id: access.bodyTenantId }, select: { name: true } }))?.name : null;
    const issue = await prisma.$transaction(async (tx) => {
      const i = await createIssueRecord(tx, {
        tenantId: a.e.tenantId, source: 'ExternalAudit', sourceReference: `${bodyName ?? 'Certification body'} ${a.e.ref}/${q.ref}`,
        title: title.slice(0, 300), recommendation, criterion: str(b.criterion).trim() || q.clauseRef, condition: str(b.condition).trim() || q.text,
        riskRating: ['Low', 'Medium', 'High', 'Critical'].includes(str(b.riskRating)) ? str(b.riskRating) : 'Medium', raisedById: a.userId,
      });
      await tx.issue.update({ where: { id: i.id }, data: { projectId: a.e.id } });
      await tx.auditorQuestion.update({ where: { id: q.id }, data: { status: 'Recorded', issueId: i.id, answeredById: a.userId, answeredAt: new Date() } });
      await writeAudit(tx, { tenantId: a.e.tenantId, actorId: a.userId, action: 'NONCONFORMITY_RECORDED', subjectType: 'Issue', subjectId: i.id, payload: { projectRef: a.e.ref, question: q.ref, issue: i.ref } });
      return i;
    });
    res.status(201).json({ status: 'success', issue: { id: issue.id, ref: issue.ref } });
  } catch (error: any) {
    console.error('[Nonconformity Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record the nonconformity' });
  }
};

// ─── The certification body's side ──────────────────────────────────────────

/** The body's access to one engagement, if the caller belongs to the body and it is open today; refusals go on the organisation's trail. */
async function bodyAccess(req: AuthenticatedRequest): Promise<{ ok: true; access: { id: string; projectId: string; bodyTenantId: string; status: string; accessFrom: Date; accessTo: Date }; project: { id: string; ref: string; name: string; tenantId: string } } | { ok: false; status: number; message: string }> {
  const x = await prisma.certificationAccess.findUnique({ where: { id: str(req.params.accessId) }, select: { id: true, projectId: true, bodyTenantId: true, status: true, accessFrom: true, accessTo: true } });
  if (!x || x.bodyTenantId !== req.user!.tenantId) return { ok: false, status: 404, message: 'Not found' };
  const project = await prisma.project.findUnique({ where: { id: x.projectId }, select: { id: true, ref: true, name: true, tenantId: true } });
  if (!project) return { ok: false, status: 404, message: 'Not found' };
  if (!bodyMayRead(x, new Date())) {
    await prisma.$transaction((tx) => writeAudit(tx, {
      tenantId: project.tenantId, actorId: str(req.user!.id), action: 'CERTIFICATION_READ_REFUSED', subjectType: 'Project', subjectId: project.id,
      payload: { projectRef: project.ref, bodyTenantId: x.bodyTenantId, status: x.status, path: req.path },
    }));
    return { ok: false, status: 404, message: 'Not found' };
  }
  return { ok: true, access: x, project };
}

/** GET /api/certification/mine — the body's invitations and open engagements. */
export const myCertifications = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rows = await prisma.certificationAccess.findMany({
      where: { bodyTenantId: req.user!.tenantId, status: { in: ['Invited', 'Accepted'] } }, orderBy: { invitedAt: 'desc' }, skip: 0, take: 100,
      select: { ...ACCESS_SELECT, project: { select: { ref: true, name: true, tenant: { select: { name: true } } } } },
    });
    const now = new Date();
    res.json({ status: 'success', access: rows.map((x) => ({ ...x, warnings: undefined, confirmationReason: undefined, open: bodyMayRead(x, now) })) });
  } catch (error: any) {
    console.error('[My Certifications Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load your engagements' });
  }
};

/** POST /api/certification/:accessId/respond { decision: Accepted | Declined } */
export const respondToInvitation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const x = await prisma.certificationAccess.findUnique({ where: { id: str(req.params.accessId) }, select: { id: true, status: true, bodyTenantId: true, projectId: true, project: { select: { ref: true, tenantId: true } } } });
    if (!x || x.bodyTenantId !== req.user!.tenantId) { send(res, { status: 404, message: 'Not found' }); return; }
    const decision = str(req.body?.decision);
    if (decision !== 'Accepted' && decision !== 'Declined') { send(res, { status: 400, message: 'Accepted or Declined.' }); return; }
    if (x.status !== 'Invited') { send(res, { status: 409, code: 'ANSWERED', message: `This invitation is ${x.status.toLowerCase()}.` }); return; }
    await prisma.$transaction(async (tx) => {
      await tx.certificationAccess.update({ where: { id: x.id }, data: { status: decision, respondedById: str(req.user!.id), respondedAt: new Date() } });
      for (const tenantId of [x.project.tenantId, x.bodyTenantId]) {
        await writeAudit(tx, { tenantId, actorId: str(req.user!.id), action: `CERTIFICATION_INVITATION_${decision.toUpperCase()}`, subjectType: 'Project', subjectId: x.projectId, payload: { projectRef: x.project.ref } });
      }
    });
    res.json({ status: 'success' });
  } catch (error: any) {
    console.error('[Certification Respond Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to answer the invitation' });
  }
};

/** GET /api/certification/:accessId — the frozen packs and the body's questions. */
export const bodyView = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const b = await bodyAccess(req);
    if (!b.ok) { send(res, b); return; }
    const [packs, questions] = await Promise.all([
      prisma.auditPack.findMany({ where: { projectId: b.project.id }, orderBy: { frozenAt: 'desc' }, skip: 0, take: 20, select: { id: true, ref: true, frozenAt: true, items: { select: { id: true, kind: true, name: true, documentRef: true, issueNumber: true, sha256: true, fileName: true } } } }),
      prisma.auditorQuestion.findMany({ where: { projectId: b.project.id, accessId: b.access.id }, orderBy: { askedAt: 'desc' }, skip: 0, take: 200, select: { id: true, ref: true, kind: true, text: true, clauseRef: true, status: true, answer: true, askedAt: true, answeredAt: true } }),
    ]);
    res.json({ status: 'success', project: { ref: b.project.ref, name: b.project.name }, access: { from: b.access.accessFrom, to: b.access.accessTo }, packs, questions, kinds: QUESTION_KINDS });
  } catch (error: any) {
    console.error('[Body View Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the audit pack' });
  }
};

/** GET /api/certification/:accessId/items/:itemId/file — one frozen report, its hash checked before it is sent. */
export const packItemFile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const b = await bodyAccess(req);
    if (!b.ok) { send(res, b); return; }
    const item = await prisma.auditPackItem.findFirst({ where: { id: str(req.params.itemId), pack: { projectId: b.project.id } }, select: { id: true, storageKey: true, sha256: true, fileName: true, documentRef: true } });
    if (!item) { notFound(res, 'Report'); return; }
    const full = resolveEvidencePath(item.storageKey);
    if (!full || !fs.existsSync(full) || !(await verifyStoredHash(item.storageKey, item.sha256))) {
      send(res, { status: 409, code: 'HASH_MISMATCH', message: 'The stored report does not match its hash and is not served.' }); return;
    }
    await prisma.$transaction((tx) => writeAudit(tx, {
      tenantId: b.project.tenantId, actorId: str(req.user!.id), action: 'AUDIT_PACK_READ', subjectType: 'Project', subjectId: b.project.id,
      payload: { projectRef: b.project.ref, documentRef: item.documentRef, sha256: item.sha256, bodyTenantId: b.access.bodyTenantId },
    }));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${item.fileName.replace(/"/g, '')}"`);
    res.setHeader('X-Document-Ref', item.documentRef);
    fs.createReadStream(full).pipe(res);
  } catch (error: any) {
    console.error('[Pack File Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to deliver the report' });
  }
};

/** POST /api/certification/:accessId/questions { kind: Question | EvidenceRequest | Nonconformity, text, clauseRef? } */
export const askQuestion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const b = await bodyAccess(req);
    if (!b.ok) { send(res, b); return; }
    const kind = str(req.body?.kind);
    if (![...QUESTION_KINDS, 'Nonconformity'].includes(kind)) { send(res, { status: 400, message: 'A question, an evidence request or a nonconformity.' }); return; }
    const text = str(req.body?.text).trim();
    if (text.length < 10) { send(res, { status: 400, code: 'TEXT_REQUIRED', message: 'Write it out, in at least 10 characters.' }); return; }
    const clauseRef = str(req.body?.clauseRef).trim() || null;
    if (kind === 'Nonconformity' && !clauseRef) { send(res, { status: 400, code: 'CLAUSE_REQUIRED', message: 'Name the clause the nonconformity is against.' }); return; }
    const made = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`auditor-questions:${b.project.id}`}))`;
      const ref = questionRef((await tx.auditorQuestion.count({ where: { projectId: b.project.id } })) + 1);
      const row = await tx.auditorQuestion.create({ data: { projectId: b.project.id, accessId: b.access.id, ref, kind, text: text.slice(0, 8000), clauseRef, askedById: str(req.user!.id) }, select: { id: true, ref: true } });
      for (const tenantId of [b.project.tenantId, b.access.bodyTenantId]) {
        await writeAudit(tx, { tenantId, actorId: str(req.user!.id), action: 'AUDITOR_QUESTION_ASKED', subjectType: 'AuditorQuestion', subjectId: row.id, payload: { projectRef: b.project.ref, ref, kind, clauseRef } });
      }
      const leads = await tx.project.findUnique({ where: { id: b.project.id }, select: { managerId: true, ownerId: true } });
      await notify(tx, [...new Set([leads?.managerId, leads?.ownerId].filter(Boolean) as string[])].map((recipientId) => ({
        tenantId: b.project.tenantId, recipientId, actorId: str(req.user!.id), event: 'AUDITOR_QUESTION_ASKED', subjectType: 'AuditorQuestion', subjectId: row.id,
        title: `${ref}: the certification body ${kind === 'Nonconformity' ? 'raises a nonconformity' : kind === 'EvidenceRequest' ? 'asks for evidence' : 'asks a question'}`, body: text.slice(0, 300), link: 'project-delivery',
      })));
      return row;
    });
    res.status(201).json({ status: 'success', question: made });
  } catch (error: any) {
    console.error('[Ask Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to send the question' });
  }
};
