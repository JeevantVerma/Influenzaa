import { WorkerHeartbeat, ScheduledJob } from '../models/index.js';
import { getConfig } from '../config/env.js';

/** A worker is healthy if any worker has sent a heartbeat recently. */
export async function workerHealth() {
  const staleAfterMs = Math.max(60_000, getConfig().worker.pollMs * 6);
  const since = new Date(Date.now() - staleAfterMs);
  const beats = await WorkerHeartbeat.find({ lastBeatAt: { $gte: since }, stoppedAt: null }).sort({ lastBeatAt: -1 }).lean();
  const latest = beats[0] || (await WorkerHeartbeat.findOne({}).sort({ lastBeatAt: -1 }).lean());
  return {
    healthy: beats.length > 0,
    activeWorkers: beats.length,
    lastHeartbeatAt: latest?.lastBeatAt || null,
  };
}

export async function jobStats() {
  const rows = await ScheduledJob.aggregate([{ $group: { _id: { type: '$jobType', status: '$status' }, n: { $sum: 1 } } }]);
  return rows.map((r) => ({ jobType: r._id.type, status: r._id.status, count: r.n }));
}
