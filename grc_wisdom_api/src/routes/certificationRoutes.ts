import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  myCertifications, respondToInvitation, bodyView, packItemFile, askQuestion,
} from '../controllers/engagementCertificationController';

/**
 * The certification body's own routes (consulting engagement, sprint 13).
 *
 * An auditor organisation reads the engagements it is invited to: the frozen
 * audit pack and its own questions, inside the days the organisation set.
 * Answering an invitation and asking are audit work. Every route answers
 * anyone else, and the body outside its days, with a 404; the controller
 * writes each refused read to the organisation's trail.
 */
const router = Router();
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

router.get('/mine', myCertifications);
router.post('/:accessId/respond', requireCapability(CAP.EXECUTE_AUDIT), respondToInvitation);
router.get('/:accessId', bodyView);
router.get('/:accessId/items/:itemId/file', packItemFile);
router.post('/:accessId/questions', requireCapability(CAP.EXECUTE_AUDIT), askQuestion);

export default router;
