import dns from 'node:dns/promises';
import net from 'node:net';

// SSRF-guarded fetch for user-configured URLs (RSS feeds etc.): http(s) only,
// standard ports, no private/loopback/link-local/reserved destinations
// (re-checked on every redirect), bounded time and size.

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIPv6(ip) {
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1') return true;
  if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('ff')) return true;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isDisallowedAddress(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true;
}

export class SafeFetchError extends Error {}

export async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new SafeFetchError('Only http and https URLs are allowed');
  if (url.username || url.password) throw new SafeFetchError('URLs with credentials are not allowed');
  if (url.port && !['80', '443'].includes(url.port)) throw new SafeFetchError('Non-standard ports are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new SafeFetchError('Local hostnames are not allowed');
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new SafeFetchError('Host could not be resolved');
  if (addresses.some((a) => isDisallowedAddress(a.address))) throw new SafeFetchError('Destination address is not allowed');
  return url;
}

export async function safeFetch(raw, { timeoutMs = 10_000, maxBytes = 2 * 1024 * 1024, headers = {}, maxRedirects = 3 } = {}) {
  let current = raw;
  for (let i = 0; i <= maxRedirects; i++) {
    const url = await assertPublicUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'CreatorOS-Discovery/0.1 (+brand research; respects robots and feed terms)', ...headers } });
    } catch (err) {
      clearTimeout(timer);
      throw new SafeFetchError(err.name === 'AbortError' ? 'Request timed out' : 'Request failed');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      current = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    try {
      if (!res.ok) throw Object.assign(new SafeFetchError(`Upstream responded ${res.status}`), { status: res.status });
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) {
          ctrl.abort();
          throw new SafeFetchError('Response too large');
        }
        chunks.push(value);
      }
      return { url: url.toString(), status: res.status, contentType: res.headers.get('content-type') || '', text: Buffer.concat(chunks).toString('utf8') };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SafeFetchError('Too many redirects');
}
