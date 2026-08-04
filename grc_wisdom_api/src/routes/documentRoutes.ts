import { Router } from 'express';
import { requireAuth, enforceTenantIsolation, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  checkoutDocument,
  checkinDocument,
  submitForApproval,
  approveDocument,
  rejectDocument,
  publishDocument,
  archiveDocument,
  deleteDocument,
  acknowledgeDocument,
  getAcknowledgements,
  getDocumentStats,
  downloadDocument,
  applyLegalHold,
  releaseLegalHold,
  forceReleaseCheckout,
} from '../controllers/documentController';

const router = Router();

// All document routes require auth + tenant isolation.
// Audit-log entries are written INSIDE each controller's Prisma transaction
// (TRD §6.1 requires audit-write to share the tx with the business write).
router.use(requireAuth);
router.use(rejectIfMustChangePassword);
router.use(enforceTenantIsolation);

// Stats
router.get('/stats', getDocumentStats);

// CRUD
router.get('/', listDocuments);
router.get('/:id', getDocument);
router.get('/:id/download', downloadDocument);
router.post('/', createDocument);
router.put('/:id', updateDocument);
router.delete('/:id', deleteDocument);

// Lifecycle
router.post('/:id/checkout', checkoutDocument);
router.post('/:id/checkin', checkinDocument);
router.post('/:id/submit', submitForApproval);
router.post('/:id/approve', approveDocument);
router.post('/:id/reject', rejectDocument);
router.post('/:id/publish', publishDocument);
router.post('/:id/archive', archiveDocument);

// Admin-tier document operations (require admin role + justification)
router.post('/:id/force-release', requireCapability(CAP.RETENTION_HOLD), forceReleaseCheckout);
router.post('/:id/legal-hold', requireCapability(CAP.RETENTION_HOLD), applyLegalHold);
router.post('/:id/legal-hold/release', requireCapability(CAP.RETENTION_HOLD), releaseLegalHold);

// Acknowledgements
router.post('/:id/acknowledge', acknowledgeDocument);
router.get('/:id/acknowledgements', getAcknowledgements);

export default router;
