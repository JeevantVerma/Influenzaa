import mongoose from 'mongoose';
import { objectId } from './shared.js';

export const APPROVAL_ACTION_TYPES = [
  'send_pitch',
  'send_follow_up',
  'send_counteroffer',
  'send_reply',
  'accept_offer',
  'decline_offer',
  'send_payment_reminder',
];

const approvalRequestSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    dealId: { type: objectId, ref: 'Deal' },
    conversationId: { type: objectId, ref: 'Conversation' },
    messageId: { type: objectId, ref: 'Message' },
    actionType: { type: String, enum: APPROVAL_ACTION_TYPES, required: true },
    // The exact action that will be executed: recipients, subject, body and,
    // for commercial actions, the terms being committed to.
    proposedAction: { type: mongoose.Schema.Types.Mixed, required: true },
    // SHA-256 over the canonical proposed action + bound terms version.
    actionHash: { type: String, required: true },
    boundTermsVersion: { type: Number, default: null },
    reasons: [new mongoose.Schema({ code: String, label: String }, { _id: false })],
    policyChecks: [
      new mongoose.Schema(
        { code: String, label: String, status: String, detail: String },
        { _id: false },
      ),
    ],
    contextSnapshot: { type: mongoose.Schema.Types.Mixed },
    requiresExplicitConfirmation: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired', 'superseded', 'revoked', 'executed', 'failed'],
      default: 'pending',
    },
    createdBy: { type: String, enum: ['ai', 'system', 'creator'], default: 'ai' },
    expiresAt: { type: Date, required: true },
    reviewedAt: Date,
    reviewedBy: { type: objectId, ref: 'User' },
    reviewNote: String,
    editHistory: [new mongoose.Schema({ at: Date, previousHash: String, by: objectId }, { _id: false })],
    executionStatus: {
      type: String,
      enum: ['not_started', 'queued', 'executing', 'succeeded', 'failed', 'cancelled'],
      default: 'not_started',
    },
    executionJobId: { type: objectId, ref: 'ScheduledJob' },
    executionResult: { type: mongoose.Schema.Types.Mixed },
    executedAt: Date,
    supersededBy: { type: objectId, ref: 'ApprovalRequest' },
  },
  { timestamps: true },
);

approvalRequestSchema.index({ creatorId: 1, status: 1, createdAt: -1 });
approvalRequestSchema.index({ dealId: 1, status: 1 });
approvalRequestSchema.index({ status: 1, expiresAt: 1 });

export const ApprovalRequest = mongoose.models.ApprovalRequest || mongoose.model('ApprovalRequest', approvalRequestSchema);
