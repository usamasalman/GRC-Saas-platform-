import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import {
  VENDOR_CATEGORIES, VENDOR_STATUSES, DATA_ACCESS, DATA_ACCESS_HELP,
  ASSESSMENT_KINDS, ASSESSMENT_OUTCOMES, VENDOR_FORMULAS,
  computeTier, cadenceForTier, nextAssessmentFrom, exitDecisionDate,
  assessmentPosture, concentration,
} from '../services/vendorRisk';

const SUBJ_VENDOR = 'Vendor';
const SUBJ_ASSESSMENT = 'VendorAssessment';

async function nextVendorRef(tenantId: string): Promise<string> {
  const count = await prisma.vendor.count({ where: { tenantId } });
  return `VEN-${String(count + 1).padStart(4, '0')}`;
}

const INCLUDE = {
  relationshipOwner: { select: { id: true, name: true, email: true } },
  assessments: {
    include: {
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  assets: {
    select: {
      id: true, ref: true, name: true, type: true,
      criticality: true, criticalityTier: true, replacementValue: true,
    },
  },
  riskLinks: {
    include: {
      risk: {
        select: {
          id: true, ref: true, title: true, status: true,
          residualScore: true, inherentScore: true,
        },
      },
    },
  },
  issues: { select: { id: true, ref: true, status: true, riskRating: true } },
} as const;

function enrich(v: any, now = new Date()) {
  const posture = assessmentPosture(v.assessments || [], v.nextAssessmentDue, now);
  const conc = concentration(v.assets || []);
  const openRisks = (v.riskLinks || []).map((l: any) => l.risk).filter((r: any) => r && r.status !== 'Closed');
  const exitBy = exitDecisionDate(v.contractEnd, v.noticePeriodDays);

  return {
    ...v,
    assessmentPosture: posture.posture,
    assessmentDetail: posture.detail,
    concentration: conc,
    openRiskCount: openRisks.length,
    maxResidual: openRisks.reduce((m: number, r: any) => Math.max(m, r.residualScore ?? 0), 0),
    openIssueCount: (v.issues || []).filter((i: any) => i.status !== 'Closed').length,
    assessmentOverdue: !!v.nextAssessmentDue && new Date(v.nextAssessmentDue).getTime() < now.getTime(),
    contractExpiring: !!v.contractEnd
      && new Date(v.contractEnd).getTime() - now.getTime() < 120 * 86_400_000
      && new Date(v.contractEnd).getTime() > now.getTime(),
    exitDecisionDate: exitBy,
    // The decision window has closed: notice can no longer be served before the
    // contract rolls. This is the row a procurement lead needs to see first.
    exitWindowPassed: !!exitBy && exitBy.getTime() < now.getTime()
      && !!v.contractEnd && new Date(v.contractEnd).getTime() > now.getTime(),
  };
}

// ─── List ──────────────────────────────────────────────────────────────────

export const listVendors = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.vendors.list');

    const { tier, status, category, search, overdue } = req.query as Record<string, string | undefined>;
    const where: any = { tenantId: { in: scope.tenantIds } };
    if (tier) where.tier = tier;
    if (status) where.status = status;
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { ref: { contains: search } },
        { legalName: { contains: search } },
      ];
    }

    const rows = await prisma.vendor.findMany({
      where, include: INCLUDE,
      orderBy: [{ tierScore: 'desc' }, { name: 'asc' }],
      take: 500,
    });
    let vendors: any[] = rows.map((v: any) => enrich(v));
    if (overdue === 'true') vendors = vendors.filter((v) => v.assessmentOverdue);

    const byTier: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const v of vendors) {
      byTier[v.tier] = (byTier[v.tier] ?? 0) + 1;
      byCategory[v.category] = (byCategory[v.category] ?? 0) + 1;
    }

    res.json({
      status: 'success',
      scope: scope.kind,
      count: vendors.length,
      categories: VENDOR_CATEGORIES,
      statuses: VENDOR_STATUSES,
      dataAccessLevels: DATA_ACCESS,
      dataAccessHelp: DATA_ACCESS_HELP,
      assessmentKinds: ASSESSMENT_KINDS,
      formulas: VENDOR_FORMULAS,
      byTier, byCategory,
      totals: {
        total: vendors.length,
        active: vendors.filter((v) => v.status === 'Active').length,
        critical: vendors.filter((v) => v.tier === 'Critical').length,
        high: vendors.filter((v) => v.tier === 'High').length,
        neverAssessed: vendors.filter((v) => v.assessmentPosture === 'NeverAssessed').length,
        assessmentOverdue: vendors.filter((v) => v.assessmentOverdue).length,
        failing: vendors.filter((v) => v.assessmentPosture === 'Failing').length,
        withPersonalData: vendors.filter((v) => ['PersonalData', 'SensitivePersonalData'].includes(v.dataAccess)).length,
        withSystemAccess: vendors.filter((v) => v.hasSystemAccess).length,
        contractExpiring: vendors.filter((v) => v.contractExpiring).length,
        exitWindowPassed: vendors.filter((v) => v.exitWindowPassed).length,
        annualSpend: vendors.reduce((s, v) => s + (v.annualSpend ?? 0), 0),
        valueAtRisk: vendors.reduce((s, v) => s + v.concentration.valueAtRisk, 0),
      },
      vendors,
    });
  } catch (error: any) {
    console.error('[Vendor List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list vendors' });
  }
};

// ─── Create ────────────────────────────────────────────────────────────────

export const createVendor = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      name, legalName, category, description, country, dataLocation,
      dataAccess, hasSystemAccess, subprocessors,
      serviceCriticality, substitutability,
      contractRef, contractStart, contractEnd, noticePeriodDays,
      annualSpend, currency, relationshipOwnerId, status,
    } = req.body || {};

    if (!name) { res.status(400).json({ status: 'error', message: 'name is required' }); return; }
    if (category && !VENDOR_CATEGORIES.includes(category)) {
      res.status(400).json({ status: 'error', message: `category must be one of: ${VENDOR_CATEGORIES.join(', ')}` });
      return;
    }
    if (dataAccess && !DATA_ACCESS.includes(dataAccess)) {
      res.status(400).json({ status: 'error', message: `dataAccess must be one of: ${DATA_ACCESS.join(', ')}` });
      return;
    }
    // A supplier touching personal data without a stated location cannot be
    // assessed for cross-border transfer, which is the first PDPL question.
    if (['PersonalData', 'SensitivePersonalData'].includes(dataAccess) && !dataLocation) {
      res.status(400).json({
        status: 'error',
        code: 'DATA_LOCATION_REQUIRED',
        message: 'A supplier that can reach personal data must state where that data is held — cross-border transfer is the first question PDPL asks.',
      });
      return;
    }

    const tenantId = req.user!.tenantId;
    const tiering = computeTier({
      serviceCriticality: Number(serviceCriticality) || 3,
      substitutability: Number(substitutability) || 3,
      dataAccess: dataAccess || 'None',
      hasSystemAccess: !!hasSystemAccess,
    });
    const cadence = cadenceForTier(tiering.tier);
    const ref = await nextVendorRef(tenantId);

    const vendor = await prisma.$transaction(async (tx) => {
      const created = await tx.vendor.create({
        data: {
          tenantId, ref,
          name: String(name).trim(),
          legalName: legalName || null,
          category: category || 'Other',
          description: description || null,
          country: country || null,
          dataLocation: dataLocation || null,
          dataAccess: dataAccess || 'None',
          hasSystemAccess: !!hasSystemAccess,
          subprocessors: subprocessors || null,
          serviceCriticality: Math.min(5, Math.max(1, Number(serviceCriticality) || 3)),
          substitutability: Math.min(5, Math.max(1, Number(substitutability) || 3)),
          tier: tiering.tier, tierScore: tiering.tierScore,
          contractRef: contractRef || null,
          contractStart: contractStart ? new Date(contractStart) : null,
          contractEnd: contractEnd ? new Date(contractEnd) : null,
          noticePeriodDays: noticePeriodDays ? Number(noticePeriodDays) : null,
          annualSpend: annualSpend ? Number(annualSpend) : null,
          currency: currency || 'SAR',
          relationshipOwnerId: relationshipOwnerId || req.user!.id,
          status: VENDOR_STATUSES.includes(status) ? status : 'Active',
          onboardedAt: new Date(),
          assessmentCadenceMonths: cadence,
          // Onboarding due diligence is due immediately, not in a year.
          nextAssessmentDue: new Date(),
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'VENDOR_ONBOARDED',
        subjectType: SUBJ_VENDOR, subjectId: created.id,
        payload: {
          ref, name, category: created.category, dataAccess: created.dataAccess,
          tier: tiering.tier, tierScore: tiering.tierScore, cadenceMonths: cadence,
        },
      });
      return created;
    });

    res.status(201).json({
      status: 'success',
      message: `${ref} onboarded. ${tiering.rationale} Reassessment every ${cadence} months; onboarding due diligence is due now.`,
      vendor, tiering,
    });
  } catch (error: any) {
    console.error('[Vendor Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to onboard vendor' });
  }
};

// ─── Update ────────────────────────────────────────────────────────────────

export const updateVendor = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const vendor = await prisma.vendor.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!vendor) { res.status(404).json({ status: 'error', message: 'Vendor not found' }); return; }

    const b = req.body || {};
    const data: any = {};
    for (const k of ['name', 'legalName', 'description', 'country', 'dataLocation',
      'subprocessors', 'contractRef', 'currency']) {
      if (b[k] !== undefined) data[k] = b[k] || null;
    }
    if (b.category && VENDOR_CATEGORIES.includes(b.category)) data.category = b.category;
    if (b.relationshipOwnerId) data.relationshipOwnerId = b.relationshipOwnerId;
    if (b.contractStart !== undefined) data.contractStart = b.contractStart ? new Date(b.contractStart) : null;
    if (b.contractEnd !== undefined) data.contractEnd = b.contractEnd ? new Date(b.contractEnd) : null;
    if (b.noticePeriodDays !== undefined) data.noticePeriodDays = b.noticePeriodDays ? Number(b.noticePeriodDays) : null;
    if (b.annualSpend !== undefined) data.annualSpend = b.annualSpend ? Number(b.annualSpend) : null;

    if (b.status) {
      if (!VENDOR_STATUSES.includes(b.status)) {
        res.status(400).json({ status: 'error', message: `status must be one of: ${VENDOR_STATUSES.join(', ')}` });
        return;
      }
      data.status = b.status;
      if (b.status === 'Terminated') data.offboardedAt = new Date();
    }

    // Anything that feeds the tier re-derives it, and the cadence follows —
    // otherwise a supplier upgraded to hold personal data keeps a two-year
    // reassessment cycle it should no longer have.
    const tierTouched = ['serviceCriticality', 'substitutability', 'dataAccess', 'hasSystemAccess']
      .some((k) => b[k] !== undefined);
    let tiering = null;
    if (tierTouched) {
      if (b.dataAccess && !DATA_ACCESS.includes(b.dataAccess)) {
        res.status(400).json({ status: 'error', message: `dataAccess must be one of: ${DATA_ACCESS.join(', ')}` });
        return;
      }
      tiering = computeTier({
        serviceCriticality: b.serviceCriticality ?? vendor.serviceCriticality,
        substitutability: b.substitutability ?? vendor.substitutability,
        dataAccess: b.dataAccess ?? vendor.dataAccess,
        hasSystemAccess: b.hasSystemAccess ?? vendor.hasSystemAccess,
      });
      const cadence = cadenceForTier(tiering.tier);
      Object.assign(data, {
        serviceCriticality: Math.min(5, Math.max(1, Number(b.serviceCriticality ?? vendor.serviceCriticality))),
        substitutability: Math.min(5, Math.max(1, Number(b.substitutability ?? vendor.substitutability))),
        dataAccess: b.dataAccess ?? vendor.dataAccess,
        hasSystemAccess: b.hasSystemAccess ?? vendor.hasSystemAccess,
        tier: tiering.tier, tierScore: tiering.tierScore,
        assessmentCadenceMonths: cadence,
        nextAssessmentDue: vendor.lastAssessedAt
          ? nextAssessmentFrom(cadence, vendor.lastAssessedAt)
          : new Date(),
      });
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.vendor.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: vendor.tenantId, actorId: req.user!.id, action: 'VENDOR_UPDATED',
        subjectType: SUBJ_VENDOR, subjectId: id,
        payload: {
          ref: vendor.ref,
          before: { tier: vendor.tier, tierScore: vendor.tierScore, status: vendor.status },
          after: data,
        },
      });
      return u;
    });

    res.json({
      status: 'success',
      message: tiering
        ? `Retiered: ${vendor.tier} → ${updated.tier}. ${tiering.rationale} Reassessment now every ${updated.assessmentCadenceMonths} months.`
        : 'Vendor updated.',
      vendor: updated, tiering,
    });
  } catch (error: any) {
    console.error('[Vendor Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update vendor' });
  }
};

// ─── Assessments ───────────────────────────────────────────────────────────

export const requestAssessment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { kind, questionnaire, dueDate } = req.body || {};
    const scope = await resolveTenantScope(req.user!.tenantId);
    const vendor = await prisma.vendor.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { assessments: { where: { status: { in: ['Requested', 'InProgress', 'Submitted'] } } } },
    });
    if (!vendor) { res.status(404).json({ status: 'error', message: 'Vendor not found' }); return; }
    if (kind && !ASSESSMENT_KINDS.includes(kind)) {
      res.status(400).json({ status: 'error', message: `kind must be one of: ${ASSESSMENT_KINDS.join(', ')}` });
      return;
    }
    if (vendor.assessments.length > 0) {
      res.status(409).json({
        status: 'error',
        code: 'ASSESSMENT_ALREADY_OPEN',
        message: `${vendor.ref} already has an open assessment. Complete or withdraw it before issuing another.`,
      });
      return;
    }

    const count = await prisma.vendorAssessment.count({ where: { tenantId: vendor.tenantId } });
    const ref = `VA-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;
    const due = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 86_400_000);

    const created = await prisma.$transaction(async (tx) => {
      const a = await tx.vendorAssessment.create({
        data: {
          vendorId: id, tenantId: vendor.tenantId, ref,
          kind: kind || 'Periodic',
          questionnaire: questionnaire || null,
          requestedById: req.user!.id,
          dueDate: due, status: 'Requested',
        },
      });
      await writeAudit(tx, {
        tenantId: vendor.tenantId, actorId: req.user!.id, action: 'VENDOR_ASSESSMENT_REQUESTED',
        subjectType: SUBJ_ASSESSMENT, subjectId: a.id,
        payload: { ref, vendorRef: vendor.ref, kind: a.kind, dueDate: due },
      });
      return a;
    });

    res.status(201).json({
      status: 'success',
      message: `${ref} issued to ${vendor.name}, due ${due.toISOString().slice(0, 10)}.`,
      assessment: created,
    });
  } catch (error: any) {
    console.error('[Assessment Request Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to request assessment' });
  }
};

/** The supplier's returned questionnaire. */
export const submitAssessment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessmentId = req.params.assessmentId as string;
    const { score, narrative } = req.body || {};
    const scope = await resolveTenantScope(req.user!.tenantId);
    const a = await prisma.vendorAssessment.findFirst({
      where: { id: assessmentId, tenantId: { in: scope.tenantIds } },
      include: { vendor: { select: { ref: true, name: true } } },
    });
    if (!a) { res.status(404).json({ status: 'error', message: 'Assessment not found' }); return; }
    if (!['Requested', 'InProgress'].includes(a.status)) {
      res.status(409).json({ status: 'error', message: `Assessment is ${a.status}` });
      return;
    }
    const n = Number(score);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      res.status(400).json({ status: 'error', message: 'score must be between 0 and 100' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.vendorAssessment.update({
        where: { id: assessmentId },
        data: { status: 'Submitted', submittedAt: new Date(), score: n, narrative: narrative || null },
      });
      await writeAudit(tx, {
        tenantId: a.tenantId, actorId: req.user!.id, action: 'VENDOR_ASSESSMENT_SUBMITTED',
        subjectType: SUBJ_ASSESSMENT, subjectId: assessmentId,
        payload: { ref: a.ref, vendorRef: a.vendor.ref, score: n },
      });
    });

    res.json({
      status: 'success',
      message: `${a.ref} submitted with a score of ${n}/100. It needs an independent review before it counts.`,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to submit assessment' });
  }
};

/**
 * Review and conclude. The reviewer must be someone other than the requester —
 * an assessment issued and signed off by the same person is not diligence.
 */
export const reviewAssessment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const assessmentId = req.params.assessmentId as string;
    const { outcome, narrative } = req.body || {};
    if (!outcome || !ASSESSMENT_OUTCOMES.includes(outcome)) {
      res.status(400).json({ status: 'error', message: `outcome must be one of: ${ASSESSMENT_OUTCOMES.join(', ')}` });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const a = await prisma.vendorAssessment.findFirst({
      where: { id: assessmentId, tenantId: { in: scope.tenantIds } },
      include: { vendor: true },
    });
    if (!a) { res.status(404).json({ status: 'error', message: 'Assessment not found' }); return; }
    if (a.status !== 'Submitted') {
      res.status(409).json({
        status: 'error',
        message: `Only a submitted assessment can be reviewed (current: ${a.status}).`,
      });
      return;
    }
    if (a.requestedById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'Whoever issued the assessment cannot review its outcome — that is not independent diligence.',
      });
      return;
    }

    const now = new Date();
    const cadence = a.vendor.assessmentCadenceMonths;
    const next = nextAssessmentFrom(cadence, now);

    const result = await prisma.$transaction(async (tx) => {
      await tx.vendorAssessment.update({
        where: { id: assessmentId },
        data: {
          status: 'Reviewed', outcome,
          narrative: narrative || a.narrative,
          reviewedById: req.user!.id, reviewedAt: now,
        },
      });
      await tx.vendor.update({
        where: { id: a.vendorId },
        data: { lastAssessedAt: now, nextAssessmentDue: next },
      });

      // An inadequate supplier is a finding, not a note. Raising it into the
      // same register as every other issue is what gets it remediated.
      let issue = null;
      if (outcome === 'Inadequate') {
        const { createIssueRecord } = await import('../services/issueFactory');
        issue = await createIssueRecord(tx, {
          tenantId: a.tenantId,
          source: 'SelfIdentified',
          sourceReference: a.ref,
          title: `Supplier due diligence inadequate: ${a.vendor.name}`,
          condition: narrative || `${a.vendor.name} scored ${a.score ?? 'n/a'}/100 and was concluded Inadequate.`,
          recommendation: `Agree a remediation plan with ${a.vendor.name}, or begin exit planning.`,
          riskRating: a.vendor.tier === 'Critical' ? 'High' : 'Medium',
          raisedById: req.user!.id,
          vendorId: a.vendorId,
        });
        await tx.vendor.update({ where: { id: a.vendorId }, data: { status: 'UnderReview' } });
      }

      await writeAudit(tx, {
        tenantId: a.tenantId, actorId: req.user!.id, action: 'VENDOR_ASSESSMENT_REVIEWED',
        subjectType: SUBJ_ASSESSMENT, subjectId: assessmentId,
        payload: {
          ref: a.ref, vendorRef: a.vendor.ref, outcome, score: a.score,
          nextAssessmentDue: next, issueRaised: issue?.ref ?? null,
        },
      });
      return { issue };
    });

    res.json({
      status: 'success',
      message: outcome === 'Inadequate'
        ? `${a.ref} concluded Inadequate. ${result.issue?.ref} raised and ${a.vendor.name} moved to Under review.`
        : `${a.ref} concluded ${outcome}. Next reassessment due ${next.toISOString().slice(0, 10)}.`,
      issue: result.issue,
      nextAssessmentDue: next,
    });
  } catch (error: any) {
    console.error('[Assessment Review Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to review assessment' });
  }
};

// ─── Analytics ─────────────────────────────────────────────────────────────

export const vendorAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const rows = await prisma.vendor.findMany({
      where: { tenantId: { in: scope.tenantIds } }, include: INCLUDE,
    });
    const vendors: any[] = rows.map((v: any) => enrich(v));

    /**
     * Tier against due-diligence posture. The top-left corner — critical
     * suppliers never assessed — is the corner a regulator opens with.
     */
    const POSTURE_ORDER = ['NeverAssessed', 'Overdue', 'Failing', 'Watch', 'InProgress', 'Stale', 'Current'];
    const TIER_ORDER = ['Low', 'Medium', 'High', 'Critical'];
    const grid = TIER_ORDER.map(() => POSTURE_ORDER.map(() => ({ count: 0, refs: [] as string[] })));
    for (const v of vendors) {
      const r = TIER_ORDER.indexOf(v.tier);
      const c = POSTURE_ORDER.indexOf(v.assessmentPosture);
      if (r < 0 || c < 0) continue;
      grid[r][c].count++;
      grid[r][c].refs.push(v.ref);
    }

    return void res.json({
      status: 'success',
      count: vendors.length,
      tierOrder: TIER_ORDER,
      postureOrder: POSTURE_ORDER,
      grid,
      formulas: VENDOR_FORMULAS,
      // Where the estate is concentrated — the question free-text vendor names
      // made unanswerable.
      concentration: vendors
        .filter((v) => v.concentration.assetCount > 0)
        .sort((a, b) => b.concentration.weight - a.concentration.weight)
        .slice(0, 10)
        .map((v) => ({
          ref: v.ref, name: v.name, tier: v.tier,
          assetCount: v.concentration.assetCount,
          criticalAssets: v.concentration.criticalAssets,
          valueAtRisk: v.concentration.valueAtRisk,
          weight: v.concentration.weight,
          assets: (v.assets || []).map((a: any) => ({ ref: a.ref, name: a.name, criticality: a.criticality })),
        })),
      attention: vendors
        .filter((v) => ['NeverAssessed', 'Overdue', 'Failing'].includes(v.assessmentPosture)
          && ['Critical', 'High'].includes(v.tier))
        .sort((a, b) => b.tierScore - a.tierScore)
        .slice(0, 12)
        .map((v) => ({
          id: v.id, ref: v.ref, name: v.name, tier: v.tier, tierScore: v.tierScore,
          posture: v.assessmentPosture, detail: v.assessmentDetail,
          dataAccess: v.dataAccess, assetCount: v.concentration.assetCount,
        })),
      contractWatch: vendors
        .filter((v) => v.contractExpiring || v.exitWindowPassed)
        .sort((a, b) => new Date(a.contractEnd).getTime() - new Date(b.contractEnd).getTime())
        .map((v) => ({
          ref: v.ref, name: v.name, tier: v.tier,
          contractEnd: v.contractEnd, noticePeriodDays: v.noticePeriodDays,
          exitDecisionDate: v.exitDecisionDate, exitWindowPassed: v.exitWindowPassed,
        })),
    });
  } catch (error: any) {
    console.error('[Vendor Analytics Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to compute vendor analytics' });
  }
};
