import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword, requirePlatformTenant } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  getSystemHealth, triggerSystemJob,
  getSecurityPosture, verifyWormIntegrity,
  getOciArchitecture, getBrdTraceability
} from '../controllers/systemController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);
// Platform internals: service health, the security posture, the architecture
// and the requirement status of the platform itself. None of it belongs to a
// customer, and all of it was served to any signed-in customer user (QA-004).
router.use(requirePlatformTenant);

// Health, Jobs & API Status
router.get('/health', getSystemHealth);
// Every mutating route below carries the capability that governs it.
//
// They did not, and that was not a cosmetic gap: this router mounted only
// requireAuth, so ANY signed-in user — a read-only staff employee included —
// could call them. The capability constants and their role grants have existed
// in rbacData.json the whole time; the middleware was simply never attached, so
// the vocabulary was written and never enforced.
router.post('/jobs/run', requireCapability(CAP.MANAGE_TENANT), triggerSystemJob);

// Security & WORM Audit
router.get('/security', getSecurityPosture);
router.post('/security/verify-worm', requireCapability(CAP.MANAGE_TENANT), verifyWormIntegrity);

// OCI Riyadh Architecture
router.get('/architecture', getOciArchitecture);

// BRD / TRD Traceability
router.get('/brd', getBrdTraceability);

export default router;
