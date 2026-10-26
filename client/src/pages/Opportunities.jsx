import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, useAction } from '../api/hooks.js';
import { post } from '../api/client.js';
import { DiscoveryControl } from '../components/DiscoveryControl.jsx';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingCard, PageHead, ScoreBadge, Tabs, DemoBadge } from '../components/ui.jsx';
import { SignalBadge } from '../components/OpportunityParts.jsx';
import { relative, humanize } from '../lib/format.js';

const STATUS_TABS = [
  { value: 'active', label: 'All active' },
  { value: 'new', label: 'New' },
  { value: 'saved', label: 'Saved' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'excluded', label: 'Not for you' },
  { value: 'all', label: 'Everything' },
];

function OpportunityCard({ o }) {
  const save = useAction(() => post(`/opportunities/${o._id}/save`), { invalidate: ['opportunities', 'dashboard'], success: 'Saved' });
  const dismiss = useAction(() => post(`/opportunities/${o._id}/dismiss`), { invalidate: ['opportunities', 'dashboard'], success: 'Dismissed' });
  const restore = useAction(() => post(`/opportunities/${o._id}/restore`), { invalidate: ['opportunities'], success: 'Restored' });
  const top = (o.scoreFactors || []).filter((f) => f.impact > 0).slice(0, 2);
  const neg = (o.scoreFactors || []).filter((f) => f.impact < 0).slice(0, 1);
  return (
    <article className="opp-card">
      <Link to={`/opportunities/${o._id}`} className="opp-card-head">
        <ScoreBadge score={o.excluded ? 0 : o.overallScore} />
        <span className="grow">
          <span className="row wrap">
            <span className="opp-name">{o.brand?.name}</span>
            <DemoBadge show={o.isDemo} label="Demo" />
            {!o.excluded && <SignalBadge type={o.signalType} />}
            {!['new', 'dismissed'].includes(o.status) && <Badge tone="primary">{humanize(o.status)}</Badge>}
          </span>
          <span className="small muted">{[o.brand?.industry, `found ${relative(o.firstDiscoveredAt)}`].filter(Boolean).join(' · ')}</span>
        </span>
      </Link>
      <p className="opp-summary">{o.signalSummary}</p>
      {o.excluded ? (
        <div className="callout danger small">Not for you: {o.exclusionReason}</div>
      ) : (top.length > 0 || neg.length > 0) && (
        <ul className="reason-list compact">
          {top.map((f) => <li key={f.key}><span className="mark good" aria-hidden="true">✓</span><span className="small">{f.label}</span></li>)}
          {neg.map((f) => <li key={f.key}><span className="mark watch" aria-hidden="true">!</span><span className="small">{f.label}</span></li>)}
        </ul>
      )}
      <div className="opp-card-foot">
        <span className={`small ${o.contactConfidence > 0 ? 'muted' : 'faint'} row`}><Icon name="mail" size={15} className="" />{o.contactConfidence > 0 ? 'Contact found' : 'No contact yet'}</span>
        <div className="btn-group">
          {o.status === 'dismissed' ? (
            <Button size="sm" onClick={() => restore.mutate()} loading={restore.isPending}>Restore</Button>
          ) : (
            <>
              {!['contacted', 'in_negotiation', 'won'].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => dismiss.mutate()} loading={dismiss.isPending}>Dismiss</Button>}
              {!o.excluded && o.status === 'new' && <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Save</Button>}
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
    <div className="page-stack">
      <PageHead title="Find sponsors" subtitle="Brands with a reason to work with creators right now, best matches first." />
      <DiscoveryControl />
      <div>
      <Tabs tabs={STATUS_TABS} value={status} onChange={(v) => update('status', v)} />
      <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); update('q', search.trim()); }} role="search">
        <label className="sr-only" htmlFor="opp-search">Search brands</label>
        <input id="opp-search" className="input" placeholder="Search a brand or product" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="sr-only" htmlFor="opp-signal">Signal</label>
        <select id="opp-signal" className="select" value={signal} onChange={(e) => update('signal', e.target.value)}>
          <option value="">Any signal</option>
          <option value="high_intent">Strong signal</option>
          <option value="medium_intent">Good timing</option>
          <option value="low_intent">Category fit</option>
        </select>
        <label className="sr-only" htmlFor="opp-sort">Sort</label>
        <select id="opp-sort" className="select" value={sort} onChange={(e) => update('sort', e.target.value)}>
          <option value="score">Best match</option>
          <option value="recent">Recently found</option>
          <option value="timing">Best timing</option>
        </select>
        <Button type="submit">Search</Button>
      </form>
      </div>
      {q.isLoading ? (
        <div className="grid cols-2"><LoadingCard /><LoadingCard /></div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data.items.length ? (
        <div className="card"><EmptyState title={status === 'excluded' ? 'Nothing filtered out' : 'No brands here yet'} icon="search">{status === 'active' ? 'Turn on discovery or press “Search now”. New brands appear here and on your home screen.' : 'Try another filter.'}</EmptyState></div>
      ) : (
        <>
          <div className="opp-grid">{q.data.items.map((o) => <OpportunityCard key={o._id} o={o} />)}</div>
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
