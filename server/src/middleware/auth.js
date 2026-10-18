import { getConfig } from '../config/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { safeEqual } from '../lib/crypto.js';
import {
  SESSION_COOKIE,
  CSRF_COOKIE,
  resolveSession,
  shouldRotate,
  rotateSession,
  csrfTokenFor,
} from '../services/auth.service.js';

export function setSessionCookies(res, { token, csrfToken }) {
  const cfg = getConfig();
  const common = { secure: cfg.isProd, sameSite: 'lax', path: '/', maxAge: cfg.sessionTtlMs };
  res.cookie(SESSION_COOKIE, token, { ...common, httpOnly: true });
  // Readable by the SPA so it can echo it in X-CSRF-Token (double submit).
  res.cookie(CSRF_COOKIE, csrfToken, { ...common, httpOnly: false });
}

export function clearSessionCookies(res) {
  const cfg = getConfig();
  res.clearCookie(SESSION_COOKIE, { path: '/', secure: cfg.isProd, sameSite: 'lax', httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { path: '/', secure: cfg.isProd, sameSite: 'lax' });
}

/** Loads the session if present; never rejects. */
export async function loadSession(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const resolved = await resolveSession(token);
  if (!resolved) {
    clearSessionCookies(res);
    return next();
  }
  req.session = resolved.session;
  req.user = resolved.user;
  if (shouldRotate(resolved.session)) {
    const rotated = await rotateSession(resolved.session, req.get('user-agent'));
    // The in-flight request still carries the previous session's CSRF token.
    req.previousCsrfToken = csrfTokenFor(resolved.session.tokenHash);
    req.session = rotated.session;
    setSessionCookies(res, rotated);
  } else {
    // Refresh lastSeenAt at most every 5 minutes to limit write load.
    if (!resolved.session.lastSeenAt || Date.now() - resolved.session.lastSeenAt.getTime() > 5 * 60_000) {
      resolved.session.lastSeenAt = new Date();
      resolved.session.save().catch(() => {});
    }
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireAuth(req, _res, next) {
  if (!req.user || !req.session) return next(unauthorized());
  if (!SAFE_METHODS.has(req.method)) {
    const header = req.get('x-csrf-token');
    const valid = [csrfTokenFor(req.session.tokenHash)];
    if (req.previousCsrfToken) valid.push(req.previousCsrfToken);
    if (!header || !valid.some((v) => safeEqual(v, header))) {
      return next(forbidden('Missing or invalid CSRF token'));
    }
  }
  next();
}

export function requireRole(role) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== role) return next(forbidden());
    next();
  };
}

/** The creator id every protected query must be scoped to. */
export function creatorIdOf(req) {
  return req.user._id;
}
