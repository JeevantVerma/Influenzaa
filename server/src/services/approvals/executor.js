import { ApprovalRequest, Deal, Message, Opportunity } from '../../models/index.js';
import { hashObject } from '../../lib/crypto.js';
import { AppError, conflict } from '../../lib/errors.js';
import { enqueueJob } from '../../jobs/queue.js';
import { recordAudit } from '../audit.service.js';
import { computeActionHash } from './actionHash.js';
import { transition, tryTransition } from '../negotiation/stateMachine.js';

export class ActionNotAuthorizedError extends AppError {
  constructor(message) {
    super(403, 'not_authorized', message);
    this.name = 'ActionNotAuthorizedError';
  }
}

/**
 * The ONLY entry point that executes gated actions. It requires a persisted
 * approval record in status "approved" whose stored action still hashes to the
 * approved hash and whose bound terms version still matches the deal. AI code
 * paths have no way to produce such a record; they can only create pending
 * requests.
 */
export async function executeApprovedAction(approvalId, actor = { actorType: 'system' }) {
  const approval = await ApprovalRequest.findById(approvalId);
  if (!approval) throw new ActionNotAuthorizedError('No approval record exists for this action');
  if (approval.status !== 'approved') throw new ActionNotAuthorizedError(`Approval is ${approval.status}, not approved`);
  if (computeActionHash(approval) !== approval.actionHash) throw new ActionNotAuthorizedError('Approved action does not match its approval hash');
  if (approval.executionStatus !== 'not_started') return approval; // idempotent re-entry

  const action = approval.proposedAction;
  const fail = async (reason) => {
    await ApprovalRequest.updateOne({ _id: approval._id }, { $set: { status: 'failed', executionStatus: 'failed', executionResult: { error: reason } } });
    await recordAudit({ ...actor, creatorId: approval.creatorId, eventType: 'action.execution_failed', resourceType: 'approval', resourceId: approval._id, metadata: { reason } });
  };

  // Check the message is still sendable before changing any deal state, so a
  // cancelled or already-sent draft cannot leave the deal half-updated.
  if (action.messageId && !(await Message.exists({ _id: action.messageId, creatorId: approval.creatorId, deliveryStatus: 'draft' }))) {
    await fail('Message is no longer a draft');
    throw conflict('This message was already sent or cancelled.');
  }

  if (approval.dealId) {
    const deal = await Deal.findOne({ _id: approval.dealId, creatorId: approval.creatorId });
    if (!deal) {
      await fail('Deal not found');
      throw conflict('Deal not found');
    }
    if (deal.termsVersion !== approval.boundTermsVersion) {
      await fail('Offer terms changed before execution');
      throw conflict('The offer changed before this action could run. Review the new terms.');
    }
    if (approval.actionType === 'accept_offer') {
      deal.acceptedTerms = action.terms;
      deal.acceptedTermsHash = hashObject(action.terms);
      transition(deal, 'terms_agreed_subject_to_formalization', { actorType: 'creator', reason: 'Offer accepted subject to written agreement' });
      deal.approvalState = 'approved';
    } else if (approval.actionType === 'decline_offer') {
      transition(deal, 'declined', { actorType: 'creator', reason: action.reason || 'Declined by creator' });
      deal.approvalState = 'none';
      if (deal.opportunityId) await Opportunity.updateOne({ _id: deal.opportunityId, creatorId: deal.creatorId }, { $set: { status: 'lost' } });
    } else if (approval.actionType === 'send_counteroffer') {
      deal.proposedTerms = action.terms;
      deal.offerHistory.push({ version: deal.termsVersion, source: 'creator_counter', at: new Date(), messageId: action.messageId, terms: action.terms });
      tryTransition(deal, 'counteroffer_requires_approval', { actorType: 'system', reason: 'Counteroffer approved for sending' });
      deal.approvalState = 'approved';
    } else {
      deal.approvalState = 'none';
    }
    await deal.save();
  }

  if (action.messageId) {
    // Freeze the exact approved text onto the message before queueing.
    const res = await Message.updateOne(
      { _id: action.messageId, creatorId: approval.creatorId, deliveryStatus: 'draft' },
      {
        $set: {
          deliveryStatus: 'queued',
          subject: action.subject,
          content: action.content,
          toAddresses: action.to,
          approvalStatus: approval.createdBy === 'system' ? 'auto_authorized' : 'approved',
        },
      },
    );
    if (res.matchedCount === 0) {
      await fail('Message is no longer a draft');
      throw conflict('This message was already sent or cancelled.');
    }
    const { job } = await enqueueJob({
      jobType: 'message.send',
      creatorId: approval.creatorId,
      payload: { messageId: String(action.messageId), approvalId: String(approval._id) },
      idempotencyKey: `send:${approval._id}`,
      maxAttempts: 5,
    });
    await ApprovalRequest.updateOne({ _id: approval._id }, { $set: { executionStatus: 'queued', executionJobId: job._id } });
  } else {
    await ApprovalRequest.updateOne({ _id: approval._id }, { $set: { executionStatus: 'succeeded', status: 'executed', executedAt: new Date() } });
  }
  await recordAudit({ ...actor, creatorId: approval.creatorId, eventType: 'action.executed', resourceType: 'approval', resourceId: approval._id, metadata: { actionType: approval.actionType } });
  return ApprovalRequest.findById(approval._id);
}
