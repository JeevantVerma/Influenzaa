import { Badge, DemoBadge } from './ui.jsx';
import { date, humanize } from '../lib/format.js';

const VERIFICATION = {
  verified: { tone: 'success', label: 'Verified source', help: 'From an official brand source' },
  partially_verified: { tone: 'info', label: 'Partly verified', help: 'Some evidence from official sources' },
  unverified: { tone: 'warning', label: 'Unverified', help: 'Secondary source; verify before relying on it' },
  inferred: { tone: 'warning', label: 'Inferred', help: 'Derived by rules or AI, not stated by the brand' },
  demo: { tone: 'demo', label: 'Demo data', help: 'Fictional demo dataset' },
  stale: { tone: 'danger', label: 'Stale', help: 'Evidence is old' },
};

export function VerificationBadge({ status }) {
  const v = VERIFICATION[status] || VERIFICATION.unverified;
  return <Badge tone={v.tone} title={v.help}>{v.label}</Badge>;
}

export function SignalBadge({ type }) {
  const tone = type === 'high_intent' ? 'success' : type === 'medium_intent' ? 'info' : '';
  return <Badge tone={tone}>{humanize(type)}</Badge>;
}

export function ContactIndicator({ contact }) {
  if (!contact) return <Badge>No contact</Badge>;
  if (contact.doNotContact) return <Badge tone="danger">Do not contact</Badge>;
  const tone = contact.verificationStatus === 'verified' ? 'success' : contact.verificationStatus === 'demo' ? 'demo' : contact.confidence >= 0.7 ? 'info' : 'warning';
  return (
    <Badge tone={tone} title={`Source: ${contact.source}`}>
      {contact.verificationStatus === 'demo' ? 'Demo contact' : humanize(contact.verificationStatus)} · {Math.round((contact.confidence || 0) * 100)}%
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
            <Badge tone={e.kind === 'hypothesis' ? 'ai' : ''}>{e.kind === 'hypothesis' ? 'Hypothesis' : 'Fact from source'}</Badge>
            <span className="tiny faint">via {e.source}</span>
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

export function ScoreFactors({ factors = [] }) {
  const pos = factors.filter((f) => f.impact > 0).slice(0, 4);
  const neg = factors.filter((f) => f.impact < 0).slice(0, 4);
  const Row = ({ f }) => (
    <div className="factor">
      <span className={`impact ${f.impact > 0 ? 'pos' : 'neg'}`}>{f.impact > 0 ? '+' : ''}{f.impact}</span>
      <span><span className="strong">{f.label}</span> <span className="muted small">— {f.detail}</span></span>
    </div>
  );
  return (
    <div className="grid cols-2">
      <div>
        <div className="section-title" style={{ marginBottom: 6 }}>Strongest positives</div>
        {pos.length ? pos.map((f) => <Row key={f.key} f={f} />) : <p className="small muted">None</p>}
      </div>
      <div>
        <div className="section-title" style={{ marginBottom: 6 }}>Strongest negatives</div>
        {neg.length ? neg.map((f) => <Row key={f.key} f={f} />) : <p className="small muted">None</p>}
      </div>
    </div>
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
