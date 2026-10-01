import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from './notificationService';
import { observe } from './jobReporting';
import { DAY_MS, WARNING_DAYS, noticeDue } from './engagementRules';
import { pruneShadow } from './engagementShadow';
import { enforcementStates } from './engagementEnforcement';

/**
 * Access-window notices (consulting engagement, sprint 5).
 *
 * The end of a person's access is enforced on every request (projectGuard,
 * projectAccess); this job only tells people about it. One notice seven days
 * before access ends and one when it has ended, each once per end date, to the
 * person, the firm's Lead and the organisation's project manager. Nothing is
 * sent while the engagement is on hold. Changing the end date clears both
 * stamps, so the new date gets its own notices.
 *
 * It also tells the firm when its read-only access to a closed engagement is
 * about to end and has ended (sprint 7), and deletes shadow-refusal rows not
 * seen for 90 days.
 */

export const ENGAGEMENT_ACCESS_JOB = 'JOB-ENGAGEMENT-ACCESS';
const BATCH = 200;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function runEngagementAccessScan(now: Date = new Date()): Promise<{ warned: number; ended: number; closeWarned: number; closeEnded: number; pruned: number }> {
  let warned = 0;
  let ended = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.projectMember.findMany({
      where: {
        engagementRole: { not: null }, memberStatus: 'Approved', active: true,
        // Due now: within the warning period, and ended no more than a week
        // ago, so a first run does not tell people about access that ended
        // long before these notices existed.
        accessTo: { lte: new Date(now.getTime() + WARNING_DAYS * DAY_MS), gte: new Date(now.getTime() - (WARNING_DAYS + 1) * DAY_MS) },
        OR: [{ accessWarnedAt: null }, { accessEndNoticeAt: null }],
        project: { deliveryStyle: { not: null }, status: { notIn: ['OnHold', 'Closed', 'Cancelled'] } },
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, projectId: true, userId: true, engagementRole: true,
        accessTo: true, accessWarnedAt: true, accessEndNoticeAt: true,
        user: { select: { name: true } },
        project: { select: { id: true, ref: true, tenantId: true, providerTenantId: true, managerId: true } },
      },
    });
    for (const m of batch) {
      const due = noticeDue(m, now);
      if (!due || !m.accessTo) continue;
      try {
        const sent = await sendNotice(m, due, now);
        if (sent && due === 'soon') warned += 1;
        if (sent && due === 'ended') ended += 1;
      } catch (err) {
        console.error(`[Engagement access] could not send the notice for ${m.project.ref}:`, err);
      }
    }
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1].id;
  }
  const { closeWarned, closeEnded } = await closeWindowNotices(now);
  const pruned = await pruneShadow(now);
  if (warned + ended + closeWarned + closeEnded + pruned > 0) {
    console.log(`[Engagement access] ${warned} ending soon, ${ended} ended, ${closeWarned + closeEnded} after-close notice(s), ${pruned} shadow row(s) pruned`);
  }
  return { warned, ended, closeWarned, closeEnded, pruned };
}

type Due = {
  id: string; userId: string; engagementRole: string | null; accessTo: Date | null;
  user: { name: string };
  project: { id: string; ref: string; tenantId: string; providerTenantId: string | null; managerId: string | null };
};

async function sendNotice(m: Due, due: 'soon' | 'ended', now: Date): Promise<boolean> {
  const p = m.project;
  const firmTenantId = p.providerTenantId || p.tenantId;
  const lead = m.engagementRole === 'Lead' ? null : await prisma.projectMember.findFirst({
    where: { projectId: p.id, engagementRole: 'Lead', memberStatus: 'Approved', active: true },
    select: { userId: true },
  });
  const endDay = iso(m.accessTo!);
  return prisma.$transaction(async (tx) => {
    // Stamped conditionally, so two processes never send the same notice.
    const stamped = await tx.projectMember.updateMany({
      where: due === 'soon'
        ? { id: m.id, accessTo: m.accessTo, accessWarnedAt: null }
        : { id: m.id, accessTo: m.accessTo, accessEndNoticeAt: null },
      data: due === 'soon' ? { accessWarnedAt: now } : { accessEndNoticeAt: now, accessWarnedAt: now },
    });
    if (stamped.count === 0) return false;
    const action = due === 'soon' ? 'ENGAGEMENT_ACCESS_ENDING_NOTICE' : 'ENGAGEMENT_ACCESS_ENDED';
    const payload = { ref: p.ref, memberId: m.id, person: m.user.name, accessTo: endDay };
    await writeAudit(tx, { tenantId: p.tenantId, actorId: null, action, subjectType: 'Project', subjectId: p.id, payload });
    if (p.providerTenantId && p.providerTenantId !== p.tenantId) {
      await writeAudit(tx, {
        tenantId: p.providerTenantId, actorId: null, action, subjectType: 'Project', subjectId: p.id,
        payload: { ...payload, clientTenantId: p.tenantId },
      });
    }
    const title = due === 'soon'
      ? `Access to ${p.ref} ends ${endDay}`
      : `Access to ${p.ref} has ended`;
    const othersTitle = due === 'soon'
      ? `${m.user.name}'s access to ${p.ref} ends ${endDay}`
      : `${m.user.name}'s access to ${p.ref} has ended`;
    const about = (you: boolean) => (due === 'soon'
      ? `${you ? 'Your' : `${m.user.name}'s`} access ends at the end of ${endDay}. Ask the organisation for more time on the Team tab if the work needs it.`
      : `${you ? 'Your' : `${m.user.name}'s`} access ended at the end of ${endDay}. Only the organisation can extend it.`);
    await notify(tx, [
      { tenantId: firmTenantId, recipientId: m.userId, event: action, subjectType: 'Project', subjectId: p.id, title, body: about(true), link: 'project-delivery' },
      ...(lead && lead.userId !== m.userId ? [{
        tenantId: firmTenantId, recipientId: lead.userId, event: action, subjectType: 'Project', subjectId: p.id,
        title: othersTitle, body: about(false), link: 'project-delivery',
      }] : []),
      {
        tenantId: p.tenantId, recipientId: p.managerId, event: action, subjectType: 'Project', subjectId: p.id,
        title: othersTitle, body: about(false), link: 'project-delivery',
      },
    ]);
    return true;
  });
}

// ─── The window after close (sprint 7) ──────────────────────────────────────

/**
 * Notices for the window after close: one seven days before the firm's
 * read-only access to a closed engagement ends and one when it has ended,
 * each once per end, to the people who keep access (or, on an engagement
 * never migrated, the firm's administrators) and the project manager. Only
 * where the window binds: a firm that joined by invitation, or a client whose
 * rules are enforced; elsewhere it is counted in shadow and nothing ends.
 */
async function closeWindowNotices(now: Date): Promise<{ closeWarned: number; closeEnded: number }> {
  let closeWarned = 0;
  let closeEnded = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.project.findMany({
      where: {
        status: { in: ['Closed', 'Cancelled'] }, providerTenantId: { not: null },
        closeAccessUntil: { lte: new Date(now.getTime() + WARNING_DAYS * DAY_MS), gte: new Date(now.getTime() - (WARNING_DAYS + 1) * DAY_MS) },
        OR: [{ closeWarnedAt: null }, { closeEndNoticeAt: null }],
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, ref: true, tenantId: true, providerTenantId: true, managerId: true, deliveryStyle: true, migratedAt: true,
        closeAccessUntil: true, closeWarnedAt: true, closeEndNoticeAt: true,
      },
    });
    const enforced = await enforcementStates(batch.map((p) => p.tenantId));
    for (const p of batch) {
      const binds = (p.deliveryStyle && !p.migratedAt) || enforced.get(p.tenantId);
      const end = p.closeAccessUntil!;
      const due = now >= end ? (p.closeEndNoticeAt ? null : 'ended')
        : end.getTime() - now.getTime() <= WARNING_DAYS * DAY_MS ? (p.closeWarnedAt ? null : 'soon') : null;
      if (!binds || !due) continue;
      try {
        if (await sendCloseNotice(p, due, now)) {
          if (due === 'soon') closeWarned += 1; else closeEnded += 1;
        }
      } catch (err) {
        console.error(`[Engagement access] could not send the after-close notice for ${p.ref}:`, err);
      }
    }
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1].id;
  }
  return { closeWarned, closeEnded };
}

type ClosedDue = {
  id: string; ref: string; tenantId: string; providerTenantId: string | null; managerId: string | null;
  deliveryStyle: string | null; closeAccessUntil: Date | null;
};

async function sendCloseNotice(p: ClosedDue, due: 'soon' | 'ended', now: Date): Promise<boolean> {
  const firmTenantId = p.providerTenantId!;
  // The last day the firm may read it: the window ends at the start of the next.
  const lastDay = iso(new Date(p.closeAccessUntil!.getTime() - 1));
  const firmPeople = p.deliveryStyle
    ? (await prisma.projectMember.findMany({
      where: { projectId: p.id, side: 'Provider', memberStatus: 'Approved', active: true, OR: [{ afterCloseAccess: null }, { afterCloseAccess: true }] },
      select: { userId: true },
    })).map((m) => m.userId)
    : (await prisma.user.findMany({
      where: { tenantId: firmTenantId, status: 'Active', role: { contains: 'admin', mode: 'insensitive' } },
      select: { id: true }, take: 25,
    })).map((u) => u.id);
  return prisma.$transaction(async (tx) => {
    const stamped = await tx.project.updateMany({
      where: due === 'soon'
        ? { id: p.id, closeAccessUntil: p.closeAccessUntil, closeWarnedAt: null }
        : { id: p.id, closeAccessUntil: p.closeAccessUntil, closeEndNoticeAt: null },
      data: due === 'soon' ? { closeWarnedAt: now } : { closeEndNoticeAt: now, closeWarnedAt: now },
    });
    if (stamped.count === 0) return false;
    const action = due === 'soon' ? 'ENGAGEMENT_CLOSE_WINDOW_ENDING' : 'ENGAGEMENT_CLOSE_WINDOW_ENDED';
    await writeAudit(tx, { tenantId: p.tenantId, actorId: null, action, subjectType: 'Project', subjectId: p.id, payload: { ref: p.ref, lastDay } });
    if (firmTenantId !== p.tenantId) {
      await writeAudit(tx, {
        tenantId: firmTenantId, actorId: null, action, subjectType: 'Project', subjectId: p.id,
        payload: { ref: p.ref, lastDay, clientTenantId: p.tenantId },
      });
    }
    const title = due === 'soon' ? `Read-only access to ${p.ref} ends ${lastDay}` : `Read-only access to ${p.ref} has ended`;
    const body = due === 'soon'
      ? `The engagement closed; the firm may read it until the end of ${lastDay}. Only the organisation can extend it. The firm's own record and report copies stay under Completed engagements.`
      : `The window after close ended at the end of ${lastDay}. The firm's own record and report copies stay under Completed engagements.`;
    await notify(tx, [
      ...firmPeople.map((recipientId) => ({ tenantId: firmTenantId, recipientId, event: action, subjectType: 'Project', subjectId: p.id, title, body, link: 'project-delivery' })),
      { tenantId: p.tenantId, recipientId: p.managerId, event: action, subjectType: 'Project', subjectId: p.id, title, body, link: 'project-delivery' },
    ]);
    return true;
  });
}

let timer: NodeJS.Timeout | null = null;

function tick(): void {
  observe(ENGAGEMENT_ACCESS_JOB, runEngagementAccessScan).catch(console.error);
}

export function startEngagementAccessScanner(intervalMs = 60 * 60_000): void {
  if (timer) return;
  setTimeout(tick, 20_000);
  timer = setInterval(tick, intervalMs);
  console.log(`[Engagement access] scanner started (every ${Math.round(intervalMs / 60000)}m)`);
}

export function stopEngagementAccessScanner(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
