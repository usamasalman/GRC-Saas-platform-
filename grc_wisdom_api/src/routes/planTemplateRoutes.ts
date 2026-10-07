import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listTemplates, getTemplate, similarLibraryTasks, createVersion, retireTemplate, saveFromProject,
} from '../controllers/planTemplateController';

/**
 * The plan template library (consulting engagement, sprint 3).
 *
 * Reading is open to anyone signed in, filtered to the templates they may
 * see: the platform's, and their own organisation's or firm's. Shaping a
 * library is a planning act and carries MANAGE_PROJECT; which library a caller
 * may shape is decided per template in the service layer.
 */
const router = Router();
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

router.get('/', listTemplates);
// Literal paths before '/:id', which would otherwise swallow them.
router.get('/similar-tasks', similarLibraryTasks);
router.post('/from-project/:projectId', requireCapability(CAP.MANAGE_PROJECT), saveFromProject);
router.get('/:id', getTemplate);
router.post('/:id/versions', requireCapability(CAP.MANAGE_PROJECT), createVersion);
router.post('/:id/retire', requireCapability(CAP.MANAGE_PROJECT), retireTemplate);

export default router;
