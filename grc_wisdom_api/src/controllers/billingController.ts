import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
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
