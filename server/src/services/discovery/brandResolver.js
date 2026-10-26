import { normalizeBrandName, normalizeDomain } from '../../lib/domain.js';
import { cached } from './cache.js';
import { coreTokens, domainMatchesName, guessDomains, isNonBrandDomain, pageNamesBrand } from './web.js';

const DAY = 86_400_000;

/**
 * Finds and confirms a brand's official website. A domain is accepted only
 * when we can load its homepage and either the domain spells the brand name or
 * the page's site name / title names the brand. Marketplaces, social networks
 * and news sites are never accepted for another brand. Without a search API,
 * the obvious domains (brand.com / .in / .co.in) are tried, and accepted only
 * if their homepage itself names the brand.
 *
 * @param {object} p
 * @param {string} p.name           brand name as found in the source
 * @param {string} [p.websiteHint]  a URL the source itself gave (article link, Instagram bio)
 * @param {{ read: Function }} p.reader   page reader from web.js
 * @param {Function} [p.search]     async (query) => [{ link }] (Serper), optional
 * @param {boolean} [p.trustHint]   the hint is the brand's own link (e.g. its business profile): a match on the
 *                                  brand's first word is enough for that domain
 * @returns {Promise<{ domain, name, website, description } | null>}
 */
export async function resolveBrand({ name, websiteHint, reader, search, cacheFn = cached, trustHint = false }) {
  const normalized = normalizeBrandName(name);
  if (!normalized) return null;
  const hintDomain = normalizeDomain(websiteHint);
  const key = `brand-resolve:${normalized}:${hintDomain || ''}:${search ? 's' : ''}${trustHint ? ':t' : ''}`;
  const { value } = await cacheFn(key, (v) => (v ? 30 * DAY : 7 * DAY), async () => {
    const tried = new Set();
    const first = coreTokens(name)[0];
    const attempt = async (url, { guessed = false, trusted = false } = {}) => {
      const domain = normalizeDomain(url);
      if (!domain || tried.has(domain)) return null;
      tried.add(domain);
      const firstWordMatch = (d) => trusted && first?.length >= 4 && String(d).split('.')[0].includes(first);
      if (isNonBrandDomain(domain) && !domainMatchesName(domain, name)) return null;
      const page = await reader.read(`https://${domain}/`);
      if (!page) return null;
      // Keep the brand's own stated domain when it matches the name, even if it redirects (myntra.com → myntraglobal.com).
      const finalDomain = domainMatchesName(domain, name) ? domain : page.domain || domain;
      if (isNonBrandDomain(finalDomain) && !domainMatchesName(finalDomain, name)) return null;
      if (guessed ? !pageNamesBrand(page.meta, name) : !domainMatchesName(finalDomain, name) && !pageNamesBrand(page.meta, name) && !firstWordMatch(finalDomain)) return null;
      return { domain: finalDomain, name, website: `https://${finalDomain}`, description: page.meta.description || null };
    };

    if (hintDomain) {
      const r = await attempt(hintDomain, { trusted: trustHint });
      if (r) return r;
    }
    if (search) {
      const results = await search(`${name} official website India`).catch(() => []);
      for (const r of results.slice(0, 5)) {
        const found = await attempt(r.link);
        if (found) return found;
      }
    }
    for (const domain of guessDomains(name)) {
      const found = await attempt(domain, { guessed: true });
      if (found) return found;
    }
    return null;
  });
  return value;
}
