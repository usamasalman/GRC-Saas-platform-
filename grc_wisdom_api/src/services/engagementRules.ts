/**
 * The consulting relationship, the invitation to an engagement, the firm's
 * people on it, and the delivery style (consulting engagement, sprint 4).
 *
 * Pure: no Prisma, no request, no clock beyond the one passed in.
 *
 *   relationship  one per firm and organisation, made when the firm first
 *                 accepts an invitation, never when one is sent
 *   invitation    one per engagement, to the firm's organisation (not to an
 *                 email address), single use, 14 days; expired and revoked
 *                 ones stay on record and re-inviting makes a new one
 *   people        the firm's Lead nominates; the organisation approves each
 *                 person, and until it does the person has no access
 *   style         Client-led by default: the consultant proposes, the
 *                 organisation decides. Only the organisation changes it
 */

export const DELIVERY_STYLES = ['ClientLed', 'ConsultantLed'] as const;
export type DeliveryStyle = (typeof DELIVERY_STYLES)[number];
export const DEFAULT_DELIVERY_STYLE: DeliveryStyle = 'ClientLed';

export const ENGAGEMENT_ROLES = ['Lead', 'Consultant', 'Reviewer'] as const;
export type EngagementRole = (typeof ENGAGEMENT_ROLES)[number];

/** Nominated → Approved or Rejected; either side may remove. */
export const MEMBER_STATUSES = ['Nominated', 'Approved', 'Rejected', 'Removed'] as const;

export const INVITATION_DAYS = 14;

export type InvitationState = 'Pending' | 'Expired' | 'Accepted' | 'Declined' | 'Revoked';

/** An invitation's state now: a pending one past its date has expired. */
export function invitationState(inv: { status: string; expiresAt: Date }, now: Date = new Date()): InvitationState {
  if (inv.status === 'Pending' && inv.expiresAt <= now) return 'Expired';
  return inv.status as InvitationState;
}

export const invitationExpiry = (from: Date): Date => new Date(from.getTime() + INVITATION_DAYS * 86_400_000);

/**
 * What the firm's people may do on an engagement, by role.
 *
 *   read      see the engagement (every approved member)
 *   work      work their tasks: status and progress, evidence, blockers
 *   submit    submit deliverables for the organisation to approve
 *   sequence  link the firm's tasks (what waits on what)
 *   nominate  add or remove the firm's people
 *
 * The Lead does all of it; a Consultant works assigned tasks; a Reviewer
 * checks and comments and changes nothing. Approving, verifying and accepting
 * stay with the organisation's own people whatever the role, and what the
 * organisation has shared with the firm limits every role further (sprint 6).
 */
export type EngagementAction = 'read' | 'work' | 'submit' | 'sequence' | 'nominate';

const MAY: Record<EngagementRole, readonly EngagementAction[]> = {
  Lead: ['read', 'work', 'submit', 'sequence', 'nominate'],
  Consultant: ['read', 'work'],
  Reviewer: ['read'],
};

export function roleMay(role: string | null | undefined, action: EngagementAction): boolean {
  return Boolean(role && (MAY as Record<string, readonly string[]>)[role]?.includes(action));
}

const WORDS: Record<EngagementAction, string> = {
  read: 'see this engagement',
  work: 'work tasks on this engagement',
  submit: 'submit deliverables on this engagement; the firm\'s Lead does',
  sequence: 'link tasks on this engagement; the firm\'s Lead does',
  nominate: 'add or remove the firm\'s people; the firm\'s Lead does',
};

export function roleRefusal(role: string | null | undefined, action: EngagementAction) {
  return {
    status: 403 as const,
    code: 'ENGAGEMENT_ROLE' as const,
    message: role
      ? `As ${role === 'Reviewer' ? 'a Reviewer' : `the firm's ${role}`} you cannot ${WORDS[action]}.`
      : `You are not an approved member of this engagement, so you cannot ${WORDS[action]}.`,
  };
}

export const isDeliveryStyle = (v: unknown): v is DeliveryStyle => (DELIVERY_STYLES as readonly unknown[]).includes(v);
export const isEngagementRole = (v: unknown): v is EngagementRole => (ENGAGEMENT_ROLES as readonly unknown[]).includes(v);

// ─── Access windows (sprint 5) ──────────────────────────────────────────────

export const DAY_MS = 86_400_000;
export const WARNING_DAYS = 7;
export const HOLD_FIRM_ACCESS = ['View', 'None'] as const;
export type HoldFirmAccess = (typeof HOLD_FIRM_ACCESS)[number];

/**
 * Whether a person's access window is open now: from their start to the end
 * of their end date (UTC), both checked on every request, not by a nightly
 * job, because dates the organisation set on purpose are rules. Before the
 * start a person sees only the engagement's card (sprint 6).
 */
export function accessOpen(m: { accessFrom: Date | null; accessTo: Date | null }, now: Date = new Date()): boolean {
  if (m.accessFrom && now.getTime() < m.accessFrom.getTime()) return false;
  return !m.accessTo || now.getTime() < m.accessTo.getTime() + DAY_MS;
}

/** Whether the window has yet to start, as opposed to having ended. */
export const accessNotStarted = (m: { accessFrom: Date | null }, now: Date = new Date()): boolean => Boolean(
  m.accessFrom && now.getTime() < m.accessFrom.getTime(),
);

/**
 * When access starts for a person approved now: the start asked for, unless
 * that is before the approval, in which case at the approval (sprint 6). No
 * one can be granted access backdated to before anyone approved it.
 */
export function startAtApproval(requested: Date, approvedAt: Date): Date {
  return requested.getTime() < approvedAt.getTime() ? approvedAt : requested;
}

/** The notice due for a person's end date now, if any; each is sent once per date. */
export function noticeDue(
  m: { accessTo: Date | null; accessWarnedAt: Date | null; accessEndNoticeAt: Date | null },
  now: Date = new Date(),
): 'ended' | 'soon' | null {
  if (!m.accessTo) return null;
  const end = m.accessTo.getTime() + DAY_MS;
  if (now.getTime() >= end) return m.accessEndNoticeAt ? null : 'ended';
  if (end - now.getTime() <= WARNING_DAYS * DAY_MS) return m.accessWarnedAt ? null : 'soon';
  return null;
}

