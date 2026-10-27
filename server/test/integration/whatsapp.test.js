import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { useTestDatabase, clearCollectionsBeforeEach, signUp, onboard, drainWorker } from '../helpers.js';
import { ApprovalRequest, BrandProfile, Conversation, Deal, IntegrationConnection, Message, Opportunity, ScheduledJob, WhatsAppContact } from '../../src/models/index.js';
import { resetConfig } from '../../src/config/env.js';
import { hmac } from '../../src/lib/crypto.js';
import { setWhatsAppClientForTests, WhatsAppError } from '../../src/services/whatsapp/client.js';
import { DM_DISCLOSURE } from '../../src/services/messaging.service.js';

const ctx = useTestDatabase();
clearCollectionsBeforeEach();
const SECRET = 'whatsapp-app-secret-for-tests';
const VERIFY = 'verify-me';
beforeAll(() => {
  Object.assign(process.env, { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY });
  resetConfig();
});
afterEach(() => setWhatsAppClientForTests(null));

const PHONE_ID = '123456789012345';
const TOKEN = 'EAAG-test-token-that-is-long-enough';

function fakeWhatsApp() {
  const sent = [];
  return {
    sent,
    client: {
      async phoneNumber(token, id) {
        if (token !== TOKEN) throw new WhatsAppError('Invalid OAuth access token', { status: 401, code: 190 });
        return { phoneNumberId: id, displayPhoneNumber: '+1 555 010 0000', verifiedName: 'Test Number', qualityRating: 'GREEN' };
      },
      async sendText(_t, _id, to, body) {
        sent.push({ to, body });
        return { messageId: `wamid.sent${sent.length}`, waId: to };
      },
    },
  };
}

async function connected() {
  const c = await signUp(ctx.app);
  await onboard(c);
  const wa = fakeWhatsApp();
  setWhatsAppClientForTests(wa.client);
  const res = await c.post('/integrations/whatsapp/token', { phoneNumberId: PHONE_ID, accessToken: TOKEN, consent: true });
  expect(res.status).toBe(200);
  return { c, wa };
}

let seq = 0;
/** Posts a signed webhook with one incoming text message. */
async function incoming({ from, name, text, at = new Date(Date.now() + 1000) }) {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { display_phone_number: '15550100000', phone_number_id: PHONE_ID },
      contacts: [{ profile: { name }, wa_id: from }],
      messages: [{ from, id: `wamid.in${++seq}`, timestamp: String(Math.floor(at.getTime() / 1000)), type: 'text', text: { body: text } }],
    } }] }],
  });
  const res = await request(ctx.app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${hmac(SECRET, body)}`).send(body);
  expect(res.status).toBe(200);
  await drainWorker();
  return res.body;
}

async function approve(c, approvalId) {
  const a = (await c.get(`/approvals/${approvalId}`)).body;
  return c.post(`/approvals/${approvalId}/approve`, { actionHash: a.actionHash });
}

describe('WhatsApp webhook', () => {
  it('answers Meta’s verification handshake and rejects unsigned or wrongly signed posts', async () => {
    const ok = await request(ctx.app).get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '12345' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('12345');
    expect((await request(ctx.app).get('/api/v1/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' })).status).toBe(403);
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    expect((await request(ctx.app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').send(body)).status).toBe(401);
    expect((await request(ctx.app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${hmac('wrong', body)}`).send(body)).status).toBe(401);
  });
});

describe('WhatsApp', () => {
  it('connects with an encrypted token and shows the number', async () => {
    const { c } = await connected();
    const conn = await IntegrationConnection.findOne({ provider: 'whatsapp' }).select('+encryptedCredentialReference').lean();
    expect(conn.encryptedCredentialReference).toMatch(/^v1\./);
    expect(conn.encryptedCredentialReference).not.toContain(TOKEN);
    const status = (await c.get('/integrations')).body.whatsapp;
    expect(status).toMatchObject({ status: 'connected', displayPhoneNumber: '+1 555 010 0000', webhookConfigured: true, chatLink: 'https://wa.me/15550100000' });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    setWhatsAppClientForTests(fakeWhatsApp().client);
    expect((await c.post('/integrations/whatsapp/token', { phoneNumberId: PHONE_ID, accessToken: 'EAAG-wrong-token-value-123456', consent: true })).status).toBe(400);
  });

  it('turns a brand message into a deal, drops personal chats unstored, and replies inside the 24-hour window', async () => {
    const { c, wa } = await connected();
    await incoming({ from: '919800000001', name: 'Ravi', text: 'Bhai kal cricket khelne chalega?' });
    expect(await Message.countDocuments({ content: /cricket/ })).toBe(0);
    expect(await WhatsAppContact.findOne({ status: 'ignored' }).lean()).toMatchObject({ conversationId: null });
    const leftovers = await ScheduledJob.find({ jobType: 'inbound.whatsapp_message' }).lean();
    expect(leftovers.every((j) => !j.payload.text || !/cricket/.test(j.payload.text))).toBe(true);
    expect(JSON.stringify(await WhatsAppContact.find({}).lean())).not.toContain('919800000001');

    await incoming({ from: '919800000002', name: 'Glow Co', text: "Hi! We're Glow Co, we'd love a paid collab: 1 Instagram reel, budget ₹20,000." });
    const convo = await Conversation.findOne({ channel: 'whatsapp' }).lean();
    expect(convo.participants.find((p) => p.side === 'brand')).toMatchObject({ name: 'Glow Co', waId: '919800000002' });
    const brand = await BrandProfile.findById(convo.brandId).lean();
    expect(brand.normalizedDomain).toMatch(/^whatsapp:/);
    expect(brand.normalizedDomain).not.toContain('9198');
    const deal = await Deal.findById(convo.dealId).lean();
    expect(deal.currentOffer.totalAmountMinor).toBe(2_000_000);
    expect(await Opportunity.countDocuments({ brandId: brand._id })).toBe(1);

    const counter = await ApprovalRequest.findOne({ dealId: deal._id, actionType: 'send_counteroffer', status: 'pending' }).lean();
    expect(counter.proposedAction.channel).toBe('whatsapp');
    const draft = await Message.findById(counter.messageId).lean();
    expect(draft.subject).toBeNull();
    expect(draft.content).toContain(DM_DISCLOSURE);
    expect((await c.get(`/conversations/${convo._id}`)).body.replyWindow.open).toBe(true);
    await approve(c, counter._id);
    await drainWorker();
    expect(wa.sent).toEqual([{ to: '919800000002', body: draft.content }]);
    expect((await Message.findById(draft._id).lean()).deliveryStatus).toBe('sent');

    // A "failed" delivery status from WhatsApp is shown as not delivered, never as sent.
    const statusBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: 'wamid.sent1', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] }] } }] }] });
    await request(ctx.app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', `sha256=${hmac(SECRET, statusBody)}`).send(statusBody).expect(200);
    expect((await Message.findById(draft._id).lean())).toMatchObject({ deliveryStatus: 'failed', failureReason: 'Not delivered: Message undeliverable' });
  });

  it('never sends after the 24-hour window', async () => {
    const { c, wa } = await connected();
    await incoming({ from: '919800000003', name: 'Peak Co', text: 'Hello, paid collab for 1 Instagram reel? Budget ₹20,000.' });
    const counter = await ApprovalRequest.findOne({ actionType: 'send_counteroffer', status: 'pending' }).lean();
    await Conversation.updateOne({ _id: counter.conversationId }, { $set: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) } });
    await approve(c, counter._id);
    await drainWorker();
    expect(wa.sent).toHaveLength(0);
    expect((await Message.findById(counter.messageId).lean())).toMatchObject({ deliveryStatus: 'failed' });
    expect((await Message.findById(counter.messageId).lean()).failureReason).toMatch(/24-hour/);
  });

  it('“Continue on WhatsApp” moves an existing deal when the brand messages with its code', async () => {
    const { c } = await connected();
    const brand = await BrandProfile.create({ normalizedDomain: 'snitch.co.in', name: 'SNITCH', isDemo: false });
    const opp = await Opportunity.create({ creatorId: c.user._id, brandId: brand._id, dedupeKey: 'snitch', signalType: 'high_intent', verificationStatus: 'verified', firstDiscoveredAt: new Date(), status: 'new' });
    const contact = (await c.post(`/opportunities/${opp._id}/contacts`, { businessEmail: 'collabs@snitch.co.in', name: 'Collabs' })).body;
    const started = (await c.post(`/opportunities/${opp._id}/initiate-outreach`, { contactId: contact._id, subject: 'Collab', body: 'Hi SNITCH team, I would love to create a reel for your new drop. Open to a chat?' })).body;
    const link = (await c.post(`/conversations/${started.conversationId}/whatsapp-link`)).body;
    expect(link.url).toContain('https://wa.me/15550100000?text=');
    expect(link.ref).toMatch(/^[A-Z0-9]{6,8}$/);

    await incoming({ from: '919800000004', name: 'Aman (SNITCH)', text: `Hi! Continuing our collaboration chat here. Ref ${link.ref}` });
    const deal = await Deal.findById(started.dealId).lean();
    const moved = await Conversation.findById(deal.conversationId).lean();
    expect(moved.channel).toBe('whatsapp');
    expect(moved.participants.find((p) => p.side === 'brand')).toMatchObject({ name: 'SNITCH', waId: '919800000004' });
    expect((await Conversation.findById(started.conversationId).lean())).toMatchObject({ status: 'moved_offplatform', offPlatformChannel: 'whatsapp' });
    expect(await Deal.countDocuments({ creatorId: c.user._id })).toBe(1);
    expect(await Message.countDocuments({ conversationId: moved._id, direction: 'inbound' })).toBe(1);
  });
});
