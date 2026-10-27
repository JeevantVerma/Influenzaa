import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hashes a password with scrypt (memory-hard KDF from Node's standard library). */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(key, expected);
}

/**
 * Encrypts a secret (e.g. an integration access token) with AES-256-GCM. The
 * key is derived from `secret` (ENCRYPTION_KEY, or AUTH_SECRET when unset).
 */
export function encryptSecret(plain, secret) {
  const key = Buffer.from(crypto.hkdfSync('sha256', secret, 'creatoros', 'integration-tokens', 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}

/** Decrypts with `secrets` (one key, or a list tried in order, e.g. current then previous). */
export function decryptSecret(blob, secrets) {
  const [v, iv, tag, data] = String(blob || '').split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable secret');
  for (const secret of [secrets].flat()) {
    try {
      const key = Buffer.from(crypto.hkdfSync('sha256', secret, 'creatoros', 'integration-tokens', 32));
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      // wrong key: try the next one
    }
  }
  throw new Error('Unreadable secret');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function hmac(secret, input) {
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Deterministic JSON serialisation with sorted keys, used for action hashes and dedupe keys. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value.toHexString === 'function') return JSON.stringify(value.toHexString());
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function hashObject(value) {
  return sha256(canonicalJson(value));
}
