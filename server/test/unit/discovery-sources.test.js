import { describe, it, expect } from 'vitest';
import { cleanUrl, coreTokens, createPageReader, domainMatchesName, guessDomains, isNonBrandDomain, pageNamesBrand } from '../../src/services/discovery/web.js';
import { pageMeta } from '../../src/lib/html.js';
import { normalizeInstagramHandle } from '../../src/lib/domain.js';
import { detectProgramme } from '../../src/services/contacts/websiteContacts.js';
import { resolveBrand } from '../../src/services/discovery/brandResolver.js';
import { createGdeltSource, gdeltQuery, parseSeenDate, quoteIsGrounded } from '../../src/services/discovery/sources/gdelt.source.js';
import { rotateNiches } from '../../src/services/discovery/taxonomy.js';
import { relativeDate } from '../../src/services/discovery/serper.js';
import { brandNameFrom, createSerperSource, programmeOfAnotherBrand } from '../../src/services/discovery/sources/serper.source.js';
import { brandMentions, createInstagramSource, hashtagsFor, profileToBrand } from '../../src/services/discovery/sources/instagram.source.js';

// All sources run against fakes here: no network, no database.
const noCache = async (_key, _ttl, fn) => ({ value: await fn(), cached: false });
const html = ({ title = '', siteName = '', description = '', h1 = '', body = '' }) =>
  `<html><head><title>${title}</title>${siteName ? `<meta property="og:site_name" content="${siteName}">` : ''}${description ? `<meta name="description" content="${description}">` : ''}</head><body>${h1 ? `<h1>${h1}</h1>` : ''}${body}</body></html>`;

/** Fake page reader: url (or domain homepage) → page. */
function fakeReader(pages) {
  const reads = [];
  return {
    reads,
    async read(url) {
      reads.push(url);
      const u = new URL(url);
      const key = Object.keys(pages).find((k) => k === url || k === `${u.hostname}${u.pathname}` || (u.pathname === '/' && k === u.hostname));
      if (!key) return null;
      const h = pages[key];
      return { url, domain: u.hostname.replace(/^www\./, ''), html: h, meta: pageMeta(h) };
    },
  };
}

describe('brand name and domain matching', () => {
  it('matches a domain to a brand by its core words', () => {
    expect(coreTokens('Milky Mist Dairy Food Ltd')).toEqual(['milky', 'mist']);
    expect(domainMatchesName('milkymist.com', 'Milky Mist Dairy Food Ltd')).toBe(true);
    expect(domainMatchesName('thewholetruthfoods.com', 'The Whole Truth')).toBe(true);
    expect(domainMatchesName('amazon.in', 'Milky Mist')).toBe(false);
    expect(pageNamesBrand({ title: 'Milky Mist | Dairy Products' }, 'Milky Mist Dairy Food Ltd')).toBe(true);
    expect(pageNamesBrand({ title: 'Buy domains cheap' }, 'Milky Mist')).toBe(false);
  });

  it('lists obvious official domains, shortest name first', () => {
    expect(guessDomains('Milky Mist Dairy Food Ltd').slice(0, 3)).toEqual(['milkymist.com', 'milkymist.in', 'milkymist.co.in']);
  });

  it('strips tracking parameters from stored links', () => {
    expect(cleanUrl('https://desikoncept.com/join-us?srsltid=AU7&utm_source=x&page=2#top')).toBe('https://desikoncept.com/join-us?page=2');
  });

  it('never treats marketplaces, social networks or news sites as a brand site', () => {
    for (const d of ['amazon.in', 'shop.myntra.com', 'instagram.com', 'linktr.ee', 'myntra.onelink.me', 'economictimes.indiatimes.com']) expect(isNonBrandDomain(d)).toBe(true);
    expect(domainMatchesName('myntra.onelink.me', 'Myntra')).toBe(false);
    expect(isNonBrandDomain('milkymist.com')).toBe(false);
  });
});

describe('Instagram handles', () => {
  it('accepts handles and profile links, rejects anything else', () => {
    expect(normalizeInstagramHandle('@Fit.Priya')).toBe('fit.priya');
    expect(normalizeInstagramHandle('https://www.instagram.com/fit_rahul/?hl=en')).toBe('fit_rahul');
    expect(normalizeInstagramHandle('instagram.com/p/ABC123')).toBeNull();
    expect(normalizeInstagramHandle('not a handle!')).toBeNull();
  });
});

describe('creator programme detection', () => {
  it('recognises programme pages and ignores listicles and careers pages', () => {
    expect(detectProgramme({ url: 'https://brand.in/pages/influencer-program', title: 'Join us' })).toBeTruthy();
    expect(detectProgramme({ url: 'https://brand.in/x', title: 'Become an Affiliate | Brand' })).toBeTruthy();
    expect(detectProgramme({ url: 'https://brand.in/x', title: 'Brand', h1: 'Collaborate with us' })).toBeTruthy();
    expect(detectProgramme({ url: 'https://blog.in/top-10-influencer-programs', title: 'Top 10 influencer programs in India' })).toBeNull();
    expect(detectProgramme({ url: 'https://brand.in/careers', title: 'Work with us - Careers' })).toBeNull();
  });
});

describe('resolving a brand website', () => {
  it('accepts a given website once its homepage loads and matches the brand', async () => {
    const reader = fakeReader({ 'milkymist.com': html({ title: 'Milky Mist', description: 'Dairy products' }) });
    const r = await resolveBrand({ name: 'Milky Mist Dairy Food Ltd', websiteHint: 'https://www.milkymist.com/about', reader, cacheFn: noCache });
    expect(r).toMatchObject({ domain: 'milkymist.com', website: 'https://milkymist.com', description: 'Dairy products' });
  });

  it('rejects a marketplace listing as the brand site and falls back to a verified obvious domain', async () => {
    const reader = fakeReader({ 'amazon.in': html({ title: 'Milky Mist: Amazon.in' }), 'milkymist.com': html({ title: 'Milky Mist Official' }) });
    const r = await resolveBrand({ name: 'Milky Mist', websiteHint: 'https://amazon.in/milky-mist', reader, cacheFn: noCache });
    expect(r.domain).toBe('milkymist.com');
    expect(reader.reads).not.toContain('https://amazon.in/');
  });

  it('does not accept an obvious domain whose homepage is about something else', async () => {
    const reader = fakeReader({ 'huemn.com': html({ title: 'This domain is for sale' }) });
    expect(await resolveBrand({ name: 'HUEMN', reader, cacheFn: noCache })).toBeNull();
  });

  it('accepts a business profile\'s own link on the brand\'s first word only when trusted', async () => {
    const reader = fakeReader({ 'adobe.com': html({ title: 'Adobe: creative solutions' }) });
    expect(await resolveBrand({ name: 'Adobe Video', websiteHint: 'https://adobe.com', reader, cacheFn: noCache })).toBeNull();
    expect((await resolveBrand({ name: 'Adobe Video', websiteHint: 'https://adobe.com', reader, cacheFn: noCache, trustHint: true })).domain).toBe('adobe.com');
  });

  it('keeps the brand\'s own domain when it redirects elsewhere', async () => {
    const reader = { async read() { return { url: 'https://www.myntraglobal.com/', domain: 'myntraglobal.com', html: '', meta: { title: 'Myntra' } }; } };
    expect((await resolveBrand({ name: 'Myntra', websiteHint: 'https://www.myntra.com/x', reader, cacheFn: noCache })).domain).toBe('myntra.com');
  });

  it('uses web search results when available', async () => {
    const reader = fakeReader({ 'peakpulse.in': html({ title: 'PeakPulse Nutrition' }) });
    const search = async () => [{ link: 'https://www.flipkart.com/peakpulse' }, { link: 'https://peakpulse.in/' }];
    expect((await resolveBrand({ name: 'PeakPulse', reader, search, cacheFn: noCache })).domain).toBe('peakpulse.in');
  });
});

describe('page reader', () => {
  it('honours robots.txt and spaces out requests to the same host', async () => {
    const requested = [];
    const sleeps = [];
    let t = 0;
    const fetchImpl = async (url) => {
      requested.push(url);
      if (url.endsWith('/robots.txt')) return { url, text: 'User-agent: *\nDisallow: /private', contentType: 'text/plain' };
      return { url, text: '<title>Hi</title>', contentType: 'text/html' };
    };
    const reader = createPageReader({ fetchImpl, sleepImpl: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t, minGapMs: 1000 });
    expect(await reader.read('https://brand.in/private/x')).toBeNull();
    expect((await reader.read('https://brand.in/about')).meta.title).toBe('Hi');
    expect(requested).toEqual(['https://brand.in/robots.txt', 'https://brand.in/about']);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it('does not read a site whose robots.txt cannot be fetched (server error)', async () => {
    const fetchImpl = async (url) => {
      if (url.endsWith('/robots.txt')) throw Object.assign(new Error('503'), { status: 503 });
      return { url, text: 'x', contentType: 'text/html' };
    };
    expect(await createPageReader({ fetchImpl, sleepImpl: async () => {} }).read('https://brand.in/')).toBeNull();
  });
});

describe('GDELT news source', () => {
  const ARTICLE = 'Bengaluru, Oct 17. Milky Mist Dairy Food Limited has introduced Milky Mist High Protein Milk in a 250 ml pack. '.repeat(6) + 'The company did not disclose pricing. Analysts expect strong demand for protein products across Indian cities this year.';
  const gdeltResponse = { articles: [{ url: 'https://news.example.in/milky', title: 'Milky Mist launches High Protein Milk', seendate: '20261017T103000Z', domain: 'news.example.in', language: 'English', sourcecountry: 'India' }] };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(gdeltResponse) });
  const reader = () => fakeReader({ 'news.example.in/milky': html({ title: 'Milky Mist launches', body: `<p>${ARTICLE}</p>` }), 'milkymist.com': html({ title: 'Milky Mist' }) });

  it('builds an India-only English query from the niche vocabulary', () => {
    expect(gdeltQuery('fitness')).toMatch(/\(protein OR sportswear OR activewear\) sourcecountry:IN sourcelang:english$/);
    expect(parseSeenDate('20261017T103000Z').toISOString()).toBe('2026-10-17T10:30:00.000Z');
  });

  it('keeps only consumer brands whose quote really appears in the article, with a verified website', async () => {
    const extract = async () => ({
      data: {
        brands: [
          { name: 'Milky Mist Dairy Food Ltd', website: null, is_consumer_brand: true, signal_kind: 'product_launch', product_or_campaign: 'High Protein Milk', evidence_quote: 'Milky Mist Dairy Food Limited has introduced Milky Mist High Protein Milk in a 250 ml pack.', summary: 'Launch of a protein milk.' },
          { name: 'Invented Brand', website: null, is_consumer_brand: true, signal_kind: 'funding_round', product_or_campaign: null, evidence_quote: 'Invented Brand raised ₹100 crore from investors this week.', summary: 'Made up.' },
          { name: 'Some Bank', website: null, is_consumer_brand: false, signal_kind: 'other', product_or_campaign: null, evidence_quote: 'The company did not disclose pricing.', summary: 'Not a consumer brand.' },
        ],
      },
    });
    const source = createGdeltSource({ fetchImpl, sleepImpl: async () => {}, reader: reader(), extract, search: null, news: null, cacheFn: noCache, ai: () => ({ provider: 'mock' }) });
    const r = await source.collect({ profile: { niches: ['fitness'] }, now: new Date('2026-10-18T00:00:00Z') });
    expect(r.status).toBe('ok');
    expect(r.candidates).toHaveLength(1);
    const [c] = r.candidates;
    expect(c.brand).toMatchObject({ domain: 'milkymist.com', isDemo: false, markets: ['India'] });
    expect(c.signal).toMatchObject({ kind: 'product_launch', productOrCampaign: 'High Protein Milk' });
    expect(c.evidence[0]).toMatchObject({ url: 'https://news.example.in/milky', source: 'gdelt', verification: 'unverified', kind: 'fact' });
    expect(quoteIsGrounded({ name: 'Invented Brand', evidence_quote: 'Invented Brand raised ₹100 crore from investors this week.' }, ARTICLE)).toBe(false);
  });

  it('reports an error (so nothing is cached) when the AI could not read any article', async () => {
    const source = createGdeltSource({ fetchImpl, sleepImpl: async () => {}, reader: reader(), extract: async () => null, search: null, news: null, cacheFn: noCache, ai: () => ({ provider: 'gemini' }) });
    const r = await source.collect({ profile: { niches: ['fitness'] } });
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/AI extraction failed/);
  });

  it('retries a busy GDELT patiently, then uses news search results instead', async () => {
    const extract = async () => ({ data: { brands: [{ name: 'Milky Mist', website: null, is_consumer_brand: true, signal_kind: 'product_launch', product_or_campaign: null, evidence_quote: 'Milky Mist Dairy Food Limited has introduced Milky Mist High Protein Milk in a 250 ml pack.', summary: 'Launch.' }] } });
    const sleeps = [];
    let calls = 0;
    const busy = async () => {
      calls++;
      return { ok: false, status: 429, text: async () => 'Please limit requests to one every 5 seconds' };
    };
    const news = async () => [{ title: 'Milky Mist launches High Protein Milk', link: 'https://news.example.in/milky', publishedAt: new Date('2026-10-17T00:00:00Z') }];
    const source = createGdeltSource({ fetchImpl: busy, sleepImpl: async (ms) => sleeps.push(ms), reader: reader(), extract, search: null, news, cacheFn: noCache, ai: () => ({ provider: 'mock' }) });
    const r = await source.collect({ profile: { niches: ['fitness'] }, now: new Date('2026-10-18T00:00:00Z') });
    expect(calls).toBe(4);
    expect(sleeps).toEqual(expect.arrayContaining([20_000, 30_000, 45_000]));
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/used news search instead/);
    expect(r.candidates[0].evidence[0]).toMatchObject({ url: 'https://news.example.in/milky', source: 'news' });

    const noNews = createGdeltSource({ fetchImpl: busy, sleepImpl: async () => {}, reader: reader(), extract, search: null, news: null, cacheFn: noCache, ai: () => ({ provider: 'mock' }) });
    const failed = await noNews.collect({ profile: { niches: ['fitness'] } });
    expect(failed.status).toBe('error');
    expect(failed.message).toMatch(/Could not reach GDELT: GDELT is busy \(too many requests\)/);
  });

  it('takes turns across niches and reads relative news dates', () => {
    const niches = ['beauty', 'skincare', 'fashion', 'lifestyle', 'home'];
    const seen = new Set();
    for (let w = 0; w < 3; w++) for (const n of rotateNiches(niches, 2, new Date(w * 12 * 3_600_000), 12)) seen.add(n);
    expect(seen.size).toBe(5);
    expect(rotateNiches(['a', 'b'], 3)).toEqual(['a', 'b']);
    expect(relativeDate('2 days ago', new Date('2026-10-18T00:00:00Z')).toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(relativeDate('Oct 3, 2026')).toBeNull();
  });

  it('is unavailable without an AI provider', async () => {
    const source = createGdeltSource({ ai: () => ({ provider: 'disabled' }) });
    expect((await source.collect({ profile: { niches: ['fitness'] } })).status).toBe('unavailable');
  });
});

describe('Serper creator-programme source', () => {
  it('keeps only brand pages that are themselves creator programmes', async () => {
    const search = async () => [
      { title: 'Top 10 influencer programs in India', link: 'https://blog.example.com/top-10' },
      { title: 'Myntra Creator', link: 'https://www.myntra.com/creator' },
      { title: 'PeakPulse Influencer Program', link: 'https://peakpulse.in/pages/influencer-program' },
      { title: 'Grow with us', link: 'https://influenceragency.in/creators' },
      { title: 'Vital Proteins Influencer Program', link: 'https://netinfluencer.com/vital-proteins-influencer-program/' },
      { title: 'Health brands', link: 'https://afluencer.com/blog/health-brands-influencer-programs' },
      { title: 'About PeakPulse', link: 'https://peakpulse.in/about' },
      { title: 'Creator Program | CollabHub', link: 'https://collabhub.io/creators' },
    ];
    const reader = fakeReader({
      'peakpulse.in/pages/influencer-program': html({ title: 'Influencer Program | PeakPulse', siteName: 'PeakPulse', description: 'Join the PeakPulse creator squad.' }),
      'influenceragency.in/creators': html({ title: 'Creator Program | We are an influencer marketing agency', description: 'An agency connecting brands with creators.' }),
      'netinfluencer.com/vital-proteins-influencer-program/': html({ title: 'Vital Proteins Influencer Program: Everything You Need To Know' }),
      'afluencer.com/blog/health-brands-influencer-programs': html({ title: '52 Health Brands with Influencer Programs' }),
      // A platform whose programme page looks like a brand's; only its homepage says what it is.
      'collabhub.io/creators': html({ title: 'Creator Program | CollabHub', description: 'Get paid for your content.' }),
      'collabhub.io': html({ title: 'Free Influencer Marketing Platform | CollabHub', description: 'CollabHub connects your brand with creators.' }),
    });
    const source = createSerperSource({ search, reader, cacheFn: noCache });
    const r = await source.collect({ profile: { niches: ['fitness'] }, now: new Date('2026-10-18T00:00:00Z') });
    expect(r.candidates).toHaveLength(1);
    const [c] = r.candidates;
    expect(c.brand).toMatchObject({ name: 'PeakPulse', domain: 'peakpulse.in', creatorProgramme: { url: 'https://peakpulse.in/pages/influencer-program' } });
    expect(c.signal.kind).toBe('creator_program');
    expect(c.evidence[0]).toMatchObject({ source: 'brand_website', verification: 'verified', excerpt: 'Join the PeakPulse creator squad.' });
  });

  it('recognises a page about another brand\'s programme', () => {
    expect(programmeOfAnotherBrand('Vital Proteins Influencer Program: Everything You Need To Know', 'netinfluencer.com')).toBe(true);
    expect(programmeOfAnotherBrand('Swolverine Influencer Program', 'swolverine.com')).toBe(false);
    expect(programmeOfAnotherBrand('Join Our Creator Programme', 'brand.in')).toBe(false);
  });

  it('names a brand from the page when there is no site name', () => {
    expect(brandNameFrom({ title: 'Collaborate | Milky Mist' }, 'milkymist.com')).toBe('Milky Mist');
    expect(brandNameFrom({ title: 'Creators' }, 'huemn.com')).toBe('Huemn');
  });

  it('is unavailable without an API key', async () => {
    expect((await createSerperSource({ config: () => ({}) }).collect({ profile: { niches: ['fitness'] } })).status).toBe('unavailable');
  });
});

describe('Instagram paid-partnership source', () => {
  const POSTS = [
    { url: 'https://www.instagram.com/p/A1/', ownerUsername: 'creator_one', paidPartnership: true, sponsors: [{ username: 'peakpulse.in' }], mentions: ['friend'], caption: 'Leg day', timestamp: '2026-10-10T10:00:00Z', inputUrl: 'https://www.instagram.com/explore/tags/fitnessindia/' },
    { url: 'https://www.instagram.com/p/A2/', ownerUsername: 'creator_two', isSponsored: true, taggedUsers: ['PeakPulse.in'], caption: '', timestamp: '2026-10-11T10:00:00Z', inputUrl: 'https://www.instagram.com/explore/tags/fitindia/' },
    { url: 'https://www.instagram.com/p/A3/', ownerUsername: 'creator_three', mentions: ['stridelab'], caption: 'Love these shoes #collab', timestamp: '2026-10-12T10:00:00Z' },
    { url: 'https://www.instagram.com/p/A4/', ownerUsername: 'creator_four', mentions: ['randomfriend'], caption: 'Sunday run' },
    { url: 'https://www.instagram.com/p/A6/', ownerUsername: 'creator_six', taggedUsers: [{ username: 'fuelup.in', full_name: 'FuelUp' }], caption: 'Use my code PRIYA10 for 10% off' },
    { url: 'https://www.instagram.com/p/A5/', ownerUsername: 'selfpromo', paidPartnership: true, sponsors: ['selfpromo'] },
  ];

  it('counts paid partnerships and disclosed collaborations (incl. discount codes) per brand, never the post owner', () => {
    const m = brandMentions(POSTS);
    const signalled = m.filter((x) => x.paid || x.disclosed);
    expect(signalled.map((x) => x.handle)).toEqual(['peakpulse.in', 'stridelab', 'fuelup.in']);
    expect(signalled[0]).toMatchObject({ paid: 2, disclosed: 0 });
    expect(signalled[0].posts.map((p) => p.hashtag)).toEqual(['fitnessindia', 'fitindia']);
    expect(m.find((x) => x.handle === 'randomfriend')).toBeUndefined(); // undisclosed mention
    expect(m.find((x) => x.handle === 'selfpromo')).toBeUndefined(); // an account tagging itself as sponsor is ignored
    // Authors of undisclosed posts are kept only as "own posts", checked later against their profile.
    expect(m.find((x) => x.handle === 'creator_four')).toMatchObject({ owned: 1, paid: 0, disclosed: 0 });
  });

  it('accepts only brand-like profiles with a real website', () => {
    expect(profileToBrand({ username: 'peakpulse.in', fullName: 'PeakPulse', isBusinessAccount: true, businessCategoryName: 'Health/beauty', externalUrl: 'https://peakpulse.in' })).toMatchObject({ website: 'https://peakpulse.in' });
    expect(profileToBrand({ username: 'creator', isBusinessAccount: true, businessCategoryName: 'Digital creator', externalUrl: 'https://creator.in' })).toBeNull();
    expect(profileToBrand({ username: 'gym', isBusinessAccount: true, businessCategoryName: 'Gym/Physical fitness center', externalUrl: 'https://gym.in' })).toBeNull();
    expect(profileToBrand({ username: 'x', rejected: true })).toBeNull();
    expect(profileToBrand({ username: 'myntra', fullName: 'MYNTRA', isBusinessAccount: true, externalUrl: 'https://myntra.onelink.me/eWcy/1', externalUrls: [{ url: 'https://myntra.onelink.me/eWcy/1' }, { url: 'https://www.myntra.com/bestseller' }] }).website).toBe('https://www.myntra.com/bestseller');
    expect(profileToBrand({ username: 'sw', fullName: 'Self Will Fitness & MMA club', isBusinessAccount: true, externalUrl: 'https://selfwill.in' })).toBeNull();
    expect(profileToBrand({ username: 'b', isBusinessAccount: true, externalUrl: 'https://linktr.ee/b', externalUrls: [{ url: 'https://b-brand.in' }] }).website).toBe('https://b-brand.in');
    expect(profileToBrand({ username: 'c', fullName: 'C Brand', isBusinessAccount: true, externalUrl: 'https://linktr.ee/c' }).website).toBeNull(); // looked up later
  });

  it('picks hashtags across niches', () => {
    expect(hashtagsFor(['fitness', 'food'])).toEqual(['fitnessindia', 'indianfoodblogger', 'indianfitness']);
  });

  it('turns posts into brand candidates with capped Apify runs and no creator usernames', async () => {
    const runs = [];
    const run = async (actor, input, opts) => {
      runs.push({ actor, input, opts });
      if (actor === 'apify/instagram-scraper') return POSTS;
      return [
        { username: 'peakpulse.in', fullName: 'PeakPulse Nutrition', isBusinessAccount: true, businessCategoryName: 'Health/beauty', externalUrl: 'https://peakpulse.in', followersCount: 1 },
        { username: 'stridelab', fullName: 'Stride Lab', isBusinessAccount: true, externalUrl: 'https://stridelab.in' },
      ];
    };
    const reader = fakeReader({ 'peakpulse.in': html({ title: 'PeakPulse Nutrition' }), 'stridelab.in': html({ title: 'Stride Lab' }) });
    const source = createInstagramSource({ run, reader, search: null, cacheFn: noCache, profileCache: { get: async () => null, set: async () => {} }, findKnownBrands: async () => [] });
    const r = await source.collect({ profile: { niches: ['fitness'] }, now: new Date('2026-10-18T00:00:00Z') });
    expect(r.status).toBe('ok');
    expect(r.candidates.map((c) => c.brand.domain)).toEqual(['peakpulse.in', 'stridelab.in']); // others have no brand profile
    const [paid, disclosed] = r.candidates;
    expect(paid.signal.kind).toBe('paid_creator_partnerships');
    expect(paid.brand.instagramHandle).toBe('peakpulse.in');
    expect(disclosed.signal.kind).toBe('similar_collaborations');
    expect(JSON.stringify(r.candidates)).not.toMatch(/creator_one|creator_two|creator_three|creator_six/);
    expect(runs[0].input.directUrls).toEqual(['https://www.instagram.com/explore/tags/fitnessindia/', 'https://www.instagram.com/explore/tags/indianfitness/', 'https://www.instagram.com/explore/tags/fitindia/']);
    expect(runs[0].opts.maxItems).toBe(120);
    expect(runs[1].input.usernames.slice(0, 3)).toEqual(['peakpulse.in', 'stridelab', 'fuelup.in']);
  });

  it('scans the creators the user listed, never treating them as brands or naming them', async () => {
    const creatorPosts = [
      { url: 'https://www.instagram.com/p/C1/', ownerUsername: 'fitpriya', paidPartnership: true, taggedUsers: [{ username: 'peakpulse.in' }, { username: 'fitrahul' }], caption: 'Morning fuel' },
      { url: 'https://www.instagram.com/p/C2/', ownerUsername: 'fitrahul', paidPartnership: false, mentions: ['fitpriya'], caption: 'Workout with @fitpriya' },
      { url: 'https://www.instagram.com/p/C3/', ownerUsername: 'fitrahul', paidPartnership: false, mentions: ['fuelup.in'], caption: 'Use my code RAHUL10' },
      { url: 'https://www.instagram.com/p/C4/', ownerUsername: 'fitpriya', paidPartnership: false, mentions: ['stridelab', 'mua_someone'], caption: 'Trail day in @stridelab shoes, makeup by @mua_someone' },
      { url: 'https://www.instagram.com/p/C5/', ownerUsername: 'fitpriya', paidPartnership: false, coauthorProducers: [{ username: 'glowbrand' }], caption: 'Brand ambassador duties for @glowbrand' },
    ];
    const runs = [];
    const run = async (actor, input, opts) => {
      runs.push({ actor, input, opts });
      if (actor === 'apify/instagram-scraper') return creatorPosts;
      return [
        { username: 'peakpulse.in', fullName: 'PeakPulse Nutrition', isBusinessAccount: true, externalUrl: 'https://peakpulse.in' },
        { username: 'fuelup.in', fullName: 'FuelUp', isBusinessAccount: true, externalUrl: 'https://fuelup.in' },
      ];
    };
    const reader = fakeReader({ 'peakpulse.in': html({ title: 'PeakPulse Nutrition' }), 'fuelup.in': html({ title: 'FuelUp' }) });
    const source = createInstagramSource({ run, reader, search: null, cacheFn: noCache, profileCache: { get: async () => null, set: async () => {} }, findKnownBrands: async () => [] });
    const r = await source.collect({ profile: { niches: ['fitness'] }, config: { sourceConfiguration: { instagramCreators: ['fitpriya', 'fitrahul'] } }, now: new Date('2026-10-18T00:00:00Z') });
    expect(runs[0].input).toMatchObject({ directUrls: ['https://www.instagram.com/fitpriya/', 'https://www.instagram.com/fitrahul/'], resultsLimit: 15, onlyPostsNewerThan: '60 days' });
    // Listed creators are never looked up as brands; paid first, then disclosed (incl. "ambassador"), then featured.
    expect(runs[1].input.usernames).toEqual(['peakpulse.in', 'fuelup.in', 'glowbrand', 'stridelab', 'mua_someone']);
    expect(r.candidates.map((c) => [c.brand.domain, c.signal.kind])).toEqual([['peakpulse.in', 'paid_creator_partnerships'], ['fuelup.in', 'similar_collaborations']]);
    expect(r.candidates[0].signal.title).toMatch(/by creators similar to you/);
    expect(JSON.stringify(r.candidates)).not.toMatch(/fitpriya|fitrahul/);
    expect(r.message).toBeUndefined();
  });

  it('is unavailable without an Apify token', async () => {
    expect((await createInstagramSource({ config: () => ({}) }).collect({ profile: { niches: ['fitness'] } })).status).toBe('unavailable');
  });
});
