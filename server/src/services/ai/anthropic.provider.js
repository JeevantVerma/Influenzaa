import Anthropic from '@anthropic-ai/sdk';
import { AIError } from './errors.js';
import { getLogger } from '../../lib/logger.js';
import { taskProvider } from './tasks.js';

export function createAnthropicProvider({ apiKey, model, effort, timeoutMs }, health) {
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });

  async function structured({ task, system, user, jsonSchema, zod, light }) {
    const taskEffort = light ? 'low' : effort;
    let resp;
    const startedAt = Date.now();
    try {
      resp = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        // Server-side refusal fallback: a declined request is re-run on
        // Anthropic's recommended fallback model inside the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { effort: taskEffort, format: { type: 'json_schema', schema: jsonSchema } },
      });
    } catch (err) {
      health.recordFailure(err);
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AIError('AI provider rejected the credentials', { retryable: false, code: 'auth' });
      }
      if (err instanceof Anthropic.BadRequestError) {
        throw new AIError('AI provider rejected the request', { retryable: false, code: 'bad_request' });
      }
      if (err instanceof Anthropic.RateLimitError) throw new AIError('AI provider rate limit reached', { retryable: true, code: 'rate_limited' });
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AIError('AI provider timed out', { retryable: true, code: 'timeout' });
      if (err instanceof Anthropic.APIConnectionError) throw new AIError('Could not reach the AI provider', { retryable: true, code: 'connection' });
      if (err instanceof Anthropic.APIError) throw new AIError(`AI provider error (${err.status})`, { retryable: (err.status ?? 500) >= 500, code: 'api' });
      throw new AIError('Unexpected AI provider failure', { retryable: true, code: 'unknown' });
    }

    // Record usage before any validation: a response that fails later is still billed.
    const usage = {
      inputTokens: resp.usage?.input_tokens ?? 0,
      outputTokens: resp.usage?.output_tokens ?? 0,
      cacheReadTokens: resp.usage?.cache_read_input_tokens ?? 0,
      fallbackRan: (resp.usage?.iterations ?? []).some((it) => it.type === 'fallback_message'),
    };
    health.recordUsage(task, usage);
    getLogger().info({ ai: { task, model: resp.model, effort: taskEffort, stopReason: resp.stop_reason, ms: Date.now() - startedAt, ...usage } }, 'AI call');

    if (resp.stop_reason === 'refusal') {
      health.recordFailure(new Error('refusal'));
      throw new AIError('The AI provider declined this request', { retryable: false, code: 'refusal' });
    }
    if (resp.stop_reason === 'max_tokens') throw new AIError('AI output was truncated', { retryable: true, code: 'truncated' });

    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AIError('AI returned malformed JSON', { retryable: true, code: 'malformed' });
    }
    const parsed = zod.safeParse(json);
    if (!parsed.success) throw new AIError(`AI output failed ${task} schema validation`, { retryable: true, code: 'schema' });
    health.recordSuccess();
    return { data: parsed.data, provider: 'anthropic', model: resp.model, usage };
  }

  return taskProvider({ name: 'anthropic', model, run: structured });
}
