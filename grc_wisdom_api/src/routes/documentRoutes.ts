import { Router } from 'express';
import { requireAuth, enforceTenantIsolation, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listDocumentLinks,
  addDocumentLinks,
  removeDocumentLink,
  linkOptions,
  governingDocuments,
} from '../controllers/documentLinkController';
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
  publishOptions,
  myAcknowledgements,
  archiveDocument,
  deleteDocument,
  acknowledgeDocument,
  getAcknowledgements,
  getDocumentStats,
  downloadDocument,
  documentAccessHistory,
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

// Literal segments, all declared above '/:id' — the wildcard would otherwise
// match them and answer "Document not found" for a path that is not an id.
//
// Neither is capability-gated. What a person has been asked to read is theirs,
// and the audience options are what a publisher needs BEFORE the publish call
// can refuse them for choosing badly; the publish itself stays guarded.
router.get('/my-acknowledgements', myAcknowledgements);
router.get('/link-options', linkOptions);
// The reverse direction, which is the one an auditor asks in. Up here with the
// other literals: three segments means '/:id' cannot swallow it today, but the
// rule "literal paths before the wildcard" is the one worth keeping, not the
// segment-counting that happens to make an exception safe.
router.get('/governing/:target/:targetId', governingDocuments);
router.get('/audience-options', publishOptions);

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

// Who has read it. Not capability-gated on the route: the handler narrows it
// to the document's owner and to whoever holds retention and legal hold, and
// a route-level capability would lock the owner out of their own document's
// history.
router.get('/:id/access', documentAccessHistory);

// Acknowledgements
router.post('/:id/acknowledge', acknowledgeDocument);
router.get('/:id/acknowledgements', getAcknowledgements);

// What a policy governs: the control it mandates, the risk it treats, the
// clause it satisfies. Reading is open to anyone who may read the document;
// asserting it carries the same capability as authoring a version, because
// claiming a policy covers a clause is an authoring act with audit consequences.
router.get('/:id/links', listDocumentLinks);
router.post('/:id/links', requireCapability(CAP.VERSION_DOCUMENT), addDocumentLinks);
router.delete('/links/:linkId', requireCapability(CAP.VERSION_DOCUMENT), removeDocumentLink);


export default router;
