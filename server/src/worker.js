// Standalone background worker: `npm run worker`. Use this in production with
// RUN_WORKER_IN_PROCESS=false on the API processes. Any number of workers can
// run; jobs are claimed atomically and leases recover work from dead workers.
import { getConfig } from './config/env.js';
import { getLogger } from './lib/logger.js';
import { connectDatabase, initializeDatabase, disconnectDatabase } from './db/connect.js';
import { createWorker } from './jobs/worker.js';

async function main() {
  const cfg = getConfig();
  const log = getLogger();
  await connectDatabase(cfg.mongoUri);
  await initializeDatabase();
  const worker = createWorker({ concurrency: Number(process.env.WORKER_CONCURRENCY || 4) });
  await worker.start();
  const shutdown = async (signal) => {
    log.info({ signal }, 'Worker shutting down');
    await worker.stop();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
