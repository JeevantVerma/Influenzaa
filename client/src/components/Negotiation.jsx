import { useState } from 'react';
import { useAction } from '../api/hooks.js';
import { post } from '../api/client.js';
import { Badge, Button, ConfirmDialog, Field, Modal, MoneyInput } from './ui.jsx';
import { DELIVERY_LABELS, dateTime, deliverablesText, humanize, money, relative, toMajor, toMinor } from '../lib/format.js';

// ---- Conversation timeline -----------------------------------------------------------
export function MessageView({ m }) {
  const d = DELIVERY_LABELS[m.deliveryStatus] || { label: m.deliveryStatus, tone: '' };
  const cls = m.direction === 'note' ? 'note' : m.deliveryStatus === 'draft' ? 'draft' : m.deliveryStatus === 'failed' ? 'failed' : m.direction;
  const who =
    m.direction === 'inbound' ? m.fromAddress || 'Brand'
      : m.direction === 'note' ? 'Your note'
        : m.deliveryStatus === 'draft' ? (m.senderType === 'creator' ? 'Your draft' : 'AI draft for you')
          : 'You, via CreatorOS';
  return (
    <article className={`msg ${cls}`} aria-label={`${m.direction} message`}>
      <div className="msg-head small">
        <span className="strong">{who}</span>
        <Badge tone={d.tone}>{d.label}</Badge>
        {m.provenance === 'simulated' && m.direction === 'inbound' && <Badge tone="demo" title="Injected with the demo simulator; not a real email">Simulated reply</Badge>}
        {m.aiGenerated && <Badge tone="ai">AI-written · {m.aiProvider}</Badge>}
        {m.classification?.intent && <Badge tone="info">Intent: {humanize(m.classification.intent)}</Badge>}
        {m.approvalStatus && !['not_required'].includes(m.approvalStatus) && m.direction === 'outbound' && <span className="tiny faint">approval: {humanize(m.approvalStatus)}</span>}
        <span className="grow" />
        <span className="tiny faint" title={dateTime(m.sentAt || m.receivedAt || m.createdAt)}>{relative(m.sentAt || m.receivedAt || m.createdAt)}</span>
      </div>
      {m.subject && m.direction !== 'note' && <div className="small strong" style={{ padding: '8px 12px 0' }}>{m.subject}</div>}
      <div className="msg-body">{m.content}</div>
      {m.failureReason && m.deliveryStatus === 'failed' && <div className="small" style={{ padding: '0 12px 10px', color: 'var(--danger)' }}>Not sent: {m.failureReason}</div>}
    </article>
  );
}

export function ConversationTimeline({ messages = [] }) {
  if (!messages.length) return <p className="muted small">No messages yet.</p>;
  return <div className="timeline">{messages.map((m) => <MessageView key={m._id} m={m} />)}</div>;
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

export function TermsComparison({ offer, proposed, policy, currency = 'INR', benchmark, floor }) {
  const o = termRows(offer, currency);
  const p = termRows(proposed, currency);
  const ur = policy?.usageRights || {};
  const pol = {
    fee: benchmark ? `Preferred ${money(benchmark, currency)} · floor ${money(floor, currency)}` : 'Set rates in Settings',
    deliverables: (policy?.acceptedDeliverables || []).length ? `${policy.acceptedDeliverables.length} accepted types` : '—',
    revisions: `Up to ${policy?.maxRevisions ?? 2}`,
    usage: `${ur.maxUsageDays ?? 90} days${ur.paidAdsAllowed ? ', paid ads negotiable' : ', no paid ads'}${ur.perpetualAllowed ? '' : ', no perpetual'}`,
    exclusivity: policy?.exclusivity?.acceptable ? `Up to ${policy.exclusivity.maxDays} days (approval)` : 'Not accepted',
    payment: `Net ${policy?.paymentTerms?.maxNetDays ?? 30} max`,
  };
  const rows = [['fee', 'Compensation'], ['deliverables', 'Deliverables'], ['revisions', 'Revisions'], ['usage', 'Usage rights'], ['exclusivity', 'Exclusivity'], ['payment', 'Payment terms']];
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Term</th><th>Brand offer</th>{proposed && <th>Proposed</th>}<th>Your boundaries</th></tr>
        </thead>
        <tbody>
          {rows.map(([k, label]) => (
            <tr key={k}>
              <td className="strong">{label}</td>
              <td className="num">{o[k] ?? '—'}</td>
              {proposed && <td className="num" style={{ color: p[k] !== o[k] ? 'var(--primary)' : undefined, fontWeight: p[k] !== o[k] ? 600 : undefined }}>{p[k] ?? '—'}</td>}
              <td className="small muted">{pol[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHECK_ICON = { ok: '✓', warning: '!', missing: '?', requires_approval: '◆', violation: '✕' };
export function PolicyChecks({ checks = [] }) {
  if (!checks.length) return null;
  return (
    <div>
      {checks.map((c) => (
        <div className="check-row" key={c.code}>
          <span className={`check-icon ${c.status}`} aria-label={humanize(c.status)}>{CHECK_ICON[c.status] || '·'}</span>
          <span className="strong small">{c.label}</span>
          <span className="small">{c.detail} <span className="tiny faint">({humanize(c.status)})</span></span>
        </div>
      ))}
    </div>
  );
}

// ---- Approval card ----------------------------------------------------------------------
const STATUS_TONE = { pending: 'warning', approved: 'info', executed: 'success', rejected: '', expired: '', superseded: '', revoked: '', failed: 'danger' };

export function ApprovalCard({ approval: a, invalidate = [], defaultOpen = true }) {
  const [confirm, setConfirm] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [edit, setEdit] = useState({ subject: a.proposedAction.subject || '', content: a.proposedAction.content || '', amount: toMajor(a.proposedAction.terms?.totalAmountMinor) });
  const keys = ['approvals', 'dashboard', 'negotiation', 'conversations', 'conversation', ...invalidate];
  const approve = useAction(() => post(`/approvals/${a._id}/approve`, { actionHash: a.actionHash, confirm: a.requiresExplicitConfirmation ? true : undefined }), {
    invalidate: keys,
    success: a.actionType === 'accept_offer' ? 'Approved. Acceptance queued (subject to written agreement).' : 'Approved and queued',
    onSuccess: () => setConfirm(false),
  });
  const reject = useAction(() => post(`/approvals/${a._id}/reject`, { note: note || undefined }), { invalidate: keys, success: 'Rejected — nothing will be sent', onSuccess: () => setRejecting(false) });
  const save = useAction(
    () => post(`/approvals/${a._id}/edit`, { subject: edit.subject, content: edit.content, ...(a.proposedAction.terms && edit.amount !== '' ? { totalAmountMinor: toMinor(edit.amount) } : {}) }),
    { invalidate: keys, success: 'Edit saved. Review and approve the new version.', onSuccess: () => setEditing(false) },
  );
  const revoke = useAction(() => post(`/approvals/${a._id}/revoke`), { invalidate: keys, success: 'Revoked — the message will not be sent' });
  const pending = a.status === 'pending' && !a.isExpired;
  const t = a.proposedAction.terms;
  const cur = t?.currency || 'INR';
  const [open, setOpen] = useState(defaultOpen);

  return (
    <article className="card" id={`approval-${a._id}`}>
      <div className="card-header">
        <div className="row wrap grow">
          <h3>{a.actionLabel || humanize(a.actionType)}</h3>
          {a.contextSnapshot?.brandName && <span className="muted">· {a.contextSnapshot.brandName}</span>}
          <Badge tone={STATUS_TONE[a.status]}>{a.isExpired ? 'Expired' : humanize(a.status)}</Badge>
          {a.createdBy === 'system' && <Badge tone="info">Auto-authorised by your rules</Badge>}
          {a.requiresExplicitConfirmation && pending && <Badge tone="danger">Material commitment</Badge>}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Collapse' : 'Expand'}</Button>
      </div>
      {open && (
        <div className="card-body stack">
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>Why approval is required</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {a.reasons.map((r) => <li key={r.code + r.label}>{r.label}</li>)}
            </ul>
          </div>
          {t && (
            <div>
              <div className="section-title" style={{ marginBottom: 6 }}>Terms that will be {a.actionType === 'accept_offer' ? 'accepted' : 'proposed'}</div>
              <dl className="kv small">
                <dt>Fee</dt><dd className="num strong">{t.paymentType === 'barter' ? 'Barter' : money(t.totalAmountMinor, cur)}</dd>
                <dt>Deliverables</dt><dd>{deliverablesText(t.deliverables)}</dd>
                <dt>Revisions</dt><dd>{t.revisionsIncluded ?? '—'}</dd>
                <dt>Usage</dt><dd>{t.usageRights?.perpetual ? 'Perpetual' : `${t.usageRights?.durationDays ?? '—'} days`}{t.usageRights?.paidAds ? ' · paid ads' : ''}{t.usageRights?.whitelisting ? ' · whitelisting' : ''}</dd>
                <dt>Exclusivity</dt><dd>{t.exclusivity?.required ? `${t.exclusivity.durationDays} days` : 'None'}</dd>
                <dt>Payment</dt><dd>{t.paymentTerms?.netDays != null ? `Net ${t.paymentTerms.netDays}` : '—'}</dd>
              </dl>
              {a.contextSnapshot?.counterRationale?.length > 0 && (
                <ul className="small muted" style={{ marginTop: 8, paddingLeft: 18 }}>{a.contextSnapshot.counterRationale.map((r) => <li key={r}>{r}</li>)}</ul>
              )}
            </div>
          )}
          {a.policyChecks?.length > 0 && (
            <details>
              <summary className="small strong" style={{ cursor: 'pointer' }}>Policy checks ({a.policyChecks.filter((c) => c.status !== 'ok').length} need attention)</summary>
              <PolicyChecks checks={a.policyChecks} />
            </details>
          )}
          {a.proposedAction.content && (
            <div>
              <div className="section-title" style={{ marginBottom: 6 }}>Exact message that will be sent</div>
              <div className="msg draft" style={{ maxWidth: 'none' }}>
                <div className="msg-head small">
                  <span>To: <span className="mono">{(a.proposedAction.to || []).join(', ')}</span></span>
                </div>
                <div className="small strong" style={{ padding: '8px 12px 0' }}>{a.proposedAction.subject}</div>
                <div className="msg-body">{a.proposedAction.content}</div>
              </div>
            </div>
          )}
          {a.contextSnapshot?.lastInboundExcerpt && (
            <details>
              <summary className="small strong" style={{ cursor: 'pointer' }}>Brand's latest message</summary>
              <div className="msg inbound small" style={{ marginTop: 8 }}><div className="msg-body">{a.contextSnapshot.lastInboundExcerpt}</div></div>
            </details>
          )}
          <div className="tiny faint">
            Created {dateTime(a.createdAt)}{pending && ` · expires ${relative(a.expiresAt)}`}{a.reviewedAt && ` · reviewed ${dateTime(a.reviewedAt)}`}{a.executedAt && ` · executed ${dateTime(a.executedAt)}`}
            {a.editHistory?.length > 0 && ` · edited ${a.editHistory.length}×`} · version <span className="mono">{a.actionHash.slice(0, 10)}</span>
          </div>
          {a.executionResult?.error && <div className="callout danger small">Execution failed: {a.executionResult.error}</div>}
          {a.executionResult?.deliveryStatus === 'simulated' && <div className="callout demo small">Executed in demo mode: the message was recorded as simulated and not delivered.</div>}
        </div>
      )}
      {(pending || (a.status === 'approved' && a.executionStatus === 'queued')) && (
        <div className="card-footer row wrap" style={{ justifyContent: 'flex-end' }}>
          {pending ? (
            <>
              <Button variant="danger" onClick={() => setRejecting(true)}>Reject</Button>
              {a.proposedAction.content && <Button onClick={() => setEditing(true)}>Edit</Button>}
              <Button variant="primary" icon="check" onClick={() => setConfirm(true)}>Approve…</Button>
            </>
          ) : (
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>Revoke before sending</Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={a.actionType === 'accept_offer' ? 'Accept this offer?' : 'Approve this action?'}
        confirmLabel={a.actionType === 'accept_offer' ? 'Accept and send' : 'Approve and send'}
        loading={approve.isPending}
        onConfirm={() => approve.mutate()}
        requireCheck={a.requiresExplicitConfirmation ? 'I confirm I accept these terms, subject to a written agreement.' : undefined}
      >
        <p>You are approving exactly the version shown (<span className="mono">{a.actionHash.slice(0, 10)}</span>). If the brand's offer changes before it runs, it will be blocked automatically.</p>
        {t && <p className="strong">{money(t.totalAmountMinor, cur)} · {deliverablesText(t.deliverables)}</p>}
      </ConfirmDialog>
      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Reject this proposal" footer={<><Button onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger solid" loading={reject.isPending} onClick={() => reject.mutate()}>Reject</Button></>}>
        <Field label="Note (optional)">{(p) => <textarea {...p} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
      </Modal>
      <Modal wide open={editing} onClose={() => setEditing(false)} title="Edit before approving" footer={<><Button onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save new version</Button></>}>
        <div className="stack">
          <p className="small muted">Saving creates a new version. You will approve it in a separate step.</p>
          {t && <Field label="Fee" hint="Edits below your minimum are allowed but flagged.">{(p) => <MoneyInput {...p} currency={cur} value={edit.amount} onChange={(x) => setEdit({ ...edit, amount: x })} />}</Field>}
          <Field label="Subject">{(p) => <input {...p} className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />}</Field>
          <Field label="Message">{(p) => <textarea {...p} className="textarea" rows={12} value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} />}</Field>
        </div>
      </Modal>
    </article>
  );
}
