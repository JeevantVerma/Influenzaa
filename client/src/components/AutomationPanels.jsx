import { useState } from 'react';
import { useApi, useAction, useTaxonomy } from '../api/hooks.js';
import { patch, post } from '../api/client.js';
import { Badge, Button, Card, ChipSelect, ConfirmDialog, Field, Toggle } from './ui.jsx';
import { dateTime } from '../lib/format.js';

export const AUTONOMY = [
  { level: 0, name: 'Draft only', body: 'AI researches, summarises and drafts. You approve every outbound message.' },
  { level: 1, name: 'Approved outreach', body: 'AI may send initial pitches and follow-ups under your rules (if enabled below). Negotiation replies stay drafts.' },
  { level: 2, name: 'Bounded negotiation', body: 'AI may answer routine questions and counter within your authorised pricing and rights. Material decisions still need you.' },
  { level: 3, name: 'Advanced bounded autonomy', body: 'Adds low-risk actions such as payment reminders. Contracts, acceptance, exclusivity and rights always need you.' },
];

/** Autonomy level + auto-send permissions. Changes require explicit confirmation server-side. */
export function AutonomyPanel({ profile }) {
  const [draft, setDraft] = useState({
    level: profile.negotiationAutonomy?.level ?? 0,
    autoSendPitches: !!profile.automation?.autoSendPitches,
    autoSendFollowUps: !!profile.automation?.followUps?.autoSend,
  });
  const [confirm, setConfirm] = useState(false);
  const save = useAction((body) => patch('/settings/autonomy', body), { invalidate: ['profile', 'dashboard'], success: 'Automation permissions updated', onSuccess: () => setConfirm(false) });
  const dirty = draft.level !== (profile.negotiationAutonomy?.level ?? 0) || draft.autoSendPitches !== !!profile.automation?.autoSendPitches || draft.autoSendFollowUps !== !!profile.automation?.followUps?.autoSend;
  return (
    <Card title="Negotiation autonomy" actions={<Badge tone="primary">Current: Level {profile.negotiationAutonomy?.level ?? 0}</Badge>}>
      <div className="stack">
        <div className="grid cols-2" role="radiogroup" aria-label="Autonomy level">
          {AUTONOMY.map((a) => (
            <label key={a.level} className="card card-body" style={{ cursor: 'pointer', borderColor: draft.level === a.level ? 'var(--primary)' : undefined, boxShadow: draft.level === a.level ? 'var(--focus)' : undefined }}>
              <div className="row">
                <input type="radio" name="autonomy" checked={draft.level === a.level} onChange={() => setDraft({ ...draft, level: a.level })} style={{ accentColor: 'var(--primary)' }} />
                <span className="strong">Level {a.level} · {a.name}</span>
              </div>
              <p className="small muted" style={{ marginTop: 6 }}>{a.body}</p>
            </label>
          ))}
        </div>
        <Toggle checked={draft.autoSendPitches} onChange={(x) => setDraft({ ...draft, autoSendPitches: x })} label="Send approved-style pitches automatically" description="Only takes effect at Level 1 or above." />
        <Toggle checked={draft.autoSendFollowUps} onChange={(x) => setDraft({ ...draft, autoSendFollowUps: x })} label="Send follow-ups automatically" description="Only at Level 1+, never after a reply, refusal or opt-out." />
        <div className="callout small">
          Always requires your approval, at every level: accepting or rejecting offers, exclusivity, paid/perpetual rights, contracts, unusual payment terms, sensitive messages, and anything outside your rate rules.
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" disabled={!dirty} onClick={() => setConfirm(true)}>Review change</Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Change automation permissions?"
        confirmLabel="Confirm change"
        loading={save.isPending}
        onConfirm={() => save.mutate({ ...draft, confirm: true })}
        requireCheck="I understand CreatorOS may act on my behalf within these permissions."
      >
        <p>You are setting <strong>Level {draft.level} · {AUTONOMY[draft.level].name}</strong>.</p>
        <ul className="small">
          <li>Automatic pitches: {draft.autoSendPitches ? 'on' : 'off'}</li>
          <li>Automatic follow-ups: {draft.autoSendFollowUps ? 'on' : 'off'}</li>
        </ul>
      </ConfirmDialog>
    </Card>
  );
}

/** Explicit authorisation for sending email on the creator's behalf. */
export function EmailAuthorizationPanel() {
  const q = useApi('integrations', '/integrations');
  const [consent, setConsent] = useState(false);
  const connect = useAction(() => post('/integrations/email/connect', { consent: true }), { invalidate: ['integrations'], success: 'Email sending authorised' });
  const disconnect = useAction(() => post('/integrations/email/disconnect'), { invalidate: ['integrations'], success: 'Email authorisation revoked' });
  const email = q.data?.email;
  if (!email) return null;
  const connected = ['connected', 'demo', 'degraded'].includes(email.status);
  const tone = { connected: 'success', demo: 'demo', degraded: 'warning', disconnected: '', unavailable: 'danger' }[email.status];
  return (
    <Card title="Email outreach" actions={<Badge tone={tone}>{email.status === 'demo' ? 'Demo — simulated' : email.status}</Badge>}>
      <div className="stack">
        <p className="small muted">{email.detail}</p>
        {email.mode === 'demo' && <div className="callout demo small">This server uses the demo email adapter. Messages you approve are recorded as “simulated” and are <strong>not delivered</strong> to anyone.</div>}
        {connected ? (
          <>
            <dl className="kv small">
              <dt>Authorised</dt><dd>{dateTime(email.authorizedAt)}</dd>
              <dt>Sender</dt><dd>Your name via CreatorOS &lt;{email.fromAddress}&gt;</dd>
              <dt>Replies</dt><dd>Routed back to your CreatorOS inbox {email.inboundWebhookConfigured ? '' : '(inbound webhook not configured on this server)'}</dd>
              {email.recentFailedSends > 0 && (<><dt>Failed sends (7d)</dt><dd><Badge tone="danger">{email.recentFailedSends}</Badge></dd></>)}
            </dl>
            <div><Button variant="danger" size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>Revoke authorisation</Button></div>
          </>
        ) : (
          <>
            <label className="checkbox small">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{email.consentText}</span>
            </label>
            <div><Button variant="primary" disabled={!consent || email.status === 'unavailable'} loading={connect.isPending} onClick={() => connect.mutate()}>Authorise email sending</Button></div>
          </>
        )}
      </div>
    </Card>
  );
}

/** Follow-ups, approval categories, notifications (profile patch). */
export function PreferencesForm({ profile, onSave, saving, submitLabel = 'Save', secondary }) {
  const tax = useTaxonomy();
  const fu = profile.automation?.followUps || {};
  const n = profile.notifications || {};
  const [v, setV] = useState({
    followUpsEnabled: fu.enabled ?? true,
    maxAttempts: fu.maxAttempts ?? 2,
    interval: fu.intervalBusinessDays ?? 4,
    additionalCategories: profile.approvalPolicy?.additionalCategories || [],
    approvalExpiryHours: profile.approvalPolicy?.approvalExpiryHours ?? 72,
    inApp: n.inApp ?? true,
    newOpportunities: n.newOpportunities ?? true,
    approvals: n.approvals ?? true,
    deadlines: n.deadlines ?? true,
  });
  const set = (k) => (x) => {
    const val = x?.target ? x.target.value : x;
    setV((prev) => ({ ...prev, [k]: val }));
  };
  const submit = (e) => {
    e.preventDefault();
    onSave({
      automation: { followUps: { enabled: v.followUpsEnabled, maxAttempts: Number(v.maxAttempts) || 0, intervalBusinessDays: Number(v.interval) || 1 } },
      approvalPolicy: { additionalCategories: v.additionalCategories, approvalExpiryHours: Number(v.approvalExpiryHours) || 72 },
      notifications: { inApp: v.inApp, newOpportunities: v.newOpportunities, approvals: v.approvals, deadlines: v.deadlines },
    });
  };
  return (
    <form className="stack lg" onSubmit={submit} noValidate>
      <section className="stack">
        <h3>Follow-ups</h3>
        <Toggle checked={v.followUpsEnabled} onChange={set('followUpsEnabled')} label="Schedule follow-ups when a brand doesn't reply" description="Business-day aware. Stops on any reply, refusal or opt-out." />
        <div className="grid cols-2">
          <Field label="Maximum follow-ups">{(p) => <input {...p} className="input num" type="number" min="0" max="5" value={v.maxAttempts} onChange={set('maxAttempts')} />}</Field>
          <Field label="Business days between messages">{(p) => <input {...p} className="input num" type="number" min="1" max="30" value={v.interval} onChange={set('interval')} />}</Field>
        </div>
      </section>
      <section className="stack">
        <h3>Approval policy</h3>
        <p className="small muted">Mandatory categories are always gated. Select any category to make it explicit in your own policy as well.</p>
        <ChipSelect label="Approval categories" options={tax.data?.approvalCategories || []} value={v.additionalCategories} onChange={set('additionalCategories')} />
        <Field label="Approval requests expire after (hours)">{(p) => <input {...p} className="input num" type="number" min="1" max="720" value={v.approvalExpiryHours} onChange={set('approvalExpiryHours')} style={{ maxWidth: 200 }} />}</Field>
      </section>
      <section className="stack">
        <h3>Notifications</h3>
        <Toggle checked={v.inApp} onChange={set('inApp')} label="In-app notifications" />
        <Toggle checked={v.newOpportunities} onChange={set('newOpportunities')} label="New opportunities" />
        <Toggle checked={v.approvals} onChange={set('approvals')} label="Approval requests" />
        <Toggle checked={v.deadlines} onChange={set('deadlines')} label="Deadlines and overdue payments" />
      </section>
      <div className="row between">
        <div>{secondary}</div>
        <Button type="submit" variant="primary" loading={saving}>{submitLabel}</Button>
      </div>
    </form>
  );
}
