import { BrandContact, BrandProfile, Conversation, Deal, Opportunity, Message, Suppression } from '../models/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { recordAudit } from './audit.service.js';
import { visibleContacts } from './outreach.service.js';

const STALE_DAYS = 120;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function decorateFreshness(o) {
  const newest = (o.sourceEvidence || []).reduce((m, e) => Math.max(m, new Date(e.publishedAt || e.retrievedAt).getTime()), 0);
  const stale = newest > 0 && Date.now() - newest > STALE_DAYS * 86_400_000;
  return { ...o, evidenceStale: stale };
}

export async function listOpportunities(creatorId, q) {
  const filter = { creatorId };
  if (q.status === 'excluded') filter.excluded = true;
  else {
    filter.excluded = false;
    if (q.status === 'active') filter.status = { $in: ['new', 'saved', 'outreach_drafted', 'contacted', 'in_negotiation'] };
    else if (q.status !== 'all') filter.status = q.status;
  }
  if (q.signal) filter.signalType = q.signal;
  if (q.verification) filter.verificationStatus = q.verification;
  if (q.minScore !== undefined) filter.overallScore = { $gte: q.minScore };
  if (q.q) {
    const brands = await BrandProfile.find({ name: { $regex: escapeRegex(q.q), $options: 'i' } }, { _id: 1 }).limit(200).lean();
    filter.$or = [{ brandId: { $in: brands.map((b) => b._id) } }, { productOrCampaign: { $regex: escapeRegex(q.q), $options: 'i' } }];
  }
  const sort = q.sort === 'recent' ? { firstDiscoveredAt: -1 } : q.sort === 'timing' ? { timingScore: -1, overallScore: -1 } : { overallScore: -1, firstDiscoveredAt: -1 };
  const [items, total] = await Promise.all([
    Opportunity.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Opportunity.countDocuments(filter),
  ]);
  const brands = await BrandProfile.find({ _id: { $in: items.map((i) => i.brandId) } }, { name: 1, normalizedDomain: 1, industry: 1, categories: 1, isDemo: 1 }).lean();
  const byId = new Map(brands.map((b) => [String(b._id), b]));
  return {
    items: items.map((o) => ({ ...decorateFreshness(o), brand: byId.get(String(o.brandId)) || null, pitchDraft: undefined })),
    total,
    page: q.page,
    limit: q.limit,
  };
}

export async function getOpportunity(creatorId, id) {
  const o = await Opportunity.findOne({ _id: id, creatorId }).lean();
  if (!o) throw notFound('Opportunity');
  const [brand, contacts, deals] = await Promise.all([
    BrandProfile.findById(o.brandId).lean(),
    visibleContacts(creatorId, o.brandId),
    Deal.find({ creatorId, brandId: o.brandId }).sort({ createdAt: -1 }).lean(),
  ]);
  const conversations = await Conversation.find({ creatorId, dealId: { $in: deals.map((d) => d._id) } }, { subject: 1, status: 1, lastMessageAt: 1, dealId: 1 }).lean();
  const messageCounts = await Message.aggregate([
    { $match: { creatorId, conversationId: { $in: conversations.map((c) => c._id) } } },
    { $group: { _id: '$conversationId', n: { $sum: 1 } } },
  ]);
  const counts = new Map(messageCounts.map((m) => [String(m._id), m.n]));
  return {
    ...decorateFreshness(o),
    brand,
    contacts,
    outreachHistory: deals.map((d) => ({
      dealId: d._id,
      negotiationState: d.negotiationState,
      status: d.status,
      createdAt: d.createdAt,
      conversation: conversations.filter((c) => String(c.dealId) === String(d._id)).map((c) => ({ ...c, messageCount: counts.get(String(c._id)) || 0 }))[0] || null,
    })),
  };
}

async function setStatus(creatorId, id, update, eventType) {
  const o = await Opportunity.findOneAndUpdate({ _id: id, creatorId }, update, { returnDocument: 'after' }).lean();
  if (!o) throw notFound('Opportunity');
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType, resourceType: 'opportunity', resourceId: id });
  return o;
}

export function saveOpportunity(creatorId, id) {
  return setStatus(creatorId, id, { $set: { status: 'saved', savedAt: new Date() } }, 'opportunity.saved');
}
export function dismissOpportunity(creatorId, id) {
  return setStatus(creatorId, id, { $set: { status: 'dismissed', dismissedAt: new Date() } }, 'opportunity.dismissed');
}
export async function restoreOpportunity(creatorId, id) {
  const o = await Opportunity.findOne({ _id: id, creatorId });
  if (!o) throw notFound('Opportunity');
  if (o.status !== 'dismissed') throw conflict('Only dismissed opportunities can be restored');
  return setStatus(creatorId, id, { $set: { status: 'new' }, $unset: { dismissedAt: 1 } }, 'opportunity.restored');
}
export function opportunityFeedback(creatorId, id, { rating, note }) {
  return setStatus(creatorId, id, { $set: { feedback: { rating, note, at: new Date() } } }, 'opportunity.feedback');
}

/** Creator adds or corrects a contact. Stored privately for this creator. */
export async function addContact(creatorId, opportunityId, data) {
  const o = await Opportunity.findOne({ _id: opportunityId, creatorId }).lean();
  if (!o) throw notFound('Opportunity');
  const contact = await BrandContact.findOneAndUpdate(
    { brandId: o.brandId, businessEmail: data.businessEmail, ownerCreatorId: creatorId },
    { $set: { ...data, source: 'manual', verificationStatus: 'unverified', confidence: 0.6, lastVerifiedAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  await Opportunity.updateOne({ _id: o._id }, { $addToSet: { contactIds: contact._id }, $max: { contactConfidence: 0.6 } });
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'contact.added', resourceType: 'brand_contact', resourceId: contact._id });
  return contact.toObject();
}

export async function updateContact(creatorId, contactId, patch) {
  const contact = await BrandContact.findById(contactId);
  if (!contact) throw notFound('Contact');
  if (contact.ownerCreatorId && String(contact.ownerCreatorId) !== String(creatorId)) throw notFound('Contact');
  if (!contact.ownerCreatorId) {
    // Shared contacts are not edited by individual creators; a private copy holds corrections.
    if (patch.doNotContact !== undefined && Object.keys(patch).length === 1) {
      if (patch.doNotContact && contact.businessEmail) {
        await Suppression.updateOne({ email: contact.businessEmail, creatorId }, { $setOnInsert: { email: contact.businessEmail, creatorId, reason: 'manual' } }, { upsert: true });
      } else if (contact.businessEmail) {
        await Suppression.deleteOne({ email: contact.businessEmail, creatorId, reason: 'manual' });
      }
      await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'contact.do_not_contact', resourceType: 'brand_contact', resourceId: contact._id, metadata: { doNotContact: patch.doNotContact } });
      return { ...contact.toObject(), doNotContactForYou: patch.doNotContact };
    }
    const copy = await BrandContact.findOneAndUpdate(
      { brandId: contact.brandId, businessEmail: contact.businessEmail, ownerCreatorId: creatorId },
      { $set: { name: contact.name, role: contact.role, roleCategory: contact.roleCategory, sourceUrl: contact.sourceUrl, source: 'manual', verificationStatus: 'unverified', confidence: contact.confidence, ...patch } },
      { upsert: true, returnDocument: 'after' },
    );
    return copy.toObject();
  }
  Object.assign(contact, patch);
  await contact.save();
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'contact.updated', resourceType: 'brand_contact', resourceId: contact._id });
  return contact.toObject();
}
