import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, useAction, useTaxonomy } from '../api/hooks.js';
import { post } from '../api/client.js';
import { ApprovalCard, ConversationTimeline, PolicyChecks, TermsComparison, hasWorkInFlight } from '../components/Negotiation.jsx';
import { Badge, Button, ConfirmDialog, DemoBadge, Disclosure, ErrorState, Field, LoadingCard, Modal, MoneyInput, PageHead, Section, Toggle } from '../components/ui.jsx';
import { NEGOTIATION_LABELS, RECOMMENDATION_LABELS, negotiationTone, money, dateTime, deliverablesText, humanize, toMinor } from '../lib/format.js';

const REC = RECOMMENDATION_LABELS;

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
  const q = useApi(['negotiation', id], `/negotiations/${id}`, { refetchInterval: (query) => (hasWorkInFlight(query.state.data?.messages) ? 3000 : 20_000) });
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

  const theirFee = deal.currentOffer?.paymentType === 'barter' ? null : deal.currentOffer?.totalAmountMinor;
  const askFee = proposed?.totalAmountMinor ?? deal.analysis?.benchmarkValueMinor;
  const otherPending = pendingApprovals.filter((a) => a !== pendingCounter);
  const actor = { brand: 'Brand', creator: 'You', ai: 'CreatorOS', system: 'CreatorOS', worker: 'CreatorOS' };
  // Lead with the plain comparison ("…% below your preferred rate"), not the pricing mechanics.
  const reasoning = deal.analysis?.reasoning || [];
  const headline = reasoning.find((r) => /below|above|within|matches|meets/i.test(r) && !/^benchmark/i.test(r)) || reasoning.find((r) => !/^benchmark/i.test(r)) || reasoning[0];

  return (
    <div className="page-stack">
      <PageHead
        back={{ to: '/negotiations', label: 'Deals' }}
        title={brand.name}
        badges={<><DemoBadge show={deal.isDemo} label="Demo" /><Badge tone={negotiationTone(deal.negotiationState)}>{NEGOTIATION_LABELS[deal.negotiationState]}</Badge></>}
        subtitle={conversation ? <Link to={`/inbox?conversation=${conversation._id}`}>Open the email conversation</Link> : null}
        actions={!closed && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setManual(true)}>Enter their offer</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClose(true)}>Close deal</Button>
          </>
        )}
      />

      {agreed && (
        <div className="callout info">
          <div className="grow">
            <div className="strong">You've agreed on {money(deal.acceptedTerms?.totalAmountMinor, cur)}, pending a written agreement.</div>
            <div className="small">Once you have a contract, purchase order or written confirmation, confirm it here to start the campaign.</div>
          </div>
          <div className="btn-group">
            {deal.negotiationState === 'terms_agreed_subject_to_formalization' && <Button size="sm" onClick={() => pending.mutate()} loading={pending.isPending}>Waiting for it</Button>}
            <Button size="sm" variant="primary" onClick={() => setAgreement(true)}>I have it…</Button>
          </div>
        </div>
      )}
      {deal.negotiationState === 'deal_confirmed' && (
        <div className="callout info">
          <span className="grow strong">Deal confirmed{deal.agreementReference?.confirmedAt ? ` on ${dateTime(deal.agreementReference.confirmedAt)}` : ''}.</span>
          {campaign ? <Link className="btn sm primary" to={`/campaigns/${campaign._id}`}>Open campaign</Link> : <Button size="sm" variant="primary" loading={convert.isPending} onClick={() => convert.mutate()}>Start the campaign</Button>}
        </div>
      )}

      <div className="two-col">
        <div className="page-stack">
          {!deal.currentOffer ? (
            <section className="hero-card" aria-label="Offer">
              <div className="eyebrow">Waiting for an offer</div>
              <p>When {brand.name} replies with a fee or terms, CreatorOS reads them and checks them against your limits. If they told you on a call or WhatsApp, enter it yourself.</p>
              {!closed && <div><Button variant="primary" onClick={() => setManual(true)}>Enter their offer</Button></div>}
            </section>
          ) : (
            <section className={`hero-card ${!closed && !agreed ? 'needs' : ''}`} aria-label="Your decision">
              <div className="eyebrow">{closed || agreed ? 'Their offer' : 'Your decision'}</div>
              <div className="figures">
                <div className="figure theirs">
                  <div className="eyebrow">They offered</div>
                  <div className="value">{theirFee != null ? money(theirFee, cur) : 'Products'}</div>
                  <div className="sub">{deliverablesText(deal.currentOffer.deliverables) || '—'}</div>
                </div>
                <div className="figure ask">
                  <div className="eyebrow">You'd ask</div>
                  <div className="value">{askFee != null ? money(askFee, cur) : '—'}</div>
                  <div className="sub">{pendingCounter ? 'in your draft counteroffer' : 'your usual rate for this'}</div>
                </div>
                <div className="figure">
                  <div className="eyebrow">Your minimum</div>
                  <div className="value">{deal.analysis?.floorValueMinor ? money(deal.analysis.floorValueMinor, cur) : '—'}</div>
                  <div className="sub">you set this in Settings</div>
                </div>
              </div>
              {lastOffer?.extraction?.summary && <p>{lastOffer.extraction.summary}</p>}
              {lastOffer?.source === 'manual_entry' && <p className="small muted">You entered this offer on {dateTime(lastOffer.at)}.</p>}
              {lastOffer?.extraction?.missingTerms?.length > 0 && <p className="small muted">They didn't mention: {lastOffer.extraction.missingTerms.join(', ')}.</p>}
              {lastOffer?.extraction?.ambiguities?.length > 0 && <div className="callout warning small">{lastOffer.extraction.ambiguities.join(' ')}</div>}
              {rec && (
                <div className="callout small">
                  <div className="grow">
                    <div className="row wrap"><span className="strong">Our suggestion:</span><Badge tone={rec.tone}>{rec.label}</Badge>{!analysisFresh && <Badge tone="warning">Out of date</Badge>}</div>
                    {headline && <div style={{ marginTop: 4 }}>{headline}</div>}
                  </div>
                </div>
              )}
              {pendingCounter && (
                <div className="callout warning small">
                  <span className="grow">Your counteroffer of <strong>{money(pendingCounter.proposedAction.terms?.totalAmountMinor, cur)}</strong> is drafted and waiting for your OK below.</span>
                  <a className="btn sm" href={`#approval-${pendingCounter._id}`}>Review it</a>
                </div>
              )}
              {!closed && !agreed && (
                <div className="action-bar sticky">
                  <Button variant="ghost" className="danger" onClick={() => setConfirmDecline(true)}>Decline…</Button>
                  <Button icon="sparkle" onClick={() => counter.mutate()} loading={counter.isPending} disabled={!!pendingCounter}>{pendingCounter ? 'Counter drafted' : 'Ask for more'}</Button>
                  <Button variant="primary" onClick={() => setConfirmAccept(true)}>Accept…</Button>
                </div>
              )}
            </section>
          )}

          {deal.currentOffer && (
            <Section title="Their terms vs. your limits" aside={<Button size="sm" variant="ghost" icon="refresh" onClick={() => analyze.mutate()} loading={analyze.isPending}>Check again</Button>}>
              <TermsComparison offer={deal.currentOffer} proposed={proposed} policy={policy} currency={cur} benchmark={deal.analysis?.benchmarkValueMinor} floor={deal.analysis?.floorValueMinor} />
            </Section>
          )}

          {deal.analysis?.checks?.length > 0 && (
            <div>
              <Disclosure title="Checked against your limits" meta={`${deal.analysis.checks.filter((c) => c.status !== 'ok').length} to look at`}>
                <div className="stack">
                  {reasoning.filter((r) => r !== headline).map((r) => <p key={r} className="small">{r}</p>)}
                  {deal.analysis.tradeoffs?.length > 0 && <ul className="reason-list">{deal.analysis.tradeoffs.map((t) => <li key={t}><span className="mark info" aria-hidden="true">i</span><span className="small">{t}</span></li>)}</ul>}
                  <PolicyChecks checks={deal.analysis.checks} />
                  <p className="tiny faint">Your limits are checked by fixed rules, not by the AI; the AI only writes the wording. Checked {dateTime(deal.analysis.at)}.</p>
                </div>
              </Disclosure>
            </div>
          )}

          {(pendingCounter || otherPending.length > 0) && (
            <section className="stack" aria-label="Waiting for your OK">
              <div className="panel-title"><h2>Waiting for your OK</h2></div>
              {[pendingCounter, ...otherPending].filter(Boolean).map((a) => <ApprovalCard key={`${a._id}:${a.actionHash}`} approval={{ ...a, contextSnapshot: { brandName: brand.name, ...a.contextSnapshot } }} defaultOpen={false} />)}
            </section>
          )}

          <Section title="Conversation">
            <ConversationTimeline messages={messages} />
          </Section>
        </div>

        <div className="page-stack">
          <Section title="Your limits" aside={<Link to="/settings?tab=commercial" className="small">Edit</Link>}>
            {!policy.rates?.length ? (
              <div className="callout warning small">Add your rates in Settings so offers can be compared.</div>
            ) : (
              <dl className="term-list compact">
                {(policy.rates || []).map((r) => (
                  <div className="term-row" key={r.deliverable}><dt>{humanize(r.deliverable)}</dt><dd className="num">{money(r.preferredMinor, policy.currency)}<span className="tiny faint" style={{ display: 'block', fontWeight: 500 }}>min {money(r.minimumMinor, policy.currency)}</span></dd></div>
                ))}
                <div className="term-row"><dt>Package discount</dt><dd>up to {policy.maxPackageDiscountPercent ?? 0}%</dd></div>
                <div className="term-row"><dt>Revisions</dt><dd>up to {policy.maxRevisions ?? 2}</dd></div>
                <div className="term-row"><dt>Products instead of fee</dt><dd>{humanize(boundaries?.barterPolicy?.acceptance)}</dd></div>
              </dl>
            )}
          </Section>
          <Section title="Offers so far" bodyClass="">
            {!deal.offerHistory.length ? <p className="panel-empty">No offers yet.</p> : (
              [...deal.offerHistory].reverse().map((o, i) => (
                <div key={i} className="row-link">
                  <span className="grow">
                    <span className="strong num">{o.terms?.paymentType === 'barter' ? 'Products' : money(o.terms?.totalAmountMinor, cur)}</span>
                    <span className="small muted">{o.source === 'creator_counter' ? 'Your counteroffer' : o.source === 'manual_entry' ? 'Their offer (entered by you)' : 'Their offer'} · {dateTime(o.at)}</span>
                  </span>
                </div>
              ))
            )}
          </Section>
          <div>
            <Disclosure title="Deal timeline" meta={`${deal.stateHistory.length} step${deal.stateHistory.length === 1 ? '' : 's'}`}>
              <div className="stack sm">
                {[...deal.stateHistory].reverse().slice(0, 15).map((st, i) => (
                  <div key={i} className="row top small">
                    <span className="grow"><span className="strong">{NEGOTIATION_LABELS[st.to] || st.to}</span><span className="muted" style={{ display: 'block' }}>{st.reason}</span></span>
                    <span className="tiny faint" style={{ textAlign: 'right' }}>{actor[st.actorType] || 'CreatorOS'}<br />{dateTime(st.at)}</span>
                  </div>
                ))}
              </div>
            </Disclosure>
          </div>
        </div>
      </div>

      <Modal wide open={manual} onClose={() => setManual(false)} title="Enter the brand's offer">
        <ManualOfferForm dealId={id} currency={cur} onDone={() => setManual(false)} />
      </Modal>
      {agreement && <AgreementDialog deal={deal} onClose={() => setAgreement(false)} />}
      <ConfirmDialog open={confirmAccept} onClose={() => setConfirmAccept(false)} title={`Accept ${money(deal.currentOffer?.totalAmountMinor, cur)}?`} confirmLabel="Draft my acceptance" loading={accept.isPending} onConfirm={() => accept.mutate()}>
        <p>CreatorOS drafts an acceptance email (subject to a written agreement). You'll see the exact email and approve it before anything is sent.</p>
        {deal.analysis?.recommendation !== 'accept' && <div className="callout warning small">Our suggestion was <strong>{REC[deal.analysis?.recommendation]?.label?.toLowerCase() || deal.analysis?.recommendation}</strong>, not accept. Check the terms first.</div>}
      </ConfirmDialog>
      <ConfirmDialog open={confirmDecline} onClose={() => setConfirmDecline(false)} title="Decline this offer?" confirmLabel="Draft a polite no" danger loading={decline.isPending} onConfirm={() => decline.mutate()}>
        <p>CreatorOS drafts a polite decline. You approve it before it is sent.</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirmClose} onClose={() => setConfirmClose(false)} title="Close this deal?" confirmLabel="Close deal" danger loading={close.isPending} onConfirm={() => close.mutate()}>
        <p>Drafts waiting for your OK are cancelled and follow-ups stop. Nothing is sent to the brand.</p>
      </ConfirmDialog>
    </div>
  );
}
