import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { kriBreachLevel, validateKriThresholds } from '../services/riskThresholds';
import { createIssueRecord } from '../services/issueFactory';

const SUBJ_KRI = 'Kri';
const FREQUENCIES = ['Monthly', 'Quarterly'];

export const listKris = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.kri.list');

    const kris = await prisma.kri.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        risk: { select: { id: true, ref: true, title: true, residualScore: true } },
        tenant: { select: { id: true, name: true } },
        readings: { orderBy: { periodLabel: 'desc' }, take: 6, select: { periodLabel: true, value: true, breachLevel: true, recordedAt: true } },
      },
      orderBy: { name: 'asc' },
      take: 200,
    });

    const enriched = kris.map((k) => {
      const latest = k.readings[0] ?? null;
      // Trend needs the two most recent readings in chronological order.
      const prev = k.readings[1] ?? null;
      const trend = latest && prev
        ? (latest.value === prev.value ? 'flat' : latest.value > prev.value ? 'up' : 'down')
        : 'unknown';
      return { ...k, latest, trend, status: latest?.breachLevel ?? 'NoData' };
    });

    res.json({
      status: 'success',
      scope: scope.kind,
      count: enriched.length,
      totals: {
        kris: enriched.length,
        red: enriched.filter((k) => k.status === 'Red').length,
        amber: enriched.filter((k) => k.status === 'Amber').length,
        green: enriched.filter((k) => k.status === 'Green').length,
        noData: enriched.filter((k) => k.status === 'NoData').length,
      },
      kris: enriched,
    });
  } catch (error: any) {
    console.error('[KRI List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list KRIs' });
  }
};

export const createKri = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, unit, direction, amberThreshold, redThreshold, frequency, riskId, ownerId, tenantId } = req.body || {};
    if (!name) {
      res.status(400).json({ status: 'error', message: 'name is required' });
      return;
    }
    // A count-based indicator legitimately has no unit.
    const unitStr = unit === undefined || unit === null ? '' : String(unit).trim();
    const amber = Number(amberThreshold);
    const red = Number(redThreshold);
    if (!Number.isFinite(amber) || !Number.isFinite(red)) {
      res.status(400).json({ status: 'error', message: 'amberThreshold and redThreshold must be numbers' });
      return;
    }
    const dir = direction || 'Higher';
    const thresholdError = validateKriThresholds(dir, amber, red);
    if (thresholdError) {
      res.status(400).json({ status: 'error', code: 'INVALID_THRESHOLDS', message: thresholdError });
      return;
    }
    if (frequency && !FREQUENCIES.includes(frequency)) {
      res.status(400).json({ status: 'error', message: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const target = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(target)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }
    if (riskId) {
      const risk = await prisma.risk.findFirst({ where: { id: riskId, tenantId: target } });
      if (!risk) { res.status(404).json({ status: 'error', message: 'Linked risk not found in this tenant' }); return; }
    }

    const kri = await prisma.$transaction(async (tx) => {
      const created = await tx.kri.create({
        data: {
          tenantId: target, name: String(name).trim(), unit: unitStr,
          direction: dir, amberThreshold: amber, redThreshold: red,
          frequency: frequency || 'Monthly',
          riskId: riskId || null, ownerId: ownerId || req.user!.id,
        },
      });
      await writeAudit(tx, {
        tenantId: target, actorId: req.user!.id, action: 'KRI_CREATED',
        subjectType: SUBJ_KRI, subjectId: created.id,
        payload: { name, direction: dir, amberThreshold: amber, redThreshold: red, riskId: riskId || null },
      });
      return created;
    });

    res.status(201).json({ status: 'success', kri });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ status: 'error', message: 'A KRI with that name already exists in this tenant' });
      return;
    }
    console.error('[KRI Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create KRI' });
  }
};

/**
 * Record a reading. The RAG band is derived from the KRI's own thresholds at
 * write time rather than accepted from the client, and a red reading raises an
 * issue automatically — an indicator nobody acts on is decoration.
 */
export const recordReading = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const kriId = req.params.kriId as string;
    const { value, periodLabel } = req.body || {};

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      res.status(400).json({ status: 'error', message: 'value must be a number' });
      return;
    }
    if (!periodLabel) {
      res.status(400).json({ status: 'error', message: 'periodLabel is required (e.g. 2026-03)' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const kri = await prisma.kri.findFirst({
      where: { id: kriId, tenantId: { in: scope.tenantIds } },
      include: { risk: { select: { id: true, ref: true, title: true } } },
    });
    if (!kri) { res.status(404).json({ status: 'error', message: 'KRI not found' }); return; }

    const existing = await prisma.kriReading.findUnique({
      where: { kriId_periodLabel: { kriId, periodLabel: String(periodLabel).trim() } },
    });
    if (existing) {
      res.status(409).json({
        status: 'error',
        code: 'PERIOD_ALREADY_RECORDED',
        message: `A reading for ${periodLabel} already exists (${existing.value}). Readings are immutable so the trend stays honest.`,
      });
      return;
    }

    const breachLevel = kriBreachLevel(numeric, kri);

    const result = await prisma.$transaction(async (tx) => {
      let issue = null;
      if (breachLevel === 'Red') {
        issue = await createIssueRecord(tx, {
          tenantId: kri.tenantId,
          source: 'RiskAssessment',
          sourceReference: `${kri.name} · ${periodLabel}`,
          title: `KRI breach: ${kri.name} at ${numeric}${kri.unit}`,
          condition: `${kri.name} recorded ${numeric}${kri.unit} for ${periodLabel}, breaching the red threshold of ${kri.redThreshold}${kri.unit}.`,
          recommendation: kri.risk
            ? `Investigate the driver and reassess ${kri.risk.ref} — ${kri.risk.title}.`
            : `Investigate the driver behind the ${kri.name} breach and act to bring it back within threshold.`,
          riskRating: 'High',
          raisedById: req.user!.id,
        });
      }

      const reading = await tx.kriReading.create({
        data: {
          kriId, tenantId: kri.tenantId, periodLabel: String(periodLabel).trim(),
          value: numeric, breachLevel, recordedById: req.user!.id, issueId: issue?.id ?? null,
        },
      });

      await writeAudit(tx, {
        tenantId: kri.tenantId, actorId: req.user!.id, action: 'KRI_READING_RECORDED',
        subjectType: SUBJ_KRI, subjectId: kriId,
        payload: { periodLabel, value: numeric, breachLevel, issueRaised: issue?.ref ?? null },
      });
      return { reading, issue };
    });

    res.status(201).json({
      status: 'success',
      message: result.issue
        ? `${kri.name} is RED for ${periodLabel} — ${result.issue.ref} raised automatically.`
        : `${kri.name} recorded ${breachLevel} for ${periodLabel}.`,
      reading: result.reading,
      issue: result.issue,
    });
  } catch (error: any) {
    console.error('[KRI Reading Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record KRI reading' });
  }
};
