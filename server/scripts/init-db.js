// Creates collections and indexes. Safe to run repeatedly (idempotent).
import { getConfig } from '../src/config/env.js';
import { connectDatabase, initializeDatabase, disconnectDatabase } from '../src/db/connect.js';

const cfg = getConfig();
await connectDatabase(cfg.mongoUri);
await initializeDatabase();
await disconnectDatabase();
console.log('Database initialised.');
