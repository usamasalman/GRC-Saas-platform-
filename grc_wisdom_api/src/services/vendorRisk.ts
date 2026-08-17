/**
 * Third-party risk: tiering, due-diligence cadence, and concentration.
 *
 * The screen this replaces showed four hard-coded rows and a KPI reading
 * "74 Active Vendors" against a database holding none. Everything here is
 * derived from what the tenant actually recorded.
 *
 * The organising idea is that a supplier's tier is not a label somebody picks —
 * it falls out of three questions with defensible answers: how badly does it
 * hurt if they stop, what can they reach, and how quickly could we replace
 * them. Tier then drives how often they are reassessed, which is the part
 * regulators actually check.
 */

export const VENDOR_CATEGORIES = [
  'CloudHosting', 'Software', 'ProfessionalServices', 'Outsourcing',
  'Logistics', 'Facilities', 'Staffing', 'Financial', 'Other',
] as const;

export const VENDOR_STATUSES = [
  'Prospective', 'Active', 'UnderReview', 'Exiting', 'Terminated',
] as const;

/**
 * What the supplier can reach, worst first. Data access dominates the tier
 * because it is the dimension that turns a small supplier into a large breach.
 */
export const DATA_ACCESS = [
  'None', 'Metadata', 'Confidential', 'PersonalData', 'SensitivePersonalData',
] as const;

const DATA_ACCESS_WEIGHT: Record<string, number> = {
  None: 1, Metadata: 2, Confidential: 3, PersonalData: 4, SensitivePersonalData: 5,
};

export const DATA_ACCESS_HELP: Record<string, string> = {
  None: 'No access to organisational data of any kind.',
  Metadata: 'Operational telemetry only — volumes, timings, logs without content.',
  Confidential: 'Internal business data: contracts, financials, strategy.',
  PersonalData: 'Identifiable personal data of customers or staff (PDPL applies).',
  SensitivePersonalData: 'Health, biometric, financial or credential data (PDPL sensitive category).',
};

export const ASSESSMENT_KINDS = ['Onboarding', 'Periodic', 'Triggered', 'Exit'] as const;
export const ASSESSMENT_OUTCOMES = ['Adequate', 'NeedsImprovement', 'Inadequate'] as const;

const clamp5 = (n: unknown): number => Math.min(5, Math.max(1, Math.round(Number(n) || 3)));

// ─── Tiering ───────────────────────────────────────────────────────────────

export type TierInput = {
  serviceCriticality: number;
  substitutability: number;
  dataAccess: string;
  hasSystemAccess?: boolean;
};

/**
 * Tier score = max(dataAccessWeight, serviceCriticality) × substitutability
 * weighting, capped at 25, with a floor applied when the supplier holds direct
 * system access.
 *
 * Taking the *maximum* of data access and service criticality rather than
 * averaging them is the same judgement the asset register makes about the CIA
 * triad: a payroll bureau that could not stop the business for a day is still a
 * critical supplier if it holds every employee's bank details. Averaging hides
 * exactly that case.
 *
 * Substitutability is a multiplier rather than a third term because it does not
 * create exposure on its own — it governs how long you are stuck with whatever
 * exposure the other two produce.
 */
export function computeTier(input: TierInput): {
  tierScore: number; tier: string; rationale: string;
} {
  const dataWeight = DATA_ACCESS_WEIGHT[input.dataAccess] ?? 1;
  const criticality = clamp5(input.serviceCriticality);
  const base = Math.max(dataWeight, criticality);
  const sub = clamp5(input.substitutability);

  // base x substitutability, both 1-5, giving 1-25 — the same shape as the
  // likelihood x impact product the rest of the platform reasons about, so a
  // tier score and a risk score mean comparable things.
  //
  // An earlier version scaled this by a further factor of five and then capped
  // it, which pushed four suppliers out of six to exactly 25 and destroyed the
  // discrimination the tier exists to provide.
  let score = base * sub;
  // Direct system access means they can act on your estate, not merely hold
  // data about it. That cannot be a low-tier relationship.
  if (input.hasSystemAccess && score < 12) score = 12;
  score = Math.min(25, Math.max(1, score));

  const tier = score >= 20 ? 'Critical' : score >= 14 ? 'High' : score >= 8 ? 'Medium' : 'Low';

  const driver = dataWeight > criticality
    ? `data access (${input.dataAccess})`
    : criticality > dataWeight
      ? 'service criticality'
      : `data access (${input.dataAccess}) and service criticality equally`;

  return {
    tierScore: score,
    tier,
    rationale:
      `Tier ${tier} (${score}/25 = ${base} x ${sub}). Driven by ${driver}, multiplied by substitutability ${sub}`
      + (input.hasSystemAccess ? ', with a floor applied because the supplier holds direct system access' : '')
      + '.',
  };
}

/**
 * Reassessment cadence by tier. A critical supplier every six months, a low
 * one every two years — the point being that cadence is a consequence of tier
 * rather than a number someone sets and forgets.
 */
export function cadenceForTier(tier: string): number {
  if (tier === 'Critical') return 6;
  if (tier === 'High') return 12;
  if (tier === 'Medium') return 18;
  return 24;
}

export function nextAssessmentFrom(cadenceMonths: number, from = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + Math.max(1, cadenceMonths));
  return d;
}

// ─── Contract and exit ─────────────────────────────────────────────────────

/**
 * When the exit decision actually has to be taken — not the contract end date,
 * but the last day notice can still be served. Missing this is how an
 * organisation ends up auto-renewed into a supplier it wanted to leave.
 */
export function exitDecisionDate(
  contractEnd: Date | null | undefined,
  noticePeriodDays: number | null | undefined,
): Date | null {
  if (!contractEnd) return null;
  const d = new Date(contractEnd);
  d.setDate(d.getDate() - (noticePeriodDays ?? 0));
  return d;
}

// ─── Posture ───────────────────────────────────────────────────────────────

export type AssessmentLike = {
  status: string; outcome: string | null; score: number | null;
  dueDate: Date; reviewedAt: Date | null;
};

/**
 * Where the relationship stands on due diligence. Deliberately distinguishes
 * "never assessed" from "assessed and found adequate" — a blank is not a pass,
 * and a register that renders them the same way is worse than no register.
 */
export function assessmentPosture(
  assessments: AssessmentLike[],
  nextDue: Date | null | undefined,
  now = new Date(),
): { posture: string; detail: string } {
  const reviewed = assessments
    .filter((a) => a.status === 'Reviewed' && a.outcome)
    .sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0));
  const open = assessments.filter((a) => ['Requested', 'InProgress', 'Submitted'].includes(a.status));
  const overdueOpen = open.filter((a) => a.dueDate.getTime() < now.getTime());

  if (reviewed.length === 0 && open.length === 0) {
    return { posture: 'NeverAssessed', detail: 'No due diligence has ever been completed on this supplier.' };
  }
  if (overdueOpen.length > 0) {
    return { posture: 'Overdue', detail: `${overdueOpen.length} assessment(s) past their due date.` };
  }
  if (reviewed.length === 0) {
    return { posture: 'InProgress', detail: 'Assessment issued; no reviewed outcome yet.' };
  }

  const latest = reviewed[0];
  if (nextDue && nextDue.getTime() < now.getTime()) {
    return {
      posture: 'Stale',
      detail: `Last assessed ${latest.outcome}, but the reassessment is now past due.`,
    };
  }
  if (latest.outcome === 'Inadequate') {
    return { posture: 'Failing', detail: 'The most recent assessment concluded Inadequate.' };
  }
  if (latest.outcome === 'NeedsImprovement') {
    return { posture: 'Watch', detail: 'The most recent assessment concluded Needs improvement.' };
  }
  return { posture: 'Current', detail: `Assessed Adequate${latest.score != null ? ` (${latest.score}/100)` : ''} and within cadence.` };
}

/**
 * Concentration: how much of the estate runs through one supplier.
 *
 * This is the question the free-text `vendorName` made unanswerable and the
 * reason a vendor is a record. A supplier holding three Critical assets is a
 * different proposition from one holding thirty low-value ones, and the count
 * alone will not tell you which you have.
 */
export function concentration(assets: { criticality: number; replacementValue: number | null }[]): {
  assetCount: number; criticalAssets: number; valueAtRisk: number; weight: number;
} {
  const criticalAssets = assets.filter((a) => a.criticality >= 5).length;
  const valueAtRisk = assets.reduce((s, a) => s + (a.replacementValue ?? 0), 0);
  // Weighted by criticality so one crown jewel outweighs a dozen minor systems.
  const weight = assets.reduce((s, a) => s + Math.max(1, a.criticality), 0);
  return { assetCount: assets.length, criticalAssets, valueAtRisk, weight };
}

export const VENDOR_FORMULAS = [
  {
    key: 'tier',
    name: 'Vendor tier',
    expression: 'tierScore = max(dataAccessWeight, serviceCriticality) x substitutability',
    basis: 'SAMA Cyber Security Framework 3.3.15, ISO 27036',
    why: 'Takes the maximum of data access and service criticality rather than averaging, so a payroll bureau that holds every bank detail is not diluted by its low operational impact. Substitutability multiplies it because it governs how long you are stuck with the exposure. Both axes are 1-5, so the 1-25 result is directly comparable with a risk score.',
  },
  {
    key: 'systemAccessFloor',
    name: 'System-access floor',
    expression: 'if hasSystemAccess and tierScore < 12 then tierScore = 12',
    basis: 'SAMA CSF supplier annex',
    why: 'A supplier that can act on your estate cannot be a low-tier relationship whatever else is true of it.',
  },
  {
    key: 'cadence',
    name: 'Reassessment cadence',
    expression: 'Critical 6 months · High 12 · Medium 18 · Low 24',
    basis: 'ISO 27036-2',
    why: 'Cadence is a consequence of tier, not a field someone sets and forgets.',
  },
  {
    key: 'exit',
    name: 'Exit decision date',
    expression: 'exitDecisionDate = contractEnd - noticePeriodDays',
    basis: 'Contract management practice',
    why: 'The last day notice can still be served. Missing it is how an organisation is auto-renewed into a supplier it wanted to leave.',
  },
  {
    key: 'concentration',
    name: 'Concentration weight',
    expression: 'weight = sum(criticality of every asset this supplier holds)',
    basis: 'GRC Wisdom',
    why: 'One supplier holding three crown jewels is a different proposition from one holding thirty minor systems; a count alone cannot tell them apart.',
  },
] as const;
