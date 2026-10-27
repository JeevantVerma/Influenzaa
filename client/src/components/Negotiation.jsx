import { useState } from 'react';
import { useAction } from '../api/hooks.js';
import { post } from '../api/client.js';
import { Badge, Button, ConfirmDialog, Disclosure, Field, Icon, Modal, MoneyInput } from './ui.jsx';
import { APPROVAL_STATUS, APPROVAL_TEXT, CHECK_LABELS, DELIVERY_LABELS, INTENT_LABELS, dateTime, deliverablesText, humanize, money, relative, splitSignature, toMajor, toMinor } from '../lib/format.js';

// ---- Conversation timeline -----------------------------------------------------------
/** True while a send is in progress or an inbound reply is still being analysed (poll faster). */
export function hasWorkInFlight(messages = []) {
  return messages.some((m) => ['queued', 'sending'].includes(m.deliveryStatus) || ['pending', 'processing'].includes(m.inboundProcessing?.status));
}

export function MessageView({ m, brandName }) {
  const [expanded, setExpanded] = useState(false);
  const d = DELIVERY_LABELS[m.deliveryStatus] || { label: m.deliveryStatus, tone: '' };
  const side = m.direction === 'note' ? 'note' : m.direction === 'inbound' ? 'them' : 'you';
  const draft = m.deliveryStatus === 'draft';
  const who =
    m.direction === 'inbound' ? (m.channel === 'whatsapp' ? brandName || 'Brand' : m.fromAddress || 'Brand')
      : m.direction === 'note' ? 'Your note'
        : draft ? (m.senderType === 'creator' ? 'Your draft' : 'Draft for you')
          : 'You';
  const [body, footer] = m.direction === 'outbound' ? splitSignature(m.content) : [m.content, ''];
  const long = body.length > 700;
  const when = m.sentAt || m.receivedAt || m.createdAt;
  return (
    <article className={`bubble ${side} ${draft ? 'draft' : ''} ${m.deliveryStatus === 'failed' ? 'failed' : ''}`} aria-label={`${who} message`}>
      <div className="bubble-head">
        <span className="strong truncate">{who}</span>
        <span className="tiny faint" title={dateTime(when)}>{relative(when)}</span>
      </div>
      <div className="bubble-tags">
        {m.direction !== 'inbound' && m.direction !== 'note' && <Badge tone={d.tone}>{d.label}</Badge>}
        {m.provenance === 'simulated' && m.direction === 'inbound' && <Badge tone="demo" title="Injected with the demo simulator; not a real email">Simulated reply</Badge>}
        {m.aiGenerated && <Badge tone="ai">Written with AI</Badge>}
        {m.classification?.intent && <Badge tone="info">{INTENT_LABELS[m.classification.intent] || humanize(m.classification.intent)}</Badge>}
        {['pending', 'processing'].includes(m.inboundProcessing?.status) && <Badge tone="info" title="Reading the reply and checking any offer">Reading reply…</Badge>}
        {['failed', 'interrupted'].includes(m.inboundProcessing?.status) && <Badge tone="warning" title={m.inboundProcessing.lastError}>Needs your review</Badge>}
      </div>
      {m.subject && m.direction !== 'note' && <div className="bubble-subject">{m.subject}</div>}
      <div className={`bubble-body ${long && !expanded ? 'clamped' : ''}`}>{body}</div>
      {long && <button type="button" className="link-btn" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Show all'}</button>}
      {footer && <div className="bubble-footer" title={footer}>{m.channel === 'instagram' || m.channel === 'whatsapp' ? '+ one-line note that CreatorOS (AI-assisted) helped' : '+ CreatorOS footer (your name, AI note, unsubscribe line)'}</div>}
      {m.failureReason && m.deliveryStatus === 'failed' && <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>Not sent: {m.failureReason}</div>}
    </article>
  );
}

export function ConversationTimeline({ messages = [], brandName }) {
  if (!messages.length) return <p className="muted small">No messages yet.</p>;
  return <div className="timeline">{messages.map((m) => <MessageView key={m._id} m={m} brandName={brandName} />)}</div>;
}

// ---- Terms comparison ------------------------------------------------------------------
function termRows(t, currency) {
  if (!t) return {};
  const u = t.usageRights || {};
  const ex = t.exclusivity || {};
  return {
    fee: t.paymentType === 'barter' ? `Barter${t.barter?.claimedRetailValueMinor ? ` (claimed ${money(t.barter.claimedRetailValueMinor, currency)})` : ''}` : money(t.totalAmountMinor, t.currency || currency),
    deliverables: deliverablesText(t.deliverables),
    revisions: t.revisionsIncluded ?? '—',
    usage: u.perpetual ? 'Perpetual' : u.durationDays != null ? `${u.durationDays} days${u.paidAds ? ' + paid ads' : ''}${u.whitelisting ? ' + whitelisting' : ''}` : '—',
    exclusivity: ex.required ? `${ex.durationDays ?? '?'} days${ex.scope ? ` (${ex.scope})` : ''}` : ex.required === false ? 'None' : '—',
    payment: t.paymentTerms?.netDays != null ? `Net ${t.paymentTerms.netDays}${t.paymentTerms.advancePercent ? `, ${t.paymentTerms.advancePercent}% advance` : ''}` : '—',
  };
}

/** Their offer next to your counter and your limits. A table on desktop; labelled cards on phones. */
export function TermsComparison({ offer, proposed, policy, currency = 'INR', benchmark, floor }) {
  const o = termRows(offer, currency);
  const p = termRows(proposed, currency);
  const ur = policy?.usageRights || {};
  const pol = {
    fee: benchmark ? `You usually ask ${money(benchmark, currency)}; minimum ${money(floor, currency)}` : 'Add your rates in Settings',
    deliverables: (policy?.acceptedDeliverables || []).length ? `${policy.acceptedDeliverables.length} formats you accept` : '—',
    revisions: `Up to ${policy?.maxRevisions ?? 2}`,
    usage: `${ur.maxUsageDays ?? 90} days${ur.paidAdsAllowed ? ', paid ads negotiable' : ', no paid ads'}${ur.perpetualAllowed ? '' : ', never forever'}`,
    exclusivity: policy?.exclusivity?.acceptable ? `Up to ${policy.exclusivity.maxDays} days, with your OK` : 'You don\'t accept it',
    payment: `Within ${policy?.paymentTerms?.maxNetDays ?? 30} days at most`,
  };
  const rows = [['fee', 'Fee'], ['deliverables', 'What you create'], ['revisions', 'Revisions'], ['usage', 'How they can use it'], ['exclusivity', 'Exclusivity'], ['payment', 'Payment']];
  return (
    <div className="compare">
      <table className="table compare-table">
        <thead>
          <tr><th>Term</th><th>They offered</th>{proposed && <th>You'd ask</th>}<th>Your limits</th></tr>
        </thead>
        <tbody>
          {rows.map(([k, label]) => (
            <tr key={k}>
              <th scope="row">{label}</th>
              <td data-label="They offered" className="num">{o[k] ?? '—'}</td>
              {proposed && <td data-label="You'd ask" className={`num ${p[k] !== o[k] ? 'changed' : ''}`}>{p[k] ?? '—'}</td>}
              <td data-label="Your limits" className="small muted">{pol[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHECK_ICON = { ok: '✓', warning: '!', missing: '?', requires_approval: '◆', violation: '✕' };
/** Each term checked against the creator's limits, in plain words. */
export function PolicyChecks({ checks = [] }) {
  if (!checks.length) return null;
  return (
    <ul className="reason-list">
      {checks.map((c) => (
        <li key={c.code}>
          <span className={`mark ${c.status === 'ok' ? 'good' : c.status === 'violation' ? 'bad' : c.status === 'requires_approval' ? 'info' : 'watch'}`} aria-hidden="true">{CHECK_ICON[c.status] || '·'}</span>
          <span>
            <span className="strong">{c.label}</span> <Badge tone={c.status === 'ok' ? 'success' : c.status === 'violation' ? 'danger' : c.status === 'requires_approval' ? 'info' : 'warning'}>{CHECK_LABELS[c.status] || humanize(c.status)}</Badge>
            <span className="small muted" style={{ display: 'block' }}>{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The fee and conditions an action would propose or accept. */
export function TermsList({ terms: t }) {
  if (!t) return null;
  const cur = t.currency || 'INR';
  return (
    <dl className="term-list">
      <div className="term-row"><dt>Fee</dt><dd className="num money-text">{t.paymentType === 'barter' ? 'Products instead of a fee (barter)' : money(t.totalAmountMinor, cur)}</dd></div>
      <div className="term-row"><dt>What you create</dt><dd>{deliverablesText(t.deliverables) || '—'}</dd></div>
      <div className="term-row"><dt>Revisions</dt><dd>{t.revisionsIncluded != null ? `Up to ${t.revisionsIncluded} round${t.revisionsIncluded === 1 ? '' : 's'}` : '—'}</dd></div>
      <div className="term-row"><dt>How they can use it</dt><dd>{t.usageRights?.perpetual ? 'Forever (perpetual)' : t.usageRights?.durationDays != null ? `${t.usageRights.durationDays} days on their channels` : '—'}{t.usageRights?.paidAds ? ', including paid ads' : ''}{t.usageRights?.whitelisting ? ', including ads from your handle' : ''}</dd></div>
      <div className="term-row"><dt>Exclusivity</dt><dd>{t.exclusivity?.required ? `${t.exclusivity.durationDays} days${t.exclusivity.scope ? ` (${t.exclusivity.scope})` : ''}` : 'None'}</dd></div>
      <div className="term-row"><dt>Payment</dt><dd>{t.paymentTerms?.netDays != null ? `Within ${t.paymentTerms.netDays} days of your invoice${t.paymentTerms.advancePercent ? `, ${t.paymentTerms.advancePercent}% upfront` : ''}` : '—'}</dd></div>
    </dl>
  );
}

/** An outgoing email as the brand will see it; the footer CreatorOS adds is shown separately. */
export function EmailPreview({ to, subject, content, draft = true }) {
  const [body, footer] = splitSignature(content || '');
  return (
    <div className={`email-card ${draft ? 'draft' : ''}`}>
      <div className="email-meta">
        <span className="muted">To <span className="mono">{(to || []).join(', ')}</span></span>
        <span className="email-subject">{subject}</span>
      </div>
      <div className="email-body">
        {body}
        {footer && <div className="email-sig">{footer}</div>}
      </div>
    </div>
  );
}

// ---- Approval card ----------------------------------------------------------------------

export function ApprovalCard({ approval: a, invalidate = [], defaultOpen = true }) {
  const [confirm, setConfirm] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState({ subject: a.proposedAction.subject || '', content: a.proposedAction.content || '', amount: toMajor(a.proposedAction.terms?.totalAmountMinor) });
  const keys = ['approvals', 'dashboard', 'negotiation', 'conversations', 'conversation', ...invalidate];
  const approve = useAction(() => post(`/approvals/${a._id}/approve`, { actionHash: a.actionHash, confirm: a.requiresExplicitConfirmation ? true : undefined }), {
    invalidate: keys,
    success: a.actionType === 'accept_offer' ? 'Approved. Your acceptance is being sent (subject to a written agreement).' : 'Approved and sending',
    onSuccess: () => setConfirm(false),
  });
  const reject = useAction(() => post(`/approvals/${a._id}/reject`, { note: note || undefined }), { invalidate: keys, success: 'Turned down. Nothing will be sent.', onSuccess: () => setRejecting(false) });
  const save = useAction(
    () => post(`/approvals/${a._id}/edit`, { subject: edit.subject, content: edit.content, ...(a.proposedAction.terms && edit.amount !== '' ? { totalAmountMinor: toMinor(edit.amount) } : {}) }),
    { invalidate: keys, success: 'Saved. Check the new version and approve it.', onSuccess: () => setEditing(false) },
  );
  const revoke = useAction(() => post(`/approvals/${a._id}/revoke`), { invalidate: keys, success: 'Stopped. The message will not be sent.' });
  const pending = a.status === 'pending' && !a.isExpired;
  const t = a.proposedAction.terms;
  const cur = t?.currency || 'INR';
  const [open, setOpen] = useState(defaultOpen);
  const status = a.isExpired ? APPROVAL_STATUS.expired : APPROVAL_STATUS[a.status] || { label: humanize(a.status), tone: '' };
  const brand = a.contextSnapshot?.brandName || 'a brand';
  const attention = (a.policyChecks || []).filter((c) => c.status !== 'ok').length;

  return (
    <article className={`approval-card ${pending ? 'pending' : ''}`} id={`approval-${a._id}`}>
      <button type="button" className="approval-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="todo-icon warning" aria-hidden="true"><Icon name={a.actionType === 'send_pitch' ? 'mail' : 'shield'} size={19} className="" /></span>
        <span className="grow">
          <span className="approval-title">{pending ? `${APPROVAL_TEXT[a.actionType] || 'Review a draft for'} ${brand}` : `${a.actionLabel || humanize(a.actionType)} · ${brand}`}</span>
          <span className="row wrap small muted">
            {t && t.paymentType !== 'barter' && <span className="money-text strong num">{money(t.totalAmountMinor, cur)}</span>}
            {pending ? <span>expires {relative(a.expiresAt)}</span> : <Badge tone={status.tone}>{status.label}</Badge>}
            {a.createdBy === 'system' && <Badge tone="info">Sent under your automation rules</Badge>}
            {a.requiresExplicitConfirmation && pending && <Badge tone="danger">Binding commitment</Badge>}
          </span>
        </span>
        <Icon name="chevron" size={18} className={`faint disclosure-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="approval-body">
          {a.executionResult?.error && <div className="callout danger small">This could not be completed: {a.executionResult.error}</div>}
          {a.executionResult?.deliveryStatus === 'simulated' && <div className="callout demo small">Demo mode: the email was recorded as simulated and not delivered.</div>}
          {a.proposedAction.content && (
            <div className="stack sm">
              <div className="eyebrow">{pending ? 'The email that will be sent' : 'The email'}</div>
              <EmailPreview to={a.proposedAction.to} subject={a.proposedAction.subject} content={a.proposedAction.content} draft={pending} />
            </div>
          )}
          {t && (
            <div className="stack sm">
              <div className="eyebrow">{a.actionType === 'accept_offer' ? "What you're accepting" : "What you're proposing"}</div>
              <TermsList terms={t} />
              {a.contextSnapshot?.counterRationale?.length > 0 && (
                <ul className="reason-list">{a.contextSnapshot.counterRationale.map((r) => <li key={r}><span className="mark info" aria-hidden="true">i</span><span className="small">{r}</span></li>)}</ul>
              )}
            </div>
          )}
          <div>
            <Disclosure title="Why this needs your OK" meta={`${a.reasons.length} reason${a.reasons.length === 1 ? '' : 's'}`}>
              <ul className="reason-list">{a.reasons.map((r) => <li key={r.code + r.label}><span className="mark info" aria-hidden="true">i</span><span className="small">{r.label}</span></li>)}</ul>
            </Disclosure>
            {a.policyChecks?.length > 0 && (
              <Disclosure title="Checked against your limits" meta={attention ? `${attention} to look at` : 'all fine'}>
                <PolicyChecks checks={a.policyChecks} />
              </Disclosure>
            )}
            {a.contextSnapshot?.lastInboundExcerpt && (
              <Disclosure title="The brand's last message">
                <div className="email-card"><div className="email-body small">{a.contextSnapshot.lastInboundExcerpt}</div></div>
              </Disclosure>
            )}
          </div>
          <div className="tiny faint" title={`Version ${a.actionHash}`}>
            Drafted {dateTime(a.createdAt)}{a.editHistory?.length > 0 && ` · edited ${a.editHistory.length}×`}{a.reviewedAt && ` · reviewed ${dateTime(a.reviewedAt)}`}{a.executedAt && ` · done ${dateTime(a.executedAt)}`}
          </div>
        </div>
      )}
      {(pending || (a.status === 'approved' && a.executionStatus === 'queued')) && (
        <div className="action-bar sticky approval-actions">
          {pending ? (
            <>
              <Button variant="ghost" className="danger" onClick={() => setRejecting(true)}>Turn down</Button>
              {a.proposedAction.content && <Button onClick={() => setEditing(true)}>Edit</Button>}
              <Button variant="primary" icon="check" onClick={() => setConfirm(true)}>{a.actionType === 'accept_offer' ? 'Accept…' : 'Approve & send…'}</Button>
            </>
          ) : (
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>Stop before it sends</Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={a.actionType === 'accept_offer' ? `Accept ${brand}'s offer?` : `Send this to ${brand}?`}
        confirmLabel={a.actionType === 'accept_offer' ? 'Accept and send' : 'Approve and send'}
        loading={approve.isPending}
        onConfirm={() => approve.mutate()}
        requireCheck={a.requiresExplicitConfirmation ? 'I accept these terms, subject to a written agreement.' : undefined}
      >
        <p>You're approving exactly what's shown. If the brand changes their offer before it goes out, it won't be sent.</p>
        {t && <p className="strong">{money(t.totalAmountMinor, cur)} · {deliverablesText(t.deliverables)}</p>}
      </ConfirmDialog>
      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Turn this down?" footer={<><Button onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger solid" loading={reject.isPending} onClick={() => reject.mutate()}>Turn down</Button></>}>
        <p className="small muted" style={{ marginBottom: 8 }}>Nothing will be sent to the brand.</p>
        <Field label="Note to yourself (optional)">{(p) => <textarea {...p} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
      </Modal>
      <Modal wide open={editing} onClose={() => setEditing(false)} title="Edit before approving" footer={<><Button onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save new version</Button></>}>
        <div className="stack">
          <p className="small muted">Saving creates a new version for you to approve.</p>
          {t && <Field label="Fee" hint="You can go below your minimum; we'll just flag it.">{(p) => <MoneyInput {...p} currency={cur} value={edit.amount} onChange={(x) => setEdit({ ...edit, amount: x })} />}</Field>}
          <Field label="Subject">{(p) => <input {...p} className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />}</Field>
          <Field label="Message">{(p) => <textarea {...p} className="textarea" rows={12} value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} />}</Field>
        </div>
      </Modal>
    </article>
  );
}
