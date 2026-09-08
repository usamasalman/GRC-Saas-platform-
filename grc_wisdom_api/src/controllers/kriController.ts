import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { judgeDeletion } from '../services/recordDeletion';
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

/**
 * Correct a key risk indicator.
 *
 * KRIs were create-only, which is a bad property for the one object in the
 * register whose whole job is to be calibrated. An amber threshold set too low
 * cries wolf every month until people stop reading it; set too high it never
 * fires. Both are discovered from the readings, i.e. after creation, and until
 * now the only remedy was a second KRI measuring the same thing.
 *
 * Thresholds are re-validated against the direction on every change, because a
 * direction flip with the old numbers left in place inverts every future
 * breach silently -- green becomes red and nothing errors.
 */
export const updateKri = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const kri = await prisma.kri.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!kri) { res.status(404).json({ status: 'error', message: 'KRI not found' }); return; }

    const { name, unit, direction, amberThreshold, redThreshold, frequency, ownerId, isActive } = req.body || {};
    const data: any = {};
    if (name) data.name = String(name).trim();
    if (unit !== undefined) data.unit = unit === null ? '' : String(unit).trim();
    if (ownerId) data.ownerId = ownerId;
    if (typeof isActive === 'boolean') data.isActive = isActive;

    if (frequency) {
      if (!FREQUENCIES.includes(frequency)) {
        res.status(400).json({ status: 'error', message: `frequency must be one of: ${FREQUENCIES.join(', ')}` });
        return;
      }
      data.frequency = frequency;
    }

    // Direction and thresholds are validated together even when only one of the
    // three was sent. Checking a new threshold against the stored direction, or
    // a new direction against stored thresholds, is the same check.
    const nextDirection = direction || kri.direction;
    const nextAmber = amberThreshold === undefined ? kri.amberThreshold : Number(amberThreshold);
    const nextRed = redThreshold === undefined ? kri.redThreshold : Number(redThreshold);
    const touchesThresholds = direction !== undefined
      || amberThreshold !== undefined || redThreshold !== undefined;

    if (touchesThresholds) {
      if (!Number.isFinite(nextAmber) || !Number.isFinite(nextRed)) {
        res.status(400).json({ status: 'error', message: 'amberThreshold and redThreshold must be numbers' });
        return;
      }
      const thresholdError = validateKriThresholds(nextDirection, nextAmber, nextRed);
      if (thresholdError) {
        res.status(400).json({ status: 'error', code: 'INVALID_THRESHOLDS', message: thresholdError });
        return;
      }
      data.direction = nextDirection;
      data.amberThreshold = nextAmber;
      data.redThreshold = nextRed;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.kri.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: kri.tenantId, actorId: req.user!.id, action: 'KRI_UPDATED',
        subjectType: 'Kri', subjectId: id,
        payload: {
          name: kri.name,
          before: {
            direction: kri.direction, amberThreshold: kri.amberThreshold,
            redThreshold: kri.redThreshold, frequency: kri.frequency, isActive: kri.isActive,
          },
          after: data,
        },
      });
      return u;
    });

    res.json({ status: 'success', kri: updated });
  } catch (error: any) {
    console.error('[KRI Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update KRI' });
  }
};

/**
 * Remove a KRI that should not exist.
 *
 * Readings are the indicator's history and the evidence behind every breach it
 * ever raised, so a KRI that has been measured is retired rather than deleted:
 * set isActive false and it stops being collected while the series survives.
 * Deleting it would cascade the readings away and take the breaches with them.
 */
export const deleteKri = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const kri = await prisma.kri.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { _count: { select: { readings: true } } },
    });
    if (!kri) { res.status(404).json({ status: 'error', message: 'KRI not found' }); return; }

    const verdict = judgeDeletion({
      recordLabel: 'indicator',
      dependants: [{ label: 'readings recorded', count: kri._count.readings }],
      alternative: 'Deactivate it instead — it stops being collected and the series it '
        + 'already produced stays readable.',
    });
    if (!verdict.allowed) { res.status(409).json({ status: 'error', ...verdict, allowed: undefined }); return; }

    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: kri.tenantId, actorId: req.user!.id, action: 'KRI_DELETED',
        subjectType: 'Kri', subjectId: id,
        payload: {
          name: kri.name, unit: kri.unit, direction: kri.direction,
          amberThreshold: kri.amberThreshold, redThreshold: kri.redThreshold,
        },
      });
      await tx.kri.delete({ where: { id } });
    });

    res.json({ status: 'success', message: `${kri.name} deleted` });
  } catch (error: any) {
    console.error('[KRI Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete KRI' });
  }
};
