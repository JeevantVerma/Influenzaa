import mongoose from 'mongoose';
import { objectId } from './shared.js';

const brandContactSchema = new mongoose.Schema(
  {
    brandId: { type: objectId, ref: 'BrandProfile', required: true, index: true },
    // null = shared contact from a permitted source; set = private contact a
    // creator added or corrected manually (never shared with other creators).
    ownerCreatorId: { type: objectId, ref: 'User', default: null, index: true },
    name: { type: String, default: null },
    role: { type: String, default: null },
    roleCategory: {
      type: String,
      enum: ['creator_partnerships', 'brand_marketing', 'agency', 'general_partnerships', 'unknown'],
      default: 'unknown',
    },
    businessEmail: { type: String, lowercase: true, trim: true, default: null },
    professionalProfileUrl: String,
    sourceUrl: String,
    source: { type: String, enum: ['demo', 'public_page', 'provider', 'manual'], required: true },
    verificationStatus: { type: String, enum: ['verified', 'unverified', 'unknown', 'demo'], default: 'unknown' },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    lastVerifiedAt: Date,
    preferredChannel: { type: String, enum: ['email', 'whatsapp', 'instagram', 'unknown'], default: 'unknown' },
    doNotContact: { type: Boolean, default: false },
    bounceCount: { type: Number, default: 0 },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

brandContactSchema.index(
  { brandId: 1, businessEmail: 1, ownerCreatorId: 1 },
  { unique: true, partialFilterExpression: { businessEmail: { $type: 'string' } } },
);

export const BrandContact = mongoose.models.BrandContact || mongoose.model('BrandContact', brandContactSchema);
