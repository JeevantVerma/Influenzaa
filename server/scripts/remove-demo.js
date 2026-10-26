// Removes all demo data: the seeded demo creator (demo@creatoros.local), the
// fictional demo brands and their contacts, and every demo opportunity, deal,
// conversation, campaign and invoice in any account. Real data is untouched.
//
//   npm run db:remove-demo            # dry run: shows what would be removed
//   npm run db:remove-demo -- --yes   # removes it
//
// Re-create the demo account later with `npm run db:seed-demo`.
import fs from 'node:fs';
import { getConfig } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import { User, BrandProfile, BrandContact, Opportunity, Deal, Conversation, Message, ApprovalRequest, Campaign, Invoice } from '../src/models/index.js';
import { eraseCreator } from '../src/services/account.service.js';

const apply = process.argv.includes('--yes');
await connectDatabase(getConfig().mongoUri);

const demoUser = await User.findOne({ email: 'demo@creatoros.local' }, { _id: 1 }).lean();
const brandIds = (await BrandProfile.find({ isDemo: true }, { _id: 1 }).lean()).map((b) => b._id);
const byBrand = { $or: [{ isDemo: true }, { brandId: { $in: brandIds } }] };
const dealIds = (await Deal.find(byBrand, { _id: 1 }).lean()).map((d) => d._id);
const conversationIds = (await Conversation.find({ $or: [...byBrand.$or, { dealId: { $in: dealIds } }] }, { _id: 1 }).lean()).map((c) => c._id);
const campaignIds = (await Campaign.find({ $or: [...byBrand.$or, { dealId: { $in: dealIds } }] }, { _id: 1 }).lean()).map((c) => c._id);

const plan = [
  ['opportunities', Opportunity, byBrand],
  ['deals', Deal, { _id: { $in: dealIds } }],
  ['conversations', Conversation, { _id: { $in: conversationIds } }],
  ['messages', Message, { conversationId: { $in: conversationIds } }],
  ['approvals', ApprovalRequest, { $or: [{ dealId: { $in: dealIds } }, { conversationId: { $in: conversationIds } }] }],
  ['campaigns', Campaign, { _id: { $in: campaignIds } }],
  ['invoices', Invoice, { campaignId: { $in: campaignIds } }],
  ['brand contacts', BrandContact, byBrand],
  ['demo brands', BrandProfile, { _id: { $in: brandIds } }],
];

console.log(apply ? 'Removing demo data:' : 'Dry run (add --yes to remove):');
console.log(`  demo account demo@creatoros.local: ${demoUser ? 'yes' : 'not present'}`);
if (apply && demoUser) await eraseCreator(demoUser._id);
for (const [label, Model, filter] of plan) {
  const n = apply ? (await Model.deleteMany(filter)).deletedCount : await Model.countDocuments(filter);
  console.log(`  ${label}: ${n}`);
}
const creds = new URL('../.demo-credentials', import.meta.url);
if (apply && fs.existsSync(creds)) fs.rmSync(creds);
await disconnectDatabase();
