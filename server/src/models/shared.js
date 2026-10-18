import mongoose from 'mongoose';

export const DELIVERABLE_TYPES = [
  'instagram_reel',
  'instagram_story',
  'instagram_post',
  'youtube_integration',
  'youtube_dedicated',
  'youtube_short',
  'linkedin_post',
  'x_post',
  'blog_post',
  'podcast_mention',
  'event_appearance',
  'ugc_video',
];

export const DELIVERABLE_LABELS = {
  instagram_reel: 'Instagram Reel',
  instagram_story: 'Instagram Story',
  instagram_post: 'Instagram Post',
  youtube_integration: 'YouTube integration',
  youtube_dedicated: 'YouTube dedicated video',
  youtube_short: 'YouTube Short',
  linkedin_post: 'LinkedIn post',
  x_post: 'X post',
  blog_post: 'Blog post',
  podcast_mention: 'Podcast mention',
  event_appearance: 'Event appearance',
  ugc_video: 'UGC video (no posting)',
};

export const evidenceSchema = new mongoose.Schema(
  {
    url: { type: String, maxlength: 2048 },
    title: { type: String, maxlength: 500 },
    excerpt: { type: String, maxlength: 2000 },
    publishedAt: Date,
    retrievedAt: { type: Date, required: true },
    source: { type: String, required: true }, // adapter id: demo | rss | brave | manual
    // verified: fetched from an official/primary source; inferred: derived by
    // rules or AI from a source; unverified: secondary source not yet checked;
    // demo: deterministic demo dataset, never real.
    verification: { type: String, enum: ['verified', 'inferred', 'unverified', 'demo'], required: true },
    kind: { type: String, enum: ['fact', 'hypothesis'], default: 'fact' },
  },
  { _id: false },
);

// Normalised sponsorship terms. Unknown values stay null so that missing
// terms are visible instead of silently defaulted.
export const termsSchema = new mongoose.Schema(
  {
    paymentType: { type: String, enum: ['paid', 'barter', 'hybrid', null], default: null },
    totalAmountMinor: { type: Number, default: null },
    currency: { type: String, default: 'INR' },
    deliverables: [
      new mongoose.Schema(
        {
          type: { type: String, enum: [...DELIVERABLE_TYPES, 'other'] },
          quantity: { type: Number, default: 1, min: 1 },
          description: String,
          unitPriceMinor: { type: Number, default: null },
        },
        { _id: false },
      ),
    ],
    barter: {
      productDescription: { type: String, default: null },
      claimedRetailValueMinor: { type: Number, default: null },
    },
    revisionsIncluded: { type: Number, default: null },
    usageRights: {
      durationDays: { type: Number, default: null },
      paidAds: { type: Boolean, default: null },
      whitelisting: { type: Boolean, default: null },
      perpetual: { type: Boolean, default: null },
      notes: { type: String, default: null },
    },
    exclusivity: {
      required: { type: Boolean, default: null },
      durationDays: { type: Number, default: null },
      scope: { type: String, default: null },
    },
    paymentTerms: {
      netDays: { type: Number, default: null },
      advancePercent: { type: Number, default: null },
      notes: { type: String, default: null },
    },
    deadlines: {
      contentDueAt: { type: Date, default: null },
      publishAt: { type: Date, default: null },
      notes: { type: String, default: null },
    },
    cancellation: {
      killFeePercent: { type: Number, default: null },
      notes: { type: String, default: null },
    },
    otherConditions: [String],
  },
  { _id: false },
);

export const objectId = mongoose.Schema.Types.ObjectId;
