import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Coarse per-IP backstop for send-otp; the real defense is the per-phone
// check inside the handler itself (see authController.sendOtp). This just
// stops one IP from OTP-bombing many different phone numbers.
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many code requests. Please try again later.' },
});

// forgot-password/check has zero per-request cost (no SMS, no DB write), so an
// automated sweep across many phone numbers can run much faster than against
// otpLimiter's target — tighter than otpLimiter's 10/15min to compensate.
export const forgotPasswordCheckIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Per-phone (not per-IP) throttle for the same endpoint — this is the
// enumeration-risk one (reveals masked name + existence), so it gets its own
// budget keyed by the phone in the request body rather than the caller's IP.
// Falls back to IP if phone is missing/malformed at this point in the chain
// (Zod hasn't validated the body yet — this middleware runs first).
export const forgotPasswordCheckPhoneLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const phone = (req.body as { phone?: unknown } | undefined)?.phone;
    return typeof phone === 'string' && phone.length > 0 ? phone : ipKeyGenerator(req.ip ?? '');
  },
  message: { error: 'Too many requests for this phone number. Please try again later.' },
});
