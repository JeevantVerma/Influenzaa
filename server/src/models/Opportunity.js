import mongoose from 'mongoose';
import { evidenceSchema, objectId } from './shared.js';

export const OPPORTUNITY_STATUSES = [
  'new',
  'saved',
  'dismissed',
  'outreach_drafted',
  'contacted',
  'in_negotiation',
  'won',
  'lost',
  'archived',
];

const factorSchema = new mongoose.Schema(
  { key: String, label: String, impact: Number, detail: String },
  { _id: false },
);

const opportunitySchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    brandId: { type: objectId, ref: 'BrandProfile', required: true },
    contactIds: [{ type: objectId, ref: 'BrandContact' }],
    // Stable key: brand domain + normalised campaign/product signal. Prevents
    // re-creating or re-notifying the same unchanged opportunity.
    dedupeKey: { type: String, required: true },
    signalType: { type: String, enum: ['high_intent', 'medium_intent', 'low_intent'], required: true },
    signalSummary: { type: String, maxlength: 500 },
    productOrCampaign: String,
    categories: [String],
    sourceEvidence: [evidenceSchema],
    rationale: [
      new mongoose.Schema(
        { text: String, kind: { type: String, enum: ['fact', 'hypothesis'] } },
        { _id: false },
      ),
    ],
    outreachAngle: String,
    recommendedAction: String,
    fitScore: { type: Number, min: 0, max: 100 },
    timingScore: { type: Number, min: 0, max: 100 },
    contactConfidence: { type: Number, min: 0, max: 1, default: 0 },
    overallScore: { type: Number, min: 0, max: 100, index: true },
    scoreFactors: [factorSchema],
    scoringVersion: String,
    verificationStatus: { type: String, enum: ['verified', 'partially_verified', 'unverified', 'demo', 'stale'], required: true },
    excluded: { type: Boolean, default: false },
    exclusionReason: String,
    status: { type: String, enum: OPPORTUNITY_STATUSES, default: 'new' },
    feedback: {
      rating: { type: String, enum: ['relevant', 'not_relevant', null], default: null },
      note: String,
      at: Date,
    },
    pitchDraft: {
      subject: String,
      body: String,
      provider: String,
      model: String,
      contactId: { type: objectId, ref: 'BrandContact' },
      at: Date,
    },
    firstDiscoveredAt: { type: Date, required: true },
    lastVerifiedAt: Date,
    lastMaterialChangeAt: Date,
    notifiedAt: Date,
    dismissedAt: Date,
    savedAt: Date,
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

opportunitySchema.index({ creatorId: 1, dedupeKey: 1 }, { unique: true });
opportunitySchema.index({ creatorId: 1, status: 1, overallScore: -1 });
opportunitySchema.index({ creatorId: 1, brandId: 1 });

export const Opportunity = mongoose.models.Opportunity || mongoose.model('Opportunity', opportunitySchema);
