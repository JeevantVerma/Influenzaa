import { Link } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import { Badge, DemoBadge, EmptyState, ErrorState, LoadingCard } from '../components/ui.jsx';
import { money, humanize, date } from '../lib/format.js';

export const STAGES = [
  'terms_agreed', 'agreement_pending', 'agreement_confirmed', 'brief_pending', 'product_or_assets_pending', 'content_in_production', 'draft_submitted',
  'revision_requested', 'approved_for_publication', 'published', 'invoice_issued', 'payment_pending', 'payment_received', 'completed',
];

export const PAYMENT_TONE = { not_invoiced: '', invoiced: 'info', payment_pending: 'info', partially_paid: 'warning', paid: 'success', overdue: 'danger' };

export default function CampaignsPage() {
  const q = useApi(['campaigns', 'list'], '/campaigns');
  return (
    <div className="stack lg">
      <div className="page-header">
        <div>
          <h1>Campaign manager</h1>
          <p>Confirmed deals, from brief to payment. CreatorOS tracks invoices and payment status; it never moves or holds money.</p>
        </div>
      </div>
      {q.isLoading ? (
        <LoadingCard />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data.items.length ? (
        <div className="card"><EmptyState title="No campaigns yet" icon="briefcase" action={<Link className="btn" to="/negotiations">Go to negotiations</Link>}>Confirm a deal's written agreement in the negotiation workspace, then create its campaign.</EmptyState></div>
      ) : (
        <div className="stack">
          {q.data.items.map((c) => {
            const stageIdx = STAGES.indexOf(c.status);
            const next = c.deliverables.filter((d) => d.status !== 'published' && d.dueAt).sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))[0];
            return (
              <Link key={c._id} to={`/campaigns/${c._id}`} className="card card-body stack sm" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="row wrap">
                  <h3 className="grow">{c.title}</h3>
                  <DemoBadge show={c.isDemo} label="Demo" />
                  <Badge tone="primary">{humanize(c.status)}</Badge>
                  <Badge tone={PAYMENT_TONE[c.paymentStatus]}>Payment: {humanize(c.paymentStatus)}</Badge>
                </div>
                <div className="pipeline" aria-label="Campaign progress">
                  {STAGES.map((s, i) => <div key={s} className={`stage ${i < stageIdx ? 'done' : i === stageIdx ? 'current' : ''}`} title={humanize(s)}>{i === stageIdx ? humanize(s) : ''}</div>)}
                </div>
                <div className="row wrap small muted">
                  <span className="num">{money(c.compensation.amountMinor, c.compensation.currency)}</span>
                  <span>· {c.deliverables.filter((d) => d.status === 'published').length}/{c.deliverables.length} published</span>
                  {next && <span>· next due {date(next.dueAt)}</span>}
                  <span>· {c.invoices.length} invoice(s)</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
