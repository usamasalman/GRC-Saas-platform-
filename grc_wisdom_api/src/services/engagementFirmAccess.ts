import { prisma } from '../db';
import { accessOpen } from './engagementRules';
import { isEnded, closeWindowEnd, readsThroughFollowOn } from './engagementAfterClose';

/**
 * What a person of the delivery firm may do on an engagement's own routes,
 * the ones built since sprint 6: the shared registers, requests and answers.
 *
 * Enforced from the start whatever the regime: an approved member inside
 * their own dates reads and acts; once the engagement has closed, whoever
 * still had access at the close reads, read-only, while the window after
 * close lasts (or through a follow-on that puts it in scope); a hold that
 * shuts the firm out shuts it out of these too. Acting needs the engagement
 * running: not on hold, not ended, and the person inside their dates.
 */
export interface FirmAccess {
  reads: boolean;
  acts: boolean;
  memberId: string | null;
  role: string | null;
}

const NONE: FirmAccess = { reads: false, acts: false, memberId: null, role: null };

export async function firmAccess(
  e: { id: string; status: string; actualEndDate: Date | null; closeAccessUntil: Date | null; closeWindowDays: number | null },
  userId: string,
): Promise<FirmAccess> {
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: e.id, userId } },
    select: { id: true, side: true, memberStatus: true, active: true, engagementRole: true, accessFrom: true, accessTo: true, afterCloseAccess: true },
  });
  const member = Boolean(m && m.active && m.side === 'Provider' && m.memberStatus === 'Approved');
  if (isEnded(e.status)) {
    // After close the window decides, not the person's own dates.
    const until = closeWindowEnd(e);
    const reads = (member && m!.afterCloseAccess !== false && Boolean(until && Date.now() < until.getTime()))
      || await readsThroughFollowOn(e.id, userId);
    return reads ? { reads, acts: false, memberId: m?.id ?? null, role: member ? m!.engagementRole : null } : NONE;
  }
  if (!member || !accessOpen(m!)) return NONE;
  const held = e.status === 'OnHold';
  const shutOut = held && (await prisma.projectHold.findFirst({
    where: { projectId: e.id, endedAt: null }, select: { firmAccess: true },
  }))?.firmAccess === 'None';
  if (shutOut) return NONE;
  return { reads: true, acts: !held, memberId: m!.id, role: m!.engagementRole };
}
