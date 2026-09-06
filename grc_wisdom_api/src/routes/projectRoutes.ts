import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  closeProject,
} from '../controllers/projectController';
import {
  getPlan,
  createPhase,
  updatePhase,
  deletePhase,
  createTask,
  updateTask,
  deleteTask,
  taskStatuses,
} from '../controllers/projectPlanController';
import {
  submitTask,
  verifyTask,
  returnTask,
  getVerificationQueue,
  getTaskVerifications,
} from '../controllers/projectVerificationController';

const router = Router();

// Scope is resolved per operating model inside each handler — a consulting
// partner must see engagements outside its own subtree — so there is no
// enforceTenantIsolation here. projectAccess.projectWhere does that work.
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// Reading is open to any authenticated member of a tenant that can see the
// project. Shaping one requires the capability.
router.get('/', listProjects);

// Must precede '/:id' — Express matches in declaration order, and a literal
// path declared after a parameter is shadowed by it. This one would have been
// read as a project whose id is the string "task-statuses".
router.get('/task-statuses', taskStatuses);

router.get('/:id', getProject);

router.post('/', requireCapability(CAP.MANAGE_PROJECT), createProject);
router.patch('/:id', requireCapability(CAP.MANAGE_PROJECT), updateProject);
router.post('/:id/close', requireCapability(CAP.MANAGE_PROJECT), closeProject);

// ── The plan: phases and tasks ────────────────────────────────────────────
//
// Structure is a management act. Reporting on a task you have been assigned is
// not — so updateTask carries the lighter capability and re-checks assignment
// itself, refusing to let an assignee re-plan work they were merely given.
router.get('/:id/plan', getPlan);
router.post('/:id/phases', requireCapability(CAP.MANAGE_PROJECT), createPhase);
router.patch('/phases/:phaseId', requireCapability(CAP.MANAGE_PROJECT), updatePhase);
router.delete('/phases/:phaseId', requireCapability(CAP.MANAGE_PROJECT), deletePhase);

router.post('/phases/:phaseId/tasks', requireCapability(CAP.MANAGE_PROJECT), createTask);
router.patch('/tasks/:taskId', requireCapability(CAP.EXECUTE_PROJECT_WORK), updateTask);
router.delete('/tasks/:taskId', requireCapability(CAP.MANAGE_PROJECT), deleteTask);

// ── Verification ──────────────────────────────────────────────────────────
//
// The capability split is the whole control. Submitting is part of doing the
// work; accepting it is a separate duty held by a separate capability, and no
// route lets one call do both. The handlers then add the rule a capability
// cannot express — that this particular person did not do this particular task.
router.get('/:id/verification', getVerificationQueue);
router.get('/tasks/:taskId/verifications', getTaskVerifications);

router.post('/tasks/:taskId/submit', requireCapability(CAP.EXECUTE_PROJECT_WORK), submitTask);
router.post('/tasks/:taskId/verify', requireCapability(CAP.VERIFY_PROJECT_WORK), verifyTask);
// Withdrawing your own submission is ordinary work; reopening a verified task
// is not, and returnTask requires MANAGE_PROJECT itself for that case.
router.post('/tasks/:taskId/return', requireCapability(CAP.EXECUTE_PROJECT_WORK), returnTask);

export default router;
