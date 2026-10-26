import { AIError } from './errors.js';
import { getLogger } from '../../lib/logger.js';
import { taskProvider } from './tasks.js';

// Google Gemini through the Interactions REST API. Requests are sent with
// `store: false` so Google does not keep the brand emails we analyse.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Converts the shared output schemas to the subset Gemini documents:
 * nullable fields become type arrays (`["string", "null"]`) instead of anyOf.
 * A nullable enum loses its enum (listed in the description instead); the
 * Zod validator still rejects any value outside it.
 */
export function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== 'object') return node;
  const variants = node.anyOf;
  if (Array.isArray(variants) && variants.length === 2 && variants.some((s) => s.type === 'null')) {
    const base = variants.find((s) => s.type !== 'null');
    const { anyOf: _anyOf, ...rest } = node;
    const out = { ...rest, ...toGeminiSchema(base), type: [base.type, 'null'] };
    if (out.enum) {
      out.description = `One of: ${out.enum.join(', ')}. null if not stated.`;
      delete out.enum;
    }
    return out;
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, toGeminiSchema(v)]));
}

const retryAfterSeconds = (res) => {
  const n = Number(res?.headers?.get?.('retry-after'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
// A longer wait than this means a daily quota, not a per-minute burst.
const QUOTA_WAIT_SECONDS = 60;

function formatWait(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.ceil((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function quotaError(untilMs) {
  return new AIError(`AI provider quota reached; resets in about ${formatWait(Math.max(60, (untilMs - Date.now()) / 1000))}`, { retryable: false, code: 'rate_limited' });
}

async function errorDetail(res) {
  try {
    const body = await res.json();
    return String(body?.error?.message || body?.message || '').slice(0, 300);
  } catch {
    return '';
  }
}

function statusError(status, detail) {
  if (status === 401 || status === 403) return new AIError('AI provider rejected the credentials', { retryable: false, code: 'auth' });
  if (status === 404) return new AIError('AI model not found. Check GEMINI_MODEL', { retryable: false, code: 'bad_request' });
  if (status === 400) return new AIError(`AI provider rejected the request${detail ? `: ${detail}` : ''}`, { retryable: false, code: 'bad_request' });
  if (status === 429) return new AIError('AI provider rate limit reached', { retryable: true, code: 'rate_limited' });
  return new AIError(`AI provider error (${status})`, { retryable: status >= 500, code: 'api' });
}

/** Model output as JSON text. Tolerates a stray Markdown code fence. */
function outputText(resp) {
  const text = (resp.steps || [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content || [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('')
    .trim();
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export function createGeminiProvider({ apiKey, model, thinkingLevel, timeoutMs, fetchImpl = fetch, sleepImpl = sleep, now = Date.now }, health) {
  // While a daily quota is exhausted, fail at once instead of calling again.
  let blockedUntil = 0;

  async function post(body) {
    if (blockedUntil > now()) throw quotaError(blockedUntil);
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (err?.name === 'TimeoutError') throw new AIError('AI provider timed out', { retryable: true, code: 'timeout' });
        if (attempt < MAX_RETRIES) {
          await sleepImpl(1000 * 3 ** attempt);
          continue;
        }
        throw new AIError('Could not reach the AI provider', { retryable: true, code: 'connection' });
      }
      if (res.ok) return res.json();
      const wait = retryAfterSeconds(res);
      if (res.status === 429 && wait > QUOTA_WAIT_SECONDS) {
        blockedUntil = now() + wait * 1000;
        throw quotaError(blockedUntil);
      }
      if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        await sleepImpl(wait ? wait * 1000 : 1000 * 3 ** attempt);
        continue;
      }
      throw statusError(res.status, await errorDetail(res));
    }
  }

  async function structured({ task, system, user, jsonSchema, zod, light }) {
    const level = light ? 'low' : thinkingLevel;
    const startedAt = Date.now();
    let resp;
    try {
      resp = await post({
        model,
        system_instruction: system,
        input: user,
        response_format: { type: 'text', mime_type: 'application/json', schema: toGeminiSchema(jsonSchema) },
        generation_config: { thinking_level: level, max_output_tokens: 16000 },
        store: false,
      });
    } catch (err) {
      health.recordFailure(err);
      throw err instanceof AIError ? err : new AIError('Unexpected AI provider failure', { retryable: true, code: 'unknown' });
    }

    const u = resp.usage || {};
    const thoughtTokens = u.total_thought_tokens ?? 0;
    // Thinking tokens are billed like output tokens, so they count as output here.
    const usage = { inputTokens: u.total_input_tokens ?? 0, outputTokens: (u.total_output_tokens ?? 0) + thoughtTokens, cacheReadTokens: u.total_cached_tokens ?? 0, fallbackRan: false };
    health.recordUsage(task, usage);
    getLogger().info({ ai: { task, model: resp.model || model, thinkingLevel: level, status: resp.status, ms: Date.now() - startedAt, thoughtTokens, ...usage } }, 'AI call');

    if (resp.status === 'incomplete') throw new AIError('AI output was truncated', { retryable: true, code: 'truncated' });
    if (resp.status !== 'completed') {
      const reason = (resp.errors || []).map((e) => `${e.code || ''} ${e.message || ''}`).join('; ');
      health.recordFailure(new Error(reason || resp.status));
      if (/safety|blocked|prohibited/i.test(reason)) throw new AIError('The AI provider declined this request', { retryable: false, code: 'refusal' });
      throw new AIError(`AI provider returned status ${resp.status}`, { retryable: true, code: 'api' });
    }

    let json;
    try {
      json = JSON.parse(outputText(resp));
    } catch {
      throw new AIError('AI returned malformed JSON', { retryable: true, code: 'malformed' });
    }
    const parsed = zod.safeParse(json);
    if (!parsed.success) throw new AIError(`AI output failed ${task} schema validation`, { retryable: true, code: 'schema' });
    health.recordSuccess();
    return { data: parsed.data, provider: 'gemini', model: resp.model || model, usage };
  }

  return taskProvider({ name: 'gemini', model, run: structured });
}
