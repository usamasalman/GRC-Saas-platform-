import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import {
  computeEntityRisk, suggestedBudgetHours,
  FACTOR_WEIGHTS, FACTOR_LABELS, RiskFactors,
} from '../services/auditRiskScoring';

const SUBJ_ENTITY = 'AuditableEntity';
const SUBJ_PLAN = 'AuditPlan';

const ENTITY_TYPES = ['Process', 'BusinessUnit', 'System', 'ThirdParty', 'LegalEntity'];
const FACTOR_KEYS = Object.keys(FACTOR_WEIGHTS) as (keyof RiskFactors)[];

function pickFactors(src: any, fallback?: any): RiskFactors {
  const out: any = {};
  for (const k of FACTOR_KEYS) {
    out[k] = src?.[k] !== undefined ? Number(src[k]) : (fallback?.[k] ?? 3);
  }
  return out as RiskFactors;
}

// ─── Audit universe ────────────────────────────────────────────────────────

export const listUniverse = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'audit.universe.list');

    const { type, tier, search } = req.query as Record<string, string | undefined>;
    const where: any = { tenantId: { in: scope.tenantIds }, isActive: true };
    if (type) where.type = type;
    if (tier) where.riskTier = tier;
    if (search) {
      where.OR = [{ name: { contains: search } }, { ref: { contains: search } }];
    }

    const entities = await prisma.auditableEntity.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
        planItems: {
          include: { plan: { select: { year: true, status: true } } },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
      orderBy: [{ riskScore: 'desc' }, { name: 'asc' }],
      take: 500,
    });

    const enriched = entities.map((e) => {
      const calc = computeEntityRisk(pickFactors(e), e.lastAuditedAt, e.auditCycleMonths);
      return {
        id: e.id, ref: e.ref, name: e.name, type: e.type, description: e.description,
        tenantId: e.tenantId, tenantName: e.tenant.name,
        parentName: e.parent?.name || null,
        owner: e.owner,
        factors: pickFactors(e),
        riskScore: e.riskScore,
        riskTier: e.riskTier,
        lastAuditedAt: e.lastAuditedAt,
        auditCycleMonths: e.auditCycleMonths,
        monthsSinceAudit: calc.monthsSinceAudit,
        coverageUplift: calc.coverageUplift,
        neverAudited: !e.lastAuditedAt,
        isOverdue: calc.monthsSinceAudit !== null && calc.monthsSinceAudit > e.auditCycleMonths,
        suggestedHours: suggestedBudgetHours(e.riskTier),
        inCurrentPlan: e.planItems.some((p) => ['Approved', 'Active'].includes(p.plan.status)),
      };
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      count: enriched.length,
      weights: FACTOR_WEIGHTS,
      factorLabels: FACTOR_LABELS,
      entityTypes: ENTITY_TYPES,
      totals: {
        total: enriched.length,
        high: enriched.filter((e) => e.riskTier === 'High').length,
        medium: enriched.filter((e) => e.riskTier === 'Medium').length,
        low: enriched.filter((e) => e.riskTier === 'Low').length,
        neverAudited: enriched.filter((e) => e.neverAudited).length,
        overdue: enriched.filter((e) => e.isOverdue).length,
        inPlan: enriched.filter((e) => e.inCurrentPlan).length,
      },
      entities: enriched,
    });
  } catch (error: any) {
    console.error('[Universe List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list the audit universe' });
  }
};

export const createEntity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, type, description, ownerId, parentId, auditCycleMonths, lastAuditedAt } = req.body || {};
    if (!name) { res.status(400).json({ status: 'error', message: 'name is required' }); return; }
    if (type && !ENTITY_TYPES.includes(type)) {
      res.status(400).json({ status: 'error', message: `type must be one of: ${ENTITY_TYPES.join(', ')}` });
      return;
    }

    const tenantId = req.user!.tenantId;
    const count = await prisma.auditableEntity.count({ where: { tenantId } });
    const ref = `AE-${String(count + 1).padStart(3, '0')}`;

    const factors = pickFactors(req.body);
    const last = lastAuditedAt ? new Date(lastAuditedAt) : null;
    const cycle = Number(auditCycleMonths) || 24;
    const calc = computeEntityRisk(factors, last, cycle);

    const entity = await prisma.$transaction(async (tx) => {
      const created = await tx.auditableEntity.create({
        data: {
          tenantId, ref,
          name: String(name).trim(),
          type: type || 'Process',
          description: description || null,
          ownerId: ownerId || null,
          parentId: parentId || null,
          ...factors,
          riskScore: calc.riskScore,
          riskTier: calc.riskTier,
          lastAuditedAt: last,
          auditCycleMonths: cycle,
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'AUDIT_ENTITY_CREATED',
        subjectType: SUBJ_ENTITY, subjectId: created.id,
        payload: { ref, name, type: type || 'Process', riskScore: calc.riskScore, riskTier: calc.riskTier },
      });
      return created;
    });

    res.status(201).json({ status: 'success', entity, scoring: calc });
  } catch (error: any) {
    console.error('[Create Entity Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create auditable entity' });
  }
};

/** Re-score an entity. Risk score is always recomputed, never accepted raw. */
export const scoreEntity = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const entity = await prisma.auditableEntity.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!entity) { res.status(404).json({ status: 'error', message: 'Auditable entity not found' }); return; }

    const factors = pickFactors(req.body, entity);
    const last = req.body.lastAuditedAt !== undefined
      ? (req.body.lastAuditedAt ? new Date(req.body.lastAuditedAt) : null)
      : entity.lastAuditedAt;
    const cycle = Number(req.body.auditCycleMonths) || entity.auditCycleMonths;
    const calc = computeEntityRisk(factors, last, cycle);

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.auditableEntity.update({
        where: { id },
        data: {
          ...factors,
          riskScore: calc.riskScore,
          riskTier: calc.riskTier,
          lastAuditedAt: last,
          auditCycleMonths: cycle,
          ...(req.body.name ? { name: String(req.body.name).trim() } : {}),
          ...(req.body.ownerId !== undefined ? { ownerId: req.body.ownerId || null } : {}),
        },
      });
      await writeAudit(tx, {
        tenantId: entity.tenantId, actorId: req.user!.id, action: 'AUDIT_ENTITY_SCORED',
        subjectType: SUBJ_ENTITY, subjectId: id,
        payload: {
          before: { riskScore: entity.riskScore, riskTier: entity.riskTier },
          after: { riskScore: calc.riskScore, riskTier: calc.riskTier },
          factors,
        },
      });
      return u;
    });

    res.json({ status: 'success', entity: updated, scoring: calc });
  } catch (error: any) {
    console.error('[Score Entity Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to score entity' });
  }
};

// ─── Annual plan ───────────────────────────────────────────────────────────

export const listPlans = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const plans = await prisma.auditPlan.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        preparedBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
        items: {
          include: {
            auditableEntity: { select: { id: true, ref: true, name: true, riskTier: true, riskScore: true } },
            assignedLead: { select: { id: true, name: true } },
            audit: { select: { id: true, ref: true, status: true } },
          },
          orderBy: [{ plannedQuarter: 'asc' }],
        },
      },
      orderBy: { year: 'desc' },
    });

    const enriched = plans.map((p) => {
      const allocated = p.items.reduce((a, i) => a + i.budgetHours, 0);
      return {
        ...p,
        allocatedHours: allocated,
        remainingHours: p.totalBudgetHours - allocated,
        utilisation: p.totalBudgetHours > 0 ? Math.round((allocated / p.totalBudgetHours) * 100) : 0,
        itemCounts: {
          total: p.items.length,
          instantiated: p.items.filter((i) => i.audit).length,
          completed: p.items.filter((i) => i.status === 'Completed').length,
          deferred: p.items.filter((i) => i.status === 'Deferred').length,
          highRisk: p.items.filter((i) => i.auditableEntity.riskTier === 'High').length,
        },
      };
    });

    res.json({ status: 'success', scope: scope.kind, count: enriched.length, plans: enriched });
  } catch (error: any) {
    console.error('[Plan List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list audit plans' });
  }
};

export const createPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { year, title, totalBudgetHours } = req.body || {};
    const planYear = Number(year) || new Date().getFullYear();
    const tenantId = req.user!.tenantId;

    const existing = await prisma.auditPlan.findFirst({ where: { tenantId, year: planYear } });
    if (existing) {
      res.status(409).json({ status: 'error', message: `An audit plan for ${planYear} already exists` });
      return;
    }

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.auditPlan.create({
        data: {
          tenantId,
          year: planYear,
          title: title || `${planYear} Internal Audit Plan`,
          totalBudgetHours: Number(totalBudgetHours) || 1000,
          preparedById: req.user!.id,
          status: 'Draft',
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'AUDIT_PLAN_CREATED',
        subjectType: SUBJ_PLAN, subjectId: created.id,
        payload: { year: planYear, totalBudgetHours: created.totalBudgetHours },
      });
      return created;
    });

    res.status(201).json({ status: 'success', plan });
  } catch (error: any) {
    console.error('[Create Plan Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create audit plan' });
  }
};

/** Add an entity from the universe to the plan, with its risk rationale. */
export const addPlanItem = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const planId = req.params.id as string;
    const { auditableEntityId, plannedQuarter, budgetHours, rationale, assignedLeadId } = req.body || {};
    if (!auditableEntityId) {
      res.status(400).json({ status: 'error', message: 'auditableEntityId is required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const plan = await prisma.auditPlan.findFirst({ where: { id: planId, tenantId: { in: scope.tenantIds } } });
    if (!plan) { res.status(404).json({ status: 'error', message: 'Audit plan not found' }); return; }
    if (!['Draft', 'SubmittedForApproval'].includes(plan.status)) {
      res.status(409).json({
        status: 'error',
        message: `Plan is ${plan.status} — an approved plan cannot be silently changed. Defer an item or create an amendment instead.`,
      });
      return;
    }

    const entity = await prisma.auditableEntity.findFirst({
      where: { id: auditableEntityId, tenantId: { in: scope.tenantIds } },
    });
    if (!entity) { res.status(400).json({ status: 'error', message: 'Auditable entity not found in your scope' }); return; }

    const dup = await prisma.auditPlanItem.findFirst({ where: { planId, auditableEntityId } });
    if (dup) {
      res.status(409).json({ status: 'error', message: `${entity.name} is already in this plan` });
      return;
    }

    const hours = Number(budgetHours) || suggestedBudgetHours(entity.riskTier);

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.auditPlanItem.create({
        data: {
          planId,
          auditableEntityId,
          plannedQuarter: Math.min(4, Math.max(1, Number(plannedQuarter) || 1)),
          budgetHours: hours,
          rationale: rationale || `Risk tier ${entity.riskTier} (score ${entity.riskScore}).`,
          assignedLeadId: assignedLeadId || null,
          status: 'Planned',
        },
      });
      await writeAudit(tx, {
        tenantId: plan.tenantId, actorId: req.user!.id, action: 'AUDIT_PLAN_ITEM_ADDED',
        subjectType: SUBJ_PLAN, subjectId: planId,
        payload: { entity: entity.name, riskTier: entity.riskTier, budgetHours: hours },
      });
      return created;
    });

    res.status(201).json({ status: 'success', item });
  } catch (error: any) {
    console.error('[Add Plan Item Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add plan item' });
  }
};

export const submitPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const plan = await prisma.auditPlan.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { items: { include: { auditableEntity: { select: { riskTier: true } } } } },
    });
    if (!plan) { res.status(404).json({ status: 'error', message: 'Audit plan not found' }); return; }
    if (plan.status !== 'Draft') {
      res.status(409).json({ status: 'error', message: `Plan is already ${plan.status}` });
      return;
    }
    if (plan.items.length === 0) {
      res.status(409).json({ status: 'error', message: 'Add at least one engagement before submitting the plan' });
      return;
    }

    // A risk-based plan that omits every high-risk entity is not defensible.
    const highInUniverse = await prisma.auditableEntity.count({
      where: { tenantId: plan.tenantId, isActive: true, riskTier: 'High' },
    });
    const highInPlan = plan.items.filter((i) => i.auditableEntity.riskTier === 'High').length;
    if (highInUniverse > 0 && highInPlan === 0) {
      res.status(409).json({
        status: 'error',
        code: 'NO_HIGH_RISK_COVERAGE',
        message: `The universe has ${highInUniverse} high-risk entities but the plan covers none. A risk-based plan must justify that.`,
      });
      return;
    }

    const allocated = plan.items.reduce((a, i) => a + i.budgetHours, 0);
    if (allocated > plan.totalBudgetHours) {
      res.status(409).json({
        status: 'error',
        message: `Allocated ${allocated}h exceeds available capacity of ${plan.totalBudgetHours}h.`,
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.auditPlan.update({
        where: { id },
        data: { status: 'SubmittedForApproval', submittedAt: new Date() },
      });
      await writeAudit(tx, {
        tenantId: plan.tenantId, actorId: req.user!.id, action: 'AUDIT_PLAN_SUBMITTED',
        subjectType: SUBJ_PLAN, subjectId: id,
        payload: { items: plan.items.length, allocatedHours: allocated, highRiskCovered: highInPlan },
      });
      return u;
    });

    res.json({ status: 'success', message: 'Plan submitted for audit committee approval', plan: updated });
  } catch (error: any) {
    console.error('[Submit Plan Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to submit plan' });
  }
};

/** Committee approval. The preparer cannot approve their own plan. */
export const approvePlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { note } = req.body || {};
    const scope = await resolveTenantScope(req.user!.tenantId);
    const plan = await prisma.auditPlan.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!plan) { res.status(404).json({ status: 'error', message: 'Audit plan not found' }); return; }
    if (plan.status !== 'SubmittedForApproval') {
      res.status(409).json({ status: 'error', message: `Plan is ${plan.status} — only a submitted plan can be approved` });
      return;
    }
    if (plan.preparedById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'The preparer of the plan cannot approve it. Audit committee approval must be independent.',
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.auditPlan.update({
        where: { id },
        data: {
          status: 'Approved',
          approvedById: req.user!.id,
          approvedAt: new Date(),
          approvalNote: note || null,
        },
      });
      await writeAudit(tx, {
        tenantId: plan.tenantId, actorId: req.user!.id, action: 'AUDIT_PLAN_APPROVED',
        subjectType: SUBJ_PLAN, subjectId: id,
        payload: { year: plan.year, note: note || null },
      });
      return u;
    });

    res.json({ status: 'success', message: `${plan.year} plan approved`, plan: updated });
  } catch (error: any) {
    console.error('[Approve Plan Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to approve plan' });
  }
};

/**
 * Instantiate the engagement from an approved plan item.
 * This is the only sanctioned way an Audit comes into existence.
 */
export const instantiateEngagement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const itemId = req.params.itemId as string;
    const { objective, scope: auditScope, criteria } = req.body || {};

    const tenantScope = await resolveTenantScope(req.user!.tenantId);
    const item = await prisma.auditPlanItem.findFirst({
      where: { id: itemId, plan: { tenantId: { in: tenantScope.tenantIds } } },
      include: {
        plan: true,
        auditableEntity: true,
        audit: { select: { id: true, ref: true } },
      },
    });
    if (!item) { res.status(404).json({ status: 'error', message: 'Plan item not found' }); return; }
    if (!['Approved', 'Active'].includes(item.plan.status)) {
      res.status(409).json({
        status: 'error',
        message: `The ${item.plan.year} plan is ${item.plan.status}. Engagements can only start from an approved plan.`,
      });
      return;
    }
    if (item.audit) {
      res.status(409).json({ status: 'error', message: `Engagement ${item.audit.ref} already exists for this plan item` });
      return;
    }

    const tenantId = item.plan.tenantId;
    const count = await prisma.audit.count({ where: { tenantId } });
    const ref = `AUD-${item.plan.year}-${String(count + 1).padStart(2, '0')}`;

    const audit = await prisma.$transaction(async (tx) => {
      const created = await tx.audit.create({
        data: {
          tenantId,
          ref,
          title: `${item.auditableEntity.name} Audit`,
          objective: objective || `Assess the design and operating effectiveness of controls over ${item.auditableEntity.name}.`,
          scope: auditScope || item.auditableEntity.description || item.auditableEntity.name,
          criteria: criteria || 'To be confirmed during planning.',
          leadAuditorId: item.assignedLeadId || req.user!.id,
          status: 'Planned',
          planItemId: item.id,
        },
      });
      await tx.auditPlanItem.update({ where: { id: itemId }, data: { status: 'InProgress' } });
      if (item.plan.status === 'Approved') {
        await tx.auditPlan.update({ where: { id: item.planId }, data: { status: 'Active' } });
      }
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'AUDIT_INSTANTIATED_FROM_PLAN',
        subjectType: 'Audit', subjectId: created.id,
        payload: { ref, entity: item.auditableEntity.name, planYear: item.plan.year, budgetHours: item.budgetHours },
      });
      return created;
    });

    res.status(201).json({
      status: 'success',
      message: `Engagement ${ref} created from the ${item.plan.year} plan`,
      audit,
    });
  } catch (error: any) {
    console.error('[Instantiate Engagement Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to instantiate engagement' });
  }
};

export const deferPlanItem = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const itemId = req.params.itemId as string;
    const { reason } = req.body || {};
    if (!reason) {
      res.status(400).json({ status: 'error', message: 'A deferral reason is required — deviations from an approved plan are reported to the committee' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const item = await prisma.auditPlanItem.findFirst({
      where: { id: itemId, plan: { tenantId: { in: scope.tenantIds } } },
      include: { plan: true, auditableEntity: { select: { name: true } } },
    });
    if (!item) { res.status(404).json({ status: 'error', message: 'Plan item not found' }); return; }

    await prisma.$transaction(async (tx) => {
      await tx.auditPlanItem.update({
        where: { id: itemId },
        data: { status: 'Deferred', deferralReason: String(reason).trim() },
      });
      await writeAudit(tx, {
        tenantId: item.plan.tenantId, actorId: req.user!.id, action: 'AUDIT_PLAN_ITEM_DEFERRED',
        subjectType: SUBJ_PLAN, subjectId: item.planId,
        payload: { entity: item.auditableEntity.name, reason },
      });
    });

    res.json({ status: 'success', message: 'Plan item deferred and logged for committee reporting' });
  } catch (error: any) {
    console.error('[Defer Plan Item Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to defer plan item' });
  }
};
