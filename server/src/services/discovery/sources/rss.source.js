import { XMLParser } from 'fast-xml-parser';
import { safeFetch } from '../../../lib/safeFetch.js';
import { normalizeDomain } from '../../../lib/domain.js';
import { classifySignalText } from '../taxonomy.js';

const MAX_FEEDS = 10;
const MAX_ITEMS_PER_FEED = 15;
const MAX_AGE_DAYS = 120;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, htmlEntities: true });

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const textOf = (v) => (typeof v === 'string' ? v : v?.['#text'] ?? v?.__cdata ?? '');
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export function parseFeed(xml) {
  const doc = parser.parse(xml);
  if (doc?.rss?.channel) {
    return asArray(doc.rss.channel.item).map((i) => ({
      title: stripHtml(textOf(i.title)),
      link: textOf(i.link),
      description: stripHtml(textOf(i.description)).slice(0, 600),
      publishedAt: i.pubDate ? new Date(textOf(i.pubDate)) : null,
    }));
  }
  if (doc?.feed) {
    return asArray(doc.feed.entry).map((e) => {
      const links = asArray(e.link);
      const link = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate')?.['@_href'] || links[0]?.['@_href'];
      return {
        title: stripHtml(textOf(e.title)),
        link,
        description: stripHtml(textOf(e.summary) || textOf(e.content)).slice(0, 600),
        publishedAt: e.published || e.updated ? new Date(textOf(e.published) || textOf(e.updated)) : null,
      };
    });
  }
  throw new Error('Not an RSS or Atom feed');
}

/**
 * Brand newsroom / press-release feeds configured by the creator. Each feed is
 * tied to a brand and domain; items linking to that domain count as verified
 * (official source), anything else as unverified.
 */
export const rssSource = {
  id: 'rss',
  label: 'Brand newsroom & press-release feeds (RSS/Atom)',
  isDemo: false,
  async collect({ config, now = new Date() }) {
    const feeds = (config.sourceConfiguration?.rssFeeds || []).slice(0, MAX_FEEDS);
    if (!feeds.length) return { status: 'skipped', candidates: [], message: 'No feeds configured' };
    const candidates = [];
    const failures = [];
    for (const feed of feeds) {
      const brandDomain = normalizeDomain(feed.brandDomain || feed.url);
      try {
        const res = await safeFetch(feed.url, { timeoutMs: 10_000, maxBytes: 1_500_000 });
        const items = parseFeed(res.text).slice(0, MAX_ITEMS_PER_FEED);
        for (const item of items) {
          if (!item.link || !item.title) continue;
          if (item.publishedAt && (now - item.publishedAt) / 86_400_000 > MAX_AGE_DAYS) continue;
          const kind = classifySignalText(`${item.title} ${item.description}`);
          if (kind === 'category_match') continue; // headline carries no collaboration signal
          const official = normalizeDomain(item.link) === brandDomain;
          candidates.push({
            brand: { name: feed.brandName || brandDomain, domain: brandDomain, categories: feed.categories || [], markets: [], website: `https://${brandDomain}`, isDemo: false },
            signal: { kind, productOrCampaign: item.title.slice(0, 120), title: item.title },
            evidence: [
              {
                url: item.link,
                title: item.title,
                excerpt: item.description,
                publishedAt: item.publishedAt && !Number.isNaN(item.publishedAt.getTime()) ? item.publishedAt : null,
                retrievedAt: now,
                source: 'rss',
                verification: official ? 'verified' : 'unverified',
                kind: 'fact',
              },
            ],
            contacts: [],
          });
        }
      } catch (err) {
        failures.push(`${brandDomain || 'feed'}: ${err.message}`);
      }
    }
    const status = failures.length === feeds.length ? 'error' : 'ok';
    return { status, candidates, message: failures.length ? `${failures.length} feed(s) failed: ${failures.slice(0, 3).join('; ')}` : undefined };
  },
};
