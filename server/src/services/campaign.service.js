import { BrandProfile, Campaign, Counter, Deal, Invoice, Conversation, CreatorProfile, User } from '../models/index.js';
import { CAMPAIGN_STAGES } from '../models/Campaign.js';
import { DELIVERABLE_LABELS } from '../models/shared.js';
import { conflict, notFound, badRequest } from '../lib/errors.js';
import { formatMoney } from '../lib/money.js';
import { recordAudit } from './audit.service.js';
import { notify } from './notification.service.js';
import { createDraft, proposeSend } from './messaging.service.js';

const DAY = 86_400_000;

async function loadCampaign(creatorId, id) {
  const c = await Campaign.findOne({ _id: id, creatorId });
  if (!c) throw notFound('Campaign');
  return c;
}

const audit = (creatorId, eventType, campaignId, metadata) =>
  recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType, resourceType: 'campaign', resourceId: campaignId, metadata });

/** Converts a confirmed deal into a campaign (idempotent: one campaign per deal). */
export async function convertDealToCampaign(creatorId, dealId) {
  const deal = await Deal.findOne({ _id: dealId, creatorId });
  if (!deal) throw notFound('Deal');
  if (deal.negotiationState !== 'deal_confirmed') throw conflict('Only confirmed deals can be converted into campaigns');
  const existing = await Campaign.findOne({ dealId: deal._id, creatorId }).lean();
  if (existing) return existing;
  const t = deal.acceptedTerms;
  if (!t) throw conflict('This deal has no accepted terms');
  const brand = await BrandProfile.findById(deal.brandId).lean();
  const profile = await CreatorProfile.findOne({ userId: creatorId }, { commercialPolicy: 1 }).lean();
  const revisions = t.revisionsIncluded ?? profile?.commercialPolicy?.maxRevisions ?? 2;
  try {
    const campaign = await Campaign.create({
      creatorId,
      dealId: deal._id,
      brandId: deal.brandId,
      title: `${brand.name} — ${(t.deliverables || []).map((d) => DELIVERABLE_LABELS[d.type] || d.type).join(', ') || 'Campaign'}`,
      status: 'agreement_confirmed',
      stageHistory: [{ from: null, to: 'agreement_confirmed', at: new Date() }],
      compensation: {
        paymentType: t.paymentType,
        amountMinor: t.totalAmountMinor || 0,
        currency: t.currency || deal.currency,
        barterDescription: t.barter?.productDescription,
        barterValueMinor: t.barter?.claimedRetailValueMinor,
      },
      deliverables: (t.deliverables || []).flatMap((d) =>
        Array.from({ length: Math.min(d.quantity || 1, 20) }, (_, i) => ({
          type: d.type,
          description: d.description || `${DELIVERABLE_LABELS[d.type] || d.type}${(d.quantity || 1) > 1 ? ` #${i + 1}` : ''}`,
          quantity: 1,
          dueAt: t.deadlines?.contentDueAt || undefined,
          publishAt: t.deadlines?.publishAt || undefined,
          revisionsAllowed: revisions,
        })),
      ),
      deadlines: { contentDueAt: t.deadlines?.contentDueAt, publishAt: t.deadlines?.publishAt },
      usageRights: t.usageRights,
      exclusivity: t.exclusivity,
      agreement: deal.agreementReference,
      productShipment: { status: t.paymentType === 'barter' || t.paymentType === 'hybrid' ? 'pending' : 'not_applicable' },
      isDemo: deal.isDemo,
    });
    deal.campaignId = campaign._id;
    await deal.save();
    await audit(creatorId, 'campaign.created', campaign._id, { dealId: deal._id });
    return campaign.toObject();
  } catch (err) {
    if (err.code === 11000) return Campaign.findOne({ dealId: deal._id, creatorId }).lean();
    throw err;
  }
}

export async function updateStage(creatorId, id, stage) {
  if (!CAMPAIGN_STAGES.includes(stage)) throw badRequest('Unknown stage');
  const c = await loadCampaign(creatorId, id);
  if (stage === 'payment_received' || stage === 'completed') {
    const paid = await Invoice.exists({ campaignId: c._id, creatorId, status: 'paid' });
    if (!paid && c.compensation.amountMinor > 0) throw conflict('Mark an invoice as paid before moving to this stage');
  }
  if (stage === 'published' && !c.deliverables.every((d) => d.status === 'published')) {
    throw conflict('All deliverables must be published (with a URL) first');
  }
  c.stageHistory.push({ from: c.status, to: stage, at: new Date() });
  c.status = stage;
  if (stage === 'completed') c.completedAt = new Date();
  await c.save();
  await audit(creatorId, 'campaign.stage_changed', c._id, { stage });
  return c.toObject();
}

export async function updateCampaign(creatorId, id, patch) {
  const c = await loadCampaign(creatorId, id);
  if (patch.brief) {
    c.brief = { ...c.brief?.toObject?.(), ...patch.brief, receivedAt: c.brief?.receivedAt || new Date() };
  }
  if (patch.productShipment) c.productShipment = patch.productShipment;
  if (patch.deadlines) c.deadlines = { ...c.deadlines?.toObject?.(), ...patch.deadlines };
  await c.save();
  await audit(creatorId, 'campaign.updated', c._id, { fields: Object.keys(patch) });
  return c.toObject();
}

export async function addDeliverable(creatorId, id, data) {
  const c = await loadCampaign(creatorId, id);
  c.deliverables.push({ ...data, revisionsAllowed: data.revisionsAllowed ?? 2 });
  await c.save();
  await audit(creatorId, 'campaign.deliverable_added', c._id, { type: data.type });
  return c.toObject();
}

export async function updateDeliverable(creatorId, id, deliverableId, patch) {
  const c = await loadCampaign(creatorId, id);
  const d = c.deliverables.id(deliverableId);
  if (!d) throw notFound('Deliverable');
  if (patch.status === 'revision_requested' && d.status !== 'revision_requested') {
    d.revisionsUsed += 1;
    if (d.revisionsUsed > d.revisionsAllowed) {
      await notify(creatorId, { type: 'revision_limit', title: 'Revision limit exceeded', body: `${d.description || d.type}: ${d.revisionsUsed}/${d.revisionsAllowed} revisions. Consider charging for extra rounds.`, link: `/campaigns/${c._id}`, severity: 'warning', dedupeKey: `revision:${d._id}:${d.revisionsUsed}` });
    }
  }
  if (patch.status === 'published') {
    const url = patch.publishedUrl || d.publishedUrl;
    if (!url) throw badRequest('Add the published URL as publication evidence');
    d.publishedUrl = url;
    d.publishedAt = new Date();
    c.publicationEvidence.push({ url, deliverableId: d._id, addedAt: new Date() });
  }
  for (const k of ['status', 'dueAt', 'publishAt', 'notes', 'description']) if (patch[k] !== undefined) d[k] = patch[k];
  if (patch.publishedUrl !== undefined && patch.status !== 'published') d.publishedUrl = patch.publishedUrl;
  await c.save();
  await audit(creatorId, 'campaign.deliverable_updated', c._id, { deliverableId, status: patch.status });
  return c.toObject();
}

export async function generateCompletionSummary(creatorId, id) {
  const c = await loadCampaign(creatorId, id);
  const brand = await BrandProfile.findById(c.brandId).lean();
  const invoices = await Invoice.find({ campaignId: c._id, creatorId }).lean();
  const paid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amountMinor, 0);
  const published = c.deliverables.filter((d) => d.status === 'published');
  const lines = [
    `Campaign with ${brand.name}: ${published.length}/${c.deliverables.length} deliverables published.`,
    ...published.map((d) => `• ${DELIVERABLE_LABELS[d.type] || d.type}: ${d.publishedUrl}`),
    `Agreed compensation: ${formatMoney(c.compensation.amountMinor, c.compensation.currency)}${c.compensation.barterDescription ? ` + ${c.compensation.barterDescription}` : ''}.`,
    `Invoiced: ${formatMoney(invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + i.amountMinor, 0), c.compensation.currency)}; marked paid by you: ${formatMoney(paid, c.compensation.currency)}.`,
    'Performance metrics are not included: CreatorOS does not yet read platform analytics.',
  ];
  c.report = { summary: lines.join('\n'), generatedAt: new Date() };
  await c.save();
  return c.toObject();
}

// ---- Invoices ------------------------------------------------------------------

async function nextInvoiceNumber(creatorId) {
  const year = new Date().getFullYear();
  const counter = await Counter.findOneAndUpdate({ _id: `invoice:${creatorId}:${year}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return `INV-${year}-${String(counter.seq).padStart(4, '0')}`;
}

async function syncPaymentStatus(campaignId) {
  const invoices = await Invoice.find({ campaignId, status: { $ne: 'cancelled' } }).lean();
  let status = 'not_invoiced';
  if (invoices.length) {
    if (invoices.every((i) => i.status === 'paid')) status = 'paid';
    else if (invoices.some((i) => i.status === 'overdue')) status = 'overdue';
    else if (invoices.some((i) => i.status === 'paid')) status = 'partially_paid';
    else if (invoices.some((i) => i.status === 'issued')) status = 'payment_pending';
    else status = 'invoiced';
  }
  await Campaign.updateOne({ _id: campaignId }, { $set: { paymentStatus: status } });
}

export async function createInvoice(creatorId, campaignId, { amountMinor, dueInDays = 30, notes }) {
  const c = await loadCampaign(creatorId, campaignId);
  const amount = amountMinor ?? c.compensation.amountMinor;
  if (!amount || amount <= 0) throw badRequest('Invoice amount must be greater than zero');
  const invoice = await Invoice.create({
    creatorId,
    campaignId: c._id,
    invoiceNumber: await nextInvoiceNumber(creatorId),
    amountMinor: amount,
    currency: c.compensation.currency,
    lineItems: [{ description: c.title, amountMinor: amount }],
    dueDate: new Date(Date.now() + dueInDays * DAY),
    status: 'draft',
    notes,
    statusHistory: [{ from: null, to: 'draft', at: new Date() }],
  });
  c.invoiceIds.push(invoice._id);
  await c.save();
  await syncPaymentStatus(c._id);
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'invoice.created', resourceType: 'invoice', resourceId: invoice._id, metadata: { amountMinor: amount } });
  return invoice.toObject();
}

const INVOICE_TRANSITIONS = { draft: ['issued', 'cancelled'], issued: ['paid', 'overdue', 'cancelled'], overdue: ['paid', 'cancelled'], paid: [], cancelled: [] };

export async function updateInvoiceStatus(creatorId, invoiceId, { status, paymentReference, confirm }) {
  const inv = await Invoice.findOne({ _id: invoiceId, creatorId });
  if (!inv) throw notFound('Invoice');
  if (!INVOICE_TRANSITIONS[inv.status].includes(status)) throw conflict(`Invoice cannot move from ${inv.status} to ${status}`);
  if (status === 'paid') {
    // CreatorOS does not move money; "paid" is the creator's own report.
    if (confirm !== true) throw badRequest('Confirm that you have received this payment in your account');
    inv.paidAt = new Date();
    inv.paymentReference = paymentReference;
    inv.paymentVerification = 'creator_reported';
  }
  if (status === 'issued') inv.issueDate = new Date();
  inv.statusHistory.push({ from: inv.status, to: status, at: new Date() });
  inv.status = status;
  await inv.save();
  await syncPaymentStatus(inv.campaignId);
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: `invoice.${status}`, resourceType: 'invoice', resourceId: inv._id, metadata: { paymentVerification: inv.paymentVerification } });
  return inv.toObject();
}

/** Drafts a payment reminder to the brand; always goes through approval. */
export async function draftPaymentReminder(creatorId, invoiceId) {
  const inv = await Invoice.findOne({ _id: invoiceId, creatorId });
  if (!inv) throw notFound('Invoice');
  if (!['issued', 'overdue'].includes(inv.status)) throw conflict('Reminders are only for issued or overdue invoices');
  const campaign = await Campaign.findById(inv.campaignId).lean();
  const deal = await Deal.findById(campaign.dealId);
  const conversation = deal?.conversationId ? await Conversation.findById(deal.conversationId) : null;
  if (!conversation) throw conflict('No conversation to send the reminder through');
  const [profile, user, brand] = await Promise.all([CreatorProfile.findOne({ userId: creatorId }).lean(), User.findById(creatorId).lean(), BrandProfile.findById(campaign.brandId).lean()]);
  const name = profile?.publicName || user.name;
  const body = `Hi ${brand.name} team,\n\nA friendly reminder that invoice ${inv.invoiceNumber} for ${formatMoney(inv.amountMinor, inv.currency)} was due on ${inv.dueDate.toISOString().slice(0, 10)}. Could you share an update on the payment?\n\nThank you,`;
  const to = conversation.participants.filter((p) => p.side === 'brand' && p.email).map((p) => p.email);
  const message = await createDraft({ conversation, purpose: 'payment_reminder', subject: `Payment reminder: ${inv.invoiceNumber}`, body, creatorName: name, ai: null, to });
  const { approval } = await proposeSend({ creatorId, conversation, deal, message, actionType: 'send_payment_reminder', contextSnapshot: { brandName: brand.name, invoiceNumber: inv.invoiceNumber } });
  inv.remindersSent += 1;
  inv.lastReminderAt = new Date();
  await inv.save();
  return { approvalId: approval._id };
}

// ---- Scheduled scans ---------------------------------------------------------

export async function scanDeadlinesAndInvoices(now = new Date()) {
  const soon = new Date(now.getTime() + 3 * DAY);
  const bucket = now.toISOString().slice(0, 10);
  const campaigns = await Campaign.find({ status: { $ne: 'completed' }, 'deliverables.dueAt': { $lte: soon } }).lean();
  let reminders = 0;
  for (const c of campaigns) {
    for (const d of c.deliverables) {
      if (!d.dueAt || d.status === 'published' || d.status === 'approved') continue;
      const overdue = new Date(d.dueAt) < now;
      if (await notify(c.creatorId, {
        type: 'deadline',
        title: overdue ? `Overdue: ${d.description || d.type}` : `Due soon: ${d.description || d.type}`,
        body: `${c.title} — due ${new Date(d.dueAt).toISOString().slice(0, 10)}`,
        link: `/campaigns/${c._id}`,
        severity: overdue ? 'critical' : 'warning',
        dedupeKey: `deadline:${d._id}:${bucket}`,
      })) reminders++;
    }
  }
  const overdueInvoices = await Invoice.find({ status: 'issued', dueDate: { $lt: now } });
  for (const inv of overdueInvoices) {
    inv.statusHistory.push({ from: 'issued', to: 'overdue', at: now });
    inv.status = 'overdue';
    await inv.save();
    await syncPaymentStatus(inv.campaignId);
    await notify(inv.creatorId, { type: 'payment_overdue', title: `Invoice ${inv.invoiceNumber} is overdue`, body: `${formatMoney(inv.amountMinor, inv.currency)} was due on ${inv.dueDate.toISOString().slice(0, 10)}.`, link: `/campaigns/${inv.campaignId}`, severity: 'critical', dedupeKey: `overdue:${inv._id}` });
  }
  return { reminders, overdueInvoices: overdueInvoices.length };
}
