import { getConfig } from '../../../config/env.js';
import { normalizeDomain } from '../../../lib/domain.js';
import { detectProgramme } from '../../contacts/websiteContacts.js';
import { NICHE_KEYWORDS, NICHE_TO_CATEGORIES, rotateNiches } from '../taxonomy.js';
import { cached, bucket } from '../cache.js';
import { createPageReader, domainMatchesName, isNonBrandDomain } from '../web.js';
import { serperSearch } from '../serper.js';

// Web search (Serper) for brands that publish a creator / influencer /
// affiliate programme. Search results are leads only: each result page is
// fetched from the brand's own site and kept only if that page itself is a
// creator programme. The evidence is that page, not the search snippet.

const CACHE_HOURS = 24;
const MAX_NICHES = 3;
const MAX_PAGES_PER_NICHE = 12;
// Influencer agencies and platforms run "programmes" too, but they are not sponsors.
const AGENCY = /\b(agency|agencies|(influencer|creator) (marketing )?(platform|company|firm|marketplace|network)|marketplace for (creators|influencers)|connect(s|ing)? (your )?brands? (with|and|to) (creators|influencers))\b/i;
// Articles and lists about programmes rather than a brand's own programme page.
const LISTICLE = /\b(top|best)\s+\d+|^\s*\d+\s|\b\d+\s+(\w+\s+){0,3}(brands|companies|programs|programmes)\b|\blist of\b|\bhow to\b|\bguide\b|everything you need to know|\breview\b|\bexplained\b/i;
const NAMED_PROGRAMME = /([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,3}?)\s+(?:[Ii]nfluencer|[Cc]reator|[Aa]ffiliate|[Aa]mbassador|[Pp]artner)s?\s+[Pp]rogram(?:me)?/;
const GENERIC_LEAD = /^(our|the|join|become|apply|official|an?|my|your|new)$/i;

/** True when the page's title names a *different* brand's programme (e.g. a blog post about one). */
export function programmeOfAnotherBrand(title, domain) {
  const m = NAMED_PROGRAMME.exec(String(title || ''));
  if (!m) return false;
  const words = m[1].split(/\s+/).filter((w) => !GENERIC_LEAD.test(w));
  return words.length > 0 && !domainMatchesName(domain, words.join(' '));
}

export function serperQueries(niche) {
  const kw = (NICHE_KEYWORDS[niche] || [niche])[0];
  return [`"influencer program" OR "creator program" ${kw} India`, `"collaborate with us" influencers ${kw} brand India`];
}

/** Brand name from the page: og:site_name, else the title part that matches the domain, else the domain label. */
export function brandNameFrom(meta, domain) {
  if (meta.siteName && meta.siteName.length <= 60) return meta.siteName.trim();
  const parts = String(meta.title || '').split(/\s[|–—-]\s/).map((p) => p.trim()).filter(Boolean);
  const match = parts.find((p) => p.length <= 60 && domainMatchesName(domain, p));
  if (match) return match;
  const label = domain.split('.')[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function createSerperSource({ search: searchArg, reader: readerArg, cacheFn = cached, config = () => getConfig().discovery } = {}) {
  async function discoverForNiche(niche, search, now) {
    const reader = readerArg || createPageReader();
    const results = [];
    for (const q of serperQueries(niche)) results.push(...(await search(q)));
    const byDomain = new Map();
    let read = 0;
    for (const r of results) {
      if (read >= MAX_PAGES_PER_NICHE) break;
      const domain = normalizeDomain(r.link);
      if (!domain || byDomain.has(domain) || isNonBrandDomain(domain) || LISTICLE.test(r.title)) continue;
      read++;
      const page = await reader.read(r.link);
      if (!page) continue;
      const pageDomain = page.domain || domain;
      if (isNonBrandDomain(pageDomain)) continue;
      const programme = detectProgramme({ url: page.url, title: page.meta.title, h1: page.meta.h1 });
      if (!programme || AGENCY.test(`${page.meta.title} ${page.meta.description}`)) continue;
      if (LISTICLE.test(page.meta.title) || LISTICLE.test(page.meta.h1) || programmeOfAnotherBrand(page.meta.title, pageDomain)) continue;
      // Platforms often describe themselves only on their homepage ("Influencer Marketing Platform").
      const home = new URL(page.url).pathname.replace(/\/+$/, '') === '' ? page : await reader.read(`https://${pageDomain}/`);
      if (home && AGENCY.test(`${home.meta.title} ${home.meta.description} ${home.meta.h1}`)) continue;
      const name = brandNameFrom(page.meta, pageDomain);
      byDomain.set(pageDomain, {
        brand: {
          name,
          domain: pageDomain,
          website: `https://${pageDomain}`,
          description: page.meta.description || undefined,
          categories: (NICHE_TO_CATEGORIES[niche] || []).slice(0, 1),
          markets: ['India'],
          isDemo: false,
          creatorProgramme: { url: programme.url, title: programme.title, detectedAt: now },
        },
        signal: { kind: 'creator_program', productOrCampaign: null, title: programme.title },
        evidence: [{ url: page.url, title: programme.title, excerpt: page.meta.description || null, publishedAt: null, retrievedAt: now, source: 'brand_website', verification: 'verified', kind: 'fact' }],
        contacts: [],
      });
    }
    return [...byDomain.values()];
  }

  return {
    id: 'serper',
    label: 'Web search for brand creator programmes (Serper)',
    isDemo: false,
    async collect({ profile, now = new Date() }) {
      let search = searchArg;
      if (!search) {
        const apiKey = config().serperApiKey;
        search = apiKey ? (q) => serperSearch(q, { apiKey }) : null;
      }
      if (!search) return { status: 'unavailable', candidates: [], message: 'SERPER_API_KEY is not configured' };
      const niches = rotateNiches(profile.niches, MAX_NICHES, now, CACHE_HOURS);
      const candidates = [];
      const errors = [];
      for (const niche of niches) {
        try {
          const { value } = await cacheFn(`serper:${niche}:${bucket(now, CACHE_HOURS)}`, CACHE_HOURS * 3_600_000, () => discoverForNiche(niche, search, now));
          candidates.push(...value);
        } catch (err) {
          errors.push(`${niche}: ${err.message}`);
        }
      }
      if (errors.length && errors.length === niches.length) return { status: 'error', candidates: [], message: errors.join('; ') };
      return { status: 'ok', candidates, message: errors.length ? errors.join('; ') : undefined };
    },
  };
}

export const serperSource = createSerperSource();
