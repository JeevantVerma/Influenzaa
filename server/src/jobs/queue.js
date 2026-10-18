import { ScheduledJob } from '../models/index.js';

/** Error type that tells the worker not to retry. */
export class NonRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NonRetryableError';
    this.retryable = false;
  }
}

/**
 * Enqueues a job exactly once per idempotency key. Re-enqueueing with the same
 * key returns the existing job instead of creating a duplicate.
 */
export async function enqueueJob({ jobType, creatorId = null, payload = {}, scheduledAt = new Date(), idempotencyKey, maxAttempts = 5 }) {
  if (!idempotencyKey) throw new Error('idempotencyKey is required');
  const res = await ScheduledJob.findOneAndUpdate(
    { idempotencyKey },
    { $setOnInsert: { jobType, creatorId, payload, scheduledAt, idempotencyKey, maxAttempts, status: 'pending', attempts: 0 } },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true },
  );
  return { job: res.value, created: !res.lastErrorObject?.updatedExisting };
}

/** Cancels pending (not yet running) jobs matching the filter. */
export async function cancelPendingJobs(filter, reason) {
  const res = await ScheduledJob.updateMany(
    { ...filter, status: 'pending' },
    { $set: { status: 'cancelled', cancelReason: reason, finishedAt: new Date() } },
  );
  return res.modifiedCount;
}

/**
 * Atomically claims the next due job. Jobs whose lease expired (worker died
 * mid-run) are reclaimed, which is how work survives process restarts.
 */
export async function claimNextJob(workerId, leaseMs, jobTypes) {
  const now = new Date();
  const typeFilter = jobTypes ? { jobType: { $in: jobTypes } } : {};
  return ScheduledJob.findOneAndUpdate(
    {
      ...typeFilter,
      $or: [
        { status: 'pending', scheduledAt: { $lte: now } },
        { status: 'running', lockedUntil: { $lt: now } },
      ],
    },
    {
      $set: { status: 'running', lockedBy: workerId, lockedUntil: new Date(now.getTime() + leaseMs), startedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { scheduledAt: 1 }, returnDocument: 'after' },
  );
}

export async function completeJob(job, result) {
  await ScheduledJob.updateOne(
    { _id: job._id, lockedBy: job.lockedBy },
    { $set: { status: 'succeeded', result: result ?? null, finishedAt: new Date(), lockedUntil: null, lastError: null } },
  );
}

export function backoffMs(attempts, baseMs = 30_000, capMs = 6 * 3600_000) {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(exp * 0.2 * Math.random());
  return exp + jitter;
}

export async function failJob(job, err) {
  const message = String(err?.message || err).slice(0, 1000);
  const retryable = err?.retryable !== false;
  const exhausted = job.attempts >= job.maxAttempts;
  const update =
    retryable && !exhausted
      ? { status: 'pending', scheduledAt: new Date(Date.now() + backoffMs(job.attempts)), lockedUntil: null, lastError: message }
      : { status: retryable ? 'dead' : 'failed', finishedAt: new Date(), lockedUntil: null, lastError: message };
  await ScheduledJob.updateOne({ _id: job._id, lockedBy: job.lockedBy }, { $set: update });
  return update.status;
}

/** Extends the lease of a long-running job. */
export async function extendLease(job, leaseMs) {
  await ScheduledJob.updateOne({ _id: job._id, lockedBy: job.lockedBy }, { $set: { lockedUntil: new Date(Date.now() + leaseMs) } });
}
