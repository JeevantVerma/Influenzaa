import { getConfig } from '../../config/env.js';
import { BrandProfile, Conversation, CreatorProfile, Deal, IntegrationConnection, Opportunity, ScheduledJob, User, WhatsAppContact, Message } from '../../models/index.js';
import { encryptSecret, randomToken } from '../../lib/crypto.js';
import { waHash, waKey } from './keys.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { enqueueJob } from '../../jobs/queue.js';
import { classifyInbound } from '../ai/index.js';
import { storeInboundMessage, queueInboundProcessing } from '../negotiation/negotiation.service.js';
import { recordAudit } from '../audit.service.js';
import { notify } from '../notification.service.js';
import { whatsappClient } from './client.js';
import { whatsappToken, whatsappWindow } from './send.js';

// WhatsApp through the official WhatsApp Business Cloud API.
// - A creator connects a WhatsApp Business number (development: Meta's free
//   test number) by pasting its phone number id and an access token.
// - Incoming messages arrive only by webhook (signed by the Meta app secret).
//   The webhook stores nothing but a job; the job decides brand or not:
//   brand messages become deals and run through the same negotiation as email;
//   anyone else is dropped and only a keyed hash of their number is kept.
// - Replies are allowed within 24 hours of the brand's last message. Messaging
//   a brand first needs a paid, pre-approved template plus their opt-in, so
//   CreatorOS never cold-messages on WhatsApp: brands reach the creator through
//   their WhatsApp link (bio, media kit, or "Continue on WhatsApp" in a deal).

export const WHATSAPP_CONSENT_TEXT =
  'I authorise CreatorOS to receive messages sent to this WhatsApp Business number to find brand collaborations, and to send the replies I approve (or that my automation settings allow) from it. Messages from people who are not brands are not stored. I can disconnect at any time.';

const digits = (phone) => String(phone || '').replace(/\D/g, '');

async function connection(creatorId) {
  return IntegrationConnection.findOne({ creatorId, provider: 'whatsapp' });
}

// ---- Connecting ------------------------------------------------------------

export async function connectWhatsAppWithToken(creatorId, { phoneNumberId, accessToken }) {
  const token = String(accessToken).trim();
  let phone;
  try {
    phone = await whatsappClient().phoneNumber(token, String(phoneNumberId).trim());
  } catch (err) {
    throw badRequest(err.authFailed ? 'WhatsApp rejected this access token. Generate a new one and try again.' : `Could not use this phone number: ${err.message}`);
  }
  const taken = await IntegrationConnection.findOne({ provider: 'whatsapp', status: 'connected', 'whatsapp.phoneNumberId': phone.phoneNumberId, creatorId: { $ne: creatorId } }, { _id: 1 }).lean();
  if (taken) throw conflict('This WhatsApp number is already connected to another CreatorOS account.');
  const existing = await connection(creatorId);
  const now = new Date();
  const sameNumber = existing?.whatsapp?.phoneNumberId === phone.phoneNumberId;
  await IntegrationConnection.updateOne(
    { creatorId, provider: 'whatsapp' },
    {
      $set: {
        status: 'connected', mode: 'live', scopes: ['whatsapp_business_messaging'],
        consent: { text: WHATSAPP_CONSENT_TEXT, acceptedAt: now },
        encryptedCredentialReference: encryptSecret(token, getConfig().authSecret),
        connectedAt: now, disconnectedAt: null, lastError: null,
        'whatsapp.phoneNumberId': phone.phoneNumberId,
        'whatsapp.displayPhoneNumber': phone.displayPhoneNumber,
        'whatsapp.verifiedName': phone.verifiedName,
        'whatsapp.qualityRating': phone.qualityRating,
        'whatsapp.connectedVia': 'token',
        ...(sameNumber && existing?.whatsapp?.importFrom ? {} : { 'whatsapp.importFrom': now }),
      },
    },
    { upsert: true },
  );
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'integration.whatsapp_connected', resourceType: 'integration' });
  return whatsappStatus(creatorId);
}

export async function disconnectWhatsApp(creatorId) {
  await IntegrationConnection.updateOne({ creatorId, provider: 'whatsapp' }, { $set: { status: 'disconnected', disconnectedAt: new Date(), encryptedCredentialReference: null } });
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'integration.whatsapp_disconnected', resourceType: 'integration' });
  return whatsappStatus(creatorId);
}

export async function whatsappStatus(creatorId) {
  const conn = await connection(creatorId);
  const cfg = getConfig().whatsapp;
  const wa = conn?.whatsapp || {};
  const connected = conn?.status === 'connected';
  return {
    status: connected ? 'connected' : 'disconnected',
    displayPhoneNumber: wa.displayPhoneNumber || null,
    verifiedName: wa.verifiedName || null,
    qualityRating: wa.qualityRating || null,
    lastWebhookAt: wa.lastWebhookAt || null,
    brandThreads: wa.brandThreads || 0,
    lastError: conn?.lastError?.message ? conn.lastError : null,
    // Server-level webhook settings (WHATSAPP_APP_SECRET + WHATSAPP_VERIFY_TOKEN).
    webhookConfigured: cfg.webhookConfigured,
    webhookPath: '/api/v1/webhooks/whatsapp',
    chatLink: connected && wa.displayPhoneNumber ? `https://wa.me/${digits(wa.displayPhoneNumber)}` : null,
    consentText: WHATSAPP_CONSENT_TEXT,
  };
}

// ---- Webhook ---------------------------------------------------------------------

/**
 * Handles a verified webhook body. Only queues work (fast 200 for Meta):
 * one `inbound.whatsapp_message` job per new message, idempotent on its id.
 * Delivery statuses update our sent messages (a "failed" status is never shown as sent).
 */
export async function handleWhatsAppWebhook(body, { now = new Date() } = {}) {
  let queued = 0;
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const v = change.value || {};
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const conn = await IntegrationConnection.findOne({ provider: 'whatsapp', status: 'connected', 'whatsapp.phoneNumberId': String(phoneNumberId) }, { creatorId: 1, whatsapp: 1 }).lean();
      if (!conn) continue;
      await IntegrationConnection.updateOne({ _id: conn._id }, { $set: { 'whatsapp.lastWebhookAt': now } });
      for (const m of v.messages || []) {
        const sentAt = m.timestamp ? new Date(Number(m.timestamp) * 1000) : now;
        if (conn.whatsapp?.importFrom && sentAt < new Date(conn.whatsapp.importFrom)) continue;
        const name = (v.contacts || []).find((c) => c.wa_id === m.from)?.profile?.name || null;
        const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.image?.caption || m.document?.caption || `(${m.type || 'message'})`;
        await enqueueJob({
          jobType: 'inbound.whatsapp_message', creatorId: conn.creatorId, idempotencyKey: `whatsapp:${m.id}`, maxAttempts: 3,
          payload: { creatorId: String(conn.creatorId), messageId: m.id, from: m.from, name, text: String(text).slice(0, 10_000), sentAt: sentAt.toISOString() },
        });
        queued++;
      }
      for (const s of v.statuses || []) {
        if (s.status !== 'failed') continue;
        const reason = s.errors?.[0]?.error_data?.details || s.errors?.[0]?.title || s.errors?.[0]?.message || 'WhatsApp could not deliver it';
        await Message.updateOne({ providerMessageId: s.id, providerName: 'whatsapp', creatorId: conn.creatorId }, { $set: { deliveryStatus: 'failed', failedAt: now, failureReason: `Not delivered: ${reason}` } });
      }
    }
  }
  return { queued };
}

// ---- Processing one message (job) -------------------------------------------------

/** Job handler: brand or not, then into the normal inbound pipeline. Non-brand content is removed from the job. */
export async function processWhatsAppMessage(job) {
  const { creatorId, messageId, from, name, text, sentAt } = job.payload;
  const forget = () => ScheduledJob.updateOne({ _id: job._id }, { $unset: { 'payload.text': 1, 'payload.name': 1, 'payload.from': 1 } });
  if (!(await whatsappToken(creatorId))) return { skipped: 'not_connected' };
  const hash = waHash(from);
  const receivedAt = sentAt ? new Date(sentAt) : new Date();
  let contact = await WhatsAppContact.findOne({ creatorId, waIdHash: hash });
  if (contact?.status === 'ignored') {
    await forget();
    return { ignored: true };
  }
  let classification;
  if (!contact) {
    // 1) A "Continue on WhatsApp" link: the message carries the deal's code.
    const ref = /\bref[:\s#-]*([A-Z0-9]{6,10})\b/i.exec(text)?.[1]?.toUpperCase();
    const moved = ref && (await moveDealToWhatsApp(creatorId, ref, { from, name, receivedAt }));
    if (moved) contact = moved;
    else {
      // 2) Otherwise the AI decides whether this is a brand writing about a collaboration.
      const cls = await classifyInbound({ text, subject: null });
      if (!cls?.data.business_inquiry) {
        await WhatsAppContact.create({ creatorId, waIdHash: hash, status: 'ignored', lastSeenAt: receivedAt });
        await forget();
        return { ignored: true };
      }
      classification = { intent: cls.data.intent, confidence: cls.data.confidence, provider: cls.provider };
      contact = await openInboundDeal(creatorId, { from, name, hash, receivedAt });
    }
  }
  if (!contact.conversationId) return { skipped: 'no_conversation' };
  const conversation = await Conversation.findById(contact.conversationId);
  if (!conversation) return { skipped: 'conversation_missing' };
  const received = await storeInboundMessage(conversation, {
    provider: 'whatsapp', externalMessageId: messageId, channel: 'whatsapp',
    fromAddress: waKey(from), toAddresses: [], subject: null, text, receivedAt, classification,
  });
  await queueInboundProcessing(received);
  await WhatsAppContact.updateOne({ _id: contact._id }, { $set: { lastSeenAt: receivedAt } });
  const brandThreads = await WhatsAppContact.countDocuments({ creatorId, status: 'brand' });
  await IntegrationConnection.updateOne({ creatorId, provider: 'whatsapp' }, { $set: { 'whatsapp.brandThreads': brandThreads } });
  return { stored: !received.duplicate, conversationId: conversation._id };
}

const brandParticipant = ({ from, name }) => ({ name: name || 'WhatsApp contact', waId: from, side: 'brand', role: 'WhatsApp' });

/** A brand wrote first: brand (no website, keyed by a hash of the number), opportunity, deal, conversation. */
async function openInboundDeal(creatorId, { from, name, hash, receivedAt }) {
  const key = `whatsapp:${hash.slice(0, 16)}`;
  const brand = await BrandProfile.findOneAndUpdate(
    { normalizedDomain: key },
    {
      $setOnInsert: {
        normalizedDomain: key, name: name || 'WhatsApp contact', markets: ['India'], isDemo: false,
        sourceEvidence: [{ title: 'Messaged you on WhatsApp', excerpt: null, retrievedAt: receivedAt, source: 'whatsapp', verification: 'verified', kind: 'fact' }],
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  const open = await Deal.findOne({ creatorId, brandId: brand._id, status: 'open' }, { _id: 1, conversationId: 1 }).lean();
  if (open) return WhatsAppContact.findOneAndUpdate({ creatorId, waIdHash: hash }, { $set: { status: 'brand', conversationId: open.conversationId } }, { upsert: true, returnDocument: 'after' });
  const [profile, user] = await Promise.all([CreatorProfile.findOne({ userId: creatorId }).lean(), User.findById(creatorId).lean()]);
  const opp = await Opportunity.findOneAndUpdate(
    { creatorId, dedupeKey: key },
    {
      $setOnInsert: { creatorId, dedupeKey: key, firstDiscoveredAt: receivedAt, lastMaterialChangeAt: receivedAt },
      $set: {
        brandId: brand._id, signalType: 'high_intent', signalSummary: `${brand.name} messaged you on WhatsApp about a collaboration`, status: 'in_negotiation',
        sourceEvidence: brand.sourceEvidence, rationale: [{ kind: 'fact', text: 'The brand contacted you directly on WhatsApp.' }],
        recommendedAction: 'continue_existing_conversation', overallScore: 95, fitScore: 90, timingScore: 100, verificationStatus: 'verified', excluded: false, isDemo: false,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  const deal = await Deal.create({
    creatorId, brandId: brand._id, opportunityId: opp._id, currency: profile?.commercialPolicy?.currency || 'INR',
    negotiationState: 'initial_outreach', stateHistory: [{ from: null, to: 'initial_outreach', at: receivedAt, actorType: 'brand', reason: 'Brand messaged on WhatsApp' }],
  });
  const conversation = await Conversation.create({
    creatorId, brandId: brand._id, opportunityId: opp._id, dealId: deal._id, channel: 'whatsapp', replyToken: randomToken(18),
    participants: [{ name: profile?.publicName || user?.name, side: 'creator', role: 'Creator' }, brandParticipant({ from, name })],
  });
  deal.conversationId = conversation._id;
  await deal.save();
  await recordAudit({ actorType: 'brand', creatorId, eventType: 'whatsapp.brand_thread_opened', resourceType: 'deal', resourceId: deal._id });
  return WhatsAppContact.findOneAndUpdate({ creatorId, waIdHash: hash }, { $set: { status: 'brand', conversationId: conversation._id } }, { upsert: true, returnDocument: 'after' });
}

/**
 * The brand opened the creator's "Continue on WhatsApp" link for an existing
 * deal: the deal continues on WhatsApp (same offers and history); the old
 * conversation is marked as moved.
 */
async function moveDealToWhatsApp(creatorId, ref, { from, name, receivedAt }) {
  const old = await Conversation.findOne({ creatorId, waRef: ref, status: 'open' });
  if (!old?.dealId) return null;
  const deal = await Deal.findById(old.dealId);
  if (!deal || deal.status !== 'open') return null;
  const brand = await BrandProfile.findById(old.brandId).lean();
  const conversation = await Conversation.create({
    creatorId, brandId: old.brandId, opportunityId: old.opportunityId, dealId: deal._id, channel: 'whatsapp', replyToken: randomToken(18),
    participants: [old.participants.find((p) => p.side === 'creator'), brandParticipant({ from, name: brand?.name || name })].filter(Boolean),
  });
  old.status = 'moved_offplatform';
  old.offPlatformChannel = 'whatsapp';
  await old.save();
  deal.conversationId = conversation._id;
  await deal.save();
  await notify(creatorId, { type: 'brand_replied', title: `${brand?.name || 'The brand'} moved to WhatsApp`, body: 'The deal continues on WhatsApp with the same offers and history.', link: `/inbox?conversation=${conversation._id}`, dedupeKey: `wa-move:${conversation._id}` });
  await recordAudit({ actorType: 'brand', creatorId, eventType: 'whatsapp.deal_moved', resourceType: 'deal', resourceId: deal._id });
  return WhatsAppContact.findOneAndUpdate({ creatorId, waIdHash: waHash(from) }, { $set: { status: 'brand', conversationId: conversation._id, lastSeenAt: receivedAt } }, { upsert: true, returnDocument: 'after' });
}

// ---- Creator's WhatsApp links --------------------------------------------------------

/** "Continue on WhatsApp" for an email or Instagram deal: a wa.me link carrying this deal's code. */
export async function whatsappLinkFor(creatorId, conversationId) {
  const auth = await whatsappToken(creatorId);
  if (!auth?.conn?.whatsapp?.displayPhoneNumber) throw conflict('Connect WhatsApp in Settings → Integrations first.');
  const conversation = await Conversation.findOne({ _id: conversationId, creatorId });
  if (!conversation) throw notFound('Conversation');
  if (conversation.channel === 'whatsapp') throw conflict('This conversation is already on WhatsApp.');
  if (conversation.status !== 'open' || !conversation.dealId) throw conflict('Only open deals can move to WhatsApp.');
  if (!conversation.waRef) {
    for (let i = 0; i < 5 && !conversation.waRef; i++) {
      const code = randomToken(6).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
      if (code.length >= 6 && !(await Conversation.exists({ waRef: code }))) conversation.waRef = code;
    }
    await conversation.save();
  }
  const url = `https://wa.me/${digits(auth.conn.whatsapp.displayPhoneNumber)}?text=${encodeURIComponent(`Hi! Continuing our collaboration chat here. Ref ${conversation.waRef}`)}`;
  return { url, ref: conversation.waRef, message: `Happy to continue on WhatsApp, just tap this link and send the message: ${url}` };
}

/** Reply deadline for WhatsApp conversations (shown on drafts). */
export function whatsappReplyWindow(conversation, now = new Date()) {
  return conversation?.channel === 'whatsapp' ? whatsappWindow(conversation, now) : null;
}
