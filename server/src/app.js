import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { getConfig } from './config/env.js';
import { getLogger } from './lib/logger.js';
import { loadSession, requireAuth, requireRole } from './middleware/auth.js';
import { rejectOperatorInjection } from './middleware/sanitize.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import creatorRoutes from './routes/creator.routes.js';
import negotiationRoutes from './routes/negotiation.routes.js';
import operationsRoutes from './routes/operations.routes.js';
import { healthRouter, webhookRouter, devRouter, adminRouter } from './routes/system.routes.js';
import { openApiDocument } from './openapi.js';

export function createApp() {
  const cfg = getConfig();
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin and server-to-server requests have no Origin header.
        if (!origin || cfg.frontendOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    }),
  );
  if (!cfg.isTest) {
    app.use(pinoHttp({ logger: getLogger(), autoLogging: { ignore: (req) => req.url === '/api/v1/health' }, customProps: () => ({}), serializers: { req: (r) => ({ method: r.method, url: r.url.split('?')[0] }), res: (r) => ({ statusCode: r.statusCode }) } }));
  }
  app.use(cookieParser());

  // Provider webhooks need the raw body for signature verification.
  app.use('/api/v1/webhooks', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }), webhookRouter);

  app.use(express.json({ limit: '200kb' }));
  app.use(rejectOperatorInjection);
  app.use(loadSession);

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: cfg.isTest ? 10_000 : 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => (req.user ? `u:${req.user._id}` : `ip:${ipKeyGenerator(req.ip)}`),
    message: { error: { code: 'rate_limited', message: 'Too many requests. Slow down a little.' } },
  });

  const v1 = express.Router();
  v1.use(healthRouter);
  v1.get('/openapi.json', (_req, res) => res.json(openApiDocument));
  v1.use(apiLimiter);
  v1.use('/auth', authRoutes);
  v1.use('/dev', devRouter);
  v1.use('/admin', adminRouter);
  v1.use(requireAuth, requireRole('creator'));
  v1.use(creatorRoutes);
  v1.use(negotiationRoutes);
  v1.use(operationsRoutes);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
