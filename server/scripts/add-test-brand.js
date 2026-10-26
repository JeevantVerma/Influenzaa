// Adds a clearly labelled TEST brand that shows up for every creator, whatever
// their niches, so the whole flow (pitch → reply → negotiation) can be tried
// with a real inbox you control. Emails to its contact are really sent by the
// configured email provider.
//
//   npm run db:add-test-brand -- --name=Jeevant --email=friend@example.com [--creator=you@example.com]
//
// The brand is flagged isDemo, has no website (domain <name>.test), and is never
// crawled. `npm run db:remove-demo -- --yes` removes it again.
import { getConfig } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import { User, CreatorProfile, BrandProfile, BrandContact, Opportunity } from '../src/models/index.js';
import { NICHES, NICHE_TO_CATEGORIES } from '../src/services/discovery/taxonomy.js';
import { dedupeKeyFor } from '../src/services/discovery/pipeline.js';
import { scoreOpportunity } from '../src/services/scoring/score.js';

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3).trim();
const name = arg('name');
const email = arg('email')?.toLowerCase();
const only = arg('creator')?.toLowerCase();
if (!name || !email || !isEmail(email)) {
  console.error('Usage: npm run db:add-test-brand -- --name=Jeevant --email=friend@example.com [--creator=you@example.com]');
  process.exit(1);
}
const cfg = getConfig();
if (cfg.isProd) {
  console.error('Refusing to add a test brand in production.');
  process.exit(1);
}

// Categories never used, so a creator's brand policy can't exclude the test brand.
const SENSITIVE = ['real_money_gaming', 'crypto', 'alcohol', 'tobacco', 'finance'];
const allCategories = [...new Set(NICHES.flatMap((n) => NICHE_TO_CATEGORIES[n] || []))].filter((c) => !SENSITIVE.includes(c));
const domain = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.test`;
const now = new Date();
const evidence = {
  title: `${name} is a test brand you added`,
  excerpt: `Not a real company. Added with npm run db:add-test-brand so you can test pitching and negotiating with ${email}. Emails to it are really sent.`,
  retrievedAt: now,
  source: 'manual',
  verification: 'demo',
  kind: 'fact',
};
const signal = { kind: 'creator_program', productOrCampaign: 'Test collaboration', title: `Test brand: ${name} wants to try a creator collaboration` };

await connectDatabase(cfg.mongoUri);
const brand = await BrandProfile.findOneAndUpdate(
  { normalizedDomain: domain },
  {
    $set: { name, isDemo: true, categories: allCategories, markets: ['India'], brandDescription: `Test brand for trying CreatorOS end to end (contact: ${email}).`, sourceEvidence: [evidence] },
    $unset: { officialWebsite: 1 },
  },
  { upsert: true, returnDocument: 'after' },
);

const users = await User.find(only ? { email: only } : {}, { email: 1 }).lean();
if (!users.length) console.log(only ? `No account with email ${only}` : 'No creator accounts yet');
for (const u of users) {
  const profile = await CreatorProfile.findOne({ userId: u._id }).lean();
  if (!profile) continue;
  // Private to this creator: other creators never see this address.
  const contact = await BrandContact.findOneAndUpdate(
    { brandId: brand._id, businessEmail: email, ownerCreatorId: u._id },
    { $set: { name: `${name} (test)`, role: 'Partnerships (test)', roleCategory: 'creator_partnerships', source: 'manual', verificationStatus: 'demo', confidence: 0.9, lastVerifiedAt: now, preferredChannel: 'email', isDemo: true } },
    { upsert: true, returnDocument: 'after' },
  );
  // Matches every niche: the creator's own niche categories, minus anything they rule out.
  const prohibited = profile.brandPreferences?.prohibitedCategories || [];
  const categories = [...new Set((profile.niches || []).flatMap((n) => NICHE_TO_CATEGORIES[n] || []))].filter((c) => !prohibited.includes(c) && !SENSITIVE.includes(c));
  const score = scoreOpportunity({ profile, brand: { name, categories: categories.length ? categories : allCategories, markets: ['India'] }, signal, evidence: [evidence], contactConfidence: 0.9, now });
  const dedupeKey = dedupeKeyFor(domain, signal);
  const opp = await Opportunity.findOneAndUpdate(
    { creatorId: u._id, dedupeKey },
    {
      $set: {
        brandId: brand._id,
        contactIds: [contact._id],
        signalType: 'high_intent',
        signalSummary: signal.title,
        productOrCampaign: signal.productOrCampaign,
        categories,
        sourceEvidence: [evidence],
        rationale: [{ kind: 'fact', text: 'Test brand you added. Use it to try the full flow with a real inbox.' }],
        outreachAngle: 'Pitch as you would a real brand; replies from the test inbox are picked up like any other.',
        recommendedAction: 'draft_pitch',
        fitScore: score.fitScore,
        timingScore: score.timingScore,
        contactConfidence: 0.9,
        overallScore: score.overallScore,
        scoreFactors: score.factors,
        scoringVersion: score.version,
        verificationStatus: 'demo',
        excluded: false,
        exclusionReason: null,
        lastVerifiedAt: now,
        isDemo: true,
      },
      $setOnInsert: { creatorId: u._id, dedupeKey, firstDiscoveredAt: now, lastMaterialChangeAt: now, status: 'new' },
    },
    { upsert: true, returnDocument: 'after' },
  );
  console.log(`${u.email}: ${name} added (score ${opp.overallScore}, contact ${email})`);
}
await disconnectDatabase();
