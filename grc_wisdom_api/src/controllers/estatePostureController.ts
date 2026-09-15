import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import {
  resolveTenantScope, auditCrossTenantRead, StaleTenantError,
} from '../services/scopeResolver';
import { estatePosture, attentionOrder } from '../services/estatePosture';

/**
 * Posture, one organisation at a time.
 *
 * getGrcSummary answers the same question for a whole scope blended into one
 * set of figures, which for a platform operator is every customer added
 * together. That total cannot answer the question an operator actually has,
 * which is which customer needs attention.
 *
 * The arithmetic is estatePosture, which is pure and pinned without a database.
 * This loads rows and calls it. The appetite bands come from the same
 * evaluateAppetite the per-tenant summary uses, so the control plane and a
 * customer's own dashboard cannot disagree about whether a risk is beyond
 * tolerance.
 */
export const getEstatePosture = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    // Reading every customer's compliance position is the most sensitive
    // break-glass read in the product.
    await auditCrossTenantRead(scope, req.user!.id, 'grc.estate.posture');

    const where = { tenantId: { in: scope.tenantIds } };

    const [tenants, risks, appetites, issues, implementations, enablements] = await Promise.all([
      prisma.tenant.findMany({
        where: { id: { in: scope.tenantIds } },
        select: { id: true, name: true, type: true, suspendedAt: true },
        orderBy: { name: 'asc' },
      }),
      prisma.risk.findMany({
        where,
        select: {
          tenantId: true, category: true, status: true,
          residualScore: true, nextReviewDate: true,
        },
      }),
      prisma.riskAppetite.findMany({
        // Approved and in force only. A tolerance the board rejected, or one it
        // replaced two years ago, must not set the band — the same filter
        // getGrcSummary applies, and for the same reason.
        where: { ...where, status: 'Approved', effectiveTo: null },
        select: {
          tenantId: true, category: true,
          appetiteThreshold: true, toleranceThreshold: true,
        },
      }),
      prisma.issue.findMany({
        where,
        select: { tenantId: true, status: true, capDueDate: true, targetCloseDate: true },
      }),
      prisma.controlImplementation.findMany({
        where,
        select: { tenantId: true, status: true, effectiveness: true, nextDueDate: true },
      }),
      prisma.tenantStandardEnablement.findMany({ where, select: { tenantId: true } }),
    ]);

    const posture = estatePosture({
      tenants, risks, appetites, issues, implementations, enablements,
    });

    const assessed = posture.filter((p) => p.assessed).length;

    res.json({
      status: 'success',
      scope: scope.kind,
      counts: {
        organisations: posture.length,
        assessed,
        // Named for what it is. "Compliant" would be a claim; this is the
        // number nobody has looked at yet.
        neverAssessed: posture.length - assessed,
      },
      // Ordered so the organisations needing attention lead. It is an ordering,
      // not a score: there is deliberately no grade anywhere in this response.
      posture: attentionOrder(posture),
    });
  } catch (error: any) {
    if (error instanceof StaleTenantError) {
      res.status(401).json({ status: 'error', code: 'STALE_TENANT', message: error.message });
      return;
    }
    console.error('[Estate Posture Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load estate posture' });
  }
};
