import {
  ApprovalRequest, BrandProfile, Campaign, Conversation, CreatorProfile, Deal, Message, Opportunity, Suppression, User,
} from '../../models/index.js';
import { conflict, notFound, badRequest } from '../../lib/errors.js';
import { toMinor } from '../../lib/money.js';
import { hashObject } from '../../lib/crypto.js';
import { cancelPendingJobs, enqueueJob } from '../../jobs/queue.js';
import { replyTokenFromAddresses } from '../email/index.js';
import { waKey } from '../whatsapp/keys.js';
import { classifyInbound, extractOffer, draftNegotiation, aiStatus } from '../ai/index.js';
import { evaluateOffer, buildCounterTerms, counterWithinAuthorizedRules, negotiationContext, fillUnstatedTerms } from './policy.js';
import { transition, tryTransition } from './stateMachine.js';
import { createDraft, proposeSend } from '../messaging.service.js';
import { approve, createApproval, supersedePendingForDeal } from '../approvals/approval.service.js';
import { recordAudit } from '../audit.service.js';
import { notify } from '../notification.service.js';

// ---------------------------------------------------------------------------
// Helpers

export async function loadDeal(creatorId, dealId) {
  const deal = await Deal.findOne({ _id: dealId, creatorId });
  if (!deal) throw notFound('Deal');
  return deal;
}

async function context(creatorId, deal) {
  const [profile, user, brand, conversation] = await Promise.all([
    CreatorProfile.findOne({ userId: creatorId }).lean(),
    User.findById(creatorId).lean(),
    BrandProfile.findById(deal.brandId).lean(),
    deal.conversationId ? Conversation.findOne({ _id: deal.conversationId, creatorId }) : null,
  ]);
  return { profile, creatorName: profile?.publicName || user?.name || 'Creator', brand, conversation };
}

function brandRecipients(conversation) {
  // Email address, or @handle for Instagram (used for suppression checks; DMs go to the brand's Instagram id).
  return conversation.participants.filter((p) => p.side === 'brand' && (p.email || p.username || p.waId)).map((p) => p.email || (p.waId ? waKey(p.waId) : `@${p.username}`));
}

/** Converts AI/mock extraction output (major units) into stored terms (minor units). */
export function extractionToTerms(x, defaultCurrency) {
  const date = (s) => (s && !Number.isNaN(new Date(s).getTime()) ? new Date(s) : null);
  // "8000 per reel": when no total is stated but every deliverable has a rate, the total is rate × quantity.
  const priced = x.deliverables.length > 0 && x.deliverables.every((d) => d.unit_price != null);
  const fromRates = priced ? x.deliverables.reduce((sum, d) => sum + d.unit_price * (d.quantity || 1), 0) : null;
  const total = x.total_amount ?? fromRates;
  return {
    paymentType: x.payment_type ?? (total != null ? 'paid' : null),
    totalAmountMinor: total != null ? toMinor(total) : null,
    currency: (x.currency || defaultCurrency || 'INR').toUpperCase(),
    deliverables: x.deliverables.map((d) => ({ type: d.type, quantity: d.quantity, description: d.description, unitPriceMinor: d.unit_price != null ? toMinor(d.unit_price) : null })),
    barter: { productDescription: x.barter_product, claimedRetailValueMinor: x.barter_claimed_value != null ? toMinor(x.barter_claimed_value) : null },
    revisionsIncluded: x.revisions_included,
    usageRights: { durationDays: x.usage_rights_days, paidAds: x.usage_paid_ads, whitelisting: x.usage_whitelisting, perpetual: x.usage_perpetual, notes: null },
    exclusivity: { required: x.exclusivity_required, durationDays: x.exclusivity_days, scope: x.exclusivity_scope },
    paymentTerms: { netDays: x.payment_net_days, advancePercent: x.advance_percent, notes: null },
    deadlines: { contentDueAt: date(x.content_due_date), publishAt: date(x.publish_date), notes: null },
    cancellation: { killFeePercent: x.kill_fee_percent, notes: null },
    otherConditions: x.other_conditions,
  };
}

// True when `next` talks about the same deliverables as `prev`, or fewer of them.
const withinScope = (next = [], prev = []) => next.every((d) => prev.some((p) => p.type === d.type && (p.quantity ?? 1) >= (d.quantity ?? 1)));
const MISSING_FIELD_WORDS = [
  [/amount|fee|budget|compensation|price|rate/i, (t) => t.totalAmountMinor != null],
  [/deliverable/i, (t) => t.deliverables?.length > 0],
  [/usage/i, (t) => t.usageRights?.durationDays != null || t.usageRights?.perpetual != null],
  [/exclusiv/i, (t) => t.exclusivity?.required != null],
  [/payment|net|invoice|advance/i, (t) => t.paymentTerms?.netDays != null || t.paymentTerms?.advancePercent != null],
  [/revision/i, (t) => t.revisionsIncluded != null],
];

/**
 * Brands rarely repeat everything in each email ("as I said, 8000 per reel").
 * A new message updates the terms it mentions; anything it leaves out keeps the
 * value the brand stated earlier in the thread. Returns the merged terms and
 * plain-language notes on what was carried forward.
 */
export function mergeOfferTerms(previous, next) {
  if (!previous) return { terms: next, carried: [] };
  const carried = [];
  const pick = (key, label) => {
    if (next[key] != null) return next[key];
    if (previous[key] != null && label) carried.push(label);
    return previous[key] ?? null;
  };
  const sub = (key, label) => {
    const a = previous[key] || {};
    const b = next[key] || {};
    const out = { ...a };
    let used = false;
    for (const [k, v] of Object.entries(b)) {
      if (v != null) out[k] = v;
      else if (a[k] != null) used = true;
    }
    if (used && label) carried.push(label);
    return out;
  };
  const deliverables = next.deliverables?.length ? next.deliverables : previous.deliverables || [];
  if (!next.deliverables?.length && previous.deliverables?.length) carried.push('deliverables');
  // An amount only carries over while the brand is talking about the same deliverables.
  const sameScope = !next.deliverables?.length || withinScope(next.deliverables, previous.deliverables);
  let totalAmountMinor = next.totalAmountMinor ?? null;
  if (totalAmountMinor == null && sameScope && previous.totalAmountMinor != null) {
    totalAmountMinor = previous.totalAmountMinor;
    carried.push('fee');
  }
  const terms = {
    ...next,
    paymentType: next.paymentType || previous.paymentType,
    totalAmountMinor,
    currency: next.currency || previous.currency,
    deliverables,
    barter: sub('barter'),
    revisionsIncluded: pick('revisionsIncluded', 'revisions'),
    usageRights: sub('usageRights', 'usage rights'),
    exclusivity: sub('exclusivity', 'exclusivity'),
    paymentTerms: sub('paymentTerms', 'payment terms'),
    deadlines: sub('deadlines', 'deadlines'),
    cancellation: sub('cancellation'),
    otherConditions: [...new Set([...(previous.otherConditions || []), ...(next.otherConditions || [])])].slice(0, 10),
  };
  return { terms, carried };
}

/** Drops "missing" notes for terms that are now known (e.g. stated in an earlier email). */
export function stillMissing(missingTerms = [], terms) {
  return missingTerms.filter((m) => !MISSING_FIELD_WORDS.some(([re, known]) => re.test(m) && known(terms)));
}

const plain = (doc) => (doc?.toObject ? doc.toObject() : doc) || null;

// Once terms are agreed, a brand reply never triggers an automatic counteroffer.
export const AGREED_STATES = ['terms_agreed_subject_to_formalization', 'agreement_pending', 'deal_confirmed'];

/**
 * True when a brand message after agreement changes what was agreed (fee,
 * deliverables, exclusivity or extended rights). Dates, documents and other
 * logistics are not a change.
 */
export function changesAgreedTerms(agreed, next) {
  if (!agreed) return true;
  if (next.totalAmountMinor != null && next.totalAmountMinor !== agreed.totalAmountMinor) return true;
  if (next.deliverables?.length && !next.deliverables.every((d) => (agreed.deliverables || []).some((a) => a.type === d.type && (a.quantity ?? 1) >= (d.quantity ?? 1)))) return true;
  if (next.exclusivity?.required && !agreed.exclusivity?.required) return true;
  if ((next.usageRights?.perpetual && !agreed.usageRights?.perpetual) || (next.usageRights?.paidAds && !agreed.usageRights?.paidAds)) return true;
  return false;
}

/**
 * The brand agreed: either to the creator's counteroffer that was sent (the
 * creator already approved those exact terms) or by confirming a deal that is
 * already agreed. Drafts a short acknowledgement for approval; never a counter.
 */
async function handleBrandAgreement({ deal, conversation, brand, message, creatorId, result }) {
  if (!AGREED_STATES.includes(deal.negotiationState) && deal.proposedTerms?.totalAmountMinor != null && ['counteroffer_sent', 'terms_under_negotiation'].includes(deal.negotiationState)) {
    const terms = plain(deal.proposedTerms);
    deal.acceptedTerms = terms;
    deal.acceptedTermsHash = hashObject(terms);
    tryTransition(deal, 'terms_under_negotiation', { actorType: 'brand', reason: 'Brand agreed to the counteroffer' });
    tryTransition(deal, 'terms_agreed_subject_to_formalization', { actorType: 'brand', reason: 'Brand agreed to the counteroffer; awaiting written agreement' });
    await deal.save();
  }
  const agreed = AGREED_STATES.includes(deal.negotiationState);
  // Drafts still waiting for approval (e.g. a counter) are out of date once the brand has agreed.
  if (agreed) await supersedePendingForDeal(deal._id, 'Brand confirmed the deal');
  if (agreed && !conversation.humanTakeover && aiStatus().provider !== 'disabled') {
    const reply = await draftResponse(creatorId, conversation._id, { kind: 'acknowledgement' });
    result.replyApprovalId = reply.approvalId;
  }
  result.agreed = agreed;
  await notify(creatorId, {
    type: 'brand_replied',
    title: agreed ? `${brand.name} confirmed the deal` : `${brand.name} replied`,
    body: agreed ? 'Next: the written agreement. A short thank-you reply is drafted for your approval.' : 'Review the reply in your inbox.',
    link: agreed ? `/negotiations/${deal._id}` : `/inbox?conversation=${conversation._id}`,
    dedupeKey: `reply:${message._id}`,
  });
}

async function activeCampaignCount(creatorId) {
  return Campaign.countDocuments({ creatorId, status: { $nin: ['completed'] } });
}

// ---------------------------------------------------------------------------
// Offer analysis

export async function analyzeDeal(creatorId, dealId, { actorType = 'creator' } = {}) {
  const deal = await loadDeal(creatorId, dealId);
  if (!deal.currentOffer) throw conflict('There is no offer to analyse yet');
  const profile = await CreatorProfile.findOne({ userId: creatorId }).lean();
  const evaluation = evaluateOffer(deal.currentOffer.toObject ? deal.currentOffer.toObject() : deal.currentOffer, profile, { activeCampaigns: await activeCampaignCount(creatorId), negotiation: negotiationContext(deal) });
  tryTransition(deal, 'offer_under_analysis', { actorType, reason: 'Offer analysis' });
  deal.analysis = {
    termsVersion: deal.termsVersion,
    at: new Date(),
    recommendation: evaluation.recommendation,
    checks: evaluation.checks,
    reasoning: evaluation.reasoning,
    tradeoffs: evaluation.tradeoffs,
    offerValueMinor: evaluation.offerValueMinor,
    benchmarkValueMinor: evaluation.benchmarkValueMinor,
    floorValueMinor: evaluation.floorValueMinor,
    aiProvider: 'deterministic-policy-engine',
  };
  tryTransition(deal, 'awaiting_creator_decision', { actorType: 'system', reason: `Analysis complete: recommend ${evaluation.recommendation}` });
  await deal.save();
  await recordAudit({ actorType, creatorId, eventType: 'offer.analyzed', resourceType: 'deal', resourceId: deal._id, metadata: { termsVersion: deal.termsVersion, recommendation: evaluation.recommendation } });
  return { deal, evaluation };
}

async function recordOffer(deal, terms, { source, messageId, extraction, actorType }) {
  deal.termsVersion += 1;
  deal.currentOffer = terms;
  deal.offerHistory.push({ version: deal.termsVersion, source, at: new Date(), messageId, terms, extraction });
  tryTransition(deal, 'offer_received', { actorType, reason: source === 'brand' ? 'Offer received from brand' : 'Offer entered manually' });
  await deal.save();
  // Approvals bound to the previous terms can no longer be executed.
  await supersedePendingForDeal(deal._id, 'Offer terms changed');
}

/** Creator enters/corrects the brand's offer manually (e.g. received on a call). */
export async function recordManualOffer(creatorId, dealId, terms) {
  const deal = await loadDeal(creatorId, dealId);
  if (['closed', 'deal_confirmed'].includes(deal.negotiationState)) throw conflict(`Deal is ${deal.negotiationState}`);
  await recordOffer(deal, terms, { source: 'manual_entry', actorType: 'creator' });
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'offer.manual_entry', resourceType: 'deal', resourceId: deal._id, metadata: { termsVersion: deal.termsVersion } });
  return analyzeDeal(creatorId, dealId, { actorType: 'creator' });
}

// ---------------------------------------------------------------------------
// Counteroffers, acceptance, decline

export async function generateCounteroffer(creatorId, dealId, { actorType = 'creator' } = {}) {
  const deal = await loadDeal(creatorId, dealId);
  if (!deal.currentOffer) throw conflict('There is no offer to counter');
  if (['closed', 'deal_confirmed', 'declined'].includes(deal.negotiationState)) throw conflict(`Deal is ${deal.negotiationState}`);
  if (actorType !== 'creator' && AGREED_STATES.includes(deal.negotiationState)) throw conflict('Terms are already agreed; no automatic counteroffer');
  const { profile, creatorName, brand, conversation } = await context(creatorId, deal);
  if (!conversation) throw conflict('This deal has no conversation');
  const offer = deal.currentOffer.toObject ? deal.currentOffer.toObject() : deal.currentOffer;
  const evaluation = evaluateOffer(offer, profile, { activeCampaigns: await activeCampaignCount(creatorId), negotiation: negotiationContext(deal) });
  const counter = buildCounterTerms(offer, profile, evaluation, negotiationContext(deal));
  const counterRule = counterWithinAuthorizedRules(counter.terms, profile);
  const lastInbound = await Message.findOne({ conversationId: conversation._id, direction: 'inbound' }).sort({ createdAt: -1 }).lean();

  const brandOfferMinor = offer.totalAmountMinor ?? null;
  const draft = await draftNegotiation({
    kind: 'counteroffer',
    channel: conversation.channel,
    creator: profile,
    brand,
    terms: counter.terms,
    brandOfferMinor,
    requiredTerms: {
      ...counter.terms,
      totalAmount: counter.terms.totalAmountMinor / 100,
      brand_offer: brandOfferMinor != null ? brandOfferMinor / 100 : null,
      previous_counter: counter.previousCounterMinor != null ? counter.previousCounterMinor / 100 : null,
      brand_conditions_not_included: offer.otherConditions || [],
    },
    currency: counter.terms.currency,
    reasons: counter.rationale,
    lastInbound: lastInbound?.content,
    allowedAmountsMajor: [counter.terms.totalAmountMinor / 100, ...[brandOfferMinor, counter.previousCounterMinor].filter((v) => v != null).map((v) => v / 100)],
  });
  const message = await createDraft({ conversation, purpose: 'counteroffer', subject: draft.data.subject, body: draft.data.body, creatorName, ai: draft, to: brandRecipients(conversation) });
  tryTransition(deal, 'counteroffer_requires_approval', { actorType: 'ai', reason: 'Counteroffer drafted' });
  await deal.save();
  const policyChecks = [
    ...evaluation.checks,
    { code: 'counter_rule', label: 'Within authorised rules', status: counterRule.ok ? 'ok' : 'requires_approval', detail: counterRule.ok ? 'Counter stays within your authorised pricing and rights.' : counterRule.reasons.join('; ') },
  ];
  const { approval, autoAuthorized } = await proposeSend({
    creatorId,
    conversation,
    deal,
    message,
    actionType: 'send_counteroffer',
    counterRule,
    terms: counter.terms,
    policyChecks,
    policyCategories: evaluation.approvalCategories.filter((c) => c !== 'accept_or_reject_offer'),
    contextSnapshot: {
      brandName: brand.name,
      dealState: deal.negotiationState,
      offerSummary: deal.offerHistory.at(-1)?.extraction?.summary,
      offerValueMinor: evaluation.offerValueMinor,
      benchmarkValueMinor: evaluation.benchmarkValueMinor,
      floorValueMinor: evaluation.floorValueMinor,
      counterRationale: counter.rationale,
      lastInboundExcerpt: lastInbound?.content?.slice(0, 600),
    },
  });
  await recordAudit({ actorType, creatorId, eventType: 'counteroffer.generated', resourceType: 'deal', resourceId: deal._id, metadata: { termsVersion: deal.termsVersion, amountMinor: counter.terms.totalAmountMinor, autoAuthorized, aiProvider: draft.provider } });
  return { approvalId: approval._id, autoAuthorized, counter, evaluation };
}

/** Creator decides to accept: produces an acceptance proposal that must be approved explicitly. */
export async function requestAcceptance(creatorId, dealId, { termsVersion, createdBy = 'creator' }) {
  const deal = await loadDeal(creatorId, dealId);
  if (!deal.currentOffer) throw conflict('There is no offer to accept');
  if (termsVersion !== deal.termsVersion) throw conflict('The offer changed since you reviewed it', { termsVersion: deal.termsVersion });
  if (!['awaiting_creator_decision', 'offer_under_analysis', 'terms_under_negotiation', 'counteroffer_sent', 'offer_received'].includes(deal.negotiationState)) {
    throw conflict(`An offer cannot be accepted while the deal is ${deal.negotiationState}`);
  }
  const { profile, creatorName, brand, conversation } = await context(creatorId, deal);
  // Anything the brand left unstated is filled from the creator's defaults, so the acceptance is complete.
  const { terms } = fillUnstatedTerms(deal.currentOffer.toObject ? deal.currentOffer.toObject() : deal.currentOffer, profile);
  const evaluation = evaluateOffer(terms, profile, { activeCampaigns: await activeCampaignCount(creatorId), negotiation: negotiationContext(deal) });
  const draft = await draftNegotiation({
    kind: 'acceptance', channel: conversation?.channel, creator: profile, brand, terms, requiredTerms: { ...terms, totalAmount: terms.totalAmountMinor != null ? terms.totalAmountMinor / 100 : null }, currency: terms.currency,
    allowedAmountsMajor: [terms.totalAmountMinor != null ? terms.totalAmountMinor / 100 : null, terms.barter?.claimedRetailValueMinor ? terms.barter.claimedRetailValueMinor / 100 : null],
  });
  const message = await createDraft({ conversation, purpose: 'acceptance', subject: draft.data.subject, body: draft.data.body, creatorName, ai: draft, to: brandRecipients(conversation) });
  tryTransition(deal, 'awaiting_creator_decision', { actorType: 'creator', reason: 'Acceptance under review' });
  await deal.save();
  const reasons = [{ code: 'accept_or_reject_offer', label: 'Accepting a sponsorship offer' }];
  for (const c of evaluation.approvalCategories) if (c !== 'accept_or_reject_offer') reasons.push({ code: c, label: c.replace(/_/g, ' ') });
  const approval = await createApproval({
    creatorId, deal, conversation, message, actionType: 'accept_offer', createdBy,
    proposedAction: { channel: ['instagram', 'whatsapp'].includes(conversation.channel) ? conversation.channel : 'email', messageId: String(message._id), to: message.toAddresses, subject: message.subject, content: message.content, purpose: 'acceptance', terms, termsHash: hashObject(terms) },
    reasons, policyChecks: evaluation.checks, requiresExplicitConfirmation: true,
    contextSnapshot: { brandName: brand.name, offerValueMinor: evaluation.offerValueMinor, benchmarkValueMinor: evaluation.benchmarkValueMinor, floorValueMinor: evaluation.floorValueMinor, recommendation: evaluation.recommendation },
  });
  return { approvalId: approval._id };
}

export async function requestDecline(creatorId, dealId, { reason }) {
  const deal = await loadDeal(creatorId, dealId);
  if (['closed', 'declined', 'deal_confirmed'].includes(deal.negotiationState)) throw conflict(`Deal is ${deal.negotiationState}`);
  const { profile, creatorName, brand, conversation } = await context(creatorId, deal);
  const draft = await draftNegotiation({ kind: 'decline', channel: conversation?.channel, creator: profile, brand, allowedAmountsMajor: [] });
  const message = await createDraft({ conversation, purpose: 'decline', subject: draft.data.subject, body: draft.data.body, creatorName, ai: draft, to: brandRecipients(conversation) });
  const approval = await createApproval({
    creatorId, deal, conversation, message, actionType: 'decline_offer', createdBy: 'creator',
    proposedAction: { channel: ['instagram', 'whatsapp'].includes(conversation.channel) ? conversation.channel : 'email', messageId: String(message._id), to: message.toAddresses, subject: message.subject, content: message.content, purpose: 'decline', reason: reason || null },
    reasons: [{ code: 'accept_or_reject_offer', label: 'Rejecting a sponsorship offer' }],
    contextSnapshot: { brandName: brand.name },
  });
  return { approvalId: approval._id };
}

/** Draft a reply (clarifying questions or information) for the current conversation. */
export async function draftResponse(creatorId, conversationId, { kind } = {}) {
  const conversation = await Conversation.findOne({ _id: conversationId, creatorId });
  if (!conversation) throw notFound('Conversation');
  if (conversation.status !== 'open') throw conflict(`Conversation is ${conversation.status}`);
  const deal = conversation.dealId ? await Deal.findOne({ _id: conversation.dealId, creatorId }) : null;
  const { profile, creatorName, brand } = await context(creatorId, deal || { brandId: conversation.brandId });
  let questions = [];
  let resolvedKind = kind;
  if (!resolvedKind && AGREED_STATES.includes(deal?.negotiationState)) resolvedKind = 'acknowledgement';
  if (!resolvedKind) {
    if (deal?.currentOffer) {
      const ev = evaluateOffer(deal.currentOffer.toObject(), profile, { negotiation: negotiationContext(deal) });
      questions = ev.questions;
      resolvedKind = questions.length ? 'clarification' : 'info_reply';
    } else resolvedKind = deal?.negotiationState === 'awaiting_reply' ? 'follow_up' : 'info_reply';
  } else if (resolvedKind === 'clarification' && deal?.currentOffer) {
    questions = evaluateOffer(deal.currentOffer.toObject(), profile, { negotiation: negotiationContext(deal) }).questions;
  }
  const lastInbound = await Message.findOne({ conversationId, direction: 'inbound' }).sort({ createdAt: -1 }).lean();
  const draft = await draftNegotiation({ kind: resolvedKind, channel: conversation.channel, creator: profile, brand, questions, lastInbound: lastInbound?.content, allowedAmountsMajor: [] });
  const purpose = resolvedKind === 'clarification' ? 'clarification' : resolvedKind === 'follow_up' ? 'follow_up' : 'reply';
  const message = await createDraft({ conversation, purpose, subject: draft.data.subject, body: draft.data.body, creatorName, ai: draft, to: brandRecipients(conversation) });
  const { approval, autoAuthorized } = await proposeSend({
    creatorId, conversation, deal, message, actionType: purpose === 'follow_up' ? 'send_follow_up' : 'send_reply',
    contextSnapshot: { brandName: brand.name, lastInboundExcerpt: lastInbound?.content?.slice(0, 600) },
  });
  return { approvalId: approval._id, messageId: message._id, autoAuthorized };
}

/** Creator-written message, sent with explicit authorisation (the act of sending). */
export async function sendCreatorMessage(creatorId, conversationId, { subject, content, confirm }) {
  if (confirm !== true) throw badRequest('Confirm that you want to send this message');
  const conversation = await Conversation.findOne({ _id: conversationId, creatorId });
  if (!conversation) throw notFound('Conversation');
  if (conversation.status !== 'open') throw conflict(`Conversation is ${conversation.status}`);
  const deal = conversation.dealId ? await Deal.findOne({ _id: conversation.dealId, creatorId }) : null;
  const { creatorName } = await context(creatorId, deal || { brandId: conversation.brandId });
  const message = await createDraft({ conversation, purpose: 'reply', subject, body: content, creatorName, ai: null, to: brandRecipients(conversation) });
  await message.updateOne({ senderType: 'creator' });
  const approval = await createApproval({
    creatorId, deal, conversation, message, actionType: 'send_reply', createdBy: 'creator',
    proposedAction: { channel: ['instagram', 'whatsapp'].includes(conversation.channel) ? conversation.channel : 'email', messageId: String(message._id), to: message.toAddresses, subject: message.subject, content: message.content, purpose: 'reply' },
    reasons: [{ code: 'creator_authored', label: 'Written and sent by you' }],
  });
  // The creator's own send is the approval; it goes through the same executor.
  await approve(creatorId, approval._id, { actionHash: approval.actionHash, confirm: true }, creatorId);
  return { messageId: message._id, approvalId: approval._id };
}

export async function confirmAgreement(creatorId, dealId, { kind, reference, url, confirm, acceptedTermsHash }) {
  if (confirm !== true) throw badRequest('Confirm that a written agreement is in place');
  const deal = await loadDeal(creatorId, dealId);
  if (!['terms_agreed_subject_to_formalization', 'agreement_pending'].includes(deal.negotiationState)) {
    throw conflict('Terms must be agreed before the deal can be confirmed');
  }
  if (!deal.acceptedTermsHash || acceptedTermsHash !== deal.acceptedTermsHash) throw conflict('The agreed terms changed since you reviewed them');
  deal.agreementReference = { kind, reference, url, confirmedAt: new Date() };
  transition(deal, 'deal_confirmed', { actorType: 'creator', reason: 'Written agreement confirmed by creator' });
  await deal.save();
  if (deal.opportunityId) await Opportunity.updateOne({ _id: deal.opportunityId, creatorId }, { $set: { status: 'won' } });
  await cancelPendingJobs({ jobType: 'followup.check', 'payload.conversationId': String(deal.conversationId) }, 'deal_confirmed');
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'deal.confirmed', resourceType: 'deal', resourceId: deal._id, metadata: { kind, acceptedTermsHash } });
  return deal;
}

export async function markAgreementPending(creatorId, dealId) {
  const deal = await loadDeal(creatorId, dealId);
  transition(deal, 'agreement_pending', { actorType: 'creator', reason: 'Waiting for written agreement' });
  await deal.save();
  return deal;
}

export async function closeDeal(creatorId, dealId, { reason }) {
  const deal = await loadDeal(creatorId, dealId);
  transition(deal, 'closed', { actorType: 'creator', reason: reason || 'Closed by creator' });
  deal.closedReason = reason;
  await deal.save();
  await supersedePendingForDeal(deal._id, 'Deal closed');
  if (deal.conversationId) {
    await cancelPendingJobs({ jobType: 'followup.check', 'payload.conversationId': String(deal.conversationId) }, 'deal_closed');
    await Conversation.updateOne({ _id: deal.conversationId }, { $set: { status: 'closed', nextFollowUpAt: null } });
  }
  return deal;
}

// ---------------------------------------------------------------------------
// Inbound processing

async function matchConversation({ toAddresses, inReplyTo, references }) {
  const token = replyTokenFromAddresses(toAddresses);
  if (token) {
    // Mail clients and mailboxes may change the case of an address; tokens are compared case-insensitively.
    const c = (await Conversation.findOne({ replyToken: token })) || (await Conversation.findOne({ replyToken: { $regex: `^${token.replace(/[^A-Za-z0-9_-]/g, '')}$`, $options: 'i' } }));
    if (c) return c;
  }
  // Fall back to RFC 5322 threading headers that reference one of our sent messages.
  const ids = [inReplyTo, ...(references || [])].filter(Boolean).map(String);
  if (ids.length) {
    const m = await Message.findOne({ providerMessageId: { $in: ids }, direction: 'outbound' }).lean();
    if (m) return Conversation.findById(m.conversationId);
  }
  // Never match on brand names or sender domains alone.
  return null;
}

/**
 * Stores an inbound email (from the provider webhook or a labelled
 * simulation) without running any AI or negotiation steps, so the webhook can
 * answer quickly. Duplicate deliveries of the same provider message id are
 * ignored, so webhook retries cannot duplicate messages or actions.
 */
export async function receiveInbound({ provider, externalMessageId, fromAddress, toAddresses, subject, text, inReplyTo, references, receivedAt = new Date(), simulated = false }) {
  const extId = `${provider}:${externalMessageId}`;
  const existing = await Message.findOne({ externalMessageId: extId }, { _id: 1, inboundProcessing: 1 }).lean();
  if (existing) return { duplicate: true, messageId: existing._id, processingStatus: existing.inboundProcessing?.status };
  const conversation = await matchConversation({ toAddresses, inReplyTo, references });
  if (!conversation) {
    await recordAudit({ actorType: 'system', eventType: 'inbound.unmatched', resourceType: 'inbound_email', metadata: { provider } });
    return { matched: false };
  }
  return storeInboundMessage(conversation, { provider, externalMessageId, fromAddress, toAddresses, subject, text, inReplyTo, receivedAt, simulated, channel: 'email' });
}

/**
 * Stores one inbound message on a conversation that is already identified
 * (email: by reply token or threading headers; Instagram: by its thread id).
 * Idempotent on the provider message id.
 */
export async function storeInboundMessage(conversation, { provider, externalMessageId, fromAddress, toAddresses, subject, text, inReplyTo, receivedAt = new Date(), simulated = false, channel = 'email', classification }) {
  const extId = `${provider}:${externalMessageId}`;
  const existing = await Message.findOne({ externalMessageId: extId }, { _id: 1, inboundProcessing: 1 }).lean();
  if (existing) return { duplicate: true, messageId: existing._id, processingStatus: existing.inboundProcessing?.status };
  let message;
  try {
    message = await Message.create({
      conversationId: conversation._id,
      creatorId: conversation.creatorId,
      externalMessageId: extId,
      direction: 'inbound',
      channel,
      classification,
      senderType: 'brand',
      purpose: 'inbound',
      subject,
      content: String(text || '').slice(0, 50_000) || '(empty message)',
      fromAddress,
      toAddresses,
      deliveryStatus: 'received',
      provenance: simulated ? 'simulated' : 'provider',
      providerName: provider,
      providerMessageId: externalMessageId,
      inReplyTo,
      receivedAt,
      inboundProcessing: { status: 'pending', attempts: 0 },
    });
  } catch (err) {
    if (err.code === 11000) {
      const raced = await Message.findOne({ externalMessageId: extId }, { _id: 1, inboundProcessing: 1 }).lean();
      return { duplicate: true, messageId: raced?._id, processingStatus: raced?.inboundProcessing?.status };
    }
    throw err;
  }
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { lastInboundAt: receivedAt, lastMessageAt: receivedAt }, $inc: { unreadInbound: 1 } },
  );
  return { matched: true, messageId: message._id, conversationId: conversation._id };
}

/**
 * Queues the `inbound.process` job for a stored message. Re-queueing a
 * duplicate is a no-op unless the first delivery was stored but never queued
 * (e.g. a crash between the two steps).
 */
export async function queueInboundProcessing(received) {
  if (!received.messageId || (received.duplicate && received.processingStatus !== 'pending')) return null;
  const message = await Message.findById(received.messageId, { creatorId: 1 }).lean();
  const { job } = await enqueueJob({ jobType: 'inbound.process', creatorId: message?.creatorId, payload: { messageId: String(received.messageId) }, idempotencyKey: `inbound:${received.messageId}`, maxAttempts: 3 });
  return job;
}

/**
 * Job handler for `inbound.process`: classification, offer extraction and the
 * negotiation steps for one stored inbound message. A run that failed with an
 * error is retried. A run that was interrupted part-way (worker died) is not
 * re-run, because that could repeat drafts; the creator reviews it instead.
 */
export async function processInboundMessage(messageId) {
  const message = await Message.findOneAndUpdate(
    { _id: messageId, direction: 'inbound', 'inboundProcessing.status': { $in: ['pending', 'failed'] } },
    { $set: { 'inboundProcessing.status': 'processing' }, $inc: { 'inboundProcessing.attempts': 1 } },
    { returnDocument: 'after' },
  );
  if (!message) {
    const current = await Message.findById(messageId, { inboundProcessing: 1 }).lean();
    if (current?.inboundProcessing?.status === 'processing') {
      await flagInboundForReview(messageId, 'interrupted', 'Automatic processing was interrupted before it finished.');
      return { matched: true, messageId, interrupted: true };
    }
    return { matched: true, messageId, skipped: true, processingStatus: current?.inboundProcessing?.status ?? null };
  }
  try {
    const result = await runInboundSteps(message);
    await Message.updateOne(
      { _id: message._id },
      { $set: { 'inboundProcessing.status': 'done', 'inboundProcessing.processedAt': new Date() }, $unset: { 'inboundProcessing.lastError': 1 } },
    );
    return result;
  } catch (err) {
    await Message.updateOne({ _id: message._id }, { $set: { 'inboundProcessing.status': 'failed', 'inboundProcessing.lastError': String(err?.message || err).slice(0, 500) } });
    throw err;
  }
}

/** Hands an inbound message to the creator when automatic processing could not finish. */
export async function flagInboundForReview(messageId, status, reason) {
  const message = await Message.findOneAndUpdate(
    { _id: messageId, direction: 'inbound', 'inboundProcessing.status': { $ne: 'done' } },
    { $set: { 'inboundProcessing.status': status, 'inboundProcessing.lastError': reason } },
    { returnDocument: 'after' },
  ).lean();
  if (!message) return;
  const conversation = await Conversation.findById(message.conversationId, { dealId: 1 }).lean();
  const deal = conversation?.dealId ? await Deal.findById(conversation.dealId) : null;
  if (deal && tryTransition(deal, 'awaiting_creator_decision', { actorType: 'system', reason: 'Reply needs manual review' })) await deal.save();
  await notify(message.creatorId, {
    type: 'inbound_needs_review',
    title: 'A brand reply needs your review',
    body: `${reason} Read the reply and decide the next step yourself.`,
    link: `/inbox?conversation=${message.conversationId}`,
    severity: 'warning',
    dedupeKey: `inbound-review:${message._id}`,
  });
  await recordAudit({ actorType: 'system', creatorId: message.creatorId, eventType: 'inbound.needs_review', resourceType: 'message', resourceId: message._id, metadata: { status } });
}

async function runInboundSteps(message) {
  const conversation = await Conversation.findById(message.conversationId);
  if (!conversation) throw new Error('Conversation not found for inbound message');
  const creatorId = conversation.creatorId;
  const { subject, fromAddress } = message;
  const simulated = message.provenance === 'simulated';
  const provider = message.providerName;

  // Instagram DMs were already classified by the inbox checker (to tell brands from fans).
  let intent = message.classification?.intent ?? null;
  let classification = null;
  if (!intent) {
    classification = await classifyInbound({ text: message.content, subject });
    intent = classification?.data.intent ?? null;
    message.classification = classification ? { intent, confidence: classification.data.confidence, provider: classification.provider } : { intent: null, provider: 'unavailable' };
    await message.save();
  }

  // Any real reply (not an auto-responder) stops scheduled follow-ups.
  if (intent !== 'out_of_office') {
    const cancelled = await cancelPendingJobs({ jobType: 'followup.check', 'payload.conversationId': String(conversation._id) }, 'reply_received');
    if (cancelled) conversation.followUpSuppressedReason = 'reply_received';
    conversation.nextFollowUpAt = null;
  }
  await conversation.save();

  const deal = conversation.dealId ? await Deal.findById(conversation.dealId) : null;
  const brand = await BrandProfile.findById(conversation.brandId).lean();
  const result = { matched: true, messageId: message._id, conversationId: conversation._id, intent };
  if (!deal) return result;
  const profile = await CreatorProfile.findOne({ userId: creatorId }).lean();

  switch (intent) {
    case 'opt_out':
    case 'decline': {
      const reason = intent === 'opt_out' ? 'opt_out' : 'refusal';
      if (fromAddress) {
        await Suppression.updateOne({ email: fromAddress.toLowerCase(), creatorId }, { $setOnInsert: { email: fromAddress.toLowerCase(), creatorId, reason, sourceMessageId: message._id } }, { upsert: true });
      }
      await supersedePendingForDeal(deal._id, intent === 'opt_out' ? 'Brand opted out' : 'Brand declined');
      await cancelPendingJobs({ jobType: 'message.send', creatorId, 'payload.messageId': { $in: (await Message.find({ conversationId: conversation._id, deliveryStatus: 'queued' }, { _id: 1 }).lean()).map((m) => String(m._id)) } }, reason);
      await Message.updateMany({ conversationId: conversation._id, deliveryStatus: 'queued' }, { $set: { deliveryStatus: 'cancelled', failureReason: `Cancelled: brand ${intent === 'opt_out' ? 'opted out' : 'declined'}` } });
      tryTransition(deal, 'declined', { actorType: 'brand', reason: intent === 'opt_out' ? 'Brand asked not to be contacted' : 'Brand declined' });
      deal.closedReason = intent;
      await deal.save();
      if (deal.opportunityId) await Opportunity.updateOne({ _id: deal.opportunityId }, { $set: { status: 'lost' } });
      await notify(creatorId, { type: 'brand_declined', title: `${brand.name} ${intent === 'opt_out' ? 'asked not to be contacted' : 'declined'}`, body: 'Further outreach to this contact is suppressed.', link: `/inbox?conversation=${conversation._id}`, dedupeKey: `declined:${message._id}` });
      break;
    }
    case 'out_of_office':
      break;
    case 'acceptance':
      await handleBrandAgreement({ deal, conversation, brand, message, creatorId, result });
      break;
    case 'offer': {
      const extracted = await extractOffer({ text: message.content, defaultCurrency: profile.commercialPolicy?.currency || 'INR' });
      // After agreement, a reply that only adds logistics (dates, documents) is a confirmation, not a new offer.
      if (extracted?.data && AGREED_STATES.includes(deal.negotiationState) && !changesAgreedTerms(plain(deal.acceptedTerms), extractionToTerms(extracted.data, profile.commercialPolicy?.currency))) {
        await handleBrandAgreement({ deal, conversation, brand, message, creatorId, result });
        break;
      }
      const reopensAgreement = AGREED_STATES.includes(deal.negotiationState);
      if (extracted?.data) {
        // A retried run must not record the same brand offer twice.
        const alreadyRecorded = deal.offerHistory.some((o) => o.source === 'brand' && String(o.messageId) === String(message._id));
        if (!alreadyRecorded) {
          const { terms, carried } = mergeOfferTerms(plain(deal.currentOffer), extractionToTerms(extracted.data, profile.commercialPolicy?.currency));
          await recordOffer(deal, terms, {
            source: 'brand', messageId: message._id, actorType: 'brand',
            extraction: {
              provider: extracted.provider, model: extracted.model, missingTerms: stillMissing(extracted.data.missing_terms, terms), ambiguities: extracted.data.ambiguities, summary: extracted.data.summary,
              carriedForward: carried,
              finalOffer: !!extracted.data.final_offer,
            },
          });
        }
        const { evaluation } = await analyzeDeal(creatorId, deal._id, { actorType: 'system' });
        result.recommendation = evaluation.recommendation;
        // A brand changing already-agreed terms goes to the creator; nothing is drafted automatically.
        if (reopensAgreement) {
          result.reopenedAgreement = true;
          await notify(creatorId, { type: 'offer_received', title: `${brand.name} changed the agreed terms`, body: 'Review the new terms before replying. Nothing was drafted automatically.', link: `/negotiations/${deal._id}`, severity: 'warning', dedupeKey: `offer:${message._id}` });
          break;
        }
        if (!conversation.humanTakeover) {
          // "escalate" (unusual conditions) also gets a counter draft: it restates the creator's
          // terms, and those conditions always require approval before anything is sent.
          if (evaluation.recommendation === 'counter' || (evaluation.recommendation === 'escalate' && deal.currentOffer?.totalAmountMinor != null)) {
            const counter = await generateCounteroffer(creatorId, deal._id, { actorType: 'ai' });
            result.counterApprovalId = counter.approvalId;
          } else if (evaluation.recommendation === 'clarify') {
            const reply = await draftResponse(creatorId, conversation._id, { kind: 'clarification' });
            result.replyApprovalId = reply.approvalId;
          } else if (evaluation.recommendation === 'accept') {
            // Prepared for the creator only: accepting always needs explicit approval and confirmation.
            const fresh = await Deal.findById(deal._id, { termsVersion: 1 }).lean();
            const acceptance = await requestAcceptance(creatorId, deal._id, { termsVersion: fresh.termsVersion, createdBy: 'ai' });
            result.acceptApprovalId = acceptance.approvalId;
          }
        }
        await notify(creatorId, { type: 'offer_received', title: `New offer from ${brand.name}`, body: `Recommendation: ${evaluation.recommendation}. Review it in the negotiation workspace.`, link: `/negotiations/${deal._id}`, severity: 'warning', dedupeKey: `offer:${message._id}` });
      } else {
        tryTransition(deal, 'awaiting_creator_decision', { actorType: 'system', reason: 'Offer received; automatic extraction unavailable' });
        await deal.save();
        await notify(creatorId, { type: 'offer_received', title: `New offer from ${brand.name}`, body: 'Automatic term extraction is unavailable. Enter the terms manually to analyse the offer.', link: `/negotiations/${deal._id}`, severity: 'warning', dedupeKey: `offer:${message._id}` });
      }
      break;
    }
    case 'positive_interest':
    case 'information_request':
    case 'question': {
      tryTransition(deal, intent === 'positive_interest' ? 'positive_response' : 'information_requested', { actorType: 'brand', reason: `Brand reply: ${intent}` });
      await deal.save();
      if (!conversation.humanTakeover && aiStatus().provider !== 'disabled') {
        const reply = await draftResponse(creatorId, conversation._id, { kind: 'info_reply' });
        result.replyApprovalId = reply.approvalId;
      }
      await notify(creatorId, { type: 'brand_replied', title: `${brand.name} replied`, body: classification?.data.summary || 'Review the reply in your inbox.', link: `/inbox?conversation=${conversation._id}`, dedupeKey: `reply:${message._id}` });
      break;
    }
    default: {
      tryTransition(deal, 'awaiting_creator_decision', { actorType: 'system', reason: intent ? 'Reply needs review' : 'Reply received; AI classification unavailable' });
      await deal.save();
      await notify(creatorId, { type: 'brand_replied', title: `${brand.name} replied`, body: intent ? 'Review the reply in your inbox.' : 'AI classification is unavailable; review the reply manually.', link: `/inbox?conversation=${conversation._id}`, dedupeKey: `reply:${message._id}` });
    }
  }
  await recordAudit({ actorType: 'brand', creatorId, eventType: simulated ? 'inbound.simulated' : 'inbound.received', resourceType: 'message', resourceId: message._id, metadata: { intent, provider } });
  return result;
}

export async function getNegotiation(creatorId, dealId) {
  const deal = await Deal.findOne({ _id: dealId, creatorId }).lean();
  if (!deal) throw notFound('Deal');
  const [brand, conversation, messages, approvals, profile, campaign] = await Promise.all([
    BrandProfile.findById(deal.brandId).lean(),
    deal.conversationId ? Conversation.findOne({ _id: deal.conversationId, creatorId }).lean() : null,
    deal.conversationId ? Message.find({ conversationId: deal.conversationId, creatorId }).sort({ createdAt: 1 }).lean() : [],
    ApprovalRequest.find({ dealId: deal._id, creatorId }).sort({ createdAt: -1 }).limit(20).lean(),
    CreatorProfile.findOne({ userId: creatorId }, { commercialPolicy: 1, barterPolicy: 1, negotiationAutonomy: 1 }).lean(),
    Campaign.findOne({ dealId: deal._id, creatorId }, { _id: 1, status: 1 }).lean(),
  ]);
  return { deal, brand, conversation, messages, approvals, boundaries: profile, campaign };
}
