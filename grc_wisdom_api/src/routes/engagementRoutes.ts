import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword, requirePlatformTenant } from '../middlewares/authMiddleware';
import { requireCapability, requireAnyCapability, CAP } from '../services/capabilityEngine';
import {
  featureState, listInvitations, inviteFirm, revokeInvitation, acceptInvitation, declineInvitation,
  getEngagement, nominatePerson, approvePerson, rejectPerson, removePerson, changeDeliveryStyle,
  changeAccessWindow, requestExtension, declineExtension, getResumeProposal, settleResumeProposal, shadowSummary,
} from '../controllers/engagementController';
import { myEngagements } from '../controllers/engagementPortalController';
import { getScope, draftScope, approveScope, discardScope } from '../controllers/engagementScopeController';
import {
  listSharedDocuments, getSharedDocument, fileSharedDocument, setDocumentAccess, listSharedRisks, listSharedAssets,
} from '../controllers/engagementRegistersController';
import { migrationProposals, migrateEngagement } from '../controllers/engagementMigrationController';
import {
  enforcementReadiness, markShadow, scheduleEnforcement, rollbackEnforcement, myEnforcementStatus, confirmEnforcement,
} from '../controllers/engagementEnforcementController';
import { externalAccess, confirmAccessReview, sharedWith } from '../controllers/engagementAccessController';
import { changeCloseWindow, setReportCopies } from '../controllers/engagementCloseWindowController';
import { listRecords, getRecord, reportCopyFile, firmTeam, setAllocation } from '../controllers/engagementFirmController';
import { createFollowOn, setPreviousInScope } from '../controllers/engagementFollowOnController';
import {
  listRequests, getRequest, myRequests, raiseRequest, answerRequest, declineRequest, withdrawRequest, reviewRequest,
  reassignRequest, moveRequestDue, recordRequestBlocker, requestFile, linkEvidence, unlinkEvidence, evidenceChoices,
} from '../controllers/engagementRequestController';
import { requestTemplate, previewRequestImport, importRequests, exportRequests } from '../controllers/engagementRequestImportController';
import { listScopeChanges, askScopeChange, approveScopeChange, rejectScopeChange } from '../controllers/engagementScopeChangeController';
import {
  listThreads, threadSubjects, startThread, getThread, addPost, retractPost, setThreadStatus, convertThread,
} from '../controllers/engagementDiscussionController';
import {
  listReviews, reviewDocument, listSuggestions, suggestWording, pullSuggestion, applySuggestion, decideSuggestion,
} from '../controllers/engagementDocumentReviewController';
import {
  getAssessment, assessClause, listContext, addContextEntry, decideContextEntry,
} from '../controllers/engagementAssessmentController';

/**
 * Consulting engagements (sprints 4 to 7): invitations, the relationship, the
 * firm's people, the delivery style, access windows, the resume proposal, the
 * guard's shadow counts, scope, the shared registers, the migration of
 * engagements set up the old way, enforcement, external access, the window
 * after close, report copies, the firm's records, its team and follow-ons,
 * (sprint 8) information requests, evidence links and scope changes, and
 * (sprint 9) threads, document reviews and suggestions, and (sprint 10) the
 * gap assessment and the context register.
 *
 * Every per-engagement route refuses unless the "Consulting Engagements" flag
 * is on for the organisation and the firm involved. Which side may act is
 * decided per request in the controller; the capability here is the floor,
 * and the platform's routes also need the platform's own tenant.
 */
const router = Router();
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

router.get('/feature', featureState);
router.get('/mine', myEngagements);
router.get('/migration', requireCapability(CAP.MANAGE_PROJECT), migrationProposals);
router.get('/external-access', requireCapability(CAP.MANAGE_PROJECT), externalAccess);
router.get('/shared-with', sharedWith);
router.get('/shadow/summary', requirePlatformTenant, requireCapability(CAP.GOVERN_FLAG), shadowSummary);
router.patch('/shadow/:id/disposition', requirePlatformTenant, requireCapability(CAP.GOVERN_FLAG), markShadow);
router.get('/enforcement/readiness', requirePlatformTenant, requireCapability(CAP.GOVERN_FLAG), enforcementReadiness);
router.post('/enforcement/schedule', requirePlatformTenant, requireCapability(CAP.GOVERN_FLAG), scheduleEnforcement);
router.post('/enforcement/rollback', requirePlatformTenant, requireCapability(CAP.GOVERN_FLAG), rollbackEnforcement);
router.get('/enforcement/status', requireCapability(CAP.ADD_USER), myEnforcementStatus);
router.post('/enforcement/confirm', requireCapability(CAP.ADD_USER), confirmEnforcement);
router.get('/records', requireCapability(CAP.MANAGE_PROJECT), listRecords);
router.get('/records/:id', requireCapability(CAP.MANAGE_PROJECT), getRecord);
router.get('/report-copies/:id/file', requireCapability(CAP.MANAGE_PROJECT), reportCopyFile);
router.get('/firm-team', requireCapability(CAP.MANAGE_PROJECT), firmTeam);
router.get('/requests/mine', myRequests);

router.get('/invitations', listInvitations);
router.post('/invitations', requireCapability(CAP.MANAGE_PROJECT), inviteFirm);
router.post('/invitations/:id/revoke', requireCapability(CAP.MANAGE_PROJECT), revokeInvitation);
router.post('/invitations/:id/accept', requireCapability(CAP.MANAGE_PROJECT), acceptInvitation);
router.post('/invitations/:id/decline', requireCapability(CAP.MANAGE_PROJECT), declineInvitation);

router.get('/:projectId', getEngagement);
router.post('/:projectId/nominations', requireCapability(CAP.MANAGE_PROJECT), nominatePerson);
router.post('/:projectId/members/:memberId/approve', requireCapability(CAP.MANAGE_PROJECT), approvePerson);
router.post('/:projectId/members/:memberId/reject', requireCapability(CAP.MANAGE_PROJECT), rejectPerson);
router.post('/:projectId/members/:memberId/remove', requireCapability(CAP.MANAGE_PROJECT), removePerson);
router.patch('/:projectId/members/:memberId/window', requireCapability(CAP.MANAGE_PROJECT), changeAccessWindow);
router.patch('/:projectId/members/:memberId/allocation', requireCapability(CAP.EXECUTE_PROJECT_WORK), setAllocation);
router.post('/:projectId/members/:memberId/extension-request', requireCapability(CAP.EXECUTE_PROJECT_WORK), requestExtension);
router.post('/:projectId/members/:memberId/extension-request/decline', requireCapability(CAP.MANAGE_PROJECT), declineExtension);
router.get('/:projectId/resume-proposal', getResumeProposal);
router.post('/:projectId/resume-proposal', requireCapability(CAP.MANAGE_PROJECT), settleResumeProposal);
router.get('/:projectId/scope', getScope);
router.post('/:projectId/scope', requireCapability(CAP.MANAGE_PROJECT), draftScope);
router.post('/:projectId/scope/:versionId/approve', requireCapability(CAP.MANAGE_PROJECT), approveScope);
router.post('/:projectId/scope/:versionId/discard', requireCapability(CAP.MANAGE_PROJECT), discardScope);
router.get('/:projectId/documents', listSharedDocuments);
router.get('/:projectId/documents/:documentId', getSharedDocument);
router.get('/:projectId/documents/:documentId/file', fileSharedDocument);
router.patch('/:projectId/document-access', requireCapability(CAP.MANAGE_PROJECT), setDocumentAccess);
router.get('/:projectId/risks', listSharedRisks);
router.get('/:projectId/assets', listSharedAssets);
router.post('/:projectId/access-review', requireCapability(CAP.MANAGE_PROJECT), confirmAccessReview);
router.post('/:projectId/migrate', requireCapability(CAP.MANAGE_PROJECT), migrateEngagement);
router.patch('/:projectId/close-window', requireCapability(CAP.MANAGE_PROJECT), changeCloseWindow);
router.patch('/:projectId/report-copies', requireCapability(CAP.MANAGE_PROJECT), setReportCopies);
router.post('/:projectId/follow-on', requireCapability(CAP.MANAGE_PROJECT), createFollowOn);
router.patch('/:projectId/previous-in-scope', requireCapability(CAP.MANAGE_PROJECT), setPreviousInScope);

// Information requests (sprint 8). The firm asks with project work; the
// organisation's assignee answers with project work, its managers decide.
// Who may do what beyond that floor is decided per request in the controller.
router.get('/:projectId/requests', listRequests);
router.get('/:projectId/requests/export', exportRequests);
router.get('/:projectId/requests/import/template', requestTemplate);
router.post('/:projectId/requests/import/preview', requireCapability(CAP.EXECUTE_PROJECT_WORK), previewRequestImport);
router.post('/:projectId/requests/import', requireCapability(CAP.EXECUTE_PROJECT_WORK), importRequests);
router.post('/:projectId/requests', requireCapability(CAP.EXECUTE_PROJECT_WORK), raiseRequest);
router.get('/:projectId/requests/:requestId', getRequest);
router.get('/:projectId/requests/:requestId/files/:linkId', requestFile);
router.post('/:projectId/requests/:requestId/answer', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), answerRequest);
router.post('/:projectId/requests/:requestId/decline', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), declineRequest);
router.post('/:projectId/requests/:requestId/review', requireCapability(CAP.EXECUTE_PROJECT_WORK), reviewRequest);
router.post('/:projectId/requests/:requestId/withdraw', requireCapability(CAP.EXECUTE_PROJECT_WORK), withdrawRequest);
router.patch('/:projectId/requests/:requestId/assignee', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), reassignRequest);
router.patch('/:projectId/requests/:requestId/due', requireCapability(CAP.MANAGE_PROJECT), moveRequestDue);
router.post('/:projectId/requests/:requestId/blocker', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), recordRequestBlocker);
router.get('/:projectId/evidence-choices', evidenceChoices);
router.post('/:projectId/evidence-links', requireCapability(CAP.MANAGE_PROJECT), linkEvidence);
router.post('/:projectId/evidence-links/:linkId/remove', requireCapability(CAP.MANAGE_PROJECT), unlinkEvidence);
router.get('/:projectId/scope-changes', listScopeChanges);
router.post('/:projectId/scope-changes', requireCapability(CAP.EXECUTE_PROJECT_WORK), askScopeChange);
router.post('/:projectId/scope-changes/:id/approve', requireCapability(CAP.MANAGE_PROJECT), approveScopeChange);
router.post('/:projectId/scope-changes/:id/reject', requireCapability(CAP.MANAGE_PROJECT), rejectScopeChange);
router.patch('/:projectId/delivery-style', requireCapability(CAP.MANAGE_PROJECT), changeDeliveryStyle);

// Sprint 9: threads. Each side reads its own and the shared ones; writing is
// project work on either side, and the controller decides who may do what.
router.get('/:projectId/threads', listThreads);
router.get('/:projectId/threads/subjects', threadSubjects);
router.post('/:projectId/threads', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), startThread);
router.get('/:projectId/threads/:threadId', getThread);
router.post('/:projectId/threads/:threadId/posts', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), addPost);
router.post('/:projectId/threads/:threadId/posts/:postId/retract', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), retractPost);
router.post('/:projectId/threads/:threadId/status', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), setThreadStatus);
router.post('/:projectId/threads/:threadId/convert', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), convertThread);
// Document review and suggestions, on documents the scope shares.
router.get('/:projectId/documents/:documentId/reviews', listReviews);
router.post('/:projectId/documents/:documentId/reviews', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), reviewDocument);
router.get('/:projectId/documents/:documentId/suggestions', listSuggestions);
router.post('/:projectId/documents/:documentId/suggestions', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), suggestWording);
router.post('/:projectId/suggestions/:suggestionId/pull', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), pullSuggestion);
router.post('/:projectId/suggestions/:suggestionId/apply', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), applySuggestion);
router.post('/:projectId/suggestions/:suggestionId/decide', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), decideSuggestion);

// Sprint 10: the gap assessment of the clauses and entities the scope names,
// and the organisation's context register, which the firm proposes to.
router.get('/:projectId/assessment', getAssessment);
router.post('/:projectId/assessment', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), assessClause);
router.get('/:projectId/context', listContext);
router.post('/:projectId/context', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), addContextEntry);
router.post('/:projectId/context/:entryId/decide', requireAnyCapability(CAP.EXECUTE_PROJECT_WORK, CAP.MANAGE_PROJECT), decideContextEntry);

export default router;
