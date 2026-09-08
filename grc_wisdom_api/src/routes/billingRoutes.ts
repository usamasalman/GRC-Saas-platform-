import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listSubscriptions, createSubscription,
  listPlans, createPlan,
  listInvoices, createInvoice, payInvoice,
  listPayments, getGatewayConfig, updateGatewayConfig,
  updatePlan,
  deletePlan,
  updateSubscription,
  deleteSubscription
} from '../controllers/billingController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// Subscriptions
router.get('/subscriptions', listSubscriptions);
// Every mutating route below carries the capability that governs it.
//
// They did not, and that was not a cosmetic gap: this router mounted only
// requireAuth, so ANY signed-in user — a read-only staff employee included —
// could call them. The capability constants and their role grants have existed
// in rbacData.json the whole time; the middleware was simply never attached, so
// the vocabulary was written and never enforced.
router.post('/subscriptions', requireCapability(CAP.MANAGE_SUBSCRIPTION), createSubscription);
// Moving a tenant between plans and ending a subscription are both weekly
// billing-administration tasks and neither existed.
router.patch('/subscriptions/:id', requireCapability(CAP.MANAGE_SUBSCRIPTION), updateSubscription);
router.delete('/subscriptions/:id', requireCapability(CAP.MANAGE_SUBSCRIPTION), deleteSubscription);

// Plans & Catalogue
router.get('/plans', listPlans);
router.post('/plans', requireCapability(CAP.SELECT_PLAN), createPlan);
// Repricing a plan with live subscribers is refused unless the caller confirms,
// because it re-prices every one of them on the next invoice.
router.patch('/plans/:id', requireCapability(CAP.SELECT_PLAN), updatePlan);
router.delete('/plans/:id', requireCapability(CAP.SELECT_PLAN), deletePlan);

// Invoices (ZATCA compliant)
router.get('/invoices', listInvoices);
router.post('/invoices', requireCapability(CAP.REVIEW_INVOICE), createInvoice);
router.post('/invoices/:id/pay', requireCapability(CAP.RECONCILE_PAYMENT), payInvoice);

// Payments & Receipts
router.get('/payments', listPayments);

// Payment Gateway & Tax Config
router.get('/gateway-config', getGatewayConfig);
router.patch('/gateway-config', requireCapability(CAP.RECONCILE_PAYMENT), updateGatewayConfig);

export default router;
