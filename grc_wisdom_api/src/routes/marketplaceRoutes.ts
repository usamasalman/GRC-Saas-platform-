import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
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
// Every mutating route below carries the capability that governs it.
//
// They did not, and that was not a cosmetic gap: this router mounted only
// requireAuth, so ANY signed-in user — a read-only staff employee included —
// could call them. The capability constants and their role grants have existed
// in rbacData.json the whole time; the middleware was simply never attached, so
// the vocabulary was written and never enforced.
router.post('/modules', requireCapability(CAP.PUBLISH_MODULE), createModule);
router.patch('/modules/:id', requireCapability(CAP.PUBLISH_MODULE), configureModule);

// ── Open Source Tools ───────────────────────────────────────────────────────
router.get('/tools', listTools);
router.post('/tools', requireCapability(CAP.ONBOARD_TOOL), submitTool);
router.patch('/tools/:id/review', requireCapability(CAP.ONBOARD_TOOL), reviewTool);
router.post('/tools/:id/buy', requireCapability(CAP.ONBOARD_TOOL), purchaseTool);

// ── Tenant Tool Installations ────────────────────────────────────────────────
router.get('/installations', listInstallations);
router.post('/installations/:id/health', requireCapability(CAP.ONBOARD_TOOL), testInstallationHealth);

// ── Feature Flags ───────────────────────────────────────────────────────────
router.get('/feature-flags', listFeatureFlags);
router.post('/feature-flags', requireCapability(CAP.GOVERN_FLAG), createFeatureFlag);
router.patch('/feature-flags/:id/toggle', requireCapability(CAP.GOVERN_FLAG), toggleFeatureFlag);

export default router;
