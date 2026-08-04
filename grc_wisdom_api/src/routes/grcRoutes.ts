import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, requireAnyCapability, CAP } from '../services/capabilityEngine';
import {
  listStandards, enableStandard,
  listControls,
  listImplementations, getImplementation, createImplementation,
  updateImplementation, validateImplementation,
  addEvidence, reviewEvidence,
} from '../controllers/grcController';
import {
  listRisks, createRisk, updateRisk, setRiskControls,
  addTreatment, completeTreatment, acceptRisk,
} from '../controllers/riskController';
import {
  listAudits, getAudit, createAudit, updateAudit,
  raiseFinding, updateFinding, closeFinding, reopenFinding,
} from '../controllers/auditProgrammeController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// ── Standards ─────────────────────────────────────────────────────────────
router.get('/standards', listStandards);
router.post('/standards/enable', requireCapability(CAP.ENABLE_STANDARD), enableStandard);

// ── Control library ───────────────────────────────────────────────────────
router.get('/controls', listControls);

// ── Implementations + evidence ────────────────────────────────────────────
router.get('/implementations', listImplementations);
router.get('/implementations/:id', getImplementation);
router.post('/implementations', requireCapability(CAP.MANAGE_IMPLEMENTATION), createImplementation);
router.patch('/implementations/:id', requireCapability(CAP.MANAGE_IMPLEMENTATION), updateImplementation);
router.post('/implementations/:id/validate', requireCapability(CAP.MANAGE_IMPLEMENTATION), validateImplementation);
router.post('/implementations/:id/evidence', requireCapability(CAP.MANAGE_IMPLEMENTATION), addEvidence);
router.post('/evidence/:id/review', requireCapability(CAP.MANAGE_IMPLEMENTATION), reviewEvidence);

// ── Risk register ─────────────────────────────────────────────────────────
router.get('/risks', listRisks);
router.post('/risks', requireCapability(CAP.ASSESS_RISK), createRisk);
router.patch('/risks/:id', requireCapability(CAP.ASSESS_RISK), updateRisk);
router.post('/risks/:id/links', requireCapability(CAP.ASSESS_RISK), setRiskControls);
router.post('/risks/:id/treatments', requireCapability(CAP.ASSESS_RISK), addTreatment);
router.post('/treatments/:id/complete', requireCapability(CAP.ASSESS_RISK), completeTreatment);
router.post('/risks/:id/accept', requireCapability(CAP.ASSESS_RISK), acceptRisk);

// ── Audit programme ───────────────────────────────────────────────────────
router.get('/audits', listAudits);
router.get('/audits/:id', getAudit);
router.post('/audits', requireCapability(CAP.EXECUTE_AUDIT), createAudit);
router.patch('/audits/:id', requireCapability(CAP.EXECUTE_AUDIT), updateAudit);
router.post('/audits/:id/findings', requireCapability(CAP.EXECUTE_AUDIT), raiseFinding);
// CAP owners are often control owners, not auditors — allow either capability.
router.patch('/findings/:id', requireAnyCapability(CAP.EXECUTE_AUDIT, CAP.MANAGE_IMPLEMENTATION), updateFinding);
router.post('/findings/:id/close', requireCapability(CAP.EXECUTE_AUDIT), closeFinding);
router.post('/findings/:id/reopen', requireCapability(CAP.EXECUTE_AUDIT), reopenFinding);

export default router;
