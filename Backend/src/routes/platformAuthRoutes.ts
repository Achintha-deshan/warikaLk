import { Router } from 'express';
import { platformLogin, platformLogout } from '../controllers/platformAuthController';
import { loginLimiter } from '../middleware/rateLimiter';

const router = Router();

// Reuses the existing loginLimiter (5/15min, only counting failed attempts)
// — a platform-admin account is high-value (access to every tenant), so
// brute-force protection here matters at least as much as tenant login.
router.post('/login', loginLimiter, platformLogin);
router.post('/logout', platformLogout);

export default router;
