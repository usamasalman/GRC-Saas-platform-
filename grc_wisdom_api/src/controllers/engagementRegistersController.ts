import { Response } from 'express';
import { prisma } from '../db';
import { readPage, pageInfo } from '../utils/paging';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { recordAccess, recordingIsMandatory } from '../services/documentReadGuard';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { accessOpen } from '../services/engagementRules';
import { bindingScope, registerScope, ScopeService } from '../services/engagementScope';
import { deliverDocument } from './documentController';
import {
  str, send, notFound, loadEngagement, clientSide, flagFor, bothTrails, Engagement,
} from './engagementController';

/**
 * The client's registers as an engagement shares them (consulting engagement,
 * sprint 6).
 *
 * A firm reaches the client's documents, risks and assets only here, through
 * the engagement, and only what its binding scope shares: the organisations
 * in scope, the registers named, records at or below the classification
 * ceiling, inside the scope's dates. Each request is checked: an approved
 * person of the firm, inside their own dates, not shut out by a hold.
 * Anything else answers 404, and a firm's attempt at a real record outside
 * the scope is written to the organisation's trail. The organisation's own
 * people can open the same views to see exactly what the firm sees.
 *
 * Shared documents are view only unless the organisation allows downloads on
 * this engagement; the download is refused on the server either way.
 */

const DOCUMENT_ACCESS = ['View', 'Download'] as const;

type Access =
  | { ok: true; e: Engagement; side: 'Client' | 'Provider'; reg: { tenantIds: string[]; classifications: string[] } | null }
  | { ok: false; status: number; code?: string; message: string };

/** The engagement, the caller's side, and what the binding scope shares of one register. */
async function registerAccess(req: AuthenticatedRequest, service: ScopeService): Promise<Access> {
  const e = await loadEngagement(str(req.params.projectId));
  if (!e) return { ok: false, status: 404, message: 'Engagement not found' };
  let side: 'Client' | 'Provider' | null = null;
  if (await clientSide(req, e)) side = 'Client';
  else if (e.providerTenantId && e.providerTenantId === req.user!.tenantId) {
    // New routes, so enforced from the start whatever the regime: an
    // approved person of the firm inside their own dates, and not while a
    // hold keeps the firm out.
    const m = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: e.id, userId: str(req.user!.id) } },
      select: { side: true, memberStatus: true, active: true, accessFrom: true, accessTo: true },
    });
    const approved = Boolean(m && m.active && m.side === 'Provider' && m.memberStatus === 'Approved' && accessOpen(m));
    const shutOut = e.status === 'OnHold' && (await prisma.projectHold.findFirst({
      where: { projectId: e.id, endedAt: null }, select: { firmAccess: true },
    }))?.firmAccess === 'None';
    if (approved && !shutOut) side = 'Provider';
  }
  if (!side) return { ok: false, status: 404, message: 'Engagement not found' };
  const refusal = await flagFor(e);
  if (refusal) return { ok: false, ...refusal };
  return { ok: true, e, side, reg: registerScope(await bindingScope(e.id), service) };
}

const fail = (res: Response, a: Extract<Access, { ok: false }>) => send(res, { status: a.status, code: a.code, message: a.message });

/**
 * A firm person asked for a real record of the client that the scope does not
 * share: written to the organisation's trail, with who asked, and answered
 * with the same 404 as a record that does not exist.
 */
async function refusedRead(req: AuthenticatedRequest, e: Engagement, subjectType: string, subjectId: string, reason: string) {
  await prisma.$transaction((tx) => writeAudit(tx, {
    tenantId: e.tenantId, actorId: str(req.user!.id), action: 'ENGAGEMENT_READ_REFUSED', subjectType, subjectId,
    payload: { ref: e.ref, projectId: e.id, actorTenantId: req.user!.tenantId, subjectId, reason },
  }));
}

// ─── Documents ─────────────────────────────────────────────────────────────

const DOC_LIST_SELECT = {
  id: true, code: true, title: true, category: true, classification: true, status: true, version: true,
  updatedAt: true, publishedAt: true, fileName: true, tenantId: true,
  owner: { select: { name: true } },
} as const;

/** GET /api/engagements/:projectId/documents — the shared part of the client's library. */
export const listSharedDocuments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await registerAccess(req, 'Documents');
    if (!a.ok) { fail(res, a); return; }
    const page = readPage(req.query as Record<string, unknown>, 50);
    const documentAccess = a.e.documentAccess === 'Download' ? 'Download' : 'View';
    if (!a.reg) {
      res.json({ status: 'success', shared: false, documentAccess, documents: [], paging: pageInfo(0, page) });
      return;
    }
    const search = str(req.query.search).trim();
    const where = {
      tenantId: { in: a.reg.tenantIds }, classification: { in: a.reg.classifications }, status: { not: 'ARCHIVED' },
      ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' as const } }, { code: { contains: search, mode: 'insensitive' as const } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.document.count({ where }),
      prisma.document.findMany({ where, orderBy: [{ code: 'asc' }], skip: page.skip, take: page.take, select: DOC_LIST_SELECT }),
    ]);
    res.json({
      status: 'success', shared: true, side: a.side, documentAccess,
      documents: rows.map(({ owner, ...d }) => ({ ...d, owner: owner?.name ?? null, hasFile: Boolean(d.fileName) })),
      paging: pageInfo(total, page),
    });
  } catch (error: any) {
    console.error('[Engagement Documents Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the shared documents' });
  }
};

/** One shared document, or the 404 a record outside the scope gets. */
async function sharedDocument(req: AuthenticatedRequest, a: Extract<Access, { ok: true }>) {
  const id = str(req.params.documentId);
  const doc = await prisma.document.findUnique({
    where: { id },
    select: { ...DOC_LIST_SELECT, content: true, fileUrl: true },
  });
  if (!doc) return null;
  const inScope = Boolean(a.reg) && a.reg!.tenantIds.includes(doc.tenantId)
    && a.reg!.classifications.includes(doc.classification) && doc.status !== 'ARCHIVED';
  if (inScope) return doc;
  // Only a real record of this client is worth the organisation's attention.
  if (a.side === 'Provider' && doc.tenantId === a.e.tenantId) {
    await refusedRead(req, a.e, 'Document', doc.id, a.reg ? 'outside-scope' : 'register-not-shared');
  }
  return null;
}

/** GET /api/engagements/:projectId/documents/:documentId — read it in the workspace. */
export const getSharedDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await registerAccess(req, 'Documents');
    if (!a.ok) { fail(res, a); return; }
    const doc = await sharedDocument(req, a);
    if (!doc) { notFound(res, 'Document'); return; }
    const recorded = await recordAccess({
      tenantId: doc.tenantId, documentId: doc.id, userId: str(req.user!.id), classification: doc.classification,
      basis: 'engagement', via: 'VIEW', now: new Date(),
    });
    if (!recorded && recordingIsMandatory(doc.classification)) {
      send(res, { status: 503, message: 'This document could not be opened because the access record could not be written.' });
      return;
    }
    const { owner, fileUrl, ...rest } = doc;
    res.json({
      status: 'success',
      document: { ...rest, owner: owner?.name ?? null, hasFile: Boolean(fileUrl) },
      documentAccess: a.e.documentAccess === 'Download' ? 'Download' : 'View',
    });
  } catch (error: any) {
    console.error('[Engagement Document Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the document' });
  }
};

/**
 * GET /api/engagements/:projectId/documents/:documentId/file — the bytes, to
 * view (?disposition=preview) or download. On a view-only engagement the
 * firm's download is refused; every delivery is recorded on the document's
 * Access tab, as the organisation's own reads are.
 */
export const fileSharedDocument = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await registerAccess(req, 'Documents');
    if (!a.ok) { fail(res, a); return; }
    const doc = await sharedDocument(req, a);
    if (!doc) { notFound(res, 'Document'); return; }
    const preview = str(req.query.disposition) === 'preview';
    if (!preview && a.side === 'Provider' && a.e.documentAccess !== 'Download') {
      send(res, {
        status: 403, code: 'VIEW_ONLY',
        message: `${a.e.tenant?.name || 'The organisation'} shares documents on this engagement to view only.`,
      });
      return;
    }
    const recorded = await recordAccess({
      tenantId: doc.tenantId, documentId: doc.id, userId: str(req.user!.id), classification: doc.classification,
      basis: 'engagement', via: preview ? 'PREVIEW' : 'DOWNLOAD', now: new Date(),
    });
    if (!recorded && recordingIsMandatory(doc.classification)) {
      send(res, { status: 503, message: 'This document could not be delivered because the access record could not be written.' });
      return;
    }
    deliverDocument(res, doc);
  } catch (error: any) {
    console.error('[Engagement Document File Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to deliver the document' });
  }
};

/**
 * PATCH /api/engagements/:projectId/document-access — the organisation lets
 * the firm download shared documents, or keeps them view only, with a reason.
 */
export const setDocumentAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e || !(await clientSide(req, e))) {
      if (e && e.providerTenantId === req.user!.tenantId) {
        send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'Only the organisation decides whether its documents can be downloaded.' });
        return;
      }
      notFound(res); return;
    }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    const value = str(req.body?.documentAccess);
    if (!(DOCUMENT_ACCESS as readonly string[]).includes(value)) {
      send(res, { status: 400, message: 'documentAccess must be View or Download.' }); return;
    }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    const before = e.documentAccess === 'Download' ? 'Download' : 'View';
    if (before === value) { res.json({ status: 'success', documentAccess: value, changed: false }); return; }
    const actorId = str(req.user!.id);
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: e.id }, data: { documentAccess: value, documentAccessSetAt: new Date(), documentAccessSetById: actorId },
      });
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_DOCUMENT_ACCESS_CHANGED',
        payload: { from: before, to: value, reason },
      });
      const leads = e.providerTenantId ? await tx.projectMember.findMany({
        where: { projectId: e.id, engagementRole: 'Lead', memberStatus: 'Approved', active: true }, select: { userId: true },
      }) : [];
      await notify(tx, leads.map((l) => ({
        tenantId: e.providerTenantId!, recipientId: l.userId, actorId, event: 'ENGAGEMENT_DOCUMENT_ACCESS_CHANGED',
        subjectType: 'Project', subjectId: e.id,
        title: value === 'Download' ? `Shared documents on ${e.ref} can now be downloaded` : `Shared documents on ${e.ref} are now view only`,
        body: reason, link: 'project-delivery',
      })));
    });
    res.json({ status: 'success', documentAccess: value, changed: true });
  } catch (error: any) {
    console.error('[Engagement Document Access Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to change the document setting' });
  }
};

// ─── Risks and assets ──────────────────────────────────────────────────────

/**
 * GET /api/engagements/:projectId/risks — the in-scope risk register with
 * the organisation's official scores only. The owner is named; their contact
 * details are not part of what is shared.
 */
export const listSharedRisks = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await registerAccess(req, 'Risks');
    if (!a.ok) { fail(res, a); return; }
    const page = readPage(req.query as Record<string, unknown>, 50);
    if (!a.reg) { res.json({ status: 'success', shared: false, risks: [], paging: pageInfo(0, page) }); return; }
    const where = { tenantId: { in: a.reg.tenantIds } };
    const [total, rows] = await Promise.all([
      prisma.risk.count({ where }),
      prisma.risk.findMany({
        where, orderBy: [{ residualScore: 'desc' }, { ref: 'asc' }], skip: page.skip, take: page.take,
        select: {
          id: true, ref: true, title: true, category: true, direction: true, status: true, treatmentType: true,
          inherentLikelihood: true, inherentImpact: true, inherentScore: true,
          residualLikelihood: true, residualImpact: true, residualScore: true, nextReviewDate: true,
          owner: { select: { name: true } },
        },
      }),
    ]);
    res.json({
      status: 'success', shared: true, side: a.side,
      risks: rows.map(({ owner, ...r }) => ({ ...r, owner: owner?.name ?? null })),
      paging: pageInfo(total, page),
    });
  } catch (error: any) {
    console.error('[Engagement Risks Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the shared risks' });
  }
};

/** GET /api/engagements/:projectId/assets — in-scope assets at or below the ceiling. */
export const listSharedAssets = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await registerAccess(req, 'Assets');
    if (!a.ok) { fail(res, a); return; }
    const page = readPage(req.query as Record<string, unknown>, 50);
    if (!a.reg) { res.json({ status: 'success', shared: false, assets: [], paging: pageInfo(0, page) }); return; }
    const where = { tenantId: { in: a.reg.tenantIds }, classification: { in: a.reg.classifications } };
    const [total, rows] = await Promise.all([
      prisma.asset.count({ where }),
      prisma.asset.findMany({
        where, orderBy: [{ criticality: 'desc' }, { ref: 'asc' }], skip: page.skip, take: page.take,
        select: {
          id: true, ref: true, name: true, type: true, classification: true, status: true,
          confidentiality: true, integrity: true, availability: true, criticality: true, criticalityTier: true,
          owner: { select: { name: true } },
        },
      }),
    ]);
    res.json({
      status: 'success', shared: true, side: a.side,
      assets: rows.map(({ owner, ...x }) => ({ ...x, owner: owner?.name ?? null })),
      paging: pageInfo(total, page),
    });
  } catch (error: any) {
    console.error('[Engagement Assets Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the shared assets' });
  }
};
