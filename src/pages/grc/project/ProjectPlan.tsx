import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/apiClient';
import { S, pill, ghostBtn } from '../../iam/iamStyles';

/**
 * The work breakdown for one project: phases, and the tasks beneath them.
 *
 * Status is edited in place. Every change returns the recomputed rollup from the
 * server, so the phase and project figures repaint from that response rather
 * than from a second request or a guess made here — the browser never computes
 * a percentage of its own.
 */

interface Timing {
  overdue: boolean;
  daysOverdue: number;
  dueSoon: boolean;
  daysUntilDue: number | null;
}

interface Task {
  id: string;
  ref: string;
  name: string;
  description: string | null;
  status: string;
  completionPercent: number;
  weight: number;
  priority: string;
  side: string;
  department: string | null;
  dueDate: string | null;
  assignee: { id: string; name: string } | null;
  timing: Timing;
}

interface Phase {
  id: string;
  sequence: number;
  name: string;
  description: string | null;
  status: string;
  reportedProgress: number;
  verifiedProgress: number;
  startDate: string;
  targetEndDate: string;
  owner: { id: string; name: string } | null;
  tasks: Task[];
  counts: { total: number; done: number; inProgress: number; blocked: number; overdue: number };
}

interface Totals {
  phases: number; tasks: number; done: number; blocked: number; overdue: number; dueSoon: number;
}

const TASK_STATUS: Record<string, { label: string; fg: string; line: string }> = {
  NotStarted: { label: 'Not started', fg: 'var(--ink-muted)', line: 'var(--line)' },
  InProgress: { label: 'In progress', fg: 'var(--info)', line: 'var(--info-line)' },
  Blocked: { label: 'Blocked', fg: 'var(--danger)', line: 'var(--danger-line)' },
  Done: { label: 'Done', fg: 'var(--success)', line: 'var(--success-line)' },
};

const PHASE_STATUS: Record<string, { label: string; fg: string; line: string }> = {
  NotStarted: { label: 'Not started', fg: 'var(--ink-muted)', line: 'var(--line)' },
  InProgress: { label: 'In progress', fg: 'var(--info)', line: 'var(--info-line)' },
  Blocked: { label: 'Blocked', fg: 'var(--danger)', line: 'var(--danger-line)' },
  Complete: { label: 'Complete', fg: 'var(--success)', line: 'var(--success-line)' },
};

/**
 * Which moves the server will accept from here.
 *
 * Mirrors TASK_TRANSITIONS in projectLifecycle so the dropdown never offers a
 * move that will be refused. The server remains the authority — this only
 * spares the user a rejection they could not have predicted.
 */
const ALLOWED_NEXT: Record<string, string[]> = {
  NotStarted: ['NotStarted', 'InProgress', 'Blocked'],
  InProgress: ['InProgress', 'Blocked', 'Done', 'NotStarted'],
  Blocked: ['Blocked', 'InProgress', 'NotStarted'],
  Done: ['Done', 'InProgress'],
};

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—';

const apiError = (err: any): string =>
  err?.response?.data?.message || 'Something went wrong. Please try again.';

const Bar: React.FC<{ reported: number; verified: number; width?: number }> = ({
  reported, verified, width = 120,
}) => (
  <div style={{ width }}>
    <div style={{ height: 6, background: 'var(--surface-sunk)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${reported}%`, height: '100%', background: 'var(--info)' }} />
    </div>
    <div style={{ height: 4, background: 'var(--surface-sunk)', borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
      <div style={{ width: `${verified}%`, height: '100%', background: 'var(--success)' }} />
    </div>
    <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
      {reported}% reported · {verified}% verified
    </div>
  </div>
);

const ProjectPlan: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/api/projects/${projectId}/plan`);
      setPhases(res.data?.phases || []);
      setTotals(res.data?.totals || null);
    } catch (err: any) {
      setError(apiError(err));
      setPhases([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Change a task and repaint from the rollup the server returns.
   *
   * The alternative — patch, then refetch the whole plan — costs a round trip
   * and makes the tree flicker on every dropdown. The response already carries
   * every figure that moved.
   */
  const changeTask = async (task: Task, patch: Record<string, unknown>) => {
    setBusyTask(task.id);
    setError('');
    try {
      const res = await apiClient.patch(`/api/projects/tasks/${task.id}`, patch);
      const updated = res.data?.task;
      const rollup = res.data?.rollup;

      setPhases((prev) => prev.map((ph) => {
        const rolled = rollup?.phases?.find((r: any) => r.id === ph.id);
        const tasks = ph.tasks.map((t) => (t.id === task.id ? { ...t, ...updated } : t));
        const done = tasks.filter((t) => t.status === 'Done').length;
        return {
          ...ph,
          tasks,
          ...(rolled ? {
            reportedProgress: rolled.reported,
            verifiedProgress: rolled.verified,
            status: rolled.status,
          } : {}),
          counts: {
            ...ph.counts,
            done,
            inProgress: tasks.filter((t) => t.status === 'InProgress').length,
            blocked: tasks.filter((t) => t.status === 'Blocked').length,
          },
        };
      }));
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusyTask(null);
    }
  };

  const toggle = (phaseId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId); else next.add(phaseId);
      return next;
    });

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading the plan…</div>;
  }

  return (
    <div>
      {error && (
        <div style={{
          ...S.card, padding: '12px 16px', marginBottom: 14,
          borderLeft: '3px solid var(--danger)', color: 'var(--danger)', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {totals && phases.length > 0 && (
        <div style={{ display: 'flex', gap: 18, marginBottom: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span style={{ color: 'var(--ink-muted)' }}>
            <strong style={{ color: 'var(--ink)' }}>{totals.phases}</strong> phases
          </span>
          <span style={{ color: 'var(--ink-muted)' }}>
            <strong style={{ color: 'var(--ink)' }}>{totals.done}</strong> of {totals.tasks} tasks done
          </span>
          {totals.blocked > 0 && (
            <span style={{ color: 'var(--danger)' }}><strong>{totals.blocked}</strong> blocked</span>
          )}
          {totals.overdue > 0 && (
            <span style={{ color: 'var(--danger)' }}><strong>{totals.overdue}</strong> overdue</span>
          )}
          {totals.dueSoon > 0 && (
            <span style={{ color: 'var(--warning)' }}><strong>{totals.dueSoon}</strong> due this week</span>
          )}
          <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={load}>Refresh</button>
        </div>
      )}

      {phases.length === 0 ? (
        <div style={{ ...S.card, padding: '44px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            No phases yet
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 460, margin: '0 auto' }}>
            Break the engagement into phases — scoping, gap assessment, remediation, internal audit —
            then add the tasks each one needs. Progress rolls up on its own from there.
          </div>
        </div>
      ) : (
        phases.map((ph) => {
          const st = PHASE_STATUS[ph.status] || PHASE_STATUS.NotStarted;
          const isCollapsed = collapsed.has(ph.id);

          return (
            <div key={ph.id} style={{ ...S.card, marginBottom: 14, overflow: 'hidden' }}>
              <div
                style={{
                  padding: '14px 18px', display: 'flex', alignItems: 'center',
                  gap: 14, flexWrap: 'wrap', cursor: 'pointer',
                  borderBottom: isCollapsed ? 'none' : '1px solid var(--line)',
                }}
                onClick={() => toggle(ph.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(ph.id); } }}
                aria-expanded={!isCollapsed}
              >
                <span style={{ color: 'var(--ink-faint)', fontSize: 12, width: 14 }}>
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <div style={{ minWidth: 200, flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                    <span style={{ color: 'var(--ink-faint)', marginRight: 8, fontVariantNumeric: 'tabular-nums' }}>
                      {ph.sequence}
                    </span>
                    {ph.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                    {fmtDate(ph.startDate)} → {fmtDate(ph.targetEndDate)}
                    {ph.owner && ` · ${ph.owner.name}`}
                  </div>
                </div>

                <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                  {ph.counts.done}/{ph.counts.total} done
                  {ph.counts.blocked > 0 && (
                    <span style={{ color: 'var(--danger)' }}> · {ph.counts.blocked} blocked</span>
                  )}
                  {ph.counts.overdue > 0 && (
                    <span style={{ color: 'var(--danger)' }}> · {ph.counts.overdue} overdue</span>
                  )}
                </div>

                <Bar reported={ph.reportedProgress} verified={ph.verifiedProgress} />
                <span style={pill(st.fg, st.line)}>{st.label}</span>
              </div>

              {!isCollapsed && (
                <div style={{ overflowX: 'auto' }}>
                  {ph.tasks.length === 0 ? (
                    <div style={{ padding: '20px 18px', fontSize: 13, color: 'var(--ink-muted)' }}>
                      No tasks in this phase yet.
                    </div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                      <thead>
                        <tr>
                          {['Task', 'Assigned to', 'Due', 'Weight', 'Progress', 'Status'].map((h) => (
                            <th key={h} style={S.th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ph.tasks.map((t) => {
                          const ts = TASK_STATUS[t.status] || TASK_STATUS.NotStarted;
                          const busy = busyTask === t.id;
                          return (
                            <tr key={t.id} style={busy ? { opacity: 0.55 } : undefined}>
                              <td style={S.td}>
                                <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{t.name}</div>
                                <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                                  {t.ref}
                                  {t.side === 'Provider' && ' · provider'}
                                  {t.department && ` · ${t.department}`}
                                </div>
                              </td>

                              <td style={{ ...S.td, fontSize: 12.5 }}>
                                {t.assignee?.name || <span style={{ color: 'var(--ink-faint)' }}>Unassigned</span>}
                              </td>

                              <td style={S.td}>
                                <div style={{
                                  fontSize: 12.5,
                                  color: t.timing.overdue ? 'var(--danger)'
                                    : t.timing.dueSoon ? 'var(--warning)' : 'var(--ink-body)',
                                }}>
                                  {fmtDate(t.dueDate)}
                                </div>
                                {t.timing.overdue && (
                                  <div style={{ fontSize: 10.5, color: 'var(--danger)' }}>
                                    {t.timing.daysOverdue}d overdue
                                  </div>
                                )}
                              </td>

                              <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>
                                {t.weight}
                              </td>

                              <td style={S.td}>
                                {/* Editable only while unfinished — a Done task is
                                    pinned at 100 by the server, and offering a
                                    field that will be overwritten is a lie. */}
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={t.completionPercent}
                                  disabled={busy || t.status === 'Done'}
                                  onChange={(e) => {
                                    const v = Math.max(0, Math.min(100, Number(e.target.value)));
                                    setPhases((prev) => prev.map((p) => p.id !== ph.id ? p : {
                                      ...p,
                                      tasks: p.tasks.map((x) => x.id === t.id ? { ...x, completionPercent: v } : x),
                                    }));
                                  }}
                                  onBlur={(e) => {
                                    const v = Math.max(0, Math.min(100, Number(e.target.value)));
                                    changeTask(t, { completionPercent: v });
                                  }}
                                  style={{ ...S.input, width: 70, padding: '5px 8px', fontSize: 12 }}
                                  aria-label={`Completion percent for ${t.name}`}
                                />
                              </td>

                              <td style={S.td}>
                                <select
                                  value={t.status}
                                  disabled={busy}
                                  onChange={(e) => changeTask(t, { status: e.target.value })}
                                  style={{
                                    ...S.input, width: 130, padding: '5px 8px', fontSize: 12,
                                    color: ts.fg, borderColor: ts.line,
                                  }}
                                  aria-label={`Status for ${t.name}`}
                                >
                                  {(ALLOWED_NEXT[t.status] || [t.status]).map((s) => (
                                    <option key={s} value={s}>{TASK_STATUS[s]?.label || s}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default ProjectPlan;
