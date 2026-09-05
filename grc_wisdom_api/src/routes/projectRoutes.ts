import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  closeProject,
} from '../controllers/projectController';

const router = Router();

// Scope is resolved per operating model inside each handler — a consulting
// partner must see engagements outside its own subtree — so there is no
// enforceTenantIsolation here. projectAccess.projectWhere does that work.
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// Reading is open to any authenticated member of a tenant that can see the
// project. Shaping one requires the capability.
router.get('/', listProjects);
router.get('/:id', getProject);

router.post('/', requireCapability(CAP.MANAGE_PROJECT), createProject);
router.patch('/:id', requireCapability(CAP.MANAGE_PROJECT), updateProject);
router.post('/:id/close', requireCapability(CAP.MANAGE_PROJECT), closeProject);

export default router;
