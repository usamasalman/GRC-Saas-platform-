import { Router } from 'express';
import {
  login,
  mfaChallenge,
  refresh,
  logout,
  registerAdmin,
  me,
  setupMfa,
  verifyMfa,
  listTenantUsers,
  changePassword,
  listDemoIdentities,
} from '../controllers/authController';
import { requireAuth } from '../middlewares/authMiddleware';

const router = Router();

// Public
router.post('/login', login);
router.post('/mfa/challenge', mfaChallenge);
router.post('/refresh', refresh);
router.post('/register-admin', registerAdmin);
router.get('/demo-identities', listDemoIdentities);

// Authenticated
router.get('/me', requireAuth, me);
router.post('/logout', requireAuth, logout);
router.post('/mfa/setup', requireAuth, setupMfa);
router.post('/mfa/verify', requireAuth, verifyMfa);
router.post('/change-password', requireAuth, changePassword);
router.get('/tenant-users', requireAuth, listTenantUsers);

export default router;
