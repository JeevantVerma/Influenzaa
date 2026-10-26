/** Normalises a URL or hostname to a bare registrable-ish domain (lowercase, no www). */
export function normalizeDomain(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (!/^[a-z]+:\/\//.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\d?\./, '').replace(/\.$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/** "@Name", "name" or an instagram.com profile URL → "name"; null if it is not a valid handle. */
export function normalizeInstagramHandle(input) {
  let s = String(input || '').trim();
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/i.exec(s);
  if (fromUrl) s = fromUrl[1];
  s = s.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(s) && !/^(p|reel|reels|explore|stories|accounts)$/.test(s) ? s : null;
}

/** Normalises free text for dedupe keys: lowercase, alphanumerics only, collapsed spaces. */
export function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Normalised brand name (drops legal suffixes) for display-level comparisons only. */
export function normalizeBrandName(s) {
  return normalizeText(s).replace(/\b(pvt|private|ltd|limited|llp|inc|india|co|company)\b/g, '').replace(/\s+/g, ' ').trim();
}
