import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import {
  listSubscriptions, createSubscription,
  listPlans, createPlan,
  listInvoices, createInvoice, payInvoice,
  listPayments, getGatewayConfig, updateGatewayConfig
} from '../controllers/billingController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// Subscriptions
router.get('/subscriptions', listSubscriptions);
router.post('/subscriptions', createSubscription);

// Plans & Catalogue
router.get('/plans', listPlans);
router.post('/plans', createPlan);

// Invoices (ZATCA compliant)
router.get('/invoices', listInvoices);
router.post('/invoices', createInvoice);
router.post('/invoices/:id/pay', payInvoice);

// Payments & Receipts
router.get('/payments', listPayments);

// Payment Gateway & Tax Config
router.get('/gateway-config', getGatewayConfig);
router.patch('/gateway-config', updateGatewayConfig);

export default router;
