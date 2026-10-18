import { describe, it, expect } from 'vitest';
import { useTestDatabase, clearCollectionsBeforeEach, signUp, onboard, drainWorker } from '../helpers.js';
import { DiscoveryConfiguration, Opportunity, ScheduledJob, Notification, WorkerHeartbeat } from '../../src/models/index.js';
import { scheduleDueDiscovery, createWorker } from '../../src/jobs/worker.js';
import { runDiscovery } from '../../src/services/discovery/pipeline.js';
import { setSourcesForTests } from '../../src/services/discovery/sources/index.js';

const ctx = useTestDatabase();
clearCollectionsBeforeEach();

describe('persistent sponsor discovery', () => {
  it('is stopped by default and refuses to start without niches', async () => {
    const c = await signUp(ctx.app);
    const s = await c.get('/discovery/status');
    expect(s.body.status).toBe('stopped');
    const start = await c.post('/discovery/start');
    expect(start.status).toBe(409);
    expect((await c.get('/discovery/status')).body.status).toBe('awaiting_configuration');
  });

  it('runs independently of the browser via the durable scheduler and deduplicates', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    const started = await c.post('/discovery/start');
    expect(started.body.status).toBe('running');
    // No HTTP request drives the run: the worker picks it up from MongoDB.
    await drainWorker();
    const first = await Opportunity.countDocuments({ creatorId: c.user._id });
    expect(first).toBeGreaterThan(5);
    const notes1 = await Notification.countDocuments({ creatorId: c.user._id, type: 'new_opportunities' });
    expect(notes1).toBe(1);

    // Every opportunity identifies its evidence provenance.
    const opps = await Opportunity.find({ creatorId: c.user._id }).lean();
    for (const o of opps) {
      expect(o.verificationStatus).toBe('demo');
      expect(o.isDemo).toBe(true);
      expect(o.sourceEvidence[0].retrievedAt).toBeTruthy();
      expect(o.scoreFactors.length).toBeGreaterThan(0);
    }
    // Prohibited category (real-money gaming, alcohol) is excluded, not hidden silently.
    const excluded = opps.filter((o) => o.excluded);
    expect(excluded.length).toBeGreaterThanOrEqual(2);
    expect(excluded.every((o) => o.exclusionReason)).toBe(true);

    // Second run over unchanged data: no duplicates and no new notification.
    await runDiscovery({ creatorId: c.user._id, trigger: 'manual' });
    expect(await Opportunity.countDocuments({ creatorId: c.user._id })).toBe(first);
    expect(await Notification.countDocuments({ creatorId: c.user._id, type: 'new_opportunities' })).toBe(notes1);
  });

  it('surfaces progressively released signals as genuinely new findings', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    await c.post('/discovery/start');
    await drainWorker();
    const before = await Opportunity.countDocuments({ creatorId: c.user._id });
    await DiscoveryConfiguration.updateOne({ creatorId: c.user._id }, { $set: { startedAt: new Date(Date.now() - 5 * 86_400_000) } });
    const r = await runDiscovery({ creatorId: c.user._id, trigger: 'manual' });
    expect(r.opportunitiesCreated).toBeGreaterThan(0);
    expect(await Opportunity.countDocuments({ creatorId: c.user._id })).toBe(before + r.opportunitiesCreated);
  });

  it('pause and resume keep opportunities and state', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    await c.post('/discovery/start');
    await drainWorker();
    const count = await Opportunity.countDocuments({ creatorId: c.user._id });
    const paused = await c.post('/discovery/pause');
    expect(paused.body.status).toBe('paused');
    expect(paused.body.nextRunAt).toBeNull();
    expect(await scheduleDueDiscovery(new Date(Date.now() + 10 * 86_400_000))).toBe(0);
    expect(await Opportunity.countDocuments({ creatorId: c.user._id })).toBe(count);
    const resumed = await c.post('/discovery/resume');
    expect(resumed.body.status).toBe('running');
    expect(new Date(resumed.body.nextRunAt).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('a stopped discovery process does not schedule another run and cancels pending work', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    await c.post('/discovery/start');
    await scheduleDueDiscovery(); // enqueue the first run but do not execute it
    expect(await ScheduledJob.countDocuments({ creatorId: c.user._id, jobType: 'discovery.run', status: 'pending' })).toBe(1);
    const stopped = await c.post('/discovery/stop');
    expect(stopped.body.status).toBe('stopped');
    expect(await ScheduledJob.countDocuments({ creatorId: c.user._id, jobType: 'discovery.run', status: 'pending' })).toBe(0);
    expect(await ScheduledJob.countDocuments({ creatorId: c.user._id, jobType: 'discovery.run', status: 'cancelled' })).toBe(1);
    expect(await scheduleDueDiscovery(new Date(Date.now() + 365 * 86_400_000))).toBe(0);
    // A scheduled job that slipped through is skipped at execution time.
    const r = await runDiscovery({ creatorId: c.user._id, trigger: 'scheduled' });
    expect(r.skipped).toBe(true);
  });

  it('recovers a run whose worker died mid-job (lease expiry)', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    await c.post('/discovery/start');
    await scheduleDueDiscovery();
    // Simulate a crashed worker: job claimed but never finished, lease expired.
    await ScheduledJob.updateOne({ creatorId: c.user._id, jobType: 'discovery.run' }, { $set: { status: 'running', lockedBy: 'dead-worker', lockedUntil: new Date(Date.now() - 1000), attempts: 1 } });
    const fresh = createWorker({ pollMs: 1000, leaseMs: 60_000 });
    await fresh.drain();
    const job = await ScheduledJob.findOne({ creatorId: c.user._id, jobType: 'discovery.run' }).lean();
    expect(job.status).toBe('succeeded');
    expect(job.lockedBy).not.toBe('dead-worker');
    expect(await Opportunity.countDocuments({ creatorId: c.user._id })).toBeGreaterThan(0);
  });

  it('reports the worker as unhealthy instead of claiming continuous monitoring', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    await c.post('/discovery/start');
    await WorkerHeartbeat.deleteMany({});
    const s = await c.get('/discovery/status');
    expect(s.body.monitoringActive).toBe(false);
    expect(s.body.headline).toMatch(/worker is not running/);
  });

  it('records source failures honestly and moves to error after repeated failures', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    await c.post('/discovery/start');
    setSourcesForTests([{ id: 'broken', label: 'Broken source', collect: async () => ({ status: 'error', candidates: [], message: 'upstream 503' }) }]);
    try {
      for (let i = 0; i < 3; i++) await runDiscovery({ creatorId: c.user._id, trigger: 'scheduled' });
    } finally {
      setSourcesForTests(null);
    }
    const s = await c.get('/discovery/status');
    expect(s.body.status).toBe('error');
    expect(s.body.lastError.message).toMatch(/upstream 503/);
    expect(s.body.recentRuns[0].status).toBe('failed');
  });

  it('enforces the manual run quota and prevents concurrent manual runs', async () => {
    const c = await signUp(ctx.app);
    await onboard(c);
    expect((await c.post('/discovery/run-now')).status).toBe(202);
    expect((await c.post('/discovery/run-now')).status).toBe(409); // one already queued
  });

  it('validates interval and feed configuration (SSRF guard)', async () => {
    const c = await signUp(ctx.app);
    expect((await c.patch('/discovery/config', { intervalMinutes: 5 })).status).toBe(400);
    expect((await c.patch('/discovery/config', { intervalMinutes: 720 })).body.intervalMinutes).toBe(720);
    const bad = await c.patch('/discovery/config', { rssFeeds: [{ url: 'http://127.0.0.1/feed.xml', brandDomain: 'evil.example' }] });
    expect(bad.status).toBe(400);
  });
});
