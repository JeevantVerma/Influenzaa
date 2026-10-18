import { conflict } from '../../lib/errors.js';

export const TRANSITIONS = {
  initial_outreach: ['awaiting_reply', 'positive_response', 'information_requested', 'offer_received', 'declined', 'closed'],
  awaiting_reply: ['positive_response', 'information_requested', 'offer_received', 'declined', 'no_response', 'closed', 'awaiting_creator_decision'],
  positive_response: ['information_requested', 'offer_received', 'awaiting_reply', 'terms_under_negotiation', 'awaiting_creator_decision', 'declined', 'closed'],
  information_requested: ['awaiting_reply', 'offer_received', 'positive_response', 'awaiting_creator_decision', 'declined', 'closed'],
  offer_received: ['offer_under_analysis', 'declined', 'closed'],
  offer_under_analysis: ['counteroffer_requires_approval', 'awaiting_creator_decision', 'information_requested', 'declined', 'closed'],
  counteroffer_requires_approval: ['counteroffer_sent', 'awaiting_creator_decision', 'offer_received', 'declined', 'closed'],
  counteroffer_sent: ['terms_under_negotiation', 'offer_received', 'positive_response', 'information_requested', 'awaiting_creator_decision', 'declined', 'no_response', 'closed'],
  terms_under_negotiation: ['offer_received', 'counteroffer_requires_approval', 'awaiting_creator_decision', 'terms_agreed_subject_to_formalization', 'information_requested', 'declined', 'closed'],
  awaiting_creator_decision: ['counteroffer_requires_approval', 'terms_agreed_subject_to_formalization', 'information_requested', 'awaiting_reply', 'offer_received', 'declined', 'closed'],
  terms_agreed_subject_to_formalization: ['agreement_pending', 'deal_confirmed', 'terms_under_negotiation', 'offer_received', 'closed'],
  agreement_pending: ['deal_confirmed', 'terms_under_negotiation', 'offer_received', 'closed'],
  deal_confirmed: ['closed'],
  declined: ['offer_received', 'closed'],
  no_response: ['positive_response', 'information_requested', 'offer_received', 'awaiting_reply', 'declined', 'closed'],
  closed: [],
};

export function canTransition(from, to) {
  return from === to || (TRANSITIONS[from] || []).includes(to);
}

/** Applies a validated state transition to a deal document (caller saves). */
export function transition(deal, to, { actorType = 'system', reason } = {}) {
  const from = deal.negotiationState;
  if (from === to) return deal;
  if (!canTransition(from, to)) {
    throw conflict(`Invalid negotiation transition from ${from} to ${to}`, { from, to });
  }
  deal.negotiationState = to;
  deal.stateHistory.push({ from, to, at: new Date(), actorType, reason });
  if (to === 'deal_confirmed') deal.status = 'won';
  if (to === 'declined') deal.status = 'lost';
  if (to === 'closed' && deal.status === 'open') deal.status = 'closed';
  if (to === 'offer_received' && deal.status === 'lost') deal.status = 'open';
  return deal;
}

/** Transition if allowed; otherwise leave the state unchanged. Returns true if moved. */
export function tryTransition(deal, to, opts) {
  if (!canTransition(deal.negotiationState, to)) return false;
  transition(deal, to, opts);
  return true;
}
