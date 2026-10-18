import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.js';
import { requireAuth, setSessionCookies, clearSessionCookies } from '../middleware/auth.js';
import { registerSchema, loginSchema, forgotSchema, resetSchema, changePasswordSchema } from '../validators/schemas.js';
import * as auth from '../services/auth.service.js';
import { getConfig } from '../config/env.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: () => (getConfig().isTest ? 1000 : 20),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } },
});

function sessionPayload(user, csrfToken) {
  return { user: user.toJSON(), csrfToken };
}

router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
  const r = await auth.register(req.body, req.get('user-agent'));
  setSessionCookies(res, r);
  res.status(201).json(sessionPayload(r.user, r.csrfToken));
});

router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
  const r = await auth.login(req.body, req.get('user-agent'));
  setSessionCookies(res, r);
  res.json(sessionPayload(r.user, r.csrfToken));
});

router.post('/logout', requireAuth, async (req, res) => {
  await auth.revokeSession(req.session._id, 'logout');
  clearSessionCookies(res);
  res.status(204).end();
});

router.post('/logout-all', requireAuth, async (req, res) => {
  await auth.revokeAllSessions(req.user._id, 'logout_all');
  clearSessionCookies(res);
  res.status(204).end();
});

router.get('/me', (req, res) => {
  // 200 with user:null keeps the anonymous session probe out of error logs.
  if (!req.user) return res.json({ user: null });
  res.json({ user: req.user.toJSON(), csrfToken: auth.csrfTokenFor(req.session.tokenHash) });
});

router.post('/forgot-password', authLimiter, validate({ body: forgotSchema }), async (req, res) => {
  await auth.requestPasswordReset(req.body.email);
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
});

router.post('/reset-password', authLimiter, validate({ body: resetSchema }), async (req, res) => {
  await auth.resetPassword(req.body);
  res.json({ message: 'Password updated. Please sign in again.' });
});

router.post('/change-password', requireAuth, validate({ body: changePasswordSchema }), async (req, res) => {
  await auth.changePassword(req.user._id, req.body);
  clearSessionCookies(res);
  res.json({ message: 'Password changed. Please sign in again.' });
});

export default router;
