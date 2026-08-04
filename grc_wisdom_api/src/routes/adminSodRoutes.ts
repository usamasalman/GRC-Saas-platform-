import { Router } from 'express';
import { requireAuth, enforceTenantIsolation } from '../middlewares/authMiddleware';
import { listRules, createRule, updateRule, deleteRule } from '../controllers/sodController';
import { requireCapability, CAP } from '../services/capabilityEngine';

const router = Router();

router.use(requireAuth);
router.use(enforceTenantIsolation);

router.get('/', listRules);
router.post('/', requireCapability(CAP.MAINTAIN_ROLES), createRule);
router.patch('/:id', requireCapability(CAP.MAINTAIN_ROLES), updateRule);
router.delete('/:id', requireCapability(CAP.MAINTAIN_ROLES), deleteRule);

export default router;
