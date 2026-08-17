/**
 * Asset valuation and asset-driven risk, with every formula stated.
 *
 * ISO/IEC 27005 frames risk as: a **threat** exploits a **vulnerability** of an
 * **asset**, producing an **impact**. The platform previously had the threat and
 * the impact as free prose on a Risk, and no asset at all — so "impact 4" was a
 * number somebody felt was about right, with nothing underneath it. These
 * functions put the asset underneath it.
 *
 * Everything here is pure, so the same rule applies on write and re-derives for
 * display without the two drifting apart.
 */

// ─── Vocabulary ────────────────────────────────────────────────────────────

export const ASSET_TYPES = [
  'Information', 'Software', 'Physical', 'Service', 'Personnel', 'Intangible',
] as const;

export const ASSET_OWNERSHIP = ['Internal', 'ThirdParty', 'Shared'] as const;

export const CLASSIFICATIONS = ['Public', 'Internal', 'Confidential', 'Restricted'] as const;

export const ASSET_STATUSES = ['Active', 'InDevelopment', 'Retired'] as const;

/**
 * Tangibility is a property of the type, not a separate field somebody can set
 * inconsistently. A server is physical; the data on it is not.
 */
export function tangibilityOf(type: string): 'Physical' | 'NonPhysical' {
  return type === 'Physical' || type === 'Personnel' ? 'Physical' : 'NonPhysical';
}

export const TYPE_HELP: Record<string, string> = {
  Information: 'Data and records — customer files, financials, source code, contracts.',
  Software: 'Applications and systems — the core banking platform, an HR system, a firmware image.',
  Physical: 'Tangible equipment and facilities — servers, network gear, buildings, vehicles, media.',
  Service: 'Something consumed rather than owned — cloud hosting, power, connectivity, payroll processing.',
  Personnel: 'People and the knowledge they hold — a named specialist, a team with scarce skills.',
  Intangible: 'Reputation, brand, licences, intellectual property.',
};

// ─── Valuation ─────────────────────────────────────────────────────────────

const clamp5 = (n: unknown): number => Math.min(5, Math.max(1, Math.round(Number(n) || 3)));

export type Cia = { confidentiality: number; integrity: number; availability: number };

/**
 * Asset criticality = **max(C, I, A)**.
 *
 * Deliberately not the average. A payments database whose availability barely
 * matters is still critical if disclosure would be catastrophic; averaging
 * 5-2-1 gives 2.7 and buries exactly the case that matters. ISO 27005 leaves
 * the aggregation to the organisation — taking the maximum is the defensible
 * default because a breach of any one dimension is a breach.
 */
export function computeCriticality(cia: Cia): { criticality: number; criticalityTier: string } {
  const c = clamp5(cia.confidentiality);
  const i = clamp5(cia.integrity);
  const a = clamp5(cia.availability);
  const criticality = Math.max(c, i, a);
  return { criticality, criticalityTier: criticalityTierOf(criticality) };
}

export function criticalityTierOf(criticality: number): string {
  if (criticality >= 5) return 'Critical';
  if (criticality >= 4) return 'High';
  if (criticality >= 3) return 'Medium';
  return 'Low';
}

/** Which dimension drives the score — the sentence an owner actually needs. */
export function drivingDimension(cia: Cia): string {
  const c = clamp5(cia.confidentiality), i = clamp5(cia.integrity), a = clamp5(cia.availability);
  const top = Math.max(c, i, a);
  const names: string[] = [];
  if (c === top) names.push('confidentiality');
  if (i === top) names.push('integrity');
  if (a === top) names.push('availability');
  return names.join(' and ');
}

// ─── Asset-driven risk ─────────────────────────────────────────────────────

/**
 * Suggested **impact** for a risk against this asset = the asset's criticality.
 *
 * The asset already carries a considered judgement about what its loss would
 * cost. Reusing it means impact is traceable to the inventory rather than
 * invented per risk, and it makes two risks on the same asset consistent with
 * each other by construction.
 */
export function suggestedImpact(criticality: number): number {
  return clamp5(criticality);
}

/**
 * Suggested **likelihood** = ceil((threatLevel + vulnerabilityLevel) / 2).
 *
 * ISO 27005 combines threat and vulnerability to reach likelihood without
 * prescribing the arithmetic. The mean is the conventional choice; rounding
 * *up* is deliberate — where the two disagree the platform should lean toward
 * the more cautious reading rather than average a serious threat away against
 * a well-defended surface.
 */
export function suggestedLikelihood(threatLevel: number, vulnerabilityLevel: number): number {
  return clamp5(Math.ceil((clamp5(threatLevel) + clamp5(vulnerabilityLevel)) / 2));
}

/** The whole ISO 27005 suggestion in one call, for the "raise risk from asset" flow. */
export function suggestRiskScores(input: {
  criticality: number; threatLevel: number; vulnerabilityLevel: number;
}): { likelihood: number; impact: number; score: number; rationale: string } {
  const impact = suggestedImpact(input.criticality);
  const likelihood = suggestedLikelihood(input.threatLevel, input.vulnerabilityLevel);
  return {
    likelihood,
    impact,
    score: likelihood * impact,
    rationale:
      `Impact ${impact} is the asset's criticality. Likelihood ${likelihood} combines a threat level of `
      + `${clamp5(input.threatLevel)} with a vulnerability level of ${clamp5(input.vulnerabilityLevel)}, `
      + `rounded up. Inherent score ${likelihood * impact}.`,
  };
}

// ─── Quantification (NIST SP 800-30) ───────────────────────────────────────

/**
 * Single Loss Expectancy = asset value × exposure factor.
 * Annualised Loss Expectancy = SLE × annual rate of occurrence.
 *
 * The qualitative 1–5 grid is what governs decisions here; this is the second
 * opinion that makes a treatment business case arguable. It is only computed
 * where the inputs genuinely exist — a value and an exposure factor — because
 * a monetary figure invented from a 1–5 score would be false precision, and
 * false precision in a board pack is worse than no number at all.
 */
export function lossExpectancy(input: {
  replacementValue?: number | null;
  exposureFactor?: number | null;
  /** Derived from residual likelihood: how many times a year this is expected. */
  residualLikelihood?: number | null;
}): { sle: number; aro: number; ale: number } | null {
  const value = Number(input.replacementValue);
  const ef = Number(input.exposureFactor);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (!Number.isFinite(ef) || ef <= 0 || ef > 1) return null;

  const sle = value * ef;
  // A 1–5 likelihood mapped to occurrences per year. These are the conventional
  // bands: 1 = once in 20 years, 5 = twice a year.
  const ARO_BY_LIKELIHOOD: Record<number, number> = {
    1: 0.05, 2: 0.2, 3: 0.5, 4: 1, 5: 2,
  };
  const aro = ARO_BY_LIKELIHOOD[clamp5(input.residualLikelihood ?? 3)] ?? 0.5;
  return { sle: Math.round(sle), aro, ale: Math.round(sle * aro) };
}

// ─── Coverage and posture ──────────────────────────────────────────────────

/**
 * How well an asset is actually defended, on the same rule the risk register
 * uses: only a *verified* control counts, because an unverified claim of
 * effectiveness is management marking its own homework.
 */
export function controlPosture(
  links: { implementation: { status: string; effectiveness: string | null } }[],
): { total: number; effective: number; partial: number; ineffective: number; unverified: number; posture: string } {
  let effective = 0, partial = 0, ineffective = 0, unverified = 0;
  for (const l of links) {
    if (l.implementation.status !== 'Verified') { unverified++; continue; }
    if (l.implementation.effectiveness === 'Effective') effective++;
    else if (l.implementation.effectiveness === 'PartiallyEffective') partial++;
    else if (l.implementation.effectiveness === 'Ineffective') ineffective++;
    else unverified++;
  }
  const total = links.length;
  // An unverified control counts against the posture the same way a partially
  // effective one does. Reading "1 of 2 effective" as fully Protected is the
  // kind of rounding-up that makes a register comforting rather than useful.
  const posture = total === 0
    ? 'Unprotected'
    : ineffective > 0 && effective === 0
      ? 'Failing'
      : effective === 0
        ? 'Unproven'
        : ineffective > 0 || partial > 0 || unverified > 0
          ? 'Partial'
          : 'Protected';
  return { total, effective, partial, ineffective, unverified, posture };
}

/**
 * The asset's exposure: its criticality carried forward by how much residual
 * risk actually sits on it. A critical asset with no open risk is not the same
 * problem as a critical asset carrying three unmitigated ones, and criticality
 * alone cannot tell them apart.
 *
 * exposure = criticality × (1 + Σ residual / 25) rounded to one decimal,
 * where 25 is the maximum a single risk can score, so each fully-exposed risk
 * adds one asset-criticality's worth of weight.
 */
export function assetExposure(criticality: number, residualScores: number[]): number {
  const carried = residualScores.reduce((a, s) => a + s, 0) / 25;
  return Number((clamp5(criticality) * (1 + carried)).toFixed(1));
}

/** Review clock, matching the register's own cadence behaviour. */
export function nextAssetReview(cadenceMonths: number, from = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + Math.max(1, cadenceMonths || 12));
  return d;
}

/**
 * Every formula on one object, so the UI can show the user the arithmetic
 * rather than asking them to trust a number. An assessor asking "how was this
 * derived?" should get an answer from the product, not from a consultant.
 */
export const FORMULAS = [
  {
    key: 'criticality',
    name: 'Asset criticality',
    expression: 'criticality = max(Confidentiality, Integrity, Availability)',
    basis: 'ISO/IEC 27005 asset valuation',
    why: 'An asset is as critical as its most demanding dimension. Averaging would hide a catastrophic-disclosure asset behind two low scores.',
  },
  {
    key: 'impact',
    name: 'Suggested risk impact',
    expression: 'impact = asset criticality',
    basis: 'ISO/IEC 27005 clause 8.3',
    why: 'The asset already carries a considered judgement of what its loss costs; reusing it keeps two risks on the same asset consistent.',
  },
  {
    key: 'likelihood',
    name: 'Suggested risk likelihood',
    expression: 'likelihood = ceil((threat level + vulnerability level) / 2)',
    basis: 'ISO/IEC 27005 clause 8.3',
    why: 'Rounds up so a serious threat is not averaged away against a well-defended surface.',
  },
  {
    key: 'inherent',
    name: 'Inherent risk',
    expression: 'inherent = likelihood x impact',
    basis: '5x5 matrix, ISO 31000 aligned',
    why: 'Before any control is credited.',
  },
  {
    key: 'residual',
    name: 'Residual risk',
    expression: 'residual likelihood = inherent likelihood - min(3, 2 per Effective + 1 per Partially Effective verified control)',
    basis: 'ISO 31000 clause 6.5',
    why: 'Only verified controls count, and the reduction is capped so no quantity of controls makes a risk vanish.',
  },
  {
    key: 'exposure',
    name: 'Asset exposure',
    expression: 'exposure = criticality x (1 + sum(residual scores) / 25)',
    basis: 'GRC Wisdom',
    why: 'Separates a critical asset that is clean from a critical asset carrying three unmitigated risks.',
  },
  {
    key: 'sle',
    name: 'Single Loss Expectancy',
    expression: 'SLE = asset value x exposure factor',
    basis: 'NIST SP 800-30',
    why: 'The money lost if the risk materialises once.',
  },
  {
    key: 'ale',
    name: 'Annualised Loss Expectancy',
    expression: 'ALE = SLE x annual rate of occurrence',
    basis: 'NIST SP 800-30',
    why: 'Comparable against the annual cost of a control, which is what makes a treatment business case arguable.',
  },
  {
    key: 'appetite',
    name: 'Appetite band',
    expression: 'residual <= appetite -> within appetite; <= tolerance -> within tolerance; otherwise beyond',
    basis: 'ISO 31000 clause 6.3.4',
    why: 'A risk beyond tolerance cannot be accepted — it must be treated down.',
  },
] as const;
