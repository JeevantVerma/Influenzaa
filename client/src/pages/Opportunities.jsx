import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, useAction } from '../api/hooks.js';
import { post } from '../api/client.js';
import { DiscoveryControl } from '../components/DiscoveryControl.jsx';
import { Badge, Button, EmptyState, ErrorState, LoadingCard, ScoreBadge, Tabs, DemoBadge } from '../components/ui.jsx';
import { SignalBadge, VerificationBadge } from '../components/OpportunityParts.jsx';
import { relative, humanize } from '../lib/format.js';

const STATUS_TABS = [
  { value: 'active', label: 'Active' },
  { value: 'new', label: 'New' },
  { value: 'saved', label: 'Saved' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'excluded', label: 'Excluded by policy' },
  { value: 'all', label: 'All' },
];

function OpportunityCard({ o }) {
  const save = useAction(() => post(`/opportunities/${o._id}/save`), { invalidate: ['opportunities', 'dashboard'], success: 'Saved' });
  const dismiss = useAction(() => post(`/opportunities/${o._id}/dismiss`), { invalidate: ['opportunities', 'dashboard'], success: 'Dismissed' });
  const restore = useAction(() => post(`/opportunities/${o._id}/restore`), { invalidate: ['opportunities'], success: 'Restored' });
  const top = (o.scoreFactors || []).filter((f) => f.impact > 0).slice(0, 2);
  const neg = (o.scoreFactors || []).filter((f) => f.impact < 0).slice(0, 1);
  return (
    <article className="card">
      <div className="card-body stack sm">
        <div className="row top">
          <ScoreBadge score={o.excluded ? 0 : o.overallScore} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row wrap">
              <Link to={`/opportunities/${o._id}`} className="strong" style={{ color: 'var(--text)', fontSize: 15 }}>{o.brand?.name}</Link>
              <DemoBadge show={o.isDemo && o.verificationStatus !== 'demo'} />
              <SignalBadge type={o.signalType} />
              <VerificationBadge status={o.evidenceStale ? 'stale' : o.verificationStatus} />
              {o.status !== 'new' && <Badge>{humanize(o.status)}</Badge>}
            </div>
            <div className="small muted">{o.brand?.industry} · found {relative(o.firstDiscoveredAt)}</div>
          </div>
        </div>
        <p>{o.signalSummary}</p>
        {o.excluded ? (
          <div className="callout danger small">Excluded: {o.exclusionReason}</div>
        ) : (
          <div className="small">
            {top.map((f) => <div key={f.key} style={{ color: 'var(--success)' }}>+ {f.label}</div>)}
            {neg.map((f) => <div key={f.key} style={{ color: 'var(--danger)' }}>− {f.label}</div>)}
          </div>
        )}
      </div>
      <div className="card-footer row between wrap">
        <span className="small muted">{o.contactConfidence > 0 ? `Contact confidence ${Math.round(o.contactConfidence * 100)}%` : 'No contact yet'}</span>
        <div className="btn-group">
          {o.status === 'dismissed' ? (
            <Button size="sm" onClick={() => restore.mutate()} loading={restore.isPending}>Restore</Button>
          ) : (
            <>
              {!o.excluded && o.status === 'new' && <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Save</Button>}
              {!['contacted', 'in_negotiation', 'won'].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} loading={dismiss.isPending}>Dismiss</Button>}
            </>
          )}
          <Link className="btn sm primary" to={`/opportunities/${o._id}`}>{o.excluded ? 'Details' : 'Review & pitch'}</Link>
        </div>
      </div>
    </article>
  );
}

export default function OpportunitiesPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'active';
  const [search, setSearch] = useState(params.get('q') || '');
  const signal = params.get('signal') || '';
  const sort = params.get('sort') || 'score';
  const page = Number(params.get('page') || 1);
  const qs = new URLSearchParams({ status, sort, page: String(page), limit: '20', ...(signal ? { signal } : {}), ...(params.get('q') ? { q: params.get('q') } : {}) });
  const q = useApi(['opportunities', qs.toString()], `/opportunities?${qs}`, { placeholderData: (prev) => prev });
  const update = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <div className="stack lg">
      <div className="page-header">
        <div>
          <h1>Sponsor discovery</h1>
          <p>Brands with evidence-backed reasons to collaborate now, ranked against your preferences. Scores prioritise; they don't predict deals.</p>
        </div>
      </div>
      <DiscoveryControl />
      <Tabs tabs={STATUS_TABS} value={status} onChange={(v) => update('status', v)} />
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); update('q', search.trim()); }} role="search">
        <label className="sr-only" htmlFor="opp-search">Search brands</label>
        <input id="opp-search" className="input" style={{ maxWidth: 280 }} placeholder="Search brand or product" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="sr-only" htmlFor="opp-signal">Signal</label>
        <select id="opp-signal" className="select" style={{ maxWidth: 180 }} value={signal} onChange={(e) => update('signal', e.target.value)}>
          <option value="">All signals</option>
          <option value="high_intent">High intent</option>
          <option value="medium_intent">Medium intent</option>
          <option value="low_intent">Low intent</option>
        </select>
        <label className="sr-only" htmlFor="opp-sort">Sort</label>
        <select id="opp-sort" className="select" style={{ maxWidth: 180 }} value={sort} onChange={(e) => update('sort', e.target.value)}>
          <option value="score">Best match</option>
          <option value="recent">Recently found</option>
          <option value="timing">Best timing</option>
        </select>
        <Button type="submit">Search</Button>
      </form>
      {q.isLoading ? (
        <div className="grid cols-2"><LoadingCard /><LoadingCard /></div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data.items.length ? (
        <div className="card"><EmptyState title={status === 'excluded' ? 'Nothing excluded' : 'No opportunities here yet'} icon="search">{status === 'active' ? 'Start discovery or press “Run now”. New findings appear here and on your dashboard.' : 'Try another filter.'}</EmptyState></div>
      ) : (
        <>
          <div className="grid cols-2">{q.data.items.map((o) => <OpportunityCard key={o._id} o={o} />)}</div>
          {q.data.total > q.data.limit && (
            <div className="row" style={{ justifyContent: 'center' }}>
              <Button size="sm" disabled={page <= 1} onClick={() => update('page', String(page - 1))}>Previous</Button>
              <span className="small muted">Page {page} of {Math.ceil(q.data.total / q.data.limit)}</span>
              <Button size="sm" disabled={page * q.data.limit >= q.data.total} onClick={() => update('page', String(page + 1))}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
