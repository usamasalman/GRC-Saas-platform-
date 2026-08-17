import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import {
  PLATFORM_DEFAULT, DEFAULT_IMPACT_SCALE, DEFAULT_LIKELIHOOD_SCALE,
  validateScale, validateThresholds, toCriteria, activeCriteria, criteriaAt,
  appetiteAt, bandFor,
} from '../services/riskCriteria';

const SUBJ_CRITERIA = 'RiskCriteria';

/**
 * Risk criteria — ISO 31000 clause 6.3.4.
 *
 * Same governance shape as appetite, because it is the same kind of artefact:
 * drafted by one person, approved by another, versioned so that a decision
 * taken last March can still be read against the scale that was in force then.
 */

// ─── Read ──────────────────────────────────────────────────────────────────

export const listCriteria = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const rows = await prisma.riskCriteria.findMany({
      where: { tenantId },
      include: {
        setBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { version: 'desc' },
    });

    const active = await activeCriteria(prisma, tenantId);
    const draft = rows.find((r) => r.status === 'Draft') || null;

    res.json({
      status: 'success',
      /// What is banding the register right now, whether tenant-set or default.
      active,
      /// The full history, newest first — the evidence trail clause 6.3.4 wants.
      versions: rows.map((r) => ({
        ...toCriteria(r),
        status: r.status,
        setBy: r.setBy,
        approvedBy: r.approvedBy,
        approvedAt: r.approvedAt,
        effectiveTo: r.effectiveTo,
        supersededById: r.supersededById,
      })),
      draft,
      platformDefault: PLATFORM_DEFAULT,
      /// Starting point for a tenant writing its first set.
      templates: {
        impactScale: DEFAULT_IMPACT_SCALE,
        likelihoodScale: DEFAULT_LIKELIHOOD_SCALE,
      },
    });
  } catch (error: any) {
    console.error('[Criteria List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load risk criteria' });
  }
};

/**
 * What was in force at a given moment — the question a version history exists
 * to answer. Feeds "on what basis was RSK-014 accepted last March?".
 */
export const criteriaAsAt = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { at, category } = req.query as Record<string, string | undefined>;
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) {
      res.status(400).json({ status: 'error', message: '`at` must be a valid date' });
      return;
    }
    const tenantId = req.user!.tenantId;
    const criteria = await criteriaAt(prisma, tenantId, when);
    const appetite = category ? await appetiteAt(prisma, tenantId, category, when) : null;

    res.json({
      status: 'success',
      at: when,
      criteria,
      appetite,
      note: criteria.isPlatformDefault
        ? 'No tenant criteria were approved at that date, so the platform default applied.'
        : `Version ${criteria.version} was in force, effective from ${criteria.effectiveFrom?.toISOString().slice(0, 10)}.`,
    });
  } catch (error: any) {
    console.error('[Criteria As-At Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to resolve criteria as at that date' });
  }
};

// ─── Draft ─────────────────────────────────────────────────────────────────

export const setCriteria = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, impactScale, likelihoodScale, highThreshold, mediumThreshold, currency } = req.body || {};
    if (!name || String(name).trim().length === 0) {
      res.status(400).json({ status: 'error', message: 'name is required — the criteria set needs an identity, e.g. "FY2026 enterprise risk criteria"' });
      return;
    }

    const impactErr = validateScale(impactScale, 'impact');
    if (impactErr) { res.status(400).json({ status: 'error', code: 'INVALID_SCALE', message: impactErr }); return; }
    const likErr = validateScale(likelihoodScale, 'likelihood');
    if (likErr) { res.status(400).json({ status: 'error', code: 'INVALID_SCALE', message: likErr }); return; }

    const high = Number(highThreshold ?? PLATFORM_DEFAULT.highThreshold);
    const medium = Number(mediumThreshold ?? PLATFORM_DEFAULT.mediumThreshold);
    const bandErr = validateThresholds(high, medium);
    if (bandErr) { res.status(400).json({ status: 'error', code: 'INVALID_THRESHOLDS', message: bandErr }); return; }

    const tenantId = req.user!.tenantId;
    const history = await prisma.riskCriteria.findMany({
      where: { tenantId }, orderBy: { version: 'desc' },
    });
    const openDraft = history.find((c) => c.status === 'Draft');
    if (openDraft) {
      res.status(409).json({
        status: 'error',
        code: 'DRAFT_ALREADY_OPEN',
        message: `Version ${openDraft.version} is already drafted and awaiting approval. Approve or withdraw it before drafting another.`,
        draftId: openDraft.id,
      });
      return;
    }
    const inForce = history.find((c) => c.status === 'Approved' && c.effectiveTo === null) || null;
    const nextVersion = (history[0]?.version ?? 0) + 1;

    const created = await prisma.$transaction(async (tx) => {
      const c = await tx.riskCriteria.create({
        data: {
          tenantId, version: nextVersion, name: String(name).trim(),
          impactScale: JSON.stringify(impactScale),
          likelihoodScale: JSON.stringify(likelihoodScale),
          highThreshold: high, mediumThreshold: medium,
          currency: currency || 'SAR',
          setById: req.user!.id, status: 'Draft',
        },
      });
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id,
        action: inForce ? 'RISK_CRITERIA_REVISED' : 'RISK_CRITERIA_SET',
        subjectType: SUBJ_CRITERIA, subjectId: c.id,
        payload: {
          version: nextVersion, name: c.name, highThreshold: high, mediumThreshold: medium,
          supersedes: inForce ? { version: inForce.version, high: inForce.highThreshold, medium: inForce.mediumThreshold } : null,
        },
      });
      return c;
    });

    res.status(201).json({
      status: 'success',
      message: inForce
        ? `Version ${nextVersion} drafted. Version ${inForce.version} stays in force until this is approved, and is retained as the basis for scores taken under it.`
        : `Risk criteria drafted as version ${nextVersion}. They must be approved before they band the register.`,
      criteria: created,
      currentlyInForce: inForce,
    });
  } catch (error: any) {
    console.error('[Criteria Set Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to draft risk criteria' });
  }
};

// ─── Approve ───────────────────────────────────────────────────────────────

/**
 * Approving criteria re-bands every score in the register, so it is a
 * governance act rather than a setting change: the author cannot approve their
 * own, and the response says exactly how many risks change rating as a result.
 */
export const approveCriteria = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const criteria = await prisma.riskCriteria.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
    });
    if (!criteria) { res.status(404).json({ status: 'error', message: 'Risk criteria not found' }); return; }
    if (criteria.status !== 'Draft') {
      res.status(409).json({ status: 'error', message: `Version ${criteria.version} is ${criteria.status}, not a draft` });
      return;
    }
    if (criteria.setById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'Whoever drafted the risk criteria cannot approve them.',
      });
      return;
    }

    // Show the consequence before committing it: which risks change band.
    const before = await activeCriteria(prisma, criteria.tenantId);
    const next = toCriteria(criteria);
    const risks = await prisma.risk.findMany({
      where: { tenantId: criteria.tenantId, status: { not: 'Closed' } },
      select: { ref: true, residualScore: true },
    });
    const rebanded = risks
      .map((r) => ({
        ref: r.ref, score: r.residualScore,
        from: bandFor(r.residualScore, before), to: bandFor(r.residualScore, next),
      }))
      .filter((r) => r.from !== r.to);

    const { updated, superseded } = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const previous = await tx.riskCriteria.findFirst({
        where: { tenantId: criteria.tenantId, status: 'Approved', effectiveTo: null },
        orderBy: { version: 'desc' },
      });
      if (previous) {
        await tx.riskCriteria.update({
          where: { id: previous.id },
          data: { status: 'Superseded', effectiveTo: now, supersededById: id },
        });
      }
      const u = await tx.riskCriteria.update({
        where: { id },
        data: {
          status: 'Approved', approvedById: req.user!.id, approvedAt: now, effectiveFrom: now,
        },
      });
      await writeAudit(tx, {
        tenantId: criteria.tenantId, actorId: req.user!.id, action: 'RISK_CRITERIA_APPROVED',
        subjectType: SUBJ_CRITERIA, subjectId: id,
        payload: {
          version: criteria.version, effectiveFrom: now,
          supersededVersion: previous?.version ?? null,
          // The re-banding is part of the record: a change to the scale that
          // moves twelve risks out of High is a governance event, not a tweak.
          rebandedCount: rebanded.length,
          rebanded: rebanded.slice(0, 50),
        },
      });
      return { updated: u, superseded: previous };
    });

    res.json({
      status: 'success',
      message: rebanded.length > 0
        ? `Version ${criteria.version} is now in force. ${rebanded.length} risk(s) change rating under the new bands.`
        : `Version ${criteria.version} is now in force. No risk changes rating under the new bands.`,
      criteria: updated,
      superseded,
      rebanded,
    });
  } catch (error: any) {
    console.error('[Criteria Approve Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to approve risk criteria' });
  }
};

/** Withdraw a draft that is not going to be approved. */
export const withdrawCriteria = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const criteria = await prisma.riskCriteria.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
    });
    if (!criteria) { res.status(404).json({ status: 'error', message: 'Risk criteria not found' }); return; }
    if (criteria.status !== 'Draft') {
      res.status(409).json({
        status: 'error',
        message: `Only a draft can be withdrawn. Version ${criteria.version} is ${criteria.status} and is part of the record.`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.riskCriteria.delete({ where: { id } });
      await writeAudit(tx, {
        tenantId: criteria.tenantId, actorId: req.user!.id, action: 'RISK_CRITERIA_WITHDRAWN',
        subjectType: SUBJ_CRITERIA, subjectId: id,
        payload: { version: criteria.version, name: criteria.name },
      });
    });

    res.json({ status: 'success', message: `Draft version ${criteria.version} withdrawn.` });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to withdraw the draft' });
  }
};
