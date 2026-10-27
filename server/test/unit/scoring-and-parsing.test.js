import { describe, it, expect } from 'vitest';
import { scoreOpportunity } from '../../src/services/scoring/score.js';
import { findAmounts, unexpectedAmounts } from '../../src/lib/amounts.js';
import { mockExtract, mockClassify } from '../../src/services/ai/mock.provider.js';
import { toMinor, applyDiscount, formatMoney } from '../../src/lib/money.js';
import { normalizeDomain } from '../../src/lib/domain.js';
import { addBusinessDays } from '../../src/lib/businessDays.js';
import { isDisallowedAddress } from '../../src/lib/safeFetch.js';
import { buildConfig } from '../../src/config/env.js';
import { encryptSecret, decryptSecret } from '../../src/lib/crypto.js';
import { dedupeKeyFor } from '../../src/services/discovery/pipeline.js';

const profile = {
  country: 'India',
  niches: ['fitness'],
  brandPreferences: { preferredCategories: ['fitness'], prohibitedCategories: ['alcohol'], avoidBrands: ['Bad Brand'] },
  barterPolicy: { acceptance: 'never' },
};
const now = new Date('2026-10-01T00:00:00Z');

describe('scoreOpportunity', () => {
  it('excludes prohibited categories and avoided brands with a stated reason', () => {
    const a = scoreOpportunity({ profile, brand: { name: 'Barrel', categories: ['alcohol'] }, signal: { kind: 'campaign_brief' }, now });
    expect(a.excluded).toBe(true);
    expect(a.exclusionReason).toMatch(/prohibited/);
    const b = scoreOpportunity({ profile, brand: { name: 'Bad Brand Pvt Ltd', categories: ['fitness'] }, signal: { kind: 'campaign_brief' }, now });
    expect(b.excluded).toBe(true);
  });

  it('ranks high-intent, recent, well-matched, contactable brands above weak ones', () => {
    const strong = scoreOpportunity({ profile, brand: { name: 'A', categories: ['fitness'], markets: ['India'] }, signal: { kind: 'creator_program' }, evidence: [{ publishedAt: new Date('2026-09-25'), verification: 'verified' }], contactConfidence: 0.9, now });
    const weak = scoreOpportunity({ profile, brand: { name: 'B', categories: ['pets'], markets: ['USA'] }, signal: { kind: 'category_match' }, evidence: [{ publishedAt: new Date('2025-01-01'), verification: 'unverified' }], contactConfidence: 0, now });
    expect(strong.overallScore).toBeGreaterThan(weak.overallScore + 40);
    expect(strong.factors[0].impact).toBeGreaterThan(0);
    expect(weak.factors.some((f) => f.key === 'stale')).toBe(true);
    expect(weak.factors.some((f) => f.impact < 0)).toBe(true);
  });

  it('penalises barter-only signals when the creator never accepts barter', () => {
    const s = scoreOpportunity({ profile, brand: { name: 'C', categories: ['fitness'] }, signal: { kind: 'product_launch', barterOnly: true }, now });
    expect(s.factors.find((f) => f.key === 'barter').impact).toBeLessThan(0);
  });

  it('ignores prior outcomes with too few samples', () => {
    const s = scoreOpportunity({ profile, brand: { name: 'D', categories: ['fitness'] }, signal: { kind: 'product_launch' }, priorOutcomes: { won: 1, lost: 0 }, now });
    expect(s.factors.some((f) => f.key === 'prior')).toBe(false);
  });
});

describe('dedupe keys', () => {
  it('are stable for the same brand + campaign regardless of formatting', () => {
    expect(dedupeKeyFor('glowleaf.example', { productOrCampaign: 'Saffron Night  Serum!' })).toBe(dedupeKeyFor('glowleaf.example', { productOrCampaign: 'saffron night serum' }));
    expect(dedupeKeyFor('a.example', { productOrCampaign: 'X' })).not.toBe(dedupeKeyFor('b.example', { productOrCampaign: 'X' }));
  });
});

describe('amount parsing', () => {
  it('understands Indian notation', () => {
    expect(findAmounts('We can offer ₹1.5 lakh for 2 reels').map((a) => a.value)).toEqual([150000]);
    expect(findAmounts('Budget is Rs. 45,000 plus 25k for stories').map((a) => a.value)).toEqual([45000, 25000]);
    expect(findAmounts('INR 2 crore')[0].value).toBe(20_000_000);
  });
  it('does not treat audience figures as money', () => {
    expect(findAmounts('I have 150k followers')).toEqual([]);
  });
  it('detects unapproved figures in a draft', () => {
    expect(unexpectedAmounts('Our fee is ₹30,000 for the reel.', [30000])).toEqual([]);
    expect(unexpectedAmounts('Our fee is ₹30,000, or ₹25,000 if you prefer.', [30000]).map((a) => a.value)).toEqual([25000]);
  });
});

describe('mock AI provider (development only)', () => {
  it('extracts structured offer terms', () => {
    const x = mockExtract({ text: 'Hi! We would like to offer ₹45,000 for 2 Instagram reels and 3 stories. Usage rights for 6 months including paid ads. Payment net 60. 3 rounds of revisions. Exclusivity for 2 months.' });
    expect(x.total_amount).toBe(45000);
    expect(x.deliverables).toEqual(expect.arrayContaining([{ type: 'instagram_reel', quantity: 2, description: null }, { type: 'instagram_story', quantity: 3, description: null }]));
    expect(x.usage_rights_days).toBe(180);
    expect(x.usage_paid_ads).toBe(true);
    expect(x.payment_net_days).toBe(60);
    expect(x.revisions_included).toBe(3);
    expect(x.exclusivity_days).toBe(60);
  });
  it('classifies replies', () => {
    expect(mockClassify({ text: 'Please unsubscribe us from these emails' }).intent).toBe('opt_out');
    expect(mockClassify({ text: 'We are not interested at this time.' }).intent).toBe('decline');
    expect(mockClassify({ text: 'Could you share your rate card and media kit?' }).intent).toBe('information_request');
    expect(mockClassify({ text: 'Our budget is ₹20,000 for one reel.' }).intent).toBe('offer');
  });
});

describe('utilities', () => {
  it('handles money in integer minor units', () => {
    expect(toMinor('1,23,456.78')).toBe(12345678);
    expect(applyDiscount(3_000_000, 10)).toBe(2_700_000);
    expect(formatMoney(3_000_000, 'INR')).toMatch(/30,000/);
  });
  it('normalises domains', () => {
    expect(normalizeDomain('https://www.Glowleaf.example/path')).toBe('glowleaf.example');
    expect(normalizeDomain('not a domain')).toBeNull();
  });
  it('skips weekends for follow-ups', () => {
    const fri = new Date('2026-10-16T06:00:00Z'); // Friday
    expect(addBusinessDays(fri, 1).getUTCDay()).toBe(1); // Monday
  });
  it('blocks private network destinations (SSRF)', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) expect(isDisallowedAddress(ip)).toBe(true);
    expect(isDisallowedAddress('8.8.8.8')).toBe(false);
  });
});

describe('configuration safety', () => {
  const base = { MONGODB_URI: 'mongodb://x/y', AUTH_SECRET: 'a'.repeat(40) };
  it('never silently uses mock integrations in production', () => {
    expect(() => buildConfig({ ...base, NODE_ENV: 'production', AI_PROVIDER: 'mock', EMAIL_PROVIDER: 'disabled', DISCOVERY_SOURCES: 'rss' })).toThrow(/mock is not allowed/);
    expect(() => buildConfig({ ...base, NODE_ENV: 'production', EMAIL_PROVIDER: 'demo', DISCOVERY_SOURCES: 'rss' })).toThrow(/EMAIL_PROVIDER=demo/);
    const cfg = buildConfig({ ...base, NODE_ENV: 'production', EMAIL_PROVIDER: 'disabled', DISCOVERY_SOURCES: 'rss', ENCRYPTION_KEY: 'k'.repeat(40) });
    expect(cfg.ai.provider).toBe('disabled');
    expect(cfg.demo.enabled).toBe(false);
  });
  it('requires a strong auth secret', () => {
    expect(() => buildConfig({ MONGODB_URI: 'mongodb://x/y', AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });
  it('requires a separate token encryption key in production', () => {
    const prod = { ...base, NODE_ENV: 'production', EMAIL_PROVIDER: 'disabled', DISCOVERY_SOURCES: 'rss' };
    expect(() => buildConfig(prod)).toThrow(/ENCRYPTION_KEY is required/);
    expect(() => buildConfig({ ...prod, ENCRYPTION_KEY: base.AUTH_SECRET })).toThrow(/different from AUTH_SECRET/);
    expect(buildConfig({ ...base, ENCRYPTION_KEY: '' }).tokenKeys).toEqual([base.AUTH_SECRET]);
  });
});

describe('integration token encryption', () => {
  const authSecret = 'a'.repeat(40);
  const encryptionKey = 'k'.repeat(40);
  it('keeps tokens readable when AUTH_SECRET rotates, once ENCRYPTION_KEY is set', () => {
    const blob = encryptSecret('ig-token', encryptionKey);
    expect(decryptSecret(blob, [encryptionKey, 'rotated-auth-secret-'.repeat(3)])).toBe('ig-token');
  });
  it('still reads tokens saved under AUTH_SECRET before ENCRYPTION_KEY existed', () => {
    const old = encryptSecret('old-token', authSecret);
    expect(decryptSecret(old, [encryptionKey, authSecret])).toBe('old-token');
  });
  it('rejects tampered or unknown-key blobs', () => {
    const blob = encryptSecret('ig-token', encryptionKey);
    expect(() => decryptSecret(blob, ['x'.repeat(40)])).toThrow(/Unreadable/);
    expect(() => decryptSecret(`${blob.slice(0, -4)}AAAA`, encryptionKey)).toThrow(/Unreadable/);
  });
});
