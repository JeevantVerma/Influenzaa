import { ApprovalRequest, BrandProfile, Conversation, Deal, Message } from '../models/index.js';
import { notFound, conflict } from '../lib/errors.js';
import { cancelPendingJobs } from '../jobs/queue.js';
import { recordAudit } from './audit.service.js';

export async function listConversations(creatorId, { status, page = 1, limit = 30 }) {
  const filter = { creatorId };
  if (status && status !== 'all') filter.status = status;
  const [items, total] = await Promise.all([
    Conversation.find(filter).sort({ lastMessageAt: -1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Conversation.countDocuments(filter),
  ]);
  const [brands, deals, pending, lastMessages] = await Promise.all([
    BrandProfile.find({ _id: { $in: items.map((c) => c.brandId) } }, { name: 1, isDemo: 1 }).lean(),
    Deal.find({ _id: { $in: items.map((c) => c.dealId).filter(Boolean) } }, { negotiationState: 1, status: 1 }).lean(),
    ApprovalRequest.aggregate([{ $match: { creatorId, status: 'pending', conversationId: { $in: items.map((c) => c._id) } } }, { $group: { _id: '$conversationId', n: { $sum: 1 } } }]),
    Message.aggregate([
      { $match: { creatorId, conversationId: { $in: items.map((c) => c._id) } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationId', content: { $first: '$content' }, direction: { $first: '$direction' }, deliveryStatus: { $first: '$deliveryStatus' } } },
    ]),
  ]);
  const b = new Map(brands.map((x) => [String(x._id), x]));
  const d = new Map(deals.map((x) => [String(x._id), x]));
  const p = new Map(pending.map((x) => [String(x._id), x.n]));
  const l = new Map(lastMessages.map((x) => [String(x._id), x]));
  return {
    items: items.map((c) => ({
      ...c,
      brand: b.get(String(c.brandId)) || null,
      deal: d.get(String(c.dealId)) || null,
      pendingApprovals: p.get(String(c._id)) || 0,
      lastMessage: l.has(String(c._id)) ? { ...l.get(String(c._id)), content: l.get(String(c._id)).content.slice(0, 160) } : null,
    })),
    total,
    page,
    limit,
  };
}

async function load(creatorId, id) {
  const c = await Conversation.findOne({ _id: id, creatorId });
  if (!c) throw notFound('Conversation');
  return c;
}

export async function getConversation(creatorId, id) {
  const c = await load(creatorId, id);
  const [messages, brand, deal, approvals] = await Promise.all([
    Message.find({ conversationId: c._id, creatorId }).sort({ createdAt: 1 }).lean(),
    BrandProfile.findById(c.brandId, { name: 1, normalizedDomain: 1, isDemo: 1 }).lean(),
    c.dealId ? Deal.findById(c.dealId, { negotiationState: 1, status: 1, termsVersion: 1, analysis: 1 }).lean() : null,
    ApprovalRequest.find({ conversationId: c._id, creatorId, status: 'pending' }).lean(),
  ]);
  if (c.unreadInbound) {
    c.unreadInbound = 0;
    await c.save();
  }
  return { ...c.toObject(), messages, brand, deal, pendingApprovals: approvals };
}

export async function addNote(creatorId, id, content) {
  const c = await load(creatorId, id);
  const m = await Message.create({
    conversationId: c._id,
    creatorId,
    direction: 'note',
    channel: 'manual',
    senderType: 'creator',
    purpose: 'note',
    content,
    deliveryStatus: 'logged',
    provenance: 'manual_note',
  });
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'conversation.note_added', resourceType: 'conversation', resourceId: c._id });
  return m.toObject();
}

export async function setTakeover(creatorId, id, enabled) {
  const c = await load(creatorId, id);
  c.humanTakeover = enabled;
  if (enabled) {
    await cancelPendingJobs({ jobType: 'followup.check', 'payload.conversationId': String(c._id) }, 'human_takeover');
    c.nextFollowUpAt = null;
    c.followUpSuppressedReason = 'human_takeover';
  }
  await c.save();
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: enabled ? 'conversation.takeover' : 'conversation.handback', resourceType: 'conversation', resourceId: c._id });
  return c.toObject();
}

/** Records that the conversation continued on a channel CreatorOS cannot access. */
export async function markOffPlatform(creatorId, id, { channel, note }) {
  const c = await load(creatorId, id);
  if (c.status === 'closed') throw conflict('Conversation is closed');
  c.status = 'moved_offplatform';
  c.offPlatformChannel = channel;
  c.nextFollowUpAt = null;
  await c.save();
  await cancelPendingJobs({ jobType: 'followup.check', 'payload.conversationId': String(c._id) }, 'moved_offplatform');
  await addNote(creatorId, id, `Conversation moved to ${channel.replace('_', ' ')} (not visible to CreatorOS).${note ? ` Note: ${note}` : ''}`);
  return c.toObject();
}

export async function reopen(creatorId, id) {
  const c = await load(creatorId, id);
  c.status = 'open';
  await c.save();
  return c.toObject();
}
