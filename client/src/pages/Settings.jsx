import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApi, useAction, useTaxonomy } from '../api/hooks.js';
import { patch, post, del, get } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { IdentityForm, AudienceForm, CommercialForm } from '../components/ProfileForms.jsx';
import { AutonomyPanel, EmailAuthorizationPanel, InstagramPanel, PreferencesForm, WhatsAppPanel } from '../components/AutomationPanels.jsx';
import { DiscoveryControl } from '../components/DiscoveryControl.jsx';
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, LoadingCard, Tabs } from '../components/ui.jsx';
import { useToast } from '../components/Toast.jsx';
import { dateTime } from '../lib/format.js';

const TABS = [
  { value: 'profile', label: 'Profile' },
  { value: 'audience', label: 'Audience' },
  { value: 'commercial', label: 'Pricing & brands' },
  { value: 'autonomy', label: 'Autonomy & approvals' },
  { value: 'discovery', label: 'Discovery' },
  { value: 'integrations', label: 'Integrations' },
  { value: 'privacy', label: 'Privacy & account' },
];

function DiscoverySources() {
  const q = useApi('discovery', '/discovery/status');
  const [feed, setFeed] = useState({ url: '', brandName: '', brandDomain: '' });
  const [handleInput, setHandleInput] = useState('');
  const save = useAction((body) => patch('/discovery/config', body), { invalidate: ['discovery'], success: 'Discovery sources updated' });
  if (!q.data) return null;
  const d = q.data;
  const enabled = d.sourceConfiguration.enabledSources.length ? d.sourceConfiguration.enabledSources : d.sources.map((s) => s.id);
  const feeds = d.sourceConfiguration.rssFeeds;
  const creators = d.sourceConfiguration.instagramCreators || [];
  const typedHandles = handleInput.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean);
  const addCreators = () =>
    save.mutate({ instagramCreators: [...creators, ...typedHandles].slice(0, 10) }, { onSuccess: () => setHandleInput('') });
  return (
    <Card title="Research sources">
      <div className="stack">
        <p className="small muted">
          Sources: official brand feeds, Indian business news (GDELT), a web search API, brands' own websites, and public Instagram posts collected by Apify, a third-party
          service. CreatorOS never logs in to any site. Every brand is checked against its own website before it is shown, and the demo dataset is always labelled.
        </p>
        {d.sources.map((s) => (
          <label key={s.id} className="checkbox">
            <input type="checkbox" checked={enabled.includes(s.id)} disabled={enabled.length === 1 && enabled.includes(s.id)} onChange={(e) => save.mutate({ enabledSources: e.target.checked ? [...new Set([...enabled, s.id])] : enabled.filter((x) => x !== s.id) })} />
            <span><span className="strong">{s.label}</span> {s.isDemo && <Badge tone="demo">Demo</Badge>}</span>
          </label>
        ))}
        {d.sources.some((s) => s.id === 'instagram') && (
          <div className="stack sm">
            <h3>Creators similar to you</h3>
            <p className="small muted">
              Add up to 10 Instagram creators in your niche. CreatorOS checks their recent public posts for paid partnerships and discount codes; brands paying them
              are your strongest leads. Their names are never shown in your opportunities.
            </p>
            {creators.length > 0 && (
              <div className="chips">
                {creators.map((h) => (
                  <span key={h} className="chip" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <span className="mono">@{h}</span>
                    <button type="button" className="btn ghost sm" aria-label={`Remove @${h}`} onClick={() => save.mutate({ instagramCreators: creators.filter((x) => x !== h) })}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="row">
              <input
                aria-label="Instagram handles"
                className="input grow"
                placeholder="@creator or instagram.com/creator (separate several with commas)"
                value={handleInput}
                disabled={creators.length >= 10}
                onChange={(e) => setHandleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && typedHandles.length) addCreators(); }}
              />
              <Button size="sm" disabled={!typedHandles.length || creators.length >= 10} loading={save.isPending} onClick={addCreators}>Add</Button>
            </div>
            <p className="tiny faint">{creators.length}/10 added{creators.length === 0 ? ' · until you add some, Instagram scans niche hashtags, which rarely show paid partnerships' : ''}</p>
          </div>
        )}
        {d.sources.some((s) => s.id === 'rss') && (
          <div className="stack sm">
            <h3>Brand newsroom feeds</h3>
            {feeds.length === 0 && <p className="small muted">No feeds yet. Add a brand's official press-release or newsroom RSS/Atom feed.</p>}
            {feeds.map((f) => (
              <div key={f.url} className="row small">
                <span className="grow truncate"><span className="strong">{f.brandName}</span> <span className="mono faint">{f.url}</span></span>
                <Button size="sm" variant="ghost" onClick={() => save.mutate({ rssFeeds: feeds.filter((x) => x.url !== f.url) })}>Remove</Button>
              </div>
            ))}
            <div className="grid cols-3">
              <input aria-label="Feed URL" className="input" placeholder="https://brand.com/newsroom/feed.xml" value={feed.url} onChange={(e) => setFeed({ ...feed, url: e.target.value })} />
              <input aria-label="Brand name" className="input" placeholder="Brand name" value={feed.brandName} onChange={(e) => setFeed({ ...feed, brandName: e.target.value })} />
              <input aria-label="Brand domain" className="input" placeholder="brand.com" value={feed.brandDomain} onChange={(e) => setFeed({ ...feed, brandDomain: e.target.value })} />
            </div>
            <div><Button size="sm" disabled={!feed.url} loading={save.isPending} onClick={() => save.mutate({ rssFeeds: [...feeds, { url: feed.url, brandName: feed.brandName || undefined, brandDomain: feed.brandDomain || undefined }] }, { onSuccess: () => setFeed({ url: '', brandName: '', brandDomain: '' }) })}>Add feed</Button></div>
          </div>
        )}
      </div>
    </Card>
  );
}

function Integrations() {
  const q = useApi('integrations', '/integrations');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const igResult = params.get('instagram');
  useEffect(() => {
    if (!igResult) return;
    toast(igResult === 'connected' ? 'Instagram connected' : params.get('message') || 'Instagram was not connected', igResult === 'connected' ? 'success' : 'error');
    setParams((p) => { p.delete('instagram'); p.delete('message'); return p; }, { replace: true });
  }, [igResult]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <LoadingCard />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const i = q.data;
  const row = (name, status, detail, tone) => (
    <div className="list-item" style={{ alignItems: 'flex-start' }}>
      <div className="grow"><div className="strong">{name}</div><div className="small muted">{detail}</div></div>
      <Badge tone={tone}>{status}</Badge>
    </div>
  );
  return (
    <div className="stack lg">
      <EmailAuthorizationPanel />
      <InstagramPanel />
      <WhatsAppPanel />
      <Card title="Integration status" bodyClass="">
        <div className="list">
          {row(`AI provider${i.ai.model ? ` · ${i.ai.model}` : ''}`, i.ai.status, i.ai.detail, { connected: 'success', demo: 'demo', degraded: 'warning', disconnected: '' }[i.ai.status])}
          {row('Background worker', i.worker.healthy ? 'healthy' : 'offline', i.worker.healthy ? `${i.worker.activeWorkers} worker(s), last heartbeat ${dateTime(i.worker.lastHeartbeatAt)}` : 'No recent heartbeat. Scheduled discovery, sending and follow-ups are paused until a worker runs.', i.worker.healthy ? 'success' : 'danger')}
          {row('Discovery sources', `${i.discoverySources.length} available`, i.discoverySources.map((s) => s.label).join(' · '), 'info')}
        </div>
      </Card>
    </div>
  );
}

function Privacy() {
  const toast = useToast();
  const { clear } = useAuth();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [password, setPassword] = useState('');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [exporting, setExporting] = useState(false);
  const remove = useAction(() => del('/settings/account', { password, confirm: true }), { onSuccess: () => { clear(); navigate('/login'); } });
  const change = useAction(() => post('/auth/change-password', pw), { success: 'Password changed. Please sign in again.', onSuccess: () => { clear(); navigate('/login'); } });
  const logoutAll = useAction(() => post('/auth/logout-all'), { onSuccess: () => { clear(); navigate('/login'); } });
  const exportData = async () => {
    setExporting(true);
    try {
      const data = await get('/settings/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `creatoros-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="stack lg">
      <Card title="Your data">
        <div className="stack">
          <p className="small muted">CreatorOS stores your profile, preferences, discovered opportunities, conversations, deals, campaigns and an audit trail so it can act for you. Message bodies and credentials are never written to logs. Designed with India's DPDP Act principles in mind: purpose limitation, access and erasure.</p>
          <div><Button onClick={exportData} loading={exporting}>Export all my data (JSON)</Button></div>
        </div>
      </Card>
      <Card title="Security">
        <div className="stack">
          <div className="grid cols-2">
            <Field label="Current password">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
            <Field label="New password" hint="At least 10 characters">{(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
          </div>
          <div className="btn-group">
            <Button variant="primary" disabled={!pw.currentPassword || pw.newPassword.length < 10} loading={change.isPending} onClick={() => change.mutate()}>Change password</Button>
            <Button onClick={() => logoutAll.mutate()} loading={logoutAll.isPending}>Sign out everywhere</Button>
          </div>
        </div>
      </Card>
      <Card title="Delete account">
        <div className="stack">
          <p className="small">Permanently deletes your profile, opportunities, conversations, deals, campaigns, invoices and integration authorisations. This cannot be undone. Export your data first if you need it.</p>
          <div><Button variant="danger" onClick={() => setConfirm(true)}>Delete my account…</Button></div>
        </div>
      </Card>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Delete your account permanently?" confirmLabel="Delete everything" danger loading={remove.isPending} onConfirm={() => remove.mutate()} requireCheck="I understand this permanently deletes my data.">
        <Field label="Confirm with your password">{(p) => <input {...p} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
      </ConfirmDialog>
    </div>
  );
}

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'profile';
  const qc = useQueryClient();
  const profile = useApi('profile', '/creator-profile/me');
  const tax = useTaxonomy();
  const save = useAction((body) => patch('/creator-profile/me', body), { invalidate: ['dashboard', 'discovery'], success: 'Saved', onSuccess: (data) => qc.setQueryData(['profile'], data) });

  return (
    <div className="stack lg">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Your profile, commercial boundaries, autonomy and integrations. Changes apply to future AI decisions immediately.</p>
        </div>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={(v) => setParams({ tab: v })} />
      {profile.isLoading || tax.isLoading ? (
        <LoadingCard lines={6} />
      ) : profile.error ? (
        <ErrorState error={profile.error} onRetry={profile.refetch} />
      ) : (
        <>
          {tab === 'profile' && <Card><IdentityForm key={profile.dataUpdatedAt} profile={profile.data} onSave={(b) => save.mutate(b)} saving={save.isPending} /></Card>}
          {tab === 'audience' && <Card><AudienceForm key={profile.dataUpdatedAt} profile={profile.data} onSave={(b) => save.mutate(b)} saving={save.isPending} /></Card>}
          {tab === 'commercial' && <Card><CommercialForm key={profile.dataUpdatedAt} profile={profile.data} onSave={(b) => save.mutate(b)} saving={save.isPending} /></Card>}
          {tab === 'autonomy' && (
            <div className="stack lg">
              <AutonomyPanel key={profile.dataUpdatedAt} profile={profile.data} />
              <Card title="Follow-ups, approvals & notifications"><PreferencesForm key={profile.dataUpdatedAt} profile={profile.data} onSave={(b) => save.mutate(b)} saving={save.isPending} /></Card>
            </div>
          )}
          {tab === 'discovery' && <div className="stack lg"><DiscoveryControl defaultOpen /><DiscoverySources /></div>}
          {tab === 'integrations' && <Integrations />}
          {tab === 'privacy' && <Privacy />}
        </>
      )}
    </div>
  );
}
