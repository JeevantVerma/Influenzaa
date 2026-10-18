import { Link } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import { Badge, DemoBadge, EmptyState, ErrorState, LoadingCard } from '../components/ui.jsx';
import { NEGOTIATION_LABELS, negotiationTone, money, relative } from '../lib/format.js';

export default function NegotiationsPage() {
  const q = useApi(['negotiation', 'list'], '/negotiations');
  return (
    <div className="stack lg">
      <div className="page-header">
        <div>
          <h1>Negotiations</h1>
          <p>Every deal and where it stands. Open one to see the offer analysis, your boundaries and AI counteroffers.</p>
        </div>
      </div>
      {q.isLoading ? (
        <LoadingCard />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data.items.length ? (
        <div className="card"><EmptyState title="No deals yet" icon="scale" action={<Link className="btn primary" to="/opportunities">Find sponsors</Link>}>Deals are created when you start outreach from an opportunity.</EmptyState></div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr><th>Brand</th><th>State</th><th className="num">Current offer</th><th className="num">Accepted</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {q.data.items.map((d) => (
                <tr key={d._id}>
                  <td><Link to={`/negotiations/${d._id}`} className="strong">{d.brand?.name}</Link> <DemoBadge show={d.isDemo} label="Demo" /></td>
                  <td><Badge tone={negotiationTone(d.negotiationState)}>{NEGOTIATION_LABELS[d.negotiationState]}</Badge> {d.approvalState === 'pending' && <Badge tone="warning">Approval pending</Badge>}</td>
                  <td className="num">{d.currentOffer ? money(d.currentOffer.totalAmountMinor, d.currency) : '—'}</td>
                  <td className="num">{d.acceptedTerms ? money(d.acceptedTerms.totalAmountMinor, d.currency) : '—'}</td>
                  <td className="small muted">{relative(d.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
