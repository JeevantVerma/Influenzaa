import { describe, it, expect } from 'vitest';
import { classifyEmail, contactLinks, extractEmails, findWebsiteContacts, parseRobots, robotsAllows } from '../../src/services/contacts/websiteContacts.js';

// A fake website: path → HTML, or a number for an HTTP error status.
function fakeSite(pages, { robots = 404 } = {}) {
  const requested = [];
  const fetchImpl = async (url) => {
    const { pathname, search } = new URL(url);
    const path = pathname + search;
    requested.push(path);
    const body = path === '/robots.txt' ? robots : pages[path];
    if (body === undefined || typeof body === 'number') {
      const status = typeof body === 'number' ? body : 404;
      throw Object.assign(new Error(`Upstream responded ${status}`), { status });
    }
    if (body instanceof Error) throw body;
    return { url, status: 200, contentType: 'text/html; charset=utf-8', text: body };
  };
  return { fetchImpl, requested, sleepImpl: async () => {} };
}

describe('extracting published emails', () => {
  it('finds mailto links, visible text and entity-encoded addresses', () => {
    const html = `
      <a href="mailto:Collabs@PeakPulse.in?subject=Hi">Work with us</a>
      <p>Press: press&#64;peakpulse.in</p>
      <footer>hello@peakpulse.in.</footer>`;
    expect(extractEmails(html).sort()).toEqual(['collabs@peakpulse.in', 'hello@peakpulse.in', 'press@peakpulse.in']);
  });

  it('ignores image names, attributes and scripts', () => {
    const html = `<img srcset="logo@2x.png 2x"><script>var x = "tracker@analytics.io"</script><p>no email here</p>`;
    expect(extractEmails(html)).toEqual([]);
  });

  it('keeps only same-site links that look like contact pages', () => {
    const html = `<a href="/pages/collaborate">Collaborate</a><a href="https://www.peakpulse.in/contact-us">Contact</a><a href="https://instagram.com/peakpulse">Partner with us</a><a href="/shop">Shop</a>`;
    expect(contactLinks(html, 'https://peakpulse.in/')).toEqual(['/pages/collaborate', '/contact-us']);
  });
});

describe('classifying addresses', () => {
  it('ranks a partnerships inbox on the brand domain highest', () => {
    expect(classifyEmail('collabs@peakpulse.in', 'peakpulse.in')).toMatchObject({ roleCategory: 'creator_partnerships', confidence: 0.85 });
    expect(classifyEmail('marketing@mail.peakpulse.in', 'peakpulse.in')).toMatchObject({ roleCategory: 'brand_marketing' });
    expect(classifyEmail('hello@peakpulse.in', 'peakpulse.in')).toMatchObject({ roleCategory: 'general_partnerships', confidence: 0.55 });
    expect(classifyEmail('care@peakpulse.in', 'peakpulse.in').confidence).toBe(0.3);
  });

  it('accepts a personal mail provider only at low confidence', () => {
    const c = classifyEmail('peakpulse.collabs@gmail.com', 'peakpulse.in');
    expect(c.confidence).toBeLessThanOrEqual(0.35);
    expect(c.role).toMatch(/personal mail provider/);
  });

  it('drops third-party, placeholder and non-pitchable addresses', () => {
    expect(classifyEmail('team@someagency.com', 'peakpulse.in')).toBeNull();
    expect(classifyEmail('you@example.com', 'peakpulse.in')).toBeNull();
    for (const local of ['noreply', 'careers', 'grievance', 'privacy', 'legal']) expect(classifyEmail(`${local}@peakpulse.in`, 'peakpulse.in')).toBeNull();
  });
});

describe('robots.txt', () => {
  it('applies the * group, longest match first, Allow winning ties', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /pages/\nAllow: /pages/contact\nDisallow: /*.pdf$');
    expect(robotsAllows(rules, '/pages/about')).toBe(false);
    expect(robotsAllows(rules, '/pages/contact')).toBe(true);
    expect(robotsAllows(rules, '/media/kit.pdf')).toBe(false);
    expect(robotsAllows(rules, '/contact')).toBe(true);
  });

  it('prefers a group addressed to CreatorOS over *', () => {
    const rules = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: CreatorOS\nDisallow: /');
    expect(robotsAllows(rules, '/contact')).toBe(false);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow:'), '/contact')).toBe(true);
  });
});

describe('checking a brand website', () => {
  it('follows contact links from the homepage and stops at a partnerships inbox', async () => {
    const site = fakeSite({
      '/': '<a href="/pages/collaborate">Collaborate with us</a><footer>care@peakpulse.in</footer>',
      '/pages/collaborate': '<p>Creators: <a href="mailto:collabs@peakpulse.in">collabs@peakpulse.in</a></p>',
    });
    const r = await findWebsiteContacts('peakpulse.in', site);
    expect(r.status).toBe('found');
    expect(r.contacts[0]).toMatchObject({ businessEmail: 'collabs@peakpulse.in', roleCategory: 'creator_partnerships', sourceUrl: 'https://peakpulse.in/pages/collaborate' });
    expect(r.contacts.map((c) => c.businessEmail)).toContain('care@peakpulse.in');
    expect(site.requested).toEqual(['/robots.txt', '/', '/pages/collaborate']); // stopped early
  });

  it('reads no pages when robots.txt disallows everything', async () => {
    const site = fakeSite({ '/': '<p>hello@peakpulse.in</p>' }, { robots: 'User-agent: *\nDisallow: /' });
    const r = await findWebsiteContacts('peakpulse.in', site);
    expect(r.status).toBe('blocked_by_robots');
    expect(site.requested).toEqual(['/robots.txt']);
  });

  it('does not crawl when robots.txt itself cannot be read (server error)', async () => {
    const site = fakeSite({ '/': '<p>hello@peakpulse.in</p>' }, { robots: 503 });
    const r = await findWebsiteContacts('peakpulse.in', site);
    expect(r.status).toBe('unreachable');
    expect(site.requested).toEqual(['/robots.txt']);
  });

  it('leaves a site alone when its homepage refuses automated access', async () => {
    const site = fakeSite({ '/': 403, '/contact': '<p>hello@peakpulse.in</p>' });
    const r = await findWebsiteContacts('peakpulse.in', site);
    expect(r.status).toBe('access_denied');
    expect(site.requested).toEqual(['/robots.txt', '/']);
  });

  it('reports none_found when pages load but publish no usable address', async () => {
    const site = fakeSite({ '/': '<p>Shop now</p>', '/contact': '<p>Write to agency@otheragency.com</p>' });
    const r = await findWebsiteContacts('peakpulse.in', site);
    expect(r.status).toBe('none_found');
    expect(r.contacts).toEqual([]);
  });

  it('reports unreachable when no page loads, and caps pages read', async () => {
    const site = fakeSite({});
    const r = await findWebsiteContacts('peakpulse.in', { ...site, maxPages: 4 });
    expect(r.status).toBe('unreachable');
    expect(r.pagesChecked).toHaveLength(4);
  });
});
