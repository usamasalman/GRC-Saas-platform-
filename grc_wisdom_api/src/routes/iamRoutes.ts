import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listCapabilities,
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  previewEffectivePermissions,
} from '../controllers/roleController';
import {
  listUsers,
  listTeams,
  inviteUser,
  assignRole,
  transferUser,
  setUserStatus,
} from '../controllers/userController';

const router = Router();

// Scope is resolved per operating model inside each handler, so no
// enforceTenantIsolation here (it would break legitimate cross-tenant reads).
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// ── Roles & permissions ───────────────────────────────────────────────────
router.get('/capabilities', listCapabilities);
router.get('/roles', listRoles);
router.get('/roles/:id', getRole);
router.post('/roles', requireCapability(CAP.MAINTAIN_ROLES), createRole);
router.patch('/roles/:id', requireCapability(CAP.MAINTAIN_ROLES), updateRole);
router.delete('/roles/:id', requireCapability(CAP.MAINTAIN_ROLES), deleteRole);
router.get('/effective-permissions', previewEffectivePermissions);

// ── User directory & lifecycle ────────────────────────────────────────────
router.get('/users', listUsers);
router.get('/teams', listTeams);
router.post('/users/invite', requireCapability(CAP.ADD_USER), inviteUser);
router.post('/users/:id/role', requireCapability(CAP.MAINTAIN_ROLES), assignRole);
router.post('/users/:id/transfer', requireCapability(CAP.TRANSFER_USER), transferUser);
router.post('/users/:id/status', requireCapability(CAP.ADD_USER), setUserStatus);

export default router;
