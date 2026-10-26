import crypto from 'node:crypto';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import { getConfig } from '../../config/env.js';
import { getLogger } from '../../lib/logger.js';

export class EmailSendError extends Error {
  constructor(message, { retryable = true, permanentBounce = false } = {}) {
    super(message);
    this.name = 'EmailSendError';
    this.retryable = retryable;
    this.permanentBounce = permanentBounce;
  }
}

function newMessageId(domain) {
  return `<${crypto.randomUUID()}@${domain}>`;
}

function domainOf(address) {
  return String(address).split('@')[1] || 'creatoros.local';
}

// ---- Demo adapter --------------------------------------------------------------
// Records the message as "simulated". Nothing is delivered to anyone, and the
// UI labels these messages accordingly.
const demoAdapter = {
  name: 'demo',
  mode: 'demo',
  async send(msg) {
    return { status: 'simulated', provider: 'demo', providerMessageId: msg.messageId || newMessageId('demo.creatoros.local') };
  },
  async status() {
    return { provider: 'demo', mode: 'demo', configured: true, healthy: true, detail: 'Demo mode: messages are recorded but never delivered.' };
  },
};

// ---- SMTP adapter ----------------------------------------------------------------
function createSmtpAdapter(cfg) {
  const transport = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  let lastVerify = { at: 0, ok: false, detail: 'Not verified yet' };
  return {
    name: 'smtp',
    mode: 'live',
    async send(msg) {
      try {
        const info = await transport.sendMail({
          from: msg.from,
          to: msg.to,
          replyTo: msg.replyTo,
          subject: msg.subject,
          text: msg.text,
          messageId: msg.messageId,
          inReplyTo: msg.inReplyTo,
          references: msg.references,
          headers: msg.headers,
        });
        if (info.rejected?.length && !info.accepted?.length) {
          throw new EmailSendError('All recipients were rejected by the SMTP server', { retryable: false, permanentBounce: true });
        }
        return { status: 'sent', provider: 'smtp', providerMessageId: info.messageId || msg.messageId };
      } catch (err) {
        if (err instanceof EmailSendError) throw err;
        const code = Number(err.responseCode);
        const permanent = code >= 500 && code < 600;
        throw new EmailSendError(`SMTP send failed: ${err.code || code || 'error'}`, { retryable: !permanent, permanentBounce: permanent && code >= 550 });
      }
    },
    async status() {
      if (Date.now() - lastVerify.at > 10 * 60_000) {
        try {
          await transport.verify();
          lastVerify = { at: Date.now(), ok: true, detail: 'SMTP connection verified' };
        } catch (err) {
          lastVerify = { at: Date.now(), ok: false, detail: `SMTP verification failed: ${err.code || 'error'}` };
        }
      }
      return { provider: 'smtp', mode: 'live', configured: true, healthy: lastVerify.ok, detail: lastVerify.detail };
    },
  };
}

const disabledAdapter = {
  name: 'disabled',
  mode: null,
  async send() {
    throw new EmailSendError('No email provider is configured; nothing was sent.', { retryable: false });
  },
  async status() {
    return { provider: 'disabled', mode: null, configured: false, healthy: false, detail: 'Email sending is disabled (EMAIL_PROVIDER=disabled).' };
  },
};

let adapter;
let override;

export function getEmailAdapter() {
  if (override) return override;
  if (!adapter) {
    const cfg = getConfig().email;
    adapter = cfg.provider === 'smtp' ? createSmtpAdapter(cfg) : cfg.provider === 'demo' ? demoAdapter : disabledAdapter;
  }
  return adapter;
}

/** Test hook: replace the adapter (e.g. with a failing one). */
export function setEmailAdapterForTests(a) {
  override = a;
}

/** The reply address for one conversation. */
export function replyAddressFor(token, cfg = getConfig().email) {
  if (cfg.replyToAddress) return cfg.replyToAddress.replace('{token}', token);
  return `reply+${token}@${cfg.replyToDomain || domainOf(cfg.fromAddress)}`;
}

/** Pulls a conversation token out of recipient addresses (reply+TOKEN@… or the configured template). */
export function replyTokenFromAddresses(addresses, cfg = getConfig().email) {
  const patterns = [/reply\+([A-Za-z0-9_-]{10,64})@/i];
  if (cfg.replyToAddress) {
    const [before, after] = cfg.replyToAddress.split('{token}');
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patterns.unshift(new RegExp(`${esc(before)}([A-Za-z0-9_-]{10,64})${esc(after)}`, 'i'));
  }
  for (const a of addresses || []) {
    for (const re of patterns) {
      const m = re.exec(String(a));
      if (m) return m[1];
    }
  }
  return null;
}

export function buildOutboundEnvelope({ creatorName, replyToken, to, subject, text, inReplyTo, references }) {
  const cfg = getConfig().email;
  // Truthful sender identity: the platform address, sending on the creator's
  // behalf, with replies routed back to this specific conversation.
  return {
    from: `"${creatorName.replace(/"/g, '')} via ${cfg.fromName}" <${cfg.fromAddress}>`,
    replyTo: replyAddressFor(replyToken, cfg),
    to,
    subject,
    text,
    messageId: newMessageId(domainOf(cfg.fromAddress)),
    inReplyTo,
    references,
    headers: { 'X-CreatorOS-Conversation': replyToken },
  };
}

// ---- System email (password reset etc.) ------------------------------------------
const devOutboxSchema = new mongoose.Schema(
  { to: String, subject: String, text: String, purpose: String, userId: mongoose.Schema.Types.ObjectId, createdAt: { type: Date, default: Date.now } },
  { versionKey: false },
);
devOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
export const DevOutboxEmail = mongoose.models.DevOutboxEmail || mongoose.model('DevOutboxEmail', devOutboxSchema, 'dev_outbox');

export async function sendSystemEmail({ to, subject, text, purpose, userId }) {
  const a = getEmailAdapter();
  const cfg = getConfig();
  if (a.mode === 'demo') {
    // Development only: stored in a local outbox (viewable at GET /api/v1/dev/outbox
    // when NODE_ENV=development). Never logged, never delivered.
    await DevOutboxEmail.create({ to, subject, text, purpose, userId });
    return { status: 'simulated' };
  }
  try {
    return await a.send({ from: `"${cfg.email.fromName}" <${cfg.email.fromAddress}>`, to, subject, text, messageId: newMessageId(domainOf(cfg.email.fromAddress)) });
  } catch (err) {
    getLogger().error({ err: err.message, purpose }, 'System email failed');
    return { status: 'failed' };
  }
}
