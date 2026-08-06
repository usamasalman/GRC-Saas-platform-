import { Router } from 'express';
import { requireAuth, requirePlatformTenant } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  getTableRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  resetDatabase,
  verifyAuditTrail,
} from '../controllers/dbAdminController';

const router = Router();

router.use(requireAuth);
// Raw table access is a security-monitoring capability, not a name match.
// Two independent gates: the tool is operator-only regardless of how a
// capability was acquired, AND still needs the security capability.
router.use(requirePlatformTenant);
router.use(requireCapability(CAP.MONITOR_SECURITY));

// Table operations
router.get('/table/:model', getTableRecords);
router.post('/table/:model', createRecord);
router.put('/table/:model/:id', updateRecord);
router.delete('/table/:model/:id', deleteRecord);

// Utility actions
router.post('/reset', resetDatabase);
router.get('/verify-audit', verifyAuditTrail);

export default router;
