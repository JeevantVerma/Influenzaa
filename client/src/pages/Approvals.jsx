import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import { ApprovalCard } from '../components/Negotiation.jsx';
import { EmptyState, ErrorState, LoadingCard, PageHead, Tabs } from '../components/ui.jsx';

export default function ApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'pending';
  const focus = params.get('focus');
  const q = useApi(['approvals', tab], `/approvals?status=${tab}&limit=50`, { refetchInterval: 20_000 });
  const pendingCount = useApi(['approvals', 'pending', 'count'], '/approvals?status=pending&limit=1');

  useEffect(() => {
    if (focus && q.data) document.getElementById(`approval-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus, q.data]);

  return (
    <div className="page-stack">
      <PageHead title="Approvals" subtitle="Nothing is sent until you approve it here. Ignoring a request never counts as a yes." />
      <div>
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        tabs={[
          { value: 'pending', label: 'Waiting for you', count: pendingCount.data?.total },
          { value: 'history', label: 'History' },
        ]}
      />
      {q.isLoading ? (
        <LoadingCard lines={6} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data.items.length ? (
        <div className="card">
          <EmptyState title={tab === 'pending' ? "You're all caught up" : 'Nothing here yet'} icon="shield">
            {tab === 'pending' ? 'When a pitch, counteroffer or reply needs your OK, it shows up here with the exact email.' : ''}
          </EmptyState>
        </div>
      ) : (
        <div className="stack lg">
          {q.data.items.map((a) => (
            <ApprovalCard key={`${a._id}:${a.actionHash}`} approval={a} defaultOpen={tab === 'pending' || a._id === focus} />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
