import { evaluateAppetite, Appetite } from './riskThresholds';

/**
 * How each organisation in the estate is actually doing.
 *
 * The GRC summary answers this for a whole scope at once, blended into one set
 * of figures. For a platform operator that is every customer added together,
 * which answers no question anybody has: "how is the estate" is not a number,
 * and "which of my customers is in trouble" cannot be recovered from a total.
 *
 * What stood in its place was worse. The Subsidiary Scorecards screen was
 * rendered by the mock engine with hardcoded percentages — Saudi Technology
 * Services 91, Jordan Operations 86 — beside a Compliance Posture of 82.4%.
 * Invented compliance posture is the most damaging thing a compliance product
 * can display, because it is the one number the customer cannot check and the
 * one they act on.
 *
 * Two rules here, and the second matters more than the first.
 *
 * Every figure is counted from rows. Nothing is estimated, weighted or graded.
 * There is no letter, no overall score, and no blended percentage, because any
 * of those would be a judgement this code is not entitled to make on a
 * customer's behalf.
 *
 * And nothing assessed is never reported as nothing wrong. A tenant with no
 * risk register has no risks beyond tolerance, which reads as perfect and means
 * the opposite. Each organisation says plainly whether it has been assessed at
 * all, and where a figure cannot be computed it is null with a reason rather
 * than zero.
 *
 * Pure, so every case runs without a database — the same shape as
 * hasPlatformDuty, judgeDeletion, planEnablement and planSuspension.
 */

export interface PostureTenant {
  id: string;
  name: string;
  type: string;
  suspendedAt?: Date | string | null;
}

export interface PostureRisk {
  tenantId: string;
  category: string;
  status: string;
  residualScore: number;
  nextReviewDate: Date | string | null;
}

export interface PostureAppetite {
  tenantId: string;
  category: string;
  appetiteThreshold: number;
  toleranceThreshold: number;
}

export interface PostureIssue {
  tenantId: string;
  status: string;
  capDueDate: Date | string | null;
  targetCloseDate: Date | string | null;
}

export interface PostureImplementation {
  tenantId: string;
  status: string;
  effectiveness: string;
  nextDueDate: Date | string | null;
}

export interface PostureEnablement {
  tenantId: string;
}

export interface TenantPosture {
  tenantId: string;
  tenantName: string;
  type: string;
  suspended: boolean;

  /**
   * False when this organisation has no register, no controls and no findings.
   *
   * The single most important field here. Every count below reads as good news
   * when it is zero, and for an unassessed organisation every one of them IS
   * zero — so without this the estate's least compliant customers look like its
   * best.
   */
  assessed: boolean;

  risks: {
    live: number;
    beyondTolerance: number;
    /** Live risks whose category has no approved appetite, so they cannot be judged. */
    unjudgeable: number;
    overdueReview: number;
  };
  issues: {
    open: number;
    overdue: number;
  };
  controls: {
    implemented: number;
    effective: number;
    ineffective: number;
    overdueReview: number;
    /**
     * effective / assessed, or null when nothing has been assessed.
     *
     * Null rather than zero, and never rounded up into a grade. The
     * denominator travels with it so the reader sees 3 of 4 rather than a
     * percentage floating free of its basis.
     */
    effectivenessBasis: number;
    effectivenessRate: number | null;
  };
  standardsEnabled: number;

  /** Plain sentences naming what could not be judged and why. */
  unknowns: string[];
}

const isOverdue = (d: Date | string | null, now: number): boolean => {
  if (!d) return false;
  const t = new Date(d).getTime();
  return !Number.isNaN(t) && t < now;
};

const key = (tenantId: string, category: string) => `${tenantId}::${category}`;

export function estatePosture(input: {
  tenants: readonly PostureTenant[];
  risks: readonly PostureRisk[];
  appetites: readonly PostureAppetite[];
  issues: readonly PostureIssue[];
  implementations: readonly PostureImplementation[];
  enablements: readonly PostureEnablement[];
  now?: Date;
}): TenantPosture[] {
  const now = (input.now || new Date()).getTime();

  const appetiteBy = new Map<string, Appetite>(
    input.appetites.map((a) => [key(a.tenantId, a.category), {
      appetiteThreshold: a.appetiteThreshold,
      toleranceThreshold: a.toleranceThreshold,
    } as Appetite]),
  );

  const group = <T extends { tenantId: string }>(rows: readonly T[]): Map<string, T[]> => {
    const by = new Map<string, T[]>();
    for (const r of rows) {
      if (!by.has(r.tenantId)) by.set(r.tenantId, []);
      by.get(r.tenantId)!.push(r);
    }
    return by;
  };

  const risksBy = group(input.risks);
  const issuesBy = group(input.issues);
  const implsBy = group(input.implementations);
  const enablementsBy = group(input.enablements);

  return input.tenants.map((t) => {
    // Closed risks are excluded from every live figure, as the summary does: a
    // register that counts its own history reports a number that only grows.
    const live = (risksBy.get(t.id) || []).filter((r) => r.status !== 'Closed');
    const banded = live.map((r) => {
      const appetite = appetiteBy.get(key(t.id, r.category));
      return appetite ? evaluateAppetite(r.residualScore, appetite) : null;
    });

    const beyondTolerance = banded.filter((b) => b === 'BeyondTolerance').length;
    const unjudgeable = banded.filter((b) => b === null).length;
    const overdueReview = live.filter((r) => isOverdue(r.nextReviewDate, now)).length;

    const issues = issuesBy.get(t.id) || [];
    const openIssues = issues.filter((i) => i.status !== 'Closed');
    // The corrective action's promised date leads, as it does in the summary:
    // a breach of that is what gets raised at a committee.
    const overdueIssues = openIssues.filter(
      (i) => isOverdue(i.capDueDate, now) || isOverdue(i.targetCloseDate, now),
    ).length;

    const impls = implsBy.get(t.id) || [];
    const effective = impls.filter((i) => i.effectiveness === 'Effective').length;
    const ineffective = impls.filter((i) => i.effectiveness === 'Ineffective').length;
    const assessedImpls = impls.filter((i) => i.effectiveness !== 'NotAssessed').length;
    const overdueControls = impls.filter((i) => isOverdue(i.nextDueDate, now)).length;

    const standardsEnabled = (enablementsBy.get(t.id) || []).length;

    // Every risk row, not only the live ones. An organisation that raised risks
    // and closed them all has plainly been assessed -- somebody did the work --
    // and calling that "nothing assessed" would put the best-run customer at
    // the top of the attention list.
    const allRisks = risksBy.get(t.id) || [];
    const assessed = allRisks.length > 0 || impls.length > 0 || issues.length > 0;

    const unknowns: string[] = [];
    if (!assessed) {
      unknowns.push(
        'Nothing has been assessed here: no risks, no control implementations and no findings. '
        + 'The zeroes below are an absence of work, not an absence of exposure.',
      );
    }
    if (unjudgeable > 0) {
      unknowns.push(
        `${unjudgeable} live risk${unjudgeable === 1 ? '' : 's'} cannot be judged against appetite, `
        + 'because no approved appetite exists for their category.',
      );
    }
    if (impls.length > 0 && assessedImpls === 0) {
      unknowns.push(
        `${impls.length} control implementation${impls.length === 1 ? ' has' : 's have'} never been `
        + 'assessed for effectiveness.',
      );
    }
    if (standardsEnabled === 0) {
      unknowns.push('No framework is enabled, so there is nothing to be assessed against.');
    }

    return {
      tenantId: t.id,
      tenantName: t.name,
      type: t.type,
      suspended: t.suspendedAt != null,
      assessed,
      risks: { live: live.length, beyondTolerance, unjudgeable, overdueReview },
      issues: { open: openIssues.length, overdue: overdueIssues },
      controls: {
        implemented: impls.length,
        effective,
        ineffective,
        overdueReview: overdueControls,
        effectivenessBasis: assessedImpls,
        effectivenessRate: assessedImpls > 0
          ? Math.round((effective / assessedImpls) * 100)
          : null,
      },
      standardsEnabled,
      unknowns,
    };
  });
}

/**
 * Organisations worth looking at first.
 *
 * Deliberately an ordering and not a score. Unassessed leads, because an
 * organisation nobody has looked at is a bigger problem than one with known
 * findings being worked; after that, the counts that mean somebody has to do
 * something. Two organisations that tie stay in the order they arrived rather
 * than being separated by an invented tie-break.
 */
export function attentionOrder(rows: readonly TenantPosture[]): TenantPosture[] {
  const weight = (p: TenantPosture): number => {
    if (!p.assessed) return 1_000_000;
    return p.risks.beyondTolerance * 1000
      + p.issues.overdue * 100
      + p.risks.unjudgeable * 10
      + p.controls.ineffective * 10
      + p.risks.overdueReview
      + p.controls.overdueReview;
  };
  return [...rows].sort((a, b) => weight(b) - weight(a));
}
