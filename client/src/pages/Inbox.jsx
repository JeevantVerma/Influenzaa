import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, useAction } from '../api/hooks.js';
import { post } from '../api/client.js';
import { ConversationTimeline, hasWorkInFlight } from '../components/Negotiation.jsx';
import { Badge, Button, ConfirmDialog, DemoBadge, Disclosure, EmptyState, ErrorState, Field, Icon, LoadingCard, Modal, PageHead, Toggle } from '../components/ui.jsx';
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
    success: (r) => (r.matched === false ? 'The simulated reply did not match this conversation' : 'Simulated reply received. It is being analysed in the background.'),
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

/** Instagram: the unsent DM pitch (the creator sends it), or the 24-hour reply window. */
function InstagramStatus({ c, onSent, sending }) {
  const pitch = c.messages.find((m) => m.purpose === 'pitch' && m.deliveryStatus === 'draft');
  const brand = c.participants.find((p) => p.side === 'brand');
  const [copied, setCopied] = useState(false);
  if (pitch) {
    const copyAndOpen = async () => {
      try {
        await navigator.clipboard.writeText(pitch.content);
        setCopied(true);
      } catch {
        setCopied(false);
      }
      window.open(`https://ig.me/m/${brand?.username}`, '_blank', 'noopener');
    };
    return (
      <div className="callout warning small">
        <span className="grow">Instagram doesn't let apps send the first message. Send this DM yourself, then mark it sent; CreatorOS picks up their reply and takes over.{copied && ' Copied: paste it in Instagram.'}</span>
        <span className="row wrap">
          <Button size="sm" variant="primary" onClick={copyAndOpen}>Copy and open Instagram</Button>
          <Button size="sm" loading={sending} onClick={onSent}>I've sent it</Button>
        </span>
      </div>
    );
  }
  if (!c.replyWindow?.closesAt) return null;
  return c.replyWindow.open ? (
    <div className="callout info small">Instagram lets you reply until {dateTime(c.replyWindow.closesAt)} ({relative(c.replyWindow.closesAt)}). Each new message from the brand restarts this 24-hour window.</div>
  ) : (
    <div className="callout warning small">Instagram's 24-hour reply window has closed. Reply from the Instagram app yourself; CreatorOS can reply again after the brand's next message.</div>
  );
}

function ConversationPane({ id }) {
  const q = useApi(['conversation', id], `/conversations/${id}`, { refetchInterval: (query) => (hasWorkInFlight(query.state.data?.messages) ? 3000 : 20_000) });
  const integrations = useApi('integrations', '/integrations');
  const [composing, setComposing] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState({ subject: '', content: '' });
  const [confirmSend, setConfirmSend] = useState(false);
  const inv = ['conversation', 'conversations', 'approvals', 'dashboard'];
  const markDmSent = useAction(() => post(`/conversations/${id}/instagram-pitch-sent`), { invalidate: inv, success: 'Marked as sent. Their reply will appear here.' });
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
    <div className="page-stack">
      <div className="convo-head">
        <Link to="/inbox" className="back-link"><Icon name="chevron" size={16} className="flip" /> All conversations</Link>
        <div className="row wrap">
          <h2 className="convo-title">{c.brand?.name}</h2>
          <DemoBadge show={c.brand?.isDemo} label="Demo" />
          {c.deal && <Badge tone={negotiationTone(c.deal.negotiationState)}>{NEGOTIATION_LABELS[c.deal.negotiationState]}</Badge>}
          {c.status !== 'open' && <Badge tone="warning">{humanize(c.status)}</Badge>}
        </div>
        <span className="small muted">
          {c.channel === 'instagram' ? <>Instagram DM{brandP?.username && <> · <a href={`https://www.instagram.com/${brandP.username}/`} target="_blank" rel="noopener noreferrer">@{brandP.username}</a></>}</> : [brandP?.name, brandP?.role].filter(Boolean).join(' · ')}
          {brandP?.email && <> · <span className="mono">{brandP.email}</span></>}
        </span>
        {c.channel === 'instagram' && <InstagramStatus c={c} onSent={() => markDmSent.mutate()} sending={markDmSent.isPending} />}
        {c.pendingApprovals.length > 0 && (
          <div className="callout warning small"><span className="grow">{c.pendingApprovals.length} draft{c.pendingApprovals.length > 1 ? 's' : ''} waiting for your OK.</span><Link className="btn sm" to="/approvals">Review</Link></div>
        )}
        {c.humanTakeover && <div className="callout info small">You're handling this conversation yourself. CreatorOS won't draft replies or send follow-ups here until you hand it back.</div>}
        {c.status === 'moved_offplatform' && <div className="callout warning small">This conversation moved to {humanize(c.offPlatformChannel)}, which CreatorOS can't see. Add notes to keep track.</div>}
        <div className="btn-group">
          <Button variant="primary" icon="sparkle" onClick={() => draft.mutate()} loading={draft.isPending} disabled={c.status !== 'open' || c.humanTakeover}>Draft a reply</Button>
          <Button icon="mail" onClick={() => setComposing(true)} disabled={c.status !== 'open'}>Write it myself</Button>
          <Button onClick={() => setNoteOpen(true)}>Add note</Button>
          {c.deal && <Link className="btn" to={`/negotiations/${c.dealId}`}>Open deal</Link>}
          {demo && c.status === 'open' && <Button variant="ghost" onClick={() => setSimulating(true)}>Simulate brand reply</Button>}
        </div>
      </div>

      <ConversationTimeline messages={c.messages} />

      <Disclosure title="Conversation settings" meta={c.nextFollowUpAt ? `follow-up ${relative(c.nextFollowUpAt)}` : c.humanTakeover ? 'you are handling it' : null}>
        <div className="stack">
          <Toggle checked={c.humanTakeover} onChange={(v) => takeover.mutate(v)} label="I'll handle this myself" description="Stops AI drafts and automatic follow-ups for this conversation." />
          {c.nextFollowUpAt ? (
            <div className="row wrap small"><span className="grow">A follow-up is planned for {dateTime(c.nextFollowUpAt)}. It waits for your OK unless you turned on automatic follow-ups.</span><Button size="sm" onClick={() => cancelFu.mutate()} loading={cancelFu.isPending}>Cancel follow-up</Button></div>
          ) : c.followUpSuppressedReason ? (
            <p className="small muted">Follow-ups stopped: {humanize(c.followUpSuppressedReason)}.</p>
          ) : null}
        </div>
      </Disclosure>
      {simulating && <SimulateReply conversation={c} onClose={() => setSimulating(false)} />}
      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="Add a manual note" footer={<><Button onClick={() => setNoteOpen(false)}>Cancel</Button><Button variant="primary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>Save note</Button></>}>
        <p className="small muted" style={{ marginBottom: 8 }}>A private note for your records, like what was said on a call. The brand never sees it.</p>
        <textarea className="textarea" aria-label="Note" rows={5} value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
      <Modal wide open={composing} onClose={() => setComposing(false)} title="Write a message" footer={<><Button onClick={() => setComposing(false)}>Cancel</Button><Button variant="primary" disabled={!msg.subject.trim() || msg.content.trim().length < 5} onClick={() => setConfirmSend(true)}>Send…</Button></>}>
        <div className="stack">
          <Field label="Subject">{(p) => <input {...p} className="input" value={msg.subject} onChange={(e) => setMsg({ ...msg, subject: e.target.value })} placeholder={`Re: ${c.subject || ''}`} />}</Field>
          <Field label="Message" hint="Sent as you wrote it. Your name and the CreatorOS note are added at the end.">{(p) => <textarea {...p} className="textarea" rows={10} value={msg.content} onChange={(e) => setMsg({ ...msg, content: e.target.value })} />}</Field>
        </div>
      </Modal>
      <ConfirmDialog open={confirmSend} onClose={() => setConfirmSend(false)} title={`Send this to ${c.brand?.name || 'the brand'}?`} confirmLabel="Send" loading={send.isPending} onConfirm={() => send.mutate()}>
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
    <div className={`inbox ${selected ? 'has-selection' : ''}`}>
      <PageHead title="Inbox" subtitle="Every brand conversation in one place. Drafts, demo and failed messages are always marked." />
      {q.isLoading ? (
        <LoadingCard />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data.items.length ? (
        <div className="card"><EmptyState title="No conversations yet" icon="inbox" action={<Link className="btn primary" to="/opportunities">Find sponsors</Link>}>Pitch a brand and their replies land here.</EmptyState></div>
      ) : (
        <div className="inbox-split">
          <nav className="inbox-list card" aria-label="Conversations">
            {q.data.items.map((c) => (
              <button
                key={c._id}
                type="button"
                className={`inbox-item ${c._id === selected ? 'active' : ''}`}
                onClick={() => setParams({ conversation: c._id })}
                aria-current={c._id === selected ? 'true' : undefined}
              >
                <span className="row">
                  <span className={`grow truncate ${c.unreadInbound ? 'strong' : ''}`} style={{ fontWeight: 650 }}>{c.brand?.name}</span>
                  {c.channel === 'instagram' && <Badge tone="info">DM</Badge>}
                  {c.unreadInbound > 0 && <span className="unread-dot" aria-label="Unread" />}
                  <span className="tiny faint">{relative(c.lastMessageAt || c.updatedAt)}</span>
                </span>
                <span className="small muted line-clamp">{c.lastMessage ? `${c.lastMessage.direction === 'inbound' ? '' : 'You: '}${c.lastMessage.content}` : 'No messages'}</span>
                <span className="row wrap">
                  {c.deal && <Badge tone={negotiationTone(c.deal.negotiationState)}>{NEGOTIATION_LABELS[c.deal.negotiationState]}</Badge>}
                  {c.pendingApprovals > 0 && <Badge tone="warning">{c.pendingApprovals} to approve</Badge>}
                  {c.isDemo && <Badge tone="demo">Demo</Badge>}
                </span>
              </button>
            ))}
          </nav>
          <div className="inbox-pane">{selected ? <ConversationPane key={selected} id={selected} /> : <div className="card"><EmptyState title="Pick a conversation" icon="inbox" /></div>}</div>
        </div>
      )}
    </div>
  );
}
