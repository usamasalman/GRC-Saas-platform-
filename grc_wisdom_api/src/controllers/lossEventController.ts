import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';
import { createIssueRecord } from '../services/issueFactory';

const SUBJ_LOSS = 'LossEvent';

/** Basel-style operational risk event categories. */
const CATEGORIES = [
  'InternalFraud', 'ExternalFraud', 'EmploymentPractices', 'ClientsProductsBusinessPractices',
  'DamageToPhysicalAssets', 'BusinessDisruptionSystemFailure', 'ExecutionDeliveryProcessManagement',
];

/** A loss at or above this net amount is material enough to warrant an issue. */
const MATERIALITY_THRESHOLD = 50_000;

async function nextLossRef(tenantId: string): Promise<string> {
  const count = await prisma.lossEvent.count({ where: { tenantId } });
  return `LOSS-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;
}

export const listLossEvents = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'grc.losses.list');

    const { category, status } = req.query as Record<string, string | undefined>;
    const where: any = { tenantId: { in: scope.tenantIds } };
    if (category) where.category = category;
    if (status) where.status = status;

    const events = await prisma.lossEvent.findMany({
      where,
      include: {
        reportedBy: { select: { id: true, name: true } },
        risk: { select: { id: true, ref: true, title: true, residualScore: true } },
        issue: { select: { id: true, ref: true, status: true } },
        tenant: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: 'desc' },
      take: 300,
    });

    const enriched = events.map((e) => ({
      ...e,
      netAmount: e.grossAmount - e.recoveredAmount,
      // The lag between an event happening and anyone noticing is itself a
      // control-effectiveness signal.
      detectionLagDays: Math.max(0, Math.round((e.discoveredAt.getTime() - e.occurredAt.getTime()) / 86_400_000)),
    }));

    const byCategory: Record<string, { count: number; net: number }> = {};
    for (const e of enriched) {
      const row = byCategory[e.category] ?? { count: 0, net: 0 };
      row.count++; row.net += e.netAmount;
      byCategory[e.category] = row;
    }

    const totalNet = enriched.reduce((n, e) => n + e.netAmount, 0);
    res.json({
      status: 'success',
      scope: scope.kind,
      count: enriched.length,
      totals: {
        events: enriched.length,
        open: enriched.filter((e) => e.status !== 'Closed').length,
        grossAmount: enriched.reduce((n, e) => n + e.grossAmount, 0),
        recoveredAmount: enriched.reduce((n, e) => n + e.recoveredAmount, 0),
        netAmount: totalNet,
        largestNet: enriched.reduce((n, e) => Math.max(n, e.netAmount), 0),
        avgDetectionLagDays: enriched.length > 0
          ? Math.round(enriched.reduce((n, e) => n + e.detectionLagDays, 0) / enriched.length)
          : 0,
      },
      byCategory,
      events: enriched,
    });
  } catch (error: any) {
    console.error('[Loss List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list loss events' });
  }
};

/**
 * Record a risk that actually materialised. Material losses raise an issue
 * automatically so the remediation is tracked like any other finding.
 */
export const createLossEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      title, description, category, occurredAt, discoveredAt,
      grossAmount, recoveredAmount, currency, riskId, tenantId,
    } = req.body || {};

    if (!title || !description || !category) {
      res.status(400).json({ status: 'error', message: 'title, description and category are required' });
      return;
    }
    if (!CATEGORIES.includes(category)) {
      res.status(400).json({ status: 'error', message: `category must be one of: ${CATEGORIES.join(', ')}` });
      return;
    }

    const occurred = new Date(occurredAt);
    const discovered = new Date(discoveredAt);
    if (isNaN(occurred.getTime()) || isNaN(discovered.getTime())) {
      res.status(400).json({ status: 'error', message: 'occurredAt and discoveredAt must both be valid dates' });
      return;
    }
    if (discovered.getTime() < occurred.getTime()) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_DATES',
        message: 'discoveredAt cannot precede occurredAt — a loss cannot be found before it happens.',
      });
      return;
    }

    const gross = Number(grossAmount);
    const recovered = Number(recoveredAmount ?? 0);
    if (!Number.isFinite(gross) || gross < 0) {
      res.status(400).json({ status: 'error', message: 'grossAmount must be a non-negative number' });
      return;
    }
    if (!Number.isFinite(recovered) || recovered < 0 || recovered > gross) {
      res.status(400).json({
        status: 'error',
        code: 'INVALID_RECOVERY',
        message: 'recoveredAmount must be between zero and the gross amount.',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const target = tenantId || req.user!.tenantId;
    if (!scope.tenantIds.includes(target)) {
      res.status(403).json({ status: 'error', message: 'Target tenant is outside your authorized scope' });
      return;
    }

    let risk = null;
    if (riskId) {
      risk = await prisma.risk.findFirst({ where: { id: riskId, tenantId: target } });
      if (!risk) { res.status(404).json({ status: 'error', message: 'Linked risk not found in this tenant' }); return; }
    }

    const net = gross - recovered;
    const ref = await nextLossRef(target);

    const result = await prisma.$transaction(async (tx) => {
      let issue = null;
      if (net >= MATERIALITY_THRESHOLD) {
        issue = await createIssueRecord(tx, {
          tenantId: target,
          source: 'Incident',
          sourceReference: ref,
          title: `Material loss: ${String(title).trim()}`,
          condition: `A ${category} event on ${occurred.toISOString().slice(0, 10)} caused a net loss of ${net.toLocaleString()} ${currency || 'SAR'}.`,
          recommendation: risk
            ? `Determine why the controls on ${risk.ref} did not prevent this and strengthen them.`
            : 'Determine the control failure that allowed this loss and remediate it.',
          riskRating: 'High',
          raisedById: req.user!.id,
        });
      }

      const created = await tx.lossEvent.create({
        data: {
          tenantId: target, ref,
          riskId: riskId || null,
          title: String(title).trim(), description: String(description).trim(), category,
          occurredAt: occurred, discoveredAt: discovered,
          grossAmount: gross, recoveredAmount: recovered, currency: currency || 'SAR',
          status: 'Open', reportedById: req.user!.id, issueId: issue?.id ?? null,
        },
      });

      await writeAudit(tx, {
        tenantId: target, actorId: req.user!.id, action: 'LOSS_EVENT_RECORDED',
        subjectType: SUBJ_LOSS, subjectId: created.id,
        payload: { ref, category, grossAmount: gross, netAmount: net, riskId: riskId || null, issueRaised: issue?.ref ?? null },
      });
      return { event: created, issue };
    });

    res.status(201).json({
      status: 'success',
      message: result.issue
        ? `${ref} recorded — net loss is material, so ${result.issue.ref} was raised automatically.`
        : `${ref} recorded.`,
      event: { ...result.event, netAmount: net },
      issue: result.issue,
    });
  } catch (error: any) {
    console.error('[Loss Create Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record loss event' });
  }
};

/** Update recovery or investigation status as the picture firms up. */
export const updateLossEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { recoveredAmount, status, riskId } = req.body || {};

    const scope = await resolveTenantScope(req.user!.tenantId);
    const event = await prisma.lossEvent.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!event) { res.status(404).json({ status: 'error', message: 'Loss event not found' }); return; }
    if (event.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Closed loss events are immutable' });
      return;
    }

    const data: any = {};
    if (recoveredAmount !== undefined) {
      const recovered = Number(recoveredAmount);
      if (!Number.isFinite(recovered) || recovered < 0 || recovered > event.grossAmount) {
        res.status(400).json({
          status: 'error',
          code: 'INVALID_RECOVERY',
          message: `recoveredAmount must be between zero and the gross amount (${event.grossAmount}).`,
        });
        return;
      }
      data.recoveredAmount = recovered;
    }
    if (status) {
      if (!['Open', 'UnderInvestigation', 'Closed'].includes(status)) {
        res.status(400).json({ status: 'error', message: 'status must be Open, UnderInvestigation or Closed' });
        return;
      }
      data.status = status;
    }
    if (riskId !== undefined) {
      if (riskId) {
        const risk = await prisma.risk.findFirst({ where: { id: riskId, tenantId: event.tenantId } });
        if (!risk) { res.status(404).json({ status: 'error', message: 'Linked risk not found in this tenant' }); return; }
      }
      data.riskId = riskId || null;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.lossEvent.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: event.tenantId, actorId: req.user!.id, action: 'LOSS_EVENT_UPDATED',
        subjectType: SUBJ_LOSS, subjectId: id,
        payload: { ref: event.ref, before: { status: event.status, recoveredAmount: event.recoveredAmount }, after: data },
      });
      return u;
    });

    res.json({
      status: 'success',
      event: { ...updated, netAmount: updated.grossAmount - updated.recoveredAmount },
    });
  } catch (error: any) {
    console.error('[Loss Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update loss event' });
  }
};
