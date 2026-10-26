import mongoose from 'mongoose';

// Short-lived cache for discovery source results and brand lookups, shared by
// every creator with the same niche so paid and rate-limited APIs (Apify,
// Serper, GDELT, AI extraction) are not called once per creator. Only data the
// app produced itself is cached: candidates whose evidence comes from pages we
// fetched, and website/profile lookups.
const discoveryCacheSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

discoveryCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DiscoveryCache = mongoose.models.DiscoveryCache || mongoose.model('DiscoveryCache', discoveryCacheSchema);
