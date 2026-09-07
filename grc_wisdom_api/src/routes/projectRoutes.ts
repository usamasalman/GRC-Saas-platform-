import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  closeProject,
  rebaselineProject,
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
  exportDeliveryReport,
  getReportRegister,
} from '../controllers/deliveryReportController';
import {
  attachEvidence,
  downloadEvidence,
  withdrawEvidence,
  linkClauses,
  unlinkClause,
  getEvidenceRegister,
  verifyEvidenceIntegrity,
} from '../controllers/projectEvidenceController';
import {
  raiseImpediment,
  blockTask,
  resolveImpediment,
  rescheduleTask,
  getImpediments,
} from '../controllers/projectImpedimentController';
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
// Moving the agreed plan is a management act with a reason attached — it is the
// only thing that can move a baseline after the engagement starts.
router.post('/:id/rebaseline', requireCapability(CAP.MANAGE_PROJECT), rebaselineProject);

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

// ── Delays and blockers ───────────────────────────────────────────────────
//
// Blocking and rescheduling carry the lighter capability because they are part
// of doing the work: the person who hits the wall is the person who should say
// so, and a rule that only a manager may report a blocker is a rule that
// produces plans with no blockers in them.
router.get('/:id/impediments', getImpediments);
router.post('/:id/impediments', requireCapability(CAP.EXECUTE_PROJECT_WORK), raiseImpediment);
router.post('/tasks/:taskId/block', requireCapability(CAP.EXECUTE_PROJECT_WORK), blockTask);
// Re-dating is a planning act, so it needs the heavier one — see the split in
// updateTask, where an assignee may report progress but not re-plan the work.
router.post('/tasks/:taskId/reschedule', requireCapability(CAP.MANAGE_PROJECT), rescheduleTask);
router.post('/impediments/:impedimentId/resolve',
  requireCapability(CAP.EXECUTE_PROJECT_WORK), resolveImpediment);

// ── Evidence and traceability ─────────────────────────────────────────────
//
// Attaching evidence is part of doing the work, so it carries the lighter
// capability and re-checks that the caller is the assignee or on the delivery
// side. Mapping work to framework clauses is a management act.
//
// Note there is no route that serves an evidence file statically. Every read
// goes through downloadEvidence, which resolves the row and checks project
// access before streaming — the platform's other file path is an unauthenticated
// static mount, and that is the mistake this module is built to avoid.
router.get('/:id/evidence', getEvidenceRegister);
router.get('/:id/evidence/integrity', requireCapability(CAP.MANAGE_PROJECT), verifyEvidenceIntegrity);
router.post('/tasks/:taskId/evidence', requireCapability(CAP.EXECUTE_PROJECT_WORK), attachEvidence);
router.get('/evidence/:evidenceId/download', downloadEvidence);
router.post('/evidence/:evidenceId/withdraw',
  requireCapability(CAP.EXECUTE_PROJECT_WORK), withdrawEvidence);

router.post('/tasks/:taskId/clauses', requireCapability(CAP.MANAGE_PROJECT), linkClauses);
router.delete('/clauses/:linkId', requireCapability(CAP.MANAGE_PROJECT), unlinkClause);

// ── Reports ───────────────────────────────────────────────────────────────
//
// One route for five reports, because they differ only in their sections — the
// chrome, the issue record and the three renderers are identical, and five
// near-copies would be five places for the provenance block to drift.
//
// ?issue=true makes it a numbered issue rather than an ordinary export. Both
// are recorded either way: somebody now holds a copy of this organisation's
// unremediated weaknesses, and a register with no row for that cannot say who.
router.get('/:id/reports', getReportRegister);
router.get('/:id/reports/:kind', requireCapability(CAP.REPORT), exportDeliveryReport);

export default router;
