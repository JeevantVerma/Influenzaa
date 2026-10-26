import { DiscoveryCache } from '../../models/index.js';

export async function getCached(key, now = new Date()) {
  const hit = await DiscoveryCache.findOne({ key, expiresAt: { $gt: now } }, { value: 1 }).lean();
  return hit ? { value: hit.value } : null;
}

export async function setCached(key, value, ttlMs, now = new Date()) {
  await DiscoveryCache.updateOne({ key }, { $set: { value, expiresAt: new Date(now.getTime() + ttlMs) } }, { upsert: true });
}

/**
 * Returns the cached value for `key`, or computes it with `fn` and stores it.
 * `ttlMs` may be a number or a function of the computed value (e.g. shorter
 * for "not found"). Errors thrown by `fn` are never cached.
 */
export async function cached(key, ttlMs, fn, { now = new Date() } = {}) {
  const hit = await getCached(key, now);
  if (hit) return { value: hit.value, cached: true };
  const value = await fn();
  await setCached(key, value, typeof ttlMs === 'function' ? ttlMs(value) : ttlMs, now);
  return { value, cached: false };
}

/** A time bucket for cache keys so results refresh on a fixed cadence (e.g. every 12 hours). */
export function bucket(now, hours) {
  return Math.floor(now.getTime() / (hours * 3_600_000));
}
