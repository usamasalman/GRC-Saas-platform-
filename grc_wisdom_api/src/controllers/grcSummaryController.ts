import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { evaluateAppetite, Appetite, AppetiteBand } from '../services/riskThresholds';
import {
  RISK_STATUSES, THREAT_TREATMENTS, OPPORTUNITY_TREATMENTS,
} from '../services/riskLifecycle';

/**
 * The buckets come from the lifecycle constants rather than a list typed out
 * here. A hand-written list is how a dashboard ends up with an "Exploit: 0" it
 * never had and no row for a status somebody added last quarter -- and every
 * one of those errors reads as good news.
 */
const LIVE_RISK_STATUSES = RISK_STATUSES.filter((s) => s !== 'Closed');
const ALL_TREATMENTS = [...THREAT_TREATMENTS, ...OPPORTUNITY_TREATMENTS];
/**
 * Findings are rated High | Medium | Low. There is deliberately no Critical
 * bucket: issueController rejects one, so a Critical count could only ever read
 * zero, and a permanent zero next to the word Critical is read as an all-clear.
 */
const ISSUE_RATINGS = ['High', 'Medium', 'Low'];

/**
 * The GRC status summary: how much risk there is, how much of it is outside
 * appetite, what is being done about it, and what is overdue.
 *
 * Every figure here is counted from rows. That is worth stating because the
 * dashboard this replaces is not: systemController.getSecurityPosture returns
 * hardcoded A+ grades for six controls it never inspects, and
 * RealtimeDashboardPage carries literal ARR and churn figures in its source. A
 * compliance product showing invented numbers is worse than one showing none —
 * the customer cannot tell which of the two they are looking at.
 *
 * Where a figure genuinely cannot be computed, this returns null and says why,
 * rather than returning zero. Zero and unknown mean different things and only
 * one of them is a reason to relax.
 */

/**
 * Risk appetite is set per category. A risk with no appetite row for its
 * category cannot be judged — which is itself worth reporting, because it means
 * somebody has risks they have never decided their tolerance for.
 */
function bandFor(
  residualScore: number,
  tenantId: string,
  category: string,
  appetites: Map<string, Appetite>,
): AppetiteBand | null {
  const appetite = appetites.get(appetiteKey(tenantId, category));
  return appetite ? evaluateAppetite(residualScore, appetite) : null;
}

/**
 * Appetite belongs to a tenant, not to the platform. Under a subtree scope this
 * summary spans several of them, and two subsidiaries may well carry different
 * tolerances for the same category -- one runs a trading desk, the other a
 * warehouse. Keying on category alone would band both against whichever row
 * came back last.
 */
const appetiteKey = (tenantId: string, category: string) => `${tenantId}::${category}`;

export const getGrcSummary = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(String(req.user!.tenantId));
    const where = { tenantId: { in: scope.tenantIds } };
    const now = new Date();

    const [risks, appetiteRows, audits, issues, implementations] = await Promise.all([
      prisma.risk.findMany({
        where,
        select: {
          id: true, ref: true, title: true, tenantId: true, category: true, status: true,
          treatmentType: true, inherentScore: true, residualScore: true,
          nextReviewDate: true, createdAt: true,
          owner: { select: { id: true, name: true } },
        },
      }),
      prisma.riskAppetite.findMany({
        // Appetite is versioned: a category can hold a Draft, several
        // Superseded versions and one in force. Reading them all and keying by
        // category would let whichever row the database happened to return
        // last decide the band -- so a tolerance the board rejected, or one it
        // replaced two years ago, could quietly set the headline figure.
        where: { ...where, status: 'Approved', effectiveTo: null },
        select: {
          tenantId: true, category: true,
          appetiteThreshold: true, toleranceThreshold: true,
        },
      }),
      prisma.audit.findMany({
        where,
        select: { id: true, ref: true, title: true, status: true, createdAt: true },
      }),
      prisma.issue.findMany({
        where,
        select: {
          id: true, ref: true, title: true, status: true, riskRating: true,
          // Two dates, and they mean different things. targetCloseDate is when
          // the finding should be closed; capDueDate is when the corrective
          // action was promised. A breach of the second is the one that gets
          // raised at a committee, so it leads.
          capDueDate: true, targetCloseDate: true, closedAt: true,
        },
      }),
      prisma.controlImplementation.findMany({
        where,
        select: { id: true, status: true, effectiveness: true, nextDueDate: true },
      }),
    ]);

    // ── Risk ────────────────────────────────────────────────────────────────
    const appetites = new Map<string, Appetite>(
      appetiteRows.map((a) => [appetiteKey(a.tenantId, a.category), {
        appetiteThreshold: a.appetiteThreshold,
        toleranceThreshold: a.toleranceThreshold,
      } as Appetite]),
    );

    // Closed risks are excluded from every live figure. A register that counts
    // its own history reports a number that only ever grows, which tells a
    // board nothing about today.
    const live = risks.filter((r) => r.status !== 'Closed');

    const banded = live.map((r) => ({
      ...r,
      band: bandFor(r.residualScore, r.tenantId, r.category, appetites),
    }));

    const unjudgeable = banded.filter((r) => r.band === null);
    const beyondTolerance = banded.filter((r) => r.band === 'BeyondTolerance');
    const withinTolerance = banded.filter((r) => r.band === 'WithinTolerance');

    const overdueReview = live.filter(
      (r) => r.nextReviewDate !== null && r.nextReviewDate < now,
    );

    // Inherent minus residual, across live risks: how much of the exposure the
    // treatment has actually taken out. A single number a board understands.
    const inherentTotal = live.reduce((n, r) => n + r.inherentScore, 0);
    const residualTotal = live.reduce((n, r) => n + r.residualScore, 0);

    // ── Issues and their SLA ────────────────────────────────────────────────
    // "Breached" here means an open issue past its due date. It is derived, not
    // stored, so it is right at the moment it is read rather than at the moment
    // some scanner last ran.
    const openIssues = issues.filter((i) => i.status !== 'Closed' && !i.closedAt);
    // The promised date, falling back to the close target when no corrective
    // action has been dated. Falling back rather than ignoring, because an
    // issue with a close target and no CAP date is still something with a
    // deadline somebody agreed to.
    const dueOf = (i: { capDueDate: Date | null; targetCloseDate: Date | null }) =>
      i.capDueDate ?? i.targetCloseDate;

    const breached = openIssues.filter((i) => {
      const d = dueOf(i);
      return d !== null && d < now;
    });
    const dueSoon = openIssues.filter((i) => {
      const d = dueOf(i);
      if (!d || d < now) return false;
      return (d.getTime() - now.getTime()) / 86_400_000 <= 14;
    });

    // ── Controls ────────────────────────────────────────────────────────────
    const implTotal = implementations.length;
    const implVerified = implementations.filter((i) => i.status === 'Verified').length;
    const implIneffective = implementations.filter(
      (i) => i.effectiveness === 'Ineffective' || i.effectiveness === 'PartiallyEffective',
    ).length;
    const implOverdue = implementations.filter(
      (i) => i.nextDueDate !== null && i.nextDueDate < now,
    ).length;

    res.json({
      status: 'success',
      scope: scope.kind,
      generatedAt: now.toISOString(),

      risk: {
        total: live.length,
        closed: risks.length - live.length,
        byStatus: LIVE_RISK_STATUSES.reduce(
          (acc, st) => ({ ...acc, [st]: live.filter((r) => r.status === st).length }),
          {} as Record<string, number>,
        ),
        byTreatment: ALL_TREATMENTS.reduce(
          (acc, t) => ({ ...acc, [t]: live.filter((r) => r.treatmentType === t).length }),
          {} as Record<string, number>,
        ),
        exposure: {
          inherentTotal,
          residualTotal,
          // The point of doing any of this: how much exposure treatment removed.
          reducedBy: inherentTotal - residualTotal,
          reducedPercent: inherentTotal === 0
            ? 0
            : Math.round(((inherentTotal - residualTotal) / inherentTotal) * 100),
        },
        appetite: {
          // Null rather than zero when no appetite has been set at all. Zero
          // risks beyond tolerance and no tolerance defined look identical on a
          // dashboard and mean opposite things.
          configured: new Set(appetiteRows.map((a) => a.category)).size,
          beyondTolerance: appetiteRows.length === 0 ? null : beyondTolerance.length,
          withinTolerance: appetiteRows.length === 0 ? null : withinTolerance.length,
          withinAppetite: appetiteRows.length === 0
            ? null
            : live.length - unjudgeable.length - beyondTolerance.length - withinTolerance.length,
          // Risks in a category nobody has set an appetite for. Not a failure
          // of the maths — a decision the organisation has not taken.
          unjudgeable: unjudgeable.length,
          worst: beyondTolerance
            .sort((a, b) => b.residualScore - a.residualScore)
            .slice(0, 5)
            .map((r) => ({
              id: r.id, ref: r.ref, title: r.title, category: r.category,
              residualScore: r.residualScore, owner: r.owner?.name ?? null,
            })),
        },
        overdueReview: overdueReview.length,
      },

      issues: {
        open: openIssues.length,
        slaBreached: breached.length,
        dueWithin14Days: dueSoon.length,
        // No due date is not the same as on time. An issue nobody dated cannot
        // breach, and counting it as healthy is how a register quietly stops
        // meaning anything.
        undated: openIssues.filter((i) => dueOf(i) === null).length,
        byRating: ISSUE_RATINGS.reduce(
          (acc, r) => ({ ...acc, [r]: openIssues.filter((i) => i.riskRating === r).length }),
          {} as Record<string, number>,
        ),
        worst: breached
          .sort((a, b) => (dueOf(a)?.getTime() ?? 0) - (dueOf(b)?.getTime() ?? 0))
          .slice(0, 5)
          .map((i) => {
            const d = dueOf(i);
            return {
              id: i.id, ref: i.ref, title: i.title, rating: i.riskRating,
              dueDate: d,
              daysOverdue: d ? Math.floor((now.getTime() - d.getTime()) / 86_400_000) : 0,
            };
          }),
      },

      audit: {
        total: audits.length,
        inFlight: audits.filter((a) => a.status !== 'Closed' && a.status !== 'Cancelled').length,
        byStatus: audits.reduce(
          (acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }),
          {} as Record<string, number>,
        ),
      },

      controls: {
        total: implTotal,
        verified: implVerified,
        // Deliberately not a percentage on its own. "80% verified" of four
        // controls and of four hundred are different facts.
        notEffective: implIneffective,
        overdueTesting: implOverdue,
      },
    });
  } catch (error: any) {
    console.error('[GRC Summary Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the summary' });
  }
};
