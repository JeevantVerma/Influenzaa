import mongoose from 'mongoose';
import { DELIVERABLE_TYPES, objectId } from './shared.js';

const rateSchema = new mongoose.Schema(
  {
    deliverable: { type: String, enum: DELIVERABLE_TYPES, required: true },
    preferredMinor: { type: Number, required: true, min: 0 },
    minimumMinor: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const platformSchema = new mongoose.Schema(
  {
    platform: { type: String, enum: ['instagram', 'youtube', 'linkedin', 'x', 'facebook', 'snapchat', 'moj', 'josh', 'sharechat', 'podcast', 'blog', 'other'] },
    handle: String,
    url: String,
    followers: { type: Number, default: null },
    // Creator-entered metrics are never presented as verified.
    metricsSource: { type: String, enum: ['creator_entered', 'verified_api'], default: 'creator_entered' },
  },
  { _id: false },
);

export const ONBOARDING_STEPS = ['identity', 'audience', 'commercial', 'automation'];

export const MANDATORY_APPROVAL_CATEGORIES = [
  'accept_or_reject_offer',
  'counteroffer_outside_rules',
  'out_of_scope_deliverables',
  'exclusivity',
  'content_rights',
  'unusual_payment_terms',
  'contract',
  'sensitive_representation',
  'sensitive_message',
  'barter_outside_policy',
];

const creatorProfileSchema = new mongoose.Schema(
  {
    userId: { type: objectId, ref: 'User', required: true, unique: true },
    publicName: { type: String, trim: true, maxlength: 120 },
    bio: { type: String, maxlength: 2000 },
    country: { type: String, default: 'India' },
    city: String,
    languages: [String],
    creatorType: { type: String, enum: ['individual', 'duo_group', 'channel_brand', 'expert_professional', null], default: null },
    platformProfiles: [platformSchema],
    niches: [String],
    contentFormats: [String],
    audienceMetrics: {
      ageRanges: [String],
      genderSplit: String,
      topLocations: [String],
      avgViews: { type: Number, default: null },
      engagementRatePercent: { type: Number, default: null },
      postingFrequency: String,
      source: { type: String, enum: ['creator_entered', 'verified_api'], default: 'creator_entered' },
      updatedAt: Date,
    },
    mediaKitUrl: String,
    brandPreferences: {
      preferredCategories: [String],
      prohibitedCategories: [String],
      preferredBrands: [String],
      avoidBrands: [String],
    },
    barterPolicy: {
      acceptance: { type: String, enum: ['never', 'selective', 'open'], default: 'selective' },
      minimumValueMinor: { type: Number, default: null },
      approvedCategories: [String],
    },
    commercialPolicy: {
      currency: { type: String, default: 'INR' },
      minimumDealMinor: { type: Number, default: null },
      preferredDealMinor: { type: Number, default: null },
      rates: [rateSchema],
      acceptedDeliverables: [{ type: String, enum: DELIVERABLE_TYPES }],
      maxPackageDiscountPercent: { type: Number, default: 10, min: 0, max: 50 },
      maxRevisions: { type: Number, default: 2, min: 0 },
      usageRights: {
        organicRepostAllowed: { type: Boolean, default: true },
        maxUsageDays: { type: Number, default: 90 },
        paidAdsAllowed: { type: Boolean, default: false },
        whitelistingAllowed: { type: Boolean, default: false },
        perpetualAllowed: { type: Boolean, default: false },
      },
      exclusivity: {
        acceptable: { type: Boolean, default: false },
        maxDays: { type: Number, default: 0 },
      },
      paymentTerms: {
        maxNetDays: { type: Number, default: 30 },
        minAdvancePercent: { type: Number, default: 0 },
      },
      cancellationPolicy: String,
      workload: {
        maxActiveCampaigns: { type: Number, default: 4 },
        minLeadTimeDays: { type: Number, default: 7 },
      },
      collaborationChannels: [String],
      paymentPreferences: String,
    },
    automation: {
      outreachChannels: { type: [String], default: ['email'] },
      autoSendPitches: { type: Boolean, default: false },
      followUps: {
        enabled: { type: Boolean, default: true },
        autoSend: { type: Boolean, default: false },
        maxAttempts: { type: Number, default: 2, min: 0, max: 5 },
        intervalBusinessDays: { type: Number, default: 4, min: 1, max: 30 },
      },
    },
    negotiationAutonomy: {
      level: { type: Number, enum: [0, 1, 2, 3], default: 0 },
      updatedAt: Date,
    },
    approvalPolicy: {
      // Mandatory categories are always enforced; these are extra categories
      // the creator chose to gate on top of the mandatory set.
      additionalCategories: [String],
      approvalExpiryHours: { type: Number, default: 72, min: 1, max: 720 },
    },
    notifications: {
      inApp: { type: Boolean, default: true },
      emailDigest: { type: Boolean, default: false },
      newOpportunities: { type: Boolean, default: true },
      approvals: { type: Boolean, default: true },
      deadlines: { type: Boolean, default: true },
    },
    onboardingStatus: {
      completedSteps: [{ type: String, enum: ONBOARDING_STEPS }],
      currentStep: { type: String, default: 'identity' },
      completed: { type: Boolean, default: false },
      completedAt: Date,
    },
  },
  { timestamps: true },
);

export const CreatorProfile = mongoose.models.CreatorProfile || mongoose.model('CreatorProfile', creatorProfileSchema);
