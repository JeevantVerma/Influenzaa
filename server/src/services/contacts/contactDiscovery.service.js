import { BrandContact, BrandProfile, Opportunity } from '../../models/index.js';
import { enqueueJob } from '../../jobs/queue.js';
import { conflict, notFound } from '../../lib/errors.js';
import { recordAudit } from '../audit.service.js';
import { findWebsiteContacts } from './websiteContacts.js';

const DAY = 86_400_000;
const RECHECK_DAYS = 30;

/** Real (non-demo) brands are checked once, then again after 30 days. */
export function shouldCheckContacts(brand, now = new Date()) {
  if (brand.isDemo) return false;
  if (String(brand.normalizedDomain || '').startsWith('instagram:')) return false; // known only from Instagram: no website to check
  const c = brand.contactDiscovery;
  // A queued check normally finishes within minutes; one older than a day was lost.
  if (c?.status === 'queued') return !c.queuedAt || now.getTime() - new Date(c.queuedAt).getTime() > DAY;
  if (!c?.checkedAt) return true;
  return now.getTime() - new Date(c.checkedAt).getTime() > RECHECK_DAYS * DAY;
}

/** Queues at most one website check per brand per day. */
export async function queueContactDiscovery(brand, { now = new Date() } = {}) {
  const day = now.toISOString().slice(0, 10);
  const { job, created } = await enqueueJob({
    jobType: 'contacts.discover',
    payload: { brandId: String(brand._id) },
    idempotencyKey: `contacts:${brand._id}:${day}`,
    maxAttempts: 2,
  });
  if (created) await BrandProfile.updateOne({ _id: brand._id }, { $set: { 'contactDiscovery.status': 'queued', 'contactDiscovery.queuedAt': now } });
  return { job, created };
}

/** Job handler: checks the brand's website and stores what it publishes as shared contacts. */
export async function discoverBrandContacts(brandId, { finder = findWebsiteContacts, now = new Date() } = {}) {
  const brand = await BrandProfile.findById(brandId);
  if (!brand) return { skipped: 'brand_missing' };
  if (brand.isDemo) return { skipped: 'demo' };
  if (brand.normalizedDomain.startsWith('instagram:')) return { skipped: 'instagram_only' };

  const result = await finder(brand.normalizedDomain);
  const ids = [];
  for (const c of result.contacts) {
    const doc = await BrandContact.findOneAndUpdate(
      { brandId: brand._id, businessEmail: c.businessEmail, ownerCreatorId: null },
      {
        $set: { role: c.role, roleCategory: c.roleCategory, sourceUrl: c.sourceUrl, confidence: c.confidence, lastVerifiedAt: now },
        $setOnInsert: { source: 'public_page', verificationStatus: 'unverified', name: null },
      },
      { upsert: true, returnDocument: 'after' },
    );
    ids.push(doc._id);
  }

  if (ids.length) {
    // Every creator's opportunity for this brand can now be pitched.
    const best = Math.max(...result.contacts.map((c) => c.confidence));
    await Opportunity.updateMany({ brandId: brand._id }, { $addToSet: { contactIds: { $each: ids } }, $max: { contactConfidence: best } });
    await Opportunity.updateMany({ brandId: brand._id, recommendedAction: 'find_or_add_contact' }, { $set: { recommendedAction: 'draft_pitch' } });
  }

  // A creator programme on the brand's own site is the strongest signal we can find.
  const programme = result.programmes?.[0];
  if (programme && brand.creatorProgramme?.url !== programme.url) {
    brand.creatorProgramme = { url: programme.url, title: programme.title, detectedAt: now };
    await applyCreatorProgramme(brand, now);
  }

  brand.contactDiscovery = {
    status: result.status,
    queuedAt: brand.contactDiscovery?.queuedAt,
    checkedAt: now,
    pagesChecked: result.pagesChecked.length,
    contactsFound: ids.length,
    message: result.message ?? null,
  };
  await brand.save();
  await recordAudit({ actorType: 'worker', eventType: 'brand.contacts_checked', resourceType: 'brand', resourceId: brand._id, metadata: { status: result.status, pages: result.pagesChecked.length, found: ids.length } });
  return { status: result.status, contactsFound: ids.length, pagesChecked: result.pagesChecked.length };
}

export function programmeEvidence(brand, now = new Date()) {
  const p = brand.creatorProgramme;
  return { url: p.url, title: p.title || 'Creator programme', excerpt: null, publishedAt: null, retrievedAt: p.detectedAt || now, source: 'brand_website', verification: 'verified', kind: 'fact' };
}

/** Marks every opportunity for this brand as high intent, with the programme page as evidence. */
async function applyCreatorProgramme(brand, now) {
  const evidence = programmeEvidence(brand, now);
  const opps = await Opportunity.find({ brandId: brand._id });
  for (const o of opps) {
    if (!o.sourceEvidence.some((e) => e.url === evidence.url)) o.sourceEvidence.unshift(evidence);
    if (!o.rationale.some((r) => r.text?.startsWith('Runs a creator programme'))) {
      o.rationale.unshift({ kind: 'fact', text: `Runs a creator programme on its own website: "${evidence.title}".` });
    }
    o.signalType = 'high_intent';
    o.lastMaterialChangeAt = now;
    await o.save();
  }
}

/** Final failure hook: record that the check did not complete. */
export async function onContactDiscoveryExhausted(brandId, err) {
  await BrandProfile.updateOne(
    { _id: brandId },
    { $set: { 'contactDiscovery.status': 'unreachable', 'contactDiscovery.checkedAt': new Date(), 'contactDiscovery.message': `Check failed: ${String(err?.message || err).slice(0, 200)}` } },
  );
}

/** Creator asks for a website check from an opportunity. */
export async function requestContactDiscovery(creatorId, opportunityId) {
  const opp = await Opportunity.findOne({ _id: opportunityId, creatorId }, { brandId: 1 }).lean();
  if (!opp) throw notFound('Opportunity');
  const brand = await BrandProfile.findById(opp.brandId);
  if (!brand) throw notFound('Brand');
  if (brand.isDemo) throw conflict('Demo brands use fictional websites, so there is nothing to check.');
  if (brand.normalizedDomain.startsWith('instagram:')) throw conflict('This brand is known only from Instagram, so there is no website to check. Reply in the Instagram conversation instead.');
  const { created } = await queueContactDiscovery(brand);
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType: 'brand.contacts_requested', resourceType: 'brand', resourceId: brand._id });
  const fresh = await BrandProfile.findById(brand._id, { contactDiscovery: 1 }).lean();
  return { queued: created, contactDiscovery: fresh.contactDiscovery ?? null };
}
