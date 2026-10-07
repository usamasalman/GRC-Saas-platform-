/**
 * Context of the organisation and its interested parties (ISO 27001 4.1 and
 * 4.2; consulting engagement, sprint 10).
 *
 * The register is the organisation's. An entry is an external or internal
 * issue (4.1) or an interested party with what it requires (4.2): where it
 * came from, how relevant it is, and the risks it bears on. The organisation
 * records entries directly; the firm proposes them on an engagement, and a
 * proposal counts for nothing (in figures, in reports, in readiness) until
 * the organisation accepts it. A rejected proposal stays, with the reason.
 *
 * Pure, so every rule here runs without a database.
 */

export const KINDS = ['Issue', 'InterestedParty'] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = { Issue: 'Issue (4.1)', InterestedParty: 'Interested party (4.2)' };
export const ORIGINS = ['Internal', 'External'] as const;
export const RELEVANCE = ['High', 'Medium', 'Low'] as const;
export const STATUSES = ['Proposed', 'Accepted', 'Rejected', 'Retired'] as const;
/** The only entries that count. */
export const COUNTS = 'Accepted';
export const MAX_RISK_LINKS = 50;

type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

export interface ContextFields {
  kind: Kind; origin: string; title: string; description: string | null; source: string; relevance: string;
  requirements: string | null; riskIds: string[];
}

export function checkEntry(b: any): { ok: true; value: ContextFields } | Refusal {
  const kind = String(b?.kind ?? '');
  if (!(KINDS as readonly string[]).includes(kind)) return refuse(400, 'BAD_KIND', 'An entry is an Issue (4.1) or an Interested party (4.2).');
  const origin = String(b?.origin ?? '');
  if (!(ORIGINS as readonly string[]).includes(origin)) return refuse(400, 'BAD_ORIGIN', 'Say whether it is Internal or External.');
  const title = String(b?.title ?? '').trim();
  if (title.length < 3 || title.length > 200) return refuse(400, 'TITLE_REQUIRED', 'Name it, in 3 to 200 characters.');
  const source = String(b?.source ?? '').trim();
  if (source.length < 2 || source.length > 200) return refuse(400, 'SOURCE_REQUIRED', 'Say where it comes from: a workshop, a regulator, a contract.');
  const relevance = String(b?.relevance ?? '');
  if (!(RELEVANCE as readonly string[]).includes(relevance)) return refuse(400, 'BAD_RELEVANCE', 'Relevance is High, Medium or Low.');
  const requirements = String(b?.requirements ?? '').trim() || null;
  if (kind === 'InterestedParty' && !requirements) {
    return refuse(400, 'REQUIREMENTS_REQUIRED', 'Say what this party requires of the organisation (4.2 b).');
  }
  const riskIds = [...new Set((Array.isArray(b?.riskIds) ? b.riskIds : []).map(String).filter(Boolean))] as string[];
  if (riskIds.length > MAX_RISK_LINKS) return refuse(400, 'TOO_MANY_RISKS', `Link at most ${MAX_RISK_LINKS} risks.`);
  const description = String(b?.description ?? '').trim().slice(0, 4000) || null;
  return { ok: true, value: { kind: kind as Kind, origin, title, description, source, relevance, requirements: requirements?.slice(0, 4000) ?? null, riskIds } };
}

/** What a register shows as its figures: accepted entries only, and the proposals waiting. */
export function registerCounts(rows: readonly { kind: string; status: string }[]) {
  return {
    issues: rows.filter((r) => r.status === COUNTS && r.kind === 'Issue').length,
    interestedParties: rows.filter((r) => r.status === COUNTS && r.kind === 'InterestedParty').length,
    proposed: rows.filter((r) => r.status === 'Proposed').length,
  };
}

export const contextRef = (n: number): string => `CTX-${String(n).padStart(4, '0')}`;
