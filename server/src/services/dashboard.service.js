import { ApprovalRequest, AuditEvent, BrandProfile, Campaign, CreatorProfile, Deal, Invoice, Message, Notification, Opportunity } from '../models/index.js';
import { getDiscoveryStatus } from './discovery/discovery.service.js';

const ACTIVE_NEGOTIATION = ['positive_response', 'information_requested', 'offer_received', 'offer_under_analysis', 'counteroffer_requires_approval', 'counteroffer_sent', 'terms_under_negotiation', 'awaiting_creator_decision', 'terms_agreed_subject_to_formalization', 'agreement_pending'];

export async function getDashboard(creatorId) {
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 86_400_000);
  const [discovery, profile, newOpps, negotiations, pendingApprovals, approvalsCount, campaigns, invoices, activity, unread] = await Promise.all([
    getDiscoveryStatus(creatorId),
    CreatorProfile.findOne({ userId: creatorId }, { onboardingStatus: 1, publicName: 1, negotiationAutonomy: 1, 'commercialPolicy.currency': 1 }).lean(),
    Opportunity.find({ creatorId, excluded: false, status: 'new' }).sort({ overallScore: -1 }).limit(5).lean(),
    Deal.find({ creatorId, status: 'open', negotiationState: { $in: ACTIVE_NEGOTIATION } }).sort({ updatedAt: -1 }).limit(8).lean(),
    ApprovalRequest.find({ creatorId, status: 'pending', expiresAt: { $gt: now } }).sort({ createdAt: -1 }).limit(5).lean(),
    ApprovalRequest.countDocuments({ creatorId, status: 'pending', expiresAt: { $gt: now } }),
    Campaign.find({ creatorId, status: { $ne: 'completed' } }).lean(),
    Invoice.find({ creatorId, status: { $in: ['issued', 'overdue', 'draft'] } }).sort({ dueDate: 1 }).limit(10).lean(),
    AuditEvent.find({ creatorId }).sort({ timestamp: -1 }).limit(12).lean(),
    Notification.countDocuments({ creatorId, readAt: null }),
  ]);
  const brandIds = [...newOpps.map((o) => o.brandId), ...negotiations.map((d) => d.brandId), ...campaigns.map((c) => c.brandId)];
  const brands = new Map((await BrandProfile.find({ _id: { $in: brandIds } }, { name: 1, isDemo: 1 }).lean()).map((b) => [String(b._id), b]));
  const brandOf = (id) => brands.get(String(id)) || null;

  const deadlines = campaigns
    .flatMap((c) => c.deliverables.filter((d) => d.dueAt && !['published', 'approved'].includes(d.status) && new Date(d.dueAt) <= in14).map((d) => ({ campaignId: c._id, campaignTitle: c.title, deliverableId: d._id, description: d.description || d.type, dueAt: d.dueAt, overdue: new Date(d.dueAt) < now, status: d.status })))
    .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
    .slice(0, 8);

  // Outcome metrics (not vanity counts).
  const [positiveReplies, dealsWon, paidInvoices, sentOutreach] = await Promise.all([
    Message.countDocuments({ creatorId, direction: 'inbound', 'classification.intent': { $in: ['positive_interest', 'offer', 'information_request'] } }),
    Deal.countDocuments({ creatorId, status: 'won' }),
    Invoice.find({ creatorId, status: 'paid' }, { amountMinor: 1, currency: 1 }).lean(),
    Message.countDocuments({ creatorId, direction: 'outbound', purpose: 'pitch', deliveryStatus: { $in: ['sent', 'simulated'] } }),
  ]);
  const currency = profile?.commercialPolicy?.currency || 'INR';
  const revenueReported = paidInvoices.filter((i) => i.currency === currency).reduce((s, i) => s + i.amountMinor, 0);

  const nextActions = [];
  if (!profile?.onboardingStatus?.completed) nextActions.push({ kind: 'onboarding', label: 'Finish setting up your profile', link: '/onboarding' });
  if (approvalsCount) nextActions.push({ kind: 'approvals', label: `Review ${approvalsCount} pending approval${approvalsCount > 1 ? 's' : ''}`, link: '/approvals' });
  if (discovery.status === 'stopped' || discovery.status === 'awaiting_configuration') nextActions.push({ kind: 'discovery', label: 'Start sponsor discovery', link: '/opportunities' });
  if (discovery.status === 'running' && !discovery.worker.healthy) nextActions.push({ kind: 'worker', label: 'Background worker is offline — discovery is not running', link: '/settings?tab=integrations' });
  if (newOpps.length) nextActions.push({ kind: 'opportunities', label: `Review ${newOpps.length} new opportunit${newOpps.length > 1 ? 'ies' : 'y'}`, link: '/opportunities?status=new' });
  const overdueInv = invoices.filter((i) => i.status === 'overdue');
  if (overdueInv.length) nextActions.push({ kind: 'invoices', label: `${overdueInv.length} overdue invoice${overdueInv.length > 1 ? 's' : ''}`, link: '/campaigns' });
  if (deadlines.some((d) => d.overdue)) nextActions.push({ kind: 'deadlines', label: 'You have overdue deliverables', link: '/campaigns' });

  return {
    profile: { publicName: profile?.publicName, onboarding: profile?.onboardingStatus, autonomyLevel: profile?.negotiationAutonomy?.level ?? 0, currency },
    discovery: { status: discovery.status, headline: discovery.headline, monitoringActive: discovery.monitoringActive, nextRunAt: discovery.nextRunAt, lastSuccessfulRunAt: discovery.lastSuccessfulRunAt, lastError: discovery.lastError, worker: discovery.worker },
    newOpportunities: newOpps.map((o) => ({ _id: o._id, brand: brandOf(o.brandId), signalType: o.signalType, signalSummary: o.signalSummary, overallScore: o.overallScore, verificationStatus: o.verificationStatus, isDemo: o.isDemo })),
    negotiations: negotiations.map((d) => ({ _id: d._id, brand: brandOf(d.brandId), negotiationState: d.negotiationState, approvalState: d.approvalState, currentAmountMinor: d.currentOffer?.totalAmountMinor ?? null, currency: d.currency, updatedAt: d.updatedAt })),
    pendingApprovals: { count: approvalsCount, items: pendingApprovals.map((a) => ({ _id: a._id, actionType: a.actionType, brandName: a.contextSnapshot?.brandName, createdAt: a.createdAt, expiresAt: a.expiresAt })) },
    deadlines,
    invoices: invoices.map((i) => ({ _id: i._id, invoiceNumber: i.invoiceNumber, amountMinor: i.amountMinor, currency: i.currency, status: i.status, dueDate: i.dueDate, campaignId: i.campaignId })),
    activity,
    unreadNotifications: unread,
    outcomes: { pitchesSent: sentOutreach, positiveReplies, activeNegotiations: negotiations.length, dealsWon, activeCampaigns: campaigns.length, revenueReportedMinor: revenueReported, revenueNote: 'Creator-reported payments; CreatorOS does not process money.' },
    nextActions,
  };
}
