import { z } from 'zod';

const bool = (def) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? def : ['true', '1', 'yes'].includes(v)));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  TRUST_PROXY: bool(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // AI
  AI_PROVIDER: z.enum(['auto', 'anthropic', 'mock', 'disabled']).default('auto'),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  // Email
  EMAIL_PROVIDER: z.enum(['demo', 'smtp', 'disabled']).default('demo'),
  EMAIL_FROM_ADDRESS: optionalString,
  EMAIL_FROM_NAME: z.string().default('CreatorOS'),
  EMAIL_REPLY_TO_DOMAIN: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  INBOUND_WEBHOOK_SECRET: optionalString,

  // Discovery
  DISCOVERY_SOURCES: z.string().default('demo'),
  DISCOVERY_INTERVAL_MINUTES: z.coerce.number().int().positive().default(1440),
  DISCOVERY_MIN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  DISCOVERY_MAX_CONCURRENCY: z.coerce.number().int().positive().max(20).default(2),
  DISCOVERY_MANUAL_RUNS_PER_DAY: z.coerce.number().int().positive().default(6),
  BRAVE_SEARCH_API_KEY: optionalString,

  // Worker
  RUN_WORKER_IN_PROCESS: bool(true),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(5000),
  WORKER_LEASE_MS: z.coerce.number().int().positive().default(5 * 60_000),

  // Demo / simulation features (simulated inbound replies, demo research source)
  DEMO_FEATURES_ENABLED: bool(true),
  ALLOW_DEMO_IN_PRODUCTION: bool(false),
});

function buildConfig(raw) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  const problems = [];

  // AI provider resolution: production never silently falls back to mock.
  let aiProvider = e.AI_PROVIDER;
  if (aiProvider === 'auto') {
    if (e.ANTHROPIC_API_KEY) aiProvider = 'anthropic';
    else aiProvider = isProd ? 'disabled' : 'mock';
  }
  if (aiProvider === 'anthropic' && !e.ANTHROPIC_API_KEY) {
    problems.push('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  }
  if (aiProvider === 'mock' && isProd) {
    problems.push('AI_PROVIDER=mock is not allowed in production');
  }

  const demoAllowed = !isProd || e.ALLOW_DEMO_IN_PRODUCTION;
  if (e.EMAIL_PROVIDER === 'demo' && isProd && !e.ALLOW_DEMO_IN_PRODUCTION) {
    problems.push('EMAIL_PROVIDER=demo is not allowed in production (set smtp, disabled, or ALLOW_DEMO_IN_PRODUCTION=true for a staging demo)');
  }
  if (e.EMAIL_PROVIDER === 'smtp') {
    for (const k of ['SMTP_HOST', 'EMAIL_FROM_ADDRESS']) if (!e[k]) problems.push(`EMAIL_PROVIDER=smtp requires ${k}`);
  }
  if (isProd && e.AUTH_SECRET.includes('change-me')) {
    problems.push('AUTH_SECRET still contains the placeholder value');
  }

  const sources = e.DISCOVERY_SOURCES.split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of sources) {
    if (!['demo', 'rss', 'brave'].includes(s)) problems.push(`Unknown discovery source "${s}"`);
  }
  if (sources.includes('demo') && !demoAllowed) problems.push('The demo discovery source is not allowed in production');
  if (sources.includes('brave') && !e.BRAVE_SEARCH_API_KEY) problems.push('Discovery source "brave" requires BRAVE_SEARCH_API_KEY');

  if (problems.length) {
    throw new Error(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  return Object.freeze({
    env: e.NODE_ENV,
    isProd,
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    mongoUri: e.MONGODB_URI,
    frontendOrigins: e.FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean),
    authSecret: e.AUTH_SECRET,
    sessionTtlMs: e.SESSION_TTL_HOURS * 3600_000,
    trustProxy: e.TRUST_PROXY,
    logLevel: e.NODE_ENV === 'test' ? 'silent' : e.LOG_LEVEL,
    ai: {
      provider: aiProvider,
      apiKey: e.ANTHROPIC_API_KEY,
      model: e.ANTHROPIC_MODEL,
      effort: e.ANTHROPIC_EFFORT,
      timeoutMs: e.AI_TIMEOUT_MS,
    },
    email: {
      provider: e.EMAIL_PROVIDER,
      fromAddress: e.EMAIL_FROM_ADDRESS || 'outreach@creatoros.local',
      fromName: e.EMAIL_FROM_NAME,
      replyToDomain: e.EMAIL_REPLY_TO_DOMAIN,
      smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, pass: e.SMTP_PASS },
      inboundWebhookSecret: e.INBOUND_WEBHOOK_SECRET,
    },
    discovery: {
      sources,
      defaultIntervalMinutes: e.DISCOVERY_INTERVAL_MINUTES,
      minIntervalMinutes: e.DISCOVERY_MIN_INTERVAL_MINUTES,
      maxConcurrency: e.DISCOVERY_MAX_CONCURRENCY,
      manualRunsPerDay: e.DISCOVERY_MANUAL_RUNS_PER_DAY,
      braveApiKey: e.BRAVE_SEARCH_API_KEY,
    },
    worker: {
      inProcess: e.RUN_WORKER_IN_PROCESS,
      pollMs: e.WORKER_POLL_MS,
      leaseMs: e.WORKER_LEASE_MS,
    },
    demo: {
      enabled: e.DEMO_FEATURES_ENABLED && demoAllowed,
    },
  });
}

let cached;
export function getConfig() {
  if (!cached) cached = buildConfig(process.env);
  return cached;
}

/** Test helper: rebuild configuration after mutating process.env. */
export function resetConfig() {
  cached = undefined;
}

export { buildConfig };
