import mongoose from 'mongoose';
import { AppError } from '../lib/errors.js';
import { getLogger } from '../lib/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(err, req, res, _next) {
  const log = getLogger();
  if (err instanceof AppError) {
    if (err.status >= 500) log.error({ err: err.message, code: err.code, path: req.path }, 'Request failed');
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON body' } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return res.status(422).json({ error: { code: 'validation_failed', message: 'Validation failed', details } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(404).json({ error: { code: 'not_found', message: 'Resource not found' } });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: { code: 'conflict', message: 'A conflicting record already exists' } });
  }
  log.error({ err: { message: err?.message, stack: err?.stack }, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } });
}
