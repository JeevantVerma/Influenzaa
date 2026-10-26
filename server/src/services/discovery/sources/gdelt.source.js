import { getConfig } from '../../../config/env.js';
import { extractBrandSignals, aiStatus } from '../../ai/index.js';
import { NICHE_KEYWORDS, NICHE_TO_CATEGORIES, rotateNiches } from '../taxonomy.js';
import { cached, bucket } from '../cache.js';
import { coreTokens, createPageReader, pageText } from '../web.js';
import { resolveBrand } from '../brandResolver.js';
import { serperSearch, serperNews } from '../serper.js';
import { normalizeDomain } from '../../../lib/domain.js';

// Indian business news from the GDELT Project (free; commercial use allowed
// with attribution to the GDELT Project). For each recent article the app
// reads the article itself, an AI step lists the consumer brands it is about
// with a verbatim supporting sentence, the sentence is checked against the
// article text, and the brand's official website is confirmed by visiting it.
// GDELT is often busy; when it stays unavailable, Google News results (via
// Serper, if configured) are used as the article list instead.

const ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const MAX_NICHES = 2;
const MAX_ARTICLES = 10;
const MAX_CANDIDATES_PER_NICHE = 8;
const GDELT_GAP_MS = 6000; // GDELT allows roughly one request every few seconds
// GDELT answers slowly and often turns requests away when busy, so retry patiently.
const GDELT_RETRY_WAITS_MS = [20_000, 30_000, 45_000];
const CACHE_HOURS = 12;

const KIND_MAP = {
  product_launch: 'product_launch',
  funding_round: 'funding_round',
  regional_expansion: 'regional_expansion',
  marketing_campaign: 'marketing_campaign',
  brand_ambassador: 'marketing_campaign',
  creator_campaign: 'creator_campaign_news',
  other: 'category_match',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function gdeltQuery(niche) {
  const words = (NICHE_KEYWORDS[niche] || [niche, `${niche} brand`]).slice(0, 3).map((k) => (k.includes(' ') ? `"${k}"` : k));
  return `("launches" OR "launched" OR "unveils" OR "raises" OR "brand ambassador" OR "influencer") (${words.join(' OR ')}) sourcecountry:IN sourcelang:english`;
}

/** GDELT `seendate` (YYYYMMDDTHHMMSSZ) → Date. */
export function parseSeenDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s || ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

/** A brand is kept only if its name and its quote both appear in the article text. */
export function quoteIsGrounded(brand, text) {
  const t = squash(text);
  const quote = squash(brand.evidence_quote);
  // The name check uses the brand's core words, so "Ltd" vs "Limited" doesn't matter.
  const core = coreTokens(brand.name);
  return quote.length >= 20 && t.includes(quote) && core.length > 0 && core.every((w) => t.includes(w));
}

/** News-search query for brand activity in a niche (used when GDELT is unavailable). */
export function newsQuery(niche) {
  const words = (NICHE_KEYWORDS[niche] || [niche]).slice(0, 2).join(' OR ');
  return `(${words}) brand (launch OR launches OR campaign OR ambassador OR funding) India`;
}

export function createGdeltSource({ fetchImpl = fetch, sleepImpl = sleep, reader: readerArg, extract = extractBrandSignals, search: searchArg, news: newsArg, cacheFn = cached, ai = aiStatus, config = () => getConfig().discovery } = {}) {
  let lastGdeltCall = 0;

  async function gdeltArticles(query) {
    const url = `${ENDPOINT}?${new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '30', timespan: '7d', sort: 'DateDesc' })}`;
    let problem = 'no response';
    for (let attempt = 0; attempt <= GDELT_RETRY_WAITS_MS.length; attempt++) {
      if (attempt > 0) await sleepImpl(GDELT_RETRY_WAITS_MS[attempt - 1]);
      const wait = lastGdeltCall + GDELT_GAP_MS - Date.now();
      if (wait > 0) await sleepImpl(wait);
      lastGdeltCall = Date.now();
      let res;
      try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(45_000) });
      } catch (err) {
        problem = `could not connect: ${err.cause?.code || err.message}`;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        problem = res.status === 429 ? 'too many requests' : `responded ${res.status}`;
        continue;
      }
      if (!res.ok) throw new Error(`GDELT responded ${res.status}`);
      const text = await res.text();
      if (/limit requests/i.test(text)) {
        problem = 'too many requests';
        continue;
      }
      if (!text.trim().startsWith('{')) throw new Error(`GDELT rejected the query: ${text.slice(0, 120)}`);
      return (JSON.parse(text).articles || [])
        .filter((a) => a.url && /english/i.test(a.language || 'english'))
        .map((a) => ({ url: a.url, title: a.title, domain: a.domain, publishedAt: parseSeenDate(a.seendate), source: 'gdelt' }));
    }
    throw new Error(`GDELT is busy (${problem})`);
  }

  /** GDELT articles, or Google News results when GDELT stays unavailable. */
  async function articlesFor(niche, news, notes) {
    try {
      return await gdeltArticles(gdeltQuery(niche));
    } catch (err) {
      if (!news) throw new Error(`Could not reach GDELT: ${err.message}`, { cause: err });
      notes.push(`${niche}: GDELT was busy, used news search instead`);
      return (await news(newsQuery(niche))).map((r) => ({ url: r.link, title: r.title, domain: normalizeDomain(r.link), publishedAt: r.publishedAt, source: 'news' }));
    }
  }

  async function discoverForNiche(niche, now, notes) {
    const reader = readerArg || createPageReader();
    const apiKey = searchArg === undefined || newsArg === undefined ? config().serperApiKey : null;
    const search = searchArg !== undefined ? searchArg : apiKey ? (q) => serperSearch(q, { apiKey }) : null;
    const news = newsArg !== undefined ? newsArg : apiKey ? (q) => serperNews(q, { apiKey, now }) : null;
    const articles = await articlesFor(niche, news, notes);
    const byDomain = new Map();
    const seenTitles = new Set();
    let read = 0;
    let aiFailures = 0;
    for (const article of articles) {
      if (read >= MAX_ARTICLES || byDomain.size >= MAX_CANDIDATES_PER_NICHE) break;
      const titleKey = squash(article.title).slice(0, 80);
      if (seenTitles.has(titleKey)) continue; // syndicated copies of one story
      seenTitles.add(titleKey);
      const page = await reader.read(article.url);
      if (!page) continue;
      const text = pageText(page.html, 12_000);
      if (text.length < 400) continue;
      read++;
      const result = await extract({ title: article.title, text, sourceDomain: article.domain });
      if (!result?.data) {
        aiFailures++;
        continue;
      }
      for (const b of result.data.brands) {
        if (!b.is_consumer_brand || !quoteIsGrounded(b, text)) continue;
        const resolved = await resolveBrand({ name: b.name, websiteHint: b.website, reader, search, cacheFn });
        if (!resolved) continue;
        const evidence = {
          url: page.url,
          title: String(article.title).slice(0, 300),
          excerpt: b.evidence_quote.slice(0, 400),
          publishedAt: article.publishedAt,
          retrievedAt: now,
          source: article.source,
          verification: 'unverified',
          kind: 'fact',
        };
        const existing = byDomain.get(resolved.domain);
        if (existing) {
          existing.evidence.push(evidence);
          continue;
        }
        byDomain.set(resolved.domain, {
          brand: {
            name: resolved.name,
            domain: resolved.domain,
            website: resolved.website,
            description: resolved.description || undefined,
            categories: (NICHE_TO_CATEGORIES[niche] || []).slice(0, 1),
            markets: ['India'],
            isDemo: false,
          },
          signal: { kind: KIND_MAP[b.signal_kind] || 'category_match', productOrCampaign: b.product_or_campaign || null, title: b.summary || article.title },
          evidence: [evidence],
          contacts: [],
        });
      }
    }
    // Don't cache an empty result caused by the AI being unavailable (e.g. quota); retry next run.
    if (!byDomain.size && aiFailures > 0) throw new Error(`AI extraction failed for ${aiFailures} article(s)`);
    return [...byDomain.values()];
  }

  return {
    id: 'gdelt',
    label: 'Indian business news (GDELT Project, news search as backup) with AI brand extraction',
    isDemo: false,
    async collect({ profile, now = new Date() }) {
      if (ai().provider === 'disabled') return { status: 'unavailable', candidates: [], message: 'News discovery needs an AI provider to read articles' };
      const niches = rotateNiches(profile.niches, MAX_NICHES, now, CACHE_HOURS);
      const candidates = [];
      const errors = [];
      const notes = [];
      for (const niche of niches) {
        try {
          // Shared by every creator in this niche for 12 hours.
          const { value } = await cacheFn(`gdelt:${niche}:${bucket(now, CACHE_HOURS)}`, CACHE_HOURS * 3_600_000, () => discoverForNiche(niche, now, notes));
          candidates.push(...value);
        } catch (err) {
          errors.push(`${niche}: ${err.message}`);
        }
      }
      if (errors.length && errors.length === niches.length) return { status: 'error', candidates: [], message: errors.join('; ') };
      const message = [...errors, ...notes].join('; ');
      return { status: 'ok', candidates, message: message || undefined };
    },
  };
}

export const gdeltSource = createGdeltSource();
