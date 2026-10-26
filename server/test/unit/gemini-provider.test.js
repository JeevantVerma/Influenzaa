import { describe, it, expect } from 'vitest';
import { createGeminiProvider, toGeminiSchema } from '../../src/services/ai/gemini.provider.js';
import { extractJsonSchema } from '../../src/services/ai/schemas.js';
import { AIError } from '../../src/services/ai/errors.js';
import { buildConfig } from '../../src/config/env.js';

// The Gemini provider is exercised against a fake fetch: no network calls.

function fakeHealth() {
  return { calls: [], failures: 0, successes: 0, recordUsage(task, u) { this.calls.push({ task, ...u }); }, recordFailure() { this.failures += 1; }, recordSuccess() { this.successes += 1; } };
}

const jsonResponse = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body });

const completed = (payload, usage = { total_input_tokens: 120, total_output_tokens: 40, total_thought_tokens: 15 }) => ({
  id: 'int_1',
  object: 'interaction',
  model: 'gemini-3.8-flash',
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(payload) }] }],
  usage,
});

function setup(responses) {
  const requests = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const health = fakeHealth();
  const sleeps = [];
  const provider = createGeminiProvider({ apiKey: 'test-key', model: 'gemini-3.8-flash', thinkingLevel: 'medium', timeoutMs: 5000, fetchImpl, sleepImpl: async (ms) => sleeps.push(ms) }, health);
  return { provider, requests, health, sleeps };
}

const CLASSIFIED = { intent: 'offer', confidence: 0.9, summary: 'Brand offers a paid reel.', mentions_compensation: true };

describe('gemini provider', () => {
  it('sends the shared prompt with JSON output, no storage, and low thinking for classification', async () => {
    const { provider, requests, health } = setup([jsonResponse(200, completed(CLASSIFIED))]);
    const r = await provider.classify({ text: 'We offer ₹20,000 for one reel', subject: 'Re: hi' });
    expect(r).toMatchObject({ provider: 'gemini', model: 'gemini-3.8-flash', data: CLASSIFIED });
    const { url, init, body } = requests[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers['x-goog-api-key']).toBe('test-key');
    expect(body.store).toBe(false);
    expect(body.generation_config.thinking_level).toBe('low');
    expect(body.response_format).toMatchObject({ type: 'text', mime_type: 'application/json' });
    expect(body.system_instruction).toMatch(/untrusted_content/);
    expect(body.input).toMatch(/<untrusted_content source="brand_email">/);
    // Thinking tokens are billed as output, so they are counted as output.
    expect(health.calls[0]).toMatchObject({ task: 'classify', inputTokens: 120, outputTokens: 55 });
  });

  it('uses the configured thinking level for drafting', async () => {
    const { provider, requests } = setup([jsonResponse(200, completed({ subject: 'Collaboration idea', body: 'Hi team, I would love to explore a collaboration with you on your new launch.' }))]);
    await provider.draftPitch({ creator: { publicName: 'Priya' }, brand: { name: 'Stride Lab' }, opportunity: {} });
    expect(requests[0].body.generation_config.thinking_level).toBe('medium');
  });

  it('converts nullable fields to type arrays and never sends anyOf', () => {
    const converted = toGeminiSchema(extractJsonSchema);
    expect(JSON.stringify(converted)).not.toMatch(/anyOf/);
    expect(converted.properties.total_amount.type).toEqual(['number', 'null']);
    expect(converted.properties.payment_type.type).toEqual(['string', 'null']);
    expect(converted.properties.payment_type.description).toMatch(/paid, barter, hybrid/);
    expect(converted.properties.deliverables.items.properties.description.type).toEqual(['string', 'null']);
    expect(converted.additionalProperties).toBe(false);
  });

  it('retries rate limits and server errors, then succeeds', async () => {
    const { provider, requests, sleeps } = setup([jsonResponse(429, { error: { message: 'quota' } }, { 'retry-after': '2' }), jsonResponse(503, {}), jsonResponse(200, completed(CLASSIFIED))]);
    const r = await provider.classify({ text: 'hi' });
    expect(r.data.intent).toBe('offer');
    expect(requests).toHaveLength(3);
    expect(sleeps).toEqual([2000, 3000]);
  });

  it('gives up after repeated rate limits with a retryable error', async () => {
    const { provider, requests } = setup([jsonResponse(429, {}), jsonResponse(429, {}), jsonResponse(429, {})]);
    await expect(provider.classify({ text: 'hi' })).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
    expect(requests).toHaveLength(3);
  });

  it('stops calling while a daily quota is exhausted', async () => {
    const { provider, requests } = setup([jsonResponse(429, { error: { message: 'limit: 20 requests per day' } }, { 'retry-after': '13673' })]);
    const first = await provider.classify({ text: 'hi' }).catch((e) => e);
    expect(first).toMatchObject({ code: 'rate_limited', retryable: false });
    expect(first.message).toMatch(/resets in about 3h 48m/);
    const second = await provider.extract({ text: 'hi', defaultCurrency: 'INR' }).catch((e) => e);
    expect(second.code).toBe('rate_limited');
    expect(requests).toHaveLength(1); // no retries, no second call
  });

  it('does not retry rejected credentials', async () => {
    const { provider, requests, health } = setup([jsonResponse(403, { error: { message: 'API key not valid' } })]);
    const err = await provider.classify({ text: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(AIError);
    expect(err).toMatchObject({ code: 'auth', retryable: false });
    expect(requests).toHaveLength(1);
    expect(health.failures).toBe(1);
  });

  it('treats a safety-blocked interaction as a refusal', async () => {
    const { provider } = setup([jsonResponse(200, { status: 'failed', errors: [{ code: 'SAFETY', message: 'Response blocked for safety' }], usage: {} })]);
    await expect(provider.classify({ text: 'hi' })).rejects.toMatchObject({ code: 'refusal', retryable: false });
  });

  it('treats an incomplete interaction as truncated', async () => {
    const { provider } = setup([jsonResponse(200, { status: 'incomplete', steps: [], usage: {} })]);
    await expect(provider.extract({ text: 'hi', defaultCurrency: 'INR' })).rejects.toMatchObject({ code: 'truncated' });
  });

  it('rejects output that does not pass the Zod schema', async () => {
    const { provider, health } = setup([jsonResponse(200, completed({ ...CLASSIFIED, intent: 'accept_now' }))]);
    await expect(provider.classify({ text: 'hi' })).rejects.toMatchObject({ code: 'schema' });
    expect(health.successes).toBe(0);
    expect(health.calls).toHaveLength(1); // usage is still recorded
  });

  it('accepts JSON wrapped in a Markdown fence', async () => {
    const body = completed(CLASSIFIED);
    body.steps[0].content[0].text = `\`\`\`json\n${JSON.stringify(CLASSIFIED)}\n\`\`\``;
    const { provider } = setup([jsonResponse(200, body)]);
    expect((await provider.classify({ text: 'hi' })).data.intent).toBe('offer');
  });
});

describe('AI provider selection', () => {
  const base = { MONGODB_URI: 'mongodb://x/y', AUTH_SECRET: 'a'.repeat(40) };
  it('auto prefers Claude, then Gemini, then the mock in development', () => {
    expect(buildConfig({ ...base, GEMINI_API_KEY: 'g' }).ai.provider).toBe('gemini');
    expect(buildConfig({ ...base, GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).ai.provider).toBe('anthropic');
    expect(buildConfig(base).ai.provider).toBe('mock');
  });
  it('requires a key when gemini is chosen explicitly', () => {
    expect(() => buildConfig({ ...base, AI_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
  });
});
