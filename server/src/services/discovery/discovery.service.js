import { CreatorProfile, DiscoveryConfiguration, DiscoveryRun, ScheduledJob } from '../../models/index.js';
import { getConfig } from '../../config/env.js';
import { conflict, tooMany, badRequest, notFound } from '../../lib/errors.js';
import { enqueueJob, cancelPendingJobs } from '../../jobs/queue.js';
import { workerHealth } from '../../jobs/health.js';
import { recordAudit } from '../audit.service.js';
import { platformSources } from './sources/index.js';
import { assertPublicUrl } from '../../lib/safeFetch.js';
import { normalizeDomain } from '../../lib/domain.js';

const MIN = 60_000;

async function getConfigDoc(creatorId) {
  const cfg = await DiscoveryConfiguration.findOne({ creatorId });
  if (!cfg) throw notFound('Discovery configuration');
  return cfg;
}

async function audit(creatorId, eventType, metadata) {
  await recordAudit({ actorType: 'creator', actorId: creatorId, creatorId, eventType, resourceType: 'discovery', resourceId: creatorId, metadata });
}

export async function getDiscoveryStatus(creatorId) {
  const cfg = await getConfigDoc(creatorId);
  const [recentRuns, pendingJobs, worker] = await Promise.all([
    DiscoveryRun.find({ creatorId }).sort({ startedAt: -1 }).limit(10).lean(),
    ScheduledJob.find({ creatorId, jobType: 'discovery.run', status: { $in: ['pending', 'running'] } }).sort({ scheduledAt: 1 }).lean(),
    workerHealth(),
  ]);
  const sources = platformSources().map((s) => ({
    id: s.id,
    label: s.label,
    isDemo: s.isDemo,
    enabled: !cfg.sourceConfiguration?.enabledSources?.length || cfg.sourceConfiguration.enabledSources.includes(s.id),
  }));
  // Never claim continuous monitoring when the worker is not healthy.
  const monitoringActive = cfg.status === 'running' && worker.healthy;
  let headline;
  if (cfg.status === 'running' && !worker.healthy) headline = 'Discovery is enabled, but the background worker is not running. No runs will happen until it is back.';
  else if (cfg.status === 'running') headline = 'Discovery is running in the background.';
  else if (cfg.status === 'paused') headline = 'Discovery is paused. Existing opportunities are kept.';
  else if (cfg.status === 'error') headline = 'Discovery stopped after repeated source failures. Review the error and resume.';
  else if (cfg.status === 'awaiting_configuration') headline = 'Add your content niches to enable discovery.';
  else headline = 'Discovery is stopped. Start it to look for sponsors continuously.';
  return {
    status: cfg.status,
    headline,
    monitoringActive,
    intervalMinutes: cfg.intervalMinutes,
    minIntervalMinutes: getConfig().discovery.minIntervalMinutes,
    nextRunAt: cfg.status === 'running' ? cfg.nextRunAt : null,
    lastRunAt: cfg.lastRunAt,
    lastSuccessfulRunAt: cfg.lastSuccessfulRunAt,
    lastError: cfg.lastError?.message ? cfg.lastError : null,
    consecutiveFailures: cfg.consecutiveFailures,
    startedAt: cfg.startedAt,
    pausedAt: cfg.pausedAt,
    stoppedAt: cfg.stoppedAt,
    sources,
    sourceConfiguration: {
      enabledSources: cfg.sourceConfiguration?.enabledSources || [],
      rssFeeds: cfg.sourceConfiguration?.rssFeeds || [],
      searchQueries: cfg.sourceConfiguration?.searchQueries || [],
    },
    manualRunsRemainingToday: Math.max(0, getConfig().discovery.manualRunsPerDay - recentManualRuns(cfg).length),
    pendingJobs: pendingJobs.map((j) => ({ id: j._id, status: j.status, scheduledAt: j.scheduledAt, trigger: j.payload?.trigger })),
    recentRuns,
    worker,
  };
}

function recentManualRuns(cfg) {
  const since = Date.now() - 24 * 3600_000;
  return (cfg.manualRunTimestamps || []).filter((t) => new Date(t).getTime() > since);
}

async function requireConfigured(creatorId, cfg) {
  const profile = await CreatorProfile.findOne({ userId: creatorId }, { niches: 1 }).lean();
  if (!profile?.niches?.length) {
    cfg.status = 'awaiting_configuration';
    cfg.nextRunAt = null;
    await cfg.save();
    throw conflict('Add at least one content niche in your profile before starting discovery', { status: 'awaiting_configuration' });
  }
}

export async function startDiscovery(creatorId) {
  const cfg = await getConfigDoc(creatorId);
  if (cfg.status === 'running') return getDiscoveryStatus(creatorId);
  await requireConfigured(creatorId, cfg);
  cfg.status = 'running';
  cfg.startedAt = cfg.startedAt || new Date();
  cfg.nextRunAt = new Date(); // first run as soon as the scheduler ticks
  cfg.consecutiveFailures = 0;
  cfg.lastError = undefined;
  await cfg.save();
  await audit(creatorId, 'discovery.started', { intervalMinutes: cfg.intervalMinutes });
  return getDiscoveryStatus(creatorId);
}

export async function pauseDiscovery(creatorId) {
  const cfg = await getConfigDoc(creatorId);
  if (!['running', 'error'].includes(cfg.status)) throw conflict(`Discovery cannot be paused while ${cfg.status}`);
  cfg.status = 'paused';
  cfg.pausedAt = new Date();
  cfg.nextRunAt = null;
  await cfg.save();
  const cancelled = await cancelPendingJobs({ creatorId, jobType: 'discovery.run', 'payload.trigger': 'scheduled' }, 'discovery_paused');
  await audit(creatorId, 'discovery.paused', { cancelledJobs: cancelled });
  return getDiscoveryStatus(creatorId);
}

export async function resumeDiscovery(creatorId) {
  const cfg = await getConfigDoc(creatorId);
  if (!['paused', 'error'].includes(cfg.status)) throw conflict(`Discovery cannot be resumed while ${cfg.status}`);
  await requireConfigured(creatorId, cfg);
  const due = cfg.lastRunAt ? new Date(cfg.lastRunAt.getTime() + cfg.intervalMinutes * MIN) : new Date();
  cfg.status = 'running';
  cfg.nextRunAt = due < new Date() ? new Date() : due;
  cfg.consecutiveFailures = 0;
  await cfg.save();
  await audit(creatorId, 'discovery.resumed', { nextRunAt: cfg.nextRunAt });
  return getDiscoveryStatus(creatorId);
}

/** Permanent stop: no future scheduling, pending discovery work cancelled, opportunities kept. */
export async function stopDiscovery(creatorId) {
  const cfg = await getConfigDoc(creatorId);
  cfg.status = 'stopped';
  cfg.stoppedAt = new Date();
  cfg.nextRunAt = null;
  await cfg.save();
  const cancelled = await cancelPendingJobs({ creatorId, jobType: 'discovery.run' }, 'discovery_stopped');
  await audit(creatorId, 'discovery.stopped', { cancelledJobs: cancelled });
  return getDiscoveryStatus(creatorId);
}

export async function runDiscoveryNow(creatorId) {
  const cfg = await getConfigDoc(creatorId);
  await requireConfigured(creatorId, cfg);
  const existing = await ScheduledJob.findOne({ creatorId, jobType: 'discovery.run', status: { $in: ['pending', 'running'] } }).lean();
  if (existing) throw conflict('A discovery run is already queued or in progress');
  const recent = recentManualRuns(cfg);
  if (recent.length >= getConfig().discovery.manualRunsPerDay) {
    throw tooMany(`Manual run limit reached (${getConfig().discovery.manualRunsPerDay} per 24 hours)`);
  }
  cfg.manualRunTimestamps = [...recent, new Date()];
  if (cfg.status === 'awaiting_configuration') cfg.status = 'stopped';
  await cfg.save();
  const { job } = await enqueueJob({
    jobType: 'discovery.run',
    creatorId,
    payload: { trigger: 'manual' },
    idempotencyKey: `discovery:${creatorId}:manual:${Date.now()}`,
    maxAttempts: 3,
  });
  await audit(creatorId, 'discovery.run_now', { jobId: job._id });
  return getDiscoveryStatus(creatorId);
}

export async function updateDiscoveryConfig(creatorId, { intervalMinutes, enabledSources, rssFeeds, searchQueries }) {
  const cfg = await getConfigDoc(creatorId);
  const { minIntervalMinutes } = getConfig().discovery;
  if (intervalMinutes !== undefined) {
    if (intervalMinutes < minIntervalMinutes) throw badRequest(`Interval must be at least ${minIntervalMinutes} minutes`);
    cfg.intervalMinutes = intervalMinutes;
    if (cfg.status === 'running' && cfg.lastRunAt) {
      const next = new Date(cfg.lastRunAt.getTime() + intervalMinutes * MIN);
      cfg.nextRunAt = next < new Date() ? new Date() : next;
    }
  }
  if (enabledSources !== undefined) {
    const allowed = platformSources().map((s) => s.id);
    const bad = enabledSources.filter((s) => !allowed.includes(s));
    if (bad.length) throw badRequest(`Sources not available on this platform: ${bad.join(', ')}`);
    cfg.sourceConfiguration.enabledSources = enabledSources;
  }
  if (rssFeeds !== undefined) {
    const cleaned = [];
    for (const f of rssFeeds) {
      try {
        await assertPublicUrl(f.url);
      } catch (err) {
        throw badRequest(`Feed ${f.url} rejected: ${err.message}`);
      }
      const domain = normalizeDomain(f.brandDomain || f.url);
      if (!domain) throw badRequest(`Feed ${f.url} needs a valid brand domain`);
      cleaned.push({ url: f.url, brandName: f.brandName || domain, brandDomain: domain, categories: f.categories || [] });
    }
    cfg.sourceConfiguration.rssFeeds = cleaned;
  }
  if (searchQueries !== undefined) cfg.sourceConfiguration.searchQueries = searchQueries;
  await cfg.save();
  await audit(creatorId, 'discovery.config_updated', { intervalMinutes: cfg.intervalMinutes, enabledSources: cfg.sourceConfiguration.enabledSources, feeds: cfg.sourceConfiguration.rssFeeds.length });
  return getDiscoveryStatus(creatorId);
}
