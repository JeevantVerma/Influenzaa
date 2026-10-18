import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApi, useAction } from '../api/hooks.js';
import { post } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Icon, Button } from './ui.jsx';
import { NotificationsButton } from './Notifications.jsx';

const NAV = [
  { to: '/dashboard', label: 'Creator HQ', icon: 'home' },
  { to: '/opportunities', label: 'Sponsor discovery', icon: 'search' },
  { to: '/inbox', label: 'Inbox', icon: 'inbox' },
  { to: '/negotiations', label: 'Negotiations', icon: 'scale' },
  { to: '/approvals', label: 'Approvals', icon: 'shield', countKey: 'approvals' },
  { to: '/campaigns', label: 'Campaigns', icon: 'briefcase' },
  { to: '/activity', label: 'Activity', icon: 'activity' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { user, clear } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const approvals = useApi(['approvals', 'pending', 'count'], '/approvals?status=pending&limit=1', { refetchInterval: 30_000 });
  const integrations = useApi('integrations', '/integrations', { staleTime: 60_000 });
  const logout = useAction(() => post('/auth/logout'), {
    onSuccess: () => {
      clear();
      navigate('/login');
    },
  });
  const counts = { approvals: approvals.data?.total || 0 };
  const demo = integrations.data?.email?.mode === 'demo' || integrations.data?.ai?.provider === 'mock';

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary">
        <div className="brandmark">
          <span className="logo" aria-hidden="true">C</span>
          CreatorOS
        </div>
        <nav className="nav" onClick={() => setOpen(false)}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive || (n.to === '/negotiations' && location.pathname.startsWith('/negotiations')) ? 'active' : '')}>
              <Icon name={n.icon} />
              {n.label}
              {n.countKey && counts[n.countKey] > 0 && <span className="count" aria-label={`${counts[n.countKey]} pending`}>{counts[n.countKey]}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {demo && (
            <div className="callout demo small" role="note">
              <span>
                <strong>Demo mode.</strong> {integrations.data?.email?.mode === 'demo' ? 'Emails are simulated, never delivered.' : ''} {integrations.data?.ai?.provider === 'mock' ? 'AI is a rule-based mock.' : ''}
              </span>
            </div>
          )}
          <div className="row small">
            <Icon name="user" />
            <span className="truncate grow" title={user?.email}>{user?.name}</span>
          </div>
          <Button variant="ghost" size="sm" icon="logout" onClick={() => logout.mutate()} loading={logout.isPending}>
            Sign out
          </Button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <div className="main">
        <header className="topbar">
          <Button variant="ghost" className="icon menu-btn" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <Icon name="menu" className="" />
          </Button>
          <div className="grow" />
          <NotificationsButton />
        </header>
        <main className="content" id="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
