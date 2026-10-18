import { getConfig } from '../../config/env.js';
import { getLogger } from '../../lib/logger.js';
import { unexpectedAmounts } from '../../lib/amounts.js';
import { AIError } from './errors.js';
import { createAnthropicProvider } from './anthropic.provider.js';
import { mockProvider } from './mock.provider.js';
import { pitchTemplate, negotiationTemplate } from './templates.js';
import { draftZod } from './schemas.js';

export { AIError };

const health = {
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailure: null,
  recordSuccess() {
    this.lastSuccessAt = new Date();
  },
  recordFailure(err) {
    this.lastFailureAt = new Date();
    this.lastFailure = String(err?.message || err).slice(0, 200);
  },
};

const disabledProvider = {
  name: 'disabled',
  model: null,
  async classify() {
    throw new AIError('No AI provider is configured', { code: 'disabled' });
  },
  async extract() {
    throw new AIError('No AI provider is configured', { code: 'disabled' });
  },
  async draftPitch() {
    throw new AIError('No AI provider is configured', { code: 'disabled' });
  },
  async draftNegotiation() {
    throw new AIError('No AI provider is configured', { code: 'disabled' });
  },
};

let provider;
let override;

export function getAIProvider() {
  if (override) return override;
  if (!provider) {
    const cfg = getConfig().ai;
    if (cfg.provider === 'anthropic') provider = createAnthropicProvider(cfg, health);
    else if (cfg.provider === 'mock') provider = mockProvider;
    else provider = disabledProvider;
  }
  return provider;
}

export function setAIProviderForTests(p) {
  override = p;
}

export function aiStatus() {
  const p = getAIProvider();
  const recentFailure = health.lastFailureAt && (!health.lastSuccessAt || health.lastFailureAt > health.lastSuccessAt);
  return {
    provider: p.name,
    model: p.model,
    mode: p.name === 'anthropic' ? 'live' : p.name === 'mock' ? 'demo' : null,
    status: p.name === 'disabled' ? 'disconnected' : p.name === 'mock' ? 'demo' : recentFailure ? 'degraded' : 'connected',
    detail:
      p.name === 'mock'
        ? 'Development mock: rule-based outputs, clearly labelled. Set ANTHROPIC_API_KEY to use Claude.'
        : p.name === 'disabled'
          ? 'AI features are unavailable; templates and manual entry are used instead.'
          : recentFailure
            ? `Recent provider failure: ${health.lastFailure}`
            : 'Anthropic Claude configured.',
    lastSuccessAt: health.lastSuccessAt,
    lastFailureAt: health.lastFailureAt,
  };
}

/**
 * Draft a pitch. Falls back to a deterministic template on any AI failure so
 * the workflow never blocks on the model. Result is always labelled.
 */
export async function draftPitch(input) {
  try {
    const r = await getAIProvider().draftPitch(input);
    // Pitches must not quote prices; reject drafts that contain any amount.
    if (unexpectedAmounts(r.data.body, []).length) throw new AIError('Pitch draft contained a price', { code: 'policy' });
    return r;
  } catch (err) {
    if (!(err instanceof AIError)) throw err;
    getLogger().warn({ code: err.code }, 'Pitch draft fell back to template');
    return { data: draftZod.parse(pitchTemplate(input)), provider: 'template', model: null, fallbackReason: err.message };
  }
}

/**
 * Draft a negotiation message. Any monetary figure in the AI draft that is not
 * one of the deterministic, policy-approved amounts causes the draft to be
 * discarded in favour of the template.
 */
export async function draftNegotiation(input) {
  const allowedMajor = input.allowedAmountsMajor || [];
  try {
    const r = await getAIProvider().draftNegotiation(input);
    const bad = unexpectedAmounts(`${r.data.subject}\n${r.data.body}`, allowedMajor);
    if (bad.length) throw new AIError(`Draft introduced unapproved amounts: ${bad.map((b) => b.raw).join(', ')}`, { code: 'policy' });
    if (input.kind !== 'acceptance' && /\b(we|i) (accept|agree to)\b|\bdeal is confirmed\b|\bconsider it done\b/i.test(r.data.body)) {
      throw new AIError('Draft implied an acceptance that was not authorised', { code: 'policy' });
    }
    return r;
  } catch (err) {
    if (!(err instanceof AIError)) throw err;
    getLogger().warn({ code: err.code }, 'Negotiation draft fell back to template');
    return { data: draftZod.parse(negotiationTemplate(input)), provider: 'template', model: null, fallbackReason: err.message };
  }
}

/** Classify an inbound message; returns null if no AI is available. */
export async function classifyInbound(input) {
  try {
    return await getAIProvider().classify(input);
  } catch (err) {
    if (!(err instanceof AIError)) throw err;
    return null;
  }
}

/** Extract offer terms; returns null if no AI is available or output is invalid. */
export async function extractOffer(input) {
  try {
    return await getAIProvider().extract(input);
  } catch (err) {
    if (!(err instanceof AIError)) throw err;
    return { error: err.message };
  }
}
