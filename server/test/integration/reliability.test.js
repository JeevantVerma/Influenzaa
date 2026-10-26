import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { useTestDatabase, clearCollectionsBeforeEach, signUp, onboard, drainWorker, TEST_ENV } from '../helpers.js';
import { ApprovalRequest, BrandProfile, Conversation, Deal, Message, Notification, Opportunity, ScheduledJob } from '../../src/models/index.js';
import { processInboundMessage } from '../../src/services/negotiation/negotiation.service.js';
import { hmac } from '../../src/lib/crypto.js';

const ctx = useTestDatabase();
clearCollectionsBeforeEach();

const OFFER_TEXT = 'Our budget is ₹35,000 for one Instagram reel, usage 30 days, net 30, 2 revisions.';

/** Discovery → a contactable opportunity with a drafted pitch. */
async function preparePitch(c) {
  await c.post('/discovery/run-now').expect(202);
  await drainWorker();
  const brand = await BrandProfile.findOne({ normalizedDomain: 'stridelab.example' }).lean()
    || await BrandProfile.findOne({ normalizedDomain: 'glowleaf.example' }).lean();
  const opp = await Opportunity.findOne({ creatorId: c.user._id, brandId: brand._id, excluded: false }).lean();
  const detail = (await c.get(`/opportunities/${opp._id}`)).body;
  const pitch = (await c.post(`/opportunities/${opp._id}/draft-pitch`)).body;
  const contact = detail.contacts.find((x) => x.businessEmail);
  return { opp, body: { contactId: contact._id, subject: pitch.subject, body: pitch.body } };
}

/** Pitch sent (simulated) so the conversation is waiting for the brand's reply. */
async function pitchSent(c) {
  const { opp, body } = await preparePitch(c);
  const out = await c.post(`/opportunities/${opp._id}/initiate-outreach`, body);
  expect(out.status).toBe(201);
  const a = (await c.get(`/approvals/${out.body.approvalId}`)).body;
  expect((await c.post(`/approvals/${out.body.approvalId}/approve`, { actionHash: a.actionHash })).status).toBe(200);
  await drainWorker();
  const convo = await Conversation.findById(out.body.conversationId).lean();
  return { ...out.body, convo };
}

function webhook(fields) {
  const payload = JSON.stringify(fields);
  const ts = Math.floor(Date.now() / 1000);
  return request(ctx.app)
    .post('/api/v1/webhooks/email')
    .set('content-type', 'application/json')
    .set('x-creatoros-timestamp', String(ts))
    .set('x-creatoros-signature', `sha256=${hmac(TEST_ENV.INBOUND_WEBHOOK_SECRET, `${ts}.${payload}`)}`)
    .send(payload);
}

const offerReply = (convo, id = '<offer-1@brand.example>') => ({ messageId: id, from: 'someone@brand.example', to: [`reply+${convo.replyToken}@creatoros.test`], subject: 'Re: hi', text: OFFER_TEXT });
const brandOffers = (deal) => deal.offerHistory.filter((o) => o.source === 'brand');

describe('inbound email processing runs in the worker', () => {
  it('the webhook only stores the reply; the job classifies it and records the offer', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    const { convo, dealId } = await pitchSent(c);
    const versionBefore = (await Deal.findById(dealId).lean()).termsVersion;

    const res = await webhook(offerReply(convo));
    expect(res.status).toBe(202);
    const stored = await Message.findOne({ conversationId: convo._id, direction: 'inbound' }).lean();
    expect(stored.inboundProcessing.status).toBe('pending');
    expect(stored.classification?.intent).toBeUndefined();
    expect((await Deal.findById(dealId).lean()).termsVersion).toBe(versionBefore);
    expect((await Conversation.findById(convo._id).lean()).unreadInbound).toBe(1);
    expect(await ScheduledJob.countDocuments({ jobType: 'inbound.process', status: 'pending' })).toBe(1);

    await drainWorker();
    const processed = await Message.findById(stored._id).lean();
    expect(processed.inboundProcessing.status).toBe('done');
    expect(processed.classification.intent).toBe('offer');
    const deal = await Deal.findById(dealId).lean();
    expect(deal.termsVersion).toBe(versionBefore + 1);
    expect(brandOffers(deal)).toHaveLength(1);
  });

  it('a provider retry re-queues a reply that was stored but never queued', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    const { convo, dealId } = await pitchSent(c);
    expect((await webhook(offerReply(convo))).status).toBe(202);
    // Simulate a crash between storing the message and queueing the job.
    await ScheduledJob.deleteMany({ jobType: 'inbound.process' });

    const retry = await webhook(offerReply(convo));
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    expect(await ScheduledJob.countDocuments({ jobType: 'inbound.process', status: 'pending' })).toBe(1);
    await drainWorker();
    expect((await Message.findOne({ conversationId: convo._id, direction: 'inbound' }).lean()).inboundProcessing.status).toBe('done');
    expect(brandOffers(await Deal.findById(dealId).lean())).toHaveLength(1);
  });

  it('retrying a failed run does not record the same offer twice', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    const { convo, dealId } = await pitchSent(c);
    await webhook(offerReply(convo));
    await drainWorker();
    const versionAfterFirst = (await Deal.findById(dealId).lean()).termsVersion;
    const msg = await Message.findOne({ conversationId: convo._id, direction: 'inbound' }).lean();

    await Message.updateOne({ _id: msg._id }, { $set: { 'inboundProcessing.status': 'failed' } });
    await processInboundMessage(msg._id);
    const deal = await Deal.findById(dealId).lean();
    expect(brandOffers(deal)).toHaveLength(1);
    expect(deal.termsVersion).toBe(versionAfterFirst);
  });

  it('an interrupted run is handed to the creator instead of being re-run', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    const { convo, dealId } = await pitchSent(c);
    await webhook(offerReply(convo));
    const msg = await Message.findOne({ conversationId: convo._id, direction: 'inbound' }).lean();
    // As if a worker claimed it and died part-way.
    await Message.updateOne({ _id: msg._id }, { $set: { 'inboundProcessing.status': 'processing' } });

    await drainWorker();
    expect((await Message.findById(msg._id).lean()).inboundProcessing.status).toBe('interrupted');
    const deal = await Deal.findById(dealId).lean();
    expect(deal.negotiationState).toBe('awaiting_creator_decision');
    expect(brandOffers(deal)).toHaveLength(0);
    expect(await Notification.countDocuments({ creatorId: c.user._id, type: 'inbound_needs_review' })).toBe(1);
  });
});

describe('outreach and approval races', () => {
  it('two simultaneous outreach requests to the same brand open only one deal', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    const { opp, body } = await preparePitch(c);
    const results = await Promise.all([
      c.post(`/opportunities/${opp._id}/initiate-outreach`, body),
      c.post(`/opportunities/${opp._id}/initiate-outreach`, body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Deal.countDocuments({ creatorId: c.user._id, brandId: opp.brandId, status: 'open' })).toBe(1);
    expect(await Conversation.countDocuments({ creatorId: c.user._id, brandId: opp.brandId })).toBe(1);
  });

  it('approving an acceptance whose message is no longer a draft leaves the deal untouched', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    const { convo, dealId } = await pitchSent(c);
    await webhook(offerReply(convo));
    await drainWorker();
    // The low offer produced a pending counteroffer; decline it to accept instead.
    const counter = await ApprovalRequest.findOne({ dealId, actionType: 'send_counteroffer', status: 'pending' }).lean();
    if (counter) expect((await c.post(`/approvals/${counter._id}/reject`, { note: 'Accepting instead' })).status).toBe(200);
    const before = await Deal.findById(dealId).lean();

    const acc =await c.post(`/deals/${dealId}/accept`, { termsVersion: before.termsVersion });
    expect(acc.status).toBe(201);
    const approval = await ApprovalRequest.findById(acc.body.approvalId).lean();
    await Message.updateOne({ _id: approval.messageId }, { $set: { deliveryStatus: 'cancelled' } });

    const a = (await c.get(`/approvals/${approval._id}`)).body;
    const res = await c.post(`/approvals/${approval._id}/approve`, { actionHash: a.actionHash, confirm: true });
    expect(res.status).toBe(409);
    const after = await Deal.findById(dealId).lean();
    expect(after.negotiationState).not.toBe('terms_agreed_subject_to_formalization');
    expect(after.acceptedTerms ?? null).toBeNull();
    expect((await ApprovalRequest.findById(approval._id).lean()).status).toBe('failed');
  });
});
