import { Badge, DemoBadge } from './ui.jsx';
import { date, EVIDENCE_SOURCES, SIGNAL_LABELS } from '../lib/format.js';

const VERIFICATION = {
  verified: { tone: 'success', label: 'From the brand', help: "From the brand's own website or official channel" },
  partially_verified: { tone: 'info', label: 'Partly from the brand', help: "Some evidence is from the brand's own channels" },
  unverified: { tone: 'warning', label: 'Third-party source', help: 'News, search or social posts; check before relying on it' },
  inferred: { tone: 'warning', label: 'Our inference', help: 'Worked out by rules or AI, not stated by the brand' },
  demo: { tone: 'demo', label: 'Demo data', help: 'Fictional demo dataset' },
  stale: { tone: 'danger', label: 'Old evidence', help: 'The newest evidence is more than 120 days old' },
};

export function VerificationBadge({ status }) {
  const v = VERIFICATION[status] || VERIFICATION.unverified;
  return <Badge tone={v.tone} title={v.help}>{v.label}</Badge>;
}

export function SignalBadge({ type }) {
  const s = SIGNAL_LABELS[type] || SIGNAL_LABELS.low_intent;
  return <Badge tone={s.tone} title={s.help}>{s.label}</Badge>;
}

export function ContactIndicator({ contact }) {
  if (!contact) return <Badge>No contact</Badge>;
  if (contact.doNotContact) return <Badge tone="danger">Do not contact</Badge>;
  const tone = contact.verificationStatus === 'verified' ? 'success' : contact.verificationStatus === 'demo' ? 'demo' : contact.confidence >= 0.7 ? 'info' : 'warning';
  const label = contact.verificationStatus === 'demo' ? 'Demo contact' : contact.verificationStatus === 'verified' ? 'Confirmed' : contact.source === 'public_page' ? 'On their website' : contact.source === 'manual' ? 'Added by you' : 'Not confirmed';
  return (
    <Badge tone={tone} title="How sure we are this address reaches the right team">
      {label} · {Math.round((contact.confidence || 0) * 100)}% sure
    </Badge>
  );
}

/** Source evidence with timestamps and fact/hypothesis labelling. */
export function EvidencePanel({ evidence = [], stale }) {
  if (!evidence.length) return <p className="muted small">No evidence recorded.</p>;
  return (
    <div className="stack">
      {stale && <div className="callout warning small">The newest evidence is more than 120 days old. Re-check before reaching out.</div>}
      {evidence.map((e, i) => (
        <div key={i} className="card flat card-body stack sm" style={{ padding: 14 }}>
          <div className="row wrap">
            <VerificationBadge status={e.verification} />
            <Badge tone={e.kind === 'hypothesis' ? 'ai' : ''}>{e.kind === 'hypothesis' ? 'Our guess' : 'Stated in the source'}</Badge>
            <span className="tiny faint">
              via {EVIDENCE_SOURCES[e.source] || e.source}
              {/* GDELT's licence asks for a citation and link to the project. */}
              {e.source === 'gdelt' && <> · found with the <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer">GDELT Project</a></>}
            </span>
          </div>
          <div className="strong">{e.title}</div>
          {e.excerpt && <blockquote className="small muted" style={{ margin: 0, borderLeft: '3px solid var(--border-strong)', paddingLeft: 10 }}>{e.excerpt}</blockquote>}
          <div className="row wrap tiny faint">
            <span>Published {e.publishedAt ? date(e.publishedAt) : 'date unknown'}</span>
            <span>· Retrieved {date(e.retrievedAt)}</span>
            {e.url && (e.verification === 'demo' ? <span className="mono">{e.url}</span> : <a href={e.url} target="_blank" rel="noopener noreferrer nofollow">Open source ↗</a>)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Why a brand fits (or doesn't), in plain words. Point values stay in the tooltip. */
export function ScoreFactors({ factors = [] }) {
  const pos = factors.filter((f) => f.impact > 0).slice(0, 4);
  const neg = factors.filter((f) => f.impact < 0).slice(0, 3);
  if (!pos.length && !neg.length) return <p className="small muted">No details yet.</p>;
  return (
    <ul className="reason-list">
      {pos.map((f) => (
        <li key={f.key} title={`+${f.impact} points`}><span className="mark good" aria-hidden="true">✓</span><span><span className="strong">{f.label}</span>{f.detail && <span className="small muted"> — {f.detail}</span>}</span></li>
      ))}
      {neg.map((f) => (
        <li key={f.key} title={`${f.impact} points`}><span className="mark watch" aria-hidden="true">!</span><span><span className="strong">{f.label}</span>{f.detail && <span className="small muted"> — {f.detail}</span>}</span></li>
      ))}
    </ul>
  );
}

export function BrandLine({ brand, isDemo }) {
  return (
    <span className="row wrap">
      <span className="strong">{brand?.name}</span>
      <span className="small faint mono">{brand?.normalizedDomain}</span>
      <DemoBadge show={isDemo || brand?.isDemo} />
    </span>
  );
}
