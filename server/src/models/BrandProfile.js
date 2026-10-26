import mongoose from 'mongoose';
import { evidenceSchema } from './shared.js';

const brandProfileSchema = new mongoose.Schema(
  {
    normalizedDomain: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    industry: String,
    categories: [String],
    products: [
      new mongoose.Schema(
        { name: String, url: String, launchedAt: Date, description: String },
        { _id: false },
      ),
    ],
    officialWebsite: String,
    // Instagram handle (without @), when known from discovery.
    instagramHandle: { type: String, lowercase: true, trim: true },
    brandDescription: { type: String, maxlength: 2000 },
    markets: [String],
    sourceEvidence: [evidenceSchema],
    lastVerifiedAt: Date,
    // Last check of the brand's own website for published business emails.
    contactDiscovery: {
      status: { type: String, enum: ['queued', 'found', 'none_found', 'blocked_by_robots', 'access_denied', 'unreachable'] },
      queuedAt: Date,
      checkedAt: Date,
      pagesChecked: Number,
      contactsFound: Number,
      message: String,
    },
    // A creator/influencer/affiliate programme page found on the brand's own site.
    creatorProgramme: {
      url: String,
      title: String,
      detectedAt: Date,
    },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

brandProfileSchema.index({ name: 'text', categories: 'text' });
brandProfileSchema.index({ instagramHandle: 1 }, { sparse: true });

export const BrandProfile = mongoose.models.BrandProfile || mongoose.model('BrandProfile', brandProfileSchema);
