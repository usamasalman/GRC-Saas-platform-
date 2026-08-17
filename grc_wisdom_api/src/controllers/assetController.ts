import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import {
  ASSET_TYPES, ASSET_OWNERSHIP, CLASSIFICATIONS, ASSET_STATUSES, TYPE_HELP,
  computeCriticality, criticalityTierOf, tangibilityOf, drivingDimension,
  suggestRiskScores, lossExpectancy, controlPosture, assetExposure,
  nextAssetReview, FORMULAS,
} from '../services/assetRiskScoring';
import { scoreOf, nextReviewFrom } from '../services/riskScoring';

const SUBJ_ASSET = 'Asset';

async function nextAssetRef(tenantId: string): Promise<string> {
  const count = await prisma.asset.count({ where: { tenantId } });
  return `AST-${String(count + 1).padStart(4, '0')}`;
}

/** Everything a list row or a detail panel needs, derived once. */
function enrich(a: any) {
  const posture = controlPosture(a.controlLinks || []);
  const risks = (a.riskLinks || []).map((l: any) => l.risk).filter(Boolean);
  const openRisks = risks.filter((r: any) => r.status !== 'Closed');
  const now = Date.now();

  // Loss expectancy only where the inputs genuinely exist. The worst link is
  // the one that governs — a board cares about the largest credible loss, not
  // the average of several.
  let worstLoss: any = null;
  for (const link of (a.riskLinks || [])) {
    const le = lossExpectancy({
      replacementValue: a.replacementValue,
      exposureFactor: link.exposureFactor,
      residualLikelihood: link.risk?.residualLikelihood,
    });
    if (le && (!worstLoss || le.ale > worstLoss.ale)) {
      worstLoss = { ...le, riskRef: link.risk?.ref, threat: link.threat };
    }
  }

  return {
    ...a,
    tangibility: tangibilityOf(a.type),
    drivingDimension: drivingDimension(a),
    controlPosture: posture,
    riskCount: risks.length,
    openRiskCount: openRisks.length,
    maxResidual: openRisks.reduce((m: number, r: any) => Math.max(m, r.residualScore ?? 0), 0),
    exposure: assetExposure(a.criticality, openRisks.map((r: any) => r.residualScore ?? 0)),
    lossExpectancy: worstLoss,
    openIssueCount: (a.issues || []).filter((i: any) => i.status !== 'Closed').length,
    reviewOverdue: !!a.nextReviewDate && new Date(a.nextReviewDate).getTime() < now && a.status !== 'Retired',
    // An asset carrying risk with nothing verified protecting it is the single
    // most actionable row in the register, so it is named rather than inferred.
    unprotectedButExposed: posture.total === 0 && openRisks.length > 0,
  };
}

const INCLUDE = {
  owner: { select: { id: true, name: true, email: true } },
  custodian: { select: { id: true, name: true, email: true } },
  parent: { select: { id: true, ref: true, name: true } },
  auditableEntity: { select: { id: true, name: true } },
  riskLinks: {
    include: {
      risk: {
        select: {
          id: true, ref: true, title: true, status: true, category: true,
          inherentScore: true, residualScore: true, residualLikelihood: true,
          residualImpact: true, treatmentType: true,
        },
      },
    },
  },
  controlLinks: {
    include: {
      implementation: {
        select: {
          id: true, status: true, effectiveness: true,
          control: { select: { code: true, title: true } },
        },
      },
    },
  },
  issues: { select: { id: true, ref: true, status: true, riskRating: true } },
} as const;

// ─── List ──────────────────────────────────────────────────────────────────

export const listAssets = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.assets.list');

    const { type, ownership, tier, status, search, unprotected } =
      req.query as Record<string, string | undefined>;
    const where: any = { tenantId: { in: scope.tenantIds } };
    if (type) where.type = type;
    if (ownership) where.ownership = ownership;
    if (tier) where.criticalityTier = tier;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { ref: { contains: search } },
        { vendorName: { contains: search } },
      ];
    }

    const rows = await prisma.asset.findMany({
      where, include: INCLUDE,
      orderBy: [{ criticality: 'desc' }, { name: 'asc' }],
      take: 500,
    });
    let assets: any[] = rows.map(enrich);
    if (unprotected === 'true') assets = assets.filter((a) => a.controlPosture.total === 0);

    const byType: Record<string, number> = {};
    const byOwnership: Record<string, number> = {};
    for (const a of assets) {
      byType[a.type] = (byType[a.type] ?? 0) + 1;
      byOwnership[a.ownership] = (byOwnership[a.ownership] ?? 0) + 1;
    }

    res.json({
      status: 'success',
      scope: scope.kind,
      count: assets.length,
      types: ASSET_TYPES,
      typeHelp: TYPE_HELP,
      ownerships: ASSET_OWNERSHIP,
      classifications: CLASSIFICATIONS,
      statuses: ASSET_STATUSES,
      formulas: FORMULAS,
      byType,
      byOwnership,
      totals: {
        total: assets.length,
        critical: assets.filter((a) => a.criticalityTier === 'Critical').length,
        high: assets.filter((a) => a.criticalityTier === 'High').length,
        thirdParty: assets.filter((a) => a.ownership !== 'Internal').length,
        physical: assets.filter((a) => a.tangibility === 'Physical').length,
        nonPhysical: assets.filter((a) => a.tangibility === 'NonPhysical').length,
        unprotected: assets.filter((a) => a.controlPosture.total === 0).length,
        unprotectedButExposed: assets.filter((a) => a.unprotectedButExposed).length,
        withoutRisk: assets.filter((a) => a.riskCount === 0).length,
        reviewOverdue: assets.filter((a) => a.reviewOverdue).length,
        totalValue: assets.reduce((s, a) => s + (a.replacementValue ?? 0), 0),
        annualisedLoss: assets.reduce((s, a) => s + (a.lossExpectancy?.ale ?? 0), 0),
      },
      assets,
    });
  } catch (error: any) {
    console.error('[Asset List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list assets' });
  }
};

// ─── Create ────────────────────────────────────────────────────────────────

export const createAsset = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      name, description, type, ownership, classification,
      confidentiality, integrity, availability,
      ownerId, custodianId, location, vendorName, contractRef,
      replacementValue, currency, acquiredAt, reviewCadenceMonths,
      parentId, auditableEntityId,
    } = req.body || {};

    if (!name) { res.status(400).json({ status: 'error', message: 'name is required' }); return; }
    if (type && !ASSET_TYPES.includes(type)) {
      res.status(400).json({ status: 'error', message: `type must be one of: ${ASSET_TYPES.join(', ')}` });
      return;
    }
    if (ownership && !ASSET_OWNERSHIP.includes(ownership)) {
      res.status(400).json({ status: 'error', message: `ownership must be one of: ${ASSET_OWNERSHIP.join(', ')}` });
      return;
    }
    // A third-party asset the organisation cannot name a supplier for is not
    // being managed — it is being hoped about.
    if ((ownership === 'ThirdParty' || ownership === 'Shared') && !vendorName) {
      res.status(400).json({
        status: 'error',
        code: 'VENDOR_REQUIRED',
        message: 'A third-party or shared asset must name the supplier that holds it.',
      });
      return;
    }

    const tenantId = req.user!.tenantId;
    const cia = { confidentiality, integrity, availability };
    const { criticality, criticalityTier } = computeCriticality(cia as any);
    const cadence = Number(reviewCadenceMonths) || 12;
    const ref = await nextAssetRef(tenantId);

    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          tenantId, ref,
          name: String(name).trim(),
          description: description ? String(description).trim() : null,
          type: type || 'Information',
          ownership: ownership || 'Internal',
          classification: CLASSIFICATIONS.includes(classification) ? classification : 'Internal',
          confidentiality: Math.min(5, Math.max(1, Number(confidentiality) || 3)),
          integrity: Math.min(5, Math.max(1, Number(integrity) || 3)),
          availability: Math.min(5, Math.max(1, Number(availability) || 3)),
          criticality, criticalityTier,
          ownerId: ownerId || req.user!.id,
          custodianId: custodianId || null,
          location: location || null,
          vendorName: vendorName || null,
          contractRef: contractRef || null,
          replacementValue: replacementValue ? Number(replacementValue) : null,
          currency: currency || 'SAR',
          acquiredAt: acquiredAt ? new Date(acquiredAt) : null,
          reviewCadenceMonths: cadence,
          nextReviewDate: nextAssetReview(cadence),
          parentId: parentId || null,
          auditableEntityId: auditableEntityId || null,
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'ASSET_REGISTERED',
        subjectType: SUBJ_ASSET, subjectId: created.id,
        payload: {
          ref, name, type: created.type, ownership: created.ownership,
          cia: { c: created.confidentiality, i: created.integrity, a: created.availability },
          criticality, criticalityTier,
        },
      });
      return created;
    });

    res.status(201).json({
      status: 'success',
      message: `${ref} registered. Criticality ${criticality} (${criticalityTier}), driven by ${drivingDimension(asset)}.`,
      asset: { ...asset, tangibility: tangibilityOf(asset.type) },
    });
  } catch (error: any) {
    console.error('[Asset Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to register asset' });
  }
};

// ─── Update ────────────────────────────────────────────────────────────────

export const updateAsset = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const asset = await prisma.asset.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!asset) { res.status(404).json({ status: 'error', message: 'Asset not found' }); return; }

    const b = req.body || {};
    const data: any = {};
    for (const k of ['name', 'description', 'location', 'vendorName', 'contractRef', 'currency']) {
      if (b[k] !== undefined) data[k] = b[k];
    }
    if (b.type && ASSET_TYPES.includes(b.type)) data.type = b.type;
    if (b.ownership && ASSET_OWNERSHIP.includes(b.ownership)) data.ownership = b.ownership;
    if (b.classification && CLASSIFICATIONS.includes(b.classification)) data.classification = b.classification;
    if (b.ownerId) data.ownerId = b.ownerId;
    if (b.custodianId !== undefined) data.custodianId = b.custodianId || null;
    if (b.replacementValue !== undefined) data.replacementValue = b.replacementValue ? Number(b.replacementValue) : null;
    if (b.parentId !== undefined) data.parentId = b.parentId || null;
    if (b.auditableEntityId !== undefined) data.auditableEntityId = b.auditableEntityId || null;

    if (b.status) {
      if (!ASSET_STATUSES.includes(b.status)) {
        res.status(400).json({ status: 'error', message: `status must be one of: ${ASSET_STATUSES.join(', ')}` });
        return;
      }
      data.status = b.status;
      if (b.status === 'Retired') data.retiredAt = new Date();
    }

    // Any change to the CIA triad re-derives criticality — it is never taken
    // from the client, so the inventory and the risk impacts it feeds cannot
    // disagree with the ratings that produced them.
    const ciaTouched = ['confidentiality', 'integrity', 'availability'].some((k) => b[k] !== undefined);
    if (ciaTouched) {
      const cia = {
        confidentiality: b.confidentiality ?? asset.confidentiality,
        integrity: b.integrity ?? asset.integrity,
        availability: b.availability ?? asset.availability,
      };
      const derived = computeCriticality(cia);
      Object.assign(data, cia, derived);
      data.lastReviewedAt = new Date();
      data.nextReviewDate = nextAssetReview(b.reviewCadenceMonths ?? asset.reviewCadenceMonths);
    }
    if (b.reviewCadenceMonths !== undefined) {
      data.reviewCadenceMonths = Number(b.reviewCadenceMonths) || 12;
      data.nextReviewDate = nextAssetReview(data.reviewCadenceMonths);
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.asset.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: asset.tenantId, actorId: req.user!.id, action: 'ASSET_UPDATED',
        subjectType: SUBJ_ASSET, subjectId: id,
        payload: {
          ref: asset.ref,
          before: { criticality: asset.criticality, tier: asset.criticalityTier, status: asset.status },
          after: data,
        },
      });
      return u;
    });

    res.json({
      status: 'success',
      message: ciaTouched
        ? `Revalued. Criticality ${asset.criticality} → ${updated.criticality} (${updated.criticalityTier}).`
        : 'Asset updated.',
      asset: updated,
    });
  } catch (error: any) {
    console.error('[Asset Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update asset' });
  }
};

// ─── Raise a risk from an asset ────────────────────────────────────────────

/**
 * The ISO 27005 flow: name the threat and the vulnerability, and the platform
 * derives the scores from the asset's own valuation rather than asking someone
 * to guess an impact. Creates the risk, links it to the asset, and places it in
 * the audit universe wherever the asset already sits.
 */
export const raiseRiskFromAsset = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const {
      threat, vulnerability, threatLevel, vulnerabilityLevel,
      title, description, category, exposureFactor, ownerId,
      likelihood: likelihoodOverride, impact: impactOverride,
    } = req.body || {};

    if (!threat || !vulnerability) {
      res.status(400).json({
        status: 'error',
        code: 'THREAT_AND_VULNERABILITY_REQUIRED',
        message: 'ISO 27005 states risk as a threat exploiting a vulnerability of an asset. Name both.',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const asset = await prisma.asset.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { auditableEntity: { select: { id: true } } },
    });
    if (!asset) { res.status(404).json({ status: 'error', message: 'Asset not found' }); return; }

    const suggestion = suggestRiskScores({
      criticality: asset.criticality,
      threatLevel: Number(threatLevel) || 3,
      vulnerabilityLevel: Number(vulnerabilityLevel) || 3,
    });
    // The suggestion is a starting point, not a verdict — an assessor may
    // override either axis, and the audit trail records that they did.
    const l = likelihoodOverride ? Number(likelihoodOverride) : suggestion.likelihood;
    const i = impactOverride ? Number(impactOverride) : suggestion.impact;
    const { l: likelihood, i: impact, score } = scoreOf(l, i);
    const overridden = likelihood !== suggestion.likelihood || impact !== suggestion.impact;

    const count = await prisma.risk.count({ where: { tenantId: asset.tenantId } });
    const ref = `RSK-${String(count + 1).padStart(3, '0')}`;

    const result = await prisma.$transaction(async (tx) => {
      const risk = await tx.risk.create({
        data: {
          tenantId: asset.tenantId, ref,
          title: title || `${threat} against ${asset.name}`,
          description: description
            || `Cause: ${vulnerability}. Event: ${threat} exploits it against ${asset.name} (${asset.ref}). `
            + `Impact: loss of ${drivingDimension(asset)} on a ${asset.criticalityTier.toLowerCase()}-criticality asset.`,
          category: category || (asset.ownership !== 'Internal' ? 'Third-Party' : 'Technology'),
          direction: 'Threat',
          ownerId: ownerId || asset.ownerId,
          treatmentType: 'Mitigate',
          identifiedVia: 'Workshop',
          identifiedSource: `Asset assessment — ${asset.ref}`,
          inherentLikelihood: likelihood, inherentImpact: impact, inherentScore: score,
          // No controls linked yet, so residual opens equal to inherent.
          residualLikelihood: likelihood, residualImpact: impact, residualScore: score,
          reviewCadenceMonths: 6,
          nextReviewDate: nextReviewFrom(6),
        },
      });

      await tx.riskScoreSnapshot.create({
        data: {
          tenantId: asset.tenantId, riskId: risk.id, score,
          inherentScore: score, residualScore: score, reason: 'Created',
        },
      });

      await tx.assetRiskLink.create({
        data: {
          assetId: asset.id, riskId: risk.id,
          threat: String(threat).trim(),
          vulnerability: String(vulnerability).trim(),
          threatLevel: Number(threatLevel) || 3,
          vulnerabilityLevel: Number(vulnerabilityLevel) || 3,
          exposureFactor: exposureFactor ? Number(exposureFactor) : null,
        },
      });

      // Inherit the asset's place in the audit universe, so an engagement that
      // covers the entity sees this risk without anyone re-linking it.
      if (asset.auditableEntityId) {
        await tx.riskEntityLink.create({
          data: { riskId: risk.id, auditableEntityId: asset.auditableEntityId },
        });
      }

      await writeAudit(tx, {
        tenantId: asset.tenantId, actorId: req.user!.id, action: 'RISK_RAISED_FROM_ASSET',
        subjectType: 'Risk', subjectId: risk.id,
        payload: {
          ref, assetRef: asset.ref, threat, vulnerability,
          suggested: { likelihood: suggestion.likelihood, impact: suggestion.impact },
          recorded: { likelihood, impact, score },
          overridden,
        },
      });
      return risk;
    });

    res.status(201).json({
      status: 'success',
      message: `${ref} raised against ${asset.ref}. ${suggestion.rationale}`
        + (overridden ? ' The assessor overrode the suggested scores; both are in the audit trail.' : ''),
      risk: result,
      derivation: suggestion,
      lossExpectancy: lossExpectancy({
        replacementValue: asset.replacementValue,
        exposureFactor: exposureFactor ? Number(exposureFactor) : null,
        residualLikelihood: likelihood,
      }),
    });
  } catch (error: any) {
    console.error('[Asset Risk Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to raise risk from asset' });
  }
};

// ─── Linking ───────────────────────────────────────────────────────────────

/** Attach controls that actually protect this asset. */
export const setAssetControls = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { implementationIds } = req.body || {};
    if (!Array.isArray(implementationIds)) {
      res.status(400).json({ status: 'error', message: 'implementationIds[] is required' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const asset = await prisma.asset.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!asset) { res.status(404).json({ status: 'error', message: 'Asset not found' }); return; }

    const valid = await prisma.controlImplementation.findMany({
      where: { id: { in: implementationIds }, tenantId: asset.tenantId },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.assetControlLink.deleteMany({ where: { assetId: id } });
      for (const v of valid) {
        await tx.assetControlLink.create({ data: { assetId: id, implementationId: v.id } });
      }
      await writeAudit(tx, {
        tenantId: asset.tenantId, actorId: req.user!.id, action: 'ASSET_CONTROLS_LINKED',
        subjectType: SUBJ_ASSET, subjectId: id,
        payload: { ref: asset.ref, linked: valid.length },
      });
    });

    res.json({ status: 'success', message: `${valid.length} control(s) linked to ${asset.ref}.` });
  } catch (error: any) {
    console.error('[Asset Controls Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to link controls' });
  }
};

/** Link an asset to a risk that already exists in the register. */
export const linkExistingRisk = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { riskId, threat, vulnerability, threatLevel, vulnerabilityLevel, exposureFactor } = req.body || {};
    if (!riskId) { res.status(400).json({ status: 'error', message: 'riskId is required' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const asset = await prisma.asset.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!asset) { res.status(404).json({ status: 'error', message: 'Asset not found' }); return; }
    const risk = await prisma.risk.findFirst({ where: { id: riskId, tenantId: asset.tenantId } });
    if (!risk) { res.status(400).json({ status: 'error', message: 'Risk not found in this entity' }); return; }

    const existing = await prisma.assetRiskLink.findUnique({
      where: { assetId_riskId: { assetId: id, riskId } },
    });
    if (existing) {
      res.status(409).json({ status: 'error', message: `${risk.ref} is already linked to ${asset.ref}.` });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.assetRiskLink.create({
        data: {
          assetId: id, riskId,
          threat: threat || null,
          vulnerability: vulnerability || null,
          threatLevel: threatLevel ? Number(threatLevel) : null,
          vulnerabilityLevel: vulnerabilityLevel ? Number(vulnerabilityLevel) : null,
          exposureFactor: exposureFactor ? Number(exposureFactor) : null,
        },
      });
      await writeAudit(tx, {
        tenantId: asset.tenantId, actorId: req.user!.id, action: 'ASSET_RISK_LINKED',
        subjectType: SUBJ_ASSET, subjectId: id,
        payload: { ref: asset.ref, riskRef: risk.ref, threat: threat || null },
      });
    });

    res.json({ status: 'success', message: `${risk.ref} linked to ${asset.ref}.` });
  } catch (error: any) {
    console.error('[Asset Link Risk Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to link risk' });
  }
};

/** Confirm the asset has been looked at, without requiring a revaluation. */
export const reviewAsset = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { note } = req.body || {};
    const scope = await resolveTenantScope(req.user!.tenantId);
    const asset = await prisma.asset.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!asset) { res.status(404).json({ status: 'error', message: 'Asset not found' }); return; }

    const next = nextAssetReview(asset.reviewCadenceMonths);
    await prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: { lastReviewedAt: new Date(), nextReviewDate: next },
      });
      await writeAudit(tx, {
        tenantId: asset.tenantId, actorId: req.user!.id, action: 'ASSET_REVIEWED',
        subjectType: SUBJ_ASSET, subjectId: id,
        payload: { ref: asset.ref, note: note || null, nextReviewDate: next },
      });
    });

    res.json({
      status: 'success',
      message: `${asset.ref} reviewed. Next review due ${next.toISOString().slice(0, 10)}.`,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to record asset review' });
  }
};

// ─── Analytics ─────────────────────────────────────────────────────────────

export const assetAnalytics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const rows = await prisma.asset.findMany({
      where: { tenantId: { in: scope.tenantIds } }, include: INCLUDE,
    });
    const assets: any[] = rows.map(enrich);

    /**
     * The asset heatmap: criticality against control posture. Rows are
     * criticality 1–5, columns run from unprotected to protected — so the
     * top-left cell is the register's worst corner and reads at a glance.
     */
    const POSTURE_ORDER = ['Unprotected', 'Failing', 'Unproven', 'Partial', 'Protected'];
    const grid = Array.from({ length: 5 }, () =>
      POSTURE_ORDER.map(() => ({ count: 0, refs: [] as string[] })));
    for (const a of assets) {
      const row = Math.min(5, Math.max(1, a.criticality)) - 1;
      const col = POSTURE_ORDER.indexOf(a.controlPosture.posture);
      if (col < 0) continue;
      grid[row][col].count++;
      grid[row][col].refs.push(a.ref);
    }

    const byType = ASSET_TYPES.map((t) => {
      const inType = assets.filter((a) => a.type === t);
      return {
        type: t,
        tangibility: tangibilityOf(t),
        count: inType.length,
        critical: inType.filter((a) => a.criticalityTier === 'Critical').length,
        unprotected: inType.filter((a) => a.controlPosture.total === 0).length,
        openRisks: inType.reduce((s, a) => s + a.openRiskCount, 0),
        value: inType.reduce((s, a) => s + (a.replacementValue ?? 0), 0),
      };
    }).filter((r) => r.count > 0);

    return void res.json({
      status: 'success',
      count: assets.length,
      postureOrder: POSTURE_ORDER,
      grid,
      byType,
      formulas: FORMULAS,
      // The rows a risk manager should act on first: exposed and undefended.
      attention: assets
        .filter((a) => a.unprotectedButExposed || a.controlPosture.posture === 'Failing')
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 12)
        .map((a) => ({
          id: a.id, ref: a.ref, name: a.name, type: a.type, ownership: a.ownership,
          criticality: a.criticality, criticalityTier: a.criticalityTier,
          posture: a.controlPosture.posture, openRiskCount: a.openRiskCount,
          maxResidual: a.maxResidual, exposure: a.exposure,
          lossExpectancy: a.lossExpectancy,
        })),
      topExposure: assets
        .slice()
        .sort((a, b) => b.exposure - a.exposure)
        .slice(0, 10)
        .map((a) => ({
          ref: a.ref, name: a.name, criticality: a.criticality,
          exposure: a.exposure, openRiskCount: a.openRiskCount,
          posture: a.controlPosture.posture,
        })),
      totals: {
        totalValue: assets.reduce((s, a) => s + (a.replacementValue ?? 0), 0),
        annualisedLoss: assets.reduce((s, a) => s + (a.lossExpectancy?.ale ?? 0), 0),
        quantified: assets.filter((a) => a.lossExpectancy).length,
      },
    });
  } catch (error: any) {
    console.error('[Asset Analytics Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to compute asset analytics' });
  }
};
