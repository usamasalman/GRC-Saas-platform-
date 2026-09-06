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

export default router;
