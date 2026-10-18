import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useAction } from '../api/hooks.js';
import { post } from '../api/client.js';
import { Button, Icon, Modal, EmptyState, Badge } from './ui.jsx';
import { relative } from '../lib/format.js';

export function NotificationsButton() {
  const [open, setOpen] = useState(false);
  const q = useApi('notifications', '/notifications?limit=30', { refetchInterval: 30_000 });
  const readAll = useAction(() => post('/notifications/read-all'), { invalidate: ['notifications'] });
  const readOne = useAction((id) => post(`/notifications/${id}/read`), { invalidate: ['notifications'] });
  const unread = q.data?.unread || 0;
  return (
    <>
      <Button variant="ghost" className="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen(true)} style={{ position: 'relative' }}>
        <Icon name="bell" className="" />
        {unread > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: '50%', background: 'var(--warning)' }} aria-hidden="true" />}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        footer={unread > 0 && <Button size="sm" onClick={() => readAll.mutate()}>Mark all as read</Button>}
      >
        {!q.data?.items?.length ? (
          <EmptyState title="You're all caught up" icon="bell" />
        ) : (
          <div className="list" style={{ margin: '-20px' }}>
            {q.data.items.map((n) => (
              <Link
                key={n._id}
                to={n.link || '/dashboard'}
                className="list-item"
                onClick={() => {
                  if (!n.readAt) readOne.mutate(n._id);
                  setOpen(false);
                }}
              >
                <span className="dot" style={{ color: n.readAt ? 'transparent' : n.severity === 'critical' ? 'var(--danger)' : n.severity === 'warning' ? 'var(--warning)' : 'var(--primary)' }} />
                <div className="grow">
                  <div className={n.readAt ? '' : 'strong'}>{n.title}</div>
                  {n.body && <div className="small muted">{n.body}</div>}
                </div>
                <span className="tiny faint">{relative(n.createdAt)}</span>
                {n.severity === 'critical' && <Badge tone="danger">Action</Badge>}
              </Link>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
