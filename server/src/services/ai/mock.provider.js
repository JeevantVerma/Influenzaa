import { findAmounts } from '../../lib/amounts.js';
import { classifyZod, extractZod, draftZod } from './schemas.js';
import { pitchTemplate, negotiationTemplate } from './templates.js';

// Deterministic, rule-based stand-in for an LLM. Only available in
// development/test (never in production) and every output is labelled
// provider "mock" so it is never mistaken for real model output.

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1, single: 1 };
const num = (s) => (WORD_NUM[s?.toLowerCase()] ?? Number(s)) || 1;

const DELIVERABLE_PATTERNS = [
  ['instagram_reel', /(\d+|one|two|three|four|five|a|an|single)?\s*(?:instagram\s*|ig\s*)?reels?\b/gi],
  ['instagram_story', /(\d+|one|two|three|four|five|a|an)?\s*(?:instagram\s*|ig\s*)?stor(?:y|ies)\b/gi],
  ['instagram_post', /(\d+|one|two|three|four|five|a|an)?\s*(?:instagram|ig|static|carousel)\s*posts?\b/gi],
  ['youtube_dedicated', /(\d+|one|two|a|an)?\s*dedicated\s*(?:youtube\s*)?videos?\b/gi],
  ['youtube_integration', /(\d+|one|two|three|a|an)?\s*(?:youtube\s*)?integrations?\b/gi],
  ['youtube_short', /(\d+|one|two|three|a|an)?\s*(?:youtube\s*)?shorts?\b/gi],
  ['linkedin_post', /(\d+|one|two|a|an)?\s*linkedin\s*posts?\b/gi],
  ['ugc_video', /(\d+|one|two|three|a|an)?\s*ugc\s*videos?\b/gi],
];

export function mockClassify({ text }) {
  const t = text.toLowerCase();
  const amounts = findAmounts(text);
  let intent = 'other';
  let confidence = 0.55;
  if (/unsubscribe|do not contact|don't contact|remove (me|us) from|stop (emailing|contacting)|not contact (me|us) again/.test(t)) [intent, confidence] = ['opt_out', 0.95];
  else if (/out of (the )?office|on leave|auto-?reply|away until|automatic reply/.test(t)) [intent, confidence] = ['out_of_office', 0.9];
  else if (/not interested|no budget|not a (good )?fit|pass on this|have to decline|won't be able to|unable to proceed|not moving forward/.test(t)) [intent, confidence] = ['decline', 0.85];
  else if (amounts.length || /\bbarter\b|we can offer|our budget|we'd like to offer|we would like to offer|proposal:/.test(t)) [intent, confidence] = ['offer', 0.8];
  else if (/rate card|media kit|your rates|your pricing|commercials|what (are|would be) your (charges|fees)|audience (data|insights|demographics)/.test(t)) [intent, confidence] = ['information_request', 0.8];
  else if (/interested|love to|sounds (great|good)|let'?s (discuss|connect|talk)|happy to explore|keen to/.test(t)) [intent, confidence] = ['positive_interest', 0.75];
  else if (t.includes('?')) [intent, confidence] = ['question', 0.6];
  return classifyZod.parse({
    intent,
    confidence,
    summary: `Rule-based classification (development mock): ${intent.replace(/_/g, ' ')}.`,
    mentions_compensation: amounts.length > 0,
  });
}

export function mockExtract({ text }) {
  const t = text.toLowerCase();
  const amounts = findAmounts(text);
  const barterCtx = /(worth|valued at|value of|retail|mrp)\s*(of\s*)?(₹|rs|inr)?\s*[\d,.]+/i.exec(text);
  const barterValue = barterCtx ? findAmounts(barterCtx[0])[0]?.value ?? null : null;
  const cashAmounts = amounts.filter((a) => a.value !== barterValue);
  const isBarter = /\bbarter\b|free products?|product(s)? (in exchange|as compensation)|hamper|complimentary/.test(t);
  const total = cashAmounts.length ? Math.max(...cashAmounts.map((a) => a.value)) : null;

  const deliverables = [];
  for (const [type, re] of DELIVERABLE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) deliverables.push({ type, quantity: Math.min(20, num(m[1])), description: null });
  }

  const usage = /(\d+)\s*(day|month|year)s?\s*(?:of\s*)?(?:usage|content usage|usage rights|rights)|usage rights?\s*(?:for\s*)?(\d+)\s*(day|month|year)s?/i.exec(text);
  let usageDays = null;
  if (usage) {
    const n = Number(usage[1] || usage[3]);
    const unit = (usage[2] || usage[4]).toLowerCase();
    usageDays = unit.startsWith('month') ? n * 30 : unit.startsWith('year') ? n * 365 : n;
  }
  const excl = /exclusiv\w*\s*(?:for|of|period of)?\s*(\d+)\s*(day|month)s?|(\d+)\s*(day|month)s?\s*(?:of\s*)?exclusiv/i.exec(text);
  let exclDays = null;
  if (excl) {
    const n = Number(excl[1] || excl[3]);
    exclDays = (excl[2] || excl[4]).toLowerCase().startsWith('month') ? n * 30 : n;
  }
  const net = /net\s*-?\s*(\d+)|within\s*(\d+)\s*days\s*of\s*(?:invoice|publishing|posting|go-?live)/i.exec(text);
  const adv = /(\d+)\s*%\s*(?:advance|upfront)/i.exec(text);
  const rev = /(\d+|one|two|three|four)\s*(?:rounds?\s*of\s*)?revisions?/i.exec(text);
  const kill = /(\d+)\s*%\s*kill fee/i.exec(text);
  const perpetual = /perpetuity|perpetual|forever|lifetime usage|full ownership|all rights/.test(t);
  const paidAds = /paid (ads|media|usage|social)|boost(ed|ing)? (the )?(post|content)|ad usage|dark post|branded content ads/.test(t);
  const whitelisting = /whitelist|allowlist|partnership ads|spark ads/.test(t);

  const missing = [];
  if (total === null && !isBarter) missing.push('compensation');
  if (!deliverables.length) missing.push('deliverables');
  if (usageDays === null && !perpetual) missing.push('usage rights');
  if (!net) missing.push('payment timeline');
  if (!rev) missing.push('revisions');
  if (!/deadline|by \d|go[- ]?live|publish(ed)? (on|by)|launch date/.test(t)) missing.push('deadline');
  if (!/exclusiv/.test(t)) missing.push('exclusivity');

  const paymentType = isBarter && total ? 'hybrid' : isBarter ? 'barter' : total ? 'paid' : null;
  return extractZod.parse({
    payment_type: paymentType,
    total_amount: total,
    currency: total !== null || barterValue !== null ? (/\$|usd/i.test(text) ? 'USD' : 'INR') : null,
    deliverables,
    barter_product: isBarter ? 'Products as described in the brand message' : null,
    barter_claimed_value: barterValue,
    revisions_included: rev ? num(rev[1]) : null,
    usage_rights_days: usageDays,
    usage_paid_ads: paidAds ? true : null,
    usage_whitelisting: whitelisting ? true : null,
    usage_perpetual: perpetual ? true : null,
    exclusivity_required: excl || /exclusiv/.test(t) ? true : null,
    exclusivity_days: exclDays,
    exclusivity_scope: null,
    payment_net_days: net ? Number(net[1] || net[2]) : null,
    advance_percent: adv ? Number(adv[1]) : null,
    content_due_date: null,
    publish_date: null,
    kill_fee_percent: kill ? Number(kill[1]) : null,
    other_conditions: [],
    missing_terms: missing,
    ambiguities: amounts.length > 2 ? ['Several amounts are mentioned; confirm which one is the total fee.'] : [],
    summary: `Rule-based extraction (development mock): ${paymentType ?? 'unclear'} offer${total ? ` of ${total}` : ''} for ${deliverables.length || 'unspecified'} deliverable type(s).`,
  });
}

export const mockProvider = {
  name: 'mock',
  model: 'rules-v1',
  async classify(input) {
    return { data: mockClassify(input), provider: 'mock', model: 'rules-v1' };
  },
  async extract(input) {
    return { data: mockExtract(input), provider: 'mock', model: 'rules-v1' };
  },
  async draftPitch(input) {
    return { data: draftZod.parse(pitchTemplate(input)), provider: 'mock', model: 'rules-v1' };
  },
  async draftNegotiation(input) {
    return { data: draftZod.parse(negotiationTemplate(input)), provider: 'mock', model: 'rules-v1' };
  },
};
