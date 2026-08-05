import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, requireAnyCapability, CAP } from '../services/capabilityEngine';
import {
  listStandards, enableStandard,
  listControls,
  listImplementations, getImplementation, createImplementation,
  updateImplementation, validateImplementation,
  addEvidence, reviewEvidence,
} from '../controllers/grcController';
import {
  listRisks, createRisk, updateRisk, setRiskControls,
  addTreatment, completeTreatment, acceptRisk,
} from '../controllers/riskController';
import {
  listAudits, getAudit, createAudit, updateAudit, raiseFinding,
} from '../controllers/auditProgrammeController';
import {
  listIssues, createIssue, respondToIssue, assignCap,
  submitForClosure, closeIssue, reopenIssue, escalateIssue,
} from '../controllers/issueController';
import {
  getMatrix, addMatrixRow, addProcedure, recordResult, linkResultToFinding,
  listWorkpapers, createWorkpaper, submitWorkpaper,
  addReviewNote, clearReviewNote, reviewWorkpaper,
} from '../controllers/fieldworkController';
import {
  listAppetites, setAppetite, approveAppetite, appetitePosture,
} from '../controllers/riskAppetiteController';
import {
  listCampaigns, getCampaign, createCampaign, addScope,
  launchCampaign, submitAssessment, closeCampaign,
} from '../controllers/rcsaController';
import { listKris, createKri, recordReading } from '../controllers/kriController';
import { listLossEvents, createLossEvent, updateLossEvent } from '../controllers/lossEventController';
import {
  listUniverse, createEntity, scoreEntity,
  listPlans, createPlan, addPlanItem, submitPlan, approvePlan,
  instantiateEngagement, deferPlanItem,
} from '../controllers/auditPlanningController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// ── Standards ─────────────────────────────────────────────────────────────
router.get('/standards', listStandards);
router.post('/standards/enable', requireCapability(CAP.ENABLE_STANDARD), enableStandard);

// ── Control library ───────────────────────────────────────────────────────
router.get('/controls', listControls);

// ── Implementations + evidence ────────────────────────────────────────────
router.get('/implementations', listImplementations);
router.get('/implementations/:id', getImplementation);
router.post('/implementations', requireCapability(CAP.MANAGE_IMPLEMENTATION), createImplementation);
router.patch('/implementations/:id', requireCapability(CAP.MANAGE_IMPLEMENTATION), updateImplementation);
router.post('/implementations/:id/validate', requireCapability(CAP.MANAGE_IMPLEMENTATION), validateImplementation);
router.post('/implementations/:id/evidence', requireCapability(CAP.MANAGE_IMPLEMENTATION), addEvidence);
router.post('/evidence/:id/review', requireCapability(CAP.MANAGE_IMPLEMENTATION), reviewEvidence);

// ── Risk register ─────────────────────────────────────────────────────────
router.get('/risks', listRisks);
router.post('/risks', requireCapability(CAP.ASSESS_RISK), createRisk);
router.patch('/risks/:id', requireCapability(CAP.ASSESS_RISK), updateRisk);
router.post('/risks/:id/links', requireCapability(CAP.ASSESS_RISK), setRiskControls);
router.post('/risks/:id/treatments', requireCapability(CAP.ASSESS_RISK), addTreatment);
router.post('/treatments/:id/complete', requireCapability(CAP.ASSESS_RISK), completeTreatment);
router.post('/risks/:id/accept', requireCapability(CAP.ASSESS_RISK), acceptRisk);

// ── Risk appetite ─────────────────────────────────────────────────────────
// Setting appetite is a governance act; approving it must be a second person.
router.get('/appetite', listAppetites);
router.get('/appetite/posture', appetitePosture);
router.post('/appetite', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_TENANT), setAppetite);
router.post('/appetite/:id/approve', requireAnyCapability(CAP.MANAGE_TENANT, CAP.MAINTAIN_ROLES, CAP.MONITOR_SECURITY), approveAppetite);

// ── RCSA — first-line control self-assessment ─────────────────────────────
router.get('/rcsa', listCampaigns);
router.get('/rcsa/:id', getCampaign);
router.post('/rcsa', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_IMPLEMENTATION), createCampaign);
router.post('/rcsa/:id/scope', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_IMPLEMENTATION), addScope);
router.post('/rcsa/:id/launch', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_IMPLEMENTATION), launchCampaign);
router.post('/rcsa/:id/close', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_IMPLEMENTATION), closeCampaign);
// Any control owner can be a respondent, so this route is deliberately open to
// authenticated users — the controller checks they are the assigned respondent.
router.post('/rcsa-assessments/:assessmentId/submit', submitAssessment);

// ── Key risk indicators ───────────────────────────────────────────────────
router.get('/kris', listKris);
router.post('/kris', requireCapability(CAP.ASSESS_RISK), createKri);
router.post('/kris/:kriId/readings', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_IMPLEMENTATION), recordReading);

// ── Loss events ───────────────────────────────────────────────────────────
router.get('/loss-events', listLossEvents);
router.post('/loss-events', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_IMPLEMENTATION), createLossEvent);
router.patch('/loss-events/:id', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_IMPLEMENTATION), updateLossEvent);

// ── Audit universe (IIA Std 9.4 — the plan must be risk-based) ────────────
router.get('/universe', listUniverse);
router.post('/universe', requireCapability(CAP.EXECUTE_AUDIT), createEntity);
router.patch('/universe/:id/score', requireCapability(CAP.EXECUTE_AUDIT), scoreEntity);

// ── Annual audit plan ─────────────────────────────────────────────────────
router.get('/plans', listPlans);
router.post('/plans', requireCapability(CAP.EXECUTE_AUDIT), createPlan);
router.post('/plans/:id/items', requireCapability(CAP.EXECUTE_AUDIT), addPlanItem);
router.post('/plans/:id/submit', requireCapability(CAP.EXECUTE_AUDIT), submitPlan);
// Committee approval is a governance act, not an audit-execution one.
router.post('/plans/:id/approve', requireAnyCapability(CAP.EXECUTE_AUDIT, CAP.MONITOR_SECURITY, CAP.MANAGE_TENANT), approvePlan);
router.post('/plan-items/:itemId/instantiate', requireCapability(CAP.EXECUTE_AUDIT), instantiateEngagement);
router.post('/plan-items/:itemId/defer', requireCapability(CAP.EXECUTE_AUDIT), deferPlanItem);

// ── Audit programme ───────────────────────────────────────────────────────
router.get('/audits', listAudits);
router.get('/audits/:id', getAudit);
router.post('/audits', requireCapability(CAP.EXECUTE_AUDIT), createAudit);
router.patch('/audits/:id', requireCapability(CAP.EXECUTE_AUDIT), updateAudit);
router.post('/audits/:id/findings', requireCapability(CAP.EXECUTE_AUDIT), raiseFinding);

// ── Cross-source issue register ───────────────────────────────────────────
// Internal audit, external audit, regulators, incidents and self-identified
// gaps share one register so aging and escalation are managed in one place.
router.get('/issues', listIssues);
router.post('/issues', requireAnyCapability(CAP.EXECUTE_AUDIT, CAP.MANAGE_IMPLEMENTATION, CAP.MONITOR_SECURITY), createIssue);
// The response belongs to management, not the audit function — auditors are
// deliberately excluded here so they cannot write the auditee's acceptance.
router.post('/issues/:id/respond', requireAnyCapability(CAP.MANAGE_IMPLEMENTATION, CAP.ASSESS_RISK, CAP.MANAGE_TENANT), respondToIssue);
// CAP owners are often control owners, not auditors — allow either capability.
router.post('/issues/:id/cap', requireAnyCapability(CAP.EXECUTE_AUDIT, CAP.MANAGE_IMPLEMENTATION), assignCap);
router.post('/issues/:id/submit-closure', requireAnyCapability(CAP.EXECUTE_AUDIT, CAP.MANAGE_IMPLEMENTATION), submitForClosure);
router.post('/issues/:id/close', requireCapability(CAP.EXECUTE_AUDIT), closeIssue);
router.post('/issues/:id/reopen', requireCapability(CAP.EXECUTE_AUDIT), reopenIssue);
router.post('/issues/:id/escalate', requireCapability(CAP.EXECUTE_AUDIT), escalateIssue);

// ── Risk & Control Matrix + testing (IIA Domain V) ────────────────────────
router.get('/audits/:id/matrix', getMatrix);
router.post('/audits/:id/matrix', requireCapability(CAP.EXECUTE_AUDIT), addMatrixRow);
router.post('/matrix/:rowId/procedures', requireCapability(CAP.EXECUTE_AUDIT), addProcedure);
router.post('/procedures/:procedureId/result', requireCapability(CAP.EXECUTE_AUDIT), recordResult);
router.post('/procedures/:procedureId/link-finding', requireCapability(CAP.EXECUTE_AUDIT), linkResultToFinding);

// ── Workpapers + review sign-off ──────────────────────────────────────────
router.get('/audits/:id/workpapers', listWorkpapers);
router.post('/audits/:id/workpapers', requireCapability(CAP.EXECUTE_AUDIT), createWorkpaper);
router.post('/workpapers/:wpId/submit', requireCapability(CAP.EXECUTE_AUDIT), submitWorkpaper);
router.post('/workpapers/:wpId/notes', requireCapability(CAP.EXECUTE_AUDIT), addReviewNote);
router.post('/review-notes/:noteId/clear', requireCapability(CAP.EXECUTE_AUDIT), clearReviewNote);
router.post('/workpapers/:wpId/review', requireCapability(CAP.EXECUTE_AUDIT), reviewWorkpaper);

export default router;
