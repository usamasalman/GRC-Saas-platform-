import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listQuotas, updateQuota,
  listRules, createRule, toggleRule, runRuleNow,
  listImports, createImport, retryImport
} from '../controllers/usageController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// Resource Usage & Quotas
router.get('/quotas', listQuotas);
// Every mutating route below carries the capability that governs it.
//
// They did not, and that was not a cosmetic gap: this router mounted only
// requireAuth, so ANY signed-in user — a read-only staff employee included —
// could call them. The capability constants and their role grants have existed
// in rbacData.json the whole time; the middleware was simply never attached, so
// the vocabulary was written and never enforced.
router.patch('/quotas/:id', requireCapability(CAP.MONITOR_QUOTAS), updateQuota);

// Rules, Jobs & Execution
router.get('/rules', listRules);
router.post('/rules', requireCapability(CAP.MONITOR_QUOTAS), createRule);
router.patch('/rules/:id/toggle', requireCapability(CAP.MONITOR_QUOTAS), toggleRule);
router.post('/rules/:id/run', requireCapability(CAP.MONITOR_QUOTAS), runRuleNow);

// Imports & Migration
router.get('/imports', listImports);
router.post('/imports', requireCapability(CAP.MONITOR_QUOTAS), createImport);
router.post('/imports/:id/retry', requireCapability(CAP.MONITOR_QUOTAS), retryImport);

export default router;
