import { describe, it, expect, afterEach } from 'vitest';
import { useTestDatabase, clearCollectionsBeforeEach, signUp, onboard, drainWorker } from '../helpers.js';
import { ApprovalRequest, BrandProfile, Conversation, Deal, InstagramThread, IntegrationConnection, Message, Opportunity, ScheduledJob } from '../../src/models/index.js';
import { setInstagramClientForTests, InstagramError } from '../../src/services/instagram/client.js';
import { pollInstagramInbox, refreshInstagramTokens } from '../../src/services/instagram/instagram.service.js';
import { DM_DISCLOSURE } from '../../src/services/messaging.service.js';

const ctx = useTestDatabase();
clearCollectionsBeforeEach();
afterEach(() => setInstagramClientForTests(null));

const ME = '17840000000000001';
const TOKEN = 'IGAAtest-token-value-that-is-long-enough';

/** A fake Instagram account: threads of messages, plus a record of sends. */
function fakeInstagram({ accountType = 'MEDIA_CREATOR' } = {}) {
  const threads = new Map(); // conversationId → [{ id, createdTime, from, to, text }]
  const sent = [];
  let seq = 0;
  const api = {
    sent,
    calls: { refresh: 0 },
    dm(conversationId, { from, to, text, at = new Date() }) {
      const list = threads.get(conversationId) || [];
      list.push({ id: `m${++seq}`, createdTime: at, from, to: [to], text });
      threads.set(conversationId, list);
    },
    client: {
      async me(token) {
        if (token !== TOKEN) throw new InstagramError('Invalid OAuth access token', { status: 400, code: 190 });
        return { igUserId: ME, appScopedId: 'app-scoped-1', username: 'vishnu_1345', accountType };
      },
      async conversations() {
        return [...threads.entries()].map(([id, list]) => ({ id, updatedTime: list.at(-1).createdTime }));
      },
      async messageIds(_t, id) {
        return [...(threads.get(id) || [])].reverse().map((m) => ({ id: m.id, createdTime: m.createdTime }));
      },
      async message(_t, id) {
        for (const list of threads.values()) {
          const m = list.find((x) => x.id === id);
          if (m) return m;
        }
        throw new InstagramError('not found', { status: 404 });
      },
      async sendText(_t, recipientId, text) {
        sent.push({ recipientId, text });
        return { messageId: `sent${sent.length}`, recipientId };
      },
      async subscribeToMessages() {
        api.calls.subscribe = (api.calls.subscribe || 0) + 1;
        return true;
      },
      async refreshToken() {
        api.calls.refresh++;
        return { accessToken: TOKEN, expiresIn: 60 * 86_400 };
      },
    },
  };
  return api;
}

const brandAcc = { id: '9001', username: 'glowco.in' };
const fanAcc = { id: '9002', username: 'a_fan_123' };
const meAcc = { id: ME, username: 'vishnu_1345' };

async function connected() {
  const c = await signUp(ctx.app);
  await onboard(c);
  const ig = fakeInstagram();
  setInstagramClientForTests(ig.client);
  const res = await c.post('/integrations/instagram/token', { accessToken: TOKEN, consent: true });
  expect(res.status).toBe(200);
  expect(ig.calls.subscribe).toBe(1); // message access switched on for the app
  return { c, ig };
}

async function approve(c, approvalId) {
  const a = (await c.get(`/approvals/${approvalId}`)).body;
  return c.post(`/approvals/${approvalId}/approve`, { actionHash: a.actionHash });
}

describe('connecting Instagram', () => {
  it('stores the token encrypted and shows the account in Integrations', async () => {
    const { c } = await connected();
    const conn = await IntegrationConnection.findOne({ creatorId: c.user._id, provider: 'instagram' }).select('+encryptedCredentialReference').lean();
    expect(conn.status).toBe('connected');
    expect(conn.encryptedCredentialReference).toMatch(/^v1\./);
    expect(conn.encryptedCredentialReference).not.toContain(TOKEN);
    const status = (await c.get('/integrations')).body.instagram;
    expect(status).toMatchObject({ status: 'connected', username: 'vishnu_1345', connectedVia: 'token', lastError: null });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it('rejects a bad token and a personal (non-professional) account', async () => {
    const c = await signUp(ctx.app);
    setInstagramClientForTests(fakeInstagram().client);
    expect((await c.post('/integrations/instagram/token', { accessToken: 'IGAA-wrong-token-value-1234567', consent: true })).status).toBe(400);
    setInstagramClientForTests(fakeInstagram({ accountType: 'PERSONAL' }).client);
    expect((await c.post('/integrations/instagram/token', { accessToken: TOKEN, consent: true })).status).toBe(400);
    expect((await c.post('/integrations/instagram/token', { accessToken: TOKEN })).status).toBe(422);
  });

  it('renews tokens that are close to expiry', async () => {
    const { c, ig } = await connected();
    await IntegrationConnection.updateOne({ creatorId: c.user._id, provider: 'instagram' }, { $set: { 'instagram.tokenExpiresAt': new Date(Date.now() + 3 * 86_400_000), 'instagram.tokenRefreshedAt': new Date(Date.now() - 2 * 86_400_000) } });
    expect(await refreshInstagramTokens()).toMatchObject({ checked: 1, refreshed: 1 });
    expect(ig.calls.refresh).toBe(1);
  });
});

describe('Instagram inbox', () => {
  it('turns a brand DM into a deal, ignores fans without storing them, and replies inside the 24-hour window', async () => {
    const { c, ig } = await connected();
    const later = () => new Date(Date.now() + 1000);
    ig.dm('t-fan', { from: fanAcc, to: meAcc, text: 'Love your reels, you are my favourite!', at: later() });
    // A DM the creator sent to someone else, reported under the account's app-scoped id: never treated as a brand.
    ig.dm('t-own', { from: { id: 'app-scoped-1', username: 'vishnu_1345' }, to: fanAcc, text: 'Hey! We would love to collab on a paid reel, budget ₹5,000', at: later() });
    ig.dm('t-brand', { from: brandAcc, to: meAcc, text: "Hi! We're Glow Co. We'd love to collab on 1 Instagram reel for our new serum. Budget ₹20,000.", at: later() });

    const stats = await pollInstagramInbox(c.user._id, { now: new Date(Date.now() + 5000) });
    expect(stats).toMatchObject({ conversations: 3, ignored: 1, newDeals: 1, brandMessages: 1 });
    expect(await InstagramThread.countDocuments({ igConversationId: 't-own' })).toBe(0);
    expect((await c.get('/integrations')).body.instagram.lastConversationCount).toBe(3);
    // The fan: only a bare "ignored" marker, no message content or username stored.
    expect(await InstagramThread.findOne({ igConversationId: 't-fan' }).lean()).toMatchObject({ status: 'ignored', conversationId: null });
    expect(await Message.countDocuments({ content: /favourite/ })).toBe(0);

    const brand = await BrandProfile.findOne({ instagramHandle: 'glowco.in' }).lean();
    expect(brand.normalizedDomain).toBe('instagram:glowco.in');
    const convo = await Conversation.findOne({ brandId: brand._id }).lean();
    expect(convo).toMatchObject({ channel: 'instagram', externalThreadId: 't-brand' });
    expect(convo.participants.find((p) => p.side === 'brand')).toMatchObject({ instagramId: '9001', username: 'glowco.in' });
    expect(await Opportunity.countDocuments({ brandId: brand._id, creatorId: c.user._id })).toBe(1);

    // Same pipeline as email: the offer is analysed and a counter drafted for approval.
    await drainWorker();
    const deal = await Deal.findById(convo.dealId).lean();
    expect(deal.currentOffer.totalAmountMinor).toBe(2_000_000);
    const counter = await ApprovalRequest.findOne({ dealId: deal._id, actionType: 'send_counteroffer', status: 'pending' }).lean();
    expect(counter.proposedAction.channel).toBe('instagram');
    const draft = await Message.findById(counter.messageId).lean();
    expect(draft.subject).toBeNull();
    expect(draft.content).toContain(DM_DISCLOSURE);
    expect(Buffer.byteLength(draft.content)).toBeLessThanOrEqual(1000);
    expect((await c.get(`/conversations/${convo._id}`)).body.replyWindow.open).toBe(true);

    await approve(c, counter._id);
    await drainWorker();
    expect(ig.sent).toEqual([{ recipientId: '9001', text: draft.content }]);
    expect((await Message.findById(draft._id).lean()).deliveryStatus).toBe('sent');

    // A second check finds nothing new: nothing is imported twice.
    await pollInstagramInbox(c.user._id, { now: new Date(Date.now() + 10_000) });
    expect(await Message.countDocuments({ conversationId: convo._id, direction: 'inbound' })).toBe(1);
  });

  it('never sends after the 24-hour window, and never shows the DM as sent', async () => {
    const { c, ig } = await connected();
    ig.dm('t-brand', { from: brandAcc, to: meAcc, text: 'Hi, Glow Co here. Paid collab for 1 Instagram reel, budget ₹20,000?', at: new Date(Date.now() + 1000) });
    await pollInstagramInbox(c.user._id, { now: new Date(Date.now() + 5000) });
    await drainWorker();
    const counter = await ApprovalRequest.findOne({ actionType: 'send_counteroffer', status: 'pending' }).lean();
    await Conversation.updateOne({ _id: counter.conversationId }, { $set: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
    await approve(c, counter._id);
    await drainWorker();
    expect(ig.sent).toHaveLength(0);
    const msg = await Message.findById(counter.messageId).lean();
    expect(msg.deliveryStatus).toBe('failed');
    expect(msg.failureReason).toMatch(/24-hour/);
  });

  it('a DM pitch is sent by the creator, and the brand’s reply is picked up in the same deal', async () => {
    const { c, ig } = await connected();
    const brand = await BrandProfile.create({ normalizedDomain: 'snitch.co.in', name: 'SNITCH', instagramHandle: 'snitch.co.in', isDemo: false });
    const opp = await Opportunity.create({ creatorId: c.user._id, brandId: brand._id, dedupeKey: 'snitch-test', signalType: 'high_intent', verificationStatus: 'verified', firstDiscoveredAt: new Date(), status: 'new' });
    const drafted = (await c.post(`/opportunities/${opp._id}/instagram-pitch/draft`)).body;
    expect(Buffer.byteLength(drafted.body)).toBeLessThan(950);
    const started = await c.post(`/opportunities/${opp._id}/instagram-pitch`, { body: drafted.body });
    expect(started.status).toBe(201);
    expect(started.body.openUrl).toBe('https://ig.me/m/snitch.co.in');
    expect(ig.sent).toHaveLength(0); // apps cannot send a first DM
    await c.post(`/conversations/${started.body.conversationId}/instagram-pitch-sent`).expect(200);
    expect((await Deal.findById(started.body.dealId).lean()).negotiationState).toBe('awaiting_reply');

    const snitch = { id: '9100', username: 'snitch.co.in' };
    ig.dm('t-snitch', { from: meAcc, to: snitch, text: drafted.body, at: new Date(Date.now() + 1000) });
    ig.dm('t-snitch', { from: snitch, to: meAcc, text: 'Hey! Interested. What are your rates for a reel?', at: new Date(Date.now() + 2000) });
    const stats = await pollInstagramInbox(c.user._id, { now: new Date(Date.now() + 5000) });
    expect(stats.newDeals).toBe(0);
    const convo = await Conversation.findById(started.body.conversationId).lean();
    expect(convo.externalThreadId).toBe('t-snitch');
    expect(convo.participants.find((p) => p.side === 'brand').instagramId).toBe('9100');
    expect(await Deal.countDocuments({ creatorId: c.user._id })).toBe(1);
    expect(await Message.countDocuments({ conversationId: convo._id, direction: 'inbound' })).toBe(1);
    // The creator's own first DM, seen again in the inbox, is linked to the pitch rather than stored twice.
    expect(await Message.countDocuments({ conversationId: convo._id, direction: 'outbound' })).toBe(1);
    expect((await Message.findOne({ conversationId: convo._id, purpose: 'pitch' }).lean()).providerMessageId).toBeTruthy();
    expect(await ScheduledJob.countDocuments({ jobType: 'followup.check', 'payload.conversationId': String(convo._id), status: 'pending' })).toBe(0);
  });
});
