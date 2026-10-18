import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import { ApprovalCard } from '../components/Negotiation.jsx';
import { EmptyState, ErrorState, LoadingCard, Tabs } from '../components/ui.jsx';

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
    <div className="stack lg">
      <div className="page-header">
        <div>
          <h1>Approval center</h1>
          <p>Every commercial, contractual and sensitive action waits here for you. Nothing pending has been sent. Silence or opening a notification is never treated as approval.</p>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        tabs={[
          { value: 'pending', label: 'Pending', count: pendingCount.data?.total },
          { value: 'history', label: 'History' },
        ]}
      />
      {q.isLoading ? (
        <LoadingCard lines={6} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data.items.length ? (
        <div className="card">
          <EmptyState title={tab === 'pending' ? 'No approvals waiting' : 'No approval history yet'} icon="shield">
            {tab === 'pending' ? 'When the AI drafts a pitch, counteroffer or reply that needs your sign-off, it appears here with the exact message and the policy checks behind it.' : ''}
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
  );
}
