import { Router } from 'express';
import { requireAuth, rejectIfMustChangePassword } from '../middlewares/authMiddleware';
import {
  listNotifications, unreadCount, markRead, markAllRead,
} from '../controllers/notificationController';

const router = Router();

router.use(requireAuth);
router.use(rejectIfMustChangePassword);

// No capability gate: a notification is addressed to a person, and every
// authenticated user is entitled to read their own inbox and nobody else's.
router.get('/', listNotifications);
router.get('/unread-count', unreadCount);
router.post('/:id/read', markRead);
router.post('/read-all', markAllRead);

export default router;
