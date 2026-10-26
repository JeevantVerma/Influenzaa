import os from 'node:os';
import crypto from 'node:crypto';
import { DiscoveryConfiguration, IntegrationConnection, WorkerHeartbeat } from '../models/index.js';
import { getConfig } from '../config/env.js';
import { getLogger } from '../lib/logger.js';
import { claimNextJob, completeJob, failJob, enqueueJob, extendLease } from './queue.js';
import { HANDLERS } from './handlers.js';

const MIN = 60_000;
// Website contact checks are capped so we never fetch many sites at once.
const PER_TYPE_LIMIT = () => ({ 'discovery.run': getConfig().discovery.maxConcurrency, 'contacts.discover': 2, 'inbound.imap_poll': 1, 'inbound.instagram_poll': 1 });

/** Enqueue due discovery runs. Conditional update prevents double scheduling across workers. */
export async function scheduleDueDiscovery(now = new Date(), limit = 50) {
  const due = await DiscoveryConfiguration.find({ status: 'running', nextRunAt: { $ne: null, $lte: now } }).limit(limit).lean();
  let scheduled = 0;
  for (const cfg of due) {
    const next = new Date(Math.max(now.getTime(), cfg.nextRunAt.getTime()) + cfg.intervalMinutes * MIN);
    const claimed = await DiscoveryConfiguration.updateOne({ _id: cfg._id, status: 'running', nextRunAt: cfg.nextRunAt }, { $set: { nextRunAt: next } });
    if (!claimed.modifiedCount) continue;
    await enqueueJob({
      jobType: 'discovery.run',
      creatorId: cfg.creatorId,
      payload: { trigger: 'scheduled', scheduledFor: cfg.nextRunAt },
      idempotencyKey: `discovery:${cfg.creatorId}:${cfg.nextRunAt.getTime()}`,
      maxAttempts: 3,
    });
    scheduled++;
  }
  return scheduled;
}

/** Periodic maintenance jobs, bucketed so each window runs once cluster-wide. */
export async function scheduleMaintenance(now = new Date()) {
  const quarter = Math.floor(now.getTime() / (15 * MIN));
  const hour = Math.floor(now.getTime() / (60 * MIN));
  await enqueueJob({ jobType: 'maintenance.approvals', idempotencyKey: `maintenance:approvals:${quarter}`, maxAttempts: 2 });
  await enqueueJob({ jobType: 'maintenance.deadlines', idempotencyKey: `maintenance:deadlines:${hour}`, maxAttempts: 2 });
  // Check the reply inbox once a minute when replies arrive by IMAP.
  if (getConfig().email.inbound.provider === 'imap') {
    await enqueueJob({ jobType: 'inbound.imap_poll', idempotencyKey: `inbound:imap:${Math.floor(now.getTime() / MIN)}`, maxAttempts: 1 });
  }
  // Connected Instagram inboxes: new DMs once a minute, token renewal once a day.
  if (await IntegrationConnection.exists({ provider: 'instagram', status: 'connected' })) {
    if (getConfig().instagram.pollDms) {
      await enqueueJob({ jobType: 'inbound.instagram_poll', idempotencyKey: `inbound:instagram:${Math.floor(now.getTime() / MIN)}`, maxAttempts: 1 });
    }
    await enqueueJob({ jobType: 'maintenance.instagram_tokens', idempotencyKey: `maintenance:instagram-tokens:${Math.floor(now.getTime() / (24 * 60 * MIN))}`, maxAttempts: 2 });
  }
}

export function createWorker({ concurrency = 4, pollMs = getConfig().worker.pollMs, leaseMs = getConfig().worker.leaseMs } = {}) {
  const log = getLogger();
  const workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  const inFlight = new Map(); // jobId → { promise, jobType }
  let timer = null;
  let stopping = false;
  let processed = 0;

  async function heartbeat() {
    await WorkerHeartbeat.updateOne(
      { workerId },
      { $set: { lastBeatAt: new Date(), jobsProcessed: processed, host: os.hostname(), pid: process.pid, stoppedAt: null }, $setOnInsert: { startedAt: new Date() } },
      { upsert: true },
    );
  }

  function countType(type) {
    let n = 0;
    for (const v of inFlight.values()) if (v.jobType === type) n++;
    return n;
  }

  async function runJob(job) {
    const handler = HANDLERS[job.jobType];
    const leaseTimer = setInterval(() => extendLease(job, leaseMs).catch(() => {}), Math.max(10_000, leaseMs / 3));
    try {
      if (!handler) throw Object.assign(new Error(`No handler for ${job.jobType}`), { retryable: false });
      const result = await handler.run(job);
      await completeJob(job, result);
      log.debug({ jobId: job._id, jobType: job.jobType }, 'Job succeeded');
    } catch (err) {
      const status = await failJob(job, err);
      log.warn({ jobId: job._id, jobType: job.jobType, attempts: job.attempts, status, err: err.message }, 'Job failed');
      if ((status === 'dead' || status === 'failed') && handler?.onExhausted) {
        await handler.onExhausted(job, err).catch((e) => log.error({ err: e.message }, 'onExhausted hook failed'));
      }
    } finally {
      clearInterval(leaseTimer);
      processed++;
    }
  }

  async function tick() {
    if (stopping) return;
    try {
      await heartbeat();
      await scheduleDueDiscovery();
      await scheduleMaintenance();
      const limits = PER_TYPE_LIMIT();
      while (!stopping && inFlight.size < concurrency) {
        // Exclude job types at their concurrency limit.
        const allowedTypes = Object.keys(HANDLERS).filter((t) => !(limits[t] && countType(t) >= limits[t]));
        const job = await claimNextJob(workerId, leaseMs, allowedTypes);
        if (!job) break;
        const promise = runJob(job).finally(() => inFlight.delete(String(job._id)));
        inFlight.set(String(job._id), { promise, jobType: job.jobType });
      }
    } catch (err) {
      log.error({ err: err.message }, 'Worker tick failed');
    } finally {
      if (!stopping) timer = setTimeout(tick, pollMs);
    }
  }

  return {
    workerId,
    async start() {
      log.info({ workerId, concurrency, pollMs }, 'Background worker started');
      await heartbeat();
      timer = setTimeout(tick, 50);
    },
    /** Runs one scheduling + claim cycle and waits for claimed jobs (used by tests). */
    async drain(maxRounds = 20) {
      for (let i = 0; i < maxRounds; i++) {
        await scheduleDueDiscovery();
        const job = await claimNextJob(workerId, leaseMs);
        if (!job) return i;
        await runJob(job);
      }
      return maxRounds;
    },
    /** Graceful shutdown: stop claiming, wait for in-flight jobs (bounded). */
    async stop(timeoutMs = 20_000) {
      stopping = true;
      if (timer) clearTimeout(timer);
      const pending = [...inFlight.values()].map((v) => v.promise);
      await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
      await WorkerHeartbeat.updateOne({ workerId }, { $set: { stoppedAt: new Date() } }).catch(() => {});
      log.info({ workerId, unfinished: inFlight.size }, 'Background worker stopped');
    },
  };
}
