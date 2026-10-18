import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, useAction } from '../api/hooks.js';
import { post } from '../api/client.js';
import { ConversationTimeline } from '../components/Negotiation.jsx';
import { Badge, Button, Card, ConfirmDialog, DemoBadge, EmptyState, ErrorState, Field, LoadingCard, Modal, Toggle } from '../components/ui.jsx';
import { NEGOTIATION_LABELS, negotiationTone, relative, dateTime, humanize } from '../lib/format.js';

const SAMPLE_REPLIES = [
  { label: 'Offer (below your rate)', text: 'Hi! Thanks for reaching out. We would like to offer ₹18,000 for 1 Instagram reel and 2 stories. Usage rights for 6 months. Payment net 45. 3 rounds of revisions.' },
  { label: 'Asks for rates', text: 'Hi, this sounds interesting! Could you share your rate card and media kit?' },
  { label: 'Positive, no terms', text: "Love your content! We're interested — let's discuss what a collaboration could look like." },
  { label: 'Barter offer', text: 'We can send you our new product hamper worth ₹6,000 in exchange for 1 reel. Barter only for now.' },
  { label: 'Declines', text: "Thanks, but we're not interested at this time." },
  { label: 'Opts out', text: 'Please unsubscribe us and do not contact us again.' },
];

function SimulateReply({ conversation, onClose }) {
  const [text, setText] = useState(SAMPLE_REPLIES[0].text);
  const sim = useAction(() => post(`/conversations/${conversation._id}/simulate-inbound`, { text }), {
    invalidate: ['conversation', 'conversations', 'approvals', 'dashboard', 'negotiation'],
    success: (r) => `Simulated reply processed${r.intent ? ` (intent: ${humanize(r.intent)})` : ''}`,
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Simulate a brand reply (demo)"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={sim.isPending} onClick={() => sim.mutate()}>Inject simulated reply</Button></>}
    >
      <div className="stack">
        <div className="callout demo small">This injects a clearly labelled <strong>simulated</strong> inbound email through the real pipeline (matching, de-duplication, classification, offer analysis). It is not a real message from the brand.</div>
        <div className="chips">
          {SAMPLE_REPLIES.map((s) => <button key={s.label} type="button" className="chip" aria-pressed={text === s.text} onClick={() => setText(s.text)}>{s.label}</button>)}
        </div>
        <Field label="Reply text">{(p) => <textarea {...p} className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function ConversationPane({ id }) {
  const q = useApi(['conversation', id], `/conversations/${id}`, { refetchInterval: (query) => (query.state.data?.messages?.some((m) => ['queued', 'sending'].includes(m.deliveryStatus)) ? 3000 : 20_000) });
  const integrations = useApi('integrations', '/integrations');
  const [composing, setComposing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState({ subject: '', content: '' });
  const [confirmSend, setConfirmSend] = useState(false);
  const inv = ['conversation', 'conversations', 'approvals', 'dashboard'];
  const draft = useAction(() => post(`/conversations/${id}/draft-response`, {}), { invalidate: inv, success: (r) => (r.autoAuthorized ? 'Reply queued under your rules' : 'AI draft created — review it in Approvals') });
  const takeover = useAction((enabled) => post(`/conversations/${id}/takeover`, { enabled }), { invalidate: inv, success: (r) => (r.humanTakeover ? 'You have taken over. AI drafting and follow-ups are paused here.' : 'Handed back to CreatorOS') });
  const addNote = useAction(() => post(`/conversations/${id}/notes`, { content: note }), { invalidate: inv, success: 'Note added', onSuccess: () => { setNote(''); setNoteOpen(false); } });
  const send = useAction(() => post(`/conversations/${id}/send-message`, { ...msg, confirm: true }), { invalidate: inv, success: 'Message queued for sending', onSuccess: () => { setComposing(false); setConfirmSend(false); setMsg({ subject: '', content: '' }); } });
  const cancelFu = useAction(() => post(`/conversations/${id}/cancel-follow-up`), { invalidate: inv, success: 'Follow-up cancelled' });

  if (q.isLoading) return <LoadingCard lines={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const c = q.data;
  const brandP = c.participants.find((p) => p.side === 'brand');
  const demo = integrations.data?.demoFeaturesEnabled;
  return (
    <div className="stack">
      <Card
        title={
          <div className="stack sm">
            <div className="row wrap"><h2>{c.brand?.name}</h2><DemoBadge show={c.brand?.isDemo} /><Badge tone="info">{c.channel}</Badge>{c.deal && <Badge tone={negotiationTone(c.deal.negotiationState)}>{NEGOTIATION_LABELS[c.deal.negotiationState]}</Badge>}{c.status !== 'open' && <Badge tone="warning">{humanize(c.status)}</Badge>}</div>
            <span className="small muted">{brandP?.name} · {brandP?.role} · <span className="mono">{brandP?.email}</span></span>
          </div>
        }
        actions={c.deal && <Link className="btn sm" to={`/negotiations/${c.dealId}`}>Negotiation workspace</Link>}
      >
        <div className="stack">
          {c.pendingApprovals.length > 0 && <div className="callout warning small"><span className="grow">{c.pendingApprovals.length} action(s) awaiting your approval for this conversation.</span><Link to="/approvals">Review</Link></div>}
          {c.humanTakeover && <div className="callout info small">You've taken over this conversation. CreatorOS won't draft replies or send follow-ups here until you hand it back.</div>}
          {c.status === 'moved_offplatform' && <div className="callout warning small">This conversation moved to {humanize(c.offPlatformChannel)}, which CreatorOS cannot see. Log updates as notes.</div>}
          {c.nextFollowUpAt && <div className="callout small"><span className="grow">Follow-up scheduled {dateTime(c.nextFollowUpAt)} (drafted for approval unless you enabled auto-send).</span><Button size="sm" onClick={() => cancelFu.mutate()} loading={cancelFu.isPending}>Cancel follow-up</Button></div>}
          {!c.nextFollowUpAt && c.followUpSuppressedReason && <div className="tiny faint">Follow-ups stopped: {humanize(c.followUpSuppressedReason)}</div>}
          <div className="btn-group">
            <Button icon="sparkle" onClick={() => draft.mutate()} loading={draft.isPending} disabled={c.status !== 'open' || c.humanTakeover}>Draft AI reply</Button>
            <Button icon="mail" onClick={() => setComposing(true)} disabled={c.status !== 'open'}>Write message</Button>
            <Button onClick={() => setNoteOpen(true)}>Add note</Button>
            {demo && c.status === 'open' && <Button onClick={() => setSimulating(true)}>Simulate brand reply</Button>}
          </div>
          <Toggle checked={c.humanTakeover} onChange={(v) => takeover.mutate(v)} label="Human takeover" description="Pause AI drafting and follow-ups for this conversation." />
        </div>
      </Card>
      <ConversationTimeline messages={c.messages} />
      {simulating && <SimulateReply conversation={c} onClose={() => setSimulating(false)} />}
      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="Add a manual note" footer={<><Button onClick={() => setNoteOpen(false)}>Cancel</Button><Button variant="primary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>Save note</Button></>}>
        <p className="small muted" style={{ marginBottom: 8 }}>Notes are for your records (e.g. a phone call). They are never shown as verified external messages.</p>
        <textarea className="textarea" aria-label="Note" rows={5} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
      <Modal wide open={composing} onClose={() => setComposing(false)} title="Write a message" footer={<><Button onClick={() => setComposing(false)}>Cancel</Button><Button variant="primary" disabled={!msg.subject.trim() || msg.content.trim().length < 5} onClick={() => setConfirmSend(true)}>Send…</Button></>}>
        <div className="stack">
          <Field label="Subject">{(p) => <input {...p} className="input" value={msg.subject} onChange={(e) => setMsg({ ...msg, subject: e.target.value })} placeholder={`Re: ${c.subject || ''}`} />}</Field>
          <Field label="Message" hint="Your words, sent as written. The CreatorOS disclosure line is appended.">{(p) => <textarea {...p} className="textarea" rows={10} value={msg.content} onChange={(e) => setMsg({ ...msg, content: e.target.value })} />}</Field>
        </div>
      </Modal>
      <ConfirmDialog open={confirmSend} onClose={() => setConfirmSend(false)} title="Send this message?" confirmLabel="Send" loading={send.isPending} onConfirm={() => send.mutate()}>
        <p>This sends your message to <span className="mono">{brandP?.email}</span>{integrations.data?.email?.mode === 'demo' ? ' — in demo mode it will be recorded as simulated, not delivered.' : '.'}</p>
      </ConfirmDialog>
    </div>
  );
}

export default function InboxPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('conversation');
  const q = useApi(['conversations', 'list'], '/conversations?limit=100', { refetchInterval: 20_000 });
  return (
    <div className="stack lg">
      <div className="page-header">
        <div>
          <h1>Unified inbox</h1>
          <p>Every sponsorship conversation in one place. Drafts, sent, simulated and failed messages are always labelled.</p>
        </div>
      </div>
      {q.isLoading ? (
        <LoadingCard />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data.items.length ? (
        <div className="card"><EmptyState title="No conversations yet" icon="inbox" action={<Link className="btn primary" to="/opportunities">Find sponsors</Link>}>Start outreach from an opportunity. Replies from brands land here.</EmptyState></div>
      ) : (
        <div className="split" style={{ gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="list" role="list">
              {q.data.items.map((c) => (
                <button
                  key={c._id}
                  role="listitem"
                  className="list-item"
                  style={{ background: c._id === selected ? 'var(--primary-soft)' : 'transparent', border: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%', alignItems: 'flex-start', color: 'inherit' }}
                  onClick={() => setParams({ conversation: c._id })}
                  aria-current={c._id === selected ? 'true' : undefined}
                >
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row">
                      <span className={`truncate ${c.unreadInbound ? 'strong' : ''}`}>{c.brand?.name}</span>
                      {c.unreadInbound > 0 && <span className="dot" style={{ color: 'var(--primary)' }} aria-label="Unread" />}
                      <span className="grow" />
                      <span className="tiny faint">{relative(c.lastMessageAt || c.updatedAt)}</span>
                    </div>
                    <div className="small muted truncate">{c.lastMessage ? `${c.lastMessage.direction === 'inbound' ? '' : 'You: '}${c.lastMessage.content}` : 'No messages'}</div>
                    <div className="row wrap" style={{ marginTop: 4 }}>
                      {c.deal && <Badge tone={negotiationTone(c.deal.negotiationState)}>{NEGOTIATION_LABELS[c.deal.negotiationState]}</Badge>}
                      {c.pendingApprovals > 0 && <Badge tone="warning">{c.pendingApprovals} to approve</Badge>}
                      {c.isDemo && <Badge tone="demo">Demo</Badge>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>{selected ? <ConversationPane key={selected} id={selected} /> : <div className="card"><EmptyState title="Select a conversation" icon="inbox" /></div>}</div>
        </div>
      )}
    </div>
  );
}
