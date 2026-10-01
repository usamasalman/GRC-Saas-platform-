import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { notify } from '../services/notificationService';
import { noteIsEnough, MIN_NOTE } from '../services/projectActivation';
import { DAY_MS } from '../services/engagementRules';
import {
  validWindowDays, windowDaysOf, isEnded, closeWindowEnd, latestWindowEnd, MAX_CLOSE_WINDOW_DAYS,
} from '../services/engagementAfterClose';
import { str, send, notFound, loadEngagement, clientSide, flagFor, bothTrails } from './engagementController';

/**
 * The window after close (consulting engagement, sprint 7): how long the
 * delivery firm may still read an engagement, read-only, once it closes.
 *
 * Before close the organisation sets the days ahead (0 to 365; 90 unless it
 * says otherwise), and the Close dialog confirms them. After close only the
 * organisation can extend the window, never past 365 days after the close, or
 * revoke it, at once. Every change has a reason, is on both organisations'
 * trails, and the firm's Lead is told.
 */

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * PATCH /api/engagements/:projectId/close-window
 *   before close: { days, reason }
 *   after close:  { until (a date), reason } to extend or shorten, or
 *                 { revoke: true, reason } to end it now.
 */
export const changeCloseWindow = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const e = await loadEngagement(str(req.params.projectId));
    if (!e || !(await clientSide(req, e))) {
      if (e && e.providerTenantId === req.user!.tenantId) {
        send(res, { status: 403, code: 'CLIENT_DECIDES', message: 'Only the organisation sets how long the firm may read the engagement after close.' });
        return;
      }
      notFound(res); return;
    }
    const refusal = await flagFor(e);
    if (refusal) { send(res, refusal); return; }
    if (!e.providerTenantId) { send(res, { status: 409, code: 'NO_FIRM', message: 'No firm delivers this engagement.' }); return; }
    const reason = str(req.body?.reason).trim();
    if (!noteIsEnough(reason)) { send(res, { status: 400, code: 'REASON_REQUIRED', message: `Say why — at least ${MIN_NOTE} characters.` }); return; }
    const actorId = str(req.user!.id);
    const now = new Date();

    // Before close: the days, set ahead.
    if (!isEnded(e.status)) {
      const days = validWindowDays(req.body?.days);
      if (days === null) { send(res, { status: 400, code: 'BAD_WINDOW', message: `The window after close is 0 to ${MAX_CLOSE_WINDOW_DAYS} days.` }); return; }
      const before = windowDaysOf(e);
      await prisma.$transaction(async (tx) => {
        await tx.project.update({ where: { id: e.id }, data: { closeWindowDays: days, closeWindowSetAt: now, closeWindowSetById: actorId } });
        await bothTrails(tx, {
          e, firmTenantId: e.providerTenantId, actorId, action: 'ENGAGEMENT_CLOSE_WINDOW_SET',
          payload: { from: before, to: days, reason },
        });
      });
      res.json({ status: 'success', closeWindowDays: days });
      return;
    }

    // After close: extend, shorten or revoke the moment it ends.
    if (!e.actualEndDate) { send(res, { status: 409, code: 'NO_CLOSE_DATE', message: 'This engagement has no close date.' }); return; }
    const revoke = req.body?.revoke === true;
    let until: Date;
    if (revoke) {
      until = now;
    } else {
      const asked = new Date(str(req.body?.until));
      if (Number.isNaN(asked.getTime())) { send(res, { status: 400, message: 'Give the date the firm may read it until.' }); return; }
      // The end date counts in full.
      until = new Date(Date.UTC(asked.getUTCFullYear(), asked.getUTCMonth(), asked.getUTCDate()) + DAY_MS);
      const latest = latestWindowEnd(e.actualEndDate);
      if (until.getTime() > latest.getTime()) {
        send(res, { status: 400, code: 'BEYOND_365', message: `The window ends no later than 365 days after close (${day(latest)}).` }); return;
      }
      if (until.getTime() < now.getTime()) until = now;
    }
    const before = closeWindowEnd(e);
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: e.id },
        data: { closeAccessUntil: until, closeWindowSetAt: now, closeWindowSetById: actorId, closeWarnedAt: null, closeEndNoticeAt: null },
      });
      await bothTrails(tx, {
        e, firmTenantId: e.providerTenantId, actorId,
        action: revoke ? 'ENGAGEMENT_CLOSE_WINDOW_REVOKED' : 'ENGAGEMENT_CLOSE_WINDOW_CHANGED',
        payload: { from: before, to: until, reason },
      });
      const leads = await tx.projectMember.findMany({
        where: { projectId: e.id, side: 'Provider', engagementRole: 'Lead', memberStatus: 'Approved', active: true },
        select: { userId: true },
      });
      await notify(tx, leads.map((l) => ({
        tenantId: e.providerTenantId!, recipientId: l.userId, actorId, event: 'ENGAGEMENT_CLOSE_WINDOW_CHANGED',
        subjectType: 'Project', subjectId: e.id,
        title: revoke ? `Read-only access to ${e.ref} has been revoked` : `You may read ${e.ref} until ${day(new Date(until.getTime() - 1))}`,
        body: reason, link: 'project-delivery',
      })));
    });
    res.json({ status: 'success', closeAccessUntil: until });
  } catch (error: any) {
    console.error('[Close Window Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to change the window after close' });
  }
};

