import { getConfig } from './config/env.js';
import { getLogger } from './lib/logger.js';
import { connectDatabase, initializeDatabase, disconnectDatabase } from './db/connect.js';
import { createApp } from './app.js';
import { createWorker } from './jobs/worker.js';

async function main() {
  let cfg;
  try {
    cfg = getConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const log = getLogger();
  log.info({ env: cfg.env, ai: cfg.ai.provider, emailProvider: cfg.email.provider, sources: cfg.discovery.sources, inProcessWorker: cfg.worker.inProcess }, 'Starting CreatorOS API');
  if (cfg.ai.provider === 'mock') log.warn('AI provider is the development MOCK. Outputs are rule-based and labelled "mock".');
  if (cfg.email.provider === 'demo') log.warn('Email provider is DEMO. Messages are recorded as "simulated" and never delivered.');

  await connectDatabase(cfg.mongoUri);
  await initializeDatabase();

  const app = createApp();
  const server = app.listen(cfg.port, () => log.info({ port: cfg.port }, 'API listening'));

  let worker;
  if (cfg.worker.inProcess) {
    worker = createWorker({ concurrency: 4 });
    await worker.start();
  } else {
    log.info('In-process worker disabled; run `npm run worker` separately.');
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'Shutting down');
    server.close();
    if (worker) await worker.stop();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  getLogger().fatal({ err: err.message }, 'Startup failed');
  process.exit(1);
});
