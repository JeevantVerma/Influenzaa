import { Router } from 'express';
import { validate, idParam } from '../middleware/validate.js';
import * as S from '../validators/schemas.js';
import * as convo from '../services/conversation.service.js';
import * as neg from '../services/negotiation/negotiation.service.js';
import * as approvals from '../services/approvals/approval.service.js';
import { cancelFollowUp } from '../services/followup.service.js';
import { Conversation, Deal, Message } from '../models/index.js';
import { getConfig } from '../config/env.js';
import { forbidden, notFound } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';
import { z } from 'zod';

const router = Router();
const me = (req) => req.user._id;

// ---- Conversations & messages -----------------------------------------------------
router.get('/conversations', validate({ query: z.object({ status: z.enum(['open', 'closed', 'moved_offplatform', 'all']).default('all'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(30) }) }),
  async (req, res) => res.json(await convo.listConversations(me(req), req.validatedQuery)));
router.get('/conversations/:id', idParam(), async (req, res) => res.json(await convo.getConversation(me(req), req.params.id)));
router.get('/conversations/:id/messages', idParam(), async (req, res) => {
  const c = await Conversation.exists({ _id: req.params.id, creatorId: me(req) });
  if (!c) throw notFound('Conversation');
  res.json({ items: await Message.find({ conversationId: req.params.id, creatorId: me(req) }).sort({ createdAt: 1 }).lean() });
});
router.post('/conversations/:id/draft-response', idParam(), validate({ body: S.draftResponseSchema }), async (req, res) => res.status(201).json(await neg.draftResponse(me(req), req.params.id, req.body)));
router.post('/conversations/:id/send-message', idParam(), validate({ body: S.sendMessageSchema }), async (req, res) => res.status(202).json(await neg.sendCreatorMessage(me(req), req.params.id, req.body)));
router.post('/conversations/:id/notes', idParam(), validate({ body: S.noteSchema }), async (req, res) => res.status(201).json(await convo.addNote(me(req), req.params.id, req.body.content)));
router.post('/conversations/:id/takeover', idParam(), validate({ body: S.takeoverSchema }), async (req, res) => res.json(await convo.setTakeover(me(req), req.params.id, req.body.enabled)));
router.post('/conversations/:id/off-platform', idParam(), validate({ body: S.offPlatformSchema }), async (req, res) => res.json(await convo.markOffPlatform(me(req), req.params.id, req.body)));
router.post('/conversations/:id/reopen', idParam(), async (req, res) => res.json(await convo.reopen(me(req), req.params.id)));
router.post('/conversations/:id/cancel-follow-up', idParam(), async (req, res) => res.json(await cancelFollowUp(me(req), req.params.id)));

// Demo only: inject a clearly-labelled simulated brand reply through the real
// inbound pipeline (matching, dedupe, classification, negotiation).
router.post('/conversations/:id/simulate-inbound', idParam(), validate({ body: S.simulateInboundSchema }), async (req, res) => {
  if (!getConfig().demo.enabled) throw forbidden('Simulation is disabled on this server');
  const c = await Conversation.findOne({ _id: req.params.id, creatorId: me(req) }).lean();
  if (!c) throw notFound('Conversation');
  const brand = c.participants.find((p) => p.side === 'brand');
  const lastOut = await Message.findOne({ conversationId: c._id, direction: 'outbound', providerMessageId: { $ne: null } }).sort({ createdAt: -1 }).lean();
  const result = await neg.processInbound({
    provider: 'simulated',
    externalMessageId: `sim-${randomToken(12)}`,
    fromAddress: brand?.email,
    toAddresses: [`reply+${c.replyToken}@simulated.local`],
    subject: req.body.subject || `Re: ${c.subject || ''}`,
    text: req.body.text,
    inReplyTo: lastOut?.providerMessageId,
    simulated: true,
  });
  res.status(201).json(result);
});

// ---- Deals / negotiations -------------------------------------------------------
router.get('/negotiations', async (req, res) => {
  const deals = await Deal.find({ creatorId: me(req) }).sort({ updatedAt: -1 }).limit(100).populate('brandId', 'name isDemo').lean();
  res.json({ items: deals.map((d) => ({ ...d, brand: d.brandId, brandId: d.brandId?._id })) });
});
router.get('/negotiations/:id', idParam(), async (req, res) => res.json(await neg.getNegotiation(me(req), req.params.id)));
router.post('/deals/:id/analyze-offer', idParam(), async (req, res) => {
  const { deal, evaluation } = await neg.analyzeDeal(me(req), req.params.id);
  res.json({ analysis: deal.analysis, questions: evaluation.questions, negotiationState: deal.negotiationState });
});
router.post('/deals/:id/generate-counteroffer', idParam(), async (req, res) => res.status(201).json(await neg.generateCounteroffer(me(req), req.params.id)));
router.post('/deals/:id/offers', idParam(), validate({ body: S.manualOfferSchema }), async (req, res) => {
  const { deal } = await neg.recordManualOffer(me(req), req.params.id, { currency: 'INR', deliverables: [], ...req.body.terms });
  res.status(201).json({ termsVersion: deal.termsVersion, analysis: deal.analysis });
});
router.post('/deals/:id/accept', idParam(), validate({ body: S.acceptSchema }), async (req, res) => res.status(201).json(await neg.requestAcceptance(me(req), req.params.id, req.body)));
router.post('/deals/:id/decline', idParam(), validate({ body: S.declineSchema }), async (req, res) => res.status(201).json(await neg.requestDecline(me(req), req.params.id, req.body)));
router.post('/deals/:id/mark-agreement-pending', idParam(), async (req, res) => res.json(await neg.markAgreementPending(me(req), req.params.id)));
router.post('/deals/:id/confirm-agreement', idParam(), validate({ body: S.confirmAgreementSchema }), async (req, res) => res.json(await neg.confirmAgreement(me(req), req.params.id, req.body)));
router.post('/deals/:id/close', idParam(), validate({ body: S.closeDealSchema }), async (req, res) => res.json(await neg.closeDeal(me(req), req.params.id, req.body)));

// ---- Approvals -------------------------------------------------------------------
router.get('/approvals', validate({ query: z.object({ status: z.enum(['pending', 'history', 'all']).default('pending'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }) }),
  async (req, res) => res.json(await approvals.listApprovals(me(req), req.validatedQuery)));
router.get('/approvals/:id', idParam(), async (req, res) => res.json(await approvals.getApproval(me(req), req.params.id)));
router.post('/approvals/:id/approve', idParam(), validate({ body: S.approveSchema }), async (req, res) => res.json(await approvals.approve(me(req), req.params.id, req.body, me(req))));
router.post('/approvals/:id/reject', idParam(), validate({ body: S.rejectSchema }), async (req, res) => res.json(await approvals.reject(me(req), req.params.id, req.body, me(req))));
router.post('/approvals/:id/edit', idParam(), validate({ body: S.editApprovalSchema }), async (req, res) => res.json(await approvals.edit(me(req), req.params.id, req.body, me(req))));
router.post('/approvals/:id/revoke', idParam(), async (req, res) => res.json(await approvals.revoke(me(req), req.params.id, me(req))));

export default router;
