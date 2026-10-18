import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, useAction, useTaxonomy } from '../api/hooks.js';
import { post } from '../api/client.js';
import { ApprovalCard, ConversationTimeline, PolicyChecks, TermsComparison } from '../components/Negotiation.jsx';
import { Badge, Button, Card, ConfirmDialog, DemoBadge, EmptyState, ErrorState, Field, LoadingCard, Modal, MoneyInput, Toggle } from '../components/ui.jsx';
import { NEGOTIATION_LABELS, negotiationTone, money, dateTime, humanize, toMinor } from '../lib/format.js';

const REC = {
  accept: { tone: 'success', label: 'Accept (with your approval)' },
  counter: { tone: 'info', label: 'Counter' },
  clarify: { tone: 'warning', label: 'Ask for clarification' },
  decline: { tone: 'danger', label: 'Decline' },
  escalate: { tone: 'warning', label: 'Needs your judgement' },
};

function ManualOfferForm({ dealId, currency, onDone }) {
  const tax = useTaxonomy();
  const [v, setV] = useState({ paymentType: 'paid', fee: '', deliverables: [{ type: 'instagram_reel', quantity: 1 }], revisions: '', usageDays: '', paidAds: false, perpetual: false, exclusivity: false, exclusivityDays: '', netDays: '' });
  const num = (x) => (x === '' ? null : Number(x));
  const save = useAction(
    () =>
      post(`/deals/${dealId}/offers`, {
        terms: {
          paymentType: v.paymentType,
          totalAmountMinor: toMinor(v.fee),
          currency,
          deliverables: v.deliverables.filter((d) => d.type).map((d) => ({ type: d.type, quantity: Number(d.quantity) || 1 })),
          revisionsIncluded: num(v.revisions),
          usageRights: { durationDays: num(v.usageDays), paidAds: v.paidAds, perpetual: v.perpetual },
          exclusivity: { required: v.exclusivity, durationDays: v.exclusivity ? num(v.exclusivityDays) : null },
          paymentTerms: { netDays: num(v.netDays) },
        },
      }),
    { invalidate: ['negotiation', 'approvals'], success: 'Offer recorded and analysed', onSuccess: onDone },
  );
  const setD = (i, k, val) => setV({ ...v, deliverables: v.deliverables.map((d, j) => (j === i ? { ...d, [k]: val } : d)) });
  return (
    <div className="stack">
      <p className="small muted">Use this when the brand shared terms outside CreatorOS (a call, WhatsApp). Recording a new offer invalidates any pending approval for the old terms.</p>
      <div className="grid cols-2">
        <Field label="Compensation type">
          {(p) => (
            <select {...p} className="select" value={v.paymentType} onChange={(e) => setV({ ...v, paymentType: e.target.value })}>
              <option value="paid">Paid</option><option value="barter">Barter</option><option value="hybrid">Paid + products</option>
            </select>
          )}
        </Field>
        <Field label="Total fee">{(p) => <MoneyInput {...p} currency={currency} value={v.fee} onChange={(x) => setV({ ...v, fee: x })} />}</Field>
      </div>
      <div className="stack sm">
        <span className="label">Deliverables</span>
        {v.deliverables.map((d, i) => (
          <div className="row" key={i}>
            <select aria-label="Deliverable type" className="select" value={d.type} onChange={(e) => setD(i, 'type', e.target.value)}>
              {(tax.data?.deliverables || []).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
            <input aria-label="Quantity" className="input num" style={{ width: 80 }} type="number" min="1" value={d.quantity} onChange={(e) => setD(i, 'quantity', e.target.value)} />
            <Button variant="ghost" size="sm" onClick={() => setV({ ...v, deliverables: v.deliverables.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        ))}
        <div><Button size="sm" onClick={() => setV({ ...v, deliverables: [...v.deliverables, { type: 'instagram_story', quantity: 1 }] })}>Add deliverable</Button></div>
      </div>
      <div className="grid cols-3">
        <Field label="Revisions">{(p) => <input {...p} className="input num" type="number" min="0" value={v.revisions} onChange={(e) => setV({ ...v, revisions: e.target.value })} />}</Field>
        <Field label="Usage (days)">{(p) => <input {...p} className="input num" type="number" min="0" value={v.usageDays} onChange={(e) => setV({ ...v, usageDays: e.target.value })} />}</Field>
        <Field label="Payment (net days)">{(p) => <input {...p} className="input num" type="number" min="0" value={v.netDays} onChange={(e) => setV({ ...v, netDays: e.target.value })} />}</Field>
      </div>
      <Toggle checked={v.paidAds} onChange={(x) => setV({ ...v, paidAds: x })} label="Includes paid-ads usage" />
      <Toggle checked={v.perpetual} onChange={(x) => setV({ ...v, perpetual: x })} label="Perpetual usage requested" />
      <Toggle checked={v.exclusivity} onChange={(x) => setV({ ...v, exclusivity: x })} label="Exclusivity requested" />
      {v.exclusivity && <Field label="Exclusivity (days)">{(p) => <input {...p} className="input num" type="number" min="0" value={v.exclusivityDays} onChange={(e) => setV({ ...v, exclusivityDays: e.target.value })} style={{ maxWidth: 160 }} />}</Field>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Record and analyse</Button></div>
    </div>
  );
}

function AgreementDialog({ deal, onClose }) {
  const [v, setV] = useState({ kind: 'email_confirmation', reference: '', url: '' });
  const confirm = useAction(() => post(`/deals/${deal._id}/confirm-agreement`, { kind: v.kind, reference: v.reference || undefined, url: v.url || undefined, confirm: true, acceptedTermsHash: deal.acceptedTermsHash }), {
    invalidate: ['negotiation', 'dashboard'],
    success: 'Deal confirmed',
    onSuccess: onClose,
  });
  return (
    <ConfirmDialog open onClose={onClose} title="Confirm the written agreement" confirmLabel="Confirm deal" loading={confirm.isPending} onConfirm={() => confirm.mutate()} requireCheck="A written agreement (signed contract, PO or written confirmation) for exactly these terms exists.">
      <p className="small">CreatorOS does not sign contracts for you. Record what formalised the deal:</p>
      <Field label="Agreement type">
        {(p) => (
          <select {...p} className="select" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            <option value="email_confirmation">Written email confirmation</option><option value="signed_contract">Signed contract</option><option value="purchase_order">Purchase order</option><option value="other">Other</option>
          </select>
        )}
      </Field>
      <Field label="Reference (optional)">{(p) => <input {...p} className="input" value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} placeholder="e.g. PO-2026-114" />}</Field>
      <Field label="Document link (optional)">{(p) => <input {...p} className="input" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://" />}</Field>
    </ConfirmDialog>
  );
}

export default function NegotiationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useApi(['negotiation', id], `/negotiations/${id}`, { refetchInterval: (query) => (query.state.data?.messages?.some((m) => ['queued', 'sending'].includes(m.deliveryStatus)) ? 3000 : 20_000) });
  const [manual, setManual] = useState(false);
  const [agreement, setAgreement] = useState(false);
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const inv = ['negotiation', 'approvals', 'dashboard', 'conversation'];
  const analyze = useAction(() => post(`/deals/${id}/analyze-offer`), { invalidate: inv, success: 'Offer re-analysed' });
  const counter = useAction(() => post(`/deals/${id}/generate-counteroffer`), { invalidate: inv, success: (r) => (r.autoAuthorized ? 'Counteroffer sent under your Level 2 rules' : 'Counteroffer drafted — approve it below') });
  const accept = useAction(() => post(`/deals/${id}/accept`, { termsVersion: q.data.deal.termsVersion }), { invalidate: inv, success: 'Acceptance prepared — review the exact message and approve it below', onSuccess: () => setConfirmAccept(false) });
  const decline = useAction(() => post(`/deals/${id}/decline`, {}), { invalidate: inv, success: 'Decline drafted — approve it below', onSuccess: () => setConfirmDecline(false) });
  const pending = useAction(() => post(`/deals/${id}/mark-agreement-pending`), { invalidate: inv, success: 'Marked as waiting for agreement' });
  const close = useAction(() => post(`/deals/${id}/close`, {}), { invalidate: inv, success: 'Deal closed', onSuccess: () => setConfirmClose(false) });
  const convert = useAction(() => post(`/deals/${id}/convert-to-campaign`), { invalidate: ['negotiation', 'campaigns'], success: 'Campaign created', onSuccess: (c) => navigate(`/campaigns/${c._id}`) });

  if (q.isLoading) return <LoadingCard lines={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { deal, brand, conversation, messages, approvals, boundaries, campaign } = q.data;
  const policy = boundaries?.commercialPolicy || {};
  const cur = deal.currency;
  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const pendingCounter = pendingApprovals.find((a) => a.actionType === 'send_counteroffer');
  const proposed = pendingCounter?.proposedAction?.terms || deal.proposedTerms;
  const lastOffer = deal.offerHistory.filter((o) => o.source !== 'creator_counter').at(-1);
  const analysisFresh = deal.analysis?.termsVersion === deal.termsVersion;
  const rec = deal.analysis?.recommendation && REC[deal.analysis.recommendation];
  const closed = ['closed', 'declined', 'deal_confirmed'].includes(deal.negotiationState);
  const agreed = ['terms_agreed_subject_to_formalization', 'agreement_pending'].includes(deal.negotiationState);

  return (
    <div className="stack lg">
      <div className="page-header">
        <div>
          <div className="row wrap">
            <h1>{brand.name}</h1>
            <DemoBadge show={deal.isDemo} />
            <Badge tone={negotiationTone(deal.negotiationState)}>{NEGOTIATION_LABELS[deal.negotiationState]}</Badge>
            {deal.termsVersion > 0 && <Badge>Offer v{deal.termsVersion}</Badge>}
          </div>
          <p>AI negotiation workspace · autonomy Level {boundaries?.negotiationAutonomy?.level ?? 0}{conversation && <> · <Link to={`/inbox?conversation=${conversation._id}`}>Open conversation</Link></>}</p>
        </div>
        <div className="btn-group">
          {!closed && <Button onClick={() => setManual(true)}>Enter offer manually</Button>}
          {!closed && <Button variant="ghost" onClick={() => setConfirmClose(true)}>Close deal</Button>}
        </div>
      </div>

      {agreed && (
        <div className="callout info">
          <div className="grow">
            <div className="strong">Terms agreed — subject to a written agreement.</div>
            <div className="small">Accepted {money(deal.acceptedTerms?.totalAmountMinor, cur)}. Once a contract, PO or written confirmation exists, confirm it to create the campaign.</div>
          </div>
          <div className="btn-group">
            {deal.negotiationState === 'terms_agreed_subject_to_formalization' && <Button size="sm" onClick={() => pending.mutate()} loading={pending.isPending}>Waiting for agreement</Button>}
            <Button size="sm" variant="primary" onClick={() => setAgreement(true)}>Confirm agreement…</Button>
          </div>
        </div>
      )}
      {deal.negotiationState === 'deal_confirmed' && (
        <div className="callout info">
          <span className="grow strong">Deal confirmed {deal.agreementReference?.confirmedAt ? `on ${dateTime(deal.agreementReference.confirmedAt)}` : ''} ({humanize(deal.agreementReference?.kind)}).</span>
          {campaign ? <Link className="btn sm primary" to={`/campaigns/${campaign._id}`}>Open campaign</Link> : <Button size="sm" variant="primary" loading={convert.isPending} onClick={() => convert.mutate()}>Create campaign</Button>}
        </div>
      )}

      <div className="split">
        <div className="stack lg">
          {!deal.currentOffer ? (
            <Card title="Offer">
              <EmptyState title="No offer yet" icon="scale" action={!closed && <Button onClick={() => setManual(true)}>Enter offer manually</Button>}>When the brand replies with terms, CreatorOS extracts them and analyses them against your boundaries.</EmptyState>
            </Card>
          ) : (
            <>
              <Card title="Offer summary" actions={lastOffer?.extraction?.provider && <span className="tiny faint">Extracted by {lastOffer.extraction.provider === 'mock' ? 'development mock' : lastOffer.extraction.provider}{lastOffer.source === 'manual_entry' ? ' (manual entry)' : ''}</span>}>
                <div className="stack">
                  {lastOffer?.extraction?.summary && <p>{lastOffer.extraction.summary}</p>}
                  {lastOffer?.source === 'manual_entry' && <p className="small muted">Entered manually by you on {dateTime(lastOffer.at)}.</p>}
                  {lastOffer?.extraction?.missingTerms?.length > 0 && <div className="small"><span className="strong">Missing terms:</span> {lastOffer.extraction.missingTerms.join(', ')}</div>}
                  {lastOffer?.extraction?.ambiguities?.length > 0 && <div className="callout warning small">{lastOffer.extraction.ambiguities.join(' ')}</div>}
                  <TermsComparison offer={deal.currentOffer} proposed={proposed} policy={policy} currency={cur} benchmark={deal.analysis?.benchmarkValueMinor} floor={deal.analysis?.floorValueMinor} />
                </div>
              </Card>
              <Card
                title={<div className="row wrap"><h2>Recommendation</h2>{rec && <Badge tone={rec.tone}>{rec.label}</Badge>}{!analysisFresh && <Badge tone="warning">Outdated — re-analyse</Badge>}</div>}
                actions={<Button size="sm" icon="refresh" onClick={() => analyze.mutate()} loading={analyze.isPending}>Re-analyse</Button>}
              >
                {deal.analysis?.checks?.length ? (
                  <div className="stack">
                    {deal.analysis.reasoning?.map((r) => <p key={r}>{r}</p>)}
                    {deal.analysis.tradeoffs?.length > 0 && (
                      <div className="callout small"><div><div className="strong">Trade-offs</div><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{deal.analysis.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul></div></div>
                    )}
                    <PolicyChecks checks={deal.analysis.checks} />
                    <p className="tiny faint">Limits are checked by a deterministic policy engine; the AI only drafts wording. Recommendation recorded {dateTime(deal.analysis.at)}.</p>
                    {!closed && !agreed && (
                      <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
                        <Button variant="danger" onClick={() => setConfirmDecline(true)}>Decline…</Button>
                        <Button icon="sparkle" onClick={() => counter.mutate()} loading={counter.isPending} disabled={!!pendingCounter}>{pendingCounter ? 'Counter awaiting approval' : 'Generate counteroffer'}</Button>
                        <Button variant="primary" onClick={() => setConfirmAccept(true)}>Accept offer…</Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <Button onClick={() => analyze.mutate()} loading={analyze.isPending}>Analyse offer</Button>
                )}
              </Card>
            </>
          )}

          {pendingApprovals.length > 0 && (
            <section className="stack">
              <h2>Pending approvals</h2>
              {pendingApprovals.map((a) => <ApprovalCard key={`${a._id}:${a.actionHash}`} approval={{ ...a, actionLabel: humanize(a.actionType) }} />)}
            </section>
          )}

          <Card title="Conversation history">
            <ConversationTimeline messages={messages} />
          </Card>
        </div>

        <div className="stack lg">
          <Card title="Your deal boundaries" actions={<Link to="/settings?tab=commercial" className="small">Edit</Link>}>
            <dl className="kv small">
              {(policy.rates || []).map((r) => (
                <div key={r.deliverable} style={{ display: 'contents' }}>
                  <dt>{humanize(r.deliverable)}</dt>
                  <dd className="num">{money(r.preferredMinor, policy.currency)} <span className="faint">min {money(r.minimumMinor, policy.currency)}</span></dd>
                </div>
              ))}
              <dt>Package discount</dt><dd>up to {policy.maxPackageDiscountPercent ?? 0}%</dd>
              <dt>Revisions</dt><dd>{policy.maxRevisions ?? 2}</dd>
              <dt>Barter</dt><dd>{humanize(boundaries?.barterPolicy?.acceptance)}</dd>
            </dl>
            {!policy.rates?.length && <div className="callout warning small">Add your rate card so offers can be benchmarked.</div>}
          </Card>
          <Card title="Offer history" bodyClass="">
            {!deal.offerHistory.length ? <EmptyState title="No offers yet" /> : (
              <div className="list">
                {[...deal.offerHistory].reverse().map((o, i) => (
                  <div key={i} className="list-item small">
                    <Badge tone={o.source === 'creator_counter' ? 'primary' : ''}>{o.source === 'creator_counter' ? 'Your counter' : o.source === 'manual_entry' ? 'Manual entry' : 'Brand offer'}</Badge>
                    <span className="grow num">{o.terms?.paymentType === 'barter' ? 'Barter' : money(o.terms?.totalAmountMinor, cur)}</span>
                    <span className="tiny faint">v{o.version} · {dateTime(o.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="State history" bodyClass="">
            <div className="list">
              {[...deal.stateHistory].reverse().slice(0, 15).map((s, i) => (
                <div key={i} className="list-item small" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="strong">{NEGOTIATION_LABELS[s.to] || s.to}</div>
                    <div className="tiny muted">{s.reason}</div>
                  </div>
                  <div className="tiny faint" style={{ textAlign: 'right' }}>{s.actorType}<br />{dateTime(s.at)}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Modal wide open={manual} onClose={() => setManual(false)} title="Enter the brand's offer">
        <ManualOfferForm dealId={id} currency={cur} onDone={() => setManual(false)} />
      </Modal>
      {agreement && <AgreementDialog deal={deal} onClose={() => setAgreement(false)} />}
      <ConfirmDialog open={confirmAccept} onClose={() => setConfirmAccept(false)} title="Accept this offer?" confirmLabel="Prepare acceptance" loading={accept.isPending} onConfirm={() => accept.mutate()}>
        <p>CreatorOS will draft an acceptance (subject to a written agreement) for <strong>{money(deal.currentOffer?.totalAmountMinor, cur)}</strong>. You will see the exact message and approve it explicitly before anything is sent.</p>
        {deal.analysis?.recommendation !== 'accept' && <div className="callout warning small">The analysis recommends <strong>{deal.analysis?.recommendation}</strong>, not accept. Review the checks first.</div>}
      </ConfirmDialog>
      <ConfirmDialog open={confirmDecline} onClose={() => setConfirmDecline(false)} title="Decline this offer?" confirmLabel="Draft decline" danger loading={decline.isPending} onConfirm={() => decline.mutate()}>
        <p>A polite decline will be drafted for your approval.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirmClose} onClose={() => setConfirmClose(false)} title="Close this deal?" confirmLabel="Close deal" danger loading={close.isPending} onConfirm={() => close.mutate()}>
        <p>Pending approvals are cancelled and follow-ups stop. Nothing is sent to the brand.</p>
      </ConfirmDialog>
    </div>
  );
}
