import { applyDiscount, formatMoney, roundToNearest } from '../../lib/money.js';
import { DELIVERABLE_LABELS } from '../../models/shared.js';

// Deterministic deal-policy engine. Every hard commercial boundary is
// evaluated here with plain code; the AI layer never decides whether a
// limit is respected.

export const PREMIUMS = {
  paidAdsPercent: 30, // paid amplification of the creator's content
  whitelistingPercent: 20, // brand runs ads from the creator's handle
  extraUsagePer30DaysPercent: 10, // organic usage beyond the creator's default window
  extraUsageCapPercent: 50,
  exclusivityPer30DaysPercent: 15,
};

const BARTER_VALUE_FACTOR = 0.5; // claimed retail value is not cash; count half of it

const lbl = (t) => DELIVERABLE_LABELS[t] || t;

/** Prices the offered scope against the creator's rate card. */
export function priceScope(deliverables, policy) {
  const rates = new Map((policy.rates || []).map((r) => [r.deliverable, r]));
  const accepted = new Set(policy.acceptedDeliverables?.length ? policy.acceptedDeliverables : [...rates.keys()]);
  let preferred = 0;
  let floor = 0;
  const unpriced = [];
  const outOfScope = [];
  let count = 0;
  for (const d of deliverables || []) {
    const qty = d.quantity || 1;
    count += qty;
    if (!accepted.has(d.type)) outOfScope.push(d.type);
    const r = rates.get(d.type);
    if (!r) {
      unpriced.push(d.type);
      continue;
    }
    preferred += r.preferredMinor * qty;
    floor += r.minimumMinor * qty;
  }
  // Package discount is only offered on multi-deliverable packages and never
  // below the per-deliverable minimum rates.
  const discountPct = count >= 2 ? policy.maxPackageDiscountPercent || 0 : 0;
  const authorizedFloor = Math.max(floor, applyDiscount(preferred, discountPct));
  return { preferred, floor, authorizedFloor, discountPct, unpriced, outOfScope, count };
}

/** Rights/exclusivity premiums the creator's policy allows us to charge for. */
export function rightsPremiumPercent(terms, policy) {
  const ur = policy.usageRights || {};
  let pct = 0;
  const notes = [];
  if (terms.usageRights?.paidAds && ur.paidAdsAllowed) {
    pct += PREMIUMS.paidAdsPercent;
    notes.push(`+${PREMIUMS.paidAdsPercent}% for paid-ads usage`);
  }
  if (terms.usageRights?.whitelisting && ur.whitelistingAllowed) {
    pct += PREMIUMS.whitelistingPercent;
    notes.push(`+${PREMIUMS.whitelistingPercent}% for whitelisting`);
  }
  const days = terms.usageRights?.durationDays;
  if (days && ur.maxUsageDays != null && days > ur.maxUsageDays) {
    const extra = Math.min(PREMIUMS.extraUsageCapPercent, Math.ceil((days - ur.maxUsageDays) / 30) * PREMIUMS.extraUsagePer30DaysPercent);
    pct += extra;
    notes.push(`+${extra}% for ${days - ur.maxUsageDays} extra usage days`);
  }
  if (terms.exclusivity?.required && policy.exclusivity?.acceptable && terms.exclusivity.durationDays) {
    const ex = Math.ceil(terms.exclusivity.durationDays / 30) * PREMIUMS.exclusivityPer30DaysPercent;
    pct += ex;
    notes.push(`+${ex}% for ${terms.exclusivity.durationDays} days of exclusivity`);
  }
  return { pct, notes };
}

const check = (code, label, status, detail) => ({ code, label, status, detail });

/** The creator's lowest acceptable fee for this scope (rate-card floors or the minimum deal size). */
export function minimumFor(scope, policy) {
  return Math.max(scope.floor || 0, policy.minimumDealMinor || 0);
}

/**
 * Counter amount for this round. The first counter anchors at the creator's
 * preferred rate. Each later counter comes down halfway from the last one
 * towards the brand's offer (or the creator's minimum, if the offer is below
 * it), rounded to ₹500, and never goes below either.
 */
export function counterAmount({ target, offered = 0, minimum = 0, lastCounterMinor = null }) {
  if (lastCounterMinor == null) return Math.max(target, offered);
  const base = Math.max(minimum, offered);
  if (lastCounterMinor <= base) return base;
  const next = roundToNearest(Math.round(base + (lastCounterMinor - base) / 2), 50_000);
  return next < lastCounterMinor && next > base ? next : base;
}

/** What the negotiation so far means for the next step: our last counter and whether the brand called its offer final. */
export function negotiationContext(deal) {
  const history = deal?.offerHistory || [];
  const lastCounter = [...history].reverse().find((o) => o.source === 'creator_counter');
  const lastBrand = [...history].reverse().find((o) => o.source === 'brand');
  return { lastCounterMinor: lastCounter?.terms?.totalAmountMinor ?? null, brandFinal: !!lastBrand?.extraction?.finalOffer };
}

/**
 * Terms for an acceptance: the brand's terms as stated, with anything they left
 * unstated filled from the creator's defaults so the acceptance is complete.
 */
export function fillUnstatedTerms(terms, profile) {
  const policy = profile.commercialPolicy || {};
  const ur = policy.usageRights || {};
  const t = JSON.parse(JSON.stringify(terms));
  const filled = [];
  t.usageRights = t.usageRights || {};
  if (t.usageRights.durationDays == null && !t.usageRights.perpetual) {
    t.usageRights.durationDays = ur.maxUsageDays ?? 90;
    t.usageRights.paidAds = t.usageRights.paidAds ?? false;
    t.usageRights.whitelisting = t.usageRights.whitelisting ?? false;
    filled.push('usage rights');
  }
  if (t.revisionsIncluded == null) {
    t.revisionsIncluded = policy.maxRevisions ?? 2;
    filled.push('revisions');
  }
  t.paymentTerms = t.paymentTerms || {};
  if (t.paymentTerms.netDays == null) {
    t.paymentTerms.netDays = policy.paymentTerms?.maxNetDays ?? 30;
    filled.push('payment terms');
  }
  t.exclusivity = t.exclusivity || {};
  if (t.exclusivity.required == null) {
    t.exclusivity.required = false;
    filled.push('exclusivity');
  }
  return { terms: t, filled };
}

/**
 * Evaluates an offer against the creator's policy.
 * @returns {{ checks, approvalCategories, recommendation, reasoning, tradeoffs, offerValueMinor, benchmarkValueMinor, floorValueMinor, questions }}
 */
export function evaluateOffer(terms, profile, { activeCampaigns = 0, now = new Date(), negotiation = {} } = {}) {
  const policy = profile.commercialPolicy || {};
  const barter = profile.barterPolicy || {};
  const currency = policy.currency || 'INR';
  const fmt = (m) => formatMoney(m, currency);
  const checks = [];
  const categories = new Set(['accept_or_reject_offer']); // accepting/rejecting always needs approval
  const reasoning = [];
  const tradeoffs = [];
  const questions = [];

  const scope = priceScope(terms.deliverables, policy);
  const premium = rightsPremiumPercent(terms, policy);
  const benchmark = roundToNearest(Math.round(scope.preferred * (1 + premium.pct / 100)), 50_000);
  const isBarter = terms.paymentType === 'barter';
  const cash = terms.totalAmountMinor ?? null;
  const barterCounted = terms.barter?.claimedRetailValueMinor ? Math.round(terms.barter.claimedRetailValueMinor * BARTER_VALUE_FACTOR) : 0;
  const offerValue = (cash || 0) + (terms.paymentType === 'hybrid' ? barterCounted : 0);

  // --- Currency
  if (terms.currency && terms.currency !== currency) {
    checks.push(check('currency', 'Currency', 'warning', `Offer is in ${terms.currency}; your policy is in ${currency}. Amounts are not converted automatically.`));
    questions.push(`Could you confirm the fee in ${currency}?`);
  }

  // --- Deliverables
  if (!terms.deliverables?.length) {
    checks.push(check('deliverables', 'Deliverables', 'missing', 'The offer does not specify deliverables.'));
    questions.push('Which deliverables (formats and quantities) do you have in mind?');
  } else if (scope.outOfScope.length) {
    categories.add('out_of_scope_deliverables');
    checks.push(check('deliverables', 'Deliverables', 'requires_approval', `Not in your accepted deliverables: ${scope.outOfScope.map(lbl).join(', ')}.`));
  } else {
    checks.push(check('deliverables', 'Deliverables', 'ok', `${scope.count} deliverable(s) within your accepted scope.`));
  }
  if (scope.unpriced.length) {
    checks.push(check('rate_card', 'Rate card', 'warning', `No rate set for ${scope.unpriced.map(lbl).join(', ')}; add rates in Settings for an accurate benchmark.`));
  }

  // --- Compensation
  if (isBarter) {
    if (barter.acceptance === 'never') {
      categories.add('barter_outside_policy');
      checks.push(check('compensation', 'Compensation', 'violation', 'Barter-only offer, and your policy does not accept barter.'));
    } else {
      const minOk = !barter.minimumValueMinor || barterCounted >= barter.minimumValueMinor;
      if (!minOk || barter.acceptance === 'selective') categories.add('barter_outside_policy');
      checks.push(check('compensation', 'Compensation', minOk ? 'requires_approval' : 'violation',
        `Barter offer${terms.barter?.claimedRetailValueMinor ? ` (brand-claimed retail value ${fmt(terms.barter.claimedRetailValueMinor)}, counted at ${fmt(barterCounted)})` : ' with no stated value'}.${minOk ? '' : ` Below your barter minimum of ${fmt(barter.minimumValueMinor)}.`}`));
      reasoning.push('Barter is valued at half the brand-claimed retail price because products are not cash and the retail price is not verified.');
    }
  } else if (cash === null) {
    checks.push(check('compensation', 'Compensation', 'missing', 'No fee is stated.'));
    questions.push('What budget have you allocated for this collaboration?');
  } else if (scope.preferred === 0) {
    checks.push(check('compensation', 'Compensation', 'warning', `Offer of ${fmt(cash)} cannot be benchmarked without rates for these deliverables.`));
  } else if (cash < scope.floor || (policy.minimumDealMinor && cash < policy.minimumDealMinor)) {
    const floor = Math.max(scope.floor, policy.minimumDealMinor || 0);
    checks.push(check('compensation', 'Compensation', 'violation', `${fmt(cash)} is below your minimum of ${fmt(floor)} for this scope.`));
  } else if (cash < benchmark) {
    checks.push(check('compensation', 'Compensation', 'warning', `${fmt(cash)} is between your minimum (${fmt(scope.floor)}) and your preferred rate (${fmt(benchmark)}).`));
  } else {
    checks.push(check('compensation', 'Compensation', 'ok', `${fmt(cash)} meets your preferred rate of ${fmt(benchmark)}.`));
  }
  if (premium.notes.length) reasoning.push(`Benchmark includes rights premiums: ${premium.notes.join(', ')}.`);

  // --- Revisions
  if (terms.revisionsIncluded == null) {
    checks.push(check('revisions', 'Revisions', 'missing', 'Number of revision rounds not stated.'));
  } else if (terms.revisionsIncluded > (policy.maxRevisions ?? 2)) {
    checks.push(check('revisions', 'Revisions', 'warning', `${terms.revisionsIncluded} rounds requested; your limit is ${policy.maxRevisions ?? 2}.`));
    tradeoffs.push(`More revision rounds increase workload; counter at ${policy.maxRevisions ?? 2} or price the extra rounds.`);
  } else {
    checks.push(check('revisions', 'Revisions', 'ok', `${terms.revisionsIncluded} round(s), within your limit.`));
  }

  // --- Usage rights
  const ur = policy.usageRights || {};
  const u = terms.usageRights || {};
  const rightsIssues = [];
  if (u.perpetual && !ur.perpetualAllowed) rightsIssues.push('perpetual usage');
  if (u.paidAds && !ur.paidAdsAllowed) rightsIssues.push('paid-ads usage');
  if (u.whitelisting && !ur.whitelistingAllowed) rightsIssues.push('whitelisting');
  if (rightsIssues.length) {
    categories.add('content_rights');
    checks.push(check('usage_rights', 'Usage rights', 'requires_approval', `Requests ${rightsIssues.join(', ')}, which your policy does not grant.`));
  } else if (u.perpetual || u.paidAds || u.whitelisting) {
    categories.add('content_rights');
    checks.push(check('usage_rights', 'Usage rights', 'requires_approval', 'Grants paid or extended content rights; allowed by your policy but always needs your approval.'));
  } else if (u.durationDays == null) {
    checks.push(check('usage_rights', 'Usage rights', 'missing', 'Usage rights duration not stated.'));
    questions.push('How long, and on which channels, would you like to use the content?');
  } else if (ur.maxUsageDays != null && u.durationDays > ur.maxUsageDays) {
    checks.push(check('usage_rights', 'Usage rights', 'warning', `${u.durationDays} days requested; your default is ${ur.maxUsageDays} days (premium applied).`));
  } else {
    checks.push(check('usage_rights', 'Usage rights', 'ok', `${u.durationDays} days of organic usage.`));
  }

  // --- Exclusivity (always gated when requested)
  const ex = terms.exclusivity || {};
  if (ex.required) {
    categories.add('exclusivity');
    const allowed = policy.exclusivity?.acceptable && (!ex.durationDays || ex.durationDays <= (policy.exclusivity?.maxDays || 0));
    checks.push(check('exclusivity', 'Exclusivity', allowed ? 'requires_approval' : 'violation',
      `Exclusivity requested${ex.durationDays ? ` for ${ex.durationDays} days` : ''}${ex.scope ? ` (${ex.scope})` : ''}. ${allowed ? 'Within your policy, but exclusivity always needs approval.' : 'Outside your exclusivity policy.'}`));
    if (!ex.durationDays) questions.push('What exclusivity period and category scope do you need?');
  } else if (ex.required === false) {
    checks.push(check('exclusivity', 'Exclusivity', 'ok', 'No exclusivity.'));
  } else {
    checks.push(check('exclusivity', 'Exclusivity', 'missing', 'Exclusivity not mentioned; confirm none is expected.'));
  }

  // --- Payment terms
  const pt = terms.paymentTerms || {};
  const maxNet = policy.paymentTerms?.maxNetDays ?? 30;
  if (pt.netDays == null) {
    checks.push(check('payment_terms', 'Payment terms', 'missing', 'Payment timeline not stated.'));
    questions.push('What are the payment terms (advance and days from invoice)?');
  } else if (pt.netDays > maxNet) {
    categories.add('unusual_payment_terms');
    checks.push(check('payment_terms', 'Payment terms', 'requires_approval', `Net ${pt.netDays} days exceeds your limit of ${maxNet}.`));
  } else {
    checks.push(check('payment_terms', 'Payment terms', 'ok', `Net ${pt.netDays} days.`));
  }
  if (policy.paymentTerms?.minAdvancePercent && (pt.advancePercent ?? 0) < policy.paymentTerms.minAdvancePercent) {
    checks.push(check('advance', 'Advance', 'warning', `Advance ${pt.advancePercent ?? 0}% is below your preferred ${policy.paymentTerms.minAdvancePercent}%.`));
  }
  if (terms.cancellation?.killFeePercent != null && terms.cancellation.killFeePercent < 50) {
    categories.add('unusual_payment_terms');
    checks.push(check('cancellation', 'Cancellation', 'requires_approval', `Kill fee of ${terms.cancellation.killFeePercent}% — review cancellation terms.`));
  }

  // --- Timeline / workload
  const lead = policy.workload?.minLeadTimeDays ?? 7;
  const due = terms.deadlines?.contentDueAt ? new Date(terms.deadlines.contentDueAt) : null;
  if (due && (due - now) / 86_400_000 < lead) {
    checks.push(check('timeline', 'Timeline', 'warning', `Content due in under ${lead} days.`));
    tradeoffs.push('A tight deadline increases production risk; ask for more time or a rush premium.');
  }
  if (activeCampaigns >= (policy.workload?.maxActiveCampaigns ?? 4)) {
    checks.push(check('workload', 'Workload', 'warning', `You already have ${activeCampaigns} active campaigns (limit ${policy.workload?.maxActiveCampaigns ?? 4}).`));
  }
  if (terms.otherConditions?.length) {
    categories.add('sensitive_representation');
    checks.push(check('other_conditions', 'Other conditions', 'requires_approval', `Additional conditions need review: ${terms.otherConditions.slice(0, 3).join('; ')}`));
  }

  // --- Recommendation (deterministic)
  const has = (status) => checks.some((c) => c.status === status);
  const compCheck = checks.find((c) => c.code === 'compensation');
  const criticalMissing = checks.some((c) => c.status === 'missing' && ['compensation', 'deliverables'].includes(c.code));
  let recommendation;
  if (isBarter && barter.acceptance === 'never') {
    recommendation = 'decline';
    reasoning.push('Barter-only offers are outside your policy. Declining politely, or asking whether a paid budget exists, are both options.');
  } else if (criticalMissing) {
    recommendation = 'clarify';
    reasoning.push('Key terms are missing, so the offer cannot be evaluated yet.');
  } else if (!isBarter && cash !== null && negotiation.brandFinal) {
    const minimum = minimumFor(scope, policy);
    if (cash >= minimum) {
      recommendation = 'accept';
      reasoning.push(`The brand says ${fmt(cash)} is its final offer. It meets your minimum${minimum ? ` of ${fmt(minimum)}` : ''}, and countering again risks losing the deal.`);
    } else if (negotiation.lastCounterMinor != null && negotiation.lastCounterMinor <= minimum) {
      recommendation = 'decline';
      reasoning.push(`The brand's final offer of ${fmt(cash)} is below your minimum of ${fmt(minimum)}, which you have already offered.`);
    } else {
      recommendation = 'counter';
      reasoning.push(`The brand's final offer of ${fmt(cash)} is below your minimum of ${fmt(minimum)}; one last counter at your minimum is suggested.`);
    }
  } else if (!isBarter && cash !== null && negotiation.lastCounterMinor != null && cash >= minimumFor(scope, policy)
    && counterAmount({ target: benchmark, offered: cash, minimum: minimumFor(scope, policy), lastCounterMinor: negotiation.lastCounterMinor }) <= cash) {
    recommendation = 'accept';
    reasoning.push(`You have met in the middle: ${fmt(cash)} is at or above where your next counter would land, and above your minimum.`);
  } else if (checks.some((c) => c.code === 'other_conditions')) {
    recommendation = 'escalate';
    reasoning.push('The offer contains conditions that need your judgement before any response.');
  } else if (has('violation') || compCheck?.status === 'warning' || checks.some((c) => ['revisions', 'usage_rights', 'payment_terms'].includes(c.code) && c.status !== 'ok')) {
    recommendation = 'counter';
    if (cash !== null && benchmark && cash < benchmark) reasoning.push(`The offer is ${Math.round((1 - cash / benchmark) * 100)}% below your preferred rate for this scope.`);
  } else {
    recommendation = 'accept';
    reasoning.push('The offer meets your preferred rate and policy. Accepting still requires your explicit approval and a written agreement.');
  }
  if (cash !== null && benchmark && cash >= scope.floor && cash < benchmark) {
    tradeoffs.push(`Accepting ${fmt(cash)} is within your minimum; countering at ${fmt(benchmark)} risks a slower close but protects your rate.`);
  }

  return {
    checks,
    approvalCategories: [...categories],
    recommendation,
    reasoning,
    tradeoffs,
    questions,
    offerValueMinor: offerValue || null,
    benchmarkValueMinor: benchmark || null,
    floorValueMinor: scope.floor || null,
    authorizedFloorMinor: scope.authorizedFloor || null,
    scope,
    premium,
  };
}

/**
 * Builds a counter-proposal. Targets the creator's preferred rate (plus any
 * rights premiums) — never the minimum — and never asks for less than the
 * brand already offered.
 */
export function buildCounterTerms(offer, profile, _evaluation, { lastCounterMinor = null, brandFinal = false } = {}) {
  const policy = profile.commercialPolicy || {};
  const ur = policy.usageRights || {};
  const rationale = [];
  const removed = [];
  const accepted = new Set(policy.acceptedDeliverables?.length ? policy.acceptedDeliverables : (policy.rates || []).map((r) => r.deliverable));
  const deliverables = (offer.deliverables || []).filter((d) => {
    if (accepted.has(d.type)) return true;
    removed.push(d.type);
    return false;
  });
  if (removed.length) rationale.push(`Removed deliverables outside your scope: ${removed.map(lbl).join(', ')}.`);

  const usage = {
    durationDays: offer.usageRights?.durationDays ?? ur.maxUsageDays ?? 90,
    paidAds: !!(offer.usageRights?.paidAds && ur.paidAdsAllowed),
    whitelisting: !!(offer.usageRights?.whitelisting && ur.whitelistingAllowed),
    perpetual: !!(offer.usageRights?.perpetual && ur.perpetualAllowed),
    notes: null,
  };
  if (offer.usageRights?.perpetual && !usage.perpetual) {
    usage.durationDays = ur.maxUsageDays ?? 90;
    rationale.push(`Replaced perpetual usage with ${usage.durationDays} days.`);
  }
  if (offer.usageRights?.paidAds && !usage.paidAds) rationale.push('Excluded paid-ads usage (not granted by your policy).');
  if (offer.usageRights?.whitelisting && !usage.whitelisting) rationale.push('Excluded whitelisting (not granted by your policy).');

  let exclusivity = { required: false, durationDays: null, scope: null };
  if (offer.exclusivity?.required) {
    const ok = policy.exclusivity?.acceptable && offer.exclusivity.durationDays && offer.exclusivity.durationDays <= (policy.exclusivity?.maxDays || 0);
    if (ok) exclusivity = { ...offer.exclusivity };
    else rationale.push('Removed exclusivity (outside your policy).');
  }

  const counterTermsBase = { ...offer, deliverables, usageRights: usage, exclusivity };
  const scope = priceScope(deliverables, policy);
  const premium = rightsPremiumPercent(counterTermsBase, policy);
  const target = roundToNearest(Math.round(scope.preferred * (1 + premium.pct / 100)), 50_000);
  const offered = offer.totalAmountMinor ?? 0;
  const minimum = minimumFor(scope, policy);
  // A brand's final offer below the minimum gets one last counter at the minimum.
  let amount = brandFinal && lastCounterMinor != null && offered < minimum ? minimum : counterAmount({ target, offered, minimum, lastCounterMinor });
  let previousCounterMinor = null;
  if (offer.paymentType === 'barter') {
    amount = target;
    rationale.push('Proposed a paid fee instead of barter, as barter-only does not meet your policy.');
  } else if (lastCounterMinor != null && amount < lastCounterMinor) {
    previousCounterMinor = lastCounterMinor;
    rationale.push(amount === Math.max(minimum, offered) && amount === minimum ? 'Came down to your minimum for this scope.' : 'Came down halfway from your last counter towards their offer.');
  } else if (target > offered) {
    rationale.push(`Countered at your preferred rate${premium.notes.length ? ` including ${premium.notes.join(', ')}` : ''}.`);
  } else {
    rationale.push('The brand already offered at or above your preferred rate; kept their figure.');
  }

  const maxRev = policy.maxRevisions ?? 2;
  const revisions = Math.min(offer.revisionsIncluded ?? maxRev, maxRev);
  if ((offer.revisionsIncluded ?? 0) > maxRev) rationale.push(`Capped revisions at ${maxRev}.`);
  const maxNet = policy.paymentTerms?.maxNetDays ?? 30;
  const netDays = Math.min(offer.paymentTerms?.netDays ?? maxNet, maxNet);
  if ((offer.paymentTerms?.netDays ?? 0) > maxNet) rationale.push(`Shortened payment terms to net ${maxNet}.`);
  const advancePercent = Math.max(offer.paymentTerms?.advancePercent ?? 0, policy.paymentTerms?.minAdvancePercent ?? 0) || null;

  const terms = {
    paymentType: offer.paymentType === 'barter' ? 'paid' : offer.paymentType || 'paid',
    totalAmountMinor: amount,
    currency: policy.currency || 'INR',
    deliverables,
    barter: offer.paymentType === 'hybrid' ? offer.barter : { productDescription: null, claimedRetailValueMinor: null },
    revisionsIncluded: revisions,
    usageRights: usage,
    exclusivity,
    paymentTerms: { netDays, advancePercent, notes: null },
    deadlines: offer.deadlines || {},
    cancellation: offer.cancellation || {},
    otherConditions: [],
  };
  return { terms, rationale, targetMinor: target, scope, previousCounterMinor };
}

/**
 * True when a counter-proposal stays inside the creator's explicitly
 * authorised rules, so Level 2+ autonomy may send it without approval.
 */
export function counterWithinAuthorizedRules(counterTerms, profile) {
  const policy = profile.commercialPolicy || {};
  const ur = policy.usageRights || {};
  const reasons = [];
  const scope = priceScope(counterTerms.deliverables, policy);
  if (!counterTerms.deliverables?.length) reasons.push('No deliverables');
  if (scope.outOfScope.length || scope.unpriced.length) reasons.push('Deliverables outside the priced scope');
  if (counterTerms.totalAmountMinor == null || counterTerms.totalAmountMinor < scope.authorizedFloor) reasons.push('Price below your authorised floor');
  if (counterTerms.usageRights?.perpetual || counterTerms.usageRights?.paidAds || counterTerms.usageRights?.whitelisting) reasons.push('Grants paid or extended rights');
  if ((counterTerms.usageRights?.durationDays ?? 0) > (ur.maxUsageDays ?? 90)) reasons.push('Usage beyond your default window');
  if (counterTerms.exclusivity?.required) reasons.push('Includes exclusivity');
  if ((counterTerms.paymentTerms?.netDays ?? 0) > (policy.paymentTerms?.maxNetDays ?? 30)) reasons.push('Payment terms beyond your limit');
  if (counterTerms.paymentType !== 'paid') reasons.push('Not a cash offer');
  return { ok: reasons.length === 0, reasons };
}
