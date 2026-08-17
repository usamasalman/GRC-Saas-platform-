import { Prisma } from '@prisma/client';

/**
 * The one place residual risk is computed.
 *
 * This used to live inside riskController and was therefore only reachable
 * from two endpoints — editing a risk's own scores, and re-linking its
 * controls. Nothing recomputed when a control's *effectiveness* changed, so a
 * control could be downgraded to Ineffective and every risk relying on it kept
 * the reduced score it had been given months earlier. The schema's promise that
 * residual is "computed from linked-control effectiveness, never client-set"
 * held at write time and quietly failed thereafter.
 *
 * Worse, `acceptRisk` reads the stored residual to decide whether a risk is
 * beyond appetite and must be refused — so a stale score defeated a hard
 * control, not merely a dashboard.
 *
 * Everything that can change effectiveness now calls through here:
 * control validation, RCSA submission, and audit test results.
 */

/** Anything that can run a query — the client or a transaction handle. */
export type Db = Prisma.TransactionClient | {
  riskControlLink: { findMany: Function };
  risk: { findMany: Function; update: Function };
  riskScoreSnapshot: { create: Function };
};

export type ScoreReason =
  | 'Created'
  | 'Rescored'
  | 'ControlsRelinked'
  | 'ControlEffectivenessChanged'
  | 'TestFailed'
  | 'SelfAssessed'
  | 'Reviewed';

/**
 * Bands a score on the platform default. Use `bandFor` from services/riskCriteria
 * wherever the tenant's own approved criteria are available — a tenant that has
 * set its own scale should be banded on it, not on this.
 */
export function ratingOf(score: number): 'High' | 'Medium' | 'Low' {
  return score >= 15 ? 'High' : score >= 8 ? 'Medium' : 'Low';
}

export function scoreOf(likelihood: number, impact: number) {
  const l = Math.min(5, Math.max(1, Math.round(likelihood)));
  const i = Math.min(5, Math.max(1, Math.round(impact)));
  const score = l * i;
  return { l, i, score, rating: ratingOf(score) };
}

/**
 * How much a control set reduces likelihood.
 *
 * A control only counts once it has been independently verified — an
 * unverified claim of effectiveness is management marking its own homework.
 * The total is capped so residual can never fall below likelihood 1: no
 * quantity of controls makes a risk disappear.
 */
export function reductionFrom(
  links: { implementation: { effectiveness: string | null; status: string } }[],
): number {
  let reduction = 0;
  for (const link of links) {
    if (link.implementation.status !== 'Verified') continue;
    if (link.implementation.effectiveness === 'Effective') reduction += 2;
    else if (link.implementation.effectiveness === 'PartiallyEffective') reduction += 1;
  }
  return Math.min(reduction, 3);
}

export type ResidualResult = {
  residualLikelihood: number;
  residualImpact: number;
  residualScore: number;
};

/** Residual for one risk, from its current link set. */
export async function computeResidual(
  db: any,
  riskId: string,
  inherentL: number,
  inherentI: number,
): Promise<ResidualResult> {
  const links = await db.riskControlLink.findMany({
    where: { riskId },
    include: { implementation: { select: { effectiveness: true, status: true } } },
  });
  const residualL = Math.max(1, inherentL - reductionFrom(links));
  return {
    residualLikelihood: residualL,
    residualImpact: inherentI,
    residualScore: scoreOf(residualL, inherentI).score,
  };
}

/**
 * Recompute every risk that relies on the given control implementations, and
 * record a snapshot for each score that actually moved.
 *
 * Returns the risks whose score changed, so the caller can report the
 * consequence — "3 risks re-rated, 1 now beyond appetite" is the sentence an
 * assessor wants to see, and it is what makes the loop visible to a user.
 *
 * Must be handed a transaction so the recompute commits atomically with the
 * change that triggered it. A control downgrade that succeeds while its risk
 * recompute fails is exactly the stale state this service exists to prevent.
 */
export async function recomputeRisksForImplementations(
  tx: any,
  implementationIds: string[],
  reason: ScoreReason,
  actorNote?: string,
): Promise<{ riskId: string; ref: string; title: string; from: number; to: number }[]> {
  if (implementationIds.length === 0) return [];

  const affected = await tx.riskControlLink.findMany({
    where: { implementationId: { in: implementationIds } },
    select: { riskId: true },
    distinct: ['riskId'],
  });
  const riskIds = affected.map((a: any) => a.riskId);
  if (riskIds.length === 0) return [];

  const risks = await tx.risk.findMany({
    where: { id: { in: riskIds } },
    select: {
      id: true, ref: true, title: true, tenantId: true,
      inherentLikelihood: true, inherentImpact: true, residualScore: true,
    },
  });

  const moved: { riskId: string; ref: string; title: string; from: number; to: number }[] = [];

  for (const risk of risks) {
    const next = await computeResidual(tx, risk.id, risk.inherentLikelihood, risk.inherentImpact);
    if (next.residualScore === risk.residualScore) continue;

    await tx.risk.update({ where: { id: risk.id }, data: next });
    await tx.riskScoreSnapshot.create({
      data: {
        tenantId: risk.tenantId,
        riskId: risk.id,
        score: next.residualScore,
        inherentScore: scoreOf(risk.inherentLikelihood, risk.inherentImpact).score,
        residualScore: next.residualScore,
        reason,
      },
    });
    moved.push({
      riskId: risk.id,
      ref: risk.ref,
      title: risk.title,
      from: risk.residualScore,
      to: next.residualScore,
    });
  }

  if (moved.length > 0 && actorNote) {
    // The note is carried by the caller's own audit entry; nothing to write here.
  }
  return moved;
}

/** A one-line summary of a recompute, for the API response message. */
export function describeMovement(
  moved: { ref: string; from: number; to: number }[],
): string {
  if (moved.length === 0) return 'No linked risks changed score.';
  const worsened = moved.filter((m) => m.to > m.from);
  const improved = moved.filter((m) => m.to < m.from);
  const parts: string[] = [];
  if (worsened.length) {
    parts.push(`${worsened.length} risk(s) re-rated upward (${worsened.map((m) => `${m.ref} ${m.from}→${m.to}`).join(', ')})`);
  }
  if (improved.length) {
    parts.push(`${improved.length} risk(s) re-rated downward (${improved.map((m) => `${m.ref} ${m.from}→${m.to}`).join(', ')})`);
  }
  return parts.join('; ') + '.';
}

/** Next review date from a cadence, used wherever a risk is assessed. */
export function nextReviewFrom(cadenceMonths: number, from = new Date()): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + Math.max(1, cadenceMonths));
  return d;
}
