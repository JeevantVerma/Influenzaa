import Anthropic from '@anthropic-ai/sdk';
import { AIError } from './errors.js';
import {
  classifyJsonSchema,
  classifyZod,
  extractJsonSchema,
  extractZod,
  draftJsonSchema,
  draftZod,
} from './schemas.js';
import { CLASSIFY_SYSTEM, EXTRACT_SYSTEM, PITCH_SYSTEM, NEGOTIATION_SYSTEM } from './prompts.js';

const untrusted = (label, text) => `<untrusted_content source="${label}">\n${String(text ?? '').slice(0, 20_000)}\n</untrusted_content>`;

export function createAnthropicProvider({ apiKey, model, effort, timeoutMs }, health) {
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });

  async function structured(task, system, userContent, jsonSchema, zodSchema) {
    let resp;
    try {
      resp = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        // Server-side refusal fallback: a declined request is re-run on
        // Anthropic's recommended fallback model inside the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: userContent }],
        output_config: { effort, format: { type: 'json_schema', schema: jsonSchema } },
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
    const parsed = zodSchema.safeParse(json);
    if (!parsed.success) throw new AIError(`AI output failed ${task} schema validation`, { retryable: true, code: 'schema' });
    health.recordSuccess();
    return { data: parsed.data, provider: 'anthropic', model: resp.model };
  }

  return {
    name: 'anthropic',
    model,
    classify({ text, subject }) {
      return structured(
        'classify',
        CLASSIFY_SYSTEM,
        `Classify this reply to the creator's outreach.\nSubject: ${String(subject ?? '').slice(0, 300)}\n${untrusted('brand_email', text)}`,
        classifyJsonSchema,
        classifyZod,
      );
    },
    extract({ text, defaultCurrency }) {
      return structured(
        'extract',
        EXTRACT_SYSTEM,
        `The creator's default currency is ${defaultCurrency}. Extract the offer terms from this brand message.\n${untrusted('brand_email', text)}`,
        extractJsonSchema,
        extractZod,
      );
    },
    draftPitch({ creator, brand, opportunity }) {
      const facts = {
        creator_name: creator.publicName,
        niches: creator.niches,
        languages: creator.languages,
        city: creator.city,
        platforms: (creator.platformProfiles || []).map((p) => ({ platform: p.platform, handle: p.handle })),
        formats: creator.contentFormats,
      };
      const evidence = (opportunity.sourceEvidence || []).slice(0, 4).map((e) => ({ title: e.title, excerpt: e.excerpt, verification: e.verification }));
      return structured(
        'pitch',
        PITCH_SYSTEM,
        `<creator_facts>${JSON.stringify(facts)}</creator_facts>\n<brand>${JSON.stringify({ name: brand.name, industry: brand.industry, product_or_campaign: opportunity.productOrCampaign })}</brand>\n<suggested_angle>${opportunity.outreachAngle ?? ''}</suggested_angle>\n${untrusted('brand_research', JSON.stringify(evidence))}\nWrite the pitch email as JSON {subject, body}.`,
        draftJsonSchema,
        draftZod,
      );
    },
    draftNegotiation({ kind, creator, brand, requiredTerms, questions, reasons, lastInbound }) {
      return structured(
        'negotiation',
        NEGOTIATION_SYSTEM,
        `message_kind: ${kind}\n<creator>${JSON.stringify({ name: creator.publicName })}</creator>\n<brand>${JSON.stringify({ name: brand.name })}</brand>\n<required_terms>${JSON.stringify(requiredTerms ?? {})}</required_terms>\n<questions_to_ask>${JSON.stringify(questions ?? [])}</questions_to_ask>\n<justification_points>${JSON.stringify(reasons ?? [])}</justification_points>\n${untrusted('latest_brand_message', lastInbound ?? '')}\nWrite the email as JSON {subject, body}.`,
        draftJsonSchema,
        draftZod,
      );
    },
  };
}
