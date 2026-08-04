import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  requestReset,
  completeReset,
  listRequests,
  approveRequest,
  denyRequest,
} from '../controllers/passwordResetController';

const router = Router();

// Public — user-driven flow
router.post('/request', requestReset);
router.post('/complete', completeReset);

// Admin — review + approve/deny
router.get('/admin', requireAuth, requireCapability(CAP.MONITOR_SECURITY), listRequests);
router.post('/admin/:id/approve', requireAuth, requireCapability(CAP.MONITOR_SECURITY), approveRequest);
router.post('/admin/:id/deny', requireAuth, requireCapability(CAP.MONITOR_SECURITY), denyRequest);

export default router;
