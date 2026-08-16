import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { nextReviewFrom } from './riskScoring';

/**
 * The risk lifecycle, declared rather than implied.
 *
 * The audit domain has had `auditLifecycle.ts` stating its transitions in one
 * table since the engagement rebuild; the register had nothing equivalent. Its
 * PATCH endpoint validated only that the *target* value was a known string, so
 * Closed → Open → Closed was unguarded and adding a treatment silently flipped
 * Open → UnderTreatment. This puts the risk register on the same footing.
 *
 * It also carries the periodic review clock. ISO 31000 clause 6.6 requires
 * monitoring and review; without a next-review date and something that acts on
 * it, a register goes stale in silence — which is exactly the laminated-register
 * failure Mabelo describes.
 */

export const RISK_STATUSES = ['Open', 'UnderTreatment', 'Accepted', 'Closed'] as const;
export const RISK_DIRECTIONS = ['Threat', 'Opportunity'] as const;

/**
 * ISO 31000 clause 6.5.2 lists treatment options in both directions. A register
 * that only holds Accept/Mitigate/Transfer/Avoid implements the threat half of
 * the standard and cannot record an opportunity at all.
 */
export const THREAT_TREATMENTS = ['Accept', 'Mitigate', 'Transfer', 'Avoid'] as const;
export const OPPORTUNITY_TREATMENTS = ['Exploit', 'Enhance', 'Share', 'Ignore'] as const;

export function treatmentsFor(direction: string): readonly string[] {
  return direction === 'Opportunity' ? OPPORTUNITY_TREATMENTS : THREAT_TREATMENTS;
}

/**
 * Accepted is reachable only through the acceptance endpoint, which enforces
 * the appetite ceiling, the second approver and the expiry date. Allowing a
 * plain PATCH into Accepted would route around all three, so it is absent here
 * as a destination on purpose.
 */
const TRANSITIONS: Record<string, string[]> = {
  Open:           ['UnderTreatment', 'Closed'],
  UnderTreatment: ['Open', 'Closed'],
  // An expired or withdrawn acceptance lands back in the treatment queue.
  Accepted:       ['Open', 'UnderTreatment'],
  // A closed risk that recurs is reopened, which is a real event worth
  // recording, not a silent edit.
  Closed:         ['Open'],
};

export function checkRiskTransition(current: string, next: string): string | null {
  if (current === next) return null;
  const allowed = TRANSITIONS[current];
  if (!allowed) return `Unknown current status "${current}".`;
  if (next === 'Accepted') {
    return 'Acceptance goes through POST /risks/:id/accept, which enforces the appetite ceiling, an independent approver and an expiry date.';
  }
  if (!allowed.includes(next)) {
    return `A risk cannot move from ${current} to ${next}. Allowed: ${allowed.join(', ') || 'none'}.`;
  }
  return null;
}

export function allowedNextRiskStatuses(current: string): string[] {
  return TRANSITIONS[current] ?? [];
}

// ─── Periodic review and acceptance expiry ─────────────────────────────────

/**
 * Sweeps the register for two things the platform previously only displayed:
 *
 *   1. Acceptances past their expiry date. Time-bound acceptance is the right
 *      design and it was half-built — `acceptanceExpired` was computed for the
 *      list and counted in the totals, and nothing ever acted on it, so a
 *      lapsed acceptance stayed Accepted indefinitely.
 *
 *   2. Risks past their next review date. A review that never falls due is not
 *      a review cycle.
 *
 * Both write to the WORM trail with the system as actor, so the register can
 * show *why* a risk reopened without a human having touched it.
 */
export async function runRiskReviewScan(): Promise<{ reopened: number; overdueReviews: number }> {
  const now = new Date();

  const lapsed = await prisma.risk.findMany({
    where: { status: 'Accepted', acceptedUntil: { not: null, lt: now } },
    select: { id: true, ref: true, tenantId: true, ownerId: true, acceptedUntil: true, acceptanceReason: true },
  });

  let reopened = 0;
  for (const risk of lapsed) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.risk.update({
          where: { id: risk.id },
          data: {
            status: 'Open',
            acceptedById: null,
            acceptedUntil: null,
            acceptanceReason: null,
            nextReviewDate: now,
          },
        });
        await writeAudit(tx, {
          tenantId: risk.tenantId,
          // The risk owner is accountable for the lapse; attributing it to them
          // keeps the trail non-repudiable without inventing a system actor.
          actorId: risk.ownerId,
          action: 'RISK_ACCEPTANCE_EXPIRED',
          subjectType: 'Risk',
          subjectId: risk.id,
          payload: {
            ref: risk.ref,
            acceptedUntil: risk.acceptedUntil,
            previousReason: risk.acceptanceReason,
            note: 'Acceptance lapsed; the risk is carried again and needs a fresh decision.',
          },
        });
      });
      reopened++;
    } catch (err) {
      console.error(`[Risk review] could not reopen ${risk.ref}:`, err);
    }
  }

  const overdueReviews = await prisma.risk.count({
    where: { status: { not: 'Closed' }, nextReviewDate: { not: null, lt: now } },
  });

  if (reopened > 0 || overdueReviews > 0) {
    console.log(`[Risk review] ${reopened} acceptance(s) expired and reopened; ${overdueReviews} risk(s) overdue for review`);
  }
  return { reopened, overdueReviews };
}

/** Backfills a review date for any risk that has none, so nothing is invisible. */
export async function backfillReviewDates(): Promise<number> {
  const missing = await prisma.risk.findMany({
    where: { nextReviewDate: null, status: { not: 'Closed' } },
    select: { id: true, reviewCadenceMonths: true, updatedAt: true },
  });
  for (const r of missing) {
    await prisma.risk.update({
      where: { id: r.id },
      data: { nextReviewDate: nextReviewFrom(r.reviewCadenceMonths, r.updatedAt) },
    });
  }
  return missing.length;
}

let timer: NodeJS.Timeout | null = null;

export function startRiskReviewScanner(intervalMs = 15 * 60_000): void {
  if (timer) return;
  setTimeout(() => {
    backfillReviewDates()
      .then((n) => { if (n > 0) console.log(`[Risk review] backfilled ${n} review date(s)`); })
      .then(() => runRiskReviewScan())
      .catch(console.error);
  }, 12_000);
  timer = setInterval(() => { runRiskReviewScan().catch(console.error); }, intervalMs);
  console.log(`[Risk review] scanner started (every ${Math.round(intervalMs / 60000)}m)`);
}

export function stopRiskReviewScanner(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
