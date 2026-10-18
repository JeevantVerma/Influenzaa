import { getConfig } from '../../../config/env.js';
import { normalizeDomain } from '../../../lib/domain.js';
import { classifySignalText, NICHE_TO_CATEGORIES } from '../taxonomy.js';

// Brave Search API (a permitted, keyed search API). Results are treated as
// unverified hypotheses about the website owner until a creator or an
// official source confirms them.

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const MAX_QUERIES_PER_RUN = 3;
const MIN_INTERVAL_MS = 1100; // stay under 1 request/second
let lastCall = 0;

// Media, marketplaces and social networks are not brands; skip them.
const NON_BRAND_DOMAINS = [
  'youtube.com', 'instagram.com', 'facebook.com', 'linkedin.com', 'x.com', 'twitter.com', 'wikipedia.org', 'amazon.in', 'flipkart.com',
  'economictimes.indiatimes.com', 'indiatimes.com', 'livemint.com', 'business-standard.com', 'moneycontrol.com', 'thehindu.com',
  'hindustantimes.com', 'ndtv.com', 'yourstory.com', 'inc42.com', 'afaqs.com', 'exchange4media.com', 'medium.com', 'reddit.com',
];

async function throttle() {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export const braveSource = {
  id: 'brave',
  label: 'Brave Search API (unverified web signals)',
  isDemo: false,
  async collect({ profile, config, now = new Date() }) {
    const key = getConfig().discovery.braveApiKey;
    if (!key) return { status: 'unavailable', candidates: [], message: 'BRAVE_SEARCH_API_KEY is not configured' };
    const niches = (profile.niches || []).slice(0, 3);
    const queries = (config.sourceConfiguration?.searchQueries?.length
      ? config.sourceConfiguration.searchQueries
      : niches.map((n) => `${n} brand launch India influencer collaboration`)
    ).slice(0, MAX_QUERIES_PER_RUN);
    const candidates = [];
    for (const q of queries) {
      await throttle();
      const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&country=IN&count=10&freshness=pm`;
      const res = await fetch(url, { headers: { accept: 'application/json', 'x-subscription-token': key }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 429) return { status: 'error', candidates, message: 'Search API rate limit reached' };
      if (!res.ok) return { status: 'error', candidates, message: `Search API responded ${res.status}` };
      const body = await res.json();
      for (const r of body?.web?.results || []) {
        const domain = normalizeDomain(r.url);
        if (!domain || NON_BRAND_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) continue;
        const kind = classifySignalText(`${r.title} ${r.description}`);
        if (kind === 'category_match') continue;
        const categories = [...new Set(niches.flatMap((n) => NICHE_TO_CATEGORIES[n] || []).slice(0, 1))];
        candidates.push({
          brand: { name: r.profile?.name || domain.split('.')[0], domain, categories, markets: [], website: `https://${domain}`, isDemo: false },
          signal: { kind, productOrCampaign: String(r.title).slice(0, 120), title: r.title },
          evidence: [
            {
              url: r.url,
              title: String(r.title).slice(0, 300),
              excerpt: String(r.description || '').replace(/<[^>]*>/g, '').slice(0, 500),
              publishedAt: r.page_age ? new Date(r.page_age) : null,
              retrievedAt: now,
              source: 'brave',
              verification: 'unverified',
              kind: 'hypothesis',
            },
          ],
          contacts: [],
        });
      }
    }
    return { status: 'ok', candidates };
  },
};
