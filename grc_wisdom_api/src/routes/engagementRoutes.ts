import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword, requirePlatformTenant } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
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

/**
 * Consulting engagements (sprints 4 to 7): invitations, the relationship, the
 * firm's people, the delivery style, access windows, the resume proposal, the
 * guard's shadow counts, scope, the shared registers, the migration of
 * engagements set up the old way, enforcement, external access, the window
 * after close and report copies.
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
router.patch('/:projectId/delivery-style', requireCapability(CAP.MANAGE_PROJECT), changeDeliveryStyle);

export default router;
