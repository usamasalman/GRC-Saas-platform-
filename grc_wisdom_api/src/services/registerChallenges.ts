/**
 * Risk and asset challenges, and proposed risks and assets (consulting
 * engagement, sprint 11).
 *
 * The firm does not score the organisation's register. It challenges a score
 * with the scores it would give and why, resting on an asset or a control,
 * and its owner decides: Adopt (the proposed scores become the risk's or the
 * asset's), Keep (with the reason the current scores stand) or Adjust (to
 * scores the owner chooses). Until then nothing counts the challenge: the
 * dashboard, the tolerance check, acceptance and every report read the
 * register's own scores. Both scores stay in the history and on the trail.
 *
 * A risk or asset the firm thinks is missing is a proposal, kept apart from
 * the register so no figure can count it, and becomes an ordinary risk or
 * asset only when the organisation accepts it.
 *
 * Pure, so every rule here runs without a database.
 */

export const KINDS = ['Risk', 'Asset'] as const;
export type Kind = (typeof KINDS)[number];
export const DECISIONS = ['Adopt', 'Keep', 'Adjust'] as const;
export type Decision = (typeof DECISIONS)[number];
export const OPEN = 'Open';

type Refusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });

const level = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

export interface RiskScores { likelihood: number; impact: number }
export interface AssetScores { confidentiality: number; integrity: number; availability: number }

/** The scores a challenge or a decision gives: likelihood and impact for a risk, C, I and A for an asset, each 1 to 5. */
export function checkScores(kind: Kind, b: any): { ok: true; scores: RiskScores | AssetScores } | Refusal {
  if (kind === 'Risk') {
    const likelihood = level(b?.likelihood);
    const impact = level(b?.impact);
    if (!likelihood || !impact) return refuse(400, 'BAD_SCORES', 'Give likelihood and impact, each a whole number from 1 to 5.');
    return { ok: true, scores: { likelihood, impact } };
  }
  const confidentiality = level(b?.confidentiality);
  const integrity = level(b?.integrity);
  const availability = level(b?.availability);
  if (!confidentiality || !integrity || !availability) {
    return refuse(400, 'BAD_SCORES', 'Give confidentiality, integrity and availability, each a whole number from 1 to 5.');
  }
  return { ok: true, scores: { confidentiality, integrity, availability } };
}

export const sameScores = (a: Record<string, number>, b: Record<string, number>): boolean =>
  Object.keys(a).every((k) => a[k] === b[k]);

/** A challenge: different scores from the current ones, and why. */
export function checkChallenge(kind: Kind, b: any, current: RiskScores | AssetScores):
  { ok: true; scores: RiskScores | AssetScores; reason: string } | Refusal {
  const s = checkScores(kind, b);
  if (!s.ok) return s;
  if (sameScores(s.scores as any, current as any)) return refuse(400, 'NO_CHANGE', 'Those are the scores it already has.');
  const reason = String(b?.reason ?? '').trim();
  if (reason.length < 10) return refuse(400, 'REASON_REQUIRED', 'Say why, in at least 10 characters: what the scores rest on.');
  return { ok: true, scores: s.scores, reason: reason.slice(0, 4000) };
}

/** The owner's decision: Keep needs the reason the scores stand; Adjust needs the scores chosen. */
export function checkDecision(kind: Kind, b: any): { ok: true; decision: Decision; reason: string | null; adjusted: RiskScores | AssetScores | null } | Refusal {
  const decision = String(b?.decision ?? '');
  if (!(DECISIONS as readonly string[]).includes(decision)) return refuse(400, 'BAD_DECISION', 'Adopt, Keep or Adjust.');
  const reason = String(b?.reason ?? '').trim() || null;
  if (decision === 'Keep' && (!reason || reason.length < 10)) {
    return refuse(400, 'REASON_REQUIRED', 'Say why the current scores stand, in at least 10 characters. The firm sees it.');
  }
  let adjusted: RiskScores | AssetScores | null = null;
  if (decision === 'Adjust') {
    const s = checkScores(kind, b);
    if (!s.ok) return s;
    adjusted = s.scores;
  }
  return { ok: true, decision: decision as Decision, reason, adjusted };
}

/** What the decision puts on the register: the proposed scores, the owner's, or none. */
export function scoresAfter(decision: Decision, proposed: RiskScores | AssetScores, adjusted: RiskScores | AssetScores | null): RiskScores | AssetScores | null {
  if (decision === 'Adopt') return proposed;
  if (decision === 'Adjust') return adjusted;
  return null;
}

export const STATUS_OF: Record<Decision, string> = { Adopt: 'Adopted', Keep: 'Kept', Adjust: 'Adjusted' };

/** A proposed risk or asset: enough to enter the register as an ordinary one when accepted. */
export function checkProposal(kind: Kind, b: any): { ok: true; value: Record<string, any> } | Refusal {
  const title = String(b?.title ?? '').trim();
  if (title.length < 3 || title.length > 200) return refuse(400, 'TITLE_REQUIRED', 'Name it, in 3 to 200 characters.');
  const reason = String(b?.reason ?? '').trim();
  if (reason.length < 10) return refuse(400, 'REASON_REQUIRED', 'Say why it belongs in the register, in at least 10 characters.');
  const description = String(b?.description ?? '').trim().slice(0, 4000) || null;
  const s = checkScores(kind, b);
  if (!s.ok) return s;
  if (kind === 'Risk') {
    const category = String(b?.category ?? '').trim();
    if (!category) return refuse(400, 'CATEGORY_REQUIRED', 'Say which category of risk it is.');
    return { ok: true, value: { title, reason, description, category, ...s.scores } };
  }
  const type = String(b?.type ?? 'Information');
  return { ok: true, value: { title, reason, description, type, ...s.scores } };
}

export const challengeRef = (n: number): string => `CHL-${String(n).padStart(4, '0')}`;
export const proposalRef = (n: number): string => `PRP-${String(n).padStart(4, '0')}`;
