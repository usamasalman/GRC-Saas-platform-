/**
 * The certification body and independence (consulting engagement, sprint 13).
 *
 * The organisation invites its certification body to an engagement: an
 * auditor organisation, read-only, for dates the organisation sets. The body
 * reads the frozen audit pack and asks questions or for evidence; it changes
 * nothing. A nonconformity it raises is recorded by the organisation as an
 * Issue with source ExternalAudit.
 *
 * The audit pack is frozen: the Statement of Applicability, the traceability
 * report and the readiness report, each issued, stored and hashed at the
 * moment of freezing. Nothing later changes what the body reads.
 *
 * Independence. A firm engaged for internal audit is warned, and must confirm
 * with a reason, when it did implementation work on the same scope. A
 * certification body is warned when it is related to the delivery firm: its
 * people share a company mail domain with the firm's.
 *
 * Pure, so every rule here runs without a database.
 */

export const AUDITOR_TYPE = 'AUDITOR';
export const QUESTION_KINDS = ['Question', 'EvidenceRequest'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const PACK_REPORTS = [
  { kind: 'soa', key: 'delivery-soa', name: 'Statement of Applicability' },
  { kind: 'evidence', key: 'delivery-evidence', name: 'Evidence and Traceability Report' },
  { kind: 'readiness', key: 'delivery-readiness', name: 'Readiness Report' },
] as const;
export const MAX_ACCESS_DAYS = 180;

type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

const dayOf = (v: unknown): Date | null => {
  const s = String(v ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The body's window: from a day to a day, no longer than six months, not ending in the past. */
export function checkWindow(from: unknown, to: unknown, now: Date): { ok: true; from: Date; to: Date } | Refusal {
  const f = dayOf(from);
  const t = dayOf(to);
  if (!f || !t) return refuse(400, 'BAD_DATES', 'Give the first and last day of access.');
  if (t.getTime() < f.getTime()) return refuse(400, 'BAD_DATES', 'Access ends after it starts.');
  if (t.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) return refuse(400, 'IN_THE_PAST', 'Access cannot end in the past.');
  if ((t.getTime() - f.getTime()) / 86_400_000 > MAX_ACCESS_DAYS) return refuse(400, 'TOO_LONG', `A certification body's access lasts at most ${MAX_ACCESS_DAYS} days.`);
  return { ok: true, from: f, to: t };
}

/** Whether access is open today: accepted, not revoked, inside its days. */
export function bodyMayRead(access: { status: string; accessFrom: Date; accessTo: Date }, now: Date): boolean {
  if (access.status !== 'Accepted') return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return access.accessFrom.getTime() <= today && today <= access.accessTo.getTime();
}

/** Mail domains anyone can sign up to, which say nothing about who employs a person. */
const PUBLIC_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'mail.com']);

/** The organisational mail domains among a set of addresses or bare domains. */
export function companyDomains(addresses: string[]): string[] {
  const out = new Set<string>();
  for (const a of addresses) {
    const s = String(a ?? '').toLowerCase().trim();
    const d = (s.includes('@') ? s.split('@')[1] : s)?.trim();
    if (d && !PUBLIC_MAIL.has(d)) out.add(d);
  }
  return [...out];
}

/**
 * Relatedness of a certification body to the delivery firm.
 *
 * An auditor organisation sits at the top of its own tree on this platform,
 * so the tree cannot show a common owner. What it can show is people: a body
 * whose staff share a company mail domain with the firm's is one business
 * under two names, and ISO/IEC 17021-1 does not let it certify work its
 * sister company consulted on without the organisation saying why it may.
 */
export function relatedness(input: { bodyDomains: string[]; firmDomains: string[]; firmName: string }): string[] {
  const shared = input.bodyDomains.filter((d) => input.firmDomains.includes(d));
  return shared.length
    ? [`The certification body's people share a company mail domain with ${input.firmName}, the delivery firm (${shared.join(', ')}).`]
    : [];
}

/** A firm engaged for internal audit that did implementation work on the same scope. */
export function implementationOverlap(input: { frameworksBefore: string[]; frameworksNow: string[]; deliveredTasks: number }): string | null {
  const shared = input.frameworksNow.filter((f) => input.frameworksBefore.includes(f));
  if (shared.length && input.deliveredTasks > 0) {
    return `This firm delivered implementation work on the same framework for this organisation (${input.deliveredTasks} task${input.deliveredTasks === 1 ? '' : 's'}). An internal auditor auditing its own work is not independent.`;
  }
  return null;
}

/** A warning is accepted only with a confirmation and the reason it is acceptable. */
export function confirmationRefusal(warnings: string[], confirmed: unknown, reason: unknown): Refusal | null {
  if (!warnings.length) return null;
  if (confirmed !== true) return refuse(409, 'INDEPENDENCE_WARNING', `${warnings.join(' ')} Confirm, with the reason it is acceptable, to go ahead.`);
  if (String(reason ?? '').trim().length < 20) return refuse(400, 'REASON_REQUIRED', 'Say why it is acceptable, in at least 20 characters. It is recorded.');
  return null;
}

export const questionRef = (n: number): string => `AQ-${String(n).padStart(4, '0')}`;
export const packRef = (n: number): string => `PACK-${String(n).padStart(3, '0')}`;
