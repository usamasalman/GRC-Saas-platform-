import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';

const SUBJ_RISK = 'Risk';
const TREATMENTS = ['Accept', 'Mitigate', 'Transfer', 'Avoid'];
const CATEGORIES = ['Strategic', 'Operational', 'Financial', 'Compliance', 'Technology', 'Third-Party', 'People'];

/** 5×5 platform default; rating bands derived from the product L×I. */
export function scoreOf(likelihood: number, impact: number) {
  const l = Math.min(5, Math.max(1, Math.round(likelihood)));
  const i = Math.min(5, Math.max(1, Math.round(impact)));
  const score = l * i;
  const rating = score >= 15 ? 'High' : score >= 8 ? 'Medium' : 'Low';
  return { l, i, score, rating };
}

/**
 * Residual is derived from linked-control effectiveness (TRD §7.2), never
 * client-supplied: each linked Effective control reduces likelihood by 2,
 * PartiallyEffective by 1, capped so residual never drops below 1.
 */
async function computeResidual(riskId: string, inherentL: number, inherentI: number) {
  const links = await prisma.riskControlLink.findMany({
    where: { riskId },
    include: { implementation: { select: { effectiveness: true, status: true } } },
  });
  let reduction = 0;
  for (const link of links) {
    if (link.implementation.status !== 'Verified') continue;
    if (link.implementation.effectiveness === 'Effective') reduction += 2;
    else if (link.implementation.effectiveness === 'PartiallyEffective') reduction += 1;
  }
  const residualL = Math.max(1, inherentL - Math.min(reduction, 3));
  const { score } = scoreOf(residualL, inherentI);
  return { residualLikelihood: residualL, residualImpact: inherentI, residualScore: score };
}

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
      },
      orderBy: [{ residualScore: 'desc' }],
      take: 500,
    });

    const now = Date.now();
    const enriched = risks.map((r) => ({
      ...r,
      inherentRating: scoreOf(r.inherentLikelihood, r.inherentImpact).rating,
      residualRating: scoreOf(r.residualLikelihood, r.residualImpact).rating,
      linkedControls: r.controlLinks.map((l) => l.implementation.control.code),
      openTreatments: r.treatments.filter((t) => t.status === 'Open').length,
      overdueTreatments: r.treatments.filter((t) => t.status === 'Open' && t.dueDate && t.dueDate.getTime() < now).length,
      acceptanceExpired: r.status === 'Accepted' && !!r.acceptedUntil && r.acceptedUntil.getTime() < now,
    }));

    res.json({
      status: 'success',
      scope: scope.kind,
      count: enriched.length,
      categories: CATEGORIES,
      totals: {
        total: enriched.length,
        open: enriched.filter((r) => r.status === 'Open').length,
        underTreatment: enriched.filter((r) => r.status === 'UnderTreatment').length,
        accepted: enriched.filter((r) => r.status === 'Accepted').length,
        highResidual: enriched.filter((r) => r.residualRating === 'High').length,
        overdueTreatments: enriched.reduce((a, r) => a + r.overdueTreatments, 0),
        expiredAcceptances: enriched.filter((r) => r.acceptanceExpired).length,
      },
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
    const { title, description, category, likelihood, impact, treatmentType, ownerId, force } = req.body || {};
    if (!title || !description || !likelihood || !impact) {
      res.status(400).json({ status: 'error', message: 'title, description, likelihood and impact are required' });
      return;
    }
    if (treatmentType && !TREATMENTS.includes(treatmentType)) {
      res.status(400).json({ status: 'error', message: `treatmentType must be one of: ${TREATMENTS.join(', ')}` });
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
          ownerId: ownerId || req.user!.id,
          treatmentType: treatmentType || 'Mitigate',
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
        data: { tenantId, riskId: created.id, score, inherentScore: score, residualScore: score },
      });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'RISK_CREATED',
        subjectType: SUBJ_RISK, subjectId: created.id,
        payload: { ref, title, likelihood: l, impact: i, score },
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
      if (!['Open', 'UnderTreatment', 'Closed'].includes(status)) {
        res.status(400).json({ status: 'error', message: 'status must be Open, UnderTreatment or Closed. Accepted is set via /accept.' });
        return;
      }
      data.status = status;
    }

    let scoresChanged = false;
    if (likelihood || impact) {
      const { l, i, score } = scoreOf(Number(likelihood ?? risk.inherentLikelihood), Number(impact ?? risk.inherentImpact));
      const residual = await computeResidual(id, l, i);
      Object.assign(data, {
        inherentLikelihood: l, inherentImpact: i, inherentScore: score, ...residual,
      });
      scoresChanged = true;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.risk.update({ where: { id }, data });
      if (scoresChanged) {
        await tx.riskScoreSnapshot.create({
          data: { tenantId: risk.tenantId, riskId: id, score: u.residualScore, inherentScore: u.inherentScore, residualScore: u.residualScore },
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
      const residual = await computeResidual(id, risk.inherentLikelihood, risk.inherentImpact);
      const u = await tx.risk.update({ where: { id }, data: residual });
      await tx.riskScoreSnapshot.create({
        data: { tenantId: risk.tenantId, riskId: id, score: u.residualScore, inherentScore: u.inherentScore, residualScore: u.residualScore },
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
        payload: { until: untilDate, reason, residualScore: risk.residualScore },
      });
      return u;
    });

    res.json({ status: 'success', message: `Risk accepted until ${untilDate.toISOString().slice(0, 10)}`, risk: updated });
  } catch (error: any) {
    console.error('[Risk Accept Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to accept risk' });
  }
};
