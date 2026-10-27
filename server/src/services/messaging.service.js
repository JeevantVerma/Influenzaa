import { ApprovalRequest, BrandContact, Conversation, CreatorProfile, Deal, IntegrationConnection, Message, Opportunity, Suppression, User } from '../models/index.js';
import { getEmailAdapter, buildOutboundEnvelope, EmailSendError } from './email/index.js';
import { instagramSendBlock, sendInstagramMessage, instagramToken, INSTAGRAM_WINDOW_CLOSED } from './instagram/send.js';
import { whatsappSendBlock, sendWhatsAppMessage, whatsappToken, WHATSAPP_WINDOW_CLOSED } from './whatsapp/send.js';
import { computeActionHash } from './approvals/actionHash.js';
import { approvalRequirement } from './approvals/requirements.js';
import { createApproval, createAutoAuthorization } from './approvals/approval.service.js';
import { NonRetryableError, enqueueJob } from '../jobs/queue.js';
import { tryTransition } from './negotiation/stateMachine.js';
import { recordAudit } from './audit.service.js';
import { notify } from './notification.service.js';
import { addBusinessDays } from '../lib/businessDays.js';

export const DISCLOSURE = (name) =>
  `\n\n—\n${name}\nSent via CreatorOS, an AI-assisted talent management service acting on ${name}'s behalf. If you would prefer not to hear from us again, reply "unsubscribe".`;

export function withDisclosure(body, creatorName) {
  const marker = 'Sent via CreatorOS, an AI-assisted';
  return body.includes(marker) ? body : `${body.trimEnd()}${DISCLOSURE(creatorName)}`;
}

// Instagram DMs are short (1000 bytes max), so the disclosure is one line.
export const DM_DISCLOSURE = '— sent via CreatorOS (AI-assisted)';
export const DM_MAX_BYTES = 1000;
export function withDmDisclosure(body) {
  return body.includes(DM_DISCLOSURE) ? body : `${body.trimEnd()}\n\n${DM_DISCLOSURE}`;
}
export const dmBytes = (text) => Buffer.byteLength(String(text || ''), 'utf8');

/** Returns a reason string if outreach to this address is suppressed for the creator. */
export async function suppressionFor(creatorId, emails) {
  const list = (emails || []).map((e) => String(e).toLowerCase());
  if (!list.length) return 'No recipient';
  const s = await Suppression.findOne({ email: { $in: list }, $or: [{ creatorId: null }, { creatorId }] }).lean();
  if (s) return `Recipient is suppressed (${s.reason.replace('_', ' ')})`;
  const dnc = await BrandContact.findOne({ businessEmail: { $in: list }, doNotContact: true, $or: [{ ownerCreatorId: null }, { ownerCreatorId: creatorId }] }).lean();
  if (dnc) return 'Contact is marked do-not-contact';
  return null;
}

export async function emailChannelStatus(creatorId) {
  const conn = await IntegrationConnection.findOne({ creatorId, provider: 'email' }).lean();
  const adapter = getEmailAdapter();
  // Consent given while sending was only simulated (status "demo") does not
  // authorise real sending: a live provider needs a "connected" authorisation.
  const authorized = conn && (adapter.mode === 'live' ? conn.status === 'connected' : ['connected', 'demo'].includes(conn.status));
  return { authorized: !!authorized, connection: conn, adapterMode: adapter.mode, adapterName: adapter.name };
}

/**
 * Turns a draft message into either a pending approval request or, where the
 * creator's autonomy rules explicitly allow it, an auto-authorised send.
 * Backend rules decide — the client cannot skip this.
 */
export async function proposeSend({ creatorId, conversation, deal, message, actionType, policyCategories = [], counterRule, terms, policyChecks = [], contextSnapshot = {}, extraReasons = [] }) {
  const profile = await CreatorProfile.findOne({ userId: creatorId }).lean();
  const req = approvalRequirement({ actionType, profile, content: message.content, policyCategories, counterRule, humanTakeover: conversation.humanTakeover });
  const chat = conversation.channel === 'instagram' || conversation.channel === 'whatsapp' ? conversation.channel : null;
  const authorized = chat === 'instagram' ? !!(await instagramToken(creatorId)) : chat === 'whatsapp' ? !!(await whatsappToken(creatorId)) : (await emailChannelStatus(creatorId)).authorized;
  const reasons = [...req.reasons, ...extraReasons];
  if (!authorized) reasons.push({ code: 'channel_not_authorized', label: chat === 'instagram' ? 'Instagram is not connected (Settings → Integrations)' : chat === 'whatsapp' ? 'WhatsApp is not connected (Settings → Integrations)' : 'Email sending is not authorised yet (Settings → Integrations)' });
  const proposedAction = {
    channel: chat || 'email',
    messageId: String(message._id),
    to: message.toAddresses,
    subject: message.subject,
    content: message.content,
    purpose: message.purpose,
    ...(terms ? { terms } : {}),
  };
  if (reasons.length === 0 && req.autoRule) {
    const approval = await createAutoAuthorization({ creatorId, deal, conversation, message, actionType, proposedAction, autoRule: req.autoRule, policyChecks, contextSnapshot });
    return { approval, autoAuthorized: true };
  }
  const approval = await createApproval({
    creatorId,
    deal,
    conversation,
    message,
    actionType,
    proposedAction,
    reasons: reasons.length ? reasons : [{ code: 'unknown_action', label: 'Approval required' }],
    policyChecks,
    contextSnapshot,
    requiresExplicitConfirmation: req.requiresExplicitConfirmation,
  });
  return { approval, autoAuthorized: false };
}

/** "Re: <original subject>", so every email after the first stays in the brand's thread. */
export function threadSubject(original) {
  const base = String(original || '').replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').trim();
  return base ? `Re: ${base}` : null;
}

/** Creates an outbound draft message on a conversation. */
export async function createDraft({ conversation, purpose, subject, body, creatorName, ai, to }) {
  // Once an email has gone out or come in, replies keep the original subject:
  // mail clients (Gmail especially) start a new thread when the subject changes.
  // Instagram and WhatsApp are chats: no subject, and a one-line AI disclosure.
  const instagram = conversation.channel === 'instagram' || conversation.channel === 'whatsapp';
  const threaded = !instagram && conversation.subject && (await Message.exists({ conversationId: conversation._id, providerMessageId: { $ne: null } }));
  if (threaded) subject = threadSubject(conversation.subject) || subject;
  if (instagram) subject = null; // DMs have no subject
  return Message.create({
    conversationId: conversation._id,
    creatorId: conversation.creatorId,
    direction: 'outbound',
    channel: conversation.channel,
    senderType: ai?.provider && ai.provider !== 'template' ? 'ai' : 'system',
    purpose,
    subject,
    content: instagram ? withDmDisclosure(body) : withDisclosure(body, creatorName),
    toAddresses: to,
    deliveryStatus: 'draft',
    approvalStatus: 'pending',
    provenance: 'draft',
    aiGenerated: !!ai && ai.provider !== 'template',
    aiProvider: ai?.provider,
    aiModel: ai?.model ?? undefined,
    metadata: ai?.fallbackReason ? { aiFallbackReason: ai.fallbackReason } : undefined,
  });
}

async function scheduleFollowUp(conversation, profile, from = new Date()) {
  const fu = profile.automation?.followUps;
  if (!fu?.enabled || conversation.followUpCount >= (fu.maxAttempts ?? 2)) {
    conversation.nextFollowUpAt = null;
    return null;
  }
  const at = addBusinessDays(from, fu.intervalBusinessDays ?? 4);
  conversation.nextFollowUpAt = at;
  await enqueueJob({
    jobType: 'followup.check',
    creatorId: conversation.creatorId,
    payload: { conversationId: String(conversation._id), attempt: conversation.followUpCount + 1 },
    scheduledAt: at,
    idempotencyKey: `followup:${conversation._id}:${conversation.followUpCount + 1}`,
    maxAttempts: 3,
  });
  return at;
}

async function markFailed(message, approval, reason, { notifyCreator = true } = {}) {
  await Message.updateOne({ _id: message._id }, { $set: { deliveryStatus: 'failed', failedAt: new Date(), failureReason: reason } });
  if (approval) await ApprovalRequest.updateOne({ _id: approval._id }, { $set: { status: 'failed', executionStatus: 'failed', executionResult: { error: reason } } });
  await recordAudit({ actorType: 'worker', creatorId: message.creatorId, eventType: 'message.send_failed', resourceType: 'message', resourceId: message._id, metadata: { reason } });
  if (notifyCreator) {
    await notify(message.creatorId, { type: 'send_failed', title: 'A message was not sent', body: reason, link: `/inbox?conversation=${message.conversationId}`, severity: 'critical', dedupeKey: `send-failed:${message._id}` });
  }
}

/** Job handler: delivers one approved outbound message. */
export async function deliverMessage({ messageId, approvalId }) {
  const message = await Message.findById(messageId);
  if (!message) throw new NonRetryableError('Message not found');
  if (['sent', 'simulated'].includes(message.deliveryStatus)) return { status: message.deliveryStatus, idempotent: true };
  if (['cancelled', 'failed'].includes(message.deliveryStatus)) return { status: message.deliveryStatus, skipped: true };
  const approval = await ApprovalRequest.findById(approvalId);

  // Re-validate the authorisation immediately before sending.
  if (!approval || approval.status !== 'approved' || String(approval.messageId) !== String(message._id) || computeActionHash(approval) !== approval.actionHash) {
    await markFailed(message, approval, 'Send blocked: no valid approval for this exact message');
    throw new NonRetryableError('No valid approval');
  }
  if (approval.proposedAction.content !== message.content || approval.proposedAction.subject !== message.subject) {
    await markFailed(message, approval, 'Send blocked: message differs from the approved version');
    throw new NonRetryableError('Content mismatch');
  }
  if (message.deliveryStatus === 'sending') {
    // A previous attempt was interrupted after handing the message to the
    // provider. Re-sending could duplicate it, so we stop and tell the creator.
    await markFailed(message, approval, 'Delivery outcome unknown after an interruption. Check your sent mail before retrying.');
    throw new NonRetryableError('Unknown outcome');
  }

  const conversation = await Conversation.findById(message.conversationId);
  if (!conversation) throw new NonRetryableError('Conversation not found');
  const suppressed = await suppressionFor(message.creatorId, message.toAddresses);
  if (suppressed) {
    await markFailed(message, approval, suppressed);
    throw new NonRetryableError(suppressed);
  }
  const instagram = conversation.channel === 'instagram';
  const whatsapp = conversation.channel === 'whatsapp';
  if (instagram || whatsapp) {
    // Checked before claiming the message, so a blocked message is never shown as sent.
    const blocked = instagram ? await instagramSendBlock(message, conversation) : await whatsappSendBlock(message, conversation);
    if (blocked) {
      await markFailed(message, approval, blocked);
      throw new NonRetryableError(blocked);
    }
  } else {
    const channel = await emailChannelStatus(message.creatorId);
    if (!channel.authorized) {
      await markFailed(message, approval, 'Email sending is not authorised for this account. Nothing was sent.');
      throw new NonRetryableError('Channel not authorised');
    }
  }

  const claimed = await Message.findOneAndUpdate(
    { _id: message._id, deliveryStatus: 'queued' },
    { $set: { deliveryStatus: 'sending' }, $inc: { sendAttempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!claimed) return { skipped: true, reason: 'not queued' };
  await ApprovalRequest.updateOne({ _id: approval._id }, { $set: { executionStatus: 'executing' } });

  const user = await User.findById(message.creatorId).lean();
  const profile = await CreatorProfile.findOne({ userId: message.creatorId }).lean();
  let result;
  if (instagram || whatsapp) {
    try {
      result = instagram ? await sendInstagramMessage(message, conversation) : await sendWhatsAppMessage(message, conversation);
    } catch (err) {
      if (err.retryable) {
        await Message.updateOne({ _id: message._id }, { $set: { deliveryStatus: 'queued', failureReason: err.message } });
        await ApprovalRequest.updateOne({ _id: approval._id }, { $set: { executionStatus: 'queued' } });
        throw err;
      }
      await markFailed(message, approval, err.windowClosed ? (instagram ? INSTAGRAM_WINDOW_CLOSED : WHATSAPP_WINDOW_CLOSED) : `${instagram ? 'Instagram' : 'WhatsApp'} did not accept the message: ${err.message}`);
      throw new NonRetryableError(err.message);
    }
  } else {
    const creatorName = profile?.publicName || user?.name || 'Creator';
    // Threading headers: reply to the latest email and list the whole thread.
    const earlier = await Message.find({ conversationId: conversation._id, providerMessageId: { $exists: true, $ne: null }, _id: { $ne: message._id } }, { providerMessageId: 1 }).sort({ createdAt: 1 }).lean();
    const lastExternal = earlier.at(-1);
    const references = [...new Set([conversation.externalThreadId, ...earlier.map((m) => m.providerMessageId)].filter(Boolean))].slice(-20);
    const envelope = buildOutboundEnvelope({
      creatorName,
      replyToken: conversation.replyToken,
      to: message.toAddresses,
      subject: message.subject,
      text: message.content,
      inReplyTo: lastExternal?.providerMessageId,
      references: references.length ? references : undefined,
    });
    try {
      result = await getEmailAdapter().send(envelope);
    } catch (err) {
      const retryable = err instanceof EmailSendError ? err.retryable : true;
      if (retryable) {
        // Safe to retry: the provider definitively did not accept the message.
        await Message.updateOne({ _id: message._id }, { $set: { deliveryStatus: 'queued', failureReason: err.message } });
        await ApprovalRequest.updateOne({ _id: approval._id }, { $set: { executionStatus: 'queued' } });
        throw err;
      }
      await markFailed(message, approval, err.message);
      if (err.permanentBounce) await recordBounce(message.creatorId, message.toAddresses, message._id);
      throw new NonRetryableError(err.message);
    }
  }

  const now = new Date();
  await Message.updateOne(
    { _id: message._id },
    { $set: { deliveryStatus: result.status, sentAt: now, providerMessageId: result.providerMessageId, providerName: result.provider, externalMessageId: `${result.provider}:${result.providerMessageId}`, provenance: result.status === 'simulated' ? 'simulated' : 'provider', failureReason: null } },
  );
  await ApprovalRequest.updateOne({ _id: approval._id }, { $set: { status: 'executed', executionStatus: 'succeeded', executedAt: now, executionResult: { deliveryStatus: result.status, provider: result.provider } } });

  conversation.lastOutboundAt = now;
  conversation.lastMessageAt = now;
  if (!conversation.externalThreadId && !instagram && !whatsapp) conversation.externalThreadId = result.providerMessageId;
  if (message.purpose === 'follow_up') conversation.followUpCount += 1;

  const deal = conversation.dealId ? await Deal.findById(conversation.dealId) : null;
  if (deal) {
    const actorType = approval.createdBy === 'system' ? 'system' : 'creator';
    if (message.purpose === 'pitch' || message.purpose === 'follow_up') tryTransition(deal, 'awaiting_reply', { actorType, reason: `${message.purpose} sent` });
    if (message.purpose === 'counteroffer') tryTransition(deal, 'counteroffer_sent', { actorType, reason: 'Counteroffer sent' });
    if (message.purpose === 'clarification' || message.purpose === 'reply') tryTransition(deal, 'awaiting_reply', { actorType, reason: 'Reply sent' });
    if (message.purpose === 'acceptance') tryTransition(deal, 'agreement_pending', { actorType, reason: 'Acceptance sent; awaiting written agreement' });
    deal.approvalState = 'none';
    await deal.save();
    if (deal.opportunityId && message.purpose === 'pitch') {
      await Opportunity.updateOne({ _id: deal.opportunityId, status: { $in: ['new', 'saved', 'outreach_drafted'] } }, { $set: { status: 'contacted' } });
    }
  }
  if (['pitch', 'follow_up'].includes(message.purpose) && !conversation.humanTakeover && !instagram && !whatsapp) {
    await scheduleFollowUp(conversation, profile, now);
  }
  await conversation.save();
  await recordAudit({ actorType: 'worker', creatorId: message.creatorId, eventType: result.status === 'simulated' ? 'message.simulated' : 'message.sent', resourceType: 'message', resourceId: message._id, metadata: { provider: result.provider, purpose: message.purpose } });
  return { status: result.status, provider: result.provider };
}

/** Final failure hook for retryable send errors that exhausted all attempts. */
export async function onSendExhausted({ messageId, approvalId }, err) {
  const message = await Message.findById(messageId);
  if (!message || !['queued', 'sending'].includes(message.deliveryStatus)) return;
  const approval = await ApprovalRequest.findById(approvalId);
  await markFailed(message, approval, `Delivery failed after several attempts: ${err?.message || 'provider error'}`);
}

export async function recordBounce(creatorId, emails, messageId) {
  for (const email of emails || []) {
    const e = String(email).toLowerCase();
    await Suppression.updateOne({ email: e, creatorId: null }, { $setOnInsert: { email: e, creatorId: null, reason: 'bounce', sourceMessageId: messageId } }, { upsert: true });
    await BrandContact.updateMany({ businessEmail: e }, { $set: { doNotContact: true }, $inc: { bounceCount: 1 } });
  }
  await recordAudit({ actorType: 'system', creatorId, eventType: 'contact.bounced', resourceType: 'message', resourceId: messageId });
}
