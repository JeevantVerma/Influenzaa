import { useState } from 'react';
import { useApi, useAction } from '../api/hooks.js';
import { post, patch } from '../api/client.js';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Skeleton, DemoBadge } from './ui.jsx';
import { dateTime, relative } from '../lib/format.js';

const STATUS = {
  running: { label: 'Running', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  stopped: { label: 'Stopped', tone: '' },
  error: { label: 'Error', tone: 'danger' },
  awaiting_configuration: { label: 'Needs setup', tone: 'warning' },
};

const INTERVALS = [
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Daily' },
  { value: 4320, label: 'Every 3 days' },
  { value: 10080, label: 'Weekly' },
];

/** Discovery status + controls. `compact` is used on the dashboard. */
export function DiscoveryControl({ compact = false }) {
  const q = useApi('discovery', '/discovery/status', { refetchInterval: (query) => (query.state.data?.pendingJobs?.length ? 3000 : 20_000) });
  const [confirmStop, setConfirmStop] = useState(false);
  const opts = (success) => ({ invalidate: ['discovery', 'dashboard', 'opportunities'], success });
  const start = useAction(() => post('/discovery/start'), opts('Discovery started'));
  const pause = useAction(() => post('/discovery/pause'), opts('Discovery paused'));
  const resume = useAction(() => post('/discovery/resume'), opts('Discovery resumed'));
  const stop = useAction(() => post('/discovery/stop'), { ...opts('Discovery stopped'), onSuccess: () => setConfirmStop(false) });
  const runNow = useAction(() => post('/discovery/run-now'), opts('Discovery run queued'));
  const setInterval_ = useAction((intervalMinutes) => patch('/discovery/config', { intervalMinutes }), opts('Interval updated'));

  if (q.isLoading) return <div className="card card-body"><Skeleton height={60} /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const s = STATUS[d.status] || STATUS.stopped;
  const running = d.pendingJobs.some((j) => j.status === 'running');
  const queued = d.pendingJobs.length > 0;
  const lastRun = d.recentRuns[0];
  const workerDown = !d.worker.healthy;

  return (
    <Card
      title={
        <div className="row wrap">
          <h2>Sponsor discovery</h2>
          <Badge tone={s.tone}>
            {d.status === 'running' && d.monitoringActive && <span className="dot pulse" />} {s.label}
          </Badge>
          <DemoBadge show={d.sources.some((x) => x.isDemo && x.enabled)} label="Demo source" />
        </div>
      }
      actions={
        <>
          {d.status === 'running' && <Button size="sm" icon="pause" onClick={() => pause.mutate()} loading={pause.isPending}>Pause</Button>}
          {['paused', 'error'].includes(d.status) && <Button size="sm" variant="primary" icon="play" onClick={() => resume.mutate()} loading={resume.isPending}>Resume</Button>}
          {['stopped', 'awaiting_configuration'].includes(d.status) && <Button size="sm" variant="primary" icon="play" onClick={() => start.mutate()} loading={start.isPending}>Start discovery</Button>}
          <Button size="sm" icon="refresh" onClick={() => runNow.mutate()} loading={runNow.isPending} disabled={queued || d.manualRunsRemainingToday === 0} title={d.manualRunsRemainingToday === 0 ? 'Daily manual run limit reached' : undefined}>
            {queued ? (running ? 'Running…' : 'Queued…') : 'Run now'}
          </Button>
          {d.status !== 'stopped' && <Button size="sm" variant="danger" icon="stop" onClick={() => setConfirmStop(true)}>Stop</Button>}
        </>
      }
    >
      <div className="stack">
        <div className={`callout ${workerDown && d.status === 'running' ? 'danger' : d.status === 'error' ? 'danger' : d.status === 'running' ? 'info' : ''}`} role="status">
          <div className="grow">
            <div className="strong">{d.headline}</div>
            {d.lastError?.message && <div className="small">Last error: {d.lastError.message}</div>}
          </div>
        </div>
        <div className={compact ? 'grid cols-2' : 'grid cols-4'}>
          <div><div className="tiny faint">Next run</div><div className="strong num">{d.nextRunAt ? relative(d.nextRunAt) : '—'}</div></div>
          <div><div className="tiny faint">Last successful run</div><div className="strong num">{d.lastSuccessfulRunAt ? relative(d.lastSuccessfulRunAt) : 'Never'}</div></div>
          {!compact && <div><div className="tiny faint">Background worker</div><div className="strong">{workerDown ? <Badge tone="danger">Offline</Badge> : <Badge tone="success">Healthy</Badge>}</div></div>}
          {!compact && (
            <div>
              <label className="tiny faint" htmlFor="interval">Interval</label>
              <select id="interval" className="select" value={d.intervalMinutes} onChange={(e) => setInterval_.mutate(Number(e.target.value))}>
                {INTERVALS.filter((i) => i.value >= d.minIntervalMinutes).map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                {!INTERVALS.some((i) => i.value === d.intervalMinutes) && <option value={d.intervalMinutes}>Every {d.intervalMinutes} min</option>}
              </select>
            </div>
          )}
        </div>
        {!compact && lastRun && (
          <div className="small muted">
            Last run {dateTime(lastRun.startedAt)} · {lastRun.status} · {lastRun.candidatesFound} signals checked · {lastRun.opportunitiesCreated} new · {lastRun.opportunitiesUpdated} refreshed · {lastRun.excludedByPolicy} excluded by your policy
            {lastRun.sourcesQueried?.some((x) => ['error', 'unavailable'].includes(x.status)) && (
              <div className="small" style={{ color: 'var(--warning)' }}>
                Incomplete — sources unavailable: {lastRun.sourcesQueried.filter((x) => ['error', 'unavailable'].includes(x.status)).map((x) => `${x.source} (${x.status}${x.message ? `: ${x.message}` : ''})`).join('; ')}
              </div>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Stop sponsor discovery?"
        confirmLabel="Stop discovery"
        danger
        loading={stop.isPending}
        onConfirm={() => stop.mutate()}
      >
        <p>Future runs will not be scheduled and any queued run will be cancelled.</p>
        <p className="muted small">Your existing opportunities, conversations and active negotiations are kept and keep working. You can start discovery again any time.</p>
      </ConfirmDialog>
    </Card>
  );
}
