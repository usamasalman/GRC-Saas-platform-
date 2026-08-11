import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
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
router.patch('/quotas/:id', updateQuota);

// Rules, Jobs & Execution
router.get('/rules', listRules);
router.post('/rules', createRule);
router.patch('/rules/:id/toggle', toggleRule);
router.post('/rules/:id/run', runRuleNow);

// Imports & Migration
router.get('/imports', listImports);
router.post('/imports', createImport);
router.post('/imports/:id/retry', retryImport);

export default router;
