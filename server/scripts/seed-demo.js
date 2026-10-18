// Seeds a clearly-labelled DEMO creator account with a completed profile and a
// first discovery run from the fictional demo dataset. Demo records carry
// isDemo=true and are separate from real data.
//
//   npm run db:seed-demo
//
// Sign in with demo@creatoros.local and the password printed below (it is
// generated per run and written to server/.demo-credentials, which is gitignored).
import fs from 'node:fs';
import { getConfig } from '../src/config/env.js';
import { connectDatabase, initializeDatabase, disconnectDatabase } from '../src/db/connect.js';
import { User, CreatorProfile, DiscoveryConfiguration } from '../src/models/index.js';
import { register } from '../src/services/auth.service.js';
import { updateProfile } from '../src/services/profile.service.js';
import { runDiscovery } from '../src/services/discovery/pipeline.js';
import { connectEmail } from '../src/services/integrations.service.js';
import { randomToken } from '../src/lib/crypto.js';

const cfg = getConfig();
if (cfg.isProd && !process.env.ALLOW_DEMO_IN_PRODUCTION) {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
await connectDatabase(cfg.mongoUri);
await initializeDatabase();

const email = 'demo@creatoros.local';
if (await User.exists({ email })) {
  console.log('Demo creator already exists. Delete it first to reseed.');
  await disconnectDatabase();
  process.exit(0);
}
const password = `Demo-${randomToken(9)}`;
const { user } = await register({ name: 'Aisha Kapoor (demo)', email, password });
const id = user._id;
const r = (pref, min) => ({ preferredMinor: pref * 100, minimumMinor: min * 100 });
await updateProfile(id, {
  publicName: 'Aisha Kapoor (demo)',
  bio: 'Demo creator: fitness, healthy food and everyday wellness for working professionals in Bengaluru.',
  city: 'Bengaluru',
  languages: ['English', 'Hindi', 'Kannada'],
  creatorType: 'individual',
  platformProfiles: [
    { platform: 'instagram', handle: '@aisha.demo', followers: 48000 },
    { platform: 'youtube', handle: 'AishaDemo', followers: 12000 },
  ],
  niches: ['fitness', 'food', 'health'],
  contentFormats: ['Reels', 'YouTube videos', 'Stories'],
  completeStep: 'identity',
});
await updateProfile(id, { audienceMetrics: { topLocations: ['Bengaluru', 'Mumbai', 'Pune'], avgViews: 22000, engagementRatePercent: 4.2, postingFrequency: '4 posts/week' }, completeStep: 'audience' });
await updateProfile(id, {
  brandPreferences: { preferredCategories: ['fitness', 'health_wellness', 'footwear'], prohibitedCategories: ['real_money_gaming', 'alcohol', 'tobacco', 'crypto'], preferredBrands: [], avoidBrands: [] },
  barterPolicy: { acceptance: 'selective', minimumValueMinor: 1500000, approvedCategories: ['fitness', 'health_wellness'] },
  commercialPolicy: {
    currency: 'INR',
    minimumDealMinor: 1500000,
    preferredDealMinor: 6000000,
    rates: [
      { deliverable: 'instagram_reel', ...r(35000, 25000) },
      { deliverable: 'instagram_story', ...r(8000, 5000) },
      { deliverable: 'instagram_post', ...r(20000, 14000) },
      { deliverable: 'youtube_integration', ...r(60000, 45000) },
      { deliverable: 'youtube_short', ...r(18000, 12000) },
    ],
    acceptedDeliverables: ['instagram_reel', 'instagram_story', 'instagram_post', 'youtube_integration', 'youtube_short'],
    maxPackageDiscountPercent: 10,
    maxRevisions: 2,
    usageRights: { organicRepostAllowed: true, maxUsageDays: 90, paidAdsAllowed: true, whitelistingAllowed: false, perpetualAllowed: false },
    exclusivity: { acceptable: true, maxDays: 30 },
    paymentTerms: { maxNetDays: 30, minAdvancePercent: 0 },
  },
  completeStep: 'commercial',
});
await updateProfile(id, { automation: { followUps: { enabled: true, maxAttempts: 2, intervalBusinessDays: 4 } }, completeStep: 'automation' });
await connectEmail(id, { senderDisplayName: 'Aisha Kapoor (demo)' });

// Start discovery and run it once synchronously so the account has data.
await DiscoveryConfiguration.updateOne({ creatorId: id }, { $set: { status: 'running', startedAt: new Date(), nextRunAt: new Date(Date.now() + 24 * 3600_000) } });
const run = await runDiscovery({ creatorId: id, trigger: 'manual' });
fs.writeFileSync(new URL('../.demo-credentials', import.meta.url), `email=${email}\npassword=${password}\n`);
console.log(`Demo creator seeded. Opportunities created: ${run.opportunitiesCreated}`);
console.log(`Sign in with ${email} / ${password} (also saved to server/.demo-credentials)`);
await CreatorProfile.updateOne({ userId: id }, { $set: { 'onboardingStatus.completed': true } });
await disconnectDatabase();
