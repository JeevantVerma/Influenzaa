import { unexpectedAmounts } from '../../lib/amounts.js';

// Server-side approval rules. These decide whether an action may run without
// an explicit creator approval. When in doubt, approval is required.

export const REASON_LABELS = {
  accept_or_reject_offer: 'Accepting or rejecting a sponsorship offer',
  counteroffer_outside_rules: 'Counteroffer outside your authorised pricing rules',
  out_of_scope_deliverables: 'Deliverables outside your approved scope',
  exclusivity: 'Exclusivity commitment',
  content_rights: 'Paid, whitelisting, perpetual or other unapproved content rights',
  unusual_payment_terms: 'Unusual payment, cancellation or penalty terms',
  contract: 'Contract or agreement',
  sensitive_representation: 'Legal, tax, medical, financial or other sensitive representation',
  sensitive_message: 'Sensitive or reputationally significant message',
  barter_outside_policy: 'Barter offer outside your approved policy',
  autonomy_level: 'Your autonomy level requires approval for this action',
  creator_configured: 'You require approval for this category',
  unknown_action: 'Unrecognised action — approval required by default',
};

const SENSITIVE = /\b(guarantee[ds]?|contract|legal(ly)?|lawyer|liabilit|indemn|tax|gst|tds|invoice dispute|medical|cure[sd]?|clinically|doctor|investment returns?|refund|penalt|lawsuit|sue|court)\b/i;

export function isSensitiveText(text) {
  return SENSITIVE.test(String(text || ''));
}

const reason = (code) => ({ code, label: REASON_LABELS[code] || code });

/**
 * @param {object} p
 * @param {string} p.actionType  send_pitch | send_follow_up | send_counteroffer | send_reply | accept_offer | decline_offer | send_payment_reminder
 * @param {object} p.profile     creator profile
 * @param {string} [p.content]   message body
 * @param {string[]} [p.policyCategories] categories raised by offer evaluation
 * @param {{ok:boolean,reasons:string[]}} [p.counterRule] result of counterWithinAuthorizedRules
 * @param {boolean} [p.humanTakeover]
 * @returns {{ required: boolean, reasons: {code,label}[], requiresExplicitConfirmation: boolean, autoRule?: string }}
 */
export function approvalRequirement({ actionType, profile, content = '', policyCategories = [], counterRule, humanTakeover = false }) {
  const level = profile.negotiationAutonomy?.level ?? 0;
  const extra = new Set(profile.approvalPolicy?.additionalCategories || []);
  const reasons = [];
  let explicit = false;
  let autoRule;

  const sensitive = isSensitiveText(content);
  if (sensitive) reasons.push(reason('sensitive_message'));
  if (humanTakeover) reasons.push({ code: 'human_takeover', label: 'You have taken over this conversation' });

  switch (actionType) {
    case 'accept_offer':
      reasons.push(reason('accept_or_reject_offer'));
      for (const c of policyCategories) if (c !== 'accept_or_reject_offer') reasons.push(reason(c));
      explicit = true;
      break;
    case 'decline_offer':
      reasons.push(reason('accept_or_reject_offer'));
      break;
    case 'send_counteroffer':
      if (level < 2) reasons.push(reason('autonomy_level'));
      else if (!counterRule?.ok) reasons.push({ code: 'counteroffer_outside_rules', label: `${REASON_LABELS.counteroffer_outside_rules}: ${(counterRule?.reasons || ['not evaluated']).join(', ')}` });
      else autoRule = 'Level 2: counteroffer within your authorised pricing and rights rules';
      if (extra.has('counteroffer_outside_rules')) reasons.push(reason('creator_configured'));
      break;
    case 'send_pitch':
      if (level < 1 || !profile.automation?.autoSendPitches) reasons.push(reason('autonomy_level'));
      else autoRule = 'Level 1+: automatic pitches enabled';
      break;
    case 'send_follow_up':
      if (level < 1 || !profile.automation?.followUps?.autoSend) reasons.push(reason('autonomy_level'));
      else autoRule = 'Level 1+: automatic follow-ups enabled';
      break;
    case 'send_reply':
      // Routine factual replies at Level 2+, but never with money in them.
      if (level < 2) reasons.push(reason('autonomy_level'));
      else if (unexpectedAmounts(content, []).length) reasons.push({ code: 'counteroffer_outside_rules', label: 'Reply mentions an amount' });
      else autoRule = 'Level 2: routine reply with no commercial commitments';
      break;
    case 'send_payment_reminder':
      if (level < 3) reasons.push(reason('autonomy_level'));
      else autoRule = 'Level 3: payment reminders permitted';
      break;
    default:
      reasons.push(reason('unknown_action'));
  }

  for (const c of policyCategories) {
    if (extra.has(c) && !reasons.some((r) => r.code === c)) reasons.push(reason(c));
  }

  const required = reasons.length > 0;
  return { required, reasons, requiresExplicitConfirmation: explicit, autoRule: required ? undefined : autoRule };
}
