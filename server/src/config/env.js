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
  // Encrypts stored integration tokens. Separate from AUTH_SECRET so rotating the
  // session secret does not disconnect creators' integrations.
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters').optional().or(z.literal('').transform(() => undefined)),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  TRUST_PROXY: bool(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // AI
  AI_PROVIDER: z.enum(['auto', 'anthropic', 'gemini', 'mock', 'disabled']).default('auto'),
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_THINKING_LEVEL: z.enum(['minimal', 'low', 'medium', 'high']).default('medium'),
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
  // Reply address template; {token} identifies the conversation. Example for a
  // plain Gmail inbox: "you+cos-{token}@gmail.com". Default: reply+{token}@EMAIL_REPLY_TO_DOMAIN.
  EMAIL_REPLY_TO_ADDRESS: optionalString,
  // How brand replies reach the app: a signed webhook, or polling an IMAP inbox.
  INBOUND_PROVIDER: z.enum(['webhook', 'imap', 'none']).default('webhook'),
  IMAP_HOST: optionalString,
  IMAP_PORT: z.coerce.number().int().positive().default(993),
  IMAP_SECURE: bool(true),
  IMAP_USER: optionalString,
  IMAP_PASS: optionalString,
  IMAP_MAILBOX: z.string().default('INBOX'),

  // Discovery
  DISCOVERY_SOURCES: z.string().default('demo'),
  DISCOVERY_INTERVAL_MINUTES: z.coerce.number().int().positive().default(1440),
  DISCOVERY_MIN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  DISCOVERY_MAX_CONCURRENCY: z.coerce.number().int().positive().max(20).default(2),
  DISCOVERY_MANUAL_RUNS_PER_DAY: z.coerce.number().int().positive().default(6),
  BRAVE_SEARCH_API_KEY: optionalString,
  SERPER_API_KEY: optionalString,
  APIFY_TOKEN: optionalString,
  // Hard cap on what one Instagram scrape (Apify run) may cost.
  APIFY_MAX_USD_PER_RUN: z.coerce.number().positive().max(20).default(0.5),

  // Instagram DMs (official Instagram API with Instagram Login). Without an app id/secret,
  // creators can still connect by pasting a token generated in the Meta app dashboard.
  INSTAGRAM_APP_ID: optionalString,
  INSTAGRAM_APP_SECRET: optionalString,
  INSTAGRAM_REDIRECT_URI: optionalString, // must be HTTPS and registered in the Meta app
  INSTAGRAM_API_VERSION: z.string().default('v26.0'),
  INSTAGRAM_POLL_DMS: bool(true), // check connected inboxes every minute (development; production adds webhooks)

  // WhatsApp (official WhatsApp Business Cloud API). Incoming messages arrive only by webhook:
  // the Meta app's secret signs them, and the verify token is any string you also enter in Meta.
  WHATSAPP_APP_SECRET: optionalString,
  WHATSAPP_VERIFY_TOKEN: optionalString,
  WHATSAPP_API_VERSION: z.string().default('v26.0'),

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
    else if (e.GEMINI_API_KEY) aiProvider = 'gemini';
    else aiProvider = isProd ? 'disabled' : 'mock';
  }
  if (aiProvider === 'anthropic' && !e.ANTHROPIC_API_KEY) {
    problems.push('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  }
  if (aiProvider === 'gemini' && !e.GEMINI_API_KEY) {
    problems.push('AI_PROVIDER=gemini requires GEMINI_API_KEY');
  }
  if (aiProvider === 'mock' && isProd) {
    problems.push('AI_PROVIDER=mock is not allowed in production');
  }

  const demoAllowed = !isProd || e.ALLOW_DEMO_IN_PRODUCTION;
  if (e.EMAIL_PROVIDER === 'demo' && isProd && !e.ALLOW_DEMO_IN_PRODUCTION) {
    problems.push('EMAIL_PROVIDER=demo is not allowed in production (set smtp, disabled, or ALLOW_DEMO_IN_PRODUCTION=true for a staging demo)');
  }
  if (e.EMAIL_REPLY_TO_ADDRESS && !/^[^@\s]*\{token\}[^@\s]*@[^@\s]+\.[^@\s]+$/.test(e.EMAIL_REPLY_TO_ADDRESS)) {
    problems.push('EMAIL_REPLY_TO_ADDRESS must be an address containing {token} before the @, e.g. you+cos-{token}@gmail.com');
  }
  if (e.INBOUND_PROVIDER === 'imap') {
    if (!e.IMAP_HOST) problems.push('INBOUND_PROVIDER=imap requires IMAP_HOST');
    if (!(e.IMAP_USER || e.SMTP_USER) || !(e.IMAP_PASS || e.SMTP_PASS)) problems.push('INBOUND_PROVIDER=imap requires IMAP_USER and IMAP_PASS (or SMTP_USER and SMTP_PASS)');
    if (!e.EMAIL_REPLY_TO_ADDRESS) problems.push('INBOUND_PROVIDER=imap requires EMAIL_REPLY_TO_ADDRESS so replies can be matched to conversations');
  }
  if (e.EMAIL_PROVIDER === 'smtp') {
    for (const k of ['SMTP_HOST', 'EMAIL_FROM_ADDRESS']) if (!e[k]) problems.push(`EMAIL_PROVIDER=smtp requires ${k}`);
  }
  if (isProd && e.AUTH_SECRET.includes('change-me')) {
    problems.push('AUTH_SECRET still contains the placeholder value');
  }
  if (isProd && !e.ENCRYPTION_KEY) problems.push('ENCRYPTION_KEY is required in production (encrypts stored integration tokens)');
  if (e.ENCRYPTION_KEY && e.ENCRYPTION_KEY === e.AUTH_SECRET) problems.push('ENCRYPTION_KEY must be different from AUTH_SECRET');

  const sources = e.DISCOVERY_SOURCES.split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of sources) {
    if (!['demo', 'rss', 'brave', 'gdelt', 'serper', 'instagram'].includes(s)) problems.push(`Unknown discovery source "${s}"`);
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
    // Integration tokens are encrypted with the first key; decryption also tries
    // AUTH_SECRET so tokens saved before ENCRYPTION_KEY was set keep working.
    tokenKeys: e.ENCRYPTION_KEY ? [e.ENCRYPTION_KEY, e.AUTH_SECRET] : [e.AUTH_SECRET],
    sessionTtlMs: e.SESSION_TTL_HOURS * 3600_000,
    trustProxy: e.TRUST_PROXY,
    logLevel: e.NODE_ENV === 'test' ? 'silent' : e.LOG_LEVEL,
    ai: {
      provider: aiProvider,
      apiKey: e.ANTHROPIC_API_KEY,
      model: e.ANTHROPIC_MODEL,
      effort: e.ANTHROPIC_EFFORT,
      timeoutMs: e.AI_TIMEOUT_MS,
      gemini: { apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL, thinkingLevel: e.GEMINI_THINKING_LEVEL },
    },
    email: {
      provider: e.EMAIL_PROVIDER,
      fromAddress: e.EMAIL_FROM_ADDRESS || 'outreach@creatoros.local',
      fromName: e.EMAIL_FROM_NAME,
      replyToDomain: e.EMAIL_REPLY_TO_DOMAIN,
      smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, pass: e.SMTP_PASS },
      inboundWebhookSecret: e.INBOUND_WEBHOOK_SECRET,
      replyToAddress: e.EMAIL_REPLY_TO_ADDRESS,
      inbound: {
        provider: e.INBOUND_PROVIDER,
        imap: { host: e.IMAP_HOST, port: e.IMAP_PORT, secure: e.IMAP_SECURE, user: e.IMAP_USER || e.SMTP_USER, pass: e.IMAP_PASS || e.SMTP_PASS, mailbox: e.IMAP_MAILBOX },
      },
    },
    discovery: {
      sources,
      defaultIntervalMinutes: e.DISCOVERY_INTERVAL_MINUTES,
      minIntervalMinutes: e.DISCOVERY_MIN_INTERVAL_MINUTES,
      maxConcurrency: e.DISCOVERY_MAX_CONCURRENCY,
      manualRunsPerDay: e.DISCOVERY_MANUAL_RUNS_PER_DAY,
      braveApiKey: e.BRAVE_SEARCH_API_KEY,
      // serper and instagram report "unavailable" at run time when their key is missing.
      serperApiKey: e.SERPER_API_KEY,
      apifyToken: e.APIFY_TOKEN,
      apifyMaxUsdPerRun: e.APIFY_MAX_USD_PER_RUN,
    },
    instagram: {
      appId: e.INSTAGRAM_APP_ID,
      appSecret: e.INSTAGRAM_APP_SECRET,
      redirectUri: e.INSTAGRAM_REDIRECT_URI,
      apiVersion: e.INSTAGRAM_API_VERSION,
      pollDms: e.INSTAGRAM_POLL_DMS,
      loginConfigured: !!(e.INSTAGRAM_APP_ID && e.INSTAGRAM_APP_SECRET && e.INSTAGRAM_REDIRECT_URI),
    },
    whatsapp: {
      appSecret: e.WHATSAPP_APP_SECRET,
      verifyToken: e.WHATSAPP_VERIFY_TOKEN,
      apiVersion: e.WHATSAPP_API_VERSION,
      webhookConfigured: !!(e.WHATSAPP_APP_SECRET && e.WHATSAPP_VERIFY_TOKEN),
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
