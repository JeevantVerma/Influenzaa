import { describe, it, expect, beforeAll } from 'vitest';
import { useTestDatabase, clearCollectionsBeforeEach, signUp, onboard, drainWorker } from '../helpers.js';
import { BrandProfile, Conversation, Deal, MailboxCursor, Message, Opportunity, ScheduledJob } from '../../src/models/index.js';
import { getConfig, resetConfig, buildConfig } from '../../src/config/env.js';
import { pollImapInbox } from '../../src/services/email/imapInbox.js';
import { replyAddressFor, replyTokenFromAddresses, buildOutboundEnvelope, setEmailAdapterForTests } from '../../src/services/email/index.js';
import { emailChannelStatus } from '../../src/services/messaging.service.js';

const ctx = useTestDatabase();
clearCollectionsBeforeEach();

const REPLY_TEMPLATE = 'me+cos-{token}@gmail.com';
beforeAll(() => {
  Object.assign(process.env, { EMAIL_REPLY_TO_ADDRESS: REPLY_TEMPLATE, INBOUND_PROVIDER: 'imap', IMAP_HOST: 'imap.gmail.com', IMAP_USER: 'me@gmail.com', IMAP_PASS: 'app-password-for-tests' });
  resetConfig();
});

/** A fake IMAP mailbox: uid → raw RFC 822 message. Records how it was used. */
function fakeMailbox({ uidValidity = 7, messages = {}, failLogin = false } = {}) {
  const calls = { opened: [], downloaded: [] };
  const raw = (m) => [
    `Message-ID: ${m.id}`,
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${m.subject || 'Re: hi'}`,
    m.inReplyTo ? `In-Reply-To: ${m.inReplyTo}` : null,
    'Date: Mon, 19 Oct 2026 10:00:00 +0530',
    'Content-Type: text/plain; charset=utf-8',
    '',
    m.text || 'Hello',
  ].filter((l) => l !== null).join('\r\n');
  const client = {
    async connect() {
      if (failLogin) throw Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
    },
    async mailboxOpen(path, opts) {
      calls.opened.push({ path, opts });
      const uids = Object.keys(messages).map(Number);
      return { uidValidity, uidNext: (uids.length ? Math.max(...uids) : 0) + 1 };
    },
    async *fetch(range, query) {
      const from = Number(range.split(':')[0]);
      for (const uid of Object.keys(messages).map(Number).sort((a, b) => a - b)) {
        if (uid < from) continue;
        const m = messages[uid];
        yield { uid, envelope: query.envelope ? { to: [{ address: m.to.replace(/.*</, '').replace(/>.*/, '') }] } : undefined };
      }
    },
    async fetchOne(uid) {
      calls.downloaded.push(Number(uid));
      return { source: Buffer.from(raw(messages[uid])) };
    },
    async logout() {},
  };
  return { client, calls, add: (uid, m) => { messages[uid] = m; } };
}

async function conversationWithPitch() {
  const c = await signUp(ctx.app);
  await onboard(c);
  await c.post('/discovery/run-now').expect(202);
  await drainWorker();
  const brand = (await BrandProfile.findOne({ normalizedDomain: 'stridelab.example' }).lean()) || (await BrandProfile.findOne({ normalizedDomain: 'glowleaf.example' }).lean());
  const opp = await Opportunity.findOne({ creatorId: c.user._id, brandId: brand._id, excluded: false }).lean();
  const detail = (await c.get(`/opportunities/${opp._id}`)).body;
  const contact = detail.contacts.find((x) => x.businessEmail);
  const out = await c.post(`/opportunities/${opp._id}/initiate-outreach`, { contactId: contact._id, subject: 'Collab idea', body: 'Hi team, I would love to create launch content for your new range. Open to a chat?' });
  return { c, convo: await Conversation.findById(out.body.conversationId).lean(), dealId: out.body.dealId };
}

describe('reply addresses', () => {
  it('builds and recognises plus-address reply addresses, ignoring case', () => {
    const cfg = getConfig().email;
    expect(replyAddressFor('AbC_12345xyz', cfg)).toBe('me+cos-AbC_12345xyz@gmail.com');
    expect(replyTokenFromAddresses(['Brand <ME+COS-abc_12345xyz@gmail.com>'], cfg)).toBe('abc_12345xyz');
    expect(replyTokenFromAddresses(['me@gmail.com', 'other+cos-abc_12345xyz@gmail.com'], cfg)).toBeNull();
    expect(buildOutboundEnvelope({ creatorName: 'Priya', replyToken: 'AbC_12345xyz', to: ['b@brand.in'], subject: 's', text: 't' }).replyTo).toBe('me+cos-AbC_12345xyz@gmail.com');
  });

  it('rejects an IMAP setup that cannot match replies', () => {
    const base = { MONGODB_URI: 'mongodb://x/y', AUTH_SECRET: 'a'.repeat(40) };
    expect(() => buildConfig({ ...base, INBOUND_PROVIDER: 'imap', IMAP_HOST: 'imap.gmail.com', IMAP_USER: 'u', IMAP_PASS: 'p' })).toThrow(/EMAIL_REPLY_TO_ADDRESS/);
    expect(() => buildConfig({ ...base, EMAIL_REPLY_TO_ADDRESS: 'me+cos@gmail.com' })).toThrow(/\{token\}/);
  });
});

describe('IMAP inbox checker', () => {
  it('starts from now on first run, then imports only replies to conversation addresses, once', async () => {
    const { convo, dealId } = await conversationWithPitch();
    const box = fakeMailbox({ messages: { 10: { id: '<old@x>', from: 'friend@x.com', to: 'me@gmail.com', text: 'old mail' } } });

    const first = await pollImapInbox({ clientFactory: () => box.client });
    expect(first.initialised).toBe(true);
    expect(box.calls.opened[0]).toEqual({ path: 'INBOX', opts: { readOnly: true } });
    expect(box.calls.downloaded).toEqual([]);

    box.add(11, { id: '<newsletter@x>', from: 'news@x.com', to: 'me@gmail.com', text: 'not a reply' });
    box.add(12, { id: '<reply-1@stridelab.example>', from: 'partnerships@stridelab.example', to: `Me <${replyAddressFor(convo.replyToken)}>`, text: 'We can offer ₹35,000 for 1 Instagram reel, usage 30 days, net 30, 2 revisions.' });
    const second = await pollImapInbox({ clientFactory: () => box.client });
    expect(second).toMatchObject({ matched: 1, scanned: 2 });
    expect(box.calls.downloaded).toEqual([12]); // the newsletter was never downloaded

    const inbound = await Message.find({ conversationId: convo._id, direction: 'inbound' }).lean();
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({ externalMessageId: 'imap:<reply-1@stridelab.example>', fromAddress: 'partnerships@stridelab.example', provenance: 'provider' });
    expect(await ScheduledJob.countDocuments({ jobType: 'inbound.process' })).toBe(1);
    await drainWorker();
    expect((await Deal.findById(dealId).lean()).offerHistory.filter((o) => o.source === 'brand')).toHaveLength(1);

    // Nothing new: nothing downloaded or imported again.
    const third = await pollImapInbox({ clientFactory: () => box.client });
    expect(third).toMatchObject({ matched: 0 });
    expect(box.calls.downloaded).toEqual([12]);
    expect(await Message.countDocuments({ conversationId: convo._id, direction: 'inbound' })).toBe(1);
  });

  it('skips copies of mail the app sent itself', async () => {
    const { convo } = await conversationWithPitch();
    const box = fakeMailbox();
    await pollImapInbox({ clientFactory: () => box.client });
    await Message.updateOne({ conversationId: convo._id, direction: 'outbound' }, { $set: { providerMessageId: '<sent-by-us@gmail.com>' } });
    box.add(1, { id: '<sent-by-us@gmail.com>', from: 'me@gmail.com', to: replyAddressFor(convo.replyToken), text: 'copy of our own pitch' });
    expect((await pollImapInbox({ clientFactory: () => box.client })).matched).toBe(0);
    expect(await Message.countDocuments({ conversationId: convo._id, direction: 'inbound' })).toBe(0);
  });

  it('records a rejected login so Settings can show it', async () => {
    const box = fakeMailbox({ failLogin: true });
    await expect(pollImapInbox({ clientFactory: () => box.client })).rejects.toThrow(/app password/);
    const cursor = await MailboxCursor.findOne({}).lean();
    expect(cursor.lastError).toMatch(/app password/);
  });
});

describe('email consent', () => {
  it('consent given in demo mode does not authorise real sending', async () => {
    const c = await signUp(ctx.app);
    await c.post('/integrations/email/connect', { consent: true }).expect(200); // demo adapter in tests
    expect((await emailChannelStatus(c.user._id)).authorized).toBe(true);

    const live = { name: 'smtp', mode: 'live', async send() { throw new Error('must not send'); }, async status() { return { provider: 'smtp', mode: 'live', configured: true, healthy: true, detail: 'ok' }; } };
    setEmailAdapterForTests(live);
    try {
      expect((await emailChannelStatus(c.user._id)).authorized).toBe(false);
      expect((await c.get('/integrations')).body.email.status).toBe('disconnected');
      await c.post('/integrations/email/connect', { consent: true }).expect(200);
      expect((await emailChannelStatus(c.user._id)).authorized).toBe(true);
    } finally {
      setEmailAdapterForTests(null);
    }
  });
});
