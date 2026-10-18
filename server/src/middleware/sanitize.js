import { badRequest } from '../lib/errors.js';

function hasOperatorKeys(value, depth = 0) {
  if (depth > 20 || value === null || typeof value !== 'object') return false;
  for (const key of Object.keys(value)) {
    if (key.startsWith('$') || key.includes('\u0000') || key === '__proto__' || key === 'constructor' || key === 'prototype') return true;
    if (hasOperatorKeys(value[key], depth + 1)) return true;
  }
  return false;
}

/** Rejects request payloads that try to smuggle MongoDB operators or prototype keys. */
export function rejectOperatorInjection(req, _res, next) {
  if (hasOperatorKeys(req.body) || hasOperatorKeys(req.query)) {
    return next(badRequest('Request contains disallowed keys'));
  }
  next();
}
