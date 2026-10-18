import { describe, it, expect } from 'vitest';
import { evaluateOffer, buildCounterTerms, counterWithinAuthorizedRules, priceScope } from '../../src/services/negotiation/policy.js';
import { approvalRequirement } from '../../src/services/approvals/requirements.js';
import { canTransition, transition } from '../../src/services/negotiation/stateMachine.js';

const r = (pref, min) => ({ preferredMinor: pref * 100, minimumMinor: min * 100 });
const profile = {
  barterPolicy: { acceptance: 'selective', minimumValueMinor: 1_000_000 },
  commercialPolicy: {
    currency: 'INR',
    minimumDealMinor: 1_000_000,
    rates: [
      { deliverable: 'instagram_reel', ...r(30000, 20000) },
      { deliverable: 'instagram_story', ...r(8000, 5000) },
    ],
    acceptedDeliverables: ['instagram_reel', 'instagram_story'],
    maxPackageDiscountPercent: 10,
    maxRevisions: 2,
    usageRights: { maxUsageDays: 90, paidAdsAllowed: false, whitelistingAllowed: false, perpetualAllowed: false },
    exclusivity: { acceptable: false, maxDays: 0 },
    paymentTerms: { maxNetDays: 30 },
  },
  negotiationAutonomy: { level: 0 },
  automation: { autoSendPitches: false, followUps: { autoSend: false } },
};

const baseOffer = (over = {}) => ({
  paymentType: 'paid',
  totalAmountMinor: 2_500_000,
  currency: 'INR',
  deliverables: [{ type: 'instagram_reel', quantity: 1 }],
  revisionsIncluded: 2,
  usageRights: { durationDays: 60, paidAds: false, whitelisting: false, perpetual: false },
  exclusivity: { required: false },
  paymentTerms: { netDays: 30 },
  deadlines: {},
  cancellation: {},
  otherConditions: [],
  ...over,
});

describe('priceScope', () => {
  it('prices deliverables and applies package discount only to multi-item packages, never below minimums', () => {
    const single = priceScope([{ type: 'instagram_reel', quantity: 1 }], profile.commercialPolicy);
    expect(single.preferred).toBe(3_000_000);
    expect(single.authorizedFloor).toBe(3_000_000); // no discount on a single item
    const pkg = priceScope([{ type: 'instagram_reel', quantity: 2 }, { type: 'instagram_story', quantity: 2 }], profile.commercialPolicy);
    expect(pkg.preferred).toBe(7_600_000);
    expect(pkg.floor).toBe(5_000_000);
    expect(pkg.authorizedFloor).toBe(6_840_000);
  });
});

describe('evaluateOffer', () => {
  it('flags an offer below the minimum as a violation and recommends a counter', () => {
    const ev = evaluateOffer(baseOffer({ totalAmountMinor: 1_500_000 }), profile);
    expect(ev.checks.find((c) => c.code === 'compensation').status).toBe('violation');
    expect(ev.recommendation).toBe('counter');
  });

  it('does not recommend accepting just because the minimum is met', () => {
    const ev = evaluateOffer(baseOffer({ totalAmountMinor: 2_200_000 }), profile);
    expect(ev.checks.find((c) => c.code === 'compensation').status).toBe('warning');
    expect(ev.recommendation).toBe('counter');
  });

  it('recommends accept only at the preferred rate, and acceptance still needs approval', () => {
    const ev = evaluateOffer(baseOffer({ totalAmountMinor: 3_000_000 }), profile);
    expect(ev.recommendation).toBe('accept');
    expect(ev.approvalCategories).toContain('accept_or_reject_offer');
  });

  it('gates perpetual/paid usage rights and exclusivity', () => {
    const ev = evaluateOffer(baseOffer({ usageRights: { perpetual: true, paidAds: true }, exclusivity: { required: true, durationDays: 60 } }), profile);
    expect(ev.approvalCategories).toEqual(expect.arrayContaining(['content_rights', 'exclusivity']));
    expect(ev.checks.find((c) => c.code === 'exclusivity').status).toBe('violation');
  });

  it('asks for clarification when compensation and deliverables are missing', () => {
    const ev = evaluateOffer(baseOffer({ totalAmountMinor: null, paymentType: null, deliverables: [] }), profile);
    expect(ev.recommendation).toBe('clarify');
    expect(ev.questions.length).toBeGreaterThan(0);
  });

  it('values barter at half the claimed retail value, not the brand price', () => {
    const ev = evaluateOffer(baseOffer({ paymentType: 'barter', totalAmountMinor: null, barter: { claimedRetailValueMinor: 1_600_000 } }), profile);
    const comp = ev.checks.find((c) => c.code === 'compensation');
    expect(comp.status).toBe('violation'); // 8,000 counted < 10,000 minimum
    expect(ev.approvalCategories).toContain('barter_outside_policy');
  });

  it('declines barter-only when the creator never accepts barter', () => {
    const ev = evaluateOffer(baseOffer({ paymentType: 'barter', totalAmountMinor: null }), { ...profile, barterPolicy: { acceptance: 'never' } });
    expect(ev.recommendation).toBe('decline');
  });

  it('gates long payment terms', () => {
    const ev = evaluateOffer(baseOffer({ paymentTerms: { netDays: 90 } }), profile);
    expect(ev.approvalCategories).toContain('unusual_payment_terms');
  });
});

describe('buildCounterTerms', () => {
  it('targets the preferred rate (not the minimum) and strips unapproved rights', () => {
    const offer = baseOffer({ totalAmountMinor: 1_500_000, usageRights: { perpetual: true, paidAds: true }, exclusivity: { required: true, durationDays: 90 }, revisionsIncluded: 5, paymentTerms: { netDays: 75 } });
    const { terms } = buildCounterTerms(offer, profile, evaluateOffer(offer, profile));
    expect(terms.totalAmountMinor).toBe(3_000_000);
    expect(terms.usageRights.perpetual).toBe(false);
    expect(terms.usageRights.paidAds).toBe(false);
    expect(terms.exclusivity.required).toBe(false);
    expect(terms.revisionsIncluded).toBe(2);
    expect(terms.paymentTerms.netDays).toBe(30);
  });

  it('never counters below what the brand already offered', () => {
    const offer = baseOffer({ totalAmountMinor: 4_000_000 });
    const { terms } = buildCounterTerms(offer, profile, evaluateOffer(offer, profile));
    expect(terms.totalAmountMinor).toBe(4_000_000);
  });

  it('removes out-of-scope deliverables', () => {
    const offer = baseOffer({ deliverables: [{ type: 'instagram_reel', quantity: 1 }, { type: 'event_appearance', quantity: 1 }] });
    const { terms, rationale } = buildCounterTerms(offer, profile, evaluateOffer(offer, profile));
    expect(terms.deliverables.map((d) => d.type)).toEqual(['instagram_reel']);
    expect(rationale.join(' ')).toMatch(/outside your scope/);
  });
});

describe('counterWithinAuthorizedRules', () => {
  it('accepts a clean counter at the preferred rate', () => {
    const offer = baseOffer({ totalAmountMinor: 1_500_000 });
    const { terms } = buildCounterTerms(offer, profile, evaluateOffer(offer, profile));
    expect(counterWithinAuthorizedRules(terms, profile).ok).toBe(true);
  });
  it('rejects a counter below the authorised floor', () => {
    const offer = baseOffer();
    const { terms } = buildCounterTerms(offer, profile, evaluateOffer(offer, profile));
    expect(counterWithinAuthorizedRules({ ...terms, totalAmountMinor: 1_000_000 }, profile).ok).toBe(false);
  });
});

describe('approvalRequirement', () => {
  it('always requires approval to accept, with explicit confirmation', () => {
    for (const level of [0, 1, 2, 3]) {
      const req = approvalRequirement({ actionType: 'accept_offer', profile: { ...profile, negotiationAutonomy: { level } } });
      expect(req.required).toBe(true);
      expect(req.requiresExplicitConfirmation).toBe(true);
    }
  });
  it('requires approval for pitches at level 0 and allows auto-send at level 1 only when enabled', () => {
    expect(approvalRequirement({ actionType: 'send_pitch', profile }).required).toBe(true);
    expect(approvalRequirement({ actionType: 'send_pitch', profile: { ...profile, negotiationAutonomy: { level: 1 } } }).required).toBe(true);
    const auto = approvalRequirement({ actionType: 'send_pitch', profile: { ...profile, negotiationAutonomy: { level: 1 }, automation: { autoSendPitches: true } } });
    expect(auto.required).toBe(false);
    expect(auto.autoRule).toMatch(/Level 1/);
  });
  it('requires approval for counteroffers outside authorised rules even at level 3', () => {
    const req = approvalRequirement({ actionType: 'send_counteroffer', profile: { ...profile, negotiationAutonomy: { level: 3 } }, counterRule: { ok: false, reasons: ['Price below your authorised floor'] } });
    expect(req.required).toBe(true);
  });
  it('requires approval for sensitive content regardless of level', () => {
    const req = approvalRequirement({ actionType: 'send_counteroffer', content: 'We guarantee results and will handle GST.', profile: { ...profile, negotiationAutonomy: { level: 3 } }, counterRule: { ok: true } });
    expect(req.required).toBe(true);
    expect(req.reasons.map((r) => r.code)).toContain('sensitive_message');
  });
  it('requires approval for unknown actions', () => {
    expect(approvalRequirement({ actionType: 'sign_contract', profile: { ...profile, negotiationAutonomy: { level: 3 } } }).required).toBe(true);
  });
});

describe('negotiation state machine', () => {
  it('rejects invalid transitions', () => {
    expect(canTransition('initial_outreach', 'deal_confirmed')).toBe(false);
    expect(() => transition({ negotiationState: 'awaiting_reply', stateHistory: [] }, 'deal_confirmed')).toThrow(/Invalid negotiation transition/);
  });
  it('records history and sets won on confirmation', () => {
    const deal = { negotiationState: 'agreement_pending', stateHistory: [], status: 'open' };
    transition(deal, 'deal_confirmed', { actorType: 'creator' });
    expect(deal.status).toBe('won');
    expect(deal.stateHistory).toHaveLength(1);
  });
});
