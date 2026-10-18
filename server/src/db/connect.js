import mongoose from 'mongoose';
import { getLogger } from '../lib/logger.js';
import * as models from '../models/index.js';

// Operator injection ({ $gt: '' } in user input) is prevented at the HTTP edge:
// every request body/query is validated with Zod schemas that only admit
// primitive values, and middleware/sanitize.js rejects `$`-prefixed keys.
mongoose.set('strictQuery', true);

export async function connectDatabase(uri) {
  const log = getLogger();
  mongoose.connection.on('disconnected', () => log.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => log.info('MongoDB reconnected'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: false });
  log.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose.connection;
}

/** Creates collections and synchronises indexes for every model (idempotent). */
export async function initializeDatabase() {
  const log = getLogger();
  for (const model of Object.values(models)) {
    await model.createCollection().catch((err) => {
      if (err.codeName !== 'NamespaceExists') throw err;
    });
    await model.syncIndexes();
  }
  log.info({ models: Object.keys(models).length }, 'Database indexes synchronised');
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
