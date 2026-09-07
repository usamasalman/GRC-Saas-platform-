import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  getBranding, updateBranding, uploadLogo, getLogo,
} from '../controllers/brandingController';
import {
  listTenants,
  getEntityTree,
  getTenant,
  createTenant,
  onboardTenant,
  updateTenant,
  deleteTenant,
  distributePolicy,
} from '../controllers/tenantController';

const router = Router();

// Note: no enforceTenantIsolation here — scope is resolved per operating model
// by resolveTenantScope() inside each handler (TRD §2.1), which legitimately
// spans tenants for the SaaS control plane.
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// ── Branding ──────────────────────────────────────────────────────────────
//
// Authorised through TENANT scope, not project access. canReadProject and
// sideOf deliberately admit a delivery partner to its client's engagement, so
// routing a branding write through the project check would let a consultancy
// rewrite its client's logo and legal name. These must precede '/:id', which
// would otherwise shadow them.
router.get('/branding', getBranding);
router.patch('/branding', requireCapability(CAP.MANAGE_TENANT), updateBranding);
router.post('/branding/logo', requireCapability(CAP.MANAGE_TENANT), uploadLogo);
router.get('/branding/logo', getLogo);

router.get('/:id/branding', getBranding);
router.patch('/:id/branding', requireCapability(CAP.MANAGE_TENANT), updateBranding);
router.post('/:id/branding/logo', requireCapability(CAP.MANAGE_TENANT), uploadLogo);
router.get('/:id/branding/logo', getLogo);

router.get('/', listTenants);
router.get('/tree', getEntityTree);
router.get('/:id', getTenant);

// Writes gated by the RBAC capability engine (TRD §3.1) — 3 of 42 roles hold this.
router.post('/', requireCapability(CAP.MANAGE_TENANT), createTenant);
// One transaction: entity, subscription and first administrator together, so
// there is never an organization nobody can enter.
router.post('/onboard', requireCapability(CAP.MANAGE_TENANT), onboardTenant);
router.patch('/:id', requireCapability(CAP.MANAGE_TENANT), updateTenant);
router.delete('/:id', requireCapability(CAP.MANAGE_TENANT), deleteTenant);
router.post('/distribute', requireCapability(CAP.VERSION_DOCUMENT), distributePolicy);

export default router;
