import { BrandContact, BrandProfile, Conversation, CreatorProfile, Deal, Opportunity, Suppression, User } from '../models/index.js';
import { conflict, notFound, badRequest } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';
import { draftPitch } from './ai/index.js';
import { createDraft, proposeSend, suppressionFor } from './messaging.service.js';
import { recordAudit } from './audit.service.js';

async function loadOpportunity(creatorId, id) {
  const opp = await Opportunity.findOne({ _id: id, creatorId });
  if (!opp) throw notFound('Opportunity');
  return opp;
}

/** Contacts visible to a creator, with creator-specific suppression folded into doNotContact. */
export async function visibleContacts(creatorId, brandId) {
  const contacts = await BrandContact.find({ brandId, $or: [{ ownerCreatorId: null }, { ownerCreatorId: creatorId }] }).sort({ confidence: -1 }).lean();
  const emails = contacts.map((c) => c.businessEmail).filter(Boolean);
  const suppressed = new Map((await Suppression.find({ email: { $in: emails }, $or: [{ creatorId: null }, { creatorId }] }).lean()).map((s) => [s.email, s.reason]));
  return contacts.map((c) => (suppressed.has(c.businessEmail) ? { ...c, doNotContact: true, suppressionReason: suppressed.get(c.businessEmail) } : c));
}

/** Generates (and stores) a recommended pitch for an opportunity. Nothing is sent. */
export async function generatePitch(creatorId, opportunityId) {
  const opp = await loadOpportunity(creatorId, opportunityId);
  if (opp.excluded) throw conflict('This opportunity is excluded by your brand policy');
  const [profile, brand] = await Promise.all([CreatorProfile.findOne({ userId: creatorId }).lean(), BrandProfile.findById(opp.brandId).lean()]);
  const result = await draftPitch({ creator: profile, brand, opportunity: opp.toObject() });
  const contacts = await visibleContacts(creatorId, opp.brandId);
  const best = contacts.find((c) => !c.doNotContact && c.businessEmail);
  opp.pitchDraft = { subject: result.data.subject, body: result.data.body, provider: result.provider, model: result.model, contactId: best?._id, at: new Date() };
  if (opp.status === 'new' || opp.status === 'saved') opp.status = 'outreach_drafted';
  await opp.save();
  await recordAudit({ actorType: 'ai', creatorId, eventType: 'pitch.drafted', resourceType: 'opportunity', resourceId: opp._id, metadata: { provider: result.provider, model: result.model } });
  return { ...opp.pitchDraft, fallbackReason: result.fallbackReason };
}

/**
 * Starts outreach: creates the deal, conversation and pitch message, then
 * routes it through the approval policy. Returns the approval (pending, or
 * auto-authorised if the creator's rules allow).
 */
export async function initiateOutreach(creatorId, opportunityId, { contactId, subject, body }) {
  const opp = await loadOpportunity(creatorId, opportunityId);
  if (opp.excluded) throw conflict('This opportunity is excluded by your brand policy');
  if (opp.status === 'dismissed') throw conflict('Restore this opportunity before starting outreach');
  const contact = await BrandContact.findOne({ _id: contactId, brandId: opp.brandId, $or: [{ ownerCreatorId: null }, { ownerCreatorId: creatorId }] }).lean();
  if (!contact) throw notFound('Contact');
  if (!contact.businessEmail) throw badRequest('This contact has no business email');
  const suppressed = await suppressionFor(creatorId, [contact.businessEmail]);
  if (suppressed) throw conflict(suppressed);
  // One open sponsorship conversation per brand: avoids repeated or
  // multi-channel outreach to the same company.
  const open = await Deal.findOne({ creatorId, brandId: opp.brandId, status: 'open' }).lean();
  if (open) throw conflict('You already have an open conversation with this brand', { dealId: open._id });

  const [profile, user, brand] = await Promise.all([
    CreatorProfile.findOne({ userId: creatorId }).lean(),
    User.findById(creatorId).lean(),
    BrandProfile.findById(opp.brandId).lean(),
  ]);
  const creatorName = profile?.publicName || user.name;
  let deal;
  try {
    deal = await Deal.create({
      creatorId,
      brandId: opp.brandId,
      opportunityId: opp._id,
      currency: profile?.commercialPolicy?.currency || 'INR',
      negotiationState: 'initial_outreach',
      stateHistory: [{ from: null, to: 'initial_outreach', at: new Date(), actorType: 'creator', reason: 'Outreach initiated' }],
      isDemo: opp.isDemo,
    });
  } catch (err) {
    // A concurrent request opened a deal with this brand first.
    if (err.code !== 11000) throw err;
    const raced = await Deal.findOne({ creatorId, brandId: opp.brandId, status: 'open' }, { _id: 1 }).lean();
    throw conflict('You already have an open conversation with this brand', { dealId: raced?._id });
  }
  const conversation = await Conversation.create({
    creatorId,
    brandId: opp.brandId,
    opportunityId: opp._id,
    dealId: deal._id,
    contactId: contact._id,
    channel: 'email',
    replyToken: randomToken(18),
    subject,
    participants: [
      { name: creatorName, side: 'creator', role: 'Creator' },
      { name: contact.name || brand.name, email: contact.businessEmail, role: contact.role, side: 'brand' },
    ],
    isDemo: opp.isDemo,
  });
  deal.conversationId = conversation._id;
  await deal.save();

  const fromDraft = opp.pitchDraft && body === opp.pitchDraft.body;
  const message = await createDraft({
    conversation,
    purpose: 'pitch',
    subject,
    body,
    creatorName,
    ai: fromDraft ? { provider: opp.pitchDraft.provider, model: opp.pitchDraft.model } : null,
    to: [contact.businessEmail],
  });
  if (!fromDraft) await message.updateOne({ senderType: 'creator' });
  const { approval, autoAuthorized } = await proposeSend({
    creatorId,
    conversation,
    deal,
    message,
    actionType: 'send_pitch',
    contextSnapshot: { brandName: brand.name, opportunityTitle: opp.productOrCampaign || opp.signalSummary, contactRole: contact.role, contactVerification: contact.verificationStatus },
  });
  opp.status = 'outreach_drafted';
  await opp.save();
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'outreach.initiated', resourceType: 'deal', resourceId: deal._id, metadata: { opportunityId: opp._id, autoAuthorized } });
  return { dealId: deal._id, conversationId: conversation._id, approvalId: approval._id, autoAuthorized };
}
