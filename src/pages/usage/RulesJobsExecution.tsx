import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill } from '../iam/iamStyles';

interface AutomationExecution {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  outcome?: string;
  errorMessage?: string;
}

interface Rule {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  triggerType: string;
  triggerConfig: string | null;
  actionConfig: string;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  failCount: number;
  tenant?: { id: string; name: string };
  executions?: AutomationExecution[];
}

const now = Date.now();
const DEFAULT_RULES: Rule[] = [
  { id: 'R-01', tenantId: 'T1', name: 'Daily Compliance Sync', description: 'Pull NCA ECC updates and sync control mappings to tenant standards library.', triggerType: 'Scheduled', triggerConfig: '0 2 * * *', actionConfig: '{}', status: 'Active', lastRunAt: new Date(now - 86400000).toISOString(), nextRunAt: new Date(now + 86400000).toISOString(), runCount: 142, failCount: 2, tenant: { id: 'T1', name: 'Al-Rajhi Holding Group' }, executions: [] },
  { id: 'R-02', tenantId: 'T1', name: 'SLA Breach Escalation', description: 'Monitor open tickets approaching SLA breach and escalate to manager.', triggerType: 'Event', triggerConfig: 'ticket.sla_warning', actionConfig: '{}', status: 'Active', lastRunAt: new Date(now - 3600000).toISOString(), nextRunAt: null, runCount: 87, failCount: 0, tenant: { id: 'T1', name: 'Al-Rajhi Holding Group' }, executions: [] },
  { id: 'R-03', tenantId: 'T1', name: 'Weekly Risk Report', description: 'Generate consolidated risk report PDF and email to risk committee.', triggerType: 'Scheduled', triggerConfig: '0 8 * * 1', actionConfig: '{}', status: 'Active', lastRunAt: new Date(now - 604800000).toISOString(), nextRunAt: new Date(now + 604800000).toISOString(), runCount: 26, failCount: 1, tenant: { id: 'T1', name: 'Al-Rajhi Holding Group' }, executions: [] },
  { id: 'R-04', tenantId: 'T1', name: 'User Deprovisioning', description: 'Auto-disable users 90 days after last login and revoke API keys.', triggerType: 'Scheduled', triggerConfig: '0 0 * * *', actionConfig: '{}', status: 'Paused', lastRunAt: new Date(now - 172800000).toISOString(), nextRunAt: null, runCount: 8, failCount: 0, tenant: { id: 'T1', name: 'Al-Rajhi Holding Group' }, executions: [] },
  { id: 'R-05', tenantId: 'T1', name: 'Evidence Collection Reminder', description: 'Send reminder notifications for controls with evidence due within 7 days.', triggerType: 'Scheduled', triggerConfig: '0 9 * * *', actionConfig: '{}', status: 'Active', lastRunAt: new Date(now - 86400000).toISOString(), nextRunAt: new Date(now + 86400000).toISOString(), runCount: 54, failCount: 3, tenant: { id: 'T1', name: 'Al-Rajhi Holding Group' }, executions: [] },
];

const STATUS_PILL: Record<string, React.CSSProperties> = {
  Active:   pill('var(--success)', 'var(--success-line)'),
  Paused:   pill('var(--warning)', 'var(--warning-line)'),
  Failed:   pill('var(--danger)', 'var(--danger-line)'),
  Disabled: pill('var(--ink-muted)', 'var(--line)'),
};

const TRIGGER_PILL: Record<string, React.CSSProperties> = {
  Scheduled: pill('var(--info)', 'var(--info-line)'),
  Event:     pill('var(--violet)', 'var(--violet)'),
  Manual:    pill('var(--ink-muted)', 'var(--line)'),
};

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const RulesJobsExecution: React.FC = () => {
  const [rules, setRules] = useState<Rule[]>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Create modal
  const [modalOpen, setModalOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formTrigger, setFormTrigger] = useState('Scheduled');
  const [formConfig, setFormConfig] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadRules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/usage/rules');
      if (res.data?.rules && res.data.rules.length > 0) {
        setRules(res.data.rules);
      }
    } catch {
      setRules(DEFAULT_RULES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  const handleToggle = async (rule: Rule) => {
    setTogglingId(rule.id);
    try {
      const res = await apiClient.patch(`/api/usage/rules/${rule.id}/toggle`);
      if (res.data?.rule) {
        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, ...res.data.rule, executions: r.executions } : r));
      } else {
        const next = rule.status === 'Active' ? 'Paused' : 'Active';
        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, status: next } : r));
      }
      setNotice(`"${rule.name}" ${rule.status === 'Active' ? 'paused' : 'resumed'}.`);
    } catch {
      const next = rule.status === 'Active' ? 'Paused' : 'Active';
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, status: next } : r));
      setNotice(`"${rule.name}" toggled locally.`);
    } finally {
      setTogglingId(null);
    }
  };

  const handleRunNow = async (rule: Rule) => {
    setRunningId(rule.id);
    try {
      const res = await apiClient.post(`/api/usage/rules/${rule.id}/run`);
      if (res.data?.execution) {
        const exec = res.data.execution;
        setRules(prev => prev.map(r => r.id === rule.id ? {
          ...r,
          lastRunAt: new Date().toISOString(),
          runCount: r.runCount + 1,
          failCount: exec.status === 'Failed' ? r.failCount + 1 : r.failCount,
          executions: [exec, ...(r.executions || [])].slice(0, 10)
        } : r));
        setNotice(`"${rule.name}" executed — ${exec.status}.`);
      }
    } catch {
      setNotice(`"${rule.name}" execution triggered (offline mode).`);
    } finally {
      setRunningId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/usage/rules', {
        name: formName.trim(),
        description: formDesc.trim(),
        triggerType: formTrigger,
        triggerConfig: formConfig.trim() || null,
      });
      if (res.data?.rule) {
        setRules(prev => [{ ...res.data.rule, executions: [] }, ...prev]);
      } else {
        const local: Rule = {
          id: `R-${Date.now().toString().slice(-5)}`,
          tenantId: '', name: formName.trim(), description: formDesc.trim(),
          triggerType: formTrigger, triggerConfig: formConfig.trim() || null,
          actionConfig: '{}', status: 'Active', lastRunAt: null,
          nextRunAt: formTrigger === 'Scheduled' ? new Date(Date.now() + 3600000).toISOString() : null,
          runCount: 0, failCount: 0, executions: []
        };
        setRules(prev => [local, ...prev]);
      }
      setNotice(`Rule "${formName.trim()}" created.`);
    } catch {
      const local: Rule = {
        id: `R-${Date.now().toString().slice(-5)}`,
        tenantId: '', name: formName.trim(), description: formDesc.trim(),
        triggerType: formTrigger, triggerConfig: formConfig.trim() || null,
        actionConfig: '{}', status: 'Active', lastRunAt: null,
        nextRunAt: formTrigger === 'Scheduled' ? new Date(Date.now() + 3600000).toISOString() : null,
        runCount: 0, failCount: 0, executions: []
      };
      setRules(prev => [local, ...prev]);
      setNotice(`Rule "${formName.trim()}" created locally.`);
    } finally {
      setModalOpen(false);
      setFormName(''); setFormDesc(''); setFormTrigger('Scheduled'); setFormConfig('');
      setSubmitting(false);
    }
  };

  const activeCount = rules.filter(r => r.status === 'Active').length;
  const scheduledCount = rules.filter(r => r.triggerType === 'Scheduled').length;
  const totalExecs = rules.reduce((s, r) => s + r.runCount, 0);
  const totalFails = rules.reduce((s, r) => s + r.failCount, 0);
  const failRate = totalExecs > 0 ? ((totalFails / totalExecs) * 100).toFixed(1) : '0.0';

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Rules, Jobs & Execution</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={ghostBtn} onClick={loadRules} disabled={loading}>↻ Refresh</button>
          <button style={primaryBtn()} onClick={() => setModalOpen(true)}>+ Create Rule</button>
        </div>
      </div>

      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 12, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notice}</span>
          <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }} onClick={() => setNotice('')}>✕</button>
        </div>
      )}
      {error && <div style={S.error}>{error}</div>}

      <StatStrip items={[
        ['Active Rules', activeCount],
        ['Scheduled Jobs', scheduledCount],
        ['Total Executions', totalExecs],
        ['Failure Rate', <span style={{ color: Number(failRate) > 5 ? 'var(--danger)' : 'var(--success)' }}>{failRate}%</span>],
      ]} />

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 24 }}>Loading rules…</div>
      ) : (
        <div style={{ ...S.card, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={{ ...S.th, width: 28 }}></th>
                <th style={S.th}>Rule / Job</th>
                <th style={S.th}>Trigger</th>
                <th style={S.th}>Schedule / Event</th>
                <th style={S.th}>Last Run</th>
                <th style={S.th}>Next Run</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Runs</th>
                <th style={S.th}>Status</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <React.Fragment key={r.id}>
                  <tr style={S.bodyRow}>
                    <td style={{ ...S.td, cursor: 'pointer', textAlign: 'center' }} onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                      <span style={{ transition: 'transform 0.2s', display: 'inline-block', transform: expandedId === r.id ? 'rotate(90deg)' : 'none', fontSize: 10 }}>▶</span>
                    </td>
                    <td style={S.td}>
                      <div style={{ fontWeight: 500, color: 'var(--ink-body)' }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</div>
                    </td>
                    <td style={S.td}><span style={TRIGGER_PILL[r.triggerType] || TRIGGER_PILL.Manual}>{r.triggerType}</span></td>
                    <td style={{ ...S.td, fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{r.triggerConfig || '—'}</td>
                    <td style={S.td}>{fmtDate(r.lastRunAt)}</td>
                    <td style={S.td}>{fmtDate(r.nextRunAt)}</td>
                    <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {r.runCount}
                      {r.failCount > 0 && <span style={{ color: 'var(--danger)', fontSize: 10, marginLeft: 4 }}>({r.failCount} fail)</span>}
                    </td>
                    <td style={S.td}><span style={STATUS_PILL[r.status] || STATUS_PILL.Disabled}>{r.status}</span></td>
                    <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11, marginRight: 4 }}
                        onClick={() => handleRunNow(r)}
                        disabled={runningId === r.id || r.status === 'Disabled'}
                      >{runningId === r.id ? '…' : '▶ Run'}</button>
                      <button
                        style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11 }}
                        onClick={() => handleToggle(r)}
                        disabled={togglingId === r.id}
                      >{r.status === 'Active' ? '⏸ Pause' : '▶ Resume'}</button>
                    </td>
                  </tr>
                  {/* Execution history expandable row */}
                  {expandedId === r.id && (
                    <tr>
                      <td colSpan={9} style={{ padding: '0 12px 12px 40px', background: '#080f1a' }}>
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 6, marginTop: 8 }}>Recent Executions</div>
                        {(!r.executions || r.executions.length === 0) ? (
                          <div style={{ color: 'var(--ink-body)', fontSize: 12, padding: '8px 0' }}>No executions recorded yet.</div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ color: 'var(--ink-body)' }}>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Started</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Duration</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Status</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>Outcome</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.executions.map(ex => (
                                <tr key={ex.id} style={{ borderBottom: '1px solid var(--line)' }}>
                                  <td style={{ padding: '4px 8px' }}>{fmtDate(ex.startedAt)}</td>
                                  <td style={{ padding: '4px 8px' }}>{ex.durationMs ? `${(ex.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                                  <td style={{ padding: '4px 8px' }}>
                                    <span style={ex.status === 'Completed' ? pill('var(--success)', 'var(--success-line)') : ex.status === 'Failed' ? pill('var(--danger)', 'var(--danger-line)') : pill('var(--info)', 'var(--info-line)')}>{ex.status}</span>
                                  </td>
                                  <td style={{ padding: '4px 8px', color: ex.errorMessage ? 'var(--danger)' : 'var(--ink-muted)' }}>{ex.errorMessage || ex.outcome || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {rules.length === 0 && (
                <tr><td colSpan={9} style={{ ...S.td, textAlign: 'center', color: 'var(--ink-muted)', padding: 32 }}>No automation rules configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Rule Modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900 }} onClick={() => setModalOpen(false)}>
          <form onSubmit={handleCreate} onClick={e => e.stopPropagation()} style={{ ...S.card, padding: 28, width: 460, maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--ink)' }}>Create Automation Rule</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Rule Name</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} style={S.input} required autoFocus placeholder="e.g. Nightly Backup Verification" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Description</label>
              <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} style={{ ...S.input, minHeight: 60, resize: 'vertical' }} placeholder="What does this rule do?" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Trigger Type</label>
                <select value={formTrigger} onChange={e => setFormTrigger(e.target.value)} style={S.input}>
                  <option value="Scheduled">Scheduled (Cron)</option>
                  <option value="Event">Event-Driven</option>
                  <option value="Manual">Manual Only</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>
                  {formTrigger === 'Scheduled' ? 'Cron Expression' : formTrigger === 'Event' ? 'Event Key' : 'N/A'}
                </label>
                <input
                  value={formConfig}
                  onChange={e => setFormConfig(e.target.value)}
                  style={S.input}
                  placeholder={formTrigger === 'Scheduled' ? '0 2 * * *' : formTrigger === 'Event' ? 'ticket.created' : '—'}
                  disabled={formTrigger === 'Manual'}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button type="button" style={ghostBtn} onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="submit" style={primaryBtn(submitting)} disabled={submitting}>{submitting ? 'Creating…' : 'Create Rule'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default RulesJobsExecution;
