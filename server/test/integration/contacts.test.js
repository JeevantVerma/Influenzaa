import { describe, it, expect } from 'vitest';
import { useTestDatabase, clearCollectionsBeforeEach, signUp, onboard } from '../helpers.js';
import { BrandContact, BrandProfile, Opportunity, ScheduledJob } from '../../src/models/index.js';
import { discoverBrandContacts } from '../../src/services/contacts/contactDiscovery.service.js';
import { runDiscovery } from '../../src/services/discovery/pipeline.js';
import { setSourcesForTests } from '../../src/services/discovery/sources/index.js';

const ctx = useTestDatabase();
clearCollectionsBeforeEach();

async function realBrandOpportunity(creatorId, { isDemo = false } = {}) {
  const brand = await BrandProfile.create({ normalizedDomain: isDemo ? 'glowleaf.example' : 'peakpulse.test', name: 'PeakPulse', isDemo });
  const opp = await Opportunity.create({
    creatorId, brandId: brand._id, dedupeKey: `k-${brand._id}`, signalType: 'medium_intent', verificationStatus: isDemo ? 'demo' : 'unverified',
    firstDiscoveredAt: new Date(), recommendedAction: 'find_or_add_contact', contactConfidence: 0, isDemo,
  });
  return { brand, opp };
}

const FOUND = {
  status: 'found',
  pagesChecked: ['/', '/pages/collaborate'],
  contacts: [{ businessEmail: 'collabs@peakpulse.test', role: 'Partnerships inbox', roleCategory: 'creator_partnerships', confidence: 0.85, sourceUrl: 'https://peakpulse.test/pages/collaborate' }],
};

describe('contacts from brand websites', () => {
  it('stores published emails as shared contacts with their source page and unlocks pitching', async () => {
    const c = await signUp(ctx.app);
    const { brand, opp } = await realBrandOpportunity(c.user._id);
    const r = await discoverBrandContacts(brand._id, { finder: async () => FOUND });
    expect(r).toMatchObject({ status: 'found', contactsFound: 1 });

    const contact = await BrandContact.findOne({ brandId: brand._id }).lean();
    expect(contact).toMatchObject({ source: 'public_page', verificationStatus: 'unverified', ownerCreatorId: null, sourceUrl: 'https://peakpulse.test/pages/collaborate', name: null });
    const updated = await Opportunity.findById(opp._id).lean();
    expect(updated.recommendedAction).toBe('draft_pitch');
    expect(updated.contactConfidence).toBe(0.85);
    expect((await BrandProfile.findById(brand._id).lean()).contactDiscovery).toMatchObject({ status: 'found', contactsFound: 1, pagesChecked: 2 });

    // The creator sees it on the opportunity, with where it came from.
    const detail = (await c.get(`/opportunities/${opp._id}`)).body;
    expect(detail.contacts[0]).toMatchObject({ businessEmail: 'collabs@peakpulse.test', source: 'public_page' });
    expect(detail.brand.contactDiscovery.status).toBe('found');
  });

  it('records a site that publishes nothing without inventing contacts', async () => {
    const c = await signUp(ctx.app);
    const { brand, opp } = await realBrandOpportunity(c.user._id);
    await discoverBrandContacts(brand._id, { finder: async () => ({ status: 'none_found', pagesChecked: ['/', '/contact'], contacts: [] }) });
    expect(await BrandContact.countDocuments({ brandId: brand._id })).toBe(0);
    expect((await Opportunity.findById(opp._id).lean()).recommendedAction).toBe('find_or_add_contact');
  });

  it('a creator can queue one check per brand per day, never for demo brands or others’ opportunities', async () => {
    const c = await signUp(ctx.app);
    const other = await signUp(ctx.app);
    const { brand, opp } = await realBrandOpportunity(c.user._id);

    const first = await c.post(`/opportunities/${opp._id}/find-contacts`);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ queued: true, contactDiscovery: { status: 'queued' } });
    const again = await c.post(`/opportunities/${opp._id}/find-contacts`);
    expect(again.body.queued).toBe(false);
    expect(await ScheduledJob.countDocuments({ jobType: 'contacts.discover', 'payload.brandId': String(brand._id) })).toBe(1);

    expect((await other.post(`/opportunities/${opp._id}/find-contacts`)).status).toBe(404);

    await BrandProfile.deleteMany({});
    await Opportunity.deleteMany({});
    const demo = await realBrandOpportunity(c.user._id, { isDemo: true });
    expect((await c.post(`/opportunities/${demo.opp._id}/find-contacts`)).status).toBe(409);
  });

  it('discovery queues a website check for new real brands only', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    const candidate = (domain, isDemo) => ({
      brand: { name: domain, domain, categories: ['fitness'], markets: ['India'], isDemo },
      signal: { kind: 'product_launch', productOrCampaign: 'New range', title: 'Launch' },
      evidence: [{ url: `https://${domain}/news`, title: 'Launch', retrievedAt: new Date(), source: 'test', verification: isDemo ? 'demo' : 'unverified', kind: 'hypothesis' }],
      contacts: [],
    });
    setSourcesForTests([{ id: 'test', label: 'Test source', collect: async () => ({ status: 'ok', candidates: [candidate('peakpulse.test', false), candidate('glowleaf.example', true)] }) }]);
    try {
      await runDiscovery({ creatorId: c.user._id, trigger: 'manual' });
      await runDiscovery({ creatorId: c.user._id, trigger: 'manual' }); // second run must not queue again
    } finally {
      setSourcesForTests(null);
    }
    const jobs = await ScheduledJob.find({ jobType: 'contacts.discover' }).lean();
    expect(jobs).toHaveLength(1);
    const real = await BrandProfile.findOne({ normalizedDomain: 'peakpulse.test' }).lean();
    expect(jobs[0].payload.brandId).toBe(String(real._id));
    expect(real.contactDiscovery.status).toBe('queued');
  });
});
