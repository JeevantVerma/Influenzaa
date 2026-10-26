import { getConfig } from '../../../config/env.js';
import { normalizeDomain } from '../../../lib/domain.js';
import { BrandProfile } from '../../../models/index.js';
import { NICHE_HASHTAGS, NICHE_TO_CATEGORIES } from '../taxonomy.js';
import { cached, bucket, getCached, setCached } from '../cache.js';
import { createPageReader, domainMatchesName, isNonBrandDomain } from '../web.js';
import { serperSearch } from '../serper.js';
import { resolveBrand } from '../brandResolver.js';
import { runActor } from '../apify.js';

// Brands paying creators in the creator's niche, from recent Instagram posts
// under niche hashtags (scraped by Apify). A post labelled "Paid partnership"
// names its sponsor; a post disclosing #ad / #collab names the brand in its
// mentions. Each brand's Instagram profile gives its website, which is then
// confirmed by visiting it. Creators' usernames are never stored: evidence is
// only the post link and the brand handle.

const POSTS_ACTOR = 'apify/instagram-scraper';
const PROFILE_ACTOR = 'apify/instagram-profile-scraper';
const MAX_HASHTAGS = 3;
const POSTS_PER_HASHTAG = 40;
const MAX_CREATORS = 10;
const POSTS_PER_CREATOR = 15;
const MAX_PROFILE_LOOKUPS = 15;
const CACHE_HOURS = 24;
const DAY = 86_400_000;

// Disclosed collaborations, and the discount codes that come with paid or affiliate deals in India.
const DISCLOSURE = /#(ad|ads|sponsored|paidpartnership|paidpartner|collab|collaboration|partner|partnership|brandpartner|gifted|ambassador|brandambassador|affiliate)\b|\bpaid partnership\b|\b(use|apply)\s+(my\s+)?(code|coupon)\b|\b(discount|promo|coupon)\s+code\b|\b(brand\s+)?ambassador\b|\bpartnered with\b|\bin (collaboration|partnership) with\b|\bsponsored by\b|\bgifted by\b|\bpr package\b/i;
// Profile categories that are people, local businesses or media rather than sponsoring brands.
const NOT_A_SPONSOR = /creator|blogger|influencer|public figure|artist|athlete|musician|personal|gamer|actor|actress|model|writer|photographer|coach|trainer|chef|journalist|comedian|dancer|politician|doctor|gym|fitness (center|centre)|physical fitness|yoga studio|clinic|hospital|school|college|university|academy|event|community|media|news|magazine|publisher/i;

// Local businesses recognisable from the account name when no category is set.
const LOCAL_BUSINESS_NAME = /\b(gym|fitness club|mma|martial arts|crossfit|yoga studio|dojo|salon|clinic|academy)\b/i;

const handleOf = (u) => String((typeof u === 'string' ? u : u?.username || u?.user?.username) || '').replace(/^@/, '').toLowerCase().trim();

/** Picks hashtags across the creator's niches: the first of each niche, then the second, … */
export function hashtagsFor(niches = []) {
  const lists = niches.map((n) => NICHE_HASHTAGS[n] || []).filter((l) => l.length);
  const out = [];
  for (let i = 0; out.length < MAX_HASHTAGS && lists.some((l) => l[i]); i++) {
    for (const l of lists) if (l[i] && out.length < MAX_HASHTAGS && !out.includes(l[i])) out.push(l[i]);
  }
  return out;
}

/**
 * Counts, per Instagram handle: paid-partnership posts naming it, disclosed
 * collaborations (#ad, discount codes) mentioning it, and (in hashtag mode) its
 * own posts. Handles in `exclude` (the creators being scanned) are never
 * counted as brands. Strongest signals sort first.
 */
export function brandMentions(posts, { countOwners = true, countFeatured = false, exclude = [] } = {}) {
  const excluded = new Set(exclude);
  const byHandle = new Map();
  for (const post of posts) {
    const owner = handleOf(post.ownerUsername);
    const sponsors = (post.sponsors || []).map(handleOf).filter(Boolean);
    const paid = post.paidPartnership === true || post.isSponsored === true || sponsors.length > 0;
    const named = [...(post.mentions || []), ...(post.taggedUsers || []), ...(post.coauthorProducers || [])].map(handleOf).filter(Boolean);
    let handles = [];
    let kind = null;
    if (paid) [handles, kind] = [sponsors.length ? sponsors : named, 'paid'];
    else if (DISCLOSURE.test(post.caption || '')) [handles, kind] = [named, 'disclosed'];
    // Similar creators featuring a brand (outfit credits, product tags) is a weaker lead.
    else if (countFeatured && named.length) [handles, kind] = [named, 'featured'];
    const hashtag = /\/explore\/tags\/([^/?#]+)/.exec(post.inputUrl || '')?.[1] || null;
    const ref = { url: post.url, timestamp: post.timestamp ? new Date(post.timestamp) : null, hashtag, paid };
    const entry = (h) => byHandle.get(h) || byHandle.set(h, { handle: h, paid: 0, disclosed: 0, featured: 0, owned: 0, posts: [], ownPosts: [] }).get(h);
    for (const h of new Set(handles)) {
      if (!h || h === owner || excluded.has(h)) continue;
      const m = entry(h);
      m[kind]++;
      if (post.url && m.posts.length < 5) m.posts.push({ ...ref, kind });
    }
    // The post's own author may be a brand posting in this niche (checked later from its profile).
    if (countOwners && owner && !handles.length && !excluded.has(owner)) {
      const m = entry(owner);
      m.owned++;
      if (post.url && m.ownPosts.length < 3) m.ownPosts.push(ref);
    }
  }
  return [...byHandle.values()].sort((a, b) => b.paid - a.paid || b.disclosed - a.disclosed || b.featured - a.featured || b.owned - a.owned);
}

/**
 * A brand-like Instagram profile, or null for people and local businesses.
 * `website` is the first bio link that can be the brand's own site; it is null
 * when the bio only has link-in-bio or app links (the site is then looked up).
 */
export function profileToBrand(profile) {
  if (!profile) return null;
  if (profile.isBusinessAccount === false) return null;
  if (profile.rejected || NOT_A_SPONSOR.test(profile.businessCategoryName || '') || LOCAL_BUSINESS_NAME.test(profile.fullName || '')) return null;
  const urls = [profile.externalUrl, ...(profile.externalUrls || []).map((u) => u?.url)].filter(Boolean);
  // A marketplace's own account (e.g. @myntra → myntra.com) is a sponsor too; only
  // other brands' links to marketplaces or link-in-bio pages are skipped.
  const website = urls.find((u) => {
    const d = normalizeDomain(u);
    return d && (!isNonBrandDomain(d) || domainMatchesName(d, profile.fullName || profile.username || ''));
  });
  return { name: profile.fullName || profile.username, handle: handleOf(profile.username), website: website || null, bio: profile.biography || null };
}

export function createInstagramSource({ run = runActor, reader: readerArg, search: searchArg, cacheFn = cached, profileCache = { get: getCached, set: setCached }, findKnownBrands, config = () => getConfig().discovery } = {}) {
  const knownBrands = findKnownBrands || ((handles) => BrandProfile.find({ instagramHandle: { $in: handles } }, { name: 1, instagramHandle: 1, officialWebsite: 1, normalizedDomain: 1 }).lean());

  async function profilesFor(handles, opts) {
    const out = new Map();
    const missing = [];
    for (const h of handles) {
      const hit = await profileCache.get(`ig-profile:${h}`);
      if (hit) out.set(h, hit.value);
      else missing.push(h);
    }
    if (missing.length) {
      const profiles = await run(PROFILE_ACTOR, { usernames: missing }, { ...opts, maxItems: missing.length });
      for (const p of profiles) {
        const h = handleOf(p.username);
        if (!h) continue;
        // Keep only what we use. Profiles that are not brands (usually creators) are
        // cached as a bare "rejected" marker so no personal data is stored.
        const full = { username: h, fullName: p.fullName || null, biography: p.biography || null, externalUrl: p.externalUrl || null, externalUrls: (p.externalUrls || []).map((u) => ({ url: u?.url })), isBusinessAccount: p.isBusinessAccount ?? null, businessCategoryName: p.businessCategoryName || null };
        const slim = profileToBrand(full) ? full : { username: h, rejected: true };
        out.set(h, slim);
        await profileCache.set(`ig-profile:${h}`, slim, 30 * DAY);
      }
    }
    return out;
  }

  /**
   * mode "creators": recent posts of creators the user listed as similar to them.
   * mode "hashtags": recent posts under niche hashtags (fallback when none are listed).
   */
  async function discover({ mode, targets, niches, now, opts }) {
    const reader = readerArg || createPageReader();
    const search = searchArg !== undefined ? searchArg : opts.serperApiKey ? (q) => serperSearch(q, { apiKey: opts.serperApiKey }) : null;
    const byCreators = mode === 'creators';
    const perTarget = byCreators ? POSTS_PER_CREATOR : POSTS_PER_HASHTAG;
    const posts = await run(
      POSTS_ACTOR,
      {
        directUrls: targets.map((t) => (byCreators ? `https://www.instagram.com/${t}/` : `https://www.instagram.com/explore/tags/${t}/`)),
        resultsType: 'posts',
        resultsLimit: perTarget,
        onlyPostsNewerThan: byCreators ? '60 days' : '30 days',
        addParentData: false,
      },
      { ...opts, maxItems: targets.length * perTarget },
    );
    const mentions = brandMentions(posts, byCreators ? { countOwners: false, countFeatured: true, exclude: targets } : {}).slice(0, MAX_PROFILE_LOOKUPS);
    const window = byCreators ? 'last 60 days' : 'last 30 days';
    if (!mentions.length) return [];
    const handles = mentions.map((m) => m.handle);
    const known = new Map((await knownBrands(handles)).map((b) => [b.instagramHandle, b]));
    const profiles = await profilesFor(handles.filter((h) => !known.has(h)), opts);
    const categories = (NICHE_TO_CATEGORIES[niches[0]] || []).slice(0, 1);
    const candidates = [];
    for (const m of mentions) {
      const k = known.get(m.handle);
      const info = k ? { name: k.name, handle: m.handle, website: k.officialWebsite || `https://${k.normalizedDomain}` } : profileToBrand(profiles.get(m.handle));
      if (!info) continue;
      // The link comes from the brand's own business profile, so a match on its first word is enough ("Adobe Video" → adobe.com).
      // Without a usable bio link the site is looked up (web search if configured, else verified obvious domains).
      const resolved = await resolveBrand({ name: info.name, websiteHint: info.website, reader, search, cacheFn, trustHint: true });
      if (!resolved) continue;
      const ownOnly = !m.paid && !m.disclosed && !m.featured;
      const refs = ownOnly ? m.ownPosts : m.posts;
      const tags = [...new Set(refs.map((p) => p.hashtag).filter(Boolean))].map((t) => `#${t}`).join(', ') || 'your niche hashtags';
      const where = byCreators ? 'by creators similar to you' : `with creators in ${tags}`;
      candidates.push({
        brand: { name: info.name, domain: resolved.domain, website: resolved.website, description: resolved.description || undefined, instagramHandle: m.handle, categories, markets: ['India'], isDemo: false },
        signal: m.paid
          ? { kind: 'paid_creator_partnerships', productOrCampaign: null, title: `${m.paid} paid partnership post(s) ${where} (${window})` }
          : m.disclosed
            ? { kind: 'similar_collaborations', productOrCampaign: null, title: `${m.disclosed} post(s) ${where} disclosing a collaboration or discount code (${window})` }
            : m.featured
              ? { kind: 'similar_collaborations', productOrCampaign: null, title: `Featured in ${m.featured} post(s) ${where} (${window})` }
              : { kind: 'category_match', productOrCampaign: null, title: `Posts as a brand in ${tags} (${m.owned} in the ${window})` },
        evidence: refs.slice(0, 3).map((p) => ({
          url: p.url,
          title: ownOnly ? `Instagram post by @${m.handle}` : p.kind === 'paid' ? `Instagram post labelled "Paid partnership" with @${m.handle}` : p.kind === 'featured' ? `Instagram post featuring @${m.handle}` : `Instagram post disclosing a collaboration with @${m.handle}`,
          excerpt: ownOnly ? `The brand's own post${p.hashtag ? ` in #${p.hashtag}` : ''}.` : byCreators ? `A post by one of the creators you listed, featuring @${m.handle}.` : `A creator post${p.hashtag ? ` in #${p.hashtag}` : ''} featuring @${m.handle}.`,
          publishedAt: p.timestamp,
          retrievedAt: now,
          source: 'instagram',
          verification: 'unverified',
          kind: 'fact',
        })),
        contacts: [],
      });
    }
    return candidates;
  }

  return {
    id: 'instagram',
    label: 'Instagram paid partnerships of creators like you (via Apify)',
    isDemo: false,
    async collect({ profile, config: discoveryConfig, now = new Date() }) {
      const usingApify = run === runActor;
      const cfg = usingApify ? config() : {};
      if (usingApify && !cfg.apifyToken) return { status: 'unavailable', candidates: [], message: 'APIFY_TOKEN is not configured' };
      // Similar creators listed in Settings are the best signal; hashtags are the fallback.
      const creators = (discoveryConfig?.sourceConfiguration?.instagramCreators || []).slice(0, MAX_CREATORS);
      const mode = creators.length ? 'creators' : 'hashtags';
      const targets = creators.length ? creators : hashtagsFor(profile.niches || []);
      if (!targets.length) return { status: 'skipped', candidates: [], message: 'Add similar creators in Settings, or niches with Instagram hashtags' };
      const opts = { token: cfg.apifyToken, maxTotalChargeUsd: cfg.apifyMaxUsdPerRun, serperApiKey: cfg.serperApiKey };
      try {
        const key = `instagram:${mode}:${[...targets].sort().join(',')}:${bucket(now, CACHE_HOURS)}`;
        const { value } = await cacheFn(key, CACHE_HOURS * 3_600_000, () => discover({ mode, targets, niches: profile.niches || [], now, opts }));
        return { status: 'ok', candidates: value, message: mode === 'hashtags' ? 'Scanned niche hashtags; add similar creators in Settings for stronger leads' : undefined };
      } catch (err) {
        return { status: 'error', candidates: [], message: err.message };
      }
    },
  };
}

export const instagramSource = createInstagramSource();
