import { NICHE_TO_CATEGORIES, SIGNAL_KINDS } from '../discovery/taxonomy.js';
import { normalizeBrandName } from '../../lib/domain.js';

// Transparent, configurable opportunity scoring. The score is a
// prioritisation aid built from explicit factors — not an LLM judgement and
// not a prediction that a sponsorship will happen.

export const SCORING_VERSION = 'v1';

export const DEFAULT_WEIGHTS = {
  nicheMax: 30,
  preferredCategory: 10,
  preferredBrand: 8,
  intent: { high_intent: 20, medium_intent: 12, low_intent: 4 },
  timing: [
    { maxDays: 14, points: 15, label: 'Very recent signal' },
    { maxDays: 45, points: 10, label: 'Recent signal' },
    { maxDays: 120, points: 5, label: 'Signal from the last 4 months' },
  ],
  stalePenaltyDays: 180,
  stalePenalty: -8,
  marketFit: 7,
  marketMismatch: -6,
  contactMax: 10,
  noContact: -5,
  verifiedEvidence: 5,
  unverifiedEvidence: -3,
  barterConflict: -15,
  priorWon: 5,
  priorLost: -5,
  priorMinSamples: 3,
};

const daysBetween = (a, b) => Math.abs(a.getTime() - b.getTime()) / 86_400_000;
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const lower = (arr) => (arr || []).map((s) => String(s).toLowerCase());

/**
 * @param {object} p
 * @param {object} p.profile        creator profile (lean)
 * @param {object} p.brand          { name, categories, markets, normalizedDomain }
 * @param {object} p.signal         { kind, barterOnly }
 * @param {Array}  p.evidence       evidence items
 * @param {number} p.contactConfidence 0..1 best contact confidence
 * @param {object} [p.priorOutcomes] { won, lost } counts for the same category
 * @param {Date}   [p.now]
 */
export function scoreOpportunity({ profile, brand, signal, evidence = [], contactConfidence = 0, priorOutcomes, now = new Date(), weights = DEFAULT_WEIGHTS }) {
  const factors = [];
  const add = (key, label, impact, detail) => factors.push({ key, label, impact, detail });
  const brandCats = lower(brand.categories);
  const prefs = profile.brandPreferences || {};

  // Hard exclusions: prohibited categories and brands to avoid.
  const prohibited = brandCats.filter((c) => lower(prefs.prohibitedCategories).includes(c));
  const avoid = lower(prefs.avoidBrands).some((b) => b && normalizeBrandName(b) === normalizeBrandName(brand.name));
  if (prohibited.length || avoid) {
    const reason = avoid ? `${brand.name} is on your "brands to avoid" list` : `Category "${prohibited.join(', ')}" is on your prohibited list`;
    add('policy_exclusion', 'Excluded by your brand policy', -100, reason);
    return { excluded: true, exclusionReason: reason, fitScore: 0, timingScore: 0, overallScore: 0, factors, version: SCORING_VERSION };
  }

  // Niche relevance.
  const nicheCats = new Set((profile.niches || []).flatMap((n) => NICHE_TO_CATEGORIES[String(n).toLowerCase()] || []));
  const overlap = brandCats.filter((c) => nicheCats.has(c));
  const nichePts = brandCats.length ? Math.round(weights.nicheMax * Math.min(1, overlap.length / Math.min(2, brandCats.length))) : 0;
  if (nichePts > 0) add('niche', 'Matches your content niches', nichePts, `Brand categories ${overlap.join(', ')} fit your niches`);
  else add('niche', 'Weak niche match', -5, 'None of the brand categories map to your listed niches');

  if (brandCats.some((c) => lower(prefs.preferredCategories).includes(c))) {
    add('preferred_category', 'Preferred category', weights.preferredCategory, 'You listed this category as preferred');
  }
  if (lower(prefs.preferredBrands).some((b) => b && normalizeBrandName(b) === normalizeBrandName(brand.name))) {
    add('preferred_brand', 'On your preferred brands list', weights.preferredBrand, `${brand.name} is a brand you want to work with`);
  }

  // Market / geography / language.
  const markets = lower(brand.markets);
  const creatorCountry = String(profile.country || 'India').toLowerCase();
  if (markets.length) {
    if (markets.includes(creatorCountry) || markets.includes('global')) add('market', 'Active in your market', weights.marketFit, `Brand sells in ${brand.markets.join(', ')}`);
    else add('market', 'Different market', weights.marketMismatch, `Brand markets (${brand.markets.join(', ')}) do not include ${profile.country || 'India'}`);
  }

  // Barter policy.
  if (signal.barterOnly && profile.barterPolicy?.acceptance === 'never') {
    add('barter', 'Likely barter-only', weights.barterConflict, 'Evidence suggests product-only collaborations; you do not accept barter');
  }

  // Signal intent.
  const kind = SIGNAL_KINDS[signal.kind] || SIGNAL_KINDS.category_match;
  add('intent', kind.label, weights.intent[kind.intent], `Signal strength: ${kind.intent.replace('_', ' ')}`);

  // Timing from the freshest dated evidence.
  const dated = evidence.map((e) => e.publishedAt || e.retrievedAt).filter(Boolean).map((d) => new Date(d));
  let timingScore = 20;
  if (dated.length) {
    const age = Math.min(...dated.map((d) => daysBetween(now, d)));
    const tier = weights.timing.find((t) => age <= t.maxDays);
    if (tier) add('timing', tier.label, tier.points, `Most recent evidence is ${Math.round(age)} day(s) old`);
    if (age > weights.stalePenaltyDays) add('stale', 'Stale evidence', weights.stalePenalty, `Newest evidence is ${Math.round(age)} days old`);
    timingScore = clamp(Math.round(100 - age * 0.8));
  } else {
    add('timing', 'Undated evidence', 0, 'No publication date available');
  }

  // Contact confidence.
  if (contactConfidence > 0) add('contact', 'Business contact available', Math.round(weights.contactMax * contactConfidence), `Best contact confidence ${(contactConfidence * 100).toFixed(0)}%`);
  else add('contact', 'No verified contact yet', weights.noContact, 'Outreach needs a contact you can verify or add');

  // Evidence quality.
  const verifications = evidence.map((e) => e.verification);
  if (verifications.includes('verified')) add('evidence', 'Verified source', weights.verifiedEvidence, 'At least one official source');
  else if (verifications.length && verifications.every((v) => v === 'unverified')) add('evidence', 'Unverified sources only', weights.unverifiedEvidence, 'Secondary sources not yet verified');

  // Prior outcomes in the same category (only with enough samples).
  if (priorOutcomes) {
    const total = (priorOutcomes.won || 0) + (priorOutcomes.lost || 0);
    if (total >= weights.priorMinSamples) {
      const winRate = priorOutcomes.won / total;
      if (winRate >= 0.5) add('prior', 'Good past outcomes in this category', weights.priorWon, `${priorOutcomes.won}/${total} similar opportunities converted`);
      else if (winRate <= 0.2) add('prior', 'Weak past outcomes in this category', weights.priorLost, `${priorOutcomes.won}/${total} similar opportunities converted`);
    }
  }

  const fitKeys = new Set(['niche', 'preferred_category', 'preferred_brand', 'market', 'barter']);
  const fitRaw = factors.filter((f) => fitKeys.has(f.key)).reduce((s, f) => s + f.impact, 0);
  const fitMax = weights.nicheMax + weights.preferredCategory + weights.preferredBrand + weights.marketFit;
  const fitScore = clamp(Math.round((fitRaw / fitMax) * 100));
  const overallScore = clamp(factors.reduce((s, f) => s + f.impact, 0) + 10);

  factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  return { excluded: false, fitScore, timingScore, overallScore, factors, version: SCORING_VERSION };
}
