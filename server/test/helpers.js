import { inject, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { resetConfig } from '../src/config/env.js';

export const TEST_ENV = {
  NODE_ENV: 'test',
  AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
  AI_PROVIDER: 'mock',
  EMAIL_PROVIDER: 'demo',
  DISCOVERY_SOURCES: 'demo',
  DEMO_FEATURES_ENABLED: 'true',
  RUN_WORKER_IN_PROCESS: 'false',
  INBOUND_WEBHOOK_SECRET: 'whsec-test-0123456789',
  FRONTEND_URL: 'http://localhost:5173',
};

/** Connects to an isolated database for one test file and returns helpers. */
export function useTestDatabase() {
  const ctx = {};
  beforeAll(async () => {
    const base = inject('mongoUri');
    const dbName = `creatoros_test_${Math.random().toString(36).slice(2, 10)}`;
    Object.assign(process.env, TEST_ENV, { MONGODB_URI: `${base.replace(/\/?(\?.*)?$/, '')}/${dbName}` });
    resetConfig();
    const { connectDatabase, initializeDatabase } = await import('../src/db/connect.js');
    await connectDatabase(process.env.MONGODB_URI);
    await initializeDatabase();
    const { createApp } = await import('../src/app.js');
    ctx.app = createApp();
  });
  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });
  return ctx;
}

export function clearCollectionsBeforeEach() {
  beforeEach(async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
}

/** Registers a creator and returns an authenticated client with CSRF handling. */
export async function signUp(app, overrides = {}) {
  const agent = request.agent(app);
  const email = overrides.email || `creator_${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await agent.post('/api/v1/auth/register').send({ name: overrides.name || 'Test Creator', email, password: 'correct-horse-battery' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.csrfToken;
  const client = {
    agent,
    csrf,
    user: res.body.user,
    email,
    get: (url) => agent.get(`/api/v1${url}`),
    post: (url, body = {}) => agent.post(`/api/v1${url}`).set('X-CSRF-Token', csrf).send(body),
    patch: (url, body = {}) => agent.patch(`/api/v1${url}`).set('X-CSRF-Token', csrf).send(body),
    del: (url, body = {}) => agent.delete(`/api/v1${url}`).set('X-CSRF-Token', csrf).send(body),
  };
  return client;
}

const r = (pref, min) => ({ preferredMinor: pref * 100, minimumMinor: min * 100 });

export const FULL_PROFILE = {
  publicName: 'Test Creator',
  city: 'Bengaluru',
  languages: ['English', 'Hindi'],
  niches: ['fitness', 'food'],
  platformProfiles: [{ platform: 'instagram', handle: '@test', followers: 40000 }],
  brandPreferences: { preferredCategories: ['fitness'], prohibitedCategories: ['real_money_gaming', 'alcohol'] },
  barterPolicy: { acceptance: 'selective', minimumValueMinor: 1_000_000 },
  commercialPolicy: {
    currency: 'INR',
    minimumDealMinor: 1_000_000,
    rates: [
      { deliverable: 'instagram_reel', ...r(30000, 20000) },
      { deliverable: 'instagram_story', ...r(8000, 5000) },
      { deliverable: 'youtube_integration', ...r(60000, 45000) },
    ],
    acceptedDeliverables: ['instagram_reel', 'instagram_story', 'youtube_integration'],
    maxPackageDiscountPercent: 10,
    maxRevisions: 2,
    usageRights: { maxUsageDays: 90, paidAdsAllowed: false, whitelistingAllowed: false, perpetualAllowed: false },
    exclusivity: { acceptable: false, maxDays: 0 },
    paymentTerms: { maxNetDays: 30 },
  },
};

/** Completes onboarding + email authorisation for a client. */
export async function onboard(client, profile = FULL_PROFILE) {
  for (const [step, body] of [
    ['identity', { publicName: profile.publicName, city: profile.city, languages: profile.languages, niches: profile.niches, platformProfiles: profile.platformProfiles }],
    ['audience', { audienceMetrics: { avgViews: 15000 } }],
    ['commercial', { brandPreferences: profile.brandPreferences, barterPolicy: profile.barterPolicy, commercialPolicy: profile.commercialPolicy }],
    ['automation', { automation: { followUps: { enabled: true, maxAttempts: 2, intervalBusinessDays: 3 } } }],
  ]) {
    const res = await client.patch('/creator-profile/me', { ...body, completeStep: step });
    if (res.status !== 200) throw new Error(`onboarding ${step} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const conn = await client.post('/integrations/email/connect', { consent: true });
  if (conn.status !== 200) throw new Error(`email connect failed: ${JSON.stringify(conn.body)}`);
}

export async function drainWorker(rounds = 30) {
  const { createWorker } = await import('../src/jobs/worker.js');
  const w = createWorker({ pollMs: 1000, leaseMs: 60_000 });
  return w.drain(rounds);
}
