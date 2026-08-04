import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import {
  listSessions,
  requestSession,
  approveSession,
  denySession,
  startSession,
  endSession,
  currentSession,
} from '../controllers/impersonationController';

const router = Router();

// Writes here are still blocked for an impersonating caller by requireAuth,
// so a session can never spawn or approve another session.
router.use(requireAuth);
router.use(rejectIfMustChangePassword);

router.get('/', listSessions);
router.get('/current', currentSession);
router.post('/', requestSession);
router.post('/:id/approve', approveSession);
router.post('/:id/deny', denySession);
router.post('/:id/start', startSession);
router.post('/:id/end', endSession);

export default router;
