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
    brandDescription: { type: String, maxlength: 2000 },
    markets: [String],
    sourceEvidence: [evidenceSchema],
    lastVerifiedAt: Date,
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

brandProfileSchema.index({ name: 'text', categories: 'text' });

export const BrandProfile = mongoose.models.BrandProfile || mongoose.model('BrandProfile', brandProfileSchema);
