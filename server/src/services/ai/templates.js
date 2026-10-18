import { formatMoney } from '../../lib/money.js';
import { DELIVERABLE_LABELS } from '../../models/shared.js';

// Deterministic message templates. Used when no AI provider is available or
// when an AI draft fails validation, so core workflows never depend on a model.

export function describeDeliverables(deliverables = []) {
  if (!deliverables.length) return 'the deliverables we discussed';
  return deliverables
    .map((d) => `${d.quantity || 1} × ${DELIVERABLE_LABELS[d.type] || d.description || d.type}`)
    .join(', ');
}

const PLATFORM_NAMES = { instagram: 'Instagram', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X', facebook: 'Facebook', snapchat: 'Snapchat', moj: 'Moj', josh: 'Josh', sharechat: 'ShareChat', podcast: 'podcasts', blog: 'my blog' };
const listText = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export function pitchTemplate({ creator, brand, opportunity }) {
  const niches = listText((creator.niches || []).slice(0, 3)) || 'lifestyle';
  const platforms = [...new Set((creator.platformProfiles || []).map((p) => PLATFORM_NAMES[p.platform] || p.platform).filter(Boolean))];
  const where = platforms.length ? ` on ${listText(platforms)}` : '';
  const possessive = /s$/i.test(brand.name) ? `${brand.name}'` : `${brand.name}'s`;
  const hook = opportunity.productOrCampaign
    ? `I came across ${possessive} ${opportunity.productOrCampaign} and it fits naturally with what my audience comes to me for.`
    : `I've been following ${brand.name} and the brand fits naturally with what my audience comes to me for.`;
  return {
    subject: `Collaboration idea: ${creator.publicName || 'Creator'} × ${brand.name}`,
    body: `Hi ${brand.name} team,\n\nI'm ${creator.publicName || 'a creator'}, and I create ${niches} content${where}. ${hook}\n\nIf you're planning creator collaborations, I'd love to share my media kit and a couple of concept ideas tailored to your goals. Would you be open to a quick conversation?\n\nWarm regards,`,
  };
}

function termsLines(terms, currency) {
  const lines = [];
  if (terms.totalAmountMinor != null) lines.push(`Fee: ${formatMoney(terms.totalAmountMinor, currency)}`);
  if (terms.deliverables?.length) lines.push(`Deliverables: ${describeDeliverables(terms.deliverables)}`);
  if (terms.revisionsIncluded != null) lines.push(`Revisions: up to ${terms.revisionsIncluded} round(s)`);
  if (terms.usageRights?.perpetual === false || terms.usageRights?.durationDays != null) {
    lines.push(`Usage rights: organic use for ${terms.usageRights.durationDays ?? 0} days${terms.usageRights.paidAds ? ', including paid ads' : ', no paid ads or whitelisting'}`);
  }
  if (terms.exclusivity?.required === false) lines.push('Exclusivity: none');
  else if (terms.exclusivity?.required) lines.push(`Exclusivity: ${terms.exclusivity.durationDays} days${terms.exclusivity.scope ? ` (${terms.exclusivity.scope})` : ''}`);
  if (terms.paymentTerms?.netDays != null) {
    lines.push(`Payment: ${terms.paymentTerms.advancePercent ? `${terms.paymentTerms.advancePercent}% advance, balance ` : ''}within ${terms.paymentTerms.netDays} days of invoice`);
  }
  return lines;
}

export function negotiationTemplate({ kind, creator, brand, terms, currency = 'INR', questions = [], reasons = [] }) {
  const name = creator.publicName || 'the creator';
  const subject = `Re: ${creator.publicName || 'Creator'} × ${brand.name}`;
  const block = terms ? termsLines(terms, currency).map((l) => `• ${l}`).join('\n') : '';
  switch (kind) {
    case 'counteroffer':
      return {
        subject,
        body: `Hi ${brand.name} team,\n\nThank you for the offer — I'm genuinely excited about working together. Based on the scope and what it involves on my side, here is what I can propose:\n\n${block}\n\n${reasons.length ? `${reasons.join(' ')}\n\n` : ''}Happy to talk through the details if anything here needs adjusting.\n\nBest,`,
      };
    case 'acceptance':
      return {
        subject,
        body: `Hi ${brand.name} team,\n\nThank you — I'm happy to go ahead on the following terms, subject to a written agreement:\n\n${block}\n\nPlease share the agreement or purchase order and the campaign brief, and I'll get started on concepts.\n\nBest,`,
      };
    case 'decline':
      return {
        subject,
        body: `Hi ${brand.name} team,\n\nThank you for thinking of me for this. After reviewing the details, I won't be able to take this one on as proposed. I'd be glad to stay in touch for future campaigns that are a better fit.\n\nBest wishes,`,
      };
    case 'clarification':
      return {
        subject,
        body: `Hi ${brand.name} team,\n\nThanks for the details! Before I can confirm, could you help me with a few points?\n\n${(questions.length ? questions : ['Could you share the complete scope and timeline?']).map((q) => `• ${q}`).join('\n')}\n\nLooking forward to it.\n\nBest,`,
      };
    case 'follow_up':
      return {
        subject,
        body: `Hi ${brand.name} team,\n\nJust following up on my earlier note about a possible collaboration with ${name}. I'd be happy to share my media kit and a few concept ideas whenever convenient.\n\nBest,`,
      };
    case 'info_reply':
      return {
        subject,
        body: `Hi ${brand.name} team,\n\nThanks for getting back to me! I'd be happy to share more. Could you tell me a little about the campaign — the deliverables you have in mind, timelines, and usage needs? That will help me put together a proposal that fits.\n\nBest,`,
      };
    default:
      return { subject, body: `Hi ${brand.name} team,\n\nThank you for your message. I'll get back to you shortly.\n\nBest,` };
  }
}
