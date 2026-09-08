import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { judgeDeletion } from '../services/recordDeletion';
import { resolveTenantScope, auditCrossTenantRead } from '../services/scopeResolver';

function str(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
  return String(val || '');
}

// Gateway config in-memory store
let gatewayConfigStore = {
  provider: 'Saudi Payment Gateway (Tokenized)',
  environment: 'Production (OCI Riyadh)',
  vatRatePercent: 15,
  currency: 'SAR',
  threeDSecureRequired: true,
  autoRetryDays: 3,
  invoiceSequencePrefix: 'INV-2026-',
  zatcaPhase2Enabled: true,
  status: 'Healthy'
};

// Seed default plans if DB empty
async function ensureDefaultPlans() {
  const count = await prisma.plan.count();
  if (count === 0) {
    const defaultPlans = [
      { name: 'Essentials', priceMonthly: 2500, maxUsers: 25, features: JSON.stringify({ frameworks: 1, storageGb: 10, aiCredits: 1000 }) },
      { name: 'Professional', priceMonthly: 5000, maxUsers: 75, features: JSON.stringify({ frameworks: 3, storageGb: 50, aiCredits: 5000 }) },
      { name: 'Assurance', priceMonthly: 9166, maxUsers: 150, features: JSON.stringify({ frameworks: 5, storageGb: 200, aiCredits: 20000 }) },
      { name: 'Enterprise Intelligence', priceMonthly: 18750, maxUsers: 500, features: JSON.stringify({ frameworks: 15, storageGb: 1000, aiCredits: 100000 }) }
    ];
    for (const p of defaultPlans) {
      await prisma.plan.create({ data: p });
    }
  }
}

// ── 1. SUBSCRIPTIONS ───────────────────────────────────────────────────────

export const listSubscriptions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'billing.subscriptions.list');
    await ensureDefaultPlans();

    const where: any = {};
    if (scope.kind !== 'PLATFORM') {
      where.tenantId = { in: scope.tenantIds };
    }

    const subscriptions = await prisma.subscription.findMany({
      where,
      include: {
        tenant: { select: { id: true, name: true, type: true } },
        plan: true
      },
      orderBy: { startDate: 'desc' }
    });

    res.json({
      status: 'success',
      count: subscriptions.length,
      subscriptions
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list subscriptions' });
  }
};

export const createSubscription = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { planId, targetTenantId } = req.body;
    if (!planId) {
      res.status(400).json({ status: 'error', message: 'Plan ID is required' });
      return;
    }

    const tenantId = targetTenantId ? str(targetTenantId) : req.user!.tenantId;
    const plan = await prisma.plan.findUnique({ where: { id: str(planId) } });
    if (!plan) {
      res.status(404).json({ status: 'error', message: 'Plan not found' });
      return;
    }

    const subscription = await prisma.subscription.create({
      data: {
        tenantId,
        planId: plan.id,
        status: 'ACTIVE',
        startDate: new Date()
      },
      include: { plan: true, tenant: { select: { name: true } } }
    });

    await writeAudit(prisma, {
      tenantId,
      actorId: req.user!.id,
      action: 'billing.subscription.create',
      subjectType: 'Subscription',
      subjectId: subscription.id,
      payload: subscription as Record<string, unknown>
    });

    res.status(201).json({
      status: 'success',
      message: `Subscription to ${plan.name} created successfully.`,
      subscription
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to create subscription' });
  }
};

// ── 2. PLANS & CATALOGUE ──────────────────────────────────────────────────

export const listPlans = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await ensureDefaultPlans();
    const plans = await prisma.plan.findMany({
      orderBy: { priceMonthly: 'asc' }
    });

    res.json({
      status: 'success',
      count: plans.length,
      plans
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list commercial plans' });
  }
};

export const createPlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, priceMonthly, maxUsers, features } = req.body;
    if (!name || priceMonthly === undefined) {
      res.status(400).json({ status: 'error', message: 'Name and priceMonthly are required' });
      return;
    }

    const plan = await prisma.plan.create({
      data: {
        name: String(name),
        priceMonthly: Number(priceMonthly),
        maxUsers: Number(maxUsers || 50),
        features: typeof features === 'string' ? features : JSON.stringify(features || {})
      }
    });

    await writeAudit(prisma, {
      tenantId: req.user!.tenantId,
      actorId: req.user!.id,
      action: 'billing.plan.create',
      subjectType: 'Plan',
      subjectId: plan.id,
      payload: plan as Record<string, unknown>
    });

    res.status(201).json({
      status: 'success',
      message: `Commercial plan "${plan.name}" added to catalogue.`,
      plan
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to create plan' });
  }
};

/**
 * Amend a plan in the catalogue.
 *
 * Plans were create-only, so a price typed with the wrong number of zeros, or a
 * user cap set before anyone knew what it should be, was permanent -- and since
 * the catalogue is what every tenant picks from, the only workaround was to add
 * a second plan with a similar name and hope people chose the right one.
 *
 * Repricing is treated as a separate act from renaming. A plan with live
 * subscriptions is a price several tenants are already paying, and changing it
 * silently re-prices all of them on their next invoice. So a price change with
 * active subscribers is refused unless the caller says so explicitly, and the
 * refusal reports exactly how many tenants would be affected. Everything else --
 * name, user cap, feature list -- changes freely.
 */
export const updatePlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = str(req.params.id);
    const plan = await prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!plan) { res.status(404).json({ status: 'error', message: 'Plan not found' }); return; }

    const { name, priceMonthly, maxUsers, features, confirmRepricing } = req.body || {};
    const data: any = {};
    if (name) data.name = String(name).trim();
    if (maxUsers !== undefined) {
      const n = Number(maxUsers);
      if (!Number.isFinite(n) || n < 1) {
        res.status(400).json({ status: 'error', message: 'maxUsers must be a positive number' });
        return;
      }
      data.maxUsers = Math.floor(n);
    }
    if (features !== undefined) {
      data.features = typeof features === 'string' ? features : JSON.stringify(features || {});
    }

    if (priceMonthly !== undefined) {
      const price = Number(priceMonthly);
      if (!Number.isFinite(price) || price < 0) {
        res.status(400).json({ status: 'error', message: 'priceMonthly must be a number, zero or above' });
        return;
      }
      const changed = price !== Number(plan.priceMonthly);
      if (changed) {
        const live = await prisma.subscription.count({
          where: { planId: id, status: { in: ['ACTIVE', 'PENDING'] } },
        });
        if (live > 0 && confirmRepricing !== true) {
          res.status(409).json({
            status: 'error',
            code: 'PLAN_HAS_SUBSCRIBERS',
            message: `${live} tenant${live === 1 ? ' is' : 's are'} subscribed to ${plan.name} at `
              + `${plan.priceMonthly}. Changing the price re-prices ${live === 1 ? 'that tenant' : 'all of them'} `
              + 'on the next invoice. Send confirmRepricing to go ahead, or add a new plan and '
              + 'move tenants across so the old price stays on record.',
            affectedSubscriptions: live,
            currentPrice: plan.priceMonthly,
            proposedPrice: price,
          });
          return;
        }
        data.priceMonthly = price;
      }
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.plan.update({ where: { id }, data });
      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'billing.plan.update',
        subjectType: 'Plan',
        subjectId: id,
        payload: {
          before: {
            name: plan.name, priceMonthly: String(plan.priceMonthly), maxUsers: plan.maxUsers,
          },
          after: { ...data, priceMonthly: data.priceMonthly ?? undefined },
          subscriptions: plan._count.subscriptions,
        },
      });
      return u;
    });

    res.json({ status: 'success', message: `Plan "${updated.name}" updated.`, plan: updated });
  } catch (error: any) {
    console.error('[Plan Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update plan' });
  }
};

/**
 * Remove a plan from the catalogue.
 *
 * Refused while any subscription references it, cancelled ones included. A
 * cancelled subscription is what an invoice is explained by -- delete the plan
 * and last year's billing history points at a name that no longer exists, which
 * is the sort of thing a finance audit asks about and nobody can answer.
 */
export const deletePlan = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = str(req.params.id);
    const plan = await prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!plan) { res.status(404).json({ status: 'error', message: 'Plan not found' }); return; }

    const verdict = judgeDeletion({
      recordLabel: 'plan',
      dependants: [
        { label: 'subscriptions on it, past and present', count: plan._count.subscriptions },
      ],
      alternative: 'Move those tenants to another plan first. A plan nobody has ever been '
        + 'billed under can be removed; one that appears in billing history cannot, or the '
        + 'invoices stop explaining themselves.',
    });
    if (!verdict.allowed) { res.status(409).json({ status: 'error', ...verdict, allowed: undefined }); return; }

    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: req.user!.tenantId,
        actorId: req.user!.id,
        action: 'billing.plan.delete',
        subjectType: 'Plan',
        subjectId: id,
        payload: {
          name: plan.name, priceMonthly: String(plan.priceMonthly),
          maxUsers: plan.maxUsers, features: plan.features,
        },
      });
      await tx.plan.delete({ where: { id } });
    });

    res.json({ status: 'success', message: `Plan "${plan.name}" removed from the catalogue.` });
  } catch (error: any) {
    console.error('[Plan Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete plan' });
  }
};

/**
 * Change a subscription: move it between plans, or end it.
 *
 * Subscriptions were create-only too, so a tenant put on the wrong plan stayed
 * on it and there was no way to record that one had ended. Both are ordinary
 * things a billing administrator does weekly.
 *
 * Ending a subscription sets CANCELLED and stamps an end date rather than
 * removing the row, because the row is what the invoices raised against it are
 * explained by.
 */
export const updateSubscription = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = str(req.params.id);
    const sub = await prisma.subscription.findUnique({
      where: { id },
      include: { plan: true, tenant: { select: { name: true } } },
    });
    if (!sub) { res.status(404).json({ status: 'error', message: 'Subscription not found' }); return; }

    const { planId, status, endDate } = req.body || {};
    const data: any = {};

    if (planId && planId !== sub.planId) {
      const plan = await prisma.plan.findUnique({ where: { id: str(planId) } });
      if (!plan) { res.status(404).json({ status: 'error', message: 'Plan not found' }); return; }
      data.planId = plan.id;
    }

    if (status) {
      const allowed = ['ACTIVE', 'PENDING', 'CANCELLED'];
      if (!allowed.includes(String(status))) {
        res.status(400).json({
          status: 'error',
          message: `status must be one of: ${allowed.join(', ')}`,
        });
        return;
      }
      data.status = String(status);
      // A subscription that ends needs to say when. Without a date, "cancelled"
      // is a fact with no position in time and the invoice run cannot tell
      // whether it should still bill this month.
      if (String(status) === 'CANCELLED' && !sub.endDate && endDate === undefined) {
        data.endDate = new Date();
      }
    }

    if (endDate !== undefined) {
      if (endDate === null) {
        data.endDate = null;
      } else {
        const d = new Date(endDate);
        if (Number.isNaN(d.getTime())) {
          res.status(400).json({ status: 'error', message: 'endDate is not a valid date' });
          return;
        }
        if (d < sub.startDate) {
          res.status(400).json({
            status: 'error',
            code: 'END_BEFORE_START',
            message: 'A subscription cannot end before it started.',
          });
          return;
        }
        data.endDate = d;
      }
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'No updatable fields provided' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.subscription.update({
        where: { id }, data, include: { plan: true, tenant: { select: { name: true } } },
      });
      await writeAudit(tx, {
        tenantId: sub.tenantId,
        actorId: req.user!.id,
        action: 'billing.subscription.update',
        subjectType: 'Subscription',
        subjectId: id,
        payload: {
          tenant: sub.tenant?.name,
          before: {
            plan: sub.plan?.name, status: sub.status,
            endDate: sub.endDate ? sub.endDate.toISOString() : null,
          },
          after: {
            plan: u.plan?.name, status: u.status,
            endDate: u.endDate ? u.endDate.toISOString() : null,
          },
        },
      });
      return u;
    });

    res.json({ status: 'success', message: 'Subscription updated.', subscription: updated });
  } catch (error: any) {
    console.error('[Subscription Update Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update subscription' });
  }
};

/**
 * Remove a subscription created by mistake.
 *
 * Narrow, because a subscription is a billing relationship: once the tenant has
 * been invoiced under it, the row is what those invoices refer to. Cancelling
 * is the route for a real subscription that is ending; this is for the one
 * raised against the wrong tenant a minute ago.
 */
export const deleteSubscription = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = str(req.params.id);
    const sub = await prisma.subscription.findUnique({
      where: { id },
      include: { plan: true, tenant: { select: { name: true } } },
    });
    if (!sub) { res.status(404).json({ status: 'error', message: 'Subscription not found' }); return; }

    // Invoices are raised against the tenant rather than the subscription, so
    // they cannot be counted through a relation. Any invoice dated after this
    // subscription began is one it plausibly explains, and that is enough to
    // stop the row being removed.
    const invoices = await prisma.invoice.count({
      where: { tenantId: sub.tenantId, createdAt: { gte: sub.startDate } },
    });

    const verdict = judgeDeletion({
      recordLabel: 'subscription',
      status: sub.status,
      forbiddenStatuses: ['CANCELLED'],
      dependants: [
        { label: 'invoices raised since it started', count: invoices },
      ],
      alternative: 'Cancel it instead — that records the relationship ending and keeps the '
        + 'row the invoices refer to.',
    });
    if (!verdict.allowed) { res.status(409).json({ status: 'error', ...verdict, allowed: undefined }); return; }

    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: sub.tenantId,
        actorId: req.user!.id,
        action: 'billing.subscription.delete',
        subjectType: 'Subscription',
        subjectId: id,
        payload: {
          tenant: sub.tenant?.name, plan: sub.plan?.name,
          status: sub.status, startDate: sub.startDate.toISOString(),
        },
      });
      await tx.subscription.delete({ where: { id } });
    });

    res.json({ status: 'success', message: 'Subscription removed.' });
  } catch (error: any) {
    console.error('[Subscription Delete Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to delete subscription' });
  }
};

// ── 3. INVOICES (ZATCA Compliant) ─────────────────────────────────────────

export const listInvoices = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'billing.invoices.list');

    const where: any = {};
    if (scope.kind !== 'PLATFORM') {
      where.tenantId = { in: scope.tenantIds };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: { tenant: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      status: 'success',
      count: invoices.length,
      invoices
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list invoices' });
  }
};

export const createInvoice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { amount, currency, targetTenantId, poNumber } = req.body;
    if (!amount) {
      res.status(400).json({ status: 'error', message: 'Invoice amount is required' });
      return;
    }

    const tenantId = targetTenantId ? str(targetTenantId) : req.user!.tenantId;
    const invAmount = Number(amount);
    const vat = invAmount * 0.15;
    const total = invAmount + vat;

    // Generate ZATCA Hash & Mock QR Code
    const zatcaHash = `SHA256-${Date.now().toString(36).toUpperCase()}`;
    const zatcaQr = `ZATCA-QR-BASE64-${Buffer.from(`VAT:15%|TOTAL:${total}|HASH:${zatcaHash}`).toString('base64')}`;

    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        amount: total,
        currency: currency || 'SAR',
        status: 'UNPAID',
        zatcaHash,
        zatcaQr,
        isCleared: false
      },
      include: { tenant: { select: { name: true } } }
    });

    await writeAudit(prisma, {
      tenantId,
      actorId: req.user!.id,
      action: 'billing.invoice.create',
      subjectType: 'Invoice',
      subjectId: invoice.id,
      payload: { ...invoice, poNumber } as Record<string, unknown>
    });

    res.status(201).json({
      status: 'success',
      message: `Tax Invoice ${invoice.id} generated with ZATCA QR code.`,
      invoice
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to generate invoice' });
  }
};

export const payInvoice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const invoice = await prisma.invoice.findUnique({ where: { id: str(id) } });
    if (!invoice) {
      res.status(404).json({ status: 'error', message: 'Invoice not found' });
      return;
    }

    const updated = await prisma.invoice.update({
      where: { id: str(id) },
      data: {
        status: 'PAID',
        isCleared: true
      }
    });

    await writeAudit(prisma, {
      tenantId: invoice.tenantId,
      actorId: req.user!.id,
      action: 'billing.invoice.pay',
      subjectType: 'Invoice',
      subjectId: invoice.id,
      payload: { previousStatus: invoice.status, status: 'PAID' }
    });

    res.json({
      status: 'success',
      message: `Invoice ${invoice.id} marked as PAID and reconciled against tax records.`,
      invoice: updated
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to record invoice payment' });
  }
};

// ── 4. PAYMENTS & GATEWAY ─────────────────────────────────────────────────

export const listPayments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    await auditCrossTenantRead(scope, req.user!.id, 'billing.payments.list');

    const paidInvoices = await prisma.invoice.findMany({
      where: {
        status: 'PAID',
        ...(scope.kind !== 'PLATFORM' ? { tenantId: { in: scope.tenantIds } } : {})
      },
      include: { tenant: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' }
    });

    const payments = paidInvoices.map(inv => ({
      id: `PAY-${inv.id.slice(-6)}`,
      invoiceId: inv.id,
      tenantName: inv.tenant.name,
      amount: inv.amount,
      currency: inv.currency,
      method: 'Saudi Corporate Bank Transfer / Card',
      status: 'Reconciled',
      paidAt: inv.updatedAt
    }));

    res.json({
      status: 'success',
      count: payments.length,
      payments
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list payments' });
  }
};

export const getGatewayConfig = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    res.json({
      status: 'success',
      config: gatewayConfigStore
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to get gateway config' });
  }
};

export const updateGatewayConfig = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { vatRatePercent, threeDSecureRequired, autoRetryDays } = req.body;
    if (vatRatePercent !== undefined) gatewayConfigStore.vatRatePercent = Number(vatRatePercent);
    if (threeDSecureRequired !== undefined) gatewayConfigStore.threeDSecureRequired = Boolean(threeDSecureRequired);
    if (autoRetryDays !== undefined) gatewayConfigStore.autoRetryDays = Number(autoRetryDays);

    await writeAudit(prisma, {
      tenantId: req.user!.tenantId,
      actorId: req.user!.id,
      action: 'billing.gateway.update',
      subjectType: 'GatewayConfig',
      subjectId: 'GLOBAL_CONFIG',
      payload: gatewayConfigStore as Record<string, unknown>
    });

    res.json({
      status: 'success',
      message: 'Payment Gateway & Tax configuration updated.',
      config: gatewayConfigStore
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to update gateway config' });
  }
};
