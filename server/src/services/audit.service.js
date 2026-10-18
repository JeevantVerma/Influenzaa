import { AuditEvent } from '../models/index.js';
import { getLogger } from '../lib/logger.js';

// Keys whose values are never written to the audit log.
const SENSITIVE_KEYS = /pass|token|secret|key|cookie|content|body|html|email|phone|address/i;

export function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return `${value.slice(0, 300)}…`;
  return value;
}

/**
 * Records an audit event. Audit failures are logged but never break the
 * calling workflow, except where callers explicitly await and check.
 */
export async function recordAudit({ actorType, actorId, creatorId, eventType, resourceType, resourceId, metadata }) {
  try {
    return await AuditEvent.create({
      actorType,
      actorId: actorId ? String(actorId) : null,
      creatorId: creatorId || null,
      eventType,
      resourceType,
      resourceId: resourceId ? String(resourceId) : undefined,
      redactedMetadata: metadata ? redact(metadata) : undefined,
    });
  } catch (err) {
    getLogger().error({ err: err.message, eventType }, 'Failed to write audit event');
    return null;
  }
}
