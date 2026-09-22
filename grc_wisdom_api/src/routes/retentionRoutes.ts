import { Router } from 'express';
import { requireAuth, enforceTenantIsolation, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  assignSchedule,
  dispositionQueue,
  disposeDocument,
} from '../controllers/retentionController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);
router.use(enforceTenantIsolation);

// Literal segments before any '/:id', or the wildcard answers for them.
//
// Reading the schedules is open to anyone who can reach the screen: knowing
// that documents of this class are kept for seven years is the policy, not a
// secret, and a person who cannot see it cannot tell whether their own
// document is covered. Changing one, and destroying anything, is the
// retention capability.
router.get('/schedules', listSchedules);
router.post('/schedules', requireCapability(CAP.RETENTION_HOLD), createSchedule);
router.put('/schedules/:id', requireCapability(CAP.RETENTION_HOLD), updateSchedule);

router.get('/queue', requireCapability(CAP.RETENTION_HOLD), dispositionQueue);

// Binding a schedule is an authoring act with a destruction date attached, so
// it carries the same capability as destroying: setting a one-month schedule
// on a record is the same decision as disposing of it next month.
router.put('/documents/:id/schedule', requireCapability(CAP.RETENTION_HOLD), assignSchedule);
router.post('/documents/:id/dispose', requireCapability(CAP.RETENTION_HOLD), disposeDocument);

export default router;
