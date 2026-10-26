import { z } from 'zod';
import { DELIVERABLE_TYPES } from '../../models/shared.js';

// Each AI task has (1) a JSON Schema sent to the provider as a structured
// output format and (2) a Zod schema that re-validates whatever comes back.
// Model output is never trusted without passing the Zod schema.

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
// anyOf rather than a type array: anyOf is the documented structured-output form.
const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
const str = { type: 'string' };
const strArr = { type: 'array', items: str };

export const INTENTS = ['offer', 'acceptance', 'positive_interest', 'information_request', 'decline', 'opt_out', 'out_of_office', 'question', 'other'];

export const classifyJsonSchema = obj({
  intent: { type: 'string', enum: INTENTS },
  confidence: { type: 'number' },
  summary: str,
  mentions_compensation: { type: 'boolean' },
  business_inquiry: { type: 'boolean' },
});
export const classifyZod = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(600),
  mentions_compensation: z.boolean(),
  business_inquiry: z.boolean().optional().default(false),
});

const DELIV = [...DELIVERABLE_TYPES, 'other'];
export const extractJsonSchema = obj({
  payment_type: { anyOf: [{ type: 'string', enum: ['paid', 'barter', 'hybrid'] }, { type: 'null' }] },
  total_amount: nullable('number'),
  currency: nullable('string'),
  deliverables: {
    type: 'array',
    items: obj({ type: { type: 'string', enum: DELIV }, quantity: { type: 'integer' }, description: nullable('string'), unit_price: nullable('number') }),
  },
  barter_product: nullable('string'),
  barter_claimed_value: nullable('number'),
  revisions_included: nullable('integer'),
  usage_rights_days: nullable('integer'),
  usage_paid_ads: nullable('boolean'),
  usage_whitelisting: nullable('boolean'),
  usage_perpetual: nullable('boolean'),
  exclusivity_required: nullable('boolean'),
  exclusivity_days: nullable('integer'),
  exclusivity_scope: nullable('string'),
  payment_net_days: nullable('integer'),
  advance_percent: nullable('number'),
  content_due_date: nullable('string'),
  publish_date: nullable('string'),
  kill_fee_percent: nullable('number'),
  other_conditions: strArr,
  final_offer: { type: 'boolean' },
  missing_terms: strArr,
  ambiguities: strArr,
  summary: str,
});
const nnum = z.number().nullable();
const nint = z.number().int().nullable();
export const extractZod = z.object({
  payment_type: z.enum(['paid', 'barter', 'hybrid']).nullable(),
  total_amount: nnum.refine((v) => v === null || v >= 0, 'negative amount'),
  currency: z.string().max(3).nullable(),
  deliverables: z.array(z.object({ type: z.enum(DELIV), quantity: z.number().int().min(1).max(100), description: z.string().max(300).nullable(), unit_price: z.number().min(0).nullable().optional() })).max(20),
  barter_product: z.string().max(300).nullable(),
  barter_claimed_value: nnum,
  revisions_included: nint,
  usage_rights_days: nint,
  usage_paid_ads: z.boolean().nullable(),
  usage_whitelisting: z.boolean().nullable(),
  usage_perpetual: z.boolean().nullable(),
  exclusivity_required: z.boolean().nullable(),
  exclusivity_days: nint,
  exclusivity_scope: z.string().max(300).nullable(),
  payment_net_days: nint,
  advance_percent: nnum,
  content_due_date: z.string().max(40).nullable(),
  publish_date: z.string().max(40).nullable(),
  kill_fee_percent: nnum,
  other_conditions: z.array(z.string().max(300)).max(20),
  final_offer: z.boolean().optional().default(false),
  missing_terms: z.array(z.string().max(100)).max(20),
  ambiguities: z.array(z.string().max(300)).max(20),
  summary: z.string().max(800),
});

export const BRAND_SIGNAL_KINDS = ['product_launch', 'funding_round', 'regional_expansion', 'marketing_campaign', 'brand_ambassador', 'creator_campaign', 'other'];
export const brandSignalsJsonSchema = obj({
  brands: {
    type: 'array',
    items: obj({
      name: str,
      website: nullable('string'),
      is_consumer_brand: { type: 'boolean' },
      signal_kind: { type: 'string', enum: BRAND_SIGNAL_KINDS },
      product_or_campaign: nullable('string'),
      evidence_quote: str,
      summary: str,
    }),
  },
});
export const brandSignalsZod = z.object({
  brands: z
    .array(
      z.object({
        name: z.string().min(2).max(80),
        website: z.string().max(200).nullable(),
        is_consumer_brand: z.boolean(),
        signal_kind: z.enum(BRAND_SIGNAL_KINDS),
        product_or_campaign: z.string().max(150).nullable(),
        evidence_quote: z.string().min(10).max(400),
        summary: z.string().max(300),
      }),
    )
    .max(8),
});

export const draftJsonSchema = obj({ subject: str, body: str });
export const draftZod = z.object({ subject: z.string().min(1).max(200), body: z.string().min(20).max(6000) });
