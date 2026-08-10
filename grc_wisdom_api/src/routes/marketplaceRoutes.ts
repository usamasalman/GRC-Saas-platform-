import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import {
  listModules, createModule, configureModule,
  listTools, submitTool, reviewTool, purchaseTool,
  listInstallations, testInstallationHealth,
  listFeatureFlags, createFeatureFlag, toggleFeatureFlag
} from '../controllers/marketplaceController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// ── GRC Modules ─────────────────────────────────────────────────────────────
router.get('/modules', listModules);
router.post('/modules', createModule);
router.patch('/modules/:id', configureModule);

// ── Open Source Tools ───────────────────────────────────────────────────────
router.get('/tools', listTools);
router.post('/tools', submitTool);
router.patch('/tools/:id/review', reviewTool);
router.post('/tools/:id/buy', purchaseTool);

// ── Tenant Tool Installations ────────────────────────────────────────────────
router.get('/installations', listInstallations);
router.post('/installations/:id/health', testInstallationHealth);

// ── Feature Flags ───────────────────────────────────────────────────────────
router.get('/feature-flags', listFeatureFlags);
router.post('/feature-flags', createFeatureFlag);
router.patch('/feature-flags/:id/toggle', toggleFeatureFlag);

export default router;
