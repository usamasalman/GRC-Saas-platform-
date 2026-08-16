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

const SUBJ_RISK = 'Risk';
const TREATMENTS = [...THREAT_TREATMENTS, ...OPPORTUNITY_TREATMENTS];
const CATEGORIES = ['Strategic', 'Operational', 'Financial', 'Compliance', 'Technology', 'Third-Party', 'People'];

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

    // Board-set appetite is per category, so one lookup covers the whole page
    // and every risk can be banded without an N+1.
    const appetites = await prisma.riskAppetite.findMany({
      where: { tenantId: { in: scope.tenantIds }, status: 'Approved' },
    });
    const appetiteByCategory = new Map(appetites.map((a) => [a.category, a]));

    const now = Date.now();
    const enriched = risks.map((r) => {
      const appetite = appetiteByCategory.get(r.category);
      const openIssues = r.issues.filter((i) => i.status !== 'Closed');
      return {
        ...r,
        inherentRating: ratingOf(r.inherentScore),
        residualRating: ratingOf(r.residualScore),
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
      where: { tenantId: risk.tenantId, category: risk.category, status: 'Approved' },
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
        },
      });
      await writeAudit(tx, {
        tenantId: risk.tenantId, actorId: req.user!.id, action: 'RISK_ACCEPTED',
        subjectType: SUBJ_RISK, subjectId: id,
        payload: { until: untilDate, reason, residualScore: risk.residualScore, appetiteBand: band },
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

    const inherentHeatmap = Array.from({ length: 5 }, () => Array(5).fill(0));
    const residualHeatmap = Array.from({ length: 5 }, () => Array(5).fill(0));

    for (const r of risks) {
      const lInh = Math.min(5, Math.max(1, r.inherentLikelihood)) - 1;
      const iInh = Math.min(5, Math.max(1, r.inherentImpact)) - 1;
      inherentHeatmap[lInh][iInh]++;

      const lRes = Math.min(5, Math.max(1, r.residualLikelihood)) - 1;
      const iRes = Math.min(5, Math.max(1, r.residualImpact)) - 1;
      residualHeatmap[lRes][iRes]++;
    }

    const connectedRisks = risks
      .map((r) => ({
        id: r.id,
        ref: r.ref,
        title: r.title,
        residualScore: r.residualScore,
        degree: r.causes.length + r.effects.length,
        causesCount: r.causes.length,
        causedByCount: r.effects.length,
      }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 10);

    res.json({
      status: 'success',
      totalRisks: risks.length,
      inherentHeatmap,
      residualHeatmap,
      connectedRisks,
    });
  } catch (error: any) {
    console.error('[Risk Analytics Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch risk analytics' });
  }
};
