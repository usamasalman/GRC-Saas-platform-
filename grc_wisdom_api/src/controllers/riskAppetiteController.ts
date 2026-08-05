import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { evaluateAppetite } from '../services/riskThresholds';

const SUBJ_APPETITE = 'RiskAppetite';

/**
 * Board-set risk appetite. Until a statement is approved it is a draft and
 * does not gate anything — an unapproved appetite is just an opinion.
 */
export const listAppetites = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.appetite.list');

    const appetites = await prisma.riskAppetite.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        setBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { category: 'asc' },
    });

    // Show how the live register sits against each approved statement.
    const risks = await prisma.risk.findMany({
      where: { tenantId: { in: scope.tenantIds }, status: { not: 'Closed' } },
      select: { category: true, residualScore: true },
    });

    const withPosture = appetites.map((a) => {
      const inCategory = risks.filter((r) => r.category === a.category);
      const bands = { WithinAppetite: 0, WithinTolerance: 0, BeyondTolerance: 0 };
      for (const r of inCategory) bands[evaluateAppetite(r.residualScore, a)]++;
      return { ...a, riskCount: inCategory.length, bands };
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      count: withPosture.length,
      totals: {
        categories: withPosture.length,
        approved: withPosture.filter((a) => a.status === 'Approved').length,
        draft: withPosture.filter((a) => a.status === 'Draft').length,
        breaches: withPosture.reduce((n, a) => n + a.bands.BeyondTolerance, 0),
      },
      appetites: withPosture,
    });
  } catch (error: any) {
    console.error('[Appetite List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list risk appetite' });
  }
};

export const setAppetite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { category, statement, appetiteThreshold, toleranceThreshold, tenantId } = req.body || {};
    if (!category || !statement) {
      res.status(400).json({ status: 'error', message: 'category and statement are required' });
      return;
    }

    const appetiteN = Number(appetiteThreshold);
    const toleranceN = Number(toleranceThreshold);
    // Residual scores are likelihood x impact on a 1-5 scale.
    if (!Number.isInteger(appetiteN) || !Number.isInteger(toleranceN) || appetiteN < 1 || toleranceN > 25) {
      res.status(400).json({ status: 'error', message: 'appetiteThreshold and toleranceThreshold must be whole numbers within 1-25' });
      return;
    }
    if (toleranceN < appetiteN) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_THRESHOLDS',
        message: 'toleranceThreshold cannot be below appetiteThreshold — tolerance is the outer limit.',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const target = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(target)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }

    const existing = await prisma.riskAppetite.findUnique({
      where: { tenantId_category: { tenantId: target, category } },
    });

    const appetite = await prisma.$transaction(async (tx) => {
      // Re-setting an approved statement returns it to draft: a changed
      // threshold has to be re-approved before it binds again.
      const saved = await tx.riskAppetite.upsert({
        where: { tenantId_category: { tenantId: target, category } },
        create: {
          tenantId: target, category, statement: String(statement).trim(),
          appetiteThreshold: appetiteN, toleranceThreshold: toleranceN,
          setById: req.user!.id, status: 'Draft',
        },
        update: {
          statement: String(statement).trim(),
          appetiteThreshold: appetiteN, toleranceThreshold: toleranceN,
          setById: req.user!.id, status: 'Draft',
          approvedById: null, approvedAt: null,
        },
      });
      await writeAudit(tx, {
        tenantId: target, actorId: req.user!.id,
        action: existing ? 'RISK_APPETITE_UPDATED' : 'RISK_APPETITE_SET',
        subjectType: SUBJ_APPETITE, subjectId: saved.id,
        payload: { category, appetiteThreshold: appetiteN, toleranceThreshold: toleranceN },
      });
      return saved;
    });

    res.status(existing ? 200 : 201).json({
      status: 'success',
      message: `Appetite for ${category} saved as draft — it must be approved before it takes effect.`,
      appetite,
    });
  } catch (error: any) {
    console.error('[Appetite Set Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to set risk appetite' });
  }
};

/** Whoever drafted the appetite cannot approve it. */
export const approveAppetite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const appetite = await prisma.riskAppetite.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!appetite) { res.status(404).json({ status: 'error', message: 'Risk appetite not found' }); return; }
    if (appetite.status === 'Approved') {
      res.status(409).json({ status: 'error', message: `Appetite for ${appetite.category} is already approved` });
      return;
    }
    if (appetite.setById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'Whoever drafted the appetite statement cannot approve it.',
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.riskAppetite.update({
        where: { id },
        data: { status: 'Approved', approvedById: req.user!.id, approvedAt: new Date() },
      });
      await writeAudit(tx, {
        tenantId: appetite.tenantId, actorId: req.user!.id, action: 'RISK_APPETITE_APPROVED',
        subjectType: SUBJ_APPETITE, subjectId: id,
        payload: { category: appetite.category, appetiteThreshold: appetite.appetiteThreshold, toleranceThreshold: appetite.toleranceThreshold },
      });
      return u;
    });

    res.json({ status: 'success', message: `Appetite for ${appetite.category} approved and now in force`, appetite: updated });
  } catch (error: any) {
    console.error('[Appetite Approve Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to approve risk appetite' });
  }
};

/** Every open risk measured against the appetite in force for its category. */
export const appetitePosture = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.appetite.posture');

    const [appetites, risks] = await Promise.all([
      prisma.riskAppetite.findMany({ where: { tenantId: { in: scope.tenantIds }, status: 'Approved' } }),
      prisma.risk.findMany({
        where: { tenantId: { in: scope.tenantIds }, status: { not: 'Closed' } },
        include: { owner: { select: { id: true, name: true } } },
        orderBy: { residualScore: 'desc' },
      }),
    ]);

    const byCategory = new Map(appetites.map((a) => [`${a.tenantId}::${a.category}`, a]));
    const assessed = risks.map((r) => {
      const a = byCategory.get(`${r.tenantId}::${r.category}`);
      return {
        id: r.id, ref: r.ref, title: r.title, category: r.category,
        residualScore: r.residualScore, status: r.status, owner: r.owner,
        band: a ? evaluateAppetite(r.residualScore, a) : 'NoAppetiteSet',
        appetiteThreshold: a?.appetiteThreshold ?? null,
        toleranceThreshold: a?.toleranceThreshold ?? null,
      };
    });

    const beyond = assessed.filter((r) => r.band === 'BeyondTolerance');
    res.json({
      status: 'success',
      scope: scope.kind,
      totals: {
        risks: assessed.length,
        withinAppetite: assessed.filter((r) => r.band === 'WithinAppetite').length,
        withinTolerance: assessed.filter((r) => r.band === 'WithinTolerance').length,
        beyondTolerance: beyond.length,
        noAppetiteSet: assessed.filter((r) => r.band === 'NoAppetiteSet').length,
      },
      beyondTolerance: beyond,
      risks: assessed,
    });
  } catch (error: any) {
    console.error('[Appetite Posture Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to compute appetite posture' });
  }
};
