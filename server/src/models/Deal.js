import mongoose from 'mongoose';
import { objectId, termsSchema } from './shared.js';

export const NEGOTIATION_STATES = [
  'initial_outreach',
  'awaiting_reply',
  'positive_response',
  'information_requested',
  'offer_received',
  'offer_under_analysis',
  'counteroffer_requires_approval',
  'counteroffer_sent',
  'terms_under_negotiation',
  'awaiting_creator_decision',
  'terms_agreed_subject_to_formalization',
  'agreement_pending',
  'deal_confirmed',
  'declined',
  'no_response',
  'closed',
];

const checkSchema = new mongoose.Schema(
  {
    code: String,
    label: String,
    status: { type: String, enum: ['ok', 'warning', 'requires_approval', 'violation', 'missing'] },
    detail: String,
  },
  { _id: false },
);

const dealSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    brandId: { type: objectId, ref: 'BrandProfile', required: true },
    opportunityId: { type: objectId, ref: 'Opportunity' },
    conversationId: { type: objectId, ref: 'Conversation' },
    campaignId: { type: objectId, ref: 'Campaign' },
    negotiationState: { type: String, enum: NEGOTIATION_STATES, default: 'initial_outreach' },
    status: { type: String, enum: ['open', 'won', 'lost', 'closed'], default: 'open' },
    // Incremented whenever the brand's offer or our proposed terms change.
    // Approvals are bound to a version and become invalid when it moves.
    termsVersion: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    offerHistory: [
      new mongoose.Schema(
        {
          version: Number,
          source: { type: String, enum: ['brand', 'creator_counter', 'manual_entry'] },
          at: { type: Date, default: Date.now },
          messageId: { type: objectId, ref: 'Message' },
          terms: termsSchema,
          extraction: {
            provider: String,
            model: String,
            missingTerms: [String],
            ambiguities: [String],
            summary: String,
            carriedForward: [String], // terms kept from the brand's earlier emails
            finalOffer: Boolean, // the brand said this offer is final
          },
        },
        { _id: false },
      ),
    ],
    currentOffer: { type: termsSchema, default: null },
    proposedTerms: { type: termsSchema, default: null },
    acceptedTerms: { type: termsSchema, default: null },
    acceptedTermsHash: String,
    analysis: {
      termsVersion: Number,
      at: Date,
      recommendation: { type: String, enum: ['accept', 'counter', 'clarify', 'decline', 'escalate', null], default: null },
      checks: [checkSchema],
      reasoning: [String],
      tradeoffs: [String],
      offerValueMinor: Number,
      benchmarkValueMinor: Number,
      floorValueMinor: Number,
      aiProvider: String,
      aiModel: String,
    },
    approvalState: { type: String, enum: ['none', 'pending', 'approved'], default: 'none' },
    agreementReference: {
      kind: { type: String, enum: ['email_confirmation', 'signed_contract', 'purchase_order', 'other', null], default: null },
      reference: String,
      url: String,
      confirmedAt: Date,
    },
    stateHistory: [
      new mongoose.Schema(
        { from: String, to: String, at: { type: Date, default: Date.now }, actorType: String, reason: String },
        { _id: false },
      ),
    ],
    closedReason: String,
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

dealSchema.index({ creatorId: 1, status: 1, updatedAt: -1 });
dealSchema.index({ creatorId: 1, opportunityId: 1 });
// One open sponsorship conversation per brand, enforced even under concurrent requests.
dealSchema.index({ creatorId: 1, brandId: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });

export const Deal = mongoose.models.Deal || mongoose.model('Deal', dealSchema);
