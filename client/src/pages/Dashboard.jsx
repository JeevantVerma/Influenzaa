import { Link } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import { Badge, DemoBadge, ErrorState, Icon, LoadingCard, ScoreBadge } from '../components/ui.jsx';
import { money, date, relative, NEGOTIATION_LABELS, negotiationTone, APPROVAL_TEXT } from '../lib/format.js';
import { activitySentence, meaningfulActivity } from '../lib/activity.js';

// Home screen: what needs the creator now, what is on the table, and the
// brands worth pitching next. Everything else lives one tap away.

const SIGNAL = {
  high_intent: { label: 'Strong signal', tone: 'success' },
  medium_intent: { label: 'Good timing', tone: 'info' },
  low_intent: { label: 'Category fit', tone: '' },
};

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const firstName = (name) => String(name || '').replace(/\s*\(demo\)\s*/i, '').trim().split(/\s+/)[0] || '';

function DiscoveryStatus({ discovery }) {
  let tone = 'on';
  let text = 'Finding sponsors for you';
  let meta = discovery.nextRunAt ? `next search ${relative(discovery.nextRunAt)}` : null;
  if (discovery.status === 'running' && !discovery.worker?.healthy) [tone, text, meta] = ['warn', 'Discovery is on, but the background worker is offline', null];
  else if (discovery.status === 'paused') [tone, text, meta] = ['off', 'Sponsor discovery is paused', null];
  else if (discovery.status === 'error') [tone, text, meta] = ['warn', 'Sponsor discovery stopped after errors', null];
  else if (discovery.status !== 'running') [tone, text, meta] = ['off', 'Sponsor discovery is off', null];
  return (
    <div className={`status-pill ${tone}`} role="status">
      <span className="dot" aria-hidden="true" />
      <span>{text}</span>
      {meta && <span className="faint">· {meta}</span>}
      <Link to="/opportunities" className="status-link">{discovery.status === 'running' ? 'Manage' : 'Turn on'}</Link>
    </div>
  );
}

function TodoItem({ to, icon, tone = '', title, meta }) {
  return (
    <Link to={to} className="todo-item">
      <span className={`todo-icon ${tone}`} aria-hidden="true"><Icon name={icon} size={19} className="" /></span>
      <span className="grow">
        <span className="todo-title">{title}</span>
        {meta && <span className="todo-meta">{meta}</span>}
      </span>
      <Icon name="chevron" size={18} className="faint" />
    </Link>
  );
}

function NeedsYou({ d }) {
  const items = [];
  const action = (kind) => d.nextActions.find((a) => a.kind === kind);
  if (action('onboarding')) items.push({ key: 'onboarding', to: '/onboarding', icon: 'user', tone: 'primary', title: 'Finish setting up your profile', meta: 'Your rates and niches power every match and negotiation' });
  if (action('worker')) items.push({ key: 'worker', to: '/settings?tab=integrations', icon: 'alert', tone: 'danger', title: 'Background worker is offline', meta: 'Discovery and sending are paused until it is back' });
  for (const a of d.pendingApprovals.items.slice(0, 3)) {
    const amount = a.amountMinor != null ? money(a.amountMinor, a.currency) : null;
    items.push({
      key: a._id,
      to: `/approvals?focus=${a._id}`,
      icon: 'shield',
      tone: 'warning',
      title: `${APPROVAL_TEXT[a.actionType] || 'Review a draft for'} ${a.brandName || 'a brand'}`,
      meta: [amount, `expires ${relative(a.expiresAt)}`].filter(Boolean).join(' · '),
    });
  }
  if (d.pendingApprovals.count > 3) items.push({ key: 'more-approvals', to: '/approvals', icon: 'shield', tone: 'warning', title: `${d.pendingApprovals.count - 3} more waiting for approval` });
  if (d.newOpportunitiesCount) {
    items.push({ key: 'opps', to: '/opportunities?status=new', icon: 'sparkle', tone: 'primary', title: `${d.newOpportunitiesCount} new brand${d.newOpportunitiesCount > 1 ? 's' : ''} match you`, meta: 'Review the evidence and pitch the best ones' });
  }
  const inv = action('invoices');
  if (inv) items.push({ key: 'invoices', to: inv.link, icon: 'invoice', tone: 'danger', title: inv.label, meta: 'Send a payment reminder' });
  if (action('deadlines')) items.push({ key: 'deadlines', to: '/campaigns', icon: 'clock', tone: 'danger', title: 'You have overdue deliverables', meta: 'Open your campaigns' });
  if (action('discovery') && !items.length) items.push({ key: 'discovery', to: '/opportunities', icon: 'search', tone: 'primary', title: 'Turn on sponsor discovery', meta: 'CreatorOS will look for brands that fit you in the background' });

  return (
    <section className="area-todo" aria-labelledby="needs-you">
      <div className="panel-title"><h2 id="needs-you">Needs you</h2>{items.length > 0 && <span className="small faint">{items.length} thing{items.length > 1 ? 's' : ''}</span>}</div>
      <div className="todo">
        {items.length ? (
          items.map(({ key, ...p }) => <TodoItem key={key} {...p} />)
        ) : (
          <div className="todo-done">
            <span className="todo-icon money" aria-hidden="true"><Icon name="check" size={19} className="" /></span>
            <span><span className="todo-title">You're all caught up</span><span className="todo-meta">New brands and replies will show up here.</span></span>
          </div>
        )}
      </div>
    </section>
  );
}

function MoneyTiles({ d }) {
  const o = d.outcomes;
  const cur = d.profile.currency;
  return (
    <section className="area-money money-tiles" aria-label="Your money">
      <div className="money-tile primary">
        <div className="label">On the table</div>
        <div className="value">{money(o.offersOnTableMinor, cur)}</div>
        <div className="sub">{o.activeNegotiations ? `brand offers across ${o.activeNegotiations} active deal${o.activeNegotiations > 1 ? 's' : ''}` : 'no offers yet'}</div>
      </div>
      <div className="money-tile">
        <div className="label">Deals won</div>
        <div className="value">{o.dealsWon}</div>
        <div className="sub">{o.pitchesSent} pitch{o.pitchesSent === 1 ? '' : 'es'} sent · {o.positiveReplies} positive repl{o.positiveReplies === 1 ? 'y' : 'ies'}</div>
      </div>
      <div className="money-tile">
        <div className="label">Paid to you</div>
        <div className="value">{money(o.revenueReportedMinor, cur)}</div>
        <div className="sub" title={o.revenueNote}>as you reported · CreatorOS never handles money</div>
      </div>
    </section>
  );
}

function Panel({ area, title, link, children }) {
  return (
    <section className={`area-${area}`} aria-label={title}>
      <div className="panel-title"><h2>{title}</h2>{link}</div>
      <div className="card panel">{children}</div>
    </section>
  );
}

function Empty({ children }) {
  return <p className="panel-empty">{children}</p>;
}

export default function DashboardPage() {
  const q = useApi('dashboard', '/dashboard', { refetchInterval: 30_000 });
  if (q.isLoading) return <div className="stack lg"><LoadingCard /><LoadingCard /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const recent = meaningfulActivity(d.activity, 5);
  const upcoming = [
    ...d.deadlines.map((x) => ({ key: `d-${x.deliverableId}`, to: `/campaigns/${x.campaignId}`, title: x.description, meta: x.campaignTitle, when: x.overdue ? 'Overdue' : `Due ${date(x.dueAt, { day: 'numeric', month: 'short' })}`, tone: x.overdue ? 'danger' : 'warning' })),
    ...d.invoices.map((i) => ({ key: `i-${i._id}`, to: `/campaigns/${i.campaignId}`, title: `Invoice ${i.invoiceNumber} · ${money(i.amountMinor, i.currency)}`, meta: i.status === 'draft' ? 'Draft, not sent yet' : 'Waiting for payment', when: i.status === 'overdue' ? 'Overdue' : `Due ${date(i.dueDate, { day: 'numeric', month: 'short' })}`, tone: i.status === 'overdue' ? 'danger' : '' })),
  ].slice(0, 6);

  return (
    <div className="dashboard">
      <header className="dash-head">
        <h1>{greeting()}{d.profile.publicName ? `, ${firstName(d.profile.publicName)}` : ''}</h1>
        <DiscoveryStatus discovery={d.discovery} />
      </header>

      {/* Two independent columns on desktop; on phones .dash-col becomes display: contents and
          the sections are ordered by priority (see app.css), so nothing leaves a gap. */}
      <div className="dash-cols">
        <div className="dash-col">
          <NeedsYou d={d} />

          <Panel area="matches" title="Brands that match you" link={<Link to="/opportunities" className="small">See all</Link>}>
            {!d.newOpportunities.length ? (
              <Empty>No new matches right now. Discovery keeps looking in the background.</Empty>
            ) : (
              d.newOpportunities.map((o) => {
                const s = SIGNAL[o.signalType] || SIGNAL.low_intent;
                return (
                  <Link key={o._id} to={`/opportunities/${o._id}`} className="row-link">
                    <ScoreBadge score={o.overallScore} />
                    <span className="grow">
                      <span className="row wrap"><span className="strong">{o.brand?.name}</span><DemoBadge show={o.isDemo} label="Demo" /><span className="show-phone"><Badge tone={s.tone}>{s.label}</Badge></span></span>
                      <span className="small muted line-clamp">{o.signalSummary}</span>
                    </span>
                    <span className="hide-phone"><Badge tone={s.tone}>{s.label}</Badge></span>
                  </Link>
                );
              })
            )}
          </Panel>

          <Panel area="recent" title="Recently" link={<Link to="/activity" className="small">Full history</Link>}>
            {!recent.length ? (
              <Empty>Nothing yet. Your pitches, replies and approvals will appear here.</Empty>
            ) : (
              recent.map((e) => (
                <div key={e._id} className="row-link">
                  <span className="grow small">{activitySentence(e)}</span>
                  <span className="tiny faint">{relative(e.timestamp)}</span>
                </div>
              ))
            )}
          </Panel>
        </div>

        <div className="dash-col">
          <MoneyTiles d={d} />

          <Panel area="deals" title="Your deals" link={<Link to="/negotiations" className="small">All deals</Link>}>
            {!d.negotiations.length ? (
              <Empty>When a brand replies to a pitch, the conversation shows up here.</Empty>
            ) : (
              d.negotiations.map((n) => (
                <Link key={n._id} to={`/negotiations/${n._id}`} className="row-link deal-row">
                  <span className="grow">
                    <span className="row wrap"><span className="strong">{n.brand?.name}</span><DemoBadge show={n.brand?.isDemo} label="Demo" /></span>
                    <span className="small muted">{n.currentAmountMinor != null ? `They offered ${money(n.currentAmountMinor, n.currency)}` : `Updated ${relative(n.updatedAt)}`}</span>
                    <span><Badge tone={negotiationTone(n.negotiationState)}>{NEGOTIATION_LABELS[n.negotiationState]}</Badge></span>
                  </span>
                  <Icon name="chevron" size={18} className="faint" />
                </Link>
              ))
            )}
          </Panel>

          <Panel area="upcoming" title="Coming up" link={<Link to="/campaigns" className="small">Campaigns</Link>}>
            {!upcoming.length ? (
              <Empty>No deadlines or unpaid invoices in the next two weeks.</Empty>
            ) : (
              upcoming.map((u) => (
                <Link key={u.key} to={u.to} className="row-link">
                  <span className="grow"><span className="strong truncate">{u.title}</span><span className="small muted truncate">{u.meta}</span></span>
                  <Badge tone={u.tone}>{u.when}</Badge>
                </Link>
              ))
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
