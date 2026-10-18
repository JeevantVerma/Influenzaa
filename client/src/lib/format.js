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
  draft: { label: 'Draft — not sent', tone: 'ai' },
  queued: { label: 'Approved · queued', tone: 'info' },
  sending: { label: 'Sending…', tone: 'info' },
  sent: { label: 'Sent', tone: 'success' },
  simulated: { label: 'Simulated (demo) — not delivered', tone: 'demo' },
  failed: { label: 'Failed — not sent', tone: 'danger' },
  cancelled: { label: 'Cancelled — not sent', tone: '' },
  received: { label: 'Received', tone: 'primary' },
  logged: { label: 'Manual note', tone: '' },
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
