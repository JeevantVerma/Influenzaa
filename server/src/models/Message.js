import mongoose from 'mongoose';
import { objectId } from './shared.js';

export const DELIVERY_STATUSES = [
  'draft', // AI or creator draft, not sent
  'queued', // authorised and waiting for the send job
  'sending',
  'sent', // accepted by a real provider
  'simulated', // demo adapter: recorded, NOT delivered to anyone
  'failed',
  'cancelled',
  'received', // inbound from a provider webhook or simulation
  'logged', // manual note; not a verified external message
  'sent_by_creator', // the creator sent it themselves (e.g. a first Instagram DM); not verified by a provider
];

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: objectId, ref: 'Conversation', required: true },
    creatorId: { type: objectId, ref: 'User', required: true },
    // Provider-scoped message id (e.g. RFC 5322 Message-ID). Unique so that a
    // duplicate webhook delivery cannot create duplicate messages.
    externalMessageId: { type: String, default: undefined },
    direction: { type: String, enum: ['inbound', 'outbound', 'note'], required: true },
    channel: { type: String, enum: ['email', 'whatsapp', 'instagram', 'manual'], required: true },
    senderType: { type: String, enum: ['creator', 'ai', 'brand', 'system'], required: true },
    purpose: {
      type: String,
      enum: ['pitch', 'follow_up', 'counteroffer', 'acceptance', 'decline', 'clarification', 'reply', 'payment_reminder', 'inbound', 'note'],
      default: 'reply',
    },
    subject: String,
    content: { type: String, required: true, maxlength: 50_000 },
    fromAddress: String,
    toAddresses: [String],
    deliveryStatus: { type: String, enum: DELIVERY_STATUSES, required: true },
    approvalStatus: {
      type: String,
      enum: ['not_required', 'pending', 'approved', 'rejected', 'superseded', 'auto_authorized'],
      default: 'not_required',
    },
    provenance: { type: String, enum: ['provider', 'simulated', 'manual_note', 'draft'], required: true },
    aiGenerated: { type: Boolean, default: false },
    aiProvider: String,
    aiModel: String,
    providerMessageId: String,
    providerName: String,
    inReplyTo: String,
    receivedAt: Date,
    sentAt: Date,
    failedAt: Date,
    failureReason: String,
    sendAttempts: { type: Number, default: 0 },
    classification: {
      intent: String,
      confidence: Number,
      provider: String,
    },
    // Inbound only. Classification and negotiation steps run in the
    // `inbound.process` job, not inside the webhook request.
    inboundProcessing: {
      status: { type: String, enum: ['pending', 'processing', 'done', 'failed', 'interrupted'] },
      attempts: Number,
      lastError: String,
      processedAt: Date,
    },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index({ externalMessageId: 1 }, { unique: true, partialFilterExpression: { externalMessageId: { $type: 'string' } } });

export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
