import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';
import { PRIORITY_COLOR } from './ServiceDesk';

interface Policy {
  id: string; priority: string; responseMins: number; resolveMins: number;
  scopeLabel: string; isPlatform: boolean;
}
interface SummaryRow {
  priority: string; total: number; met: number; breached: number; open: number; atRisk: number;
  compliance: number; defaultTarget: { responseMins: number; resolveMins: number } | null;
}

function fmtMins(m: number): string {
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

const SlaEscalations: React.FC = () => {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [breached, setBreached] = useState<any[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/api/itsm/sla');
      setPolicies(res.data?.policies || []);
      setSummary(res.data?.summary || []);
      setBreached(res.data?.breached || []);
      setScope(res.data?.scope || '');
    } catch (err) { setError(apiError(err, 'Failed to load SLA data')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setScanning(true); setNotice('');
    try {
      const res = await apiClient.post('/api/itsm/sla/scan');
      setNotice(res.data?.message || 'Scan complete');
      await load();
    } catch (err) { window.alert(apiError(err)); }
    finally { setScanning(false); }
  };

  const totals = summary.reduce(
    (a, r) => ({ total: a.total + r.total, breached: a.breached + r.breached, atRisk: a.atRisk + r.atRisk }),
    { total: 0, breached: 0, atRisk: 0 }
  );
  const overall = totals.total > 0 ? Math.round(((totals.total - totals.breached) / totals.total) * 100) : 100;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>SLA &amp; escalations</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            A scanner runs every 5 minutes and escalates breaches. Scope: <strong style={{ color: '#93c5fd' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <button onClick={scan} disabled={scanning} style={primaryBtn(scanning)}>
            {scanning ? 'Scanning…' : 'Run escalation scan'}
          </button>
        </div>
      </div>

      <StatStrip items={[
        ['Overall compliance', <span style={{ color: overall >= 95 ? '#86efac' : overall >= 85 ? '#fbbf24' : '#fca5a5' }}>{overall}%</span>],
        ['Tickets measured', totals.total],
        ['Breached', <span style={{ color: totals.breached > 0 ? '#fca5a5' : '#f1f5f9' }}>{totals.breached}</span>],
        ['At risk', <span style={{ color: totals.atRisk > 0 ? '#fbbf24' : '#f1f5f9' }}>{totals.atRisk}</span>],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading SLA data…</div>
      ) : (
        <>
          <h3 style={{ fontSize: 15, color: '#f1f5f9', margin: '0 0 10px' }}>Targets</h3>
          <div style={{ ...S.card, overflowX: 'auto', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={S.headRow}>
                  {['Priority', 'Respond within', 'Resolve within', 'Applies to'].map((h) => <th key={h} style={S.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} style={S.bodyRow}>
                    <td style={{ ...S.td, color: PRIORITY_COLOR[p.priority] || '#cbd5e1' }}>{p.priority}</td>
                    <td style={S.td}>{fmtMins(p.responseMins)}</td>
                    <td style={S.td}>{fmtMins(p.resolveMins)}</td>
                    <td style={S.td}>
                      <span style={p.isPlatform ? pill('#93c5fd', '#1e3a8a') : pill('#c4b5fd', '#5b21b6')}>{p.scopeLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 15, color: '#f1f5f9', margin: '0 0 10px' }}>Compliance by priority</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginBottom: 24 }}>
            {summary.map((r) => (
              <div key={r.priority} style={{ ...S.card, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <strong style={{ fontSize: 13, color: PRIORITY_COLOR[r.priority] || '#cbd5e1' }}>{r.priority}</strong>
                  <span style={{ fontSize: 18, color: r.compliance >= 95 ? '#86efac' : r.compliance >= 85 ? '#fbbf24' : '#fca5a5' }}>
                    {r.compliance}%
                  </span>
                </div>
                <div style={{ height: 6, background: '#0b1220', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{
                    width: `${r.compliance}%`, height: '100%',
                    background: r.compliance >= 95 ? '#15803d' : r.compliance >= 85 ? '#78350f' : '#7f1d1d',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.7 }}>
                  {r.total} total · {r.met} met · <span style={{ color: r.breached > 0 ? '#fca5a5' : '#64748b' }}>{r.breached} breached</span>
                  <br />
                  {r.open} open{r.atRisk > 0 && <span style={{ color: '#fbbf24' }}> · {r.atRisk} at risk</span>}
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 15, color: '#f1f5f9', margin: '0 0 10px' }}>
            Breached tickets {breached.length > 0 && <span style={{ color: '#fca5a5' }}>({breached.length})</span>}
          </h3>
          {breached.length === 0 ? (
            <div style={{ ...S.card, padding: 30, textAlign: 'center', color: '#86efac', borderStyle: 'dashed', borderColor: '#14532d' }}>
              ✓ No SLA breaches in scope.
            </div>
          ) : (
            <div style={{ ...S.card, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={S.headRow}>
                    {['Subject', 'Priority', 'Status', 'Team', 'Escalation'].map((h) => <th key={h} style={S.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {breached.map((t) => (
                    <tr key={t.id} style={S.bodyRow}>
                      <td style={{ ...S.td, color: '#cbd5e1' }}>{t.subject}</td>
                      <td style={{ ...S.td, color: PRIORITY_COLOR[t.priority] || '#cbd5e1' }}>{t.priority}</td>
                      <td style={{ ...S.td, color: '#94a3b8' }}>{t.status}</td>
                      <td style={{ ...S.td, color: '#64748b' }}>{t.assignedTeam || '—'}</td>
                      <td style={S.td}>
                        {t.escalationLevel > 0
                          ? <span style={pill('#fca5a5', '#7f1d1d')}>level {t.escalationLevel}</span>
                          : <span style={{ color: '#475569' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SlaEscalations;
