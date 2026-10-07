import { Response } from 'express';
import { prisma } from '../db';
import { readPage, pageInfo } from '../utils/paging';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveEvidencePath, verifyStoredHash } from '../services/evidenceStore';
import { validAllocation } from '../services/projectMembership';
import { isEnded, closeWindowEnd } from '../services/engagementAfterClose';
import { str, send, notFound, loadEngagement, flagFor, bothTrails, HELD_READ_ONLY } from './engagementController';

/**
 * The delivery firm's own side after close and across its engagements
 * (consulting engagement, sprint 7): Completed engagements and Firm team.
 *
 * A record and a report copy belong to the firm's tenant and nobody else's:
 * another tenant asking for one gets a 404, exactly as if it did not exist.
 * They are the firm's for good, so reading them does not depend on the
 * engagement's window after close or on the consulting flag; switching the
 * flag off never takes back what is already the firm's.
 *
 * The firm's managers read these screens (the route floor is managing
 * delivery projects), the same people who see every engagement the firm
 * delivers on its home.
 */

const OPEN_STATUSES = ['Draft', 'Active', 'OnHold'];
const parse = <T>(raw: string, empty: T): T => { try { return JSON.parse(raw) as T; } catch { return empty; } };

// ─── Completed engagements ──────────────────────────────────────────────────

/** GET /api/engagements/records — the firm's records, newest close first. */
export const listRecords = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const firmTenantId = str(req.user!.tenantId);
    const where = { firmTenantId };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const [total, rows] = await Promise.all([
      prisma.engagementRecord.count({ where }),
      prisma.engagementRecord.findMany({
        where, orderBy: [{ closedAt: 'desc' }, { id: 'asc' }], skip: page.skip, take: page.take,
        select: {
          id: true, ref: true, name: true, clientTenantId: true, clientName: true, outcome: true, deliveryStyle: true,
          startDate: true, targetEndDate: true, closedAt: true, figures: true,
        },
      }),
    ]);
    // How many issued reports the firm keeps for each, in one query.
    const counts = rows.length ? await prisma.engagementReportCopy.groupBy({
      by: ['clientTenantId', 'projectRef'],
      where: { firmTenantId, OR: rows.map((r) => ({ clientTenantId: r.clientTenantId, projectRef: r.ref })) },
      _count: { _all: true },
    }) : [];
    const copiesOf = new Map(counts.map((c) => [`${c.clientTenantId}|${c.projectRef}`, c._count._all]));
    res.json({
      status: 'success',
      paging: pageInfo(total, page),
      records: rows.map(({ figures, ...r }) => ({
        ...r,
        varianceDays: parse<{ varianceDays?: number | null }>(figures, {}).varianceDays ?? null,
        reportCopies: copiesOf.get(`${r.clientTenantId}|${r.ref}`) ?? 0,
      })),
    });
  } catch (error: any) {
    console.error('[Engagement Records Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load completed engagements' });
  }
};

/** GET /api/engagements/records/:id — one record, frozen at close, with the report copies kept. */
export const getRecord = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const firmTenantId = str(req.user!.tenantId);
    const r = await prisma.engagementRecord.findUnique({
      where: { id: str(req.params.id) },
      select: {
        id: true, firmTenantId: true, projectId: true, ref: true, name: true, projectType: true, clientTenantId: true, clientName: true,
        outcome: true, deliveryStyle: true, startDate: true, targetEndDate: true, closedAt: true,
        team: true, plan: true, figures: true, delayLedger: true, createdAt: true, madeBy: { select: { name: true } },
      },
    });
    if (!r || r.firmTenantId !== firmTenantId) { notFound(res, 'Record'); return; }
    const where = { firmTenantId, clientTenantId: r.clientTenantId, projectRef: r.ref };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const [project, total, copies] = await Promise.all([
      // While the window after close is open, the firm can still open the engagement itself.
      r.projectId ? prisma.project.findUnique({
        where: { id: r.projectId }, select: { status: true, actualEndDate: true, closeAccessUntil: true, closeWindowDays: true },
      }) : null,
      prisma.engagementReportCopy.count({ where }),
      prisma.engagementReportCopy.findMany({
        where, orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }], skip: page.skip, take: page.take,
        select: {
          id: true, reportKey: true, reportName: true, documentRef: true, issueNumber: true, format: true,
          fileName: true, byteLength: true, issuedAt: true,
        },
      }),
    ]);
    const { firmTenantId: _firm, team, plan, figures, delayLedger, ...rest } = r;
    const until = project && isEnded(project.status) ? closeWindowEnd(project) : null;
    res.json({
      status: 'success',
      record: {
        ...rest,
        windowUntil: until, windowOpen: Boolean(until && until.getTime() > Date.now()),
        team: parse(team, []), plan: parse(plan, []), figures: parse(figures, {}), delayLedger: parse(delayLedger, []),
      },
      reportCopies: copies,
      paging: pageInfo(total, page),
    });
  } catch (error: any) {
    console.error('[Engagement Record Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the record' });
  }
};

/** GET /api/engagements/report-copies/:id/file — the bytes as issued, checked before they leave. */
export const reportCopyFile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const firmTenantId = str(req.user!.tenantId);
    const c = await prisma.engagementReportCopy.findUnique({
      where: { id: str(req.params.id) },
      select: { id: true, firmTenantId: true, projectRef: true, clientTenantId: true, documentRef: true, fileName: true, format: true, storageKey: true, sha256: true },
    });
    if (!c || c.firmTenantId !== firmTenantId) { notFound(res, 'Report copy'); return; }
    const full = resolveEvidencePath(c.storageKey);
    if (!full) { send(res, { status: 410, code: 'FILE_MISSING', message: 'The stored copy of this report is no longer on disk.' }); return; }
    // A copy that no longer hashes to what was issued is not the report.
    if (verifyStoredHash(c.storageKey, c.sha256) !== true) {
      send(res, { status: 409, code: 'COPY_ALTERED', message: 'This copy no longer matches the report as issued, so it is not served.' });
      return;
    }
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: firmTenantId, actorId: str(req.user!.id), action: 'ENGAGEMENT_REPORT_COPY_DOWNLOADED',
        subjectType: 'EngagementReportCopy', subjectId: c.id,
        payload: { projectRef: c.projectRef, clientTenantId: c.clientTenantId, documentRef: c.documentRef },
      });
    });
    const MIME: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    res.setHeader('Content-Type', MIME[c.format] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Document-Ref', c.documentRef);
    res.download(full, c.fileName);
  } catch (error: any) {
    console.error('[Report Copy File Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to deliver the report copy' });
  }
};

// ─── Firm team ──────────────────────────────────────────────────────────────

/**
 * GET /api/engagements/firm-team — the firm's people, paged, each with the
 * open engagements they are on and their allocation: the total stated, the
 * total by client, how many are not stated, and whether it is over 100%.
 */
export const firmTeam = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const firmTenantId = str(req.user!.tenantId);
    const me = str(req.user!.id);
    const where = { tenantId: firmTenantId, status: 'Active' };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const [total, people] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: page.skip, take: page.take,
        select: { id: true, name: true, email: true, role: true },
      }),
    ]);
    const memberships = people.length ? await prisma.projectMember.findMany({
      where: {
        userId: { in: people.map((p) => p.id) }, side: 'Provider', active: true,
        OR: [{ memberStatus: { in: ['Nominated', 'Approved'] } }, { memberStatus: null }],
        project: { providerTenantId: firmTenantId, tenantId: { not: firmTenantId }, status: { in: OPEN_STATUSES } },
      },
      orderBy: [{ project: { targetEndDate: 'asc' } }],
      select: {
        id: true, userId: true, engagementRole: true, memberStatus: true, allocation: true, accessFrom: true, accessTo: true,
        project: { select: { id: true, ref: true, name: true, status: true, tenantId: true, tenant: { select: { name: true } } } },
      },
    }) : [];
    // Where the caller is the firm's Lead, they may change the allocation.
    const leadOn = new Set((await prisma.projectMember.findMany({
      where: {
        userId: me, side: 'Provider', engagementRole: 'Lead', memberStatus: 'Approved', active: true,
        projectId: { in: [...new Set(memberships.map((m) => m.project.id))] },
      },
      select: { projectId: true },
    })).map((m) => m.projectId));

    res.json({
      status: 'success',
      paging: pageInfo(total, page),
      people: people.map((p) => {
        const mine = memberships.filter((m) => m.userId === p.id);
        const byClient = new Map<string, { clientTenantId: string; client: string; percent: number; notStated: number }>();
        let stated = 0;
        let notStated = 0;
        for (const m of mine) {
          const key = m.project.tenantId;
          const row = byClient.get(key) ?? { clientTenantId: key, client: m.project.tenant?.name ?? 'Unknown', percent: 0, notStated: 0 };
          if (m.allocation === null) { notStated += 1; row.notStated += 1; } else { stated += m.allocation; row.percent += m.allocation; }
          byClient.set(key, row);
        }
        return {
          id: p.id, name: p.name, email: p.email, role: p.role,
          allocation: { total: stated, notStated, over: stated > 100, byClient: [...byClient.values()] },
          engagements: mine.map((m) => ({
            memberId: m.id, projectId: m.project.id, ref: m.project.ref, name: m.project.name, status: m.project.status,
            client: m.project.tenant?.name ?? 'Unknown', engagementRole: m.engagementRole, memberStatus: m.memberStatus,
            allocation: m.allocation, accessFrom: m.accessFrom, accessTo: m.accessTo,
            canSetAllocation: leadOn.has(m.project.id) && Boolean(m.memberStatus),
          })),
        };
      }),
    });
  } catch (error: any) {
    console.error('[Firm Team Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the firm team' });
  }
};

/**
 * PATCH /api/engagements/:projectId/members/:memberId/allocation { allocation }
 *
 * The firm's Lead states how much of a firm person's time an engagement takes
 * (0 to 100, or empty for not stated). The organisation already sets it from
 * the engagement's team; both trails record the change.
 */
export const setAllocation = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    const userId = str(req.user!.id);
    if (!e || !e.providerTenantId || e.providerTenantId !== req.user!.tenantId) { notFound(res); return; }
    const lead = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: e.id, userId } },
      select: { engagementRole: true, memberStatus: true, active: true, side: true },
    });
    if (!lead || lead.side !== 'Provider' || lead.engagementRole !== 'Lead' || lead.memberStatus !== 'Approved' || !lead.active) {
      send(res, { status: 403, code: 'LEAD_ONLY', message: "Only the firm's Lead on this engagement sets its people's allocation." });
      return;
    }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    if (isEnded(e.status)) { send(res, { status: 409, code: 'PROJECT_FROZEN', message: `This engagement is ${e.status}.` }); return; }
    if (e.status === 'OnHold') { send(res, HELD_READ_ONLY); return; }
    const allocation = validAllocation(req.body?.allocation);
    if (allocation === 'invalid') { send(res, { status: 400, code: 'BAD_ALLOCATION', message: 'Allocation is a whole number from 0 to 100, or empty for not stated.' }); return; }
    const member = await prisma.projectMember.findFirst({
      where: { id: str(req.params.memberId), projectId: e.id, side: 'Provider', active: true, memberStatus: { in: ['Nominated', 'Approved'] } },
      select: { id: true, userId: true, allocation: true, user: { select: { name: true } } },
    });
    if (!member) { notFound(res, 'Team member'); return; }
    if (member.allocation === allocation) { res.json({ status: 'success', allocation, changed: false }); return; }
    await prisma.$transaction(async (tx) => {
      await tx.projectMember.update({ where: { id: member.id }, data: { allocation } });
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId: userId, action: 'ENGAGEMENT_ALLOCATION_SET',
        payload: { memberId: member.id, userId: member.userId, person: member.user?.name, from: member.allocation, to: allocation },
      });
    });
    res.json({ status: 'success', allocation, changed: true });
  } catch (error: any) {
    console.error('[Engagement Allocation Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to set the allocation' });
  }
};
