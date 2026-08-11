import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import {
  getSystemHealth, triggerSystemJob,
  getSecurityPosture, verifyWormIntegrity,
  getOciArchitecture, getBrdTraceability
} from '../controllers/systemController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// Health, Jobs & API Status
router.get('/health', getSystemHealth);
router.post('/jobs/run', triggerSystemJob);

// Security & WORM Audit
router.get('/security', getSecurityPosture);
router.post('/security/verify-worm', verifyWormIntegrity);

// OCI Riyadh Architecture
router.get('/architecture', getOciArchitecture);

// BRD / TRD Traceability
router.get('/brd', getBrdTraceability);

export default router;
