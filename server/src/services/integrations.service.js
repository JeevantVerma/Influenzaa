import { IntegrationConnection, ScheduledJob } from '../models/index.js';
import { getEmailAdapter, replyAddressFor } from './email/index.js';
import { imapInboxStatus } from './email/imapInbox.js';
import { aiStatus } from './ai/index.js';
import { platformSources } from './discovery/sources/index.js';
import { workerHealth } from '../jobs/health.js';
import { getConfig } from '../config/env.js';
import { recordAudit } from './audit.service.js';
import { conflict } from '../lib/errors.js';
import { instagramStatus } from './instagram/instagram.service.js';

export const EMAIL_CONSENT_TEXT =
  'I authorise CreatorOS to send sponsorship emails on my behalf from the sending address shown here, showing my name, with replies routed back to CreatorOS. Messages disclose that they are AI-assisted. I can disconnect at any time.';

export async function listIntegrations(creatorId) {
  const [conns, emailStatus, worker, failedSends] = await Promise.all([
    IntegrationConnection.find({ creatorId }).lean(),
    getEmailAdapter().status(),
    workerHealth(),
    ScheduledJob.countDocuments({ creatorId, jobType: 'message.send', status: { $in: ['failed', 'dead'] }, updatedAt: { $gte: new Date(Date.now() - 7 * 86_400_000) } }),
  ]);
  const email = conns.find((c) => c.provider === 'email');
  const emailState = !emailStatus.configured
    ? 'unavailable'
    : !email || email.status === 'disconnected' || (emailStatus.mode === 'live' && email.status !== 'connected')
      ? 'disconnected'
      : emailStatus.mode === 'demo'
        ? 'demo'
        : emailStatus.healthy
          ? 'connected'
          : 'degraded';
  return {
    email: {
      status: emailState,
      platformProvider: emailStatus.provider,
      mode: emailStatus.mode,
      detail: emailStatus.detail,
      authorizedAt: email?.consent?.acceptedAt || null,
      senderDisplayName: email?.senderDisplayName || null,
      consentText: EMAIL_CONSENT_TEXT,
      fromAddress: getConfig().email.fromAddress,
      recentFailedSends: failedSends,
      inboundWebhookConfigured: !!getConfig().email.inboundWebhookSecret,
      inbound: await inboundStatus(),
    },
    instagram: await instagramStatus(creatorId),
    ai: aiStatus(),
    discoverySources: platformSources().map((s) => ({ id: s.id, label: s.label, isDemo: s.isDemo })),
    worker,
    whatsapp: {
      status: 'unavailable',
      detail: 'Planned. Requires an approved WhatsApp Business Platform account, message templates and opt-in. CreatorOS never accesses personal WhatsApp inboxes.',
    },
    demoFeaturesEnabled: getConfig().demo.enabled,
  };
}

async function inboundStatus() {
  const cfg = getConfig().email;
  const mode = cfg.inbound.provider;
  const replyExample = replyAddressFor('<conversation>', cfg);
  if (mode === 'imap') return { mode, replyExample, mailbox: cfg.inbound.imap.user, ...(await imapInboxStatus(cfg)) };
  return { mode, replyExample, webhookConfigured: !!cfg.inboundWebhookSecret };
}

export async function connectEmail(creatorId, { senderDisplayName }) {
  const status = await getEmailAdapter().status();
  if (!status.configured) throw conflict('Email sending is not configured on this server');
  const conn = await IntegrationConnection.findOneAndUpdate(
    { creatorId, provider: 'email' },
    {
      $set: {
        status: status.mode === 'demo' ? 'demo' : 'connected',
        mode: status.mode,
        scopes: ['send_on_behalf', 'receive_replies'],
        senderDisplayName,
        consent: { text: EMAIL_CONSENT_TEXT, acceptedAt: new Date() },
        connectedAt: new Date(),
        disconnectedAt: null,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'integration.email_authorized', resourceType: 'integration', resourceId: conn._id, metadata: { mode: status.mode } });
  return conn.toObject();
}

export async function disconnectEmail(creatorId) {
  const conn = await IntegrationConnection.findOneAndUpdate(
    { creatorId, provider: 'email' },
    { $set: { status: 'disconnected', disconnectedAt: new Date(), encryptedCredentialReference: null } },
    { returnDocument: 'after' },
  );
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'integration.email_disconnected', resourceType: 'integration', resourceId: conn?._id });
  return conn?.toObject() ?? null;
}
