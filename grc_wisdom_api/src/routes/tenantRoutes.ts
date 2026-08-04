import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listTenants,
  getEntityTree,
  getTenant,
  createTenant,
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

router.get('/', listTenants);
router.get('/tree', getEntityTree);
router.get('/:id', getTenant);

// Writes gated by the RBAC capability engine (TRD §3.1) — 3 of 42 roles hold this.
router.post('/', requireCapability(CAP.MANAGE_TENANT), createTenant);
router.patch('/:id', requireCapability(CAP.MANAGE_TENANT), updateTenant);
router.delete('/:id', requireCapability(CAP.MANAGE_TENANT), deleteTenant);
router.post('/distribute', requireCapability(CAP.VERSION_DOCUMENT), distributePolicy);

export default router;
