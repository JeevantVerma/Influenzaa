import pino from 'pino';

// Paths redacted from every structured log line. Message bodies, credentials,
// tokens and personal contact data must never reach the logs.
export const REDACT_PATHS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'content',
  'body',
  'html',
  'text',
  'email',
  'businessEmail',
  'to',
  'from',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.content',
  '*.body',
  '*.email',
  '*.businessEmail',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

let logger;

export function createLogger(level = process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info') {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    base: { service: 'creatoros' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export function getLogger() {
  if (!logger) logger = createLogger();
  return logger;
}

export function setLogger(l) {
  logger = l;
}
