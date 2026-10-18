import { User, Session, CreatorProfile, DiscoveryConfiguration } from '../models/index.js';
import { hashPassword, verifyPassword, randomToken, sha256, hmac } from '../lib/crypto.js';
import { conflict, unauthorized, badRequest } from '../lib/errors.js';
import { getConfig } from '../config/env.js';
import { recordAudit } from './audit.service.js';
import { sendSystemEmail } from './email/index.js';

export const SESSION_COOKIE = 'cos_session';
export const CSRF_COOKIE = 'cos_csrf';
const ROTATION_GRACE_MS = 60_000;

export function csrfTokenFor(sessionTokenHash) {
  return hmac(getConfig().authSecret, `csrf:${sessionTokenHash}`);
}

export async function createSession(userId, userAgent) {
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const session = await Session.create({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + getConfig().sessionTtlMs),
    lastSeenAt: new Date(),
    userAgent: userAgent?.slice(0, 300),
  });
  return { token, session, csrfToken: csrfTokenFor(tokenHash) };
}

/** Resolves a session token to an active session + user, or null. */
export async function resolveSession(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const session = await Session.findOne({ tokenHash: sha256(token) });
  if (!session || session.expiresAt <= new Date()) return null;
  if (session.revokedAt) {
    // A rotated session stays valid for a short grace period so concurrent
    // in-flight requests made with the old cookie do not fail.
    const inGrace = session.revokedReason === 'rotated' && Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (!inGrace) return null;
  }
  const user = await User.findById(session.userId);
  if (!user || user.accountStatus !== 'active') return null;
  return { session, user };
}

export function shouldRotate(session) {
  if (session.revokedAt) return false;
  return Date.now() - session.createdAt.getTime() > getConfig().sessionTtlMs / 2;
}

export async function rotateSession(session, userAgent) {
  const next = await createSession(session.userId, userAgent);
  await Session.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'rotated' } });
  return next;
}

export async function revokeSession(sessionId, reason = 'logout') {
  await Session.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

export async function revokeAllSessions(userId, reason) {
  await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

async function ensureCreatorRecords(user) {
  if (user.role !== 'creator') return;
  await CreatorProfile.updateOne(
    { userId: user._id },
    { $setOnInsert: { userId: user._id, publicName: user.name } },
    { upsert: true },
  );
  await DiscoveryConfiguration.updateOne(
    { creatorId: user._id },
    {
      $setOnInsert: {
        creatorId: user._id,
        status: 'stopped', // Discovery stays stopped until the creator enables it.
        intervalMinutes: getConfig().discovery.defaultIntervalMinutes,
        sourceConfiguration: { enabledSources: getConfig().discovery.sources, rssFeeds: [], searchQueries: [] },
      },
    },
    { upsert: true },
  );
}

export async function register({ name, email, password }, userAgent) {
  const existing = await User.findOne({ email: email.toLowerCase() }).lean();
  if (existing) throw conflict('An account with this email already exists');
  const user = await User.create({ name, email, passwordHash: await hashPassword(password), role: 'creator' });
  await ensureCreatorRecords(user);
  await recordAudit({ actorType: 'creator', actorId: user._id, creatorId: user._id, eventType: 'auth.registered', resourceType: 'user', resourceId: user._id });
  const session = await createSession(user._id, userAgent);
  return { user, ...session };
}

export async function login({ email, password }, userAgent) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  // Always run a hash comparison so response timing does not reveal whether the email exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
  if (!user || !ok || user.accountStatus !== 'active') {
    if (user) await recordAudit({ actorType: 'system', creatorId: user._id, eventType: 'auth.login_failed', resourceType: 'user', resourceId: user._id });
    throw unauthorized('Incorrect email or password');
  }
  user.lastLoginAt = new Date();
  await user.save();
  await ensureCreatorRecords(user);
  await recordAudit({ actorType: user.role === 'admin' ? 'admin' : 'creator', actorId: user._id, creatorId: user._id, eventType: 'auth.login', resourceType: 'user', resourceId: user._id });
  const session = await createSession(user._id, userAgent);
  return { user, ...session };
}

export async function requestPasswordReset(email) {
  const user = await User.findOne({ email: email.toLowerCase() });
  // Same response whether or not the account exists (no account enumeration).
  if (!user || user.accountStatus !== 'active') return;
  const token = randomToken(32);
  user.passwordResetTokenHash = sha256(token);
  user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60_000);
  await user.save();
  const base = getConfig().frontendOrigins[0];
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  await sendSystemEmail({
    to: user.email,
    subject: 'Reset your CreatorOS password',
    text: `Hi ${user.name},\n\nUse this link within 30 minutes to reset your password:\n${link}\n\nIf you did not request this, you can ignore this email.`,
    purpose: 'password_reset',
    userId: user._id,
  });
  await recordAudit({ actorType: 'system', creatorId: user._id, eventType: 'auth.password_reset_requested', resourceType: 'user', resourceId: user._id });
}

export async function resetPassword({ token, password }) {
  const user = await User.findOne({ passwordResetTokenHash: sha256(token) }).select('+passwordResetTokenHash +passwordResetExpiresAt');
  if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt <= new Date()) {
    throw badRequest('This reset link is invalid or has expired');
  }
  user.passwordHash = await hashPassword(password);
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  await user.save();
  await revokeAllSessions(user._id, 'password_reset');
  await recordAudit({ actorType: 'creator', actorId: user._id, creatorId: user._id, eventType: 'auth.password_reset', resourceType: 'user', resourceId: user._id });
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) throw unauthorized('Current password is incorrect');
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  await revokeAllSessions(user._id, 'password_changed');
  await recordAudit({ actorType: 'creator', actorId: user._id, creatorId: user._id, eventType: 'auth.password_changed', resourceType: 'user', resourceId: user._id });
}
