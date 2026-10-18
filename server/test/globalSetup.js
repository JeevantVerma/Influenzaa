import fs from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server-core';

// Uses TEST_MONGODB_URI if provided; otherwise starts an ephemeral mongod.
// A locally installed mongod is preferred (MONGOMS_SYSTEM_BINARY or the
// default Windows install path) so tests do not need to download binaries.
let server;

function detectBinary() {
  if (process.env.MONGOMS_SYSTEM_BINARY) return process.env.MONGOMS_SYSTEM_BINARY;
  const candidates = ['C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe', 'C:/Program Files/MongoDB/Server/7.0/bin/mongod.exe', '/usr/bin/mongod', '/usr/local/bin/mongod', '/opt/homebrew/bin/mongod'];
  return candidates.find((p) => fs.existsSync(p));
}

export default async function setup({ provide }) {
  if (process.env.TEST_MONGODB_URI) {
    provide('mongoUri', process.env.TEST_MONGODB_URI);
    return;
  }
  const systemBinary = detectBinary();
  server = await MongoMemoryServer.create({ binary: systemBinary ? { systemBinary, checkMD5: false } : undefined });
  provide('mongoUri', server.getUri());
  return async () => {
    await server.stop();
  };
}
