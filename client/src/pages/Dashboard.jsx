import { Link } from 'react-router-dom';
import { useApi } from '../api/hooks.js';
import { DiscoveryControl } from '../components/DiscoveryControl.jsx';
import { Badge, Card, DemoBadge, EmptyState, ErrorState, Icon, LoadingCard, ScoreBadge } from '../components/ui.jsx';
import { money, date, relative, NEGOTIATION_LABELS, negotiationTone, humanize } from '../lib/format.js';

const ACTION_LABELS = { send_pitch: 'Pitch', send_follow_up: 'Follow-up', send_counteroffer: 'Counteroffer', send_reply: 'Reply', accept_offer: 'Accept offer', decline_offer: 'Decline offer', send_payment_reminder: 'Payment reminder' };

export default function DashboardPage() {
  const q = useApi('dashboard', '/dashboard', { refetchInterval: 30_000 });
  if (q.isLoading) return <div className="stack lg"><LoadingCard /><LoadingCard /></div>;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const cur = d.profile.currency;

  return (
    <div className="stack lg">
      <div className="page-header">
        <div>
          <h1>Creator HQ</h1>
          <p>Good to see you{d.profile.publicName ? `, ${d.profile.publicName}` : ''}. Autonomy: Level {d.profile.autonomyLevel}.</p>
        </div>
      </div>

      {d.nextActions.length > 0 && (
        <section className="card" aria-label="Next actions">
          <div className="list">
            {d.nextActions.map((a) => (
              <Link key={a.kind} to={a.link} className="list-item">
                <Icon name={a.kind === 'worker' ? 'alert' : a.kind === 'approvals' ? 'shield' : 'sparkle'} />
                <span className="grow strong">{a.label}</span>
                <span className="faint">→</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <DiscoveryControl compact />

      <section className="grid cols-4" aria-label="Outcomes">
        {[
          ['Pitches sent', d.outcomes.pitchesSent],
          ['Positive replies', d.outcomes.positiveReplies],
          ['Active negotiations', d.outcomes.activeNegotiations],
          ['Deals won', d.outcomes.dealsWon],
        ].map(([label, value]) => (
          <div key={label} className="card stat">
            <div className="value">{value}</div>
            <div className="label">{label}</div>
          </div>
        ))}
      </section>
      <p className="tiny faint" style={{ marginTop: -12 }}>
        Reported revenue {money(d.outcomes.revenueReportedMinor, cur)} — {d.outcomes.revenueNote}
      </p>

      <div className="grid cols-2">
        <Card title="Pending approvals" actions={<Link to="/approvals" className="small">View all</Link>} bodyClass="">
          {d.pendingApprovals.count === 0 ? (
            <EmptyState title="Nothing waiting for you" icon="shield">AI drafts that need your sign-off appear here.</EmptyState>
          ) : (
            <div className="list">
              {d.pendingApprovals.items.map((a) => (
                <Link key={a._id} to={`/approvals?focus=${a._id}`} className="list-item">
                  <Badge tone="warning">{ACTION_LABELS[a.actionType] || a.actionType}</Badge>
                  <span className="grow truncate">{a.brandName || '—'}</span>
                  <span className="tiny faint">expires {relative(a.expiresAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Active negotiations" actions={<Link to="/negotiations" className="small">View all</Link>} bodyClass="">
          {!d.negotiations.length ? (
            <EmptyState title="No active negotiations" icon="scale">When a brand replies to your outreach, the negotiation shows up here.</EmptyState>
          ) : (
            <div className="list">
              {d.negotiations.map((n) => (
                <Link key={n._id} to={`/negotiations/${n._id}`} className="list-item">
                  <span className="grow truncate strong">{n.brand?.name}</span>
                  <DemoBadge show={n.brand?.isDemo} label="Demo" />
                  {n.currentAmountMinor != null && <span className="num small">{money(n.currentAmountMinor, n.currency)}</span>}
                  <Badge tone={negotiationTone(n.negotiationState)}>{NEGOTIATION_LABELS[n.negotiationState]}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="New opportunities" actions={<Link to="/opportunities" className="small">Open discovery</Link>} bodyClass="">
          {!d.newOpportunities.length ? (
            <EmptyState title="No new opportunities" icon="search">Start or run discovery to find brands with a reason to collaborate now.</EmptyState>
          ) : (
            <div className="list">
              {d.newOpportunities.map((o) => (
                <Link key={o._id} to={`/opportunities/${o._id}`} className="list-item">
                  <ScoreBadge score={o.overallScore} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row"><span className="strong truncate">{o.brand?.name}</span><DemoBadge show={o.isDemo} label="Demo" /></div>
                    <div className="small muted truncate">{o.signalSummary}</div>
                  </div>
                  <Badge tone={o.signalType === 'high_intent' ? 'success' : o.signalType === 'medium_intent' ? 'info' : ''}>{humanize(o.signalType)}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Upcoming deadlines" actions={<Link to="/campaigns" className="small">Campaigns</Link>} bodyClass="">
          {!d.deadlines.length ? (
            <EmptyState title="No deadlines in the next 14 days" icon="calendar" />
          ) : (
            <div className="list">
              {d.deadlines.map((x) => (
                <Link key={x.deliverableId} to={`/campaigns/${x.campaignId}`} className="list-item">
                  <Icon name="calendar" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong truncate">{x.description}</div>
                    <div className="small muted truncate">{x.campaignTitle}</div>
                  </div>
                  <Badge tone={x.overdue ? 'danger' : 'warning'}>{x.overdue ? 'Overdue' : date(x.dueAt)}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Outstanding invoices" bodyClass="">
          {!d.invoices.length ? (
            <EmptyState title="No outstanding invoices" icon="briefcase" />
          ) : (
            <div className="list">
              {d.invoices.map((i) => (
                <Link key={i._id} to={`/campaigns/${i.campaignId}`} className="list-item">
                  <span className="mono">{i.invoiceNumber}</span>
                  <span className="grow num">{money(i.amountMinor, i.currency)}</span>
                  <span className="small muted">due {date(i.dueDate)}</span>
                  <Badge tone={i.status === 'overdue' ? 'danger' : i.status === 'issued' ? 'info' : ''}>{humanize(i.status)}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card title="Recent activity" actions={<Link to="/activity" className="small">Full history</Link>} bodyClass="">
          {!d.activity.length ? (
            <EmptyState title="No activity yet" icon="activity" />
          ) : (
            <div className="list">
              {d.activity.map((e) => (
                <div key={e._id} className="list-item small">
                  <Badge tone={e.actorType === 'ai' ? 'ai' : e.actorType === 'creator' ? 'primary' : ''}>{e.actorType}</Badge>
                  <span className="grow truncate">{humanize(e.eventType.replace('.', ' · '))}</span>
                  <span className="tiny faint">{relative(e.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
