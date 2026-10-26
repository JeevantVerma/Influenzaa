import { safeFetch } from '../../lib/safeFetch.js';
import { pageMeta } from '../../lib/html.js';

// Finds business email addresses that a brand publishes on its own website
// (contact, press, partnerships pages). It never guesses addresses: every
// result was literally present on a page of the brand's domain, and that page
// is kept as the source. robots.txt is honoured (RFC 9309), only a handful of
// pages are fetched per site, and requests are spaced out.

// robots.txt groups addressed to us (our user-agent is "CreatorOS-Discovery/…").
const ROBOTS_AGENTS = new Set(['creatoros', 'creatoros-discovery']);
const MAX_PAGES = 8;
const PAGE_DELAY_MS = 1000;
// Store pages (Shopify and similar) are often 1-3 MB, and footers with emails come last.
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const DENIED_STATUSES = new Set([401, 403, 429]);
const CANDIDATE_PATHS = ['/contact', '/contact-us', '/pages/contact', '/pages/contact-us', '/collaborate', '/partnerships', '/influencers', '/press', '/media', '/about', '/about-us'];
const LINK_HINT = /contact|press|media|collab|partner|influenc|creator|affiliate|work-with-us|ambassador/i;

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'rediffmail.com', 'icloud.com', 'proton.me', 'protonmail.com', 'zoho.com', 'zohomail.in']);
const NOT_AN_EMAIL_TLD = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'css', 'js', 'ico']);
const PLACEHOLDER_DOMAINS = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|yoursite\.com|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com)$/i;
// Addresses that are never a sensible place to pitch a sponsorship.
const SKIP_LOCAL = /^(no-?reply|do-?not-?reply|careers?|jobs|hr|recruit|privacy|legal|dpo|grievance|compliance|abuse|security|postmaster|webmaster|admin|billing|accounts?|invoices?|finance)\b/i;

const ROLES = [
  { re: /partner|collab|influenc|creator|ambassador|affiliate|brand/i, roleCategory: 'creator_partnerships', role: 'Partnerships inbox', confidence: 0.85 },
  { re: /^(marketing|mktg|pr|press|media|comms|communications?)\b/i, roleCategory: 'brand_marketing', role: 'Marketing / press inbox', confidence: 0.75 },
  { re: /^(info|hello|hi|hey|contact|connect|team|enquir|inquir|business|sales|namaste)/i, roleCategory: 'general_partnerships', role: 'General inbox', confidence: 0.55 },
  { re: /^(support|care|help|customer|cs|orders?|returns?|refunds?|feedback)/i, roleCategory: 'unknown', role: 'Customer support inbox', confidence: 0.3 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- robots.txt -------------------------------------------------------------------------

/** Parses robots.txt into the rule list that applies to CreatorOS (its own group, else `*`). */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === 'allow' || key === 'disallow')) current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const own = groups.filter((g) => g.agents.some((a) => ROBOTS_AGENTS.has(a.replace(/\/.*$/, ''))));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function ruleMatches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path);
}

/** Longest matching rule wins; Allow wins a tie; an empty Disallow allows everything. */
export function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue;
    if (!ruleMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

// ---- extraction -------------------------------------------------------------------------

function sameSite(emailDomain, brandDomain) {
  return emailDomain === brandDomain || emailDomain.endsWith(`.${brandDomain}`) || brandDomain.endsWith(`.${emailDomain}`);
}

/** Classifies a published address; returns null for addresses we should not store. */
export function classifyEmail(email, brandDomain) {
  const [local, domain] = email.toLowerCase().split('@');
  if (!local || !domain) return null;
  const tld = domain.split('.').pop();
  if (NOT_AN_EMAIL_TLD.has(tld) || PLACEHOLDER_DOMAINS.test(domain) || SKIP_LOCAL.test(local)) return null;
  const free = FREE_MAIL.has(domain);
  if (!free && !sameSite(domain, brandDomain)) return null; // third-party addresses (agencies, platforms) are not the brand's own
  const role = ROLES.find((r) => r.re.test(local)) || { roleCategory: 'unknown', role: 'Email listed on website', confidence: 0.45 };
  return {
    businessEmail: `${local}@${domain}`,
    role: free ? `${role.role} (personal mail provider)` : role.role,
    roleCategory: role.roleCategory,
    confidence: free ? Math.min(role.confidence, 0.35) : role.confidence,
  };
}

/** All email addresses on a page: mailto links and visible text (not attributes such as srcset). */
export function extractEmails(html) {
  const decoded = String(html || '').replace(/&#0*64;|&#x0*40;|&commat;/gi, '@');
  const found = new Set();
  const add = (raw) => {
    const e = String(raw).trim().replace(/^mailto:/i, '').split('?')[0].replace(/[.,;:]+$/, '').toLowerCase();
    if (/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(e)) found.add(e);
  };
  for (const m of decoded.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try {
      add(decodeURIComponent(m[1]));
    } catch {
      add(m[1]);
    }
  }
  const text = decoded.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi)) add(m[0]);
  return [...found];
}

/** Same-site links on the homepage that look like contact, press or partnership pages. */
export function contactLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const out = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, label] = m;
    if (!LINK_HINT.test(href) && !LINK_HINT.test(label.replace(/<[^>]+>/g, ''))) continue;
    let url;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    url.hash = '';
    out.push(url.pathname + url.search);
  }
  return [...new Set(out)];
}

// ---- creator programmes -------------------------------------------------------------------

const PROGRAMME_RE = /\b(influencer|creator|ambassador|affiliate|brand partner)s?\s*(program|programme|community|club|collective|network|squad|partnership)s?\b|\bbecome an?\s+(affiliate|ambassador|creator|influencer)\b|\bcollab(orate|oration)?\s+with\s+us\b/i;
const CREATOR_WORDS = /\b(influencer|creator|content creator|ambassador|affiliate)s?\b/i;
const LISTICLE = /\b(top|best)\s+\d+|\blist of\b|\bhow to\b|\bguide\b/i;

/** A page is a creator programme when its title, heading or path says so (listicles excluded). */
export function detectProgramme({ url, title = '', h1 = '' }) {
  let path;
  try {
    path = new URL(url).pathname.replace(/[-_/]+/g, ' ');
  } catch {
    return null;
  }
  const hay = `${title} ${h1} ${path}`;
  const workWithUs = /\bwork\s+with\s+us\b/i.test(hay) && CREATOR_WORDS.test(hay);
  if (!PROGRAMME_RE.test(hay) && !workWithUs) return null;
  if (LISTICLE.test(title)) return null;
  return { url, title: (h1 || title || path).trim().slice(0, 200) };
}

const PROGRAMME_LINK = /influenc|creator|ambassador|affiliate|collab/i;

// ---- crawl ------------------------------------------------------------------------------

/**
 * Checks a brand's own website for published business emails.
 * @returns {{ status: 'found'|'none_found'|'blocked_by_robots'|'access_denied'|'unreachable', pagesChecked: string[], contacts: object[], programmes: object[], message?: string }}
 */
export async function findWebsiteContacts(domain, { fetchImpl = safeFetch, sleepImpl = sleep, maxPages = MAX_PAGES } = {}) {
  const brandDomain = domain.toLowerCase().replace(/^www\./, '');
  const origin = `https://${brandDomain}`;

  // RFC 9309: 4xx means no rules; an unreachable robots.txt means do not crawl.
  let rules = [];
  try {
    rules = parseRobots((await fetchImpl(`${origin}/robots.txt`, { timeoutMs: 8000, maxBytes: 512 * 1024 })).text);
  } catch (err) {
    if (!(err.status >= 400 && err.status < 500)) {
      return { status: 'unreachable', pagesChecked: [], contacts: [], programmes: [], message: `Could not read robots.txt: ${err.message}` };
    }
  }

  const queue = ['/'];
  const pagesChecked = [];
  const contacts = new Map();
  const programmes = [];
  const programmeLinks = new Set(); // linked from the homepage, so they really exist
  let blocked = 0;
  let fetched = 0;
  let succeeded = 0;

  while (queue.length && fetched < maxPages) {
    const path = queue.shift();
    if (pagesChecked.includes(path)) continue;
    if (!robotsAllows(rules, path)) {
      blocked++;
      continue;
    }
    if (fetched > 0) await sleepImpl(PAGE_DELAY_MS);
    fetched++;
    pagesChecked.push(path);
    let page;
    try {
      page = await fetchImpl(`${origin}${path}`, { timeoutMs: 8000, maxBytes: MAX_PAGE_BYTES });
    } catch (err) {
      // A site that refuses automated visitors on its homepage is left alone.
      if (path === '/' && DENIED_STATUSES.has(err.status)) {
        return { status: 'access_denied', pagesChecked, contacts: [], programmes: [], message: `The website refused automated access (HTTP ${err.status}).` };
      }
      if (path === '/') queue.push(...CANDIDATE_PATHS);
      continue;
    }
    succeeded++;
    if (page.contentType && !/html|text\/plain/i.test(page.contentType)) continue;
    const sourceUrl = page.url || `${origin}${path}`;
    const meta = pageMeta(page.text);
    const programme = detectProgramme({ url: sourceUrl, title: meta.title, h1: meta.h1 });
    if (programme && !programmes.some((p) => p.url === programme.url)) programmes.push(programme);
    for (const email of extractEmails(page.text)) {
      const c = classifyEmail(email, brandDomain);
      if (c && !contacts.has(c.businessEmail)) contacts.set(c.businessEmail, { ...c, sourceUrl });
    }
    if (path === '/') {
      // Programme-looking links first, so a creator programme page is not skipped by the early stop below.
      const links = contactLinks(page.text, sourceUrl);
      const ordered = [...links.filter((l) => PROGRAMME_LINK.test(l)), ...links.filter((l) => !PROGRAMME_LINK.test(l))].slice(0, 5);
      for (const l of ordered) if (PROGRAMME_LINK.test(l)) programmeLinks.add(l);
      queue.push(...ordered, ...CANDIDATE_PATHS);
    }
    // A dedicated partnerships address is the best possible result; stop early
    // unless a programme-looking page is still waiting to be read.
    const programmePending = [...programmeLinks].some((l) => !pagesChecked.includes(l));
    if (!programmePending && [...contacts.values()].some((c) => c.roleCategory === 'creator_partnerships' && c.confidence >= 0.8)) break;
  }

  const list = [...contacts.values()].sort((a, b) => b.confidence - a.confidence);
  if (list.length) return { status: 'found', pagesChecked, contacts: list, programmes };
  if (!pagesChecked.length && blocked) return { status: 'blocked_by_robots', pagesChecked, contacts: [], programmes, message: 'The site asks automated tools not to read its pages (robots.txt).' };
  if (fetched > 0 && succeeded === 0) return { status: 'unreachable', pagesChecked, contacts: [], programmes, message: 'The website could not be reached.' };
  return { status: 'none_found', pagesChecked, contacts: [], programmes };
}
