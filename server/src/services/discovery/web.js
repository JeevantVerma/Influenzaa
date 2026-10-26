import { safeFetch } from '../../lib/safeFetch.js';
import { normalizeBrandName, normalizeDomain } from '../../lib/domain.js';
import { parseRobots, robotsAllows } from '../contacts/websiteContacts.js';
import { pageMeta, pageText } from '../../lib/html.js';

export { pageMeta, pageText };

// Shared helpers for discovery sources that read public web pages: a list of
// domains that are never a brand's own website, page metadata parsing, and a
// polite page reader that honours robots.txt and spaces out requests per host.

// Marketplaces, social networks, link-in-bio services, news and blogging
// platforms: useful as leads, never accepted as a brand's official website
// unless the brand *is* that company (see domainMatchesName).
const NON_BRAND = [
  'amazon.in', 'amazon.com', 'flipkart.com', 'myntra.com', 'ajio.com', 'meesho.com', 'nykaa.com', 'tatacliq.com', 'jiomart.com', 'bigbasket.com', 'blinkit.com', 'zeptonow.com', 'swiggy.com', 'zomato.com', 'firstcry.com', 'snapdeal.com', 'indiamart.com', 'justdial.com',
  'instagram.com', 'facebook.com', 'fb.com', 'youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'linkedin.com', 'threads.net', 'pinterest.com', 'snapchat.com', 'tiktok.com', 'reddit.com', 'quora.com', 'whatsapp.com', 'wa.me', 't.me',
  'medium.com', 'substack.com', 'blogspot.com', 'wordpress.com', 'wikipedia.org', 'crunchbase.com', 'tracxn.com', 'zaubacorp.com', 'glassdoor.com', 'ambitionbox.com', 'naukri.com',
  'indiatimes.com', 'economictimes.com', 'livemint.com', 'business-standard.com', 'moneycontrol.com', 'thehindu.com', 'hindustantimes.com', 'ndtv.com', 'indianexpress.com', 'financialexpress.com', 'news18.com', 'firstpost.com', 'businesstoday.in', 'yourstory.com', 'inc42.com', 'entrackr.com', 'afaqs.com', 'exchange4media.com', 'bestmediainfo.com', 'thebridgechronicle.com', 'ianslive.in', 'indiagazette.com', 'aninews.in', 'ptinews.com', 'zeebiz.com', 'cnbctv18.com', 'outlookindia.com', 'deccanherald.com', 'tribuneindia.com', 'thequint.com', 'scroll.in', 'theprint.in',
  'google.com', 'apple.com', 'apps.apple.com', 'play.google.com',
];

// Link-in-bio pages, shorteners and app deep-link services: never a brand's
// website, even when the brand's name is part of the address (myntra.onelink.me).
const REDIRECTORS = [
  'linktr.ee', 'bio.link', 'beacons.ai', 'linkin.bio', 'clicklinkin.bio', 'taplink.cc', 'campsite.bio', 'lnk.bio', 'msha.ke', 'linkfly.to', 'solo.to', 'allmylinks.com', 'hoo.be', 'koji.to', 'carrd.co', 'linkpop.com', 'snipfeed.co', 'stan.store',
  'bit.ly', 'tinyurl.com', 'shorturl.at', 'cutt.ly', 'rb.gy', 'go.link', 'onelink.me', 'app.link', 'page.link', 'smart.link', 'l.instagram.com', 'wa.me', 't.me',
];

const onList = (list, domain) => {
  const d = String(domain || '').toLowerCase();
  return list.some((n) => d === n || d.endsWith(`.${n}`));
};

export function isRedirectorDomain(domain) {
  return onList(REDIRECTORS, domain);
}

export function isNonBrandDomain(domain) {
  return onList(NON_BRAND, domain) || isRedirectorDomain(domain);
}

const GENERIC_TOKENS = new Set(['the', 'and', 'india', 'indian', 'official', 'store', 'shop', 'online', 'brand', 'brands', 'co', 'company', 'pvt', 'ltd', 'foods', 'labs', 'by', 'industries', 'enterprises', 'products', 'group', 'ventures', 'technologies', 'consumer', 'dairy', 'food', 'retail']);

/** Distinctive words of a brand name, in order ("Milky Mist Dairy Food Ltd" → milky, mist). */
export function nameTokens(name) {
  return normalizeBrandName(name).split(' ').filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
}

/** The words a brand is usually known by: its first one or two distinctive words. */
export function coreTokens(name) {
  const t = nameTokens(name);
  return t.length >= 2 ? t.slice(0, 2) : t;
}

/** True when the domain's own label spells the brand name (e.g. "Milky Mist Dairy Food Ltd" ↔ milkymist.com). */
export function domainMatchesName(domain, name) {
  if (isRedirectorDomain(domain)) return false;
  const label = String(domain || '').split('.')[0].replace(/[^a-z0-9]/g, '');
  const all = normalizeBrandName(name).replace(/\s+/g, '');
  if (all.length >= 3 && label.includes(all)) return true;
  const core = coreTokens(name).join('');
  return core.length >= 3 && label.includes(core);
}

/** True when the page's site name or title contains the brand's core words. */
export function pageNamesBrand(meta, name) {
  const hay = normalizeBrandName(`${meta.siteName || ''} ${meta.title || ''}`);
  const core = coreTokens(name);
  return core.length > 0 && core.every((t) => hay.split(' ').includes(t) || hay.replace(/\s+/g, '').includes(core.join('')));
}

/** Obvious official domains to try for a brand name when no search API is configured. */
export function guessDomains(name) {
  const labels = [...new Set([coreTokens(name).join(''), normalizeBrandName(name).replace(/\s+/g, '')])].filter((l) => l.length >= 3 && l.length <= 40);
  return labels.flatMap((l) => [`${l}.com`, `${l}.in`, `${l}.co.in`]).slice(0, 6);
}

/** Removes tracking parameters (Google's srsltid, utm_*, click ids) from a URL we store. */
export function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(srsltid|utm_\w+|gclid|fbclid|igshid|mc_cid|mc_eid|ref|ref_src)$/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return raw;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A page reader for one discovery run: honours each host's robots.txt (cached
 * per run), waits at least `minGapMs` between requests to the same host, and
 * returns null (never throws) when a page is disallowed or unavailable.
 */
export function createPageReader({ fetchImpl = safeFetch, sleepImpl = sleep, minGapMs = 1000, now = Date.now } = {}) {
  const robots = new Map(); // host → rules | 'deny'
  const lastHit = new Map();

  async function polite(host) {
    const wait = (lastHit.get(host) ?? 0) + minGapMs - now();
    if (wait > 0) await sleepImpl(wait);
    lastHit.set(host, now());
  }

  async function rulesFor(origin, host) {
    if (robots.has(host)) return robots.get(host);
    let rules;
    try {
      await polite(host);
      rules = parseRobots((await fetchImpl(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 512 * 1024 })).text);
    } catch (err) {
      rules = err.status >= 400 && err.status < 500 ? [] : 'deny'; // RFC 9309
    }
    robots.set(host, rules);
    return rules;
  }

  return {
    async read(rawUrl, { maxBytes = 5 * 1024 * 1024 } = {}) {
      let url;
      try {
        url = new URL(rawUrl);
      } catch {
        return null;
      }
      const host = url.hostname.toLowerCase();
      const rules = await rulesFor(url.origin, host);
      if (rules === 'deny' || !robotsAllows(rules, url.pathname + url.search)) return null;
      try {
        await polite(host);
        const page = await fetchImpl(url.toString(), { timeoutMs: 10_000, maxBytes });
        if (page.contentType && !/html|xml|text\/plain/i.test(page.contentType)) return null;
        const finalUrl = cleanUrl(page.url || url.toString());
        return { url: finalUrl, domain: normalizeDomain(finalUrl), html: page.text, meta: pageMeta(page.text) };
      } catch {
        return null;
      }
    },
  };
}
