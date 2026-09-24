import { Router } from 'express';
import { requireAuth, enforceTenantIsolation, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listMatters,
  createMatter,
  getMatter,
  placeHolds,
  releaseHold,
  releaseMatter,
  documentHolds,
} from '../controllers/legalHoldController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);
router.use(enforceTenantIsolation);

// Literal segments before any '/:id'. 'documents' and 'holds' would otherwise
// be matched as matter ids and answered with "Matter not found".
//
// Reading what holds a document is open: somebody wondering why they cannot
// edit a policy should be told it is held and for what matter, rather than
// left with a 423 and no explanation. Everything about the matters themselves
// — reading them included — carries the retention capability: a matter's title
// and description are privileged, and were readable by every member (QA-003).
router.get('/documents/:id/holds', documentHolds);
router.post('/holds/:holdId/release', requireCapability(CAP.RETENTION_HOLD), releaseHold);

router.get('/matters', requireCapability(CAP.RETENTION_HOLD), listMatters);
router.post('/matters', requireCapability(CAP.RETENTION_HOLD), createMatter);
router.get('/matters/:id', requireCapability(CAP.RETENTION_HOLD), getMatter);
router.post('/matters/:id/holds', requireCapability(CAP.RETENTION_HOLD), placeHolds);
router.post('/matters/:id/release', requireCapability(CAP.RETENTION_HOLD), releaseMatter);

export default router;
