import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import { previewOffboarding, offboardUser } from '../controllers/offboardingController';
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
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  assignUserDepartment,
} from '../controllers/departmentController';

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
// Offboarding is its own grant. Suspension above is gated on ADD_USER, which
// fifteen roles hold including branch HR and support coordinators; this hands
// over every risk, control, document and project somebody owned and then ends
// their access, which is not the same decision.
router.get('/users/:id/offboard-preview', requireCapability(CAP.OFFBOARD_USER), previewOffboarding);
router.post('/users/:id/offboard', requireCapability(CAP.OFFBOARD_USER), offboardUser);

// ── Departments ───────────────────────────────────────────────────────────────
// ADD_USER is the narrowest grant that makes sense for department management:
// the same people who invite users define the org structure they sit in.
router.get('/departments', listDepartments);
router.post('/departments', requireCapability(CAP.ADD_USER), createDepartment);
router.patch('/departments/:id', requireCapability(CAP.ADD_USER), updateDepartment);
router.delete('/departments/:id', requireCapability(CAP.ADD_USER), deleteDepartment);
router.post('/users/:userId/department', requireCapability(CAP.ADD_USER), assignUserDepartment);

export default router;
