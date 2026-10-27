import { getConfig } from '../../config/env.js';
import { BrandProfile, Conversation, CreatorProfile, Deal, InstagramThread, IntegrationConnection, Message, Opportunity, User } from '../../models/index.js';
import { encryptSecret, hmac, randomToken, safeEqual } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { normalizeInstagramHandle } from '../../lib/domain.js';
import { classifyInbound, draftPitch } from '../ai/index.js';
import { storeInboundMessage, queueInboundProcessing } from '../negotiation/negotiation.service.js';
import { tryTransition } from '../negotiation/stateMachine.js';
import { dmBytes, DM_MAX_BYTES, withDmDisclosure } from '../messaging.service.js';
import { recordAudit } from '../audit.service.js';
import { notify } from '../notification.service.js';
import { getLogger } from '../../lib/logger.js';
import { instagramClient } from './client.js';
import { instagramToken, instagramWindow } from './send.js';

// Instagram DMs through the official Instagram API with Instagram Login.
// - Creators connect their professional account (login, or a token from the
//   Meta app dashboard while the app is in development).
// - The inbox checker reads new DMs every minute. Brand messages become deals
//   and run through the same negotiation pipeline as email. Fans and friends
//   are ignored: only the thread id is kept, never their messages or names.
// - Instagram only allows replies within 24 hours of the brand's last DM, and
//   never a first message, so pitches by DM are sent by the creator themself.

const DAY = 86_400_000;
export const INSTAGRAM_CONSENT_TEXT =
  'I authorise CreatorOS to read new direct messages on my Instagram professional account to find brand collaborations, and to send the replies I approve (or that my automation settings allow) from that account. Messages from fans and friends are not stored. I can disconnect at any time.';

const brandKey = (username) => `instagram:${username}`;

async function connection(creatorId) {
  return IntegrationConnection.findOne({ creatorId, provider: 'instagram' });
}

// ---- Connecting ------------------------------------------------------------

/** Signed, short-lived state for the Instagram login redirect. */
export function loginState(creatorId, now = Date.now()) {
  const payload = `${creatorId}.${now}`;
  return `${payload}.${hmac(getConfig().authSecret, `instagram-login:${payload}`)}`;
}

function checkState(creatorId, state, now = Date.now()) {
  const [id, ts, sig] = String(state || '').split('.');
  if (id !== String(creatorId) || !sig || now - Number(ts) > 15 * 60_000) return false;
  return safeEqual(sig, hmac(getConfig().authSecret, `instagram-login:${id}.${ts}`));
}

export function instagramLoginUrl(creatorId) {
  if (!getConfig().instagram.loginConfigured) throw conflict('Instagram login is not set up on this server (INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI). Paste an access token instead.');
  return { url: instagramClient().authorizeUrl(loginState(creatorId)) };
}

export async function completeInstagramLogin(creatorId, { code, state }) {
  if (!checkState(creatorId, state)) throw badRequest('This Instagram login link expired or was not started here. Try connecting again.');
  const client = instagramClient();
  const t = await client.exchangeCode(code);
  if (!t.permissions.includes('instagram_business_manage_messages')) throw badRequest('Instagram did not grant permission to manage messages. Connect again and allow messages.');
  return saveConnection(creatorId, t.accessToken, { via: 'login', expiresIn: t.expiresIn });
}

/** Development path: a long-lived token generated for a tester account in the Meta app dashboard. */
export async function connectInstagramWithToken(creatorId, { accessToken }) {
  return saveConnection(creatorId, String(accessToken).trim(), { via: 'token', expiresIn: 60 * 24 * 3600 });
}

async function saveConnection(creatorId, token, { via, expiresIn }) {
  let me;
  try {
    me = await instagramClient().me(token);
  } catch (err) {
    throw badRequest(err.authFailed ? 'Instagram rejected this access token. Generate a new one and try again.' : `Could not reach Instagram: ${err.message}`);
  }
  if (me.accountType && !['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'].includes(String(me.accountType).toUpperCase())) {
    throw badRequest('Only Instagram professional accounts (Creator or Business) can be used for DMs. Switch the account type in the Instagram app first.');
  }
  const taken = await IntegrationConnection.findOne({ provider: 'instagram', status: 'connected', 'instagram.igUserId': me.igUserId, creatorId: { $ne: creatorId } }, { _id: 1 }).lean();
  if (taken) throw conflict('This Instagram account is already connected to another CreatorOS account.');
  // Message access for this app on the account. Without it Instagram may share no conversations;
  // a failure here doesn't block connecting, it is shown in Settings.
  let subscribeError = null;
  try {
    await instagramClient().subscribeToMessages(token, me.igUserId);
  } catch (err) {
    subscribeError = `Could not switch on message access for this app: ${err.message}`;
  }
  const existing = await connection(creatorId);
  const now = new Date();
  const sameAccount = existing?.instagram?.igUserId === me.igUserId;
  await IntegrationConnection.updateOne(
    { creatorId, provider: 'instagram' },
    {
      $set: {
        status: 'connected',
        mode: 'live',
        scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
        consent: { text: INSTAGRAM_CONSENT_TEXT, acceptedAt: now },
        encryptedCredentialReference: encryptSecret(token, getConfig().tokenKeys[0]),
        connectedAt: now,
        disconnectedAt: null,
        lastError: subscribeError ? { message: subscribeError, at: now } : null,
        'instagram.igUserId': me.igUserId,
        'instagram.appScopedId': me.appScopedId,
        'instagram.username': me.username,
        'instagram.accountType': me.accountType,
        'instagram.connectedVia': via,
        'instagram.tokenExpiresAt': new Date(now.getTime() + (expiresIn || 60 * 24 * 3600) * 1000),
        'instagram.tokenRefreshedAt': now,
        // DMs that arrived before connecting are never imported.
        ...(sameAccount && existing?.instagram?.importFrom ? {} : { 'instagram.importFrom': now }),
      },
    },
    { upsert: true },
  );
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'integration.instagram_connected', resourceType: 'integration', metadata: { via, username: me.username } });
  return instagramStatus(creatorId);
}

export async function disconnectInstagram(creatorId) {
  await IntegrationConnection.updateOne({ creatorId, provider: 'instagram' }, { $set: { status: 'disconnected', disconnectedAt: new Date(), encryptedCredentialReference: null } });
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'integration.instagram_disconnected', resourceType: 'integration' });
  return instagramStatus(creatorId);
}

export async function instagramStatus(creatorId) {
  const conn = await connection(creatorId);
  const cfg = getConfig().instagram;
  const ig = conn?.instagram || {};
  return {
    status: conn?.status === 'connected' ? 'connected' : conn?.status === 'degraded' ? 'degraded' : 'disconnected',
    username: ig.username || null,
    accountType: ig.accountType || null,
    connectedVia: ig.connectedVia || null,
    tokenExpiresAt: ig.tokenExpiresAt || null,
    lastPolledAt: ig.lastPolledAt || null,
    lastSuccessAt: ig.lastSuccessAt || null,
    lastError: conn?.lastError?.message ? conn.lastError : null,
    brandThreads: ig.brandThreads || 0,
    lastConversationCount: ig.lastConversationCount ?? null,
    loginAvailable: cfg.loginConfigured,
    checksInbox: cfg.pollDms,
    consentText: INSTAGRAM_CONSENT_TEXT,
  };
}

// ---- Token refresh (daily) -----------------------------------------------------

/** Long-lived tokens last ~60 days; refresh those expiring within 10 days. */
export async function refreshInstagramTokens({ now = new Date() } = {}) {
  const due = await IntegrationConnection.find({ provider: 'instagram', status: 'connected', 'instagram.tokenExpiresAt': { $lt: new Date(now.getTime() + 10 * DAY) }, 'instagram.tokenRefreshedAt': { $lt: new Date(now.getTime() - DAY) } }, { creatorId: 1 }).lean();
  let refreshed = 0;
  for (const { creatorId } of due) {
    try {
      const { token } = await instagramToken(creatorId);
      const r = await instagramClient().refreshToken(token);
      await IntegrationConnection.updateOne({ creatorId, provider: 'instagram' }, { $set: { encryptedCredentialReference: encryptSecret(r.accessToken, getConfig().tokenKeys[0]), 'instagram.tokenExpiresAt': new Date(now.getTime() + r.expiresIn * 1000), 'instagram.tokenRefreshedAt': now } });
      refreshed++;
    } catch (err) {
      await IntegrationConnection.updateOne({ creatorId, provider: 'instagram' }, { $set: { lastError: { message: `Could not renew the Instagram connection: ${err.message}. Reconnect in Settings.`, at: now } } });
    }
  }
  return { checked: due.length, refreshed };
}

// ---- Inbox checker -------------------------------------------------------------

export async function pollAllInstagramInboxes({ now = new Date() } = {}) {
  const conns = await IntegrationConnection.find({ provider: 'instagram', status: 'connected' }, { creatorId: 1 }).lean();
  const results = [];
  for (const { creatorId } of conns) {
    try {
      results.push(await pollInstagramInbox(creatorId, { now }));
    } catch (err) {
      getLogger().warn({ err: err.message }, 'Instagram inbox check failed');
    }
  }
  return { accounts: conns.length, results };
}

/** Reads new DMs for one creator. Brand messages are stored and processed; everything else is skipped unstored. */
export async function pollInstagramInbox(creatorId, { now = new Date() } = {}) {
  const auth = await instagramToken(creatorId);
  if (!auth) return { skipped: 'not_connected' };
  const { token, conn } = auth;
  const client = instagramClient();
  const ownIds = new Set([conn.instagram?.igUserId, conn.instagram?.appScopedId].filter(Boolean));
  const importFrom = conn.instagram?.importFrom ? new Date(conn.instagram.importFrom) : now;
  const stats = { threads: 0, brandMessages: 0, ignored: 0, newDeals: 0 };
  try {
    const conversations = await client.conversations(token);
    stats.conversations = conversations.length;
    for (const c of conversations) {
      if (c.updatedTime && c.updatedTime <= importFrom) continue;
      let thread = await InstagramThread.findOne({ creatorId, igConversationId: c.id });
      if (thread?.lastSeenAt && c.updatedTime && c.updatedTime <= thread.lastSeenAt) continue;
      stats.threads++;
      const since = new Date(Math.max(importFrom.getTime(), thread?.lastSeenAt ? new Date(thread.lastSeenAt).getTime() : 0));
      // Newest first from the API; only the latest 20 can be read in full.
      const ids = (await client.messageIds(token, c.id)).filter((m) => !m.createdTime || m.createdTime > since).slice(0, 20).reverse();
      let lastSeen = thread?.lastSeenAt || null;
      for (const ref of ids) {
        const m = await client.message(token, ref.id);
        lastSeen = m.createdTime && (!lastSeen || m.createdTime > lastSeen) ? m.createdTime : lastSeen;
        const own = ownIds.has(m.from.id) || (m.from.username && m.from.username === conn.instagram?.username);
        if (thread?.status === 'ignored') continue;
        if (!thread) {
          const counterpart = own ? m.to?.[0] : m.from;
          thread = await linkPendingPitch(creatorId, c.id, counterpart);
          if (!thread && own) continue; // a DM the creator sent to someone who is not (yet) a brand thread
          if (!thread) {
            const cls = await classifyInbound({ text: m.text, subject: null });
            if (!cls?.data.business_inquiry) {
              thread = await InstagramThread.create({ creatorId, igConversationId: c.id, status: 'ignored', lastSeenAt: m.createdTime || now });
              stats.ignored++;
              continue;
            }
            thread = await openInboundDeal(creatorId, c.id, m.from, now);
            stats.newDeals++;
            await storeDm(thread, m, { own: false, classification: { intent: cls.data.intent, confidence: cls.data.confidence, provider: cls.provider } });
            stats.brandMessages++;
            continue;
          }
        }
        if (!thread.conversationId) continue;
        await storeDm(thread, m, { own });
        if (!own) stats.brandMessages++;
      }
      if (thread && lastSeen) await InstagramThread.updateOne({ _id: thread._id }, { $set: { lastSeenAt: lastSeen } });
    }
    const brandThreads = await InstagramThread.countDocuments({ creatorId, status: 'brand' });
    await IntegrationConnection.updateOne({ creatorId, provider: 'instagram' }, { $set: { 'instagram.lastPolledAt': now, 'instagram.lastSuccessAt': now, 'instagram.brandThreads': brandThreads, 'instagram.lastConversationCount': stats.conversations, lastError: null } });
    return stats;
  } catch (err) {
    const message = err.authFailed ? 'Instagram rejected the saved access (expired or revoked). Reconnect in Settings → Integrations.' : `Could not check Instagram: ${err.message}`;
    await IntegrationConnection.updateOne({ creatorId, provider: 'instagram' }, { $set: { 'instagram.lastPolledAt': now, lastError: { message, at: now }, ...(err.authFailed ? { status: 'degraded' } : {}) } });
    throw err;
  }
}

/** A DM pitch the creator sent themself: the brand's thread is linked by its Instagram account (username → id). */
async function linkPendingPitch(creatorId, igConversationId, counterpart) {
  const username = normalizeInstagramHandle(counterpart?.username || '');
  if (!username) return null;
  const conversation = await Conversation.findOne({ creatorId, channel: 'instagram', externalThreadId: null, status: 'open', participants: { $elemMatch: { side: 'brand', username } } });
  if (!conversation) return null;
  conversation.externalThreadId = igConversationId;
  const brand = conversation.participants.find((p) => p.side === 'brand');
  if (counterpart.id) brand.instagramId = counterpart.id;
  await conversation.save();
  return InstagramThread.findOneAndUpdate(
    { creatorId, igConversationId },
    { $set: { status: 'brand', conversationId: conversation._id } },
    { upsert: true, returnDocument: 'after' },
  );
}

async function storeDm(thread, m, { own, classification }) {
  const conversation = await Conversation.findById(thread.conversationId);
  if (!conversation) return;
  const brand = conversation.participants.find((p) => p.side === 'brand');
  if (own) {
    // Sent from the Instagram app (or already stored when CreatorOS sent it).
    if (await Message.exists({ $or: [{ externalMessageId: `instagram:${m.id}` }, { providerMessageId: m.id }] })) return;
    // The DM pitch the creator pasted and sent themself: link it rather than storing it twice.
    const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const pitch = await Message.findOne({ conversationId: conversation._id, purpose: 'pitch', deliveryStatus: 'sent_by_creator', providerMessageId: { $in: [null, undefined] } });
    if (pitch && squash(m.text) && squash(pitch.content).startsWith(squash(m.text).slice(0, 60))) {
      pitch.providerMessageId = m.id;
      pitch.externalMessageId = `instagram:${m.id}`;
      await pitch.save();
      return;
    }
    await Message.create({
      conversationId: conversation._id, creatorId: conversation.creatorId, direction: 'outbound', channel: 'instagram', senderType: 'creator', purpose: 'reply',
      content: m.text || '(attachment)', toAddresses: [`@${brand?.username || ''}`], deliveryStatus: 'sent_by_creator', provenance: 'provider', providerName: 'instagram',
      providerMessageId: m.id, externalMessageId: `instagram:${m.id}`, sentAt: m.createdTime || new Date(),
    });
    await Conversation.updateOne({ _id: conversation._id }, { $set: { lastOutboundAt: m.createdTime || new Date(), lastMessageAt: m.createdTime || new Date() } });
    return;
  }
  if (brand && !brand.instagramId && m.from.id) {
    brand.instagramId = m.from.id;
    await conversation.save();
  }
  const received = await storeInboundMessage(conversation, {
    provider: 'instagram', externalMessageId: m.id, channel: 'instagram',
    fromAddress: `@${m.from.username || brand?.username || 'instagram'}`, toAddresses: [],
    subject: null, text: m.text || '(attachment)', receivedAt: m.createdTime || new Date(), classification,
  });
  await queueInboundProcessing(received);
}

/** A brand wrote first: brand (keyed by its handle), opportunity, deal and conversation. */
async function openInboundDeal(creatorId, igConversationId, from, now) {
  const username = normalizeInstagramHandle(from.username || '') || `user${from.id}`;
  const brand = (await BrandProfile.findOne({ instagramHandle: username })) || (await BrandProfile.findOneAndUpdate(
    { normalizedDomain: brandKey(username) },
    {
      $setOnInsert: {
        normalizedDomain: brandKey(username), name: username, instagramHandle: username, markets: ['India'], isDemo: false,
        sourceEvidence: [{ url: `https://www.instagram.com/${username}/`, title: 'Messaged you on Instagram', excerpt: null, retrievedAt: now, source: 'instagram_dm', verification: 'verified', kind: 'fact' }],
      },
    },
    { upsert: true, returnDocument: 'after' },
  ));
  const [profile, user] = await Promise.all([CreatorProfile.findOne({ userId: creatorId }).lean(), User.findById(creatorId).lean()]);
  const open = await Deal.findOne({ creatorId, brandId: brand._id, status: 'open' });
  if (open) {
    // Already talking to this brand (e.g. by email): keep one deal, and tell the creator.
    await notify(creatorId, { type: 'brand_replied', title: `${brand.name} also messaged you on Instagram`, body: 'You already have an open conversation with this brand, so the DM was not added to it. Reply from Instagram, or close the other conversation first.', link: `/negotiations/${open._id}`, dedupeKey: `ig-dup:${igConversationId}` });
    return InstagramThread.findOneAndUpdate({ creatorId, igConversationId }, { $set: { status: 'brand', conversationId: null } }, { upsert: true, returnDocument: 'after' });
  }
  const opp = await Opportunity.findOneAndUpdate(
    { creatorId, dedupeKey: `instagram-dm:${username}` },
    {
      $setOnInsert: { creatorId, dedupeKey: `instagram-dm:${username}`, firstDiscoveredAt: now, lastMaterialChangeAt: now },
      $set: {
        brandId: brand._id, signalType: 'high_intent', signalSummary: `${brand.name} messaged you on Instagram about a collaboration`, status: 'in_negotiation',
        sourceEvidence: brand.sourceEvidence, rationale: [{ kind: 'fact', text: 'The brand contacted you directly on Instagram.' }],
        recommendedAction: 'continue_existing_conversation', overallScore: 95, fitScore: 90, timingScore: 100, verificationStatus: 'verified', excluded: false, isDemo: false,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  const deal = await Deal.create({
    creatorId, brandId: brand._id, opportunityId: opp._id, currency: profile?.commercialPolicy?.currency || 'INR',
    negotiationState: 'initial_outreach', stateHistory: [{ from: null, to: 'initial_outreach', at: now, actorType: 'brand', reason: 'Brand messaged on Instagram' }],
  });
  const conversation = await Conversation.create({
    creatorId, brandId: brand._id, opportunityId: opp._id, dealId: deal._id, channel: 'instagram', externalThreadId: igConversationId, replyToken: randomToken(18),
    participants: [
      { name: profile?.publicName || user?.name, side: 'creator', role: 'Creator' },
      { name: brand.name, username, instagramId: from.id, side: 'brand', role: 'Instagram' },
    ],
  });
  deal.conversationId = conversation._id;
  await deal.save();
  await recordAudit({ actorType: 'brand', creatorId, eventType: 'instagram.brand_thread_opened', resourceType: 'deal', resourceId: deal._id, metadata: { username } });
  return InstagramThread.findOneAndUpdate({ creatorId, igConversationId }, { $set: { status: 'brand', conversationId: conversation._id } }, { upsert: true, returnDocument: 'after' });
}

// ---- Pitching by DM (the creator sends the first message) -------------------------

/** Short DM pitch draft for a brand with a known Instagram handle. */
export async function draftInstagramPitch(creatorId, opportunityId) {
  const opp = await Opportunity.findOne({ _id: opportunityId, creatorId }).lean();
  if (!opp) throw notFound('Opportunity');
  const brand = await BrandProfile.findById(opp.brandId).lean();
  if (!brand?.instagramHandle) throw conflict('This brand has no known Instagram account.');
  const profile = await CreatorProfile.findOne({ userId: creatorId }).lean();
  const r = await draftPitch({ creator: profile, brand, opportunity: opp, channel: 'instagram' });
  return { body: r.data.body, provider: r.provider, handle: brand.instagramHandle };
}

/**
 * Prepares a DM pitch: deal + Instagram conversation + the pitch text. Instagram
 * does not let apps send a first message, so the creator sends it from the app
 * (copy + open) and then marks it sent; the brand's reply is picked up automatically.
 */
export async function startInstagramPitch(creatorId, opportunityId, { body }) {
  const opp = await Opportunity.findOne({ _id: opportunityId, creatorId });
  if (!opp) throw notFound('Opportunity');
  if (opp.excluded) throw conflict('This opportunity is excluded by your brand policy');
  const brand = await BrandProfile.findById(opp.brandId).lean();
  const username = normalizeInstagramHandle(brand?.instagramHandle || '');
  if (!username) throw conflict('This brand has no known Instagram account.');
  if (!(await instagramToken(creatorId))) throw conflict('Connect Instagram in Settings → Integrations first, so the brand’s reply can be picked up.');
  if (dmBytes(withDmDisclosure(body)) > DM_MAX_BYTES) throw badRequest('Instagram messages are limited to 1000 bytes. Shorten the pitch.');
  const open = await Deal.findOne({ creatorId, brandId: brand._id, status: 'open' }).lean();
  if (open) throw conflict('You already have an open conversation with this brand', { dealId: open._id });
  const [profile, user] = await Promise.all([CreatorProfile.findOne({ userId: creatorId }).lean(), User.findById(creatorId).lean()]);
  let deal;
  try {
    deal = await Deal.create({
      creatorId, brandId: brand._id, opportunityId: opp._id, currency: profile?.commercialPolicy?.currency || 'INR',
      negotiationState: 'initial_outreach', stateHistory: [{ from: null, to: 'initial_outreach', at: new Date(), actorType: 'creator', reason: 'Instagram DM pitch prepared' }],
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    throw conflict('You already have an open conversation with this brand');
  }
  const conversation = await Conversation.create({
    creatorId, brandId: brand._id, opportunityId: opp._id, dealId: deal._id, channel: 'instagram', externalThreadId: null, replyToken: randomToken(18),
    participants: [
      { name: profile?.publicName || user?.name, side: 'creator', role: 'Creator' },
      { name: brand.name, username, side: 'brand', role: 'Instagram' },
    ],
  });
  deal.conversationId = conversation._id;
  await deal.save();
  const message = await Message.create({
    conversationId: conversation._id, creatorId, direction: 'outbound', channel: 'instagram', senderType: 'creator', purpose: 'pitch',
    content: withDmDisclosure(body), toAddresses: [`@${username}`], deliveryStatus: 'draft', approvalStatus: 'not_required', provenance: 'draft',
  });
  opp.status = 'outreach_drafted';
  await opp.save();
  return { dealId: deal._id, conversationId: conversation._id, messageId: message._id, text: message.content, openUrl: `https://ig.me/m/${username}` };
}

/** The creator says they sent the DM pitch from Instagram. */
export async function markInstagramPitchSent(creatorId, conversationId) {
  const conversation = await Conversation.findOne({ _id: conversationId, creatorId, channel: 'instagram' });
  if (!conversation) throw notFound('Conversation');
  const message = await Message.findOneAndUpdate(
    { conversationId, creatorId, purpose: 'pitch', deliveryStatus: 'draft' },
    { $set: { deliveryStatus: 'sent_by_creator', sentAt: new Date(), approvalStatus: 'not_required' } },
    { returnDocument: 'after' },
  );
  if (!message) throw conflict('There is no unsent DM pitch in this conversation.');
  conversation.lastOutboundAt = message.sentAt;
  conversation.lastMessageAt = message.sentAt;
  await conversation.save();
  const deal = await Deal.findById(conversation.dealId);
  if (deal) {
    tryTransition(deal, 'awaiting_reply', { actorType: 'creator', reason: 'Instagram DM pitch sent by the creator' });
    await deal.save();
    if (deal.opportunityId) await Opportunity.updateOne({ _id: deal.opportunityId, creatorId }, { $set: { status: 'contacted' } });
  }
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'instagram.pitch_sent_by_creator', resourceType: 'message', resourceId: message._id });
  return { ok: true };
}

/** Reply deadline shown on Instagram drafts. */
export function replyDeadline(conversation, now = new Date()) {
  return conversation?.channel === 'instagram' ? instagramWindow(conversation, now) : null;
}
