import { Router } from 'express';
import { z } from 'zod';
import { validate, idParam } from '../middleware/validate.js';
import * as S from '../validators/schemas.js';
import * as campaigns from '../services/campaign.service.js';
import { Campaign, Invoice, Notification, AuditEvent, BrandProfile, Deal } from '../models/index.js';
import { listIntegrations, connectEmail, disconnectEmail } from '../services/integrations.service.js';
import { exportCreatorData, deleteAccount } from '../services/account.service.js';
import { clearSessionCookies } from '../middleware/auth.js';
import { notFound } from '../lib/errors.js';
import * as instagram from '../services/instagram/instagram.service.js';
import * as whatsapp from '../services/whatsapp/whatsapp.service.js';
import { enqueueJob } from '../jobs/queue.js';
import { getConfig } from '../config/env.js';

const router = Router();
const me = (req) => req.user._id;

// ---- Campaigns -------------------------------------------------------------------
router.get('/campaigns', async (req, res) => {
  const items = await Campaign.find({ creatorId: me(req) }).sort({ updatedAt: -1 }).limit(200).lean();
  const brands = new Map((await BrandProfile.find({ _id: { $in: items.map((c) => c.brandId) } }, { name: 1, isDemo: 1 }).lean()).map((b) => [String(b._id), b]));
  const invoices = await Invoice.find({ creatorId: me(req), campaignId: { $in: items.map((c) => c._id) } }).lean();
  res.json({ items: items.map((c) => ({ ...c, brand: brands.get(String(c.brandId)), invoices: invoices.filter((i) => String(i.campaignId) === String(c._id)) })) });
});
router.get('/campaigns/:id', idParam(), async (req, res) => {
  const c = await Campaign.findOne({ _id: req.params.id, creatorId: me(req) }).lean();
  if (!c) throw notFound('Campaign');
  const [brand, invoices, deal] = await Promise.all([
    BrandProfile.findById(c.brandId, { name: 1, isDemo: 1 }).lean(),
    Invoice.find({ campaignId: c._id, creatorId: me(req) }).sort({ createdAt: 1 }).lean(),
    Deal.findById(c.dealId, { negotiationState: 1, conversationId: 1, acceptedTerms: 1 }).lean(),
  ]);
  res.json({ ...c, brand, invoices, deal });
});
router.post('/deals/:id/convert-to-campaign', idParam(), async (req, res) => res.status(201).json(await campaigns.convertDealToCampaign(me(req), req.params.id)));
router.patch('/campaigns/:id', idParam(), validate({ body: S.campaignPatchSchema }), async (req, res) => res.json(await campaigns.updateCampaign(me(req), req.params.id, req.body)));
router.post('/campaigns/:id/stage', idParam(), validate({ body: S.campaignStageSchema }), async (req, res) => res.json(await campaigns.updateStage(me(req), req.params.id, req.body.stage)));
router.post('/campaigns/:id/deliverables', idParam(), validate({ body: S.deliverableSchema }), async (req, res) => res.status(201).json(await campaigns.addDeliverable(me(req), req.params.id, req.body)));
router.patch('/campaigns/:id/deliverables/:deliverableId', idParam(), idParam('deliverableId'), validate({ body: S.deliverablePatchSchema }),
  async (req, res) => res.json(await campaigns.updateDeliverable(me(req), req.params.id, req.params.deliverableId, req.body)));
router.post('/campaigns/:id/summary', idParam(), async (req, res) => res.json(await campaigns.generateCompletionSummary(me(req), req.params.id)));

// ---- Invoices --------------------------------------------------------------------
router.get('/invoices', async (req, res) => res.json({ items: await Invoice.find({ creatorId: me(req) }).sort({ createdAt: -1 }).limit(200).lean() }));
router.post('/campaigns/:id/invoices', idParam(), validate({ body: S.invoiceCreateSchema }), async (req, res) => res.status(201).json(await campaigns.createInvoice(me(req), req.params.id, req.body)));
router.post('/invoices/:id/status', idParam(), validate({ body: S.invoiceStatusSchema }), async (req, res) => res.json(await campaigns.updateInvoiceStatus(me(req), req.params.id, req.body)));
router.post('/invoices/:id/reminder', idParam(), async (req, res) => res.status(201).json(await campaigns.draftPaymentReminder(me(req), req.params.id)));

// ---- Integrations ----------------------------------------------------------------
router.get('/integrations', async (req, res) => res.json(await listIntegrations(me(req))));
router.post('/integrations/email/connect', validate({ body: S.emailConnectSchema }), async (req, res) => res.json(await connectEmail(me(req), req.body)));
router.post('/integrations/email/disconnect', async (req, res) => res.json(await disconnectEmail(me(req))));
router.get('/integrations/instagram/login-url', async (req, res) => res.json(instagram.instagramLoginUrl(me(req))));
// Instagram redirects the browser here after login; the creator's session cookie identifies them.
router.get('/integrations/instagram/callback', validate({ query: z.object({ code: z.string().max(2000).optional(), state: z.string().max(500).optional(), error: z.string().max(200).optional(), error_description: z.string().max(500).optional() }).passthrough() }), async (req, res) => {
  const back = new URL('/settings', getConfig().frontendOrigins[0]);
  back.searchParams.set('tab', 'integrations');
  const q = req.validatedQuery;
  try {
    if (q.error || !q.code) throw new Error(q.error === 'access_denied' ? 'Instagram access was not granted.' : 'Instagram did not return a login code.');
    await instagram.completeInstagramLogin(me(req), { code: q.code, state: q.state });
    back.searchParams.set('instagram', 'connected');
  } catch (err) {
    back.searchParams.set('instagram', 'error');
    back.searchParams.set('message', String(err.message).slice(0, 200));
  }
  res.redirect(back.toString());
});
router.post('/integrations/instagram/token', validate({ body: S.instagramTokenSchema }), async (req, res) => res.json(await instagram.connectInstagramWithToken(me(req), req.body)));
router.post('/integrations/whatsapp/token', validate({ body: S.whatsappTokenSchema }), async (req, res) => res.json(await whatsapp.connectWhatsAppWithToken(me(req), req.body)));
router.post('/integrations/whatsapp/disconnect', async (req, res) => res.json(await whatsapp.disconnectWhatsApp(me(req))));
router.post('/integrations/instagram/disconnect', async (req, res) => res.json(await instagram.disconnectInstagram(me(req))));
router.post('/integrations/instagram/check-now', async (req, res) => {
  const { job } = await enqueueJob({ jobType: 'inbound.instagram_poll', creatorId: me(req), payload: { creatorId: String(me(req)) }, idempotencyKey: `inbound:instagram:${me(req)}:${Math.floor(Date.now() / 30_000)}`, maxAttempts: 1 });
  res.status(202).json({ queued: true, jobId: job?._id });
});

// ---- Notifications ---------------------------------------------------------------
router.get('/notifications', validate({ query: z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }) }), async (req, res) => {
  const filter = { creatorId: me(req) };
  if (req.validatedQuery.unread === 'true') filter.readAt = null;
  const [items, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(req.validatedQuery.limit).lean(),
    Notification.countDocuments({ creatorId: me(req), readAt: null }),
  ]);
  res.json({ items, unread });
});
router.post('/notifications/:id/read', idParam(), async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, creatorId: me(req) }, { $set: { readAt: new Date() } });
  res.status(204).end();
});
router.post('/notifications/read-all', async (req, res) => {
  await Notification.updateMany({ creatorId: me(req), readAt: null }, { $set: { readAt: new Date() } });
  res.status(204).end();
});

// ---- Audit -----------------------------------------------------------------------
router.get('/audit', validate({ query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50), resourceType: z.string().max(40).optional() }) }), async (req, res) => {
  const { page, limit, resourceType } = req.validatedQuery;
  const filter = { creatorId: me(req), ...(resourceType ? { resourceType } : {}) };
  const [items, total] = await Promise.all([AuditEvent.find(filter).sort({ timestamp: -1 }).skip((page - 1) * limit).limit(limit).lean(), AuditEvent.countDocuments(filter)]);
  res.json({ items, total, page, limit });
});

// ---- Privacy -----------------------------------------------------------------------
router.get('/settings/export', async (req, res) => {
  const data = await exportCreatorData(me(req));
  res.setHeader('Content-Disposition', `attachment; filename="creatoros-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});
router.delete('/settings/account', validate({ body: S.deleteAccountSchema }), async (req, res) => {
  await deleteAccount(me(req), req.body.password);
  clearSessionCookies(res);
  res.status(204).end();
});

export default router;
