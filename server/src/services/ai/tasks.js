import {
  classifyJsonSchema,
  classifyZod,
  extractJsonSchema,
  extractZod,
  draftJsonSchema,
  draftZod,
  brandSignalsJsonSchema,
  brandSignalsZod,
} from './schemas.js';
import { CLASSIFY_SYSTEM, EXTRACT_SYSTEM, PITCH_SYSTEM, NEGOTIATION_SYSTEM, BRAND_SIGNALS_SYSTEM, DM_STYLE } from './prompts.js';

const channelNote = (channel) => (channel === 'instagram' ? `${DM_STYLE}\n` : '');

// Provider-independent task definitions: the exact system prompt, user
// message, output schema and validator for each AI task. Every live provider
// sends these unchanged, so prompt and untrusted-content handling are
// identical whichever model runs.

const untrusted = (label, text) => `<untrusted_content source="${label}">\n${String(text ?? '').slice(0, 20_000)}\n</untrusted_content>`;

export function classifyTask({ text, subject }) {
  return {
    task: 'classify',
    system: CLASSIFY_SYSTEM,
    user: `Classify this reply to the creator's outreach.\nSubject: ${String(subject ?? '').slice(0, 300)}\n${untrusted('brand_email', text)}`,
    jsonSchema: classifyJsonSchema,
    zod: classifyZod,
    // Short, closed-set labelling: minimal reasoning is enough and keeps inbound processing fast.
    light: true,
  };
}

export function extractTask({ text, defaultCurrency }) {
  return {
    task: 'extract',
    system: EXTRACT_SYSTEM,
    user: `The creator's default currency is ${defaultCurrency}. Extract the offer terms from this brand message.\n${untrusted('brand_email', text)}`,
    jsonSchema: extractJsonSchema,
    zod: extractZod,
  };
}

/** Facts the creator entered in their profile; the only creator facts a model may use. */
export function creatorFacts(creator = {}, { withAudience = false } = {}) {
  const facts = {
    creator_name: creator.publicName,
    niches: creator.niches,
    languages: creator.languages,
    city: creator.city,
    platforms: (creator.platformProfiles || []).map((p) => ({ platform: p.platform, handle: p.handle, ...(withAudience && p.followers ? { followers: p.followers } : {}) })),
    formats: creator.contentFormats,
  };
  if (withAudience) {
    const a = creator.audienceMetrics || {};
    facts.audience = { avg_views: a.avgViews ?? null, engagement_rate_percent: a.engagementRatePercent ?? null, top_locations: a.topLocations?.length ? a.topLocations : null, posting_frequency: a.postingFrequency ?? null };
  }
  return facts;
}

export function pitchTask({ creator, brand, opportunity, channel }) {
  const facts = creatorFacts(creator);
  const evidence = (opportunity.sourceEvidence || []).slice(0, 4).map((e) => ({ title: e.title, excerpt: e.excerpt, verification: e.verification }));
  return {
    task: 'pitch',
    system: PITCH_SYSTEM,
    user: `${channelNote(channel)}<creator_facts>${JSON.stringify(facts)}</creator_facts>\n<brand>${JSON.stringify({ name: brand.name, industry: brand.industry, product_or_campaign: opportunity.productOrCampaign })}</brand>\n<suggested_angle>${opportunity.outreachAngle ?? ''}</suggested_angle>\n${untrusted('brand_research', JSON.stringify(evidence))}\nWrite the pitch email as JSON {subject, body}.`,
    jsonSchema: draftJsonSchema,
    zod: draftZod,
  };
}

export function negotiationTask({ kind, creator, brand, requiredTerms, questions, reasons, lastInbound, channel }) {
  return {
    task: 'negotiation',
    system: NEGOTIATION_SYSTEM,
    user: `${channelNote(channel)}message_kind: ${kind}\n<creator_facts>${JSON.stringify(creatorFacts(creator, { withAudience: true }))}</creator_facts>\n<brand>${JSON.stringify({ name: brand.name })}</brand>\n<required_terms>${JSON.stringify(requiredTerms ?? {})}</required_terms>\n<questions_to_ask>${JSON.stringify(questions ?? [])}</questions_to_ask>\n<justification_points>${JSON.stringify(reasons ?? [])}</justification_points>\n${untrusted('latest_brand_message', lastInbound ?? '')}\nWrite the email as JSON {subject, body}.`,
    jsonSchema: draftJsonSchema,
    zod: draftZod,
  };
}

export function brandSignalsTask({ title, text, sourceDomain }) {
  return {
    task: 'brand_signals',
    system: BRAND_SIGNALS_SYSTEM,
    user: `Article title: ${String(title ?? '').slice(0, 300)}\nPublished by: ${sourceDomain ?? 'unknown'}\n${untrusted('news_article', text)}`,
    jsonSchema: brandSignalsJsonSchema,
    zod: brandSignalsZod,
  };
}

/** Builds the provider interface used by `ai/index.js` from one `run(taskSpec)` function. */
export function taskProvider({ name, model, run }) {
  return {
    name,
    model,
    classify: (input) => run(classifyTask(input)),
    extract: (input) => run(extractTask(input)),
    draftPitch: (input) => run(pitchTask(input)),
    draftNegotiation: (input) => run(negotiationTask(input)),
    extractBrandSignals: (input) => run(brandSignalsTask(input)),
  };
}
