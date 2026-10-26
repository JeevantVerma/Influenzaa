import { BrandProfile, BrandContact, CreatorProfile, Deal, DiscoveryConfiguration, DiscoveryRun, Opportunity } from '../../models/index.js';
import { normalizeDomain, normalizeText } from '../../lib/domain.js';
import { sha256 } from '../../lib/crypto.js';
import { getLogger } from '../../lib/logger.js';
import { scoreOpportunity } from '../scoring/score.js';
import { SIGNAL_KINDS } from './taxonomy.js';
import { resolveSources } from './sources/index.js';
import { notify } from '../notification.service.js';
import { recordAudit } from '../audit.service.js';
import { programmeEvidence, queueContactDiscovery, shouldCheckContacts } from '../contacts/contactDiscovery.service.js';

const INTENT_RANK = { low_intent: 1, medium_intent: 2, high_intent: 3 };
const NOTIFY_MIN_SCORE = 40;
const MAX_EVIDENCE = 20;

export function dedupeKeyFor(domain, signal) {
  const subject = normalizeText(signal.productOrCampaign) || `kind:${signal.kind}`;
  return sha256(`${domain}|${subject}`).slice(0, 32);
}

function mergeEvidence(existing = [], incoming = []) {
  const byUrl = new Map(existing.map((e) => [e.url, e.toObject ? e.toObject() : e]));
  let added = 0;
  for (const e of incoming) {
    if (byUrl.has(e.url)) {
      byUrl.get(e.url).retrievedAt = e.retrievedAt; // refreshed
    } else {
      byUrl.set(e.url, e);
      added++;
    }
  }
  const merged = [...byUrl.values()].sort((a, b) => new Date(b.publishedAt || b.retrievedAt) - new Date(a.publishedAt || a.retrievedAt));
  return { merged: merged.slice(0, MAX_EVIDENCE), added };
}

function verificationOf(evidence) {
  const v = evidence.map((e) => e.verification);
  if (v.length && v.every((x) => x === 'demo')) return 'demo';
  if (v.includes('verified')) return v.every((x) => x === 'verified') ? 'verified' : 'partially_verified';
  return 'unverified';
}

async function upsertBrand(candidate, now) {
  const domain = normalizeDomain(candidate.brand.domain);
  if (!domain) return null;
  const brand = (await BrandProfile.findOne({ normalizedDomain: domain })) ||
    new BrandProfile({ normalizedDomain: domain, name: candidate.brand.name, isDemo: !!candidate.brand.isDemo });
  brand.name = brand.name || candidate.brand.name;
  if (candidate.brand.industry) brand.industry = candidate.brand.industry;
  if (candidate.brand.description) brand.brandDescription = candidate.brand.description;
  if (candidate.brand.website) brand.officialWebsite = candidate.brand.website;
  if (candidate.brand.instagramHandle && !brand.instagramHandle) brand.instagramHandle = candidate.brand.instagramHandle;
  if (candidate.brand.creatorProgramme?.url && !brand.creatorProgramme?.url) brand.creatorProgramme = candidate.brand.creatorProgramme;
  brand.categories = [...new Set([...(brand.categories || []), ...(candidate.brand.categories || [])])];
  brand.markets = [...new Set([...(brand.markets || []), ...(candidate.brand.markets || [])])];
  if (candidate.signal.productOrCampaign && !brand.products.some((p) => p.name === candidate.signal.productOrCampaign)) {
    brand.products.push({ name: candidate.signal.productOrCampaign, url: candidate.evidence[0]?.url, launchedAt: candidate.evidence[0]?.publishedAt });
  }
  brand.sourceEvidence = mergeEvidence(brand.sourceEvidence, candidate.evidence).merged;
  if (candidate.evidence.some((e) => e.verification === 'verified')) brand.lastVerifiedAt = now;
  await brand.save();
  return brand;
}

async function upsertContacts(brand, contacts, now) {
  const ids = [];
  for (const c of contacts) {
    if (!c.businessEmail) continue;
    const doc = await BrandContact.findOneAndUpdate(
      { brandId: brand._id, businessEmail: c.businessEmail.toLowerCase(), ownerCreatorId: null },
      {
        $set: { name: c.name ?? null, role: c.role ?? null, roleCategory: c.roleCategory || 'unknown', sourceUrl: c.sourceUrl, lastVerifiedAt: now, confidence: c.confidence ?? 0 },
        $setOnInsert: { source: c.source, verificationStatus: c.verificationStatus || 'unverified', isDemo: !!c.isDemo },
      },
      { upsert: true, returnDocument: 'after' },
    );
    ids.push(doc._id);
  }
  return ids;
}

async function bestContactConfidence(brandId, creatorId) {
  const contacts = await BrandContact.find({ brandId, doNotContact: false, $or: [{ ownerCreatorId: null }, { ownerCreatorId: creatorId }] }, { confidence: 1 }).lean();
  return contacts.reduce((m, c) => Math.max(m, c.confidence || 0), 0);
}

async function priorOutcomesFor(creatorId, categories) {
  if (!categories?.length) return undefined;
  const rows = await Opportunity.aggregate([
    { $match: { creatorId, categories: { $in: categories }, status: { $in: ['won', 'lost'] } } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const out = { won: 0, lost: 0 };
  for (const r of rows) out[r._id] = r.n;
  return out;
}

function buildRationale(candidate, score) {
  const rationale = [];
  const kind = SIGNAL_KINDS[candidate.signal.kind] || SIGNAL_KINDS.category_match;
  const ev = candidate.evidence[0];
  rationale.push({ kind: 'fact', text: `${kind.label}: "${candidate.signal.title}"${ev?.publishedAt ? ` (published ${new Date(ev.publishedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })})` : ''}.` });
  if (kind.intent !== 'high_intent') {
    rationale.push({ kind: 'hypothesis', text: 'This is a timing signal, not evidence that the brand is currently paying creators.' });
  }
  const top = score.factors.filter((f) => f.impact > 0).slice(0, 2).map((f) => f.label.toLowerCase());
  if (top.length) rationale.push({ kind: 'hypothesis', text: `Ranked mainly because: ${top.join(' and ')}.` });
  return rationale;
}

function outreachAngle(candidate, profile) {
  const niche = profile.niches?.[0] || 'your';
  switch (candidate.signal.kind) {
    case 'creator_program':
    case 'campaign_brief':
      return `Respond to their creator call with a concrete ${niche} content concept for ${candidate.signal.productOrCampaign || 'the campaign'}.`;
    case 'product_launch':
      return `Propose launch content for ${candidate.signal.productOrCampaign || 'the new product'} tailored to your ${niche} audience.`;
    case 'regional_expansion':
      return 'Offer local-audience content to support their expansion.';
    case 'creator_hiring':
      return 'Reach out early while they are building their creator programme.';
    default:
      return `Introduce yourself with a short ${niche} content idea that fits their products.`;
  }
}

/**
 * Executes one discovery run for a creator. Idempotent with respect to
 * opportunities: the (creatorId, dedupeKey) unique index guarantees one
 * record per brand+signal no matter how often the run is repeated.
 */
export async function runDiscovery({ creatorId, trigger, jobId, now = new Date() }) {
  const log = getLogger();
  const config = await DiscoveryConfiguration.findOne({ creatorId });
  if (!config) return { skipped: true, reason: 'no_configuration' };

  // A scheduled run only executes while discovery is running. Manual runs are
  // allowed in any state except awaiting_configuration.
  if (trigger === 'scheduled' && config.status !== 'running') {
    await DiscoveryRun.create({ creatorId, trigger, status: 'skipped', finishedAt: now, jobId, runErrors: [`Discovery is ${config.status}`] });
    return { skipped: true, reason: `status_${config.status}` };
  }

  const profile = await CreatorProfile.findOne({ userId: creatorId }).lean();
  if (!profile?.niches?.length) {
    config.status = 'awaiting_configuration';
    config.nextRunAt = null;
    await config.save();
    await DiscoveryRun.create({ creatorId, trigger, status: 'skipped', finishedAt: now, jobId, runErrors: ['Add at least one content niche to enable discovery'] });
    return { skipped: true, reason: 'awaiting_configuration' };
  }

  const run = await DiscoveryRun.create({ creatorId, trigger, status: 'running', startedAt: now, jobId });
  const sources = resolveSources(config);
  const contactedBrandIds = new Set((await Deal.find({ creatorId }, { brandId: 1 }).lean()).map((d) => String(d.brandId)));
  const stats = { candidatesFound: 0, opportunitiesCreated: 0, opportunitiesUpdated: 0, excludedByPolicy: 0, notificationsSent: 0 };
  const newHighlights = [];

  for (const source of sources) {
    let result;
    try {
      result = await source.collect({ profile, config, now });
    } catch (err) {
      result = { status: 'error', candidates: [], message: err.message };
    }
    run.sourcesQueried.push({ source: source.id, status: result.status, itemCount: result.candidates.length, message: result.message });
    if (result.status === 'error' || result.status === 'unavailable') run.runErrors.push(`${source.label}: ${result.message || result.status}`);

    for (let candidate of result.candidates) {
      stats.candidatesFound++;
      try {
        const brand = await upsertBrand(candidate, now);
        if (!brand) continue;
        await upsertContacts(brand, candidate.contacts || [], now);
        // Real brands get a background check of their own website for published contacts.
        if (shouldCheckContacts(brand, now)) await queueContactDiscovery(brand, { now });
        const dedupeKey = dedupeKeyFor(brand.normalizedDomain, candidate.signal);
        const contactConfidence = await bestContactConfidence(brand._id, creatorId);
        // A creator programme on the brand's own site keeps every opportunity for it high intent.
        const hasProgramme = !!brand.creatorProgramme?.url;
        if (hasProgramme) candidate = { ...candidate, evidence: [programmeEvidence(brand, now), ...candidate.evidence] };
        const intent = hasProgramme ? 'high_intent' : (SIGNAL_KINDS[candidate.signal.kind] || SIGNAL_KINDS.category_match).intent;
        const existing = await Opportunity.findOne({ creatorId, dedupeKey });
        const evidence = mergeEvidence(existing?.sourceEvidence, candidate.evidence);
        const score = scoreOpportunity({
          profile,
          brand: { name: brand.name, categories: brand.categories, markets: brand.markets },
          signal: candidate.signal,
          evidence: evidence.merged,
          contactConfidence,
          priorOutcomes: await priorOutcomesFor(creatorId, brand.categories),
          now,
        });
        if (score.excluded) stats.excludedByPolicy++;
        const contactIds = (await BrandContact.find({ brandId: brand._id, $or: [{ ownerCreatorId: null }, { ownerCreatorId: creatorId }] }, { _id: 1 }).lean()).map((c) => c._id);
        const alreadyInConversation = contactedBrandIds.has(String(brand._id));
        const fields = {
          brandId: brand._id,
          contactIds,
          signalType: intent,
          signalSummary: candidate.signal.title?.slice(0, 500),
          productOrCampaign: candidate.signal.productOrCampaign || null,
          categories: brand.categories,
          sourceEvidence: evidence.merged,
          rationale: hasProgramme
            ? [{ kind: 'fact', text: `Runs a creator programme on its own website: "${brand.creatorProgramme.title || 'Creator programme'}".` }, ...buildRationale(candidate, score)]
            : buildRationale(candidate, score),
          outreachAngle: outreachAngle(candidate, profile),
          recommendedAction: score.excluded ? 'none_excluded' : alreadyInConversation ? 'continue_existing_conversation' : contactConfidence > 0 ? 'draft_pitch' : 'find_or_add_contact',
          fitScore: score.fitScore,
          timingScore: score.timingScore,
          contactConfidence,
          overallScore: score.overallScore,
          scoreFactors: score.factors,
          scoringVersion: score.version,
          verificationStatus: verificationOf(evidence.merged),
          excluded: score.excluded,
          exclusionReason: score.exclusionReason || null,
          lastVerifiedAt: now,
          isDemo: !!candidate.brand.isDemo,
        };

        if (!existing) {
          try {
            const opp = await Opportunity.create({ creatorId, dedupeKey, firstDiscoveredAt: now, lastMaterialChangeAt: now, status: 'new', ...fields });
            stats.opportunitiesCreated++;
            if (!score.excluded && !alreadyInConversation && score.overallScore >= NOTIFY_MIN_SCORE) newHighlights.push({ id: opp._id, brand: brand.name, score: score.overallScore });
          } catch (err) {
            if (err.code !== 11000) throw err; // concurrent run created it; treat as update next time
          }
        } else {
          const intentUpgraded = INTENT_RANK[intent] > INTENT_RANK[existing.signalType];
          const material = evidence.added > 0 || intentUpgraded;
          Object.assign(existing, fields);
          if (material) existing.lastMaterialChangeAt = now;
          await existing.save();
          stats.opportunitiesUpdated++;
          // Dismissed opportunities are refreshed silently and never resurrected.
          if (material && intentUpgraded && existing.status !== 'dismissed' && !score.excluded && score.overallScore >= NOTIFY_MIN_SCORE) {
            newHighlights.push({ id: existing._id, brand: brand.name, score: score.overallScore, upgraded: true });
          }
        }
      } catch (err) {
        log.warn({ err: err.message, source: source.id }, 'Discovery candidate failed');
        run.runErrors.push(`Candidate from ${source.id} failed: ${err.message}`);
      }
    }
  }

  if (newHighlights.length) {
    const top = newHighlights.sort((a, b) => b.score - a.score).slice(0, 3).map((h) => h.brand).join(', ');
    const created = await notify(creatorId, {
      type: 'new_opportunities',
      title: `${newHighlights.length} new sponsorship ${newHighlights.length === 1 ? 'opportunity' : 'opportunities'}`,
      body: `Top matches: ${top}`,
      link: '/opportunities?status=new',
      severity: 'success',
      dedupeKey: `discovery-run:${run._id}`,
    });
    if (created) stats.notificationsSent = 1;
  }

  const allFailed = run.sourcesQueried.length > 0 && run.sourcesQueried.every((s) => s.status === 'error' || s.status === 'unavailable');
  const noSources = run.sourcesQueried.length === 0;
  Object.assign(run, stats);
  run.status = allFailed || noSources ? 'failed' : run.runErrors.length ? 'partial' : 'succeeded';
  if (noSources) run.runErrors.push('No discovery sources are enabled');
  run.finishedAt = new Date();
  await run.save();

  // Record the outcome on the configuration without clobbering a concurrent
  // pause/stop: status changes are only made with a conditional update.
  const update = { lastRunAt: now };
  if (run.status === 'failed') {
    update.lastError = { message: run.runErrors.join(' | ').slice(0, 500), at: now };
  } else {
    update.lastSuccessfulRunAt = now;
    update.lastError = null;
  }
  await DiscoveryConfiguration.updateOne({ _id: config._id }, run.status === 'failed' ? { $set: update, $inc: { consecutiveFailures: 1 } } : { $set: { ...update, consecutiveFailures: 0 } });
  if (run.status === 'failed') {
    // After repeated failures stop scheduling and surface the error state.
    const errored = await DiscoveryConfiguration.findOneAndUpdate(
      { _id: config._id, status: 'running', consecutiveFailures: { $gte: 3 } },
      { $set: { status: 'error', nextRunAt: null } },
      { returnDocument: 'after' },
    );
    if (errored) {
      await notify(creatorId, { type: 'discovery_error', title: 'Sponsor discovery paused after repeated failures', body: errored.lastError?.message, link: '/opportunities', severity: 'warning', dedupeKey: `discovery-error:${run._id}` });
    }
  }
  await recordAudit({ actorType: 'worker', creatorId, eventType: 'discovery.run_finished', resourceType: 'discovery_run', resourceId: run._id, metadata: { trigger, status: run.status, ...stats } });
  return { runId: run._id, status: run.status, ...stats };
}
