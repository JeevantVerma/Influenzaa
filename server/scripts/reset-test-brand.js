// Clears every conversation with a TEST brand (one added with db:add-test-brand)
// so the whole flow can be tried again from the pitch: messages, deals,
// approvals, campaigns, invoices, pending jobs and notifications. The brand,
// its contact and the audit trail are kept; the match goes back to "new".
//
//   npm run db:reset-test-brand -- --name=Jeevant
//
// Only works on test brands (domain <name>.test), never on real ones. Emails
// already in Gmail inboxes are not touched.
import { getConfig } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import { BrandProfile, Deal, Conversation, Message, ApprovalRequest, Campaign, Invoice, ScheduledJob, Notification, Opportunity } from '../src/models/index.js';

const name = process.argv.find((a) => a.startsWith('--name='))?.slice(7).trim();
if (!name) {
  console.error('Usage: npm run db:reset-test-brand -- --name=Jeevant');
  process.exit(1);
}
const domain = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.test`;
await connectDatabase(getConfig().mongoUri);
const brand = await BrandProfile.findOne({ normalizedDomain: domain, isDemo: true }).lean();
if (!brand) {
  console.error(`No test brand ${domain} (add one with db:add-test-brand).`);
  await disconnectDatabase();
  process.exit(1);
}
const dealIds = (await Deal.find({ brandId: brand._id }, { _id: 1 }).lean()).map((d) => d._id);
const convIds = (await Conversation.find({ $or: [{ brandId: brand._id }, { dealId: { $in: dealIds } }] }, { _id: 1 }).lean()).map((c) => c._id);
const msgIds = (await Message.find({ conversationId: { $in: convIds } }, { _id: 1 }).lean()).map((m) => m._id);
const campIds = (await Campaign.find({ dealId: { $in: dealIds } }, { _id: 1 }).lean()).map((c) => c._id);
const ids = [...dealIds, ...convIds, ...msgIds].map(String);
const linkIds = [...dealIds, ...convIds].map(String);

const plan = [
  ['emails and drafts', Message, { conversationId: { $in: convIds } }],
  ['approvals', ApprovalRequest, { $or: [{ dealId: { $in: dealIds } }, { conversationId: { $in: convIds } }] }],
  ['invoices', Invoice, { campaignId: { $in: campIds } }],
  ['campaigns', Campaign, { _id: { $in: campIds } }],
  ['conversations', Conversation, { _id: { $in: convIds } }],
  ['deals', Deal, { _id: { $in: dealIds } }],
  ['pending background jobs', ScheduledJob, { status: { $in: ['pending', 'running'] }, $or: [{ 'payload.messageId': { $in: ids } }, { 'payload.conversationId': { $in: ids } }, { 'payload.dealId': { $in: ids } }] }],
  ['notifications', Notification, linkIds.length ? { link: { $regex: linkIds.join('|') } } : { _id: null }],
];
for (const [label, Model, filter] of plan) console.log(`deleted ${label}: ${(await Model.deleteMany(filter)).deletedCount}`);
const r = await Opportunity.updateMany({ brandId: brand._id }, { $set: { status: 'new', recommendedAction: 'draft_pitch' }, $unset: { pitchDraft: 1 } });
console.log(`${brand.name} match reset to new: ${r.matchedCount}`);
await disconnectDatabase();
