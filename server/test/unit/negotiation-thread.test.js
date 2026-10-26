import { describe, it, expect } from 'vitest';
import { mergeOfferTerms, stillMissing } from '../../src/services/negotiation/negotiation.service.js';
import { threadSubject } from '../../src/services/messaging.service.js';
import { buildCounterTerms, counterAmount, evaluateOffer, fillUnstatedTerms } from '../../src/services/negotiation/policy.js';

const reel = [{ type: 'instagram_reel', quantity: 1, description: null }];
const empty = { usageRights: {}, exclusivity: {}, paymentTerms: {}, deadlines: {}, cancellation: {}, barter: {}, otherConditions: [] };

describe('brand terms across a thread', () => {
  it('keeps the fee and payment terms the brand stated earlier when a later email leaves them out', () => {
    const first = { ...empty, paymentType: 'paid', totalAmountMinor: 800000, currency: 'INR', deliverables: reel, paymentTerms: { netDays: null, advancePercent: 30 }, otherConditions: ['Reel stays up'] };
    const later = { ...empty, paymentType: 'paid', totalAmountMinor: null, currency: 'INR', deliverables: reel, paymentTerms: { netDays: null, advancePercent: null }, otherConditions: ['MOU within a week'] };
    const { terms, carried } = mergeOfferTerms(first, later);
    expect(terms.totalAmountMinor).toBe(800000);
    expect(terms.paymentTerms.advancePercent).toBe(30);
    expect(terms.otherConditions).toEqual(['Reel stays up', 'MOU within a week']);
    expect(carried).toEqual(expect.arrayContaining(['fee', 'payment terms']));
  });

  it('lets a new figure replace the old one, and drops the old fee when the deliverables change', () => {
    const first = { ...empty, paymentType: 'paid', totalAmountMinor: 800000, deliverables: reel };
    expect(mergeOfferTerms(first, { ...empty, paymentType: 'paid', totalAmountMinor: 1000000, deliverables: reel }).terms.totalAmountMinor).toBe(1000000);
    const twoReels = [{ type: 'instagram_reel', quantity: 2, description: null }];
    expect(mergeOfferTerms(first, { ...empty, paymentType: 'paid', totalAmountMinor: null, deliverables: twoReels }).terms.totalAmountMinor).toBeNull();
    expect(mergeOfferTerms(null, first).terms).toBe(first);
  });

  it('stops listing terms as missing once they are known', () => {
    const terms = { totalAmountMinor: 800000, deliverables: reel, usageRights: {}, exclusivity: {}, paymentTerms: { advancePercent: 30 } };
    expect(stillMissing(['total amount', 'payment net days', 'usage rights', 'revisions'], terms)).toEqual(['usage rights', 'revisions']);
  });

  it('builds one reply subject for the whole thread', () => {
    expect(threadSubject('Collaboration idea: Vishnu x Jeevant')).toBe('Re: Collaboration idea: Vishnu x Jeevant');
    expect(threadSubject('RE: Fwd: re: Collab')).toBe('Re: Collab');
    expect(threadSubject('')).toBeNull();
  });
});

describe('negotiating over several rounds', () => {
  const profile = {
    commercialPolicy: {
      currency: 'INR', minimumDealMinor: 1_000_000, maxRevisions: 2,
      rates: [{ deliverable: 'instagram_reel', preferredMinor: 1_500_000, minimumMinor: 1_000_000 }],
      acceptedDeliverables: ['instagram_reel'],
      usageRights: { maxUsageDays: 90 }, paymentTerms: { maxNetDays: 30 },
    },
  };
  const offer = (amount) => ({ ...empty, paymentType: 'paid', totalAmountMinor: amount, currency: 'INR', deliverables: reel, revisionsIncluded: 2, usageRights: { durationDays: 90 }, exclusivity: { required: false }, paymentTerms: { netDays: 30 } });

  it('opens at the preferred rate, then comes down halfway each round, never below the offer or the minimum', () => {
    expect(counterAmount({ target: 1_500_000, offered: 1_000_000, minimum: 1_000_000 })).toBe(1_500_000);
    expect(counterAmount({ target: 1_500_000, offered: 1_000_000, minimum: 1_000_000, lastCounterMinor: 1_500_000 })).toBe(1_250_000);
    expect(counterAmount({ target: 1_500_000, offered: 1_000_000, minimum: 1_000_000, lastCounterMinor: 1_250_000 })).toBe(1_150_000);
    expect(counterAmount({ target: 1_500_000, offered: 600_000, minimum: 1_000_000, lastCounterMinor: 1_050_000 })).toBe(1_000_000);
    const built = buildCounterTerms(offer(1_000_000), profile, null, { lastCounterMinor: 1_500_000 });
    expect(built.terms.totalAmountMinor).toBe(1_250_000);
    expect(built.previousCounterMinor).toBe(1_500_000);
  });

  it('recommends accepting a final offer at or above the minimum, and one last counter at the minimum below it', () => {
    expect(evaluateOffer(offer(1_000_000), profile, { negotiation: { brandFinal: true, lastCounterMinor: 1_250_000 } }).recommendation).toBe('accept');
    expect(evaluateOffer(offer(800_000), profile, { negotiation: { brandFinal: true, lastCounterMinor: 1_250_000 } }).recommendation).toBe('counter');
    expect(buildCounterTerms(offer(800_000), profile, null, { brandFinal: true, lastCounterMinor: 1_250_000 }).terms.totalAmountMinor).toBe(1_000_000);
    expect(evaluateOffer(offer(800_000), profile, { negotiation: { brandFinal: true, lastCounterMinor: 1_000_000 } }).recommendation).toBe('decline');
  });

  it('completes an acceptance with the creator defaults for anything the brand left out', () => {
    const { terms, filled } = fillUnstatedTerms({ ...empty, totalAmountMinor: 1_000_000, deliverables: reel, revisionsIncluded: null }, profile);
    expect(terms).toMatchObject({ revisionsIncluded: 2, usageRights: { durationDays: 90, paidAds: false }, paymentTerms: { netDays: 30 }, exclusivity: { required: false } });
    expect(filled).toEqual(['usage rights', 'revisions', 'payment terms', 'exclusivity']);
  });
});
