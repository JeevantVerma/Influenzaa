import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi, useAction, useTaxonomy } from '../api/hooks.js';
import { post, patch } from '../api/client.js';
import { Badge, Button, Card, ConfirmDialog, DemoBadge, EmptyState, ErrorState, Field, LoadingCard, Modal, MoneyInput } from '../components/ui.jsx';
import { STAGES, PAYMENT_TONE } from './Campaigns.jsx';
import { money, humanize, date, dateTime, DELIVERABLES, toMajor, toMinor } from '../lib/format.js';

const DELIVERABLE_FLOW = ['pending', 'in_production', 'draft_submitted', 'revision_requested', 'approved', 'published'];
const INV_TONE = { draft: '', issued: 'info', overdue: 'danger', paid: 'success', cancelled: '' };

function DeliverableRow({ campaignId, d }) {
  const [publishing, setPublishing] = useState(false);
  const [url, setUrl] = useState(d.publishedUrl || '');
  const upd = useAction((body) => patch(`/campaigns/${campaignId}/deliverables/${d._id}`, body), { invalidate: ['campaign', 'campaigns', 'dashboard'], success: 'Deliverable updated', onSuccess: () => setPublishing(false) });
  const overdue = d.dueAt && new Date(d.dueAt) < new Date() && !['published', 'approved'].includes(d.status);
  return (
    <tr>
      <td><div className="strong">{d.description || DELIVERABLES[d.type]}</div><div className="tiny faint">{DELIVERABLES[d.type]}</div></td>
      <td>
        <label className="sr-only" htmlFor={`st-${d._id}`}>Status</label>
        <select id={`st-${d._id}`} className="select" value={d.status} onChange={(e) => (e.target.value === 'published' ? setPublishing(true) : upd.mutate({ status: e.target.value }))}>
          {DELIVERABLE_FLOW.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
      </td>
      <td>
        <label className="sr-only" htmlFor={`due-${d._id}`}>Due date</label>
        <input id={`due-${d._id}`} type="date" className="input" value={d.dueAt ? d.dueAt.slice(0, 10) : ''} onChange={(e) => upd.mutate({ dueAt: e.target.value ? new Date(`${e.target.value}T12:00:00Z`).toISOString() : null })} />
        {overdue && <Badge tone="danger">Overdue</Badge>}
      </td>
      <td className="num"><span style={{ color: d.revisionsUsed > d.revisionsAllowed ? 'var(--danger)' : undefined }}>{d.revisionsUsed}/{d.revisionsAllowed}</span></td>
      <td>{d.publishedUrl ? <a href={d.publishedUrl} target="_blank" rel="noopener noreferrer nofollow" className="small">View ↗</a> : <span className="faint small">—</span>}</td>
      <Modal open={publishing} onClose={() => setPublishing(false)} title="Mark as published" footer={<><Button onClick={() => setPublishing(false)}>Cancel</Button><Button variant="primary" loading={upd.isPending} disabled={!/^https?:\/\//.test(url)} onClick={() => upd.mutate({ status: 'published', publishedUrl: url })}>Save evidence</Button></>}>
        <Field label="Published URL" hint="Stored as publication evidence for the brand report.">{(p) => <input {...p} className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/p/…" />}</Field>
      </Modal>
    </tr>
  );
}

function InvoiceCard({ inv, onReminderCreated }) {
  const [paid, setPaid] = useState(false);
  const [ref, setRef] = useState('');
  const keys = ['campaign', 'campaigns', 'dashboard'];
  const status = useAction((body) => post(`/invoices/${inv._id}/status`, body), { invalidate: keys, success: (r) => `Invoice ${humanize(r.status).toLowerCase()}`, onSuccess: () => setPaid(false) });
  const remind = useAction(() => post(`/invoices/${inv._id}/reminder`), { invalidate: ['approvals'], success: 'Payment reminder drafted for your approval', onSuccess: onReminderCreated });
  return (
    <div className="card flat card-body stack sm" style={{ padding: 14 }}>
      <div className="row wrap">
        <span className="mono strong">{inv.invoiceNumber}</span>
        <Badge tone={INV_TONE[inv.status]}>{humanize(inv.status)}</Badge>
        {inv.paymentVerification === 'creator_reported' && <Badge title="Marked paid by you. CreatorOS did not process or verify this payment.">Creator-reported</Badge>}
        <span className="grow" />
        <span className="num strong">{money(inv.amountMinor, inv.currency)}</span>
      </div>
      <div className="small muted">Due {date(inv.dueDate)}{inv.issueDate ? ` · issued ${date(inv.issueDate)}` : ''}{inv.paidAt ? ` · paid ${date(inv.paidAt)}` : ''}{inv.paymentReference ? ` · ref ${inv.paymentReference}` : ''}{inv.remindersSent ? ` · ${inv.remindersSent} reminder(s)` : ''}</div>
      <div className="btn-group">
        {inv.status === 'draft' && <Button size="sm" variant="primary" onClick={() => status.mutate({ status: 'issued' })} loading={status.isPending}>Mark as issued</Button>}
        {['issued', 'overdue'].includes(inv.status) && <Button size="sm" variant="primary" onClick={() => setPaid(true)}>Mark payment received…</Button>}
        {['issued', 'overdue'].includes(inv.status) && <Button size="sm" onClick={() => remind.mutate()} loading={remind.isPending}>Draft reminder</Button>}
        {['draft', 'issued', 'overdue'].includes(inv.status) && <Button size="sm" variant="ghost" onClick={() => status.mutate({ status: 'cancelled' })}>Cancel invoice</Button>}
      </div>
      <ConfirmDialog open={paid} onClose={() => setPaid(false)} title="Record payment received?" confirmLabel="Record payment" loading={status.isPending} onConfirm={() => status.mutate({ status: 'paid', confirm: true, paymentReference: ref || undefined })} requireCheck="I have checked my bank account and the money has arrived.">
        <p className="small">CreatorOS does not process payments. This records your own confirmation and will be labelled “creator-reported”.</p>
        <Field label="Payment reference (UTR / transaction id, optional)">{(p) => <input {...p} className="input" value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
      </ConfirmDialog>
    </div>
  );
}

export default function CampaignDetailPage() {
  const { id } = useParams();
  const tax = useTaxonomy();
  const q = useApi(['campaign', id], `/campaigns/${id}`);
  const [addOpen, setAddOpen] = useState(false);
  const [newD, setNewD] = useState({ type: 'instagram_reel', description: '', dueAt: '' });
  const [invOpen, setInvOpen] = useState(false);
  const [inv, setInv] = useState({ amount: '', dueInDays: 30 });
  const [brief, setBrief] = useState(null);
  const keys = ['campaign', 'campaigns', 'dashboard'];
  const stage = useAction((s) => post(`/campaigns/${id}/stage`, { stage: s }), { invalidate: keys, success: 'Stage updated' });
  const add = useAction(() => post(`/campaigns/${id}/deliverables`, { type: newD.type, description: newD.description || undefined, dueAt: newD.dueAt ? new Date(`${newD.dueAt}T12:00:00Z`).toISOString() : undefined }), { invalidate: keys, success: 'Deliverable added', onSuccess: () => setAddOpen(false) });
  const createInv = useAction(() => post(`/campaigns/${id}/invoices`, { amountMinor: toMinor(inv.amount) ?? undefined, dueInDays: Number(inv.dueInDays) }), { invalidate: keys, success: 'Invoice created (draft)', onSuccess: () => setInvOpen(false) });
  const saveBrief = useAction(() => patch(`/campaigns/${id}`, { brief: { text: brief.text, mandatoryDisclosures: brief.disclosures.split(',').map((s) => s.trim()).filter(Boolean) } }), { invalidate: keys, success: 'Brief saved', onSuccess: () => setBrief(null) });
  const summary = useAction(() => post(`/campaigns/${id}/summary`), { invalidate: keys, success: 'Summary generated' });
  const shipment = useAction((status) => patch(`/campaigns/${id}`, { productShipment: { status } }), { invalidate: keys, success: 'Shipment status updated' });

  if (q.isLoading) return <LoadingCard lines={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const c = q.data;
  const stageIdx = STAGES.indexOf(c.status);

  return (
    <div className="stack lg">
      <div className="page-header">
        <div>
          <div className="row wrap"><h1>{c.title}</h1><DemoBadge show={c.isDemo} /><Badge tone={PAYMENT_TONE[c.paymentStatus]}>Payment: {humanize(c.paymentStatus)}</Badge></div>
          <p>{money(c.compensation.amountMinor, c.compensation.currency)}{c.compensation.barterDescription ? ` + ${c.compensation.barterDescription}` : ''} · agreement: {humanize(c.agreement?.kind) || '—'} {c.agreement?.reference ? `(${c.agreement.reference})` : ''} · <Link to={`/negotiations/${c.dealId}`}>Negotiation</Link></p>
        </div>
      </div>

      <Card title="Campaign timeline">
        <div className="stack">
          <div className="pipeline">
            {STAGES.map((s, i) => <div key={s} className={`stage ${i < stageIdx ? 'done' : i === stageIdx ? 'current' : ''}`}>{humanize(s)}</div>)}
          </div>
          <div className="row wrap">
            <label htmlFor="stage" className="small strong">Move to stage</label>
            <select id="stage" className="select" style={{ maxWidth: 260 }} value={c.status} onChange={(e) => stage.mutate(e.target.value)}>
              {STAGES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
            {stageIdx < STAGES.length - 1 && <Button size="sm" onClick={() => stage.mutate(STAGES[stageIdx + 1])} loading={stage.isPending}>Advance to “{humanize(STAGES[stageIdx + 1])}”</Button>}
          </div>
        </div>
      </Card>

      <div className="split">
        <div className="stack lg">
          <Card title="Deliverables" actions={<Button size="sm" onClick={() => setAddOpen(true)}>Add deliverable</Button>} bodyClass="table-wrap">
            {!c.deliverables.length ? <EmptyState title="No deliverables" /> : (
              <table className="table">
                <thead><tr><th>Deliverable</th><th>Status</th><th>Due</th><th className="num">Revisions</th><th>Evidence</th></tr></thead>
                <tbody>{c.deliverables.map((d) => <DeliverableRow key={d._id} campaignId={c._id} d={d} />)}</tbody>
              </table>
            )}
          </Card>
          <Card title="Brief & disclosures" actions={!brief && <Button size="sm" onClick={() => setBrief({ text: c.brief?.text || '', disclosures: (c.brief?.mandatoryDisclosures || []).join(', ') })}>Edit</Button>}>
            {brief ? (
              <div className="stack">
                <Field label="Brief">{(p) => <textarea {...p} className="textarea" rows={8} value={brief.text} onChange={(e) => setBrief({ ...brief, text: e.target.value })} />}</Field>
                <Field label="Mandatory disclosures" hint="Comma-separated, e.g. #ad, Paid partnership label">{(p) => <input {...p} className="input" value={brief.disclosures} onChange={(e) => setBrief({ ...brief, disclosures: e.target.value })} />}</Field>
                <div className="btn-group" style={{ justifyContent: 'flex-end' }}><Button onClick={() => setBrief(null)}>Cancel</Button><Button variant="primary" loading={saveBrief.isPending} onClick={() => saveBrief.mutate()}>Save</Button></div>
              </div>
            ) : c.brief?.text ? (
              <div className="stack sm"><p className="pre">{c.brief.text}</p>{c.brief.mandatoryDisclosures?.length > 0 && <div className="row wrap">{c.brief.mandatoryDisclosures.map((x) => <Badge key={x} tone="warning">{x}</Badge>)}</div>}</div>
            ) : (
              <p className="muted small">No brief yet. Paste the brand's brief here so deadlines and disclosures live with the campaign. Remember ASCI guidelines require clear ad disclosure.</p>
            )}
          </Card>
          <Card title="Completion summary" actions={<Button size="sm" onClick={() => summary.mutate()} loading={summary.isPending}>Generate</Button>}>
            {c.report?.summary ? <><p className="pre small">{c.report.summary}</p><p className="tiny faint">Generated {dateTime(c.report.generatedAt)}</p></> : <p className="muted small">Generate a factual summary of deliverables, evidence and payments.</p>}
          </Card>
        </div>
        <div className="stack lg">
          <Card title="Invoices & payment" actions={<Button size="sm" onClick={() => { setInv({ amount: toMajor(c.compensation.amountMinor), dueInDays: 30 }); setInvOpen(true); }}>New invoice</Button>}>
            <div className="stack">
              <div className="callout small">CreatorOS tracks invoices and reminders only. It does not send, receive or hold money.</div>
              {!c.invoices.length ? <p className="muted small">No invoices yet.</p> : c.invoices.map((i) => <InvoiceCard key={i._id} inv={i} />)}
            </div>
          </Card>
          <Card title="Rights & obligations">
            <dl className="kv small">
              <dt>Usage</dt><dd>{c.usageRights?.perpetual ? 'Perpetual' : `${c.usageRights?.durationDays ?? '—'} days`}{c.usageRights?.paidAds ? ' · paid ads' : ''}{c.usageRights?.whitelisting ? ' · whitelisting' : ''}</dd>
              <dt>Exclusivity</dt><dd>{c.exclusivity?.required ? `${c.exclusivity.durationDays} days${c.exclusivity.scope ? ` (${c.exclusivity.scope})` : ''}` : 'None'}</dd>
              <dt>Content due</dt><dd>{date(c.deadlines?.contentDueAt)}</dd>
              <dt>Publish</dt><dd>{date(c.deadlines?.publishAt)}</dd>
            </dl>
          </Card>
          {c.productShipment?.status !== 'not_applicable' && (
            <Card title="Products">
              <div className="row wrap">
                <Badge tone={c.productShipment.status === 'received' ? 'success' : 'warning'}>{humanize(c.productShipment.status)}</Badge>
                {['pending', 'shipped', 'received'].map((s) => s !== c.productShipment.status && <Button key={s} size="sm" onClick={() => shipment.mutate(s)}>Mark {s}</Button>)}
              </div>
            </Card>
          )}
          <Card title="Publication evidence" bodyClass="">
            {!c.publicationEvidence?.length ? <EmptyState title="No published links yet" icon="link" /> : (
              <div className="list">{c.publicationEvidence.map((e, i) => <a key={i} href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="list-item small"><span className="grow truncate">{e.url}</span><span className="tiny faint">{date(e.addedAt)}</span></a>)}</div>
            )}
          </Card>
        </div>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add deliverable" footer={<><Button onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="primary" loading={add.isPending} onClick={() => add.mutate()}>Add</Button></>}>
        <div className="stack">
          <Field label="Type">{(p) => <select {...p} className="select" value={newD.type} onChange={(e) => setNewD({ ...newD, type: e.target.value })}>{(tax.data?.deliverables || []).map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select>}</Field>
          <Field label="Description">{(p) => <input {...p} className="input" value={newD.description} onChange={(e) => setNewD({ ...newD, description: e.target.value })} />}</Field>
          <Field label="Due date">{(p) => <input {...p} className="input" type="date" value={newD.dueAt} onChange={(e) => setNewD({ ...newD, dueAt: e.target.value })} />}</Field>
        </div>
      </Modal>
      <Modal open={invOpen} onClose={() => setInvOpen(false)} title="Create invoice" footer={<><Button onClick={() => setInvOpen(false)}>Cancel</Button><Button variant="primary" loading={createInv.isPending} onClick={() => createInv.mutate()}>Create draft</Button></>}>
        <div className="stack">
          <Field label="Amount">{(p) => <MoneyInput {...p} currency={c.compensation.currency} value={inv.amount} onChange={(x) => setInv({ ...inv, amount: x })} />}</Field>
          <Field label="Due in (days)">{(p) => <input {...p} className="input num" type="number" min="0" max="180" value={inv.dueInDays} onChange={(e) => setInv({ ...inv, dueInDays: e.target.value })} />}</Field>
          <p className="tiny faint">Invoice numbers are sequential per year. Issue the invoice to the brand yourself; CreatorOS tracks its status.</p>
        </div>
      </Modal>
    </div>
  );
}
