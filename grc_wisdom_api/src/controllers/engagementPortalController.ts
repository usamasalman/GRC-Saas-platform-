import { Response } from 'express';
import { prisma } from '../db';
import { readPage, pageInfo } from '../utils/paging';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { getEffectivePermissions, CAP } from '../services/capabilityEngine';
import { accessOpen, accessNotStarted, DAY_MS, WARNING_DAYS } from '../services/engagementRules';

/**
 * The delivery firm's side of its engagements (consulting engagement,
 * sprint 6): one card per engagement, across every client.
 *
 * A card is the firm's own record of the engagement: its name, the client,
 * its dates, who invited the firm, the Lead and where the caller stands. It
 * carries nothing of the client's records, so it is shown before a person's
 * access starts, while they await approval and after it ends; opening the
 * workspace is decided by the engagement guard on every request.
 */

const str = (v: unknown): string => String(v ?? '');

type State = 'AwaitingApproval' | 'NotStarted' | 'Open' | 'Ended' | 'NoAccessOnHold' | 'NotOnTeam' | 'OldWay';

/** GET /api/engagements/mine — the caller's engagements, or all of the firm's for its managers. */
export const myEngagements = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = str(req.user!.id);
    const firmTenantId = str(req.user!.tenantId);
    const perms = await getEffectivePermissions(userId);
    // The firm's managers see every engagement the firm delivers; everyone
    // else sees the ones they are on.
    const manager = perms.capabilities.includes(CAP.MANAGE_PROJECT);
    const where = {
      providerTenantId: firmTenantId,
      tenantId: { not: firmTenantId },
      status: { notIn: ['Closed', 'Cancelled'] },
      ...(manager ? {} : {
        members: { some: { userId, active: true, memberStatus: { in: ['Nominated', 'Approved'] } } },
      }),
    };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const [total, rows] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where,
        orderBy: [{ targetEndDate: 'asc' }, { ref: 'asc' }],
        skip: page.skip,
        take: page.take,
        select: {
          id: true, ref: true, name: true, status: true, startDate: true, targetEndDate: true, deliveryStyle: true,
          tenant: { select: { name: true } },
          manager: { select: { name: true } },
          invitations: {
            where: { firmTenantId, status: 'Accepted' }, orderBy: { respondedAt: 'desc' }, take: 1,
            select: { invitedBy: { select: { name: true } } },
          },
          members: {
            where: { OR: [{ userId }, { engagementRole: 'Lead', memberStatus: 'Approved', active: true }] },
            select: {
              id: true, userId: true, engagementRole: true, memberStatus: true, active: true,
              accessFrom: true, accessTo: true, user: { select: { name: true } },
            },
          },
          holds: { where: { endedAt: null }, select: { firmAccess: true }, take: 1 },
        },
      }),
    ]);
    const now = new Date();
    res.json({
      status: 'success',
      engagements: rows.map((p) => {
        const mine = p.members.find((m) => m.userId === userId && m.active
          && (m.memberStatus === 'Nominated' || m.memberStatus === 'Approved')) || null;
        const lead = p.members.find((m) => m.engagementRole === 'Lead' && m.memberStatus === 'Approved' && m.active) || null;
        const shutOut = p.status === 'OnHold' && p.holds[0]?.firmAccess === 'None';
        let state: State;
        // Named the old way: the whole firm reads it until it is migrated.
        if (p.deliveryStyle === null) state = shutOut ? 'NoAccessOnHold' : 'OldWay';
        else if (!mine) state = 'NotOnTeam';
        else if (mine.memberStatus !== 'Approved') state = 'AwaitingApproval';
        else if (accessNotStarted(mine, now)) state = 'NotStarted';
        else if (!accessOpen(mine, now)) state = 'Ended';
        else if (shutOut) state = 'NoAccessOnHold';
        else state = 'Open';
        // Named the old way, the firm reads as before (sprint 4), unless the
        // hold shuts it out; the guard decides again on every request.
        const canOpen = p.deliveryStyle === null ? !shutOut : state === 'Open';
        return {
          id: p.id, ref: p.ref, name: p.name, client: p.tenant.name, status: p.status,
          startDate: p.startDate, targetEndDate: p.targetEndDate, deliveryStyle: p.deliveryStyle,
          invitedBy: p.invitations[0]?.invitedBy?.name ?? p.manager?.name ?? null,
          lead: lead?.user.name ?? null,
          me: mine ? {
            memberId: mine.id, engagementRole: mine.engagementRole, memberStatus: mine.memberStatus,
            accessFrom: mine.accessFrom, accessTo: mine.accessTo,
          } : null,
          state,
          canOpen,
          accessEndsSoon: state === 'Open' && Boolean(mine?.accessTo)
            && mine!.accessTo!.getTime() + DAY_MS - now.getTime() <= WARNING_DAYS * DAY_MS,
        };
      }),
      paging: pageInfo(total, page),
    });
  } catch (error: any) {
    console.error('[My Engagements Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load your engagements' });
  }
};
