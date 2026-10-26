import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getConfig } from '../../config/env.js';
import { getLogger } from '../../lib/logger.js';
import { Message, MailboxCursor } from '../../models/index.js';
import { replyTokenFromAddresses } from './index.js';
import { receiveInbound, queueInboundProcessing } from '../negotiation/negotiation.service.js';

// Reads brand replies from an IMAP inbox (e.g. a Gmail account with an app
// password). Only messages addressed to a conversation reply address (such as
// you+cos-<token>@gmail.com) are downloaded; everything else in the mailbox is
// ignored. The mailbox is opened read-only, so nothing is marked as read,
// moved or deleted. On first run the cursor starts at "now": older mail is
// never imported.

const MAX_PER_POLL = 50;

function defaultClient(imap) {
  return new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.secure,
    auth: { user: imap.user, pass: imap.pass },
    logger: false,
    socketTimeout: 60_000,
  });
}

const addresses = (list) => (list || []).map((a) => a?.address).filter(Boolean);
const parsedAddresses = (field) => (field ? (Array.isArray(field) ? field : [field]).flatMap((f) => (f.value || []).map((v) => v.address)).filter(Boolean) : []);

export async function pollImapInbox({ clientFactory = defaultClient, cfg = getConfig().email, now = new Date() } = {}) {
  const imap = cfg.inbound.imap;
  const key = `imap:${String(imap.user).toLowerCase()}:${imap.mailbox}`;
  const client = clientFactory(imap);
  try {
    await client.connect();
    const box = await client.mailboxOpen(imap.mailbox, { readOnly: true });
    const uidValidity = String(box.uidValidity);
    const cursor = await MailboxCursor.findOne({ key }).lean();

    if (!cursor || cursor.uidValidity !== uidValidity) {
      // First run (or the mailbox was renumbered): start from now.
      await MailboxCursor.updateOne({ key }, { $set: { uidValidity, lastUid: Math.max(0, box.uidNext - 1), lastPolledAt: now, lastSuccessAt: now, lastError: null } }, { upsert: true });
      return { initialised: true, matched: 0, scanned: 0 };
    }
    if (box.uidNext <= cursor.lastUid + 1) {
      await MailboxCursor.updateOne({ key }, { $set: { lastPolledAt: now, lastSuccessAt: now, lastError: null } });
      return { matched: 0, scanned: 0 };
    }

    // Pass 1: envelopes only (no message bodies), to find reply-address matches.
    const candidates = [];
    let maxUid = cursor.lastUid;
    let scanned = 0;
    for await (const msg of client.fetch(`${cursor.lastUid + 1}:*`, { uid: true, envelope: true }, { uid: true })) {
      if (msg.uid <= cursor.lastUid) continue; // "N:*" can return the last message when nothing is newer
      scanned++;
      maxUid = Math.max(maxUid, msg.uid);
      const recipients = [...addresses(msg.envelope?.to), ...addresses(msg.envelope?.cc), ...addresses(msg.envelope?.bcc)];
      if (replyTokenFromAddresses(recipients, cfg)) candidates.push(msg.uid);
      if (candidates.length >= MAX_PER_POLL) break;
    }

    // Pass 2: download and hand over only the matching messages.
    let matched = 0;
    let processedUpTo = cursor.lastUid;
    for (const uid of candidates) {
      const full = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
      const parsed = await simpleParser(full.source);
      const messageId = parsed.messageId || `imap-${uidValidity}-${uid}`;
      // A copy of something we sent ourselves is not a brand reply.
      if (!(await Message.exists({ direction: 'outbound', providerMessageId: messageId }))) {
        const received = await receiveInbound({
          provider: 'imap',
          externalMessageId: messageId,
          fromAddress: parsedAddresses(parsed.from)[0],
          toAddresses: [...parsedAddresses(parsed.to), ...parsedAddresses(parsed.cc)],
          subject: parsed.subject,
          text: parsed.text || String(parsed.html || '').replace(/<[^>]+>/g, ' '),
          inReplyTo: parsed.inReplyTo,
          references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [],
          receivedAt: parsed.date || now,
        });
        await queueInboundProcessing(received);
        if (received.messageId && !received.duplicate) matched++;
      }
      processedUpTo = uid;
    }
    // If we stopped early at MAX_PER_POLL, resume after the last handled match next time.
    const nextUid = candidates.length >= MAX_PER_POLL ? processedUpTo : maxUid;
    await MailboxCursor.updateOne({ key }, { $set: { lastUid: nextUid, lastPolledAt: now, lastSuccessAt: now, lastError: null }, $inc: { matchedTotal: matched } });
    return { matched, scanned };
  } catch (err) {
    const reason = err.authenticationFailed ? 'The mailbox rejected the login (check the app password)' : String(err.responseText || err.message || err).slice(0, 200);
    await MailboxCursor.updateOne({ key }, { $set: { lastPolledAt: now, lastError: reason } }, { upsert: true });
    getLogger().warn({ err: reason }, 'IMAP inbox check failed');
    throw Object.assign(new Error(reason), { retryable: false });
  } finally {
    await client.logout().catch(() => {});
  }
}

/** For the Integrations panel. */
export async function imapInboxStatus(cfg = getConfig().email) {
  const imap = cfg.inbound.imap;
  const c = await MailboxCursor.findOne({ key: `imap:${String(imap.user).toLowerCase()}:${imap.mailbox}` }).lean();
  return { lastPolledAt: c?.lastPolledAt || null, lastSuccessAt: c?.lastSuccessAt || null, lastError: c?.lastError || null, matchedTotal: c?.matchedTotal || 0 };
}
