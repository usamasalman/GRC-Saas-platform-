import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';
import Can, { MAY } from '../../components/Can';
import FormDialog from '../../components/FormDialog';
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
  // The list shows the 50 longest overdue; this is how many there are (QA-021).
  const [breachedTotal, setBreachedTotal] = useState(0);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scanning, setScanning] = useState(false);

  // The targets every figure below is measured against. They could not be set:
  // GET /sla reported how tickets were doing and POST /sla/scan re-ran the
  // sweep, but the response and resolve minutes themselves arrived only with
  // the seed.
  const [editingTarget, setEditingTarget] = useState<any>(null);
  const [withoutPolicy, setWithoutPolicy] = useState<string[]>([]);
  const [savingTarget, setSavingTarget] = useState(false);

  const loadPolicies = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/itsm/sla-policies');
      setPolicies(res.data?.policies || []);
      setWithoutPolicy(res.data?.withoutPolicy || []);
    } catch {
      setWithoutPolicy([]);
    }
  }, []);

  const saveTarget = async (values: Record<string, string>) => {
    setSavingTarget(true);
    setError('');
    try {
      const res = await apiClient.put('/api/itsm/sla-policies', {
        priority: values.priority,
        responseMins: Number(values.responseMins),
        resolveMins: Number(values.resolveMins),
      });
      if (res.data?.note) setNotice(res.data.note);
      setEditingTarget(null);
      await loadPolicies();
    } catch (e: any) {
      setError(apiError(e, 'The target could not be saved'));
      setEditingTarget(null);
    } finally {
      setSavingTarget(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/api/itsm/sla');
      setPolicies(res.data?.policies || []);
      setSummary(res.data?.summary || []);
      setBreached(res.data?.breached || []);
      setBreachedTotal(res.data?.breachedTotal ?? (res.data?.breached || []).length);
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
    } catch (err) { setError(apiError(err)); }
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
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>SLA &amp; escalations</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            A scanner runs every 5 minutes and escalates breaches. Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
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
        ['Overall compliance', <span style={{ color: overall >= 95 ? 'var(--success)' : overall >= 85 ? 'var(--warning)' : 'var(--danger)' }}>{overall}%</span>],
        ['Tickets measured', totals.total],
        ['Breached', <span style={{ color: totals.breached > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.breached}</span>],
        ['At risk', <span style={{ color: totals.atRisk > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.atRisk}</span>],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading SLA data…</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <h3 style={{ fontSize: 15, color: 'var(--ink)', margin: '0 0 10px' }}>Targets</h3>
            <Can do={MAY.AUTHOR_WORKFLOW}>
              <button
                onClick={() => { setError(''); setEditingTarget({}); }}
                style={ghostBtn}
                disabled={savingTarget}
              >
                Set a target
              </button>
            </Can>
          </div>

          {withoutPolicy.length > 0 && (
            <div style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 6, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', color: 'var(--warning)', fontSize: 12.5, lineHeight: 1.6 }}>
              {withoutPolicy.join(', ')} {withoutPolicy.length === 1 ? 'has' : 'have'} no target.
              Tickets at {withoutPolicy.length === 1 ? 'that priority' : 'those priorities'} appear
              on the board below measured against nothing.
            </div>
          )}
          <div style={{ ...S.card, overflowX: 'auto', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={S.headRow}>
                  {['Priority', 'Respond within', 'Resolve within', 'Applies to', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id} style={S.bodyRow}>
                    <td style={{ ...S.td, color: PRIORITY_COLOR[p.priority] || 'var(--ink-body)' }}>{p.priority}</td>
                    <td style={S.td}>{fmtMins(p.responseMins)}</td>
                    <td style={S.td}>{fmtMins(p.resolveMins)}</td>
                    <td style={S.td}>
                      <span style={p.isPlatform ? pill('var(--info)', 'var(--info-line)') : pill('var(--violet)', 'var(--violet)')}>{p.scopeLabel}</span>
                    </td>
                    <td style={S.td}>
                      <Can do={MAY.AUTHOR_WORKFLOW}>
                        <button
                          onClick={() => { setError(''); setEditingTarget(p); }}
                          style={ghostBtn}
                          disabled={savingTarget}
                        >
                          Change
                        </button>
                      </Can>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 15, color: 'var(--ink)', margin: '0 0 10px' }}>Compliance by priority</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginBottom: 24 }}>
            {summary.map((r) => (
              <div key={r.priority} style={{ ...S.card, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <strong style={{ fontSize: 13, color: PRIORITY_COLOR[r.priority] || 'var(--ink-body)' }}>{r.priority}</strong>
                  <span style={{ fontSize: 18, color: r.compliance >= 95 ? 'var(--success)' : r.compliance >= 85 ? 'var(--warning)' : 'var(--danger)' }}>
                    {r.compliance}%
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--surface)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{
                    width: `${r.compliance}%`, height: '100%',
                    background: r.compliance >= 95 ? 'var(--success)' : r.compliance >= 85 ? 'var(--warning)' : 'var(--danger)',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                  {r.total} total · {r.met} met · <span style={{ color: r.breached > 0 ? 'var(--danger)' : 'var(--ink-muted)' }}>{r.breached} breached</span>
                  <br />
                  {r.open} open{r.atRisk > 0 && <span style={{ color: 'var(--warning)' }}> · {r.atRisk} at risk</span>}
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 15, color: 'var(--ink)', margin: '0 0 10px' }}>
            Breached tickets {breachedTotal > 0 && (
              <span style={{ color: 'var(--danger)' }}>
                ({breachedTotal > breached.length ? `the ${breached.length} longest overdue of ${breachedTotal}` : breachedTotal})
              </span>
            )}
          </h3>
          {breached.length === 0 ? (
            <div style={{ ...S.card, padding: 30, textAlign: 'center', color: 'var(--success)', borderStyle: 'dashed', borderColor: 'var(--success-line)' }}>
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
                      <td style={{ ...S.td, color: 'var(--ink-body)' }}>{t.subject}</td>
                      <td style={{ ...S.td, color: PRIORITY_COLOR[t.priority] || 'var(--ink-body)' }}>{t.priority}</td>
                      <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{t.status}</td>
                      <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{t.assignedTeam || '—'}</td>
                      <td style={S.td}>
                        {t.escalationLevel > 0
                          ? <span style={pill('var(--danger)', 'var(--danger-line)')}>level {t.escalationLevel}</span>
                          : <span style={{ color: 'var(--ink-body)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editingTarget && (
        <FormDialog
          title={editingTarget.priority ? `Change the ${editingTarget.priority} target` : 'Set a target'}
          intro={
            editingTarget.priority
              ? 'Tickets already open are measured against the new target from now on, so the breach figures may move without any ticket changing.'
              : 'Every SLA figure on this page is measured against these targets.'
          }
          fields={[
            {
              name: 'priority',
              label: 'Priority',
              type: 'select',
              required: true,
              initial: editingTarget.priority || 'P1',
              options: ['P1', 'P2', 'P3', 'P4'],
            },
            {
              name: 'responseMins',
              label: 'Respond within (minutes)',
              type: 'number',
              required: true,
              initial: String(editingTarget.responseMins ?? 60),
            },
            {
              name: 'resolveMins',
              label: 'Resolve within (minutes)',
              type: 'number',
              required: true,
              initial: String(editingTarget.resolveMins ?? 480),
              help: 'Cannot be shorter than the response target — a ticket is not resolved before it is answered.',
            },
          ]}
          submitLabel={savingTarget ? 'Saving…' : 'Save target'}
          busy={savingTarget}
          onSubmit={saveTarget}
          onCancel={() => setEditingTarget(null)}
        />
      )}
    </div>
  );
};

export default SlaEscalations;
