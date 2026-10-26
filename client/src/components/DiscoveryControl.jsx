import { useState } from 'react';
import { useApi, useAction } from '../api/hooks.js';
import { post, patch } from '../api/client.js';
import { Button, ConfirmDialog, Disclosure, ErrorState, Skeleton, DemoBadge } from './ui.jsx';
import { dateTime, relative } from '../lib/format.js';

function STATUS_TEXT(d, workerDown) {
  if (d.status === 'running' && workerDown) return { tone: 'warn', text: 'On, but the background worker is offline' };
  if (d.status === 'running') return { tone: 'on', text: 'Finding sponsors for you', meta: d.nextRunAt ? `next search ${relative(d.nextRunAt)}` : null };
  if (d.status === 'paused') return { tone: 'off', text: 'Discovery is paused' };
  if (d.status === 'error') return { tone: 'warn', text: 'Discovery stopped after errors' };
  if (d.status === 'awaiting_configuration') return { tone: 'warn', text: 'Add your niches in Settings to start finding sponsors' };
  return { tone: 'off', text: 'Discovery is off' };
}

const INTERVALS = [
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Daily' },
  { value: 4320, label: 'Every 3 days' },
  { value: 10080, label: 'Weekly' },
];

/** One-line discovery status with a search button; the full controls fold out below. */
export function DiscoveryControl({ defaultOpen = false }) {
  const q = useApi('discovery', '/discovery/status', { refetchInterval: (query) => (query.state.data?.pendingJobs?.length ? 3000 : 20_000) });
  const [confirmStop, setConfirmStop] = useState(false);
  const opts = (success) => ({ invalidate: ['discovery', 'dashboard', 'opportunities'], success });
  const start = useAction(() => post('/discovery/start'), opts('Discovery started'));
  const pause = useAction(() => post('/discovery/pause'), opts('Discovery paused'));
  const resume = useAction(() => post('/discovery/resume'), opts('Discovery resumed'));
  const stop = useAction(() => post('/discovery/stop'), { ...opts('Discovery stopped'), onSuccess: () => setConfirmStop(false) });
  const runNow = useAction(() => post('/discovery/run-now'), opts('Discovery run queued'));
  const setInterval_ = useAction((intervalMinutes) => patch('/discovery/config', { intervalMinutes }), opts('Interval updated'));

  if (q.isLoading) return <div className="card card-body"><Skeleton height={40} /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const running = d.pendingJobs.some((j) => j.status === 'running');
  const queued = d.pendingJobs.length > 0;
  const lastRun = d.recentRuns[0];
  const workerDown = !d.worker.healthy;
  const status = STATUS_TEXT(d, workerDown);
  const failedSources = lastRun?.sourcesQueried?.filter((x) => ['error', 'unavailable'].includes(x.status)) || [];
  const interval = INTERVALS.find((i) => i.value === d.intervalMinutes)?.label || `Every ${d.intervalMinutes} min`;

  return (
    <div className="discovery-bar">
      <div className="discovery-bar-row">
        <div className="row wrap">
          <span className={`status-pill ${status.tone}`} role="status">
            <span className={`dot ${d.status === 'running' && d.monitoringActive ? 'pulse' : ''}`} aria-hidden="true" />
            <span>{status.text}</span>
            {status.meta && <span className="faint">· {status.meta}</span>}
          </span>
          <DemoBadge show={d.sources.some((x) => x.isDemo && x.enabled)} label="Demo brands included" />
        </div>
        <div className="btn-group">
          {['stopped', 'awaiting_configuration'].includes(d.status) && <Button variant="primary" icon="play" onClick={() => start.mutate()} loading={start.isPending}>Turn on discovery</Button>}
          {['paused', 'error'].includes(d.status) && <Button variant="primary" icon="play" onClick={() => resume.mutate()} loading={resume.isPending}>Resume</Button>}
          <Button icon="refresh" onClick={() => runNow.mutate()} loading={runNow.isPending} disabled={queued || d.manualRunsRemainingToday === 0} title={d.manualRunsRemainingToday === 0 ? "You've used today's manual searches" : undefined}>
            {queued ? (running ? 'Searching…' : 'Starting…') : 'Search now'}
          </Button>
        </div>
      </div>
      {(d.lastError?.message || (workerDown && d.status === 'running')) && (
        <div className="callout danger small" role="alert">{workerDown && d.status === 'running' ? 'The background worker is offline, so no searches run until it is back.' : `Last error: ${d.lastError.message}`}</div>
      )}
      {failedSources.length > 0 && (
        <div className="callout warning small">Last search was incomplete: {failedSources.map((x) => `${x.source}${x.message ? ` (${x.message})` : ''}`).join('; ')}.</div>
      )}
      <Disclosure title="Discovery settings" meta={`${interval}${lastRun ? ` · last search ${relative(lastRun.startedAt)}` : ''}`} defaultOpen={defaultOpen}>
        <div className="stack">
          <div className="grid cols-3">
            <div><div className="tiny faint">Next search</div><div className="strong num">{d.nextRunAt ? relative(d.nextRunAt) : '—'}</div></div>
            <div><div className="tiny faint">Last successful search</div><div className="strong num">{d.lastSuccessfulRunAt ? relative(d.lastSuccessfulRunAt) : 'Never'}</div></div>
            <div>
              <label className="tiny faint" htmlFor="interval">How often</label>
              <select id="interval" className="select" value={d.intervalMinutes} onChange={(e) => setInterval_.mutate(Number(e.target.value))}>
                {INTERVALS.filter((i) => i.value >= d.minIntervalMinutes).map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                {!INTERVALS.some((i) => i.value === d.intervalMinutes) && <option value={d.intervalMinutes}>{interval}</option>}
              </select>
            </div>
          </div>
          {lastRun && (
            <p className="small muted">
              Last search {dateTime(lastRun.startedAt)}: checked {lastRun.candidatesFound} lead{lastRun.candidatesFound === 1 ? '' : 's'}, found {lastRun.opportunitiesCreated} new, refreshed {lastRun.opportunitiesUpdated}
              {lastRun.excludedByPolicy ? `, and skipped ${lastRun.excludedByPolicy} that don't fit your brand rules` : ''}. Background worker: {workerDown ? 'offline' : 'running'}.
            </p>
          )}
          <div className="btn-group">
            {d.status === 'running' && <Button size="sm" icon="pause" onClick={() => pause.mutate()} loading={pause.isPending}>Pause</Button>}
            {d.status !== 'stopped' && <Button size="sm" variant="danger" icon="stop" onClick={() => setConfirmStop(true)}>Turn off</Button>}
          </div>
        </div>
      </Disclosure>
      <ConfirmDialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Turn off sponsor discovery?"
        confirmLabel="Turn off"
        danger
        loading={stop.isPending}
        onConfirm={() => stop.mutate()}
      >
        <p>Future runs will not be scheduled and any queued run will be cancelled.</p>
        <p className="muted small">Your existing opportunities, conversations and active negotiations are kept and keep working. You can start discovery again any time.</p>
      </ConfirmDialog>
    </div>
  );
}
