import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import { requireCapability, CAP } from '../services/capabilityEngine';
import {
  featureState, listInvitations, inviteFirm, revokeInvitation, acceptInvitation, declineInvitation,
  getEngagement, nominatePerson, approvePerson, rejectPerson, removePerson, changeDeliveryStyle,
} from '../controllers/engagementController';

/**
 * Consulting engagements (sprint 4): invitations, the relationship, the firm's
 * people and the delivery style.
 *
 * Every route but /feature refuses unless the "Consulting Engagements" flag is
 * on for the organisation and the firm involved. Which side may act is decided
 * per request in the controller; the capability here is the floor.
 */
const router = Router();
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

router.get('/feature', featureState);

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
router.patch('/:projectId/delivery-style', requireCapability(CAP.MANAGE_PROJECT), changeDeliveryStyle);

export default router;
