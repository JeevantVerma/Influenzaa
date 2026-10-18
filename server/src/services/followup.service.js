import { BrandProfile, Conversation, CreatorProfile, Deal, Message, User } from '../models/index.js';
import { draftNegotiation } from './ai/index.js';
import { createDraft, proposeSend, suppressionFor } from './messaging.service.js';
import { recordAudit } from './audit.service.js';
import { cancelPendingJobs } from '../jobs/queue.js';
import { conflict, notFound } from '../lib/errors.js';

async function suppress(conversation, reason) {
  conversation.nextFollowUpAt = null;
  conversation.followUpSuppressedReason = reason;
  await conversation.save();
  await recordAudit({ actorType: 'worker', creatorId: conversation.creatorId, eventType: 'followup.suppressed', resourceType: 'conversation', resourceId: conversation._id, metadata: { reason } });
  return { suppressed: true, reason };
}

/** Job handler: decide whether a scheduled follow-up should be drafted/sent. */
export async function runFollowUpCheck({ conversationId, attempt }) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) return { skipped: true };
  const profile = await CreatorProfile.findOne({ userId: conversation.creatorId }).lean();
  const deal = conversation.dealId ? await Deal.findById(conversation.dealId) : null;
  const fu = profile?.automation?.followUps || {};

  if (conversation.status !== 'open') return suppress(conversation, 'conversation_closed');
  if (conversation.humanTakeover) return suppress(conversation, 'human_takeover');
  if (!fu.enabled) return suppress(conversation, 'follow_ups_disabled');
  if (conversation.followUpCount >= (fu.maxAttempts ?? 2)) return suppress(conversation, 'max_attempts_reached');
  if (conversation.lastInboundAt && (!conversation.lastOutboundAt || conversation.lastInboundAt >= conversation.lastOutboundAt)) {
    return suppress(conversation, 'reply_received');
  }
  if (!deal || deal.negotiationState !== 'awaiting_reply') return suppress(conversation, `deal_state_${deal?.negotiationState || 'missing'}`);
  const recipients = conversation.participants.filter((p) => p.side === 'brand' && p.email).map((p) => p.email);
  const suppressed = await suppressionFor(conversation.creatorId, recipients);
  if (suppressed) return suppress(conversation, 'recipient_suppressed');
  const pendingDraft = await Message.exists({ conversationId, purpose: 'follow_up', deliveryStatus: { $in: ['draft', 'queued', 'sending'] }, approvalStatus: { $in: ['pending', 'approved', 'auto_authorized'] } });
  if (pendingDraft) return { skipped: true, reason: 'follow_up_already_pending' };

  const [brand, user] = await Promise.all([BrandProfile.findById(conversation.brandId).lean(), User.findById(conversation.creatorId).lean()]);
  const creatorName = profile.publicName || user.name;
  const draft = await draftNegotiation({ kind: 'follow_up', creator: profile, brand, allowedAmountsMajor: [] });
  const message = await createDraft({ conversation, purpose: 'follow_up', subject: draft.data.subject, body: draft.data.body, creatorName, ai: draft, to: recipients });
  const { approval, autoAuthorized } = await proposeSend({
    creatorId: conversation.creatorId,
    conversation,
    deal,
    message,
    actionType: 'send_follow_up',
    contextSnapshot: { brandName: brand.name, attempt },
  });
  conversation.nextFollowUpAt = null;
  await conversation.save();
  return { drafted: true, approvalId: approval._id, autoAuthorized };
}

/** Creator cancels the scheduled follow-up for a conversation. */
export async function cancelFollowUp(creatorId, conversationId) {
  const conversation = await Conversation.findOne({ _id: conversationId, creatorId });
  if (!conversation) throw notFound('Conversation');
  const n = await cancelPendingJobs({ jobType: 'followup.check', 'payload.conversationId': String(conversation._id) }, 'cancelled_by_creator');
  if (!n && !conversation.nextFollowUpAt) throw conflict('No follow-up is scheduled');
  conversation.nextFollowUpAt = null;
  conversation.followUpSuppressedReason = 'cancelled_by_creator';
  await conversation.save();
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'followup.cancelled', resourceType: 'conversation', resourceId: conversation._id });
  return conversation;
}
