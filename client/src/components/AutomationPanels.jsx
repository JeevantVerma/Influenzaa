import { useState } from 'react';
import { useApi, useAction, useTaxonomy } from '../api/hooks.js';
import { get, patch, post } from '../api/client.js';
import { Badge, Button, Card, ChipSelect, ConfirmDialog, Field, Toggle } from './ui.jsx';
import { dateTime, relative } from '../lib/format.js';

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
              <dt>Reply address</dt><dd className="mono small">{email.inbound?.replyExample}</dd>
              <dt>Replies</dt>
              <dd>
                {email.inbound?.mode === 'imap' ? (
                  <>
                    Checked every minute in <span className="mono">{email.inbound.mailbox}</span> (read-only, only reply-address messages).{' '}
                    {email.inbound.lastError ? (
                      <span style={{ color: 'var(--danger)' }}>Last check failed: {email.inbound.lastError}</span>
                    ) : email.inbound.lastSuccessAt ? (
                      <span className="muted">Last checked {relative(email.inbound.lastSuccessAt)} · {email.inbound.matchedTotal} repl{email.inbound.matchedTotal === 1 ? 'y' : 'ies'} picked up so far.</span>
                    ) : (
                      <span className="muted">Not checked yet.</span>
                    )}
                  </>
                ) : email.inbound?.mode === 'webhook' ? (
                  email.inboundWebhookConfigured ? 'Received through the signed email webhook.' : 'Not set up on this server yet, so brand replies are not received.'
                ) : (
                  'Not received on this server.'
                )}
              </dd>
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

/** Instagram DMs: connect a professional account, see the inbox checker, disconnect. */
export function InstagramPanel() {
  const q = useApi('integrations', '/integrations');
  const [consent, setConsent] = useState(false);
  const [token, setToken] = useState('');
  const connectToken = useAction(() => post('/integrations/instagram/token', { accessToken: token, consent: true }), {
    invalidate: ['integrations'], success: 'Instagram connected', onSuccess: () => setToken(''),
  });
  const login = useAction(() => get('/integrations/instagram/login-url'), { onSuccess: (r) => { window.location.href = r.url; } });
  const checkNow = useAction(() => post('/integrations/instagram/check-now'), { success: 'Checking your Instagram DMs now', onSuccess: () => setTimeout(() => q.refetch(), 4000) });
  const disconnect = useAction(() => post('/integrations/instagram/disconnect'), { invalidate: ['integrations'], success: 'Instagram disconnected' });
  const ig = q.data?.instagram;
  if (!ig) return null;
  const connected = ig.status === 'connected' || ig.status === 'degraded';
  const tone = { connected: 'success', degraded: 'warning', disconnected: '' }[ig.status];
  return (
    <Card title="Instagram DMs" actions={<Badge tone={tone}>{ig.status === 'connected' ? `@${ig.username}` : ig.status === 'degraded' ? 'Needs reconnecting' : 'Not connected'}</Badge>}>
      <div className="stack">
        <p className="small muted">
          CreatorOS reads new DMs on your Instagram professional account, turns brand messages into deals and drafts the replies. Messages from fans and friends are skipped and never stored.
          Instagram only lets apps reply within 24 hours of the brand’s last message, and never send the first message: for pitches, CreatorOS writes the DM and you send it from Instagram.
        </p>
        {connected ? (
          <>
            <dl className="kv small">
              <dt>Account</dt><dd>@{ig.username}{ig.accountType ? ` · ${ig.accountType === 'MEDIA_CREATOR' ? 'Creator' : ig.accountType.toLowerCase()}` : ''}</dd>
              <dt>DMs</dt>
              <dd>
                {!ig.checksInbox ? 'Not checked automatically on this server.' : ig.lastError ? (
                  <span style={{ color: 'var(--danger)' }}>{ig.lastError.message}</span>
                ) : ig.lastSuccessAt && ig.lastConversationCount === 0 ? (
                  <span style={{ color: 'var(--warning)' }}>
                    Checked {relative(ig.lastSuccessAt)}, but Instagram shared no conversations with CreatorOS. On your phone, turn on Settings → Messages and story replies → Message controls → Connected tools → Allow access to messages.
                    While the Meta app is in development, the account messaging you must also be an Instagram Tester on the app (App roles → Roles), with the invite accepted.
                  </span>
                ) : ig.lastSuccessAt ? (
                  <span className="muted">Checked {relative(ig.lastSuccessAt)} · {ig.brandThreads} brand conversation{ig.brandThreads === 1 ? '' : 's'} so far.</span>
                ) : (
                  <span className="muted">Not checked yet. New DMs from now on are picked up within a minute.</span>
                )}
              </dd>
              <dt>Access renews</dt><dd>{ig.tokenExpiresAt ? `automatically; current access ends ${dateTime(ig.tokenExpiresAt)}` : '—'}</dd>
            </dl>
            <div className="row wrap">
              <Button size="sm" loading={checkNow.isPending} onClick={() => checkNow.mutate()}>Check DMs now</Button>
              <Button variant="danger" size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button>
            </div>
          </>
        ) : (
          <>
            {ig.lastError && <div className="callout warning small">{ig.lastError.message}</div>}
            <label className="checkbox small">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{ig.consentText}</span>
            </label>
            {ig.loginAvailable && (
              <div><Button variant="primary" disabled={!consent} loading={login.isPending} onClick={() => login.mutate()}>Connect with Instagram</Button></div>
            )}
            <Field label={ig.loginAvailable ? 'Or paste an access token' : 'Access token'} hint="While the Meta app is in development: Meta app dashboard → Instagram → API setup with Instagram login → Generate token for your tester account.">
              <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="IGAA…" />
            </Field>
            <div><Button variant={ig.loginAvailable ? 'secondary' : 'primary'} disabled={!consent || token.trim().length < 20} loading={connectToken.isPending} onClick={() => connectToken.mutate()}>Connect with token</Button></div>
          </>
        )}
      </div>
    </Card>
  );
}

/** WhatsApp: connect a WhatsApp Business number (Cloud API); brands message it, CreatorOS negotiates. */
export function WhatsAppPanel() {
  const q = useApi('integrations', '/integrations');
  const [consent, setConsent] = useState(false);
  const [form, setForm] = useState({ phoneNumberId: '', accessToken: '' });
  const [copied, setCopied] = useState(false);
  const connect = useAction(() => post('/integrations/whatsapp/token', { ...form, consent: true }), {
    invalidate: ['integrations'], success: 'WhatsApp connected', onSuccess: () => setForm({ phoneNumberId: '', accessToken: '' }),
  });
  const disconnect = useAction(() => post('/integrations/whatsapp/disconnect'), { invalidate: ['integrations'], success: 'WhatsApp disconnected' });
  const wa = q.data?.whatsapp;
  if (!wa) return null;
  const connected = wa.status === 'connected';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(wa.chatLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card title="WhatsApp" actions={<Badge tone={connected ? 'success' : ''}>{connected ? wa.displayPhoneNumber : 'Not connected'}</Badge>}>
      <div className="stack">
        <p className="small muted">
          Connect a WhatsApp Business number. Brands who message it get the same negotiation as email: CreatorOS reads their offers and drafts the replies. Messages from people who aren't brands are skipped and never stored.
          WhatsApp only allows replies within 24 hours of the brand's last message, and businesses can't message a brand first, so share your WhatsApp link (bio, media kit, or "Continue on WhatsApp" in a deal).
        </p>
        {!wa.webhookConfigured && (
          <div className="callout warning small">This server can't receive WhatsApp messages yet: set WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN in server/.env and register the webhook in Meta (see the README).</div>
        )}
        {connected ? (
          <>
            <dl className="kv small">
              <dt>Number</dt><dd>{wa.displayPhoneNumber}{wa.verifiedName ? ` · ${wa.verifiedName}` : ''}{wa.qualityRating ? ` · quality ${wa.qualityRating.toLowerCase()}` : ''}</dd>
              <dt>Messages</dt>
              <dd>{wa.lastWebhookAt ? <span className="muted">Last message from WhatsApp {relative(wa.lastWebhookAt)} · {wa.brandThreads} brand conversation{wa.brandThreads === 1 ? '' : 's'}.</span> : <span className="muted">Nothing received yet. New messages arrive within seconds once the webhook is set up.</span>}</dd>
              <dt>Your chat link</dt><dd className="mono small">{wa.chatLink}</dd>
            </dl>
            <div className="row wrap">
              <Button size="sm" onClick={copyLink}>{copied ? 'Copied' : 'Copy chat link'}</Button>
              <Button variant="danger" size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>Disconnect</Button>
            </div>
          </>
        ) : (
          <>
            <label className="checkbox small">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{wa.consentText}</span>
            </label>
            <Field label="Phone number ID" hint="Meta app dashboard → WhatsApp → API Setup → Phone number ID (a long number, not the phone number itself).">
              <input inputMode="numeric" autoComplete="off" value={form.phoneNumberId} onChange={(e) => setForm((f) => ({ ...f, phoneNumberId: e.target.value }))} placeholder="1234567890…" />
            </Field>
            <Field label="Access token" hint="From the same page (temporary, 24 hours) or a permanent system-user token from Business settings.">
              <input type="password" autoComplete="off" value={form.accessToken} onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))} placeholder="EAA…" />
            </Field>
            <div><Button variant="primary" disabled={!consent || form.accessToken.trim().length < 20 || !/^\d{5,}$/.test(form.phoneNumberId.trim())} loading={connect.isPending} onClick={() => connect.mutate()}>Connect WhatsApp</Button></div>
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
