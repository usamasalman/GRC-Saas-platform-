import React, { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import fetchAllPages from '../../../api/fetchAllPages';
import { S, StatStrip, linkBtn, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';
import { stateLine } from './ClientEngagements';
import type { EngagementCard } from './ClientEngagements';

/**
 * The delivery firm's day across every client (consulting engagement,
 * sprint 6): the engagements it can open, access ending soon, engagements
 * waiting to start or for approval, invitations waiting, and the reader's
 * overdue tasks by client. Counts only what exists today; requests and
 * challenges join it when they are built.
 */

interface Task { id: string; ref: string; name: string; dueDate: string | null; status: string; project: { id: string; ref: string; name: string; client: string | null } }

const PartnerHome: React.FC<{ onOpen: (p: { id: string; ref: string; name: string }) => void; onInvitations: () => void }> = ({ onOpen, onInvitations }) => {
  const [cards, setCards] = useState<EngagementCard[] | null>(null);
  const [invitations, setInvitations] = useState(0);
  const [overdue, setOverdue] = useState<Task[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      fetchAllPages<EngagementCard>('/api/engagements/mine', 'engagements'),
      fetchAllPages<{ state: string }>('/api/engagements/invitations', 'invitations', { box: 'received' }).catch(() => []),
      apiClient.get('/api/projects/my-work').then((r) => (r.data?.tasks || []) as Task[]).catch(() => [] as Task[]),
    ])
      .then(([c, inv, tasks]) => {
        setCards(c);
        setInvitations(inv.filter((i) => i.state === 'Pending').length);
        setOverdue(tasks.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < today && !['Done', 'Verified'].includes(t.status)));
      })
      .catch((err) => { setError(apiError(err, 'Could not load your engagements.')); setCards([]); });
  }, []);

  if (!cards) return <div style={{ color: 'var(--ink-muted)', padding: 20 }}>Loading…</div>;
  const open = cards.filter((c) => c.canOpen);
  const ending = cards.filter((c) => c.accessEndsSoon);
  const waiting = cards.filter((c) => c.state === 'NotStarted' || c.state === 'AwaitingApproval');
  const byClient = overdue.reduce<Record<string, Task[]>>((m, t) => {
    const k = t.project.client || 'Your firm';
    (m[k] ||= []).push(t);
    return m;
  }, {});

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}
      <StatStrip items={[
        ['Engagements you can open', open.length],
        ['Access ending within 7 days', <span style={{ color: ending.length ? 'var(--warning)' : undefined }}>{ending.length}</span>],
        ['Waiting to start or for approval', waiting.length],
        ['Invitations waiting', invitations],
        ['Your overdue tasks', <span style={{ color: overdue.length ? 'var(--danger)' : undefined }}>{overdue.length}</span>],
      ]} />
      {invitations > 0 && (
        <div style={{ margin: '0 0 14px', fontSize: 12.5 }}>
          <button style={linkBtn('var(--info)')} onClick={onInvitations}>Answer the invitations waiting for your firm</button>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <div style={{ ...S.card, padding: 16 }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Engagements</div>
          {cards.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>No client engagements yet.</div>}
          {cards.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', fontSize: 12.5 }}>
              <span style={{ flex: 1 }}>
                <strong>{c.client}</strong> · {c.name}
                <span style={{ display: 'block', fontSize: 11.5, color: c.accessEndsSoon ? 'var(--warning)' : 'var(--ink-muted)' }}>{stateLine(c)}</span>
              </span>
              {c.canOpen && <button style={linkBtn('var(--info)')} onClick={() => onOpen(c)}>Open</button>}
            </div>
          ))}
        </div>
        <div style={{ ...S.card, padding: 16 }}>
          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Your overdue tasks</div>
          {overdue.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Nothing overdue.</div>}
          {Object.entries(byClient).map(([client, tasks]) => (
            <div key={client} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{client}</div>
              {tasks.map((t) => (
                <div key={t.id} style={{ fontSize: 12.5, padding: '2px 0' }}>
                  {t.ref} · {t.name} <span style={{ color: 'var(--danger)' }}>due {calendarDate(t.dueDate)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PartnerHome;
