export function money(minor, currency = 'INR') {
  if (minor === null || minor === undefined) return '—';
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}

/** Rupee input (major units, may contain commas) → integer minor units. */
export function toMinor(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
export const toMajor = (m) => (m === null || m === undefined ? '' : String(m / 100));

export function date(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', opts).format(new Date(d));
}
export function dateTime(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d));
}
export function relative(d) {
  if (!d) return '—';
  const diff = new Date(d).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return date(d);
}

export const humanize = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

export const NEGOTIATION_LABELS = {
  initial_outreach: 'Outreach drafted',
  awaiting_reply: 'Awaiting reply',
  positive_response: 'Positive response',
  information_requested: 'Information requested',
  offer_received: 'Offer received',
  offer_under_analysis: 'Analysing offer',
  counteroffer_requires_approval: 'Counter needs approval',
  counteroffer_sent: 'Counteroffer sent',
  terms_under_negotiation: 'Negotiating terms',
  awaiting_creator_decision: 'Your decision',
  terms_agreed_subject_to_formalization: 'Terms agreed (needs agreement)',
  agreement_pending: 'Agreement pending',
  deal_confirmed: 'Deal confirmed',
  declined: 'Declined',
  no_response: 'No response',
  closed: 'Closed',
};

export function negotiationTone(state) {
  if (['awaiting_creator_decision', 'counteroffer_requires_approval', 'offer_received'].includes(state)) return 'warning';
  if (['deal_confirmed', 'terms_agreed_subject_to_formalization', 'agreement_pending'].includes(state)) return 'success';
  if (['declined', 'closed', 'no_response'].includes(state)) return '';
  return 'info';
}

export const DELIVERY_LABELS = {
  draft: { label: 'Draft, not sent yet', tone: 'ai' },
  queued: { label: 'Approved, sending soon', tone: 'info' },
  sending: { label: 'Sending…', tone: 'info' },
  sent: { label: 'Sent', tone: 'success' },
  simulated: { label: 'Demo, not delivered', tone: 'demo' },
  failed: { label: 'Not sent: failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: '' },
  received: { label: 'Received', tone: 'primary' },
  logged: { label: 'Manual note', tone: '' },
  sent_by_creator: { label: 'Sent by you on Instagram', tone: 'success' },
};

export const DELIVERABLES = {
  instagram_reel: 'Instagram Reel',
  instagram_story: 'Instagram Story',
  instagram_post: 'Instagram Post',
  youtube_integration: 'YouTube integration',
  youtube_dedicated: 'YouTube dedicated video',
  youtube_short: 'YouTube Short',
  linkedin_post: 'LinkedIn post',
  x_post: 'X post',
  blog_post: 'Blog post',
  podcast_mention: 'Podcast mention',
  event_appearance: 'Event appearance',
  ugc_video: 'UGC video (no posting)',
  other: 'Other',
};

export function deliverablesText(list = []) {
  if (!list?.length) return '—';
  return list.map((d) => `${d.quantity || 1} × ${DELIVERABLES[d.type] || d.type}`).join(', ');
}

// Where a piece of discovery evidence came from, in plain words.
export const EVIDENCE_SOURCES = {
  demo: 'Demo dataset',
  rss: 'Brand newsroom feed',
  brave: 'Web search (Brave)',
  gdelt: 'News',
  news: 'News',
  serper: 'Web search',
  instagram: 'Instagram (via Apify)',
  instagram_dm: 'Instagram DM',
  whatsapp: 'WhatsApp',
  brand_website: "Brand's own website",
  manual: 'Added manually',
};

// Plain-language labels used across screens (no internal jargon).
export const SIGNAL_LABELS = {
  high_intent: { label: 'Strong signal', tone: 'success', help: 'The brand is actively working with creators or runs a creator programme' },
  medium_intent: { label: 'Good timing', tone: 'info', help: 'A launch, campaign or expansion that often comes with creator work' },
  low_intent: { label: 'Category fit', tone: '', help: 'Fits your niche, but no sign yet that they are hiring creators' },
};

export const CHECK_LABELS = {
  ok: 'Fine',
  warning: 'Worth a look',
  missing: 'Not mentioned',
  requires_approval: 'Needs your OK',
  violation: 'Outside your limits',
};

export const RECOMMENDATION_LABELS = {
  accept: { label: 'Accept it', tone: 'success', verb: 'Accepting looks reasonable' },
  counter: { label: 'Ask for more', tone: 'info', verb: 'We suggest a counteroffer' },
  clarify: { label: 'Ask questions first', tone: 'warning', verb: 'Some terms are unclear' },
  decline: { label: 'Turn it down', tone: 'danger', verb: 'This offer is far from your limits' },
  escalate: { label: 'Your call', tone: 'warning', verb: 'This needs your judgement' },
};

/** "Approve your counteroffer to" + brand name. */
export const APPROVAL_TEXT = {
  send_pitch: 'Approve your pitch to',
  send_follow_up: 'Approve a follow-up to',
  send_counteroffer: 'Approve your counteroffer to',
  send_reply: 'Approve your reply to',
  accept_offer: 'Confirm accepting the offer from',
  decline_offer: 'Confirm declining',
  send_payment_reminder: 'Approve a payment reminder to',
};

export const APPROVAL_STATUS = {
  pending: { label: 'Waiting for you', tone: 'warning' },
  approved: { label: 'Approved, sending', tone: 'info' },
  executed: { label: 'Done', tone: 'success' },
  rejected: { label: 'You turned it down', tone: '' },
  expired: { label: 'Expired', tone: '' },
  superseded: { label: 'Replaced by a newer version', tone: '' },
  revoked: { label: 'Stopped before sending', tone: '' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** Splits an outgoing email into what the creator wrote and the footer CreatorOS adds. */
export const DM_DISCLOSURE = '— sent via CreatorOS (AI-assisted)';

export function splitSignature(content = '') {
  const dm = content.indexOf(`\n\n${DM_DISCLOSURE}`);
  if (dm !== -1) return [content.slice(0, dm), DM_DISCLOSURE];
  const i = content.indexOf('\n\n—\n');
  return i === -1 ? [content, ''] : [content.slice(0, i), content.slice(i + 2)];
}

/** What a brand's reply is, in plain words. */
export const INTENT_LABELS = {
  offer: 'Made an offer',
  acceptance: 'Agreed',
  positive_interest: 'Interested',
  information_request: 'Asking for details',
  decline: 'Not interested',
  opt_out: 'Asked not to be contacted',
  out_of_office: 'Out of office',
  question: 'Has a question',
  other: 'Replied',
};
