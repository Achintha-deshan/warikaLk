import { Router } from 'express';
import {
  signup,
  login,
  logout,
  me,
  sendOtp,
  loginOtp,
  forgotPasswordCheck,
  sendPasswordResetOtp,
  forgotPasswordVerifyOtp,
  forgotPasswordReset
} from '../controllers/authController';
import { requireAuth } from '../middleware/requireAuth';
import {
  authLimiter,
  loginLimiter,
  otpLimiter,
  forgotPasswordCheckIpLimiter,
  forgotPasswordCheckPhoneLimiter
} from '../middleware/rateLimiter';

const router = Router();

router.post('/send-otp', otpLimiter, sendOtp);
router.post('/signup', authLimiter, signup);
router.post('/login', loginLimiter, login);
router.post('/login-otp', loginLimiter, loginOtp);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

router.post('/forgot-password/check', forgotPasswordCheckIpLimiter, forgotPasswordCheckPhoneLimiter, forgotPasswordCheck);
router.post('/forgot-password/send-otp', otpLimiter, sendPasswordResetOtp);
router.post('/forgot-password/verify-otp', loginLimiter, forgotPasswordVerifyOtp);
router.post('/forgot-password/reset', authLimiter, forgotPasswordReset);

export default router;
