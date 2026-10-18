import mongoose from 'mongoose';
import { DELIVERABLE_TYPES, objectId } from './shared.js';

export const CAMPAIGN_STAGES = [
  'terms_agreed',
  'agreement_pending',
  'agreement_confirmed',
  'brief_pending',
  'product_or_assets_pending',
  'content_in_production',
  'draft_submitted',
  'revision_requested',
  'approved_for_publication',
  'published',
  'invoice_issued',
  'payment_pending',
  'payment_received',
  'completed',
];

export const DELIVERABLE_STATUSES = ['pending', 'in_production', 'draft_submitted', 'revision_requested', 'approved', 'published'];

const deliverableSchema = new mongoose.Schema({
  type: { type: String, enum: [...DELIVERABLE_TYPES, 'other'], required: true },
  description: String,
  quantity: { type: Number, default: 1, min: 1 },
  dueAt: Date,
  publishAt: Date,
  status: { type: String, enum: DELIVERABLE_STATUSES, default: 'pending' },
  revisionsAllowed: { type: Number, default: 2 },
  revisionsUsed: { type: Number, default: 0 },
  publishedUrl: String,
  publishedAt: Date,
  notes: String,
});

const campaignSchema = new mongoose.Schema(
  {
    creatorId: { type: objectId, ref: 'User', required: true },
    dealId: { type: objectId, ref: 'Deal', required: true, unique: true },
    brandId: { type: objectId, ref: 'BrandProfile', required: true },
    title: { type: String, required: true },
    status: { type: String, enum: CAMPAIGN_STAGES, default: 'terms_agreed' },
    stageHistory: [new mongoose.Schema({ from: String, to: String, at: Date }, { _id: false })],
    compensation: {
      paymentType: String,
      amountMinor: { type: Number, default: 0 },
      currency: { type: String, default: 'INR' },
      barterDescription: String,
      barterValueMinor: Number,
    },
    deliverables: [deliverableSchema],
    brief: {
      text: { type: String, maxlength: 20_000 },
      mandatoryDisclosures: [String],
      receivedAt: Date,
    },
    deadlines: { contentDueAt: Date, publishAt: Date },
    usageRights: { type: mongoose.Schema.Types.Mixed },
    exclusivity: { type: mongoose.Schema.Types.Mixed },
    agreement: { kind: String, reference: String, url: String, confirmedAt: Date },
    productShipment: { status: { type: String, enum: ['not_applicable', 'pending', 'shipped', 'received'], default: 'not_applicable' }, notes: String },
    publicationEvidence: [
      new mongoose.Schema({ url: String, deliverableId: objectId, addedAt: Date }, { _id: false }),
    ],
    invoiceIds: [{ type: objectId, ref: 'Invoice' }],
    paymentStatus: {
      type: String,
      enum: ['not_invoiced', 'invoiced', 'payment_pending', 'partially_paid', 'paid', 'overdue'],
      default: 'not_invoiced',
    },
    completedAt: Date,
    report: { summary: String, generatedAt: Date },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

campaignSchema.index({ creatorId: 1, status: 1 });
campaignSchema.index({ 'deliverables.dueAt': 1 });

export const Campaign = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema);
