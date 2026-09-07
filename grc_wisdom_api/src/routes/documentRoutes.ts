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
// Authoring and approving are separate capabilities on purpose: whoever writes
// a policy should not be the one who signs it off, and both already existed —
// SIGN_DOCUMENT was defined and attached to no route at all.
//
// acknowledge is deliberately left open below. Acknowledging a policy assigned
// to you is the whole of a staff employee's job in this module, and gating it
// would lock out the people it exists for.
router.post('/', requireCapability(CAP.VERSION_DOCUMENT), createDocument);
router.put('/:id', requireCapability(CAP.VERSION_DOCUMENT), updateDocument);
router.delete('/:id', requireCapability(CAP.VERSION_DOCUMENT), deleteDocument);

// Lifecycle
router.post('/:id/checkout', requireCapability(CAP.VERSION_DOCUMENT), checkoutDocument);
router.post('/:id/checkin', requireCapability(CAP.VERSION_DOCUMENT), checkinDocument);
router.post('/:id/submit', requireCapability(CAP.VERSION_DOCUMENT), submitForApproval);
router.post('/:id/approve', requireCapability(CAP.SIGN_DOCUMENT), approveDocument);
router.post('/:id/reject', requireCapability(CAP.SIGN_DOCUMENT), rejectDocument);
router.post('/:id/publish', requireCapability(CAP.SIGN_DOCUMENT), publishDocument);
router.post('/:id/archive', requireCapability(CAP.VERSION_DOCUMENT), archiveDocument);

// Admin-tier document operations (require admin role + justification)
router.post('/:id/force-release', requireCapability(CAP.RETENTION_HOLD), forceReleaseCheckout);
router.post('/:id/legal-hold', requireCapability(CAP.RETENTION_HOLD), applyLegalHold);
router.post('/:id/legal-hold/release', requireCapability(CAP.RETENTION_HOLD), releaseLegalHold);

// Acknowledgements
router.post('/:id/acknowledge', acknowledgeDocument);
router.get('/:id/acknowledgements', getAcknowledgements);

export default router;
