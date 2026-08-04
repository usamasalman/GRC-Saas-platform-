import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, pill, apiError } from '../iam/iamStyles';
import { SLA_PILL, PRIORITY_COLOR } from './ServiceDesk';

interface QueueTicket {
  id: string; subject: string; priority: string; status: string;
  assignee: { id: string; name: string } | null;
  sla: { state: string; minutesRemaining: number | null };
  slaResolveAt: string | null;
}
interface Queue {
  name: string; total: number; breached: number; atRisk: number; unassigned: number;
  byPriority: Record<string, number>; tickets: QueueTicket[];
}

const TicketQueues: React.FC = () => {
  const [queues, setQueues] = useState<Queue[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/api/itsm/queues');
      const qs: Queue[] = res.data?.queues || [];
      setQueues(qs);
      setScope(res.data?.scope || '');
      if (qs[0]) setOpen({ [qs[0].name]: true });
    } catch (err) { setError(apiError(err, 'Failed to load queues')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = queues.reduce(
    (a, q) => ({
      tickets: a.tickets + q.total,
      breached: a.breached + q.breached,
      atRisk: a.atRisk + q.atRisk,
      unassigned: a.unassigned + q.unassigned,
    }),
    { tickets: 0, breached: 0, atRisk: 0, unassigned: 0 }
  );

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Ticket queues</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Open work grouped by assignment group, ordered by breach count. Scope: <strong style={{ color: '#93c5fd' }}>{scope || '—'}</strong>
          </p>
        </div>
        <button onClick={load} style={ghostBtn}>↻ Refresh</button>
      </div>

      <StatStrip items={[
        ['Queues', queues.length],
        ['Open tickets', totals.tickets],
        ['Breached', <span style={{ color: totals.breached > 0 ? '#fca5a5' : '#f1f5f9' }}>{totals.breached}</span>],
        ['At risk', <span style={{ color: totals.atRisk > 0 ? '#fbbf24' : '#f1f5f9' }}>{totals.atRisk}</span>],
        ['Unassigned', <span style={{ color: totals.unassigned > 0 ? '#fbbf24' : '#f1f5f9' }}>{totals.unassigned}</span>],
      ]} />

      {error && <div style={S.error}>{error}</div>}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading queues…</div>
      ) : queues.length === 0 ? (
        <div style={{ ...S.card, padding: 40, textAlign: 'center', color: '#64748b', borderStyle: 'dashed' }}>
          No open tickets in your scope.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {queues.map((q) => {
            const isOpen = !!open[q.name];
            return (
              <div key={q.name} style={{ ...S.card, borderColor: q.breached > 0 ? '#7f1d1d' : '#1e293b' }}>
                <button onClick={() => setOpen((o) => ({ ...o, [q.name]: !o[q.name] }))}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'transparent', border: 'none', padding: '14px 16px', cursor: 'pointer',
                    color: '#e2e8f0', fontFamily: 'inherit', fontSize: 14, textAlign: 'left', gap: 12, flexWrap: 'wrap',
                  }}>
                  <span>{isOpen ? '▾' : '▸'} {q.name}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {Object.entries(q.byPriority).sort().map(([p, n]) => (
                      <span key={p} style={{ fontSize: 11, color: PRIORITY_COLOR[p] || '#94a3b8' }}>{p.split(' ')[0]}:{n}</span>
                    ))}
                    {q.breached > 0 && <span style={pill('#fca5a5', '#7f1d1d')}>{q.breached} breached</span>}
                    {q.unassigned > 0 && <span style={pill('#fbbf24', '#78350f')}>{q.unassigned} unassigned</span>}
                    <span style={{ fontSize: 11, color: '#64748b' }}>{q.total} open</span>
                  </span>
                </button>

                {isOpen && (
                  <div style={{ borderTop: '1px solid #1e293b', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={S.headRow}>
                          {['Subject', 'Priority', 'Status', 'Assignee', 'SLA'].map((h) => <th key={h} style={S.th}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {q.tickets.map((t) => (
                          <tr key={t.id} style={S.bodyRow}>
                            <td style={{ ...S.td, color: '#cbd5e1' }}>{t.subject}</td>
                            <td style={{ ...S.td, color: PRIORITY_COLOR[t.priority] || '#cbd5e1' }}>{t.priority}</td>
                            <td style={{ ...S.td, color: '#94a3b8' }}>{t.status}</td>
                            <td style={{ ...S.td, color: t.assignee ? '#cbd5e1' : '#fbbf24' }}>{t.assignee?.name || 'unassigned'}</td>
                            <td style={S.td}>
                              <span style={SLA_PILL[t.sla.state] || SLA_PILL.none}>{t.sla.state}</span>
                              {t.sla.minutesRemaining !== null && (
                                <span style={{ color: '#475569', fontSize: 10, marginLeft: 6 }}>
                                  {t.sla.minutesRemaining < 0 ? `${Math.abs(t.sla.minutesRemaining)}m over` : `${t.sla.minutesRemaining}m`}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default TicketQueues;
