import { Router } from 'express';
import { requireAuth } from '../middlewares/authMiddleware';
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
