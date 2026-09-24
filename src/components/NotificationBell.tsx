import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../api/apiClient';
import { S, linkBtn } from '../pages/iam/iamStyles';
import PagingBar, { type PageInfo } from './PagingBar';

/**
 * The inbox the bell never opened.
 *
 * Four endpoints existed — list, unread count, mark one read, mark all read —
 * all routed, all correctly scoped to the recipient so nobody can read another
 * person's mail. Nothing in the frontend called any of them. The bell in the
 * shell was a button with no onClick and a CSS dot that was lit unconditionally,
 * so every user saw a permanent red "you have something" indicator that opened
 * nothing, forever. A notification badge that is always on is worse than none:
 * it teaches people to ignore the one place the product has to tell them
 * something.
 *
 * Every project notification was therefore written to a table nothing read.
 *
 * The count is fetched on its own cheap endpoint rather than by counting the
 * list, because the list arrives a hundred at a time and a count taken from
 * one page under-reports.
 */

interface Note {
  id: string;
  event: string;
  subjectType: string;
  subjectId: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** How often the badge re-checks. Long enough not to be chatty. */
const POLL_MS = 60_000;

const ago = (iso: string): string => {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const NotificationBell: React.FC<{ onNavigate?: (pageKey: string) => void }> = ({ onNavigate }) => {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [page, setPage] = useState(1);
  const [paging, setPaging] = useState<PageInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadCount = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/notifications/unread-count');
      setUnread(res.data?.unread || 0);
    } catch {
      // A badge that cannot be fetched shows nothing rather than a stale or
      // invented number. Silent on purpose: this runs on a timer and an error
      // banner for it would appear over whatever the person is doing.
      setUnread(0);
    }
  }, []);

  useEffect(() => {
    loadCount();
    const timer = setInterval(loadCount, POLL_MS);
    return () => clearInterval(timer);
  }, [loadCount]);

  const loadList = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/notifications', { params: { page: p } });
      setNotes(res.data?.notifications || []);
      setPaging(res.data?.paging || null);
    } catch {
      setError('Your notifications could not be loaded.');
      setNotes([]);
      setPaging(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Opens on the first page, where the unread ones are.
    if (next) { setPage(1); loadList(1); }
  };

  const goTo = (p: number) => { setPage(p); loadList(p); };

  const markRead = async (n: Note) => {
    if (n.readAt) return;
    // Optimistic, because the alternative is a spinner on every row. The count
    // is re-fetched from the server afterwards, so a failed write corrects
    // itself within the poll rather than leaving the badge lying.
    setNotes((prev) => prev.map((x) => (
      x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x
    )));
    setUnread((u) => Math.max(0, u - 1));
    try {
      await apiClient.post(`/api/notifications/${n.id}/read`);
    } finally {
      loadCount();
    }
  };

  const markAllRead = async () => {
    try {
      await apiClient.post('/api/notifications/read-all');
      await Promise.all([loadList(page), loadCount()]);
    } catch {
      setError('They could not be marked read.');
    }
  };

  const openNote = (n: Note) => {
    markRead(n);
    if (n.link && onNavigate) {
      onNavigate(n.link);
      setOpen(false);
    }
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="icon-btn"
        id="notifyBtn"
        title={unread > 0 ? `${unread} unread` : 'Notifications'}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={toggle}
      >
        ♢
        {/* Lit only when there is something. The dot used to be rendered
            unconditionally, so it claimed unread mail on an empty inbox. */}
        {unread > 0 && <i className="notification-dot" />}
      </button>

      {open && (
        <>
          {/* Closes on a click anywhere else, without trapping focus the way a
              modal would — this is a panel, not a decision. */}
          <div
            role="presentation"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          />
          <div
            style={{
              ...S.card,
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              width: 360,
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: 460,
              overflowY: 'auto',
              zIndex: 41,
              padding: 0,
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 10,
              padding: '11px 14px', borderBottom: '1px solid var(--line)',
            }}>
              <strong style={{ fontSize: 13, color: 'var(--ink)' }}>Notifications</strong>
              <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                {unread > 0 ? `${unread} unread` : 'all read'}
              </span>
              {unread > 0 && (
                <button style={{ ...linkBtn, marginLeft: 'auto', fontSize: 11.5 }} onClick={markAllRead}>
                  Mark all read
                </button>
              )}
            </div>

            {error && (
              <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--danger)' }}>{error}</div>
            )}

            {loading && notes.length === 0 && (
              <div style={{ padding: '18px 14px', fontSize: 12.5, color: 'var(--ink-muted)' }}>
                Loading…
              </div>
            )}

            {!loading && notes.length === 0 && !error && (
              <div style={{ padding: '22px 14px', fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
                Nothing yet. You will be told here when work is assigned to you, when something
                you submitted comes back, and when a blocker is raised against your task.
              </div>
            )}

            {notes.map((n) => (
              <button
                key={n.id}
                onClick={() => openNote(n)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '11px 14px', border: 'none', cursor: 'pointer',
                  borderBottom: '1px solid var(--line)',
                  background: n.readAt ? 'transparent' : 'var(--surface-sunk)',
                }}
              >
                <div style={{
                  fontSize: 12.5, lineHeight: 1.5,
                  color: 'var(--ink)', fontWeight: n.readAt ? 400 : 600,
                }}>
                  {n.title}
                </div>
                {n.body && (
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 3, lineHeight: 1.5 }}>
                    {n.body}
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 4 }}>
                  {ago(n.createdAt)}
                </div>
              </button>
            ))}

            <div style={{ padding: '0 12px' }}>
              <PagingBar paging={paging} onPage={goTo} noun="notifications" disabled={loading} />
            </div>
          </div>
        </>
      )}
    </span>
  );
};

export default NotificationBell;
