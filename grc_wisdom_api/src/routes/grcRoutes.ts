import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, requireAnyCapability, CAP } from '../services/capabilityEngine';
import {
  createStandard, addClauses, updateStandard, deleteStandard, mapControlToClauses,
} from '../controllers/standardsAuthoringController';
import {
  uploadImport, listImports, getImport, reviewCandidate,
  acceptClean, commitImport, discardImport,
} from '../controllers/frameworkImportController';
import {
  exportRcm, exportAuditReport, exportIssueRegister,
  exportFrameworkCoverage, exportAnnualPlan,
} from '../controllers/reportController';
import {
  createControl, cloneControl, updateControl, deleteControl, listClauses,
} from '../controllers/controlAuthoringController';
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
  setRiskEntities, linkRelatedRisk, reviewRisk, riskAnalytics,
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

import {
  listAssets, createAsset, updateAsset, raiseRiskFromAsset,
  setAssetControls, linkExistingRisk, reviewAsset, assetAnalytics,
} from '../controllers/assetController';

import {
  listCriteria, criteriaAsAt, setCriteria, approveCriteria, withdrawCriteria,
} from '../controllers/riskCriteriaController';

import {
  listVendors, createVendor, updateVendor,
  requestAssessment, submitAssessment as submitVendorAssessment,
  reviewAssessment, vendorAnalytics,
} from '../controllers/vendorController';
import {
  listSharedServices, createSharedService, setConsumers,
  acceptService, setServiceControls,
} from '../controllers/sharedServiceController';

import {
  downloadTemplate, uploadAssetImport, listAssetImports, getAssetImport,
  reviewAssetCandidate, acceptCleanRows, commitAssetImport, discardAssetImport,
} from '../controllers/assetImportController';

import {
  downloadRiskTemplate, uploadRiskImport, listRiskImports, getRiskImport,
  reviewRiskCandidate, acceptCleanRiskRows, commitRiskImport, discardRiskImport,
} from '../controllers/riskImportController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// ── Standards ─────────────────────────────────────────────────────────────
router.get('/standards', listStandards);
router.post('/standards/enable', requireCapability(CAP.ENABLE_STANDARD), enableStandard);

// ── Authoring your own framework ──────────────────────────────────────────
// The capability is literally "import or enable a standard", so importing one
// belongs to the same people who enable them.
router.post('/standards', requireCapability(CAP.ENABLE_STANDARD), createStandard);
router.post('/standards/:id/clauses', requireCapability(CAP.ENABLE_STANDARD), addClauses);
router.patch('/standards/:id', requireCapability(CAP.ENABLE_STANDARD), updateStandard);
router.delete('/standards/:id', requireCapability(CAP.ENABLE_STANDARD), deleteStandard);
// Mapping a control to clauses is what makes the framework auditable.
router.post('/controls/:controlId/clauses', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), mapControlToClauses);

// ── Importing a framework from a file ─────────────────────────────────────
// Extraction stages candidates; only commit writes to the library.
router.get('/imports', listImports);
router.get('/imports/:id', getImport);
router.post('/imports', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), uploadImport);
router.patch('/import-candidates/:candidateId', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), reviewCandidate);
router.post('/imports/:id/accept-clean', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), acceptClean);
router.post('/imports/:id/commit', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), commitImport);
router.post('/imports/:id/discard', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), discardImport);

// ── Reports ───────────────────────────────────────────────────────────────
// This is what generate-and-distribute-a-report was reserved for; until now
// the capability gated nothing.
router.get('/audits/:id/export/rcm', requireCapability(CAP.REPORT), exportRcm);
router.get('/audits/:id/export/report', requireCapability(CAP.REPORT), exportAuditReport);
router.get('/plans/:id/export', requireCapability(CAP.REPORT), exportAnnualPlan);
router.get('/reports/issues', requireCapability(CAP.REPORT), exportIssueRegister);
router.get('/reports/framework-coverage', requireCapability(CAP.REPORT), exportFrameworkCoverage);

// ── Control library ───────────────────────────────────────────────────────
router.get('/controls', listControls);
// Clause picker for the authoring screens.
router.get('/clauses', listClauses);

// ── Authoring controls ────────────────────────────────────────────────────
// A compliance manager or consultant owns this: writing the control set an
// organisation will actually be assessed against.
router.post('/controls', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), createControl);
// Library controls are shared, so copying is the supported way to adapt one.
router.post('/controls/:id/clone', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), cloneControl);
router.patch('/controls/:id', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), updateControl);
router.delete('/controls/:id', requireAnyCapability(CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION), deleteControl);

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
// The linkage spine: where a risk sits in the audit universe, what it causes,
// and confirming it has been looked at.
router.post('/risks/:id/entities', requireCapability(CAP.ASSESS_RISK), setRiskEntities);
router.post('/risks/:id/related', requireCapability(CAP.ASSESS_RISK), linkRelatedRisk);
router.post('/risks/:id/review', requireCapability(CAP.ASSESS_RISK), reviewRisk);
router.get('/risk-analytics', riskAnalytics);

// -- Asset register (ISO 27001 A.5.9 / ISO 27005) --------------------------
// Reading the inventory is open to anyone in scope; maintaining it needs the
// asset capability, and raising risk from an asset needs the risk one too.
router.get('/assets', listAssets);
router.get('/asset-analytics', assetAnalytics);
// The inventory is the foundation of both control implementation and risk
// assessment, so anyone doing either has to be able to maintain it. Gating on
// the dedicated asset capability alone left only Asset Owner able to add an
// asset, which stalls the very first step of building the register.
const MAY_MAINTAIN_ASSETS = requireAnyCapability(
  CAP.MAINTAIN_ASSET, CAP.MANAGE_IMPLEMENTATION, CAP.ASSESS_RISK,
);
router.post('/assets', MAY_MAINTAIN_ASSETS, createAsset);
router.patch('/assets/:id', MAY_MAINTAIN_ASSETS, updateAsset);
router.post('/assets/:id/controls', MAY_MAINTAIN_ASSETS, setAssetControls);
router.post('/assets/:id/review', MAY_MAINTAIN_ASSETS, reviewAsset);
router.post('/assets/:id/risks', requireCapability(CAP.ASSESS_RISK), raiseRiskFromAsset);
router.post('/assets/:id/link-risk', requireCapability(CAP.ASSESS_RISK), linkExistingRisk);

// -- Bulk asset import (staged) -------------------------------------------
// Extraction produces candidates, never assets. Criticality becomes the impact
// of every risk raised against an asset, so nothing enters the register until
// a human has seen what the parser understood.
router.get('/assets/import/template', downloadTemplate);
router.get('/assets/imports', listAssetImports);
router.get('/assets/imports/:id', getAssetImport);
router.post('/assets/import', MAY_MAINTAIN_ASSETS, uploadAssetImport);
router.patch('/asset-candidates/:candidateId', MAY_MAINTAIN_ASSETS, reviewAssetCandidate);
router.post('/assets/imports/:id/accept-clean', MAY_MAINTAIN_ASSETS, acceptCleanRows);
router.post('/assets/imports/:id/commit', MAY_MAINTAIN_ASSETS, commitAssetImport);
router.post('/assets/imports/:id/discard', MAY_MAINTAIN_ASSETS, discardAssetImport);

// -- Third-party risk management (SAMA CSF 3.3.15, ISO 27036) --------------
// Vendor risk is enterprise risk, so it is gated on the same capabilities and
// its findings land in the same issue register as everything else.
const MAY_MANAGE_VENDORS = requireAnyCapability(
  CAP.ASSESS_RISK, CAP.MANAGE_IMPLEMENTATION, CAP.MANAGE_TENANT,
);
router.get('/vendors', listVendors);
router.get('/vendor-analytics', vendorAnalytics);
router.post('/vendors', MAY_MANAGE_VENDORS, createVendor);
router.patch('/vendors/:id', MAY_MANAGE_VENDORS, updateVendor);
router.post('/vendors/:id/assessments', MAY_MANAGE_VENDORS, requestAssessment);
router.post('/vendor-assessments/:assessmentId/submit', MAY_MANAGE_VENDORS, submitVendorAssessment);
router.post('/vendor-assessments/:assessmentId/review', MAY_MANAGE_VENDORS, reviewAssessment);

// -- Shared services inside a group ---------------------------------------
// Reading is open to provider and consumer alike; only the provider may change
// what the service is, and only the consumer may accept it.
router.get('/shared-services', listSharedServices);
router.post('/shared-services', requireAnyCapability(CAP.MANAGE_TENANT, CAP.MANAGE_IMPLEMENTATION), createSharedService);
router.post('/shared-services/:id/consumers', requireAnyCapability(CAP.MANAGE_TENANT, CAP.MANAGE_IMPLEMENTATION), setConsumers);
router.post('/shared-services/:id/controls', requireAnyCapability(CAP.MANAGE_TENANT, CAP.MANAGE_IMPLEMENTATION), setServiceControls);
router.post('/shared-services/:id/accept', requireAnyCapability(CAP.MANAGE_TENANT, CAP.ASSESS_RISK), acceptService);

// -- Bulk risk import (staged) --------------------------------------------
// Same discipline as creating one risk by hand, including the duplicate check:
// a register that admits three spellings of the same risk stops being trusted.
const MAY_IMPORT_RISKS = requireCapability(CAP.ASSESS_RISK);
router.get('/risks/import/template', downloadRiskTemplate);
router.get('/risks/imports', listRiskImports);
router.get('/risks/imports/:id', getRiskImport);
router.post('/risks/import', MAY_IMPORT_RISKS, uploadRiskImport);
router.patch('/risk-candidates/:candidateId', MAY_IMPORT_RISKS, reviewRiskCandidate);
router.post('/risks/imports/:id/accept-clean', MAY_IMPORT_RISKS, acceptCleanRiskRows);
router.post('/risks/imports/:id/commit', MAY_IMPORT_RISKS, commitRiskImport);
router.post('/risks/imports/:id/discard', MAY_IMPORT_RISKS, discardRiskImport);

// -- Risk criteria (ISO 31000 clause 6.3.4) -------------------------------
// The scale the tenant measures on. Same governance as appetite: drafted by
// one person, approved by another, versioned so a past decision can be read
// against the scale that was in force when it was taken.
router.get('/risk-criteria', listCriteria);
router.get('/risk-criteria/as-at', criteriaAsAt);
router.post('/risk-criteria', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_TENANT), setCriteria);
router.post('/risk-criteria/:id/approve', requireAnyCapability(CAP.MANAGE_TENANT, CAP.MAINTAIN_ROLES, CAP.MONITOR_SECURITY), approveCriteria);
router.delete('/risk-criteria/:id', requireAnyCapability(CAP.ASSESS_RISK, CAP.MANAGE_TENANT), withdrawCriteria);

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
// No capability gate: a corrective action is owned by the accountable business
// manager, who typically holds none. The controller authorises by ownership and
// falls back to the audit/compliance capabilities for everyone else.
router.post('/issues/:id/submit-closure', submitForClosure);
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
