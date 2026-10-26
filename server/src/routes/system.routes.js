import { Router } from 'express';
import express from 'express';
import { isDatabaseReady } from '../db/connect.js';
import { workerHealth, jobStats } from '../jobs/health.js';
import { getConfig } from '../config/env.js';
import { hmac, safeEqual } from '../lib/crypto.js';
import { receiveInbound, queueInboundProcessing } from '../services/negotiation/negotiation.service.js';
import { recordBounce } from '../services/messaging.service.js';
import { DevOutboxEmail } from '../services/email/index.js';
import { Message, DiscoveryConfiguration, User } from '../models/index.js';
import { recordAudit } from '../services/audit.service.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { aiStatus, aiUsageTotals } from '../services/ai/index.js';
import { z } from 'zod';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
healthRouter.get('/ready', async (_req, res) => {
  const db = isDatabaseReady();
  const worker = db ? await workerHealth().catch(() => ({ healthy: false })) : { healthy: false };
  res.status(db ? 200 : 503).json({ status: db ? 'ready' : 'not_ready', database: db ? 'connected' : 'disconnected', worker, ai: aiStatus().status, emailProvider: getConfig().email.provider });
});

// ---- Provider webhooks ----------------------------------------------------------------
export const webhookRouter = Router();

const inboundSchema = z.object({
  type: z.enum(['inbound', 'bounce']).default('inbound'),
  messageId: z.string().min(1).max(500),
  inReplyTo: z.string().max(500).optional(),
  references: z.array(z.string().max(500)).max(50).optional(),
  from: z.string().max(320).optional(),
  to: z.array(z.string().max(320)).max(20).default([]),
  subject: z.string().max(500).optional(),
  text: z.string().max(100_000).optional(),
  receivedAt: z.coerce.date().optional(),
  bounce: z.object({ originalMessageId: z.string().max(500), recipient: z.string().max(320), kind: z.enum(['hard', 'soft']) }).optional(),
});

/**
 * Verifies `X-CreatorOS-Signature: sha256=<hex>` = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 * with `X-CreatorOS-Timestamp` within five minutes (replay protection).
 */
function verifySignature(req) {
  const secret = getConfig().email.inboundWebhookSecret;
  if (!secret) return { ok: false, status: 503, message: 'Inbound webhook is not configured' };
  const ts = req.get('x-creatoros-timestamp');
  const sig = (req.get('x-creatoros-signature') || '').replace(/^sha256=/, '');
  if (!ts || !sig) return { ok: false, status: 401, message: 'Missing signature' };
  if (Math.abs(Date.now() - Number(ts) * 1000) > 5 * 60_000) return { ok: false, status: 401, message: 'Stale timestamp' };
  const expected = hmac(secret, `${ts}.${req.body.toString('utf8')}`);
  if (!safeEqual(expected, sig)) return { ok: false, status: 401, message: 'Invalid signature' };
  return { ok: true };
}

webhookRouter.post('/email', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const v = verifySignature(req);
  if (!v.ok) return res.status(v.status).json({ error: { code: 'invalid_signature', message: v.message } });
  let payload;
  try {
    payload = inboundSchema.parse(JSON.parse(req.body.toString('utf8')));
  } catch {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid payload' } });
  }
  if (payload.type === 'bounce' && payload.bounce) {
    const original = await Message.findOne({ providerMessageId: payload.bounce.originalMessageId }).lean();
    if (original && payload.bounce.kind === 'hard') {
      await recordBounce(original.creatorId, [payload.bounce.recipient], original._id);
      await Message.updateOne({ _id: original._id }, { $set: { deliveryStatus: 'failed', failureReason: 'Hard bounce reported by provider' } });
    }
    return res.json({ received: true });
  }
  const result = await receiveInbound({
    provider: 'email',
    externalMessageId: payload.messageId,
    fromAddress: payload.from,
    toAddresses: payload.to,
    subject: payload.subject,
    text: payload.text,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    receivedAt: payload.receivedAt || new Date(),
  });
  // AI and negotiation steps run in the worker so the provider gets a fast answer.
  await queueInboundProcessing(result);
  res.status(result.duplicate ? 200 : 202).json({ received: true, duplicate: !!result.duplicate, matched: result.matched !== false });
});

// ---- Development helpers -----------------------------------------------------------
export const devRouter = Router();
devRouter.get('/outbox', async (_req, res) => {
  if (getConfig().env !== 'development') return res.status(404).end();
  res.json({ notice: 'Development only: system emails recorded by the demo email adapter. Nothing here was delivered.', items: await DevOutboxEmail.find().sort({ createdAt: -1 }).limit(20).lean() });
});

// ---- Platform admin (operational metrics only) -----------------------------------
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));
adminRouter.get('/metrics', async (req, res) => {
  const [jobs, worker, discovery, creators] = await Promise.all([
    jobStats(),
    workerHealth(),
    DiscoveryConfiguration.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    User.countDocuments({ role: 'creator' }),
  ]);
  await recordAudit({ actorType: 'admin', actorId: req.user._id, eventType: 'admin.metrics_viewed', resourceType: 'platform' });
  res.json({ jobs, worker, discoveryStates: discovery.map((d) => ({ status: d._id, count: d.n })), creators, ai: aiStatus(), aiUsage: aiUsageTotals() });
});
