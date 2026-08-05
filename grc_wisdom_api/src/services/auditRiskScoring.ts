/**
 * Annual risk assessment of the audit universe (IIA Global Internal Audit
 * Standards 2024, Standard 9.4 — the internal audit plan must be risk-based).
 *
 * Scoring is server-side and deterministic: a Chief Audit Executive has to be
 * able to defend to the audit committee why one entity made the plan and
 * another did not, so the weighting is explicit and auditable.
 */

export interface RiskFactors {
  financialMateriality: number;
  regulatoryExposure: number;
  complexity: number;
  changeVolatility: number;
  priorFindings: number;
  fraudExposure: number;
}

/** Weights sum to 1.0. Tunable per tenant in a later slice. */
export const FACTOR_WEIGHTS: Record<keyof RiskFactors, number> = {
  financialMateriality: 0.25,
  regulatoryExposure: 0.20,
  complexity: 0.15,
  changeVolatility: 0.15,
  priorFindings: 0.15,
  fraudExposure: 0.10,
};

export const FACTOR_LABELS: Record<keyof RiskFactors, string> = {
  financialMateriality: 'Financial materiality',
  regulatoryExposure: 'Regulatory exposure',
  complexity: 'Process complexity',
  changeVolatility: 'Rate of change',
  priorFindings: 'Prior finding density',
  fraudExposure: 'Fraud exposure',
};

function clamp(n: number): number {
  return Math.min(5, Math.max(1, Math.round(Number(n) || 3)));
}

/**
 * Composite score on a 1.00–5.00 scale.
 *
 * Coverage staleness is a deliberate uplift, not a factor: an entity that has
 * never been audited, or is past its cycle, rises in priority regardless of its
 * intrinsic risk. Capped at 5.0.
 */
export function computeEntityRisk(
  factors: RiskFactors,
  lastAuditedAt: Date | null,
  auditCycleMonths = 24
): { riskScore: number; riskTier: string; monthsSinceAudit: number | null; coverageUplift: number } {
  let weighted = 0;
  for (const key of Object.keys(FACTOR_WEIGHTS) as (keyof RiskFactors)[]) {
    weighted += clamp(factors[key]) * FACTOR_WEIGHTS[key];
  }

  let monthsSinceAudit: number | null = null;
  let coverageUplift = 0;
  if (!lastAuditedAt) {
    // Never audited is the single strongest signal in a first-year plan.
    coverageUplift = 0.75;
  } else {
    const ms = Date.now() - lastAuditedAt.getTime();
    monthsSinceAudit = Math.floor(ms / (30 * 24 * 3600 * 1000));
    const overdueBy = monthsSinceAudit - auditCycleMonths;
    if (overdueBy > 0) coverageUplift = Math.min(0.75, (overdueBy / 12) * 0.5);
  }

  const riskScore = Math.min(5, Number((weighted + coverageUplift).toFixed(2)));
  const riskTier = riskScore >= 4 ? 'High' : riskScore >= 2.75 ? 'Medium' : 'Low';

  return { riskScore, riskTier, monthsSinceAudit, coverageUplift: Number(coverageUplift.toFixed(2)) };
}

/** Default engagement budget by tier — the starting point a CAE then adjusts. */
export function suggestedBudgetHours(riskTier: string): number {
  if (riskTier === 'High') return 160;
  if (riskTier === 'Medium') return 100;
  return 60;
}
