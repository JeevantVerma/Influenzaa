import { DEMO_BRANDS } from './demoData.js';

const DAY = 86_400_000;

/**
 * Deterministic demo research source. Output depends only on the dataset,
 * the time discovery was first started and the current time — so tests are
 * reproducible and repeated runs exercise deduplication.
 */
export const demoSource = {
  id: 'demo',
  label: 'Demo research dataset (fictional brands)',
  isDemo: true,
  async collect({ config, now = new Date() }) {
    const origin = config.startedAt ? new Date(config.startedAt) : now;
    const hoursSinceStart = (now.getTime() - origin.getTime()) / 3_600_000;
    const candidates = [];
    for (const b of DEMO_BRANDS) {
      for (const s of b.signals) {
        if (s.releaseAfterHours > hoursSinceStart) continue;
        const published = new Date(origin.getTime() + s.releaseAfterHours * 3_600_000 - s.daysAgo * DAY);
        const slug = (s.product || 'brand-overview').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        candidates.push({
          brand: {
            name: b.name,
            domain: b.domain,
            industry: b.industry,
            categories: b.categories,
            markets: b.markets,
            description: b.description,
            website: `https://${b.domain}`,
            isDemo: true,
          },
          signal: { kind: s.kind, productOrCampaign: s.product, title: s.title, barterOnly: !!s.barterOnly },
          evidence: [
            {
              url: `https://${b.domain}/newsroom/${slug}`,
              title: s.title,
              excerpt: s.excerpt,
              publishedAt: published,
              retrievedAt: now,
              source: 'demo',
              verification: 'demo',
              kind: 'fact',
            },
          ],
          contacts: b.contacts.map((c) => ({
            name: c.name,
            role: c.role,
            roleCategory: c.roleCategory,
            businessEmail: c.email,
            sourceUrl: `https://${b.domain}/contact`,
            source: 'demo',
            verificationStatus: 'demo',
            confidence: c.confidence,
            isDemo: true,
          })),
        });
      }
    }
    return { status: 'ok', candidates };
  },
};
