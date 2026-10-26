// Plain-English sentences for audit events shown to creators. Internal events
// (logins, config saves, system bookkeeping) are hidden from the dashboard;
// the full audit trail stays on the Activity page.

const SENTENCES = {
  'outreach.initiated': 'You started outreach to a brand',
  'pitch.drafted': 'A pitch was drafted for you',
  'approval.requested': 'A draft is waiting for your approval',
  'approval.approved': 'You approved a message',
  'approval.rejected': 'You turned down a draft',
  'approval.edited': 'You edited a draft',
  'approval.revoked': 'You stopped a message before it went out',
  'approval.expired': 'A draft expired before you reviewed it',
  'approval.auto_authorized': 'A message went out under your automation rules',
  'action.execution_failed': 'An approved action could not be completed',
  'message.send_failed': 'A message could not be sent',
  'message.sent': 'A message was sent',
  'message.simulated': 'A message was recorded (demo, not delivered)',
  'inbound.received': 'A brand replied',
  'inbound.simulated': 'A simulated brand reply arrived (demo)',
  'inbound.needs_review': 'A brand reply needs your review',
  'offer.analyzed': 'An offer was checked against your rates',
  'offer.manual_entry': 'You entered an offer',
  'counteroffer.generated': 'A counteroffer was drafted for you',
  'deal.confirmed': 'A deal was confirmed',
  'campaign.created': 'A campaign was created',
  'campaign.stage_changed': 'A campaign moved to its next stage',
  'invoice.created': 'An invoice was created',
  'followup.cancelled': 'A follow-up was cancelled',
  'contact.added': 'You added a brand contact',
  'contact.bounced': "A brand's email address bounced",
  'brand.contacts_requested': "You asked for a brand's contacts",
  'discovery.started': 'You turned on sponsor discovery',
  'discovery.paused': 'You paused sponsor discovery',
  'discovery.resumed': 'You resumed sponsor discovery',
  'discovery.stopped': 'You turned off sponsor discovery',
  'discovery.run_finished': 'Sponsor discovery finished a search',
  'settings.autonomy_changed': 'You changed what CreatorOS may do on its own',
};

/** A sentence for a creator-facing event, or null if the event is internal. */
export function activitySentence(event) {
  return SENTENCES[event?.eventType] || null;
}

/** Only meaningful events, newest first, at most `limit`. */
export function meaningfulActivity(events = [], limit = 5) {
  return events.filter((e) => activitySentence(e)).slice(0, limit);
}
