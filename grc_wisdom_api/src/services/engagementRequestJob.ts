import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from './notificationService';
import { DAY_MS } from './engagementRules';
import { AWAITING_ANSWER, REMINDER_DAYS } from './engagementRequests';

/**
 * Reminders for information requests (consulting engagement, sprint 8),
 * run with the engagement access scan.
 *
 * The assignee is reminded three days before a request is due; on the due
 * date the assignee and the project manager are told. Once each per due
 * date, which moving the date resets. Nothing is sent while the engagement
 * is on hold or once it has ended: the clock stops, and the notices go out
 * when it resumes. An overdue request is never turned into a delay here.
 */

const BATCH = 200;

export async function requestNotices(now: Date = new Date()): Promise<{ requestReminders: number; requestsDue: number }> {
  let requestReminders = 0;
  let requestsDue = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.informationRequest.findMany({
      where: {
        status: { in: AWAITING_ANSWER },
        // Due within the reminder period, or due in the last week: a first
        // run does not tell people about dates long gone.
        dueDate: { lte: new Date(now.getTime() + REMINDER_DAYS * DAY_MS), gte: new Date(now.getTime() - 8 * DAY_MS) },
        OR: [{ reminderSentAt: null }, { dueNoticeAt: null }],
        project: { status: { in: ['Draft', 'Active'] } },
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, ref: true, title: true, dueDate: true, assigneeId: true, reminderSentAt: true, dueNoticeAt: true,
        project: { select: { id: true, ref: true, name: true, tenantId: true, managerId: true } },
      },
    });
    for (const r of batch) {
      const due = now.getTime() >= r.dueDate.getTime() ? (r.dueNoticeAt ? null : 'due') : (r.reminderSentAt ? null : 'soon');
      if (!due) continue;
      try {
        const sent = await prisma.$transaction(async (tx) => {
          const stamped = await tx.informationRequest.updateMany({
            where: { id: r.id, dueDate: r.dueDate, ...(due === 'due' ? { dueNoticeAt: null } : { reminderSentAt: null }) },
            data: due === 'due' ? { dueNoticeAt: now, reminderSentAt: r.reminderSentAt ?? now } : { reminderSentAt: now },
          });
          if (stamped.count === 0) return false;
          const day = r.dueDate.toISOString().slice(0, 10);
          const action = due === 'due' ? 'ENGAGEMENT_REQUEST_DUE' : 'ENGAGEMENT_REQUEST_REMINDED';
          await writeAudit(tx, {
            tenantId: r.project.tenantId, actorId: null, action, subjectType: 'InformationRequest', subjectId: r.id,
            payload: { projectRef: r.project.ref, request: r.ref, due: day },
          });
          const recipients = due === 'due' ? [r.assigneeId, r.project.managerId] : [r.assigneeId];
          await notify(tx, [...new Set(recipients)].map((recipientId) => ({
            tenantId: r.project.tenantId, recipientId, event: action, subjectType: 'Project', subjectId: r.project.id,
            title: due === 'due' ? `${r.ref} is due today: ${r.title}` : `${r.ref} is due ${day}: ${r.title}`,
            body: `Answer it from the Requests tab of ${r.project.ref} · ${r.project.name}.`,
            link: 'project-delivery',
          })));
          return true;
        });
        if (sent && due === 'due') requestsDue += 1;
        if (sent && due === 'soon') requestReminders += 1;
      } catch (err) {
        console.error(`[Engagement access] could not send the notice for ${r.ref} of ${r.project.ref}:`, err);
      }
    }
    if (batch.length < BATCH) break;
    cursor = batch[batch.length - 1].id;
  }
  return { requestReminders, requestsDue };
}
