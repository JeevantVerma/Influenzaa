import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, useAction } from '../api/hooks.js';
import { post, patch } from '../api/client.js';
import { Badge, Button, ConfirmDialog, DemoBadge, Disclosure, ErrorState, Field, LoadingCard, Modal, PageHead, ScoreBadge, Section } from '../components/ui.jsx';
import { ContactIndicator, EvidencePanel, ScoreFactors, SignalBadge } from '../components/OpportunityParts.jsx';
import { date, humanize, NEGOTIATION_LABELS, negotiationTone, relative } from '../lib/format.js';

function AddContact({ oppId, onDone }) {
  const [v, setV] = useState({ name: '', role: '', businessEmail: '', sourceUrl: '' });
  const add = useAction((body) => post(`/opportunities/${oppId}/contacts`, body), { invalidate: [['opportunity', oppId]], success: 'Contact added (private to you)', onSuccess: onDone });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); add.mutate({ name: v.name || null, role: v.role || null, businessEmail: v.businessEmail, ...(v.sourceUrl ? { sourceUrl: v.sourceUrl } : {}) }); }}>
      <p className="small muted">Only add business contacts you obtained lawfully (e.g. a public partnerships page or a direct introduction). Manually added contacts are unverified and visible only to you.</p>
      <div className="grid cols-2">
        <Field label="Name">{(p) => <input {...p} className="input" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="Role">{(p) => <input {...p} className="input" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} placeholder="e.g. Influencer Marketing Manager" />}</Field>
      </div>
      <Field label="Business email">{(p) => <input {...p} className="input" type="email" required value={v.businessEmail} onChange={(e) => setV({ ...v, businessEmail: e.target.value })} />}</Field>
      <Field label="Where you found it (URL, optional)">{(p) => <input {...p} className="input" value={v.sourceUrl} onChange={(e) => setV({ ...v, sourceUrl: e.target.value })} placeholder="https://" />}</Field>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="submit" variant="primary" loading={add.isPending}>Add contact</Button></div>
    </form>
  );
}

const dmBytes = (t) => new TextEncoder().encode(t || '').length;

/**
 * Pitch by Instagram DM. Instagram doesn't let apps send a first message, so
 * the creator sends it (copy + open Instagram) and marks it sent; the brand's
 * reply is then picked up from the connected inbox.
 */
function InstagramPitch({ opp, connected }) {
  const navigate = useNavigate();
  const [body, setBody] = useState('');
  const [started, setStarted] = useState(null);
  const generate = useAction(() => post(`/opportunities/${opp._id}/instagram-pitch/draft`), { onSuccess: (d) => setBody(d.body) });
  const start = useAction(() => post(`/opportunities/${opp._id}/instagram-pitch`, { body }), {
    invalidate: ['opportunities', 'conversations', ['opportunity', opp._id]],
    onSuccess: async (r) => {
      setStarted(r);
      try {
        await navigator.clipboard.writeText(r.text);
      } catch {
        /* clipboard blocked: the text stays visible to copy by hand */
      }
      window.open(r.openUrl, '_blank', 'noopener');
    },
  });
  const sent = useAction(() => post(`/conversations/${started.conversationId}/instagram-pitch-sent`), {
    invalidate: ['opportunities', 'conversations', 'dashboard', ['opportunity', opp._id]],
    success: 'Marked as sent. Their reply will appear in your inbox.',
    onSuccess: () => navigate(`/inbox?conversation=${started.conversationId}`),
  });
  const handle = opp.brand.instagramHandle;
  if (!connected) {
    return (
      <div className="stack sm">
        <p className="small muted">To pitch @{handle} by DM, connect your Instagram first so their reply is picked up automatically.</p>
        <div><Link className="btn primary" to="/settings?tab=integrations">Connect Instagram</Link></div>
      </div>
    );
  }
  if (started) {
    return (
      <div className="stack">
        <div className="callout warning small">The DM is copied and Instagram opened in a new tab. Paste and send it to @{handle}, then come back and mark it sent.</div>
        <textarea className="textarea" aria-label="DM text" rows={6} readOnly value={started.text} />
        <div className="row wrap">
          <Button onClick={() => window.open(started.openUrl, '_blank', 'noopener')}>Open Instagram again</Button>
          <Button variant="primary" loading={sent.isPending} onClick={() => sent.mutate()}>I've sent it</Button>
        </div>
      </div>
    );
  }
  const bytes = dmBytes(body);
  return !body ? (
    <div className="pitch-cta">
      <div>
        <div className="strong">Pitch @{handle} by DM</div>
        <p className="small muted">AI writes a short DM. Instagram doesn't let apps send a first message, so you send it yourself in one tap; CreatorOS takes over when they reply.</p>
      </div>
      <Button variant="primary" size="lg" icon="sparkle" loading={generate.isPending} onClick={() => generate.mutate()}>Draft a DM</Button>
    </div>
  ) : (
    <div className="stack">
      <Field label={`DM to @${handle}`} hint={`${bytes} of about 900 characters. A one-line note that CreatorOS (AI-assisted) helped is added.`}>
        {(p) => <textarea {...p} className="textarea" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <div className="row between wrap">
        <Button icon="refresh" onClick={() => generate.mutate()} loading={generate.isPending}>Regenerate</Button>
        <Button variant="primary" disabled={body.trim().length < 10 || bytes > 900} loading={start.isPending} onClick={() => start.mutate()}>Copy and open Instagram</Button>
      </div>
    </div>
  );
}

function PitchComposer({ opp }) {
  const integrations = useApi('integrations', '/integrations');
  const [via, setVia] = useState('email');
  const navigate = useNavigate();
  const contacts = opp.contacts.filter((c) => c.businessEmail && !c.doNotContact);
  const [draft, setDraft] = useState(opp.pitchDraft?.body ? { subject: opp.pitchDraft.subject, body: opp.pitchDraft.body, provider: opp.pitchDraft.provider } : null);
  const [contactId, setContactId] = useState(opp.pitchDraft?.contactId || contacts[0]?._id || '');
  const [confirm, setConfirm] = useState(false);
  const generate = useAction(() => post(`/opportunities/${opp._id}/draft-pitch`), {
    invalidate: [['opportunity', opp._id]],
    onSuccess: (d) => setDraft({ subject: d.subject, body: d.body, provider: d.provider, fallbackReason: d.fallbackReason }),
  });
  const initiate = useAction(() => post(`/opportunities/${opp._id}/initiate-outreach`, { contactId, subject: draft.subject, body: draft.body }), {
    invalidate: ['opportunities', 'approvals', 'dashboard', ['opportunity', opp._id], 'conversations'],
    success: (r) => (r.autoAuthorized ? 'Pitch queued under your automation rules' : 'Pitch sent to your approval queue — nothing has been sent yet'),
    onSuccess: (r) => {
      setConfirm(false);
      navigate(r.autoAuthorized ? `/inbox?conversation=${r.conversationId}` : `/approvals?focus=${r.approvalId}`);
    },
  });
  const openDeal = opp.outreachHistory.find((h) => h.status === 'open');
  if (opp.excluded) return <div className="callout danger">This brand is excluded by your policy: {opp.exclusionReason}. Update your brand preferences to reconsider it.</div>;
  if (openDeal) {
    return (
      <div className="callout info">
        You already have an open conversation with this brand. <Link to={`/negotiations/${openDeal.dealId}`}>Open negotiation →</Link>
      </div>
    );
  }
  const handle = opp.brand.instagramHandle;
  const igConnected = ['connected', 'degraded'].includes(integrations.data?.instagram?.status);
  const chooser = handle && (
    <div className="seg" role="group" aria-label="Pitch by">
      <button type="button" className={`seg-btn ${via === 'email' ? 'active' : ''}`} aria-pressed={via === 'email'} onClick={() => setVia('email')}>Email</button>
      <button type="button" className={`seg-btn ${via === 'instagram' ? 'active' : ''}`} aria-pressed={via === 'instagram'} onClick={() => setVia('instagram')}>Instagram DM</button>
    </div>
  );
  if (handle && via === 'instagram') return <div className="stack">{chooser}<InstagramPitch opp={opp} connected={igConnected} /></div>;
  return (
    <div className="stack">
      {chooser}
      {!draft ? (
        <div className="pitch-cta">
          <div>
            <div className="strong">Let AI write your first pitch</div>
            <p className="small muted">A personal email based on why this brand fits you. You can edit it, and nothing is sent until you approve it.</p>
          </div>
          <Button variant="primary" size="lg" icon="sparkle" loading={generate.isPending} onClick={() => generate.mutate()}>Draft a pitch</Button>
        </div>
      ) : (
        <>
          <div className="row wrap">
            <Badge tone="ai">AI draft · not sent</Badge>
            <span className="tiny faint">{draft.provider === 'mock' ? 'Written by the development mock (rule-based)' : draft.provider === 'template' ? 'Written from a template (AI was unavailable)' : `Written by ${draft.provider === 'gemini' ? 'Gemini' : draft.provider === 'anthropic' ? 'Claude' : draft.provider}`}</span>
          </div>
          <Field label="Send to">
            {(p) =>
              contacts.length ? (
                <select {...p} className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  {contacts.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.businessEmail} · {c.name || c.role || humanize(c.roleCategory)} · {Math.round(c.confidence * 100)}% sure
                    </option>
                  ))}
                </select>
              ) : (
                <div className="callout warning small">No email address for this brand yet. Find one on their website or add one under "Who to contact".</div>
              )
            }
          </Field>
          <Field label="Subject">{(p) => <input {...p} className="input" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} maxLength={200} />}</Field>
          <Field label="Message" hint="Your name, a note that CreatorOS helped write it, and an unsubscribe line are added automatically.">
            {(p) => <textarea {...p} className="textarea" rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />}
          </Field>
          <div className="row between wrap">
            <Button icon="refresh" onClick={() => generate.mutate()} loading={generate.isPending}>Regenerate</Button>
            <Button variant="primary" disabled={!contactId || draft.body.trim().length < 20} onClick={() => setConfirm(true)}>Review before sending</Button>
          </div>
        </>
      )}
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Move this pitch to approvals?" confirmLabel="Continue" loading={initiate.isPending} onConfirm={() => initiate.mutate()}>
        <p>Your pitch goes to Approvals, where you see the exact email before it is sent. Nothing is sent yet.</p>
        <p className="small muted">If you turned on automatic pitches in Settings, it is sent right away under those rules instead.</p>
      </ConfirmDialog>
    </div>
  );
}

const VERIFICATION_TEXT = { verified: 'from the brand', partially_verified: 'partly from the brand', unverified: 'third-party sources', demo: 'demo data', stale: 'old evidence' };

const CONTACT_CHECK_TEXT = {
  queued: 'Checking the brand\'s website for published contacts…',
  found: 'Found on the brand\'s website',
  none_found: 'No business email is published on the brand\'s website',
  blocked_by_robots: 'The website asks automated tools not to read it (robots.txt), so it was not checked',
  access_denied: 'The website refused automated access, so it was not checked',
  unreachable: 'The brand\'s website could not be reached',
};

function ContactCheckStatus({ check }) {
  if (!check?.status) return null;
  const when = check.status === 'queued' ? '' : ` · ${relative(check.checkedAt)}`;
  const count = check.status === 'found' ? ` (${check.contactsFound})` : '';
  return <div className="tiny faint" style={{ padding: '8px 16px 0' }} role="status">{CONTACT_CHECK_TEXT[check.status]}{count}{when}{check.pagesChecked ? ` · ${check.pagesChecked} page(s) read` : ''}</div>;
}

function sourcePath(url) {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? u.hostname : u.pathname;
  } catch {
    return url;
  }
}

export default function OpportunityDetailPage() {
  const { id } = useParams();
  const q = useApi(['opportunity', id], `/opportunities/${id}`, { refetchInterval: (query) => (query.state.data?.brand?.contactDiscovery?.status === 'queued' ? 3000 : false) });
  const [adding, setAdding] = useState(false);
  const feedback = useAction((rating) => post(`/opportunities/${id}/feedback`, { rating }), { invalidate: [['opportunity', id]], success: 'Thanks — feedback recorded' });
  const dnc = useAction(({ contactId, value }) => patch(`/contacts/${contactId}`, { doNotContact: value }), { invalidate: [['opportunity', id]], success: 'Contact preference updated' });
  const findContacts = useAction(() => post(`/opportunities/${id}/find-contacts`), {
    invalidate: [['opportunity', id]],
    success: (r) => (r.queued ? 'Checking the brand\'s website for published contacts' : 'This website was already checked today'),
  });

  if (q.isLoading) return <LoadingCard lines={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const o = q.data;
  const facts = o.rationale.filter((r) => r.kind === 'fact');
  const hyps = o.rationale.filter((r) => r.kind === 'hypothesis');

  const pitchable = !o.excluded && !o.outreachHistory.some((h) => h.status === 'open');

  return (
    <div className="page-stack">
      <PageHead
        back={{ to: '/opportunities', label: 'Find sponsors' }}
        title={<span className="row" style={{ gap: 12 }}><ScoreBadge score={o.excluded ? 0 : o.overallScore} />{o.brand.name}</span>}
        badges={<><DemoBadge show={o.isDemo} label="Demo" />{!o.excluded && <SignalBadge type={o.signalType} />}</>}
        subtitle={[o.brand.industry, o.brand.normalizedDomain, `found ${relative(o.firstDiscoveredAt)}`].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => feedback.mutate('relevant')} aria-pressed={o.feedback?.rating === 'relevant'}>👍 Good match</Button>
            <Button size="sm" variant="ghost" onClick={() => feedback.mutate('not_relevant')} aria-pressed={o.feedback?.rating === 'not_relevant'}>👎 Not for me</Button>
          </>
        }
      />

      <div className="two-col">
        <div className="page-stack">
          <section className="hero-card" aria-label="Why now">
            <div className="eyebrow">Why now</div>
            {facts.map((r, i) => <p key={i} className="strong" style={{ fontSize: 16 }}>{r.text}</p>)}
            {hyps.length > 0 && <p className="small muted">Our read: {hyps.map((r) => r.text).join(' ')}</p>}
            {o.outreachAngle && <div className="callout ai small"><span><strong>Idea for your pitch:</strong> {o.outreachAngle}</span></div>}
            {o.excluded && <div className="callout danger">Not for you: {o.exclusionReason}</div>}
            {o.evidenceStale && <div className="callout warning small">The newest evidence is more than 120 days old. Check it's still true before reaching out.</div>}
          </section>

          <Section title={pitchable ? 'Your pitch' : 'Outreach'} id="pitch">
            <PitchComposer key={o.pitchDraft?.at || 'none'} opp={o} />
          </Section>

          <div>
            <Disclosure title="Why it's a good match" meta={`score ${o.excluded ? 0 : o.overallScore} of 100`}>
              <ScoreFactors factors={o.scoreFactors} />
            </Disclosure>
            <Disclosure title="Evidence" meta={`${o.sourceEvidence.length} source${o.sourceEvidence.length === 1 ? '' : 's'} · ${VERIFICATION_TEXT[o.evidenceStale ? 'stale' : o.verificationStatus] || ''}`}>
              <EvidencePanel evidence={o.sourceEvidence} stale={o.evidenceStale} />
            </Disclosure>
          </div>
        </div>

        <div className="page-stack">
          <Section
            title="Who to contact"
            bodyClass=""
            aside={
              <div className="btn-group">
                {!o.brand.isDemo && <Button size="sm" onClick={() => findContacts.mutate()} loading={findContacts.isPending || o.brand.contactDiscovery?.status === 'queued'}>Find on website</Button>}
                <Button size="sm" onClick={() => setAdding(true)}>Add</Button>
              </div>
            }
          >
            <ContactCheckStatus check={o.brand.contactDiscovery} />
            {!o.contacts.length ? (
              <p className="panel-empty">We never guess email addresses. {o.brand.isDemo ? 'Add a contact you found yourself.' : "Check the brand's own website, or add a contact you found yourself."}</p>
            ) : (
              o.contacts.map((c) => (
                <div key={c._id} className="row-link" style={{ alignItems: 'flex-start' }}>
                  <span className="grow">
                    <span className="strong">{c.name || c.role || humanize(c.roleCategory)}</span>
                    {c.name && c.role && <span className="small muted">{c.role}</span>}
                    <span className="small mono truncate">{c.businessEmail || 'No email'}</span>
                    <span className="row wrap" style={{ marginTop: 4 }}>
                      <ContactIndicator contact={c} />
                      {c.source === 'public_page' && c.sourceUrl && (
                        <a className="tiny" href={c.sourceUrl} target="_blank" rel="noopener noreferrer" title={c.sourceUrl}>Listed on {sourcePath(c.sourceUrl)}</a>
                      )}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => dnc.mutate({ contactId: c._id, value: !c.doNotContact })}>
                    {c.doNotContact ? 'Allow' : 'Never contact'}
                  </Button>
                </div>
              ))
            )}
          </Section>

          <Section title="About the brand">
            <dl className="term-list">
              <div className="term-row"><dt>Industry</dt><dd>{o.brand.industry || '—'}</dd></div>
              <div className="term-row"><dt>Categories</dt><dd>{(o.brand.categories || []).map(humanize).join(', ') || '—'}</dd></div>
              <div className="term-row"><dt>Markets</dt><dd>{(o.brand.markets || []).join(', ') || 'Unknown'}</dd></div>
              {o.productOrCampaign && <div className="term-row"><dt>Product / campaign</dt><dd>{o.productOrCampaign}</dd></div>}
              <div className="term-row"><dt>Website</dt><dd className="truncate">{o.brand.officialWebsite && !o.brand.isDemo ? <a href={o.brand.officialWebsite} target="_blank" rel="noopener noreferrer">{o.brand.normalizedDomain}</a> : o.brand.normalizedDomain}</dd></div>
            </dl>
            {o.brand.brandDescription && <p className="small muted" style={{ marginTop: 10 }}>{o.brand.brandDescription}</p>}
          </Section>

          {o.outreachHistory.length > 0 && (
            <Section title="Your history with them" bodyClass="">
              {o.outreachHistory.map((h) => (
                <Link key={h.dealId} to={`/negotiations/${h.dealId}`} className="row-link">
                  <span className="grow small">{date(h.createdAt)} · {h.conversation?.messageCount || 0} messages</span>
                  <Badge tone={negotiationTone(h.negotiationState)}>{NEGOTIATION_LABELS[h.negotiationState]}</Badge>
                </Link>
              ))}
            </Section>
          )}
        </div>
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a business contact">
        <AddContact oppId={o._id} onDone={() => setAdding(false)} />
      </Modal>
    </div>
  );
}
