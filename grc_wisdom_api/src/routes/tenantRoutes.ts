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
import { suspendTenant, reactivateTenant } from '../controllers/tenantSuspensionController';

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

// ':tenantId', not ':id': the handlers read req.params.tenantId and fall back
// to the caller's own organisation, so under ':id' every one of these quietly
// read and rewrote the caller's branding instead of the target's (QA-006).
router.get('/:tenantId/branding', getBranding);
router.patch('/:tenantId/branding', requireCapability(CAP.MANAGE_TENANT), updateBranding);
router.post('/:tenantId/branding/logo', requireCapability(CAP.MANAGE_TENANT), uploadLogo);
router.get('/:tenantId/branding/logo', getLogo);

router.get('/', listTenants);
router.get('/tree', getEntityTree);
router.get('/:id', getTenant);

// Writes gated by the RBAC capability engine (TRD §3.1) — 3 of 42 roles hold this.
router.post('/', requireCapability(CAP.MANAGE_TENANT), createTenant);
// One transaction: entity, subscription and first administrator together, so
// there is never an organization nobody can enter.
router.post('/onboard', requireCapability(CAP.MANAGE_TENANT), onboardTenant);

// Stopping a customer without destroying them. Until now the only way to end a
// relationship was deleteTenant, which refuses while the tenant holds users,
// documents or invoices — so for any real customer there was no way at all.
//
// Declared above '/:id' below so the literal segments are not read as ids.
router.post('/:id/suspend', requireCapability(CAP.MANAGE_TENANT), suspendTenant);
router.post('/:id/reactivate', requireCapability(CAP.MANAGE_TENANT), reactivateTenant);
router.patch('/:id', requireCapability(CAP.MANAGE_TENANT), updateTenant);
router.delete('/:id', requireCapability(CAP.MANAGE_TENANT), deleteTenant);
router.post('/distribute', requireCapability(CAP.VERSION_DOCUMENT), distributePolicy);

export default router;
