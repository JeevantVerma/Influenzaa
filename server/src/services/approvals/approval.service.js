import { ApprovalRequest, CreatorProfile, Deal, Message, Conversation } from '../../models/index.js';
import { computeActionHash, normalizeAction } from './actionHash.js';
import { conflict, notFound, badRequest } from '../../lib/errors.js';
import { recordAudit } from '../audit.service.js';
import { notify } from '../notification.service.js';
import { cancelPendingJobs } from '../../jobs/queue.js';
import { unexpectedAmounts } from '../../lib/amounts.js';
import { isSensitiveText, REASON_LABELS } from './requirements.js';
import { executeApprovedAction } from './executor.js';

const ACTION_LABELS = {
  send_pitch: 'Send pitch email',
  send_follow_up: 'Send follow-up email',
  send_counteroffer: 'Send counteroffer',
  send_reply: 'Send reply',
  accept_offer: 'Accept offer (subject to written agreement)',
  decline_offer: 'Decline offer',
  send_payment_reminder: 'Send payment reminder',
};

/**
 * Persists an approval request. Any older pending request for the same
 * message or the same deal+action is superseded so only one version can be
 * approved.
 */
export async function createApproval({ creatorId, deal, conversation, message, actionType, proposedAction: rawAction, reasons, policyChecks = [], contextSnapshot = {}, requiresExplicitConfirmation = false, createdBy = 'ai' }) {
  const profile = await CreatorProfile.findOne({ userId: creatorId }, { approvalPolicy: 1 }).lean();
  const hours = profile?.approvalPolicy?.approvalExpiryHours ?? 72;
  const proposedAction = normalizeAction(rawAction);
  const boundTermsVersion = deal ? deal.termsVersion : null;
  const actionHash = computeActionHash({ actionType, proposedAction, boundTermsVersion });
  const approval = await ApprovalRequest.create({
    creatorId,
    dealId: deal?._id,
    conversationId: conversation?._id,
    messageId: message?._id,
    actionType,
    proposedAction,
    actionHash,
    boundTermsVersion,
    reasons,
    policyChecks,
    contextSnapshot,
    requiresExplicitConfirmation,
    createdBy,
    expiresAt: new Date(Date.now() + hours * 3600_000),
  });
  const supersedeFilter = { creatorId, status: 'pending', _id: { $ne: approval._id }, $or: [] };
  if (message) supersedeFilter.$or.push({ messageId: message._id });
  if (deal) supersedeFilter.$or.push({ dealId: deal._id, actionType });
  if (supersedeFilter.$or.length) {
    await ApprovalRequest.updateMany(supersedeFilter, { $set: { status: 'superseded', supersededBy: approval._id } });
  }
  if (message) await Message.updateOne({ _id: message._id }, { $set: { approvalStatus: 'pending' } });
  if (deal) await Deal.updateOne({ _id: deal._id }, { $set: { approvalState: 'pending' } });
  await notify(creatorId, {
    type: 'approval_required',
    title: `Approval needed: ${ACTION_LABELS[actionType] || actionType}`,
    body: contextSnapshot.brandName ? `For ${contextSnapshot.brandName}` : undefined,
    link: `/approvals?focus=${approval._id}`,
    severity: 'warning',
    dedupeKey: `approval:${approval._id}`,
  });
  await recordAudit({ actorType: createdBy === 'creator' ? 'creator' : 'ai', creatorId, eventType: 'approval.requested', resourceType: 'approval', resourceId: approval._id, metadata: { actionType, reasons: reasons.map((r) => r.code), actionHash } });
  return approval;
}

/**
 * Records a policy decision for an action that the creator's explicit
 * autonomy rules allow without manual approval. Stored as an already-approved
 * request so the execution path is identical and fully auditable.
 */
export async function createAutoAuthorization({ creatorId, deal, conversation, message, actionType, proposedAction: rawAction, autoRule, policyChecks = [], contextSnapshot = {} }) {
  const boundTermsVersion = deal ? deal.termsVersion : null;
  const proposedAction = normalizeAction(rawAction);
  const approval = await ApprovalRequest.create({
    creatorId,
    dealId: deal?._id,
    conversationId: conversation?._id,
    messageId: message?._id,
    actionType,
    proposedAction,
    actionHash: computeActionHash({ actionType, proposedAction, boundTermsVersion }),
    boundTermsVersion,
    reasons: [{ code: 'auto_authorized', label: autoRule }],
    policyChecks,
    contextSnapshot,
    status: 'approved',
    createdBy: 'system',
    reviewedAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });
  if (message) await Message.updateOne({ _id: message._id }, { $set: { approvalStatus: 'auto_authorized' } });
  await recordAudit({ actorType: 'system', creatorId, eventType: 'approval.auto_authorized', resourceType: 'approval', resourceId: approval._id, metadata: { actionType, rule: autoRule } });
  await executeApprovedAction(approval._id, { actorType: 'system' });
  return ApprovalRequest.findById(approval._id);
}

async function loadOwned(creatorId, id) {
  const approval = await ApprovalRequest.findOne({ _id: id, creatorId });
  if (!approval) throw notFound('Approval request');
  return approval;
}

async function markStale(approval, status, note) {
  await ApprovalRequest.updateOne({ _id: approval._id, status: 'pending' }, { $set: { status, reviewNote: note } });
  if (approval.messageId) await Message.updateOne({ _id: approval.messageId, deliveryStatus: 'draft' }, { $set: { approvalStatus: 'superseded' } });
}

export async function approve(creatorId, id, { actionHash, confirm }, reviewer) {
  const approval = await loadOwned(creatorId, id);
  if (approval.status !== 'pending') throw conflict(`This request is already ${approval.status}`);
  if (approval.expiresAt <= new Date()) {
    await markStale(approval, 'expired', 'Expired before review');
    throw conflict('This approval request has expired. Generate a new proposal.');
  }
  // The reviewer must have seen exactly this version.
  if (!actionHash || actionHash !== approval.actionHash) {
    throw conflict('The proposed action changed since you opened it. Review the latest version.', { currentHash: approval.actionHash });
  }
  if (approval.requiresExplicitConfirmation && confirm !== true) {
    throw badRequest('This is a material commitment. Confirm explicitly to approve it.');
  }
  // Tamper / drift check: recompute from the stored action.
  if (computeActionHash(approval) !== approval.actionHash) throw conflict('Approval integrity check failed');
  if (approval.dealId) {
    const deal = await Deal.findOne({ _id: approval.dealId, creatorId });
    if (!deal) throw notFound('Deal');
    if (deal.termsVersion !== approval.boundTermsVersion) {
      await markStale(approval, 'superseded', 'Offer terms changed after this request was created');
      throw conflict('The offer changed after this request was created. Review the new terms.');
    }
    if (['closed'].includes(deal.negotiationState) && approval.actionType !== 'send_payment_reminder') {
      throw conflict('This deal is closed.');
    }
  }
  // Atomic pending → approved; a second click or replay finds no pending doc.
  const updated = await ApprovalRequest.findOneAndUpdate(
    { _id: approval._id, creatorId, status: 'pending', actionHash },
    { $set: { status: 'approved', reviewedAt: new Date(), reviewedBy: reviewer } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('This request was already handled.');
  await recordAudit({ actorType: 'creator', actorId: reviewer, creatorId, eventType: 'approval.approved', resourceType: 'approval', resourceId: approval._id, metadata: { actionType: approval.actionType, actionHash } });
  await executeApprovedAction(updated._id, { actorType: 'creator', actorId: reviewer });
  return ApprovalRequest.findById(approval._id).lean();
}

export async function reject(creatorId, id, { note }, reviewer) {
  const approval = await loadOwned(creatorId, id);
  const updated = await ApprovalRequest.findOneAndUpdate(
    { _id: approval._id, status: 'pending' },
    { $set: { status: 'rejected', reviewedAt: new Date(), reviewedBy: reviewer, reviewNote: note } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict(`This request is already ${approval.status}`);
  if (approval.messageId) await Message.updateOne({ _id: approval.messageId }, { $set: { approvalStatus: 'rejected', deliveryStatus: 'cancelled' } });
  if (approval.dealId) {
    const deal = await Deal.findById(approval.dealId);
    if (deal) {
      deal.approvalState = 'none';
      if (deal.negotiationState === 'counteroffer_requires_approval') {
        deal.negotiationState = 'awaiting_creator_decision';
        deal.stateHistory.push({ from: 'counteroffer_requires_approval', to: 'awaiting_creator_decision', at: new Date(), actorType: 'creator', reason: 'Counteroffer rejected' });
      }
      await deal.save();
    }
  }
  await recordAudit({ actorType: 'creator', actorId: reviewer, creatorId, eventType: 'approval.rejected', resourceType: 'approval', resourceId: approval._id, metadata: { actionType: approval.actionType } });
  return updated.toObject();
}

/** Creator edits the message (and optionally the amount). Produces a new version to approve. */
export async function edit(creatorId, id, { subject, content, totalAmountMinor }, editor) {
  const approval = await loadOwned(creatorId, id);
  if (approval.status !== 'pending') throw conflict(`This request is already ${approval.status}`);
  const action = normalizeAction(approval.proposedAction);
  if (subject !== undefined) action.subject = subject;
  if (content !== undefined) action.content = content;
  const checks = (approval.policyChecks || []).filter((c) => !c.code.startsWith('edit_'));
  if (totalAmountMinor !== undefined) {
    if (!action.terms) throw badRequest('This action has no commercial terms to edit');
    action.terms = { ...action.terms, totalAmountMinor };
    const floor = approval.contextSnapshot?.floorValueMinor;
    if (floor && totalAmountMinor < floor) checks.push({ code: 'edit_below_floor', label: 'Below your minimum', status: 'warning', detail: 'You edited the fee below your own minimum rate.' });
  }
  if (isSensitiveText(action.content)) checks.push({ code: 'edit_sensitive', label: 'Sensitive content', status: 'warning', detail: 'The edited message contains legal, tax, medical or financial language.' });
  const allowed = action.terms?.totalAmountMinor != null ? [action.terms.totalAmountMinor / 100] : [];
  if (unexpectedAmounts(action.content || '', allowed).length) checks.push({ code: 'edit_amounts', label: 'Amounts in message', status: 'warning', detail: 'The message mentions an amount that differs from the proposed terms.' });

  const previousHash = approval.actionHash;
  approval.proposedAction = action;
  approval.markModified('proposedAction');
  approval.policyChecks = checks;
  approval.actionHash = computeActionHash({ actionType: approval.actionType, proposedAction: action, boundTermsVersion: approval.boundTermsVersion });
  approval.editHistory.push({ at: new Date(), previousHash, by: editor });
  await approval.save();
  if (approval.messageId) {
    await Message.updateOne({ _id: approval.messageId }, { $set: { subject: action.subject, content: action.content, senderType: 'creator' } });
  }
  await recordAudit({ actorType: 'creator', actorId: editor, creatorId, eventType: 'approval.edited', resourceType: 'approval', resourceId: approval._id, metadata: { previousHash, actionHash: approval.actionHash } });
  return approval.toObject();
}

/** Revoke an approved action before it executes. */
export async function revoke(creatorId, id, reviewer) {
  const approval = await loadOwned(creatorId, id);
  if (approval.status !== 'approved' || approval.executionStatus !== 'queued' || !approval.executionJobId) {
    throw conflict('Only approved actions still waiting to be sent can be revoked.');
  }
  const cancelled = await cancelPendingJobs({ _id: approval.executionJobId }, 'approval_revoked');
  if (!cancelled) throw conflict('The action is already being executed and can no longer be revoked.');
  await ApprovalRequest.updateOne({ _id: approval._id }, { $set: { status: 'revoked', executionStatus: 'cancelled', reviewNote: 'Revoked before execution' } });
  if (approval.messageId) await Message.updateOne({ _id: approval.messageId, deliveryStatus: 'queued' }, { $set: { deliveryStatus: 'cancelled' } });
  if (approval.dealId && approval.actionType === 'accept_offer') {
    // Acceptance had not been sent; the deal returns to a decision state.
    const deal = await Deal.findById(approval.dealId);
    if (deal?.negotiationState === 'terms_agreed_subject_to_formalization') {
      deal.negotiationState = 'awaiting_creator_decision';
      deal.acceptedTerms = null;
      deal.acceptedTermsHash = undefined;
      deal.stateHistory.push({ from: 'terms_agreed_subject_to_formalization', to: 'awaiting_creator_decision', at: new Date(), actorType: 'creator', reason: 'Acceptance revoked before sending' });
      await deal.save();
    }
  }
  await recordAudit({ actorType: 'creator', actorId: reviewer, creatorId, eventType: 'approval.revoked', resourceType: 'approval', resourceId: approval._id });
  return ApprovalRequest.findById(approval._id).lean();
}

/** Called when the brand's offer changes: pending approvals bound to the old terms become invalid. */
export async function supersedePendingForDeal(dealId, note) {
  const pending = await ApprovalRequest.find({ dealId, status: 'pending' }, { _id: 1, messageId: 1 }).lean();
  if (!pending.length) return 0;
  await ApprovalRequest.updateMany({ _id: { $in: pending.map((p) => p._id) } }, { $set: { status: 'superseded', reviewNote: note } });
  await Message.updateMany({ _id: { $in: pending.map((p) => p.messageId).filter(Boolean) }, deliveryStatus: 'draft' }, { $set: { approvalStatus: 'superseded' } });
  return pending.length;
}

export async function expireStaleApprovals(now = new Date()) {
  const stale = await ApprovalRequest.find({ status: 'pending', expiresAt: { $lte: now } }, { _id: 1, messageId: 1, creatorId: 1 }).limit(500).lean();
  for (const a of stale) {
    await markStale(a, 'expired', 'Expired without review');
    await recordAudit({ actorType: 'system', creatorId: a.creatorId, eventType: 'approval.expired', resourceType: 'approval', resourceId: a._id });
  }
  return stale.length;
}

export async function listApprovals(creatorId, { status, page = 1, limit = 20 }) {
  const filter = { creatorId };
  if (status === 'pending') filter.status = 'pending';
  else if (status === 'history') filter.status = { $ne: 'pending' };
  const [items, total] = await Promise.all([
    ApprovalRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ApprovalRequest.countDocuments(filter),
  ]);
  return { items: items.map(decorate), total, page, limit };
}

export async function getApproval(creatorId, id) {
  const a = await ApprovalRequest.findOne({ _id: id, creatorId }).lean();
  if (!a) throw notFound('Approval request');
  const conversation = a.conversationId ? await Conversation.findOne({ _id: a.conversationId, creatorId }, { subject: 1, status: 1 }).lean() : null;
  const recentMessages = a.conversationId
    ? await Message.find({ conversationId: a.conversationId, creatorId, _id: { $ne: a.messageId } }).sort({ createdAt: -1 }).limit(5).lean()
    : [];
  return { ...decorate(a), conversation, recentMessages: recentMessages.reverse() };
}

function decorate(a) {
  return { ...a, actionLabel: ACTION_LABELS[a.actionType] || a.actionType, reasonCatalog: undefined, isExpired: a.status === 'pending' && new Date(a.expiresAt) <= new Date() };
}

export { ACTION_LABELS, REASON_LABELS, computeActionHash, normalizeAction };
