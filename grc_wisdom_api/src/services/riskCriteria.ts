/**
 * Risk criteria — ISO 31000 clause 6.3.4.
 *
 * The scale a tenant measures risk on. Before this it was two magic numbers in
 * a controller: `score >= 15 ? 'High' : score >= 8 ? 'Medium' : 'Low'`, with no
 * anchor text behind the 1–5 ladders at all. That meant every tenant on the
 * platform shared one definition of "impact 4", which is exactly the thing
 * clause 6.3.4 says an organisation must define for itself against its own
 * objectives — a hospital group's catastrophic is not a bank's.
 *
 * Criteria are therefore data: owned by the tenant, versioned, and approved by
 * someone other than the author, the same way appetite is. This module holds
 * the platform default (used until a tenant approves its own), the validation,
 * and the banding that every score in the product runs through.
 */

export type ImpactLevel = {
  level: number;
  label: string;
  descriptor: string;
  monetaryFrom?: number | null;
  monetaryTo?: number | null;
};

export type LikelihoodLevel = {
  level: number;
  label: string;
  descriptor: string;
  /** Plain-language expected frequency, so two assessors read level 4 alike. */
  frequency: string;
};

export type Criteria = {
  id: string | null;
  version: number;
  name: string;
  impactScale: ImpactLevel[];
  likelihoodScale: LikelihoodLevel[];
  highThreshold: number;
  mediumThreshold: number;
  currency: string;
  /** True when no tenant-approved version exists and the default is in use. */
  isPlatformDefault: boolean;
  effectiveFrom: Date | null;
};

/**
 * The platform default. Deliberately generic and deliberately labelled as a
 * default in the API response, so a tenant can see it has not yet set its own
 * rather than mistaking it for a board decision.
 */
export const DEFAULT_IMPACT_SCALE: ImpactLevel[] = [
  { level: 1, label: 'Insignificant', descriptor: 'Absorbed within normal operations. No customer, regulatory or reporting consequence.' },
  { level: 2, label: 'Minor', descriptor: 'Handled by the responsible function. Isolated customer complaints; no reportable breach.' },
  { level: 3, label: 'Moderate', descriptor: 'Requires executive attention. Service degradation, or a finding an assessor would raise.' },
  { level: 4, label: 'Major', descriptor: 'Board-level attention. Regulatory notification, material service loss, or public comment.' },
  { level: 5, label: 'Severe', descriptor: 'Threatens the licence to operate. Enforcement action, prolonged outage, or loss of a core capability.' },
];

export const DEFAULT_LIKELIHOOD_SCALE: LikelihoodLevel[] = [
  { level: 1, label: 'Rare', descriptor: 'Would require an exceptional combination of failures.', frequency: 'Less than once in 20 years' },
  { level: 2, label: 'Unlikely', descriptor: 'Not expected, but has occurred in comparable organisations.', frequency: 'Once in 5 to 20 years' },
  { level: 3, label: 'Possible', descriptor: 'Could occur at some point; controls are the reason it has not.', frequency: 'Once in 2 to 5 years' },
  { level: 4, label: 'Likely', descriptor: 'Expected to occur; near misses are already being seen.', frequency: 'Roughly once a year' },
  { level: 5, label: 'Almost certain', descriptor: 'Occurring now, or certain to within the planning horizon.', frequency: 'Several times a year' },
];

export const PLATFORM_DEFAULT: Criteria = {
  id: null,
  version: 0,
  name: 'Platform default criteria',
  impactScale: DEFAULT_IMPACT_SCALE,
  likelihoodScale: DEFAULT_LIKELIHOOD_SCALE,
  // 15 and 8 preserve the behaviour every existing score was produced under,
  // so adopting criteria does not silently re-band a live register.
  highThreshold: 15,
  mediumThreshold: 8,
  currency: 'SAR',
  isPlatformDefault: true,
  effectiveFrom: null,
};

// ─── Validation ────────────────────────────────────────────────────────────

/** Returns an error string, or null when the scale is usable. */
export function validateScale(
  raw: unknown,
  kind: 'impact' | 'likelihood',
): string | null {
  if (!Array.isArray(raw)) return `${kind}Scale must be an array of five levels`;
  if (raw.length !== 5) return `${kind}Scale must define exactly five levels, got ${raw.length}`;

  const seen = new Set<number>();
  for (const entry of raw as any[]) {
    const level = Number(entry?.level);
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      return `${kind}Scale levels must be the whole numbers 1 to 5`;
    }
    if (seen.has(level)) return `${kind}Scale repeats level ${level}`;
    seen.add(level);
    if (!entry?.label || String(entry.label).trim().length === 0) {
      return `${kind}Scale level ${level} needs a label`;
    }
    // The descriptor is the whole point: without it a level is a number two
    // people will read differently, which is what criteria exist to prevent.
    if (!entry?.descriptor || String(entry.descriptor).trim().length < 10) {
      return `${kind}Scale level ${level} needs a descriptor of at least 10 characters — the anchor text is what makes the level mean the same thing to two assessors`;
    }
    if (kind === 'likelihood' && (!entry?.frequency || String(entry.frequency).trim().length === 0)) {
      return `likelihoodScale level ${level} needs an expected frequency`;
    }
  }

  if (kind === 'impact') {
    // Monetary bands, where given, must ascend with the level. A scale whose
    // level 4 costs less than its level 3 is not a scale.
    let previousTop: number | null = null;
    for (const entry of [...(raw as any[])].sort((a, b) => a.level - b.level)) {
      const from = entry.monetaryFrom == null ? null : Number(entry.monetaryFrom);
      const to = entry.monetaryTo == null ? null : Number(entry.monetaryTo);
      if (from != null && to != null && to < from) {
        return `impactScale level ${entry.level} has an upper bound below its lower bound`;
      }
      if (from != null && previousTop != null && from < previousTop) {
        return `impactScale level ${entry.level} starts below where level ${entry.level - 1} ended — monetary bands must ascend`;
      }
      if (to != null) previousTop = to;
    }
  }
  return null;
}

export function validateThresholds(high: number, medium: number): string | null {
  if (!Number.isInteger(high) || !Number.isInteger(medium)) {
    return 'highThreshold and mediumThreshold must be whole numbers';
  }
  if (medium < 2 || high > 25) {
    return 'thresholds must sit within the 1–25 range a 5×5 matrix can produce';
  }
  if (high <= medium) {
    return 'highThreshold must be above mediumThreshold, otherwise no score can ever be Medium';
  }
  return null;
}

// ─── Banding ───────────────────────────────────────────────────────────────

/**
 * The one place a score becomes a rating. Takes criteria rather than assuming
 * them, so a tenant that has approved its own bands gets its own answer.
 */
export function bandFor(score: number, criteria: Criteria): 'High' | 'Medium' | 'Low' {
  if (score >= criteria.highThreshold) return 'High';
  if (score >= criteria.mediumThreshold) return 'Medium';
  return 'Low';
}

/** The anchor text for a given axis value, for tooltips and report footnotes. */
export function describeLevel(
  criteria: Criteria,
  axis: 'impact' | 'likelihood',
  level: number,
): ImpactLevel | LikelihoodLevel | null {
  const scale = axis === 'impact' ? criteria.impactScale : criteria.likelihoodScale;
  return scale.find((l) => l.level === level) ?? null;
}

// ─── Resolution ────────────────────────────────────────────────────────────

function parseScale<T>(raw: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length === 5 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function toCriteria(row: any): Criteria {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    impactScale: parseScale(row.impactScale, DEFAULT_IMPACT_SCALE),
    likelihoodScale: parseScale(row.likelihoodScale, DEFAULT_LIKELIHOOD_SCALE),
    highThreshold: row.highThreshold,
    mediumThreshold: row.mediumThreshold,
    currency: row.currency,
    isPlatformDefault: false,
    effectiveFrom: row.effectiveFrom,
  };
}

/**
 * The criteria in force for a tenant right now — its own approved version if it
 * has one, otherwise the platform default.
 *
 * Falling back rather than failing matters: a tenant that has never set
 * criteria still needs its register to work, and being told it is running on
 * the default is more useful than an empty screen.
 */
export async function activeCriteria(db: any, tenantId: string): Promise<Criteria> {
  const row = await db.riskCriteria.findFirst({
    where: { tenantId, status: 'Approved', effectiveTo: null },
    orderBy: { version: 'desc' },
  });
  return row ? toCriteria(row) : { ...PLATFORM_DEFAULT };
}

/**
 * The criteria that were in force at a point in time — what a past decision was
 * actually judged against. This is the question a version history exists to
 * answer, so it is a first-class lookup rather than something a reader has to
 * reconstruct from timestamps.
 */
export async function criteriaAt(db: any, tenantId: string, at: Date): Promise<Criteria> {
  const row = await db.riskCriteria.findFirst({
    where: {
      tenantId,
      status: { in: ['Approved', 'Superseded'] },
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { version: 'desc' },
  });
  return row ? toCriteria(row) : { ...PLATFORM_DEFAULT };
}

/** Likewise for appetite: which ceiling was binding on this category, then. */
export async function appetiteAt(
  db: any,
  tenantId: string,
  category: string,
  at: Date,
): Promise<any | null> {
  return db.riskAppetite.findFirst({
    where: {
      tenantId,
      category,
      status: { in: ['Approved', 'Superseded'] },
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { version: 'desc' },
  });
}
