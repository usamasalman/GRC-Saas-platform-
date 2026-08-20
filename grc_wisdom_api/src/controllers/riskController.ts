import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { evaluateAppetite } from '../services/riskThresholds';
import {
  computeResidual, scoreOf as scoreRisk, nextReviewFrom, ratingOf,
} from '../services/riskScoring';
import {
  checkRiskTransition, allowedNextRiskStatuses, treatmentsFor,
  RISK_DIRECTIONS, THREAT_TREATMENTS, OPPORTUNITY_TREATMENTS,
} from '../services/riskLifecycle';
import { activeCriteria, bandFor } from '../services/riskCriteria';

const SUBJ_RISK = 'Risk';
const TREATMENTS = [...THREAT_TREATMENTS, ...OPPORTUNITY_TREATMENTS];
export const CATEGORIES = ['Strategic', 'Operational', 'Financial', 'Compliance', 'Technology', 'Third-Party', 'People'];

/**
 * Scoring and residual derivation now live in services/riskScoring so that
 * every path which can change control effectiveness recomputes the same way.
 * Re-exported here because other modules import `scoreOf` from this controller.
 */
export const scoreOf = scoreRisk;

async function nextRef(tenantId: string): Promise<string> {
  const count = await prisma.risk.count({ where: { tenantId } });
  return `RSK-${String(count + 1).padStart(3, '0')}`;
}

// ─── List ──────────────────────────────────────────────────────────────────

export const listRisks = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.risks.list');

    const { status, category, search, mine } = req.query as Record<string, string | undefined>;
    const where: any = { tenantId: { in: scope.tenantIds } };
    if (status) where.status = status;
    if (category) where.category = category;
    if (mine === 'true') where.ownerId = req.user!.id;
    if (search) {
      where.OR = [{ title: { contains: search } }, { ref: { contains: search } }, { description: { contains: search } }];
    }

    const risks = await prisma.risk.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        acceptedBy: { select: { id: true, name: true } },
        acceptedUnderAppetite: {
          select: {
            id: true, version: true, appetiteThreshold: true,
            toleranceThreshold: true, effectiveFrom: true, effectiveTo: true,
          },
        },
        tenant: { select: { id: true, name: true } },
        controlLinks: { include: { implementation: { include: { control: { select: { code: true } } } } } },
        treatments: { orderBy: { createdAt: 'asc' } },
        entityLinks: { include: { auditableEntity: { select: { id: true, name: true, type: true } } } },
        issues: { select: { id: true, ref: true, status: true, riskRating: true, source: true } },
        causes: { select: { effectId: true, nature: true } },
        effects: { select: { causeId: true, nature: true } },
        _count: { select: { kris: true, lossEvents: true } },
      },
      orderBy: [{ residualScore: 'desc' }],
      take: 500,
    });

    // The tenant's own approved criteria band the register where it has set
    // them; otherwise the platform default applies and says so.
    const criteria = await activeCriteria(prisma, req.user!.tenantId);

    // Board-set appetite is per category, so one lookup covers the whole page
    // and every risk can be banded without an N+1.
    const appetites = await prisma.riskAppetite.findMany({
      // Only the version currently in force bands a live register.
      where: { tenantId: { in: scope.tenantIds }, status: 'Approved', effectiveTo: null },
    });
    const appetiteByCategory = new Map(appetites.map((a) => [a.category, a]));

    const now = Date.now();
    const enriched = risks.map((r) => {
      const appetite = appetiteByCategory.get(r.category);
      const openIssues = r.issues.filter((i) => i.status !== 'Closed');
      return {
        ...r,
        inherentRating: bandFor(r.inherentScore, criteria),
        residualRating: bandFor(r.residualScore, criteria),
        linkedControls: r.controlLinks.map((l) => l.implementation.control.code),
        effectiveControls: r.controlLinks.filter(
          (l) => l.implementation.status === 'Verified' && l.implementation.effectiveness === 'Effective',
        ).length,
        openTreatments: r.treatments.filter((t) => t.status === 'Open').length,
        overdueTreatments: r.treatments.filter((t) => t.status === 'Open' && t.dueDate && t.dueDate.getTime() < now).length,
        acceptanceExpired: r.status === 'Accepted' && !!r.acceptedUntil && r.acceptedUntil.getTime() < now,

        // Where this risk sits against board appetite — the second heatmap.
        appetiteBand: appetite ? evaluateAppetite(r.residualScore, appetite) : 'NoAppetiteSet',
        appetiteThreshold: appetite?.appetiteThreshold ?? null,
        toleranceThreshold: appetite?.toleranceThreshold ?? null,

        // Review state (ISO 31000 6.6).
        reviewOverdue: !!r.nextReviewDate && r.nextReviewDate.getTime() < now && r.status !== 'Closed',
        daysUntilReview: r.nextReviewDate
          ? Math.round((r.nextReviewDate.getTime() - now) / 86_400_000)
          : null,

        // Whether the risk is in its manifestation window right now.
        inHorizon: !r.horizonStart || !r.horizonEnd
          ? true
          : r.horizonStart.getTime() <= now && r.horizonEnd.getTime() >= now,

        entities: r.entityLinks.map((l) => l.auditableEntity),
        issueRefs: r.issues.map((i) => i.ref),
        openIssueCount: openIssues.length,
        // Connectedness — the paper's argument for ranking by network position
        // rather than by a flat product of two guesses.
        degree: r.causes.length + r.effects.length,
        causesCount: r.causes.length,
        causedByCount: r.effects.length,
        kriCount: r._count.kris,
        lossEventCount: r._count.lossEvents,
      };
    });

    const byCategory: Record<string, { total: number; high: number; beyondTolerance: number }> = {};
    for (const r of enriched) {
      const c = (byCategory[r.category] ||= { total: 0, high: 0, beyondTolerance: 0 });
      c.total++;
      if (r.residualRating === 'High') c.high++;
      if (r.appetiteBand === 'BeyondTolerance') c.beyondTolerance++;
    }

    res.json({
      status: 'success',
      scope: scope.kind,
      count: enriched.length,
      categories: CATEGORIES,
      /// The scale these ratings were produced on, so the UI can show the
      /// anchor text behind a level rather than a bare number.
      criteria,
      directions: RISK_DIRECTIONS,
      treatmentsByDirection: {
        Threat: THREAT_TREATMENTS,
        Opportunity: OPPORTUNITY_TREATMENTS,
      },
      totals: {
        total: enriched.length,
        open: enriched.filter((r) => r.status === 'Open').length,
        underTreatment: enriched.filter((r) => r.status === 'UnderTreatment').length,
        accepted: enriched.filter((r) => r.status === 'Accepted').length,
        highResidual: enriched.filter((r) => r.residualRating === 'High').length,
        overdueTreatments: enriched.reduce((a, r) => a + r.overdueTreatments, 0),
        expiredAcceptances: enriched.filter((r) => r.acceptanceExpired).length,
        beyondTolerance: enriched.filter((r) => r.appetiteBand === 'BeyondTolerance').length,
        reviewOverdue: enriched.filter((r) => r.reviewOverdue).length,
        opportunities: enriched.filter((r) => r.direction === 'Opportunity').length,
        unmitigated: enriched.filter((r) => r.linkedControls.length === 0).length,
        // How much of the register's inherent exposure the control environment
        // is actually removing. The single number a board asks for.
        mitigationRate: enriched.length > 0
          ? Math.round(
            (1 - enriched.reduce((a, r) => a + r.residualScore, 0)
              / Math.max(1, enriched.reduce((a, r) => a + r.inherentScore, 0))) * 100,
          )
          : 0,
      },
      byCategory,
      appetites: appetites.map((a) => ({
        category: a.category,
        appetiteThreshold: a.appetiteThreshold,
        toleranceThreshold: a.toleranceThreshold,
        statement: a.statement,
      })),
      risks: enriched,
    });
  } catch (error: any) {
    console.error('[Risk List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list risks' });
  }
};

// ─── Create (mandatory duplicate-search per TRD §7.2) ──────────────────────

export const createRisk = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      title, description, category, likelihood, impact, treatmentType, ownerId, force,
      direction, identifiedVia, identifiedSource, reviewCadenceMonths,
      horizonStart, horizonEnd, auditableEntityIds,
    } = req.body || {};
    if (!title || !description || !likelihood || !impact) {
      res.status(400).json({ status: 'error', message: 'title, description, likelihood and impact are required' });
      return;
    }

    // ISO 31000 treats risk as the effect of uncertainty in either direction,
    // and the treatment vocabulary differs by direction: you mitigate a threat
    // and exploit an opportunity. Mixing them produces nonsense like an
    // "Avoided opportunity".
    const dir = RISK_DIRECTIONS.includes(direction) ? direction : 'Threat';
    const allowedTreatments = treatmentsFor(dir);
    if (treatmentType && !allowedTreatments.includes(treatmentType)) {
      res.status(400).json({
        status: 'error',
        code: 'TREATMENT_DIRECTION_MISMATCH',
        message: `For a ${dir.toLowerCase()}, treatmentType must be one of: ${allowedTreatments.join(', ')}.`,
      });
      return;
    }

    const tenantId = req.user!.tenantId;

    // Duplicate search is mandatory before create; `force: true` acknowledges it.
    if (!force) {
      const words = String(title).toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (words.length > 0) {
        const candidates = await prisma.risk.findMany({
          where: { tenantId, OR: words.map((w) => ({ title: { contains: w } })) },
          select: { id: true, ref: true, title: true, status: true, residualScore: true },
          take: 5,
        });
        if (candidates.length > 0) {
          res.status(409).json({
            status: 'error',
            code: 'POSSIBLE_DUPLICATES',
            message: 'Similar risks already exist. Review them, then resubmit with force=true to create anyway.',
            candidates,
          });
          return;
        }
      }
    }

    const { l, i, score } = scoreOf(Number(likelihood), Number(impact));
    const ref = await nextRef(tenantId);

    const risk = await prisma.$transaction(async (tx) => {
      const created = await tx.risk.create({
        data: {
          tenantId,
          ref,
          title: String(title).trim(),
          description: String(description).trim(),
          category: CATEGORIES.includes(category) ? category : 'Operational',
          direction: dir,
          ownerId: ownerId || req.user!.id,
          treatmentType: treatmentType || (dir === 'Opportunity' ? 'Enhance' : 'Mitigate'),
          identifiedVia: identifiedVia || 'Workshop',
          identifiedSource: identifiedSource || null,
          reviewCadenceMonths: Number(reviewCadenceMonths) || 6,
          nextReviewDate: nextReviewFrom(Number(reviewCadenceMonths) || 6),
          horizonStart: horizonStart ? new Date(horizonStart) : null,
          horizonEnd: horizonEnd ? new Date(horizonEnd) : null,
          inherentLikelihood: l,
          inherentImpact: i,
          inherentScore: score,
          // No links yet, so residual starts equal to inherent.
          residualLikelihood: l,
          residualImpact: i,
          residualScore: score,
        },
      });
      await tx.riskScoreSnapshot.create({
        data: {
          tenantId, riskId: created.id, score,
          inherentScore: score, residualScore: score, reason: 'Created',
        },
      });

      // Place the risk in the audit universe at birth. This is the join that
      // lets the annual plan be driven by the register rather than by a
      // parallel set of hand-typed factors.
      const entityIds: string[] = Array.isArray(auditableEntityIds) ? auditableEntityIds : [];
      if (entityIds.length > 0) {
        const owned = await tx.auditableEntity.findMany({
          where: { id: { in: entityIds }, tenantId },
          select: { id: true },
        });
        for (const e of owned) {
          await tx.riskEntityLink.create({
            data: { riskId: created.id, auditableEntityId: e.id },
          });
        }
      }

      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'RISK_CREATED',
        subjectType: SUBJ_RISK, subjectId: created.id,
        payload: {
          ref, title, likelihood: l, impact: i, score,
          direction: dir, identifiedVia: identifiedVia || 'Workshop',
          entitiesLinked: entityIds.length,
        },
      });
      return created;
    });

    res.status(201).json({ status: 'success', risk });
  } catch (error: any) {
    console.error('[Risk Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create risk' });
  }
};

// ─── Update (re-scores; residual recomputed) ───────────────────────────────

export const updateRisk = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const risk = await prisma.risk.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!risk) { res.status(404).json({ status: 'error', message: 'Risk not found' }); return; }

    const { title, description, category, likelihood, impact, treatmentType, ownerId, status } = req.body || {};
    const data: any = {};
    if (title) data.title = title;
    if (description) data.description = description;
    if (category && CATEGORIES.includes(category)) data.category = category;
    if (ownerId) data.ownerId = ownerId;
    if (treatmentType) {
      if (!TREATMENTS.includes(treatmentType)) {
        res.status(400).json({ status: 'error', message: `treatmentType must be one of: ${TREATMENTS.join(', ')}` });
        return;
      }
      data.treatmentType = treatmentType;
    }
    if (status) {
      // The lifecycle is declared in services/riskLifecycle, the same way the
      // audit domain declares its own. Previously only the target value was
      // checked, so any status could follow any other.
      const illegal = checkRiskTransition(risk.status, status);
      if (illegal) {
        res.status(409).json({
          status: 'error',
          code: 'ILLEGAL_RISK_TRANSITION',
          message: illegal,
          currentStatus: risk.status,
          allowedNext: allowedNextRiskStatuses(risk.status),
        });
        return;
      }
      data.status = status;
    }

    let scoresChanged = false;
    if (likelihood || impact) {
      const { l, i, score } = scoreOf(Number(likelihood ?? risk.inherentLikelihood), Number(impact ?? risk.inherentImpact));
      const residual = await computeResidual(prisma, id, l, i);
      Object.assign(data, {
        inherentLikelihood: l, inherentImpact: i, inherentScore: score, ...residual,
      });
      scoresChanged = true;
      // Rescoring a risk is a review of it. Recording that here is what keeps
      // the review clock honest without asking for a second action.
      data.lastReviewedAt = new Date();
      data.nextReviewDate = nextReviewFrom(risk.reviewCadenceMonths);
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.risk.update({ where: { id }, data });
      if (scoresChanged) {
        await tx.riskScoreSnapshot.create({
          data: {
            tenantId: risk.tenantId, riskId: id, score: u.residualScore,
            inherentScore: u.inherentScore, residualScore: u.residualScore,
            reason: 'Rescored',
          },
        });
      }
      await writeAudit(tx, {
        tenantId: risk.tenantId, actorId: req.user!.id, action: 'RISK_UPDATED',
        subjectType: SUBJ_RISK, subjectId: id,
        payload: { before: { status: risk.status, residualScore: risk.residualScore }, after: data },
      });
      return u;
    });

    res.json({ status: 'success', risk: updated });
  } catch (error: any) {
    console.error('[Risk Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update risk' });
  }
};

// ─── Link controls → recompute residual ────────────────────────────────────

export const setRiskControls = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { implementationIds } = req.body || {};
    if (!Array.isArray(implementationIds)) {
      res.status(400).json({ status: 'error', message: 'implementationIds[] is required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const risk = await prisma.risk.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!risk) { res.status(404).json({ status: 'error', message: 'Risk not found' }); return; }

    const valid = await prisma.controlImplementation.findMany({
      where: { id: { in: implementationIds }, tenantId: risk.tenantId },
      select: { id: true },
    });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.riskControlLink.deleteMany({ where: { riskId: id } });
      for (const v of valid) {
        await tx.riskControlLink.create({ data: { riskId: id, implementationId: v.id } });
      }
      const residual = await computeResidual(tx, id, risk.inherentLikelihood, risk.inherentImpact);
      const u = await tx.risk.update({ where: { id }, data: residual });
      await tx.riskScoreSnapshot.create({
        data: {
          tenantId: risk.tenantId, riskId: id, score: u.residualScore,
          inherentScore: u.inherentScore, residualScore: u.residualScore,
          reason: 'ControlsRelinked',
        },
      });
      await writeAudit(tx, {
        tenantId: risk.tenantId, actorId: req.user!.id, action: 'RISK_CONTROLS_LINKED',
        subjectType: SUBJ_RISK, subjectId: id,
        payload: { linked: valid.length, residualScore: u.residualScore },
      });
      return u;
    });

    res.json({
      status: 'success',
      message: `${valid.length} control(s) linked. Residual recomputed: ${updated.residualScore}.`,
      risk: updated,
    });
  } catch (error: any) {
    console.error('[Risk Links Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to link controls' });
  }
};

// ─── Treatment actions ─────────────────────────────────────────────────────

export const addTreatment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { title, ownerId, dueDate } = req.body || {};
    if (!title || !dueDate) {
      res.status(400).json({ status: 'error', message: 'title and dueDate are required (owner + due date per TRD §7.2)' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const risk = await prisma.risk.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!risk) { res.status(404).json({ status: 'error', message: 'Risk not found' }); return; }

    const treatment = await prisma.$transaction(async (tx) => {
      const t = await tx.riskTreatmentAction.create({
        data: { riskId: id, title: String(title).trim(), ownerId: ownerId || req.user!.id, dueDate: new Date(dueDate) },
      });
      if (risk.status === 'Open') {
        await tx.risk.update({ where: { id }, data: { status: 'UnderTreatment' } });
      }
      await writeAudit(tx, {
        tenantId: risk.tenantId, actorId: req.user!.id, action: 'RISK_TREATMENT_ADDED',
        subjectType: SUBJ_RISK, subjectId: id,
        payload: { title, dueDate },
      });
      return t;
    });

    res.status(201).json({ status: 'success', treatment });
  } catch (error: any) {
    console.error('[Treatment Add Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add treatment action' });
  }
};

export const completeTreatment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const t = await prisma.riskTreatmentAction.findFirst({
      where: { id, risk: { tenantId: { in: scope.tenantIds } } },
      include: { risk: { select: { id: true, tenantId: true } } },
    });
    if (!t) { res.status(404).json({ status: 'error', message: 'Treatment action not found' }); return; }
    if (t.status === 'Done') { res.status(409).json({ status: 'error', message: 'Already completed' }); return; }

    await prisma.$transaction(async (tx) => {
      await tx.riskTreatmentAction.update({ where: { id }, data: { status: 'Done', doneAt: new Date() } });
      await writeAudit(tx, {
        tenantId: t.risk.tenantId, actorId: req.user!.id, action: 'RISK_TREATMENT_COMPLETED',
        subjectType: SUBJ_RISK, subjectId: t.risk.id,
        payload: { treatmentId: id, title: t.title },
      });
    });

    res.json({ status: 'success', message: 'Treatment action completed' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to complete treatment' });
  }
};

// ─── Time-bound acceptance (approval record, not just a flag) ──────────────

export const acceptRisk = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { until, reason } = req.body || {};
    if (!until || !reason) {
      res.status(400).json({ status: 'error', message: 'until (date) and reason are required — acceptance must be time-bound and justified' });
      return;
    }
    const untilDate = new Date(until);
    if (isNaN(untilDate.getTime()) || untilDate.getTime() <= Date.now()) {
      res.status(400).json({ status: 'error', message: 'until must be a future date' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const risk = await prisma.risk.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!risk) { res.status(404).json({ status: 'error', message: 'Risk not found' }); return; }

    // The risk owner cannot approve acceptance of their own risk.
    if (risk.ownerId === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'The risk owner cannot approve acceptance of their own risk — a different approver is required.',
      });
      return;
    }

    // Board-set appetite is the ceiling on what may be accepted. Only an
    // approved statement binds — a draft is still just a proposal.
    const appetite = await prisma.riskAppetite.findFirst({
      where: {
        tenantId: risk.tenantId, category: risk.category,
        status: 'Approved', effectiveTo: null,
      },
      orderBy: { version: 'desc' },
    });
    const band = appetite ? evaluateAppetite(risk.residualScore, appetite) : null;
    if (band === 'BeyondTolerance') {
      res.status(409).json({
        status: 'error',
        code: 'BEYOND_RISK_TOLERANCE',
        message: `${risk.ref} has a residual score of ${risk.residualScore}, beyond the approved tolerance of ${appetite!.toleranceThreshold} for ${risk.category}. A risk this far outside appetite must be treated down, not accepted.`,
        residualScore: risk.residualScore,
        toleranceThreshold: appetite!.toleranceThreshold,
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.risk.update({
        where: { id },
        data: {
          status: 'Accepted',
          treatmentType: 'Accept',
          acceptedById: req.user!.id,
          acceptedUntil: untilDate,
          acceptanceReason: String(reason).trim(),
          // Pin the decision to the exact ceiling and score it was taken
          // against. Without this a later revision of the board's tolerance
          // silently rewrites the basis of every acceptance already on record.
          acceptedUnderAppetiteId: appetite?.id ?? null,
          acceptedAtScore: risk.residualScore,
        },
      });
      await writeAudit(tx, {
        tenantId: risk.tenantId, actorId: req.user!.id, action: 'RISK_ACCEPTED',
        subjectType: SUBJ_RISK, subjectId: id,
        payload: {
          until: untilDate, reason, residualScore: risk.residualScore, appetiteBand: band,
          judgedAgainst: appetite
            ? {
              appetiteId: appetite.id, version: appetite.version,
              appetiteThreshold: appetite.appetiteThreshold,
              toleranceThreshold: appetite.toleranceThreshold,
            }
            : null,
        },
      });
      return u;
    });

    res.json({
      status: 'success',
      message: band === 'WithinTolerance'
        ? `${risk.ref} accepted until ${untilDate.toISOString().slice(0, 10)} — note this is outside appetite but within tolerance, so the acceptance is on record.`
        : `Risk accepted until ${untilDate.toISOString().slice(0, 10)}`,
      appetiteBand: band ?? 'NoAppetiteSet',
      risk: updated,
    });
  } catch (error: any) {
    console.error('[Risk Accept Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to accept risk' });
  }
};

// ─── Link auditable entities ───────────────────────────────────────────────

export const setRiskEntities = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { auditableEntityIds, entityIds } = req.body || {};
    const ids: string[] = Array.isArray(auditableEntityIds) ? auditableEntityIds : (Array.isArray(entityIds) ? entityIds : []);

    const scope = await resolveTenantScope(req.user!.tenantId);
    const risk = await prisma.risk.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!risk) {
      res.status(404).json({ status: 'error', message: 'Risk not found' });
      return;
    }

    const validEntities = await prisma.auditableEntity.findMany({
      where: { id: { in: ids }, tenantId: risk.tenantId },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.riskEntityLink.deleteMany({ where: { riskId: id } });
      for (const e of validEntities) {
        await tx.riskEntityLink.create({
          data: { riskId: id, auditableEntityId: e.id },
        });
      }
      await writeAudit(tx, {
        tenantId: risk.tenantId,
        actorId: req.user!.id,
        action: 'RISK_ENTITIES_SET',
        subjectType: SUBJ_RISK,
        subjectId: id,
        payload: { linked: validEntities.length },
      });
    });

    res.json({
      status: 'success',
      message: `${validEntities.length} entity/entities linked to ${risk.ref}.`,
    });
  } catch (error: any) {
    console.error('[Set Risk Entities Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to set risk entities' });
  }
};

// ─── Link related risk (directed edge) ────────────────────────────────────

export const linkRelatedRisk = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const causeId = req.params.id as string;
    const { effectId, targetRiskId, nature, note } = req.body || {};
    const targetId = effectId || targetRiskId;

    if (!targetId) {
      res.status(400).json({ status: 'error', message: 'effectId or targetRiskId is required' });
      return;
    }
    if (causeId === targetId) {
      res.status(400).json({ status: 'error', message: 'A risk cannot be linked to itself' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const causeRisk = await prisma.risk.findFirst({ where: { id: causeId, tenantId: { in: scope.tenantIds } } });
    const effectRisk = await prisma.risk.findFirst({ where: { id: targetId, tenantId: { in: scope.tenantIds } } });

    if (!causeRisk || !effectRisk) {
      res.status(404).json({ status: 'error', message: 'One or both risks not found' });
      return;
    }

    const validNatures = ['Causes', 'Amplifies', 'SharesControl'];
    const linkNature = validNatures.includes(nature) ? nature : 'Causes';

    const link = await prisma.$transaction(async (tx) => {
      const l = await tx.riskLink.upsert({
        where: { causeId_effectId: { causeId, effectId: targetId } },
        create: { causeId, effectId: targetId, nature: linkNature, note: note ? String(note).trim() : null },
        update: { nature: linkNature, note: note ? String(note).trim() : null },
      });
      await writeAudit(tx, {
        tenantId: causeRisk.tenantId,
        actorId: req.user!.id,
        action: 'RISK_LINKED',
        subjectType: SUBJ_RISK,
        subjectId: causeId,
        payload: { effectId: targetId, nature: linkNature },
      });
      return l;
    });

    res.json({ status: 'success', link });
  } catch (error: any) {
    console.error('[Link Related Risk Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to link related risk' });
  }
};

// ─── Formal review of a risk ───────────────────────────────────────────────

export const reviewRisk = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { likelihood, impact, reviewCadenceMonths, notes } = req.body || {};

    const scope = await resolveTenantScope(req.user!.tenantId);
    const risk = await prisma.risk.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!risk) {
      res.status(404).json({ status: 'error', message: 'Risk not found' });
      return;
    }

    const cadence = Number(reviewCadenceMonths) || risk.reviewCadenceMonths;
    const now = new Date();
    const data: any = {
      lastReviewedAt: now,
      nextReviewDate: nextReviewFrom(cadence),
      reviewCadenceMonths: cadence,
    };

    let scoresChanged = false;
    if (likelihood || impact) {
      const { l, i, score } = scoreOf(
        Number(likelihood ?? risk.inherentLikelihood),
        Number(impact ?? risk.inherentImpact),
      );
      const residual = await computeResidual(prisma, id, l, i);
      Object.assign(data, {
        inherentLikelihood: l,
        inherentImpact: i,
        inherentScore: score,
        ...residual,
      });
      scoresChanged = true;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.risk.update({ where: { id }, data });
      if (scoresChanged) {
        await tx.riskScoreSnapshot.create({
          data: {
            tenantId: risk.tenantId,
            riskId: id,
            score: u.residualScore,
            inherentScore: u.inherentScore,
            residualScore: u.residualScore,
            reason: notes ? `Reviewed: ${String(notes).trim()}` : 'Reviewed',
          },
        });
      }
      await writeAudit(tx, {
        tenantId: risk.tenantId,
        actorId: req.user!.id,
        action: 'RISK_REVIEWED',
        subjectType: SUBJ_RISK,
        subjectId: id,
        payload: { lastReviewedAt: now, nextReviewDate: data.nextReviewDate, notes: notes || null },
      });
      return u;
    });

    res.json({
      status: 'success',
      message: `${risk.ref} reviewed successfully. Next review due on ${updated.nextReviewDate?.toISOString().slice(0, 10)}.`,
      risk: updated,
    });
  } catch (error: any) {
    console.error('[Risk Review Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to review risk' });
  }
};

// ─── Heatmap & network analytics ─────────────────────────────────────────

export const riskAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.risks.analytics');

    const risks = await prisma.risk.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        causes: { select: { effectId: true, nature: true } },
        effects: { select: { causeId: true, nature: true } },
        controlLinks: { select: { implementationId: true } },
        treatments: { select: { status: true } },
        issues: { select: { id: true, status: true } },
        _count: { select: { kris: true, lossEvents: true } },
      },
    });

    const appetites = await prisma.riskAppetite.findMany({
      where: { tenantId: { in: scope.tenantIds }, status: 'Approved' },
    });
    const appetiteByCategory = new Map(appetites.map((a) => [a.category, a]));

    /**
     * A grid cell carries the refs, not just a count — a heatmap you cannot
     * drill into is a picture, not an instrument. Index [likelihood-1][impact-1].
     */
    const emptyGrid = () =>
      Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ count: 0, refs: [] as string[] })));

    const inherent = emptyGrid();
    const residual = emptyGrid();
    const opportunity = emptyGrid();

    /** Where each risk moved from and to, so the mitigation effect is visible. */
    const migration: {
      ref: string; title: string; direction: string;
      from: { l: number; i: number; score: number };
      to: { l: number; i: number; score: number };
      delta: number; band: string;
    }[] = [];

    const clamp = (n: number) => Math.min(5, Math.max(1, n));

    for (const r of risks) {
      const iL = clamp(r.inherentLikelihood), iI = clamp(r.inherentImpact);
      const rL = clamp(r.residualLikelihood), rI = clamp(r.residualImpact);

      const target = r.direction === 'Opportunity' ? opportunity : residual;
      inherent[iL - 1][iI - 1].count++;
      inherent[iL - 1][iI - 1].refs.push(r.ref);
      target[rL - 1][rI - 1].count++;
      target[rL - 1][rI - 1].refs.push(r.ref);

      const appetite = appetiteByCategory.get(r.category);
      migration.push({
        ref: r.ref, title: r.title, direction: r.direction,
        from: { l: iL, i: iI, score: r.inherentScore },
        to: { l: rL, i: rI, score: r.residualScore },
        delta: r.inherentScore - r.residualScore,
        band: appetite ? evaluateAppetite(r.residualScore, appetite) : 'NoAppetiteSet',
      });
    }

    /**
     * The appetite overlay: for each category, which of the 25 cells are within
     * appetite, within tolerance, or beyond it. This is the view that answers
     * "where is the board's line drawn?" rather than "where are the risks?".
     */
    const appetiteGrids = appetites.map((a) => ({
      category: a.category,
      statement: a.statement,
      appetiteThreshold: a.appetiteThreshold,
      toleranceThreshold: a.toleranceThreshold,
      grid: Array.from({ length: 5 }, (_, li) =>
        Array.from({ length: 5 }, (_, ii) => evaluateAppetite((li + 1) * (ii + 1), a))),
      // Risks of this category placed on that grid.
      placed: risks
        .filter((r) => r.category === a.category)
        .map((r) => ({
          ref: r.ref, l: clamp(r.residualLikelihood), i: clamp(r.residualImpact),
          score: r.residualScore, band: evaluateAppetite(r.residualScore, a),
        })),
    }));

    // ── Control coverage: how well is each category actually defended? ──────
    const implIds = [...new Set(risks.flatMap((r) => r.controlLinks.map((l) => l.implementationId)))];
    const impls = implIds.length
      ? await prisma.controlImplementation.findMany({
        where: { id: { in: implIds } },
        select: { id: true, status: true, effectiveness: true },
      })
      : [];
    const implById = new Map(impls.map((i) => [i.id, i]));

    const coverage: Record<string, {
      risks: number; unmitigated: number; effective: number;
      partial: number; ineffective: number; unverified: number;
      inherentTotal: number; residualTotal: number; mitigationRate: number;
    }> = {};

    for (const r of risks) {
      const c = (coverage[r.category] ||= {
        risks: 0, unmitigated: 0, effective: 0, partial: 0, ineffective: 0,
        unverified: 0, inherentTotal: 0, residualTotal: 0, mitigationRate: 0,
      });
      c.risks++;
      c.inherentTotal += r.inherentScore;
      c.residualTotal += r.residualScore;
      if (r.controlLinks.length === 0) c.unmitigated++;
      for (const link of r.controlLinks) {
        const impl = implById.get(link.implementationId);
        if (!impl) continue;
        if (impl.status !== 'Verified') c.unverified++;
        else if (impl.effectiveness === 'Effective') c.effective++;
        else if (impl.effectiveness === 'PartiallyEffective') c.partial++;
        else if (impl.effectiveness === 'Ineffective') c.ineffective++;
        else c.unverified++;
      }
    }
    for (const c of Object.values(coverage)) {
      c.mitigationRate = c.inherentTotal > 0
        ? Math.round((1 - c.residualTotal / c.inherentTotal) * 100)
        : 0;
    }

    // ── The risk network: which risks concentrate exposure ─────────────────
    const byId = new Map(risks.map((r) => [r.id, r]));
    const connectedRisks = risks
      .map((r) => ({
        id: r.id, ref: r.ref, title: r.title, category: r.category,
        residualScore: r.residualScore,
        degree: r.causes.length + r.effects.length,
        causesCount: r.causes.length,
        causedByCount: r.effects.length,
        /// Flat likelihood x impact cannot see that a medium risk sitting
        /// upstream of four others carries more exposure than its own score.
        networkScore: Number(
          (r.residualScore * (1 + 0.25 * (r.causes.length + r.effects.length))).toFixed(1),
        ),
        causes: r.causes.map((c) => byId.get(c.effectId)?.ref).filter(Boolean),
        causedBy: r.effects.map((e) => byId.get(e.causeId)?.ref).filter(Boolean),
      }))
      .filter((r) => r.degree > 0)
      .sort((a, b) => b.networkScore - a.networkScore)
      .slice(0, 12);

    const now = Date.now();
    res.json({
      status: 'success',
      totalRisks: risks.length,
      /// Grids are [likelihood-1][impact-1] and each cell is { count, refs }.
      inherent,
      residual,
      opportunity,
      migration: migration.sort((a, b) => b.delta - a.delta),
      appetiteGrids,
      coverage,
      connectedRisks,
      totals: {
        mitigationRate: (() => {
          const inh = risks.reduce((a, r) => a + r.inherentScore, 0);
          const res2 = risks.reduce((a, r) => a + r.residualScore, 0);
          return inh > 0 ? Math.round((1 - res2 / inh) * 100) : 0;
        })(),
        unmitigated: risks.filter((r) => r.controlLinks.length === 0).length,
        beyondTolerance: migration.filter((m) => m.band === 'BeyondTolerance').length,
        reviewOverdue: risks.filter(
          (r) => r.nextReviewDate && r.nextReviewDate.getTime() < now && r.status !== 'Closed',
        ).length,
        opportunities: risks.filter((r) => r.direction === 'Opportunity').length,
        networked: risks.filter((r) => r.causes.length + r.effects.length > 0).length,
      },
    });
  } catch (error: any) {
    console.error('[Risk Analytics Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch risk analytics' });
  }
};
