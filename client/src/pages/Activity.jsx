import { useState } from 'react';
import { useApi } from '../api/hooks.js';
import { Badge, Button, EmptyState, ErrorState, LoadingCard } from '../components/ui.jsx';
import { dateTime, humanize } from '../lib/format.js';

const TYPES = ['', 'approval', 'deal', 'message', 'discovery', 'discovery_run', 'opportunity', 'campaign', 'invoice', 'integration', 'user'];

export default function ActivityPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const q = useApi(['audit', page, type], `/audit?page=${page}&limit=50${type ? `&resourceType=${type}` : ''}`, { placeholderData: (p) => p });
  return (
    <div className="stack lg">
      <div className="page-header">
        <div>
          <h1>Activity & audit history</h1>
          <p>Every approval, AI action, send, and status change — who did it and when. Sensitive values are redacted.</p>
        </div>
        <div>
          <label className="sr-only" htmlFor="type">Filter</label>
          <select id="type" className="select" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            {TYPES.map((t) => <option key={t} value={t}>{t ? humanize(t) : 'All resources'}</option>)}
          </select>
        </div>
      </div>
      {q.isLoading ? (
        <LoadingCard />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data.items.length ? (
        <div className="card"><EmptyState title="No activity recorded" icon="activity" /></div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Actor</th><th>Event</th><th>Details</th></tr></thead>
            <tbody>
              {q.data.items.map((e) => (
                <tr key={e._id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{dateTime(e.timestamp)}</td>
                  <td><Badge tone={e.actorType === 'ai' ? 'ai' : e.actorType === 'creator' ? 'primary' : e.actorType === 'brand' ? 'info' : ''}>{e.actorType}</Badge></td>
                  <td className="small strong">{e.eventType}</td>
                  <td className="tiny mono muted" style={{ maxWidth: 420, wordBreak: 'break-word' }}>{e.redactedMetadata ? JSON.stringify(e.redactedMetadata) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ justifyContent: 'center', padding: 12 }}>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
            <span className="small muted">Page {page}</span>
            <Button size="sm" disabled={page * 50 >= q.data.total} onClick={() => setPage(page + 1)}>Older</Button>
          </div>
        </div>
      )}
    </div>
  );
}
