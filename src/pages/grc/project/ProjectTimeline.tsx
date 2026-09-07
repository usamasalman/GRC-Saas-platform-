import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/apiClient';
import { S, pill, ghostBtn, apiError } from '../../iam/iamStyles';

/**
 * What waits on what, and where a slip costs the end date.
 *
 * Not a Gantt chart. A Gantt drawn small enough to fit a browser is a picture
 * of bars nobody can read the dependencies in, and the dependencies are the
 * only reason this screen exists. So it leads with the three answers a manager
 * actually wants — the critical path, the handovers that cross sides, and the
 * dates that do not respect their own edges — and shows the bars underneath as
 * supporting detail.
 */

interface Task {
  id: string;
  ref: string;
  name: string;
  status: string;
  side: string;
  startDate: string | null;
  dueDate: string | null;
  onCriticalPath: boolean;
  blocks: string[];
  timing: { overdue: boolean; daysOverdue: number };
  slippage: { baselined: boolean; slipDays: number; slipped: boolean };
  assignee: { id: string; name: string } | null;
}

interface Phase {
  id: string; sequence: number; name: string; status: string;
  startDate: string; targetEndDate: string; tasks: Task[];
}

interface Dependency {
  id: string; predecessorId: string; successorId: string;
  kind: string; lagDays: number; note: string | null;
}

interface Timeline {
  phases: Phase[];
  dependencies: Dependency[];
  criticalPath: { taskIds: string[]; labels: string[]; lengthDays: number };
  handovers: {
    predecessorId: string; successorId: string; predecessor: string; successor: string;
    waitingOn: string; waiting: string; onCriticalPath: boolean;
  }[];
  violations: {
    predecessor: string; successor: string; byDays: number; reason: string;
  }[];
  cycle: string[] | null;
  summary: {
    tasks: number; dependencies: number; onCriticalPath: number; criticalDays: number;
    crossSideHandovers: number; criticalHandovers: number;
    scheduleViolations: number; unsequenced: number;
  };
  vocabulary: { kinds: string[] };
}

const ProjectTimeline: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [data, setData] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pred, setPred] = useState('');
  const [succ, setSucc] = useState('');
  const [kind, setKind] = useState('FinishToStart');
  const [lag, setLag] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/api/projects/${projectId}/timeline`);
      setData(res.data);
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const link = async () => {
    if (!pred || !succ) { setError('Choose both tasks.'); return; }
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/api/projects/${projectId}/dependencies`, {
        predecessorId: pred, successorId: succ, kind, lagDays: Number(lag) || 0,
      });
      setPred(''); setSucc(''); setLag('0');
      await load();
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await apiClient.delete(`/api/projects/dependencies/${id}`);
      await load();
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading the timeline…</div>;
  }
  if (!data) return <div style={S.error}>{error || 'Could not load the timeline.'}</div>;

  const tasks = data.phases.flatMap((p) => p.tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const label = (id: string) => {
    const t = byId.get(id);
    return t ? `${t.ref} · ${t.name}` : id;
  };
  const s = data.summary;

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}

      {/* A loop makes the plan unschedulable, so it leads. */}
      {data.cycle && (
        <div style={{
          ...S.card, padding: '14px 18px', marginBottom: 14,
          borderLeft: '3px solid var(--danger)', color: 'var(--danger)', fontSize: 13,
        }}>
          <strong>This plan waits on itself.</strong> {data.cycle.join(' → ')}
          <div style={{ color: 'var(--ink-muted)', marginTop: 4, fontSize: 12 }}>
            Nothing in a loop can be scheduled. Break one of these links.
          </div>
        </div>
      )}

      {/* ── The three answers ──────────────────────────────────────────── */}
      <div style={{ ...S.card, padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {s.criticalDays}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>days on the critical path</div>
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
              {s.onCriticalPath}<span style={{ color: 'var(--ink-faint)' }}>/{s.tasks}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>tasks that cannot slip</div>
          </div>
          <div>
            <div style={{
              fontSize: 17, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              color: s.criticalHandovers > 0 ? 'var(--danger)' : 'var(--ink)',
            }}>
              {s.criticalHandovers}<span style={{ color: 'var(--ink-faint)' }}>/{s.crossSideHandovers}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>handovers on the path</div>
          </div>
          {s.unsequenced > 0 && (
            <div>
              <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--warning)', fontVariantNumeric: 'tabular-nums' }}>
                {s.unsequenced}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>tasks with no sequence</div>
            </div>
          )}
          <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={load}>Refresh</button>
        </div>

        {data.criticalPath.labels.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 12, lineHeight: 1.7 }}>
            <strong style={{ color: 'var(--ink)' }}>Longest chain:</strong>{' '}
            {data.criticalPath.labels.join(' → ')}
            <div style={{ marginTop: 4 }}>
              A task on this chain cannot run late without moving the end date. One off it can.
            </div>
          </div>
        )}
      </div>

      {/* ── Handovers: where a slip gets contested ─────────────────────── */}
      {data.handovers.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 13.5 }}>
              Handovers between the two sides
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3 }}>
              Where one side waits on the other — and where a delay becomes an argument
              about whose fault it was. One on the critical path can move the end date
              on its own.
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr>{['Waiting on', 'Which blocks', 'Direction', ''].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {data.handovers.map((h, i) => (
                  <tr key={i}>
                    <td style={{ ...S.td, fontSize: 12.5 }}>{h.predecessor}</td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>{h.successor}</td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>
                      {h.waitingOn} → {h.waiting}
                    </td>
                    <td style={S.td}>
                      {h.onCriticalPath && (
                        <span style={pill('var(--danger)', 'var(--danger-line)')}>On the path</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Dates that ignore their own edges ──────────────────────────── */}
      {data.violations.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16, padding: '14px 18px' }}>
          <div style={{ fontWeight: 600, color: 'var(--warning)', fontSize: 13.5 }}>
            {data.violations.length} date{data.violations.length === 1 ? '' : 's'} that
            {data.violations.length === 1 ? ' does' : ' do'} not respect the sequence
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '4px 0 10px' }}>
            Reported, not refused. A task genuinely starting early because its predecessor
            finished early is normal — but if that is not what happened, one of these is wrong.
          </div>
          {data.violations.map((v, i) => (
            <div key={i} style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 5 }}>
              <strong>{v.successor}</strong> {v.reason} — <strong>{v.predecessor}</strong>
              {' '}by {v.byDays} day{v.byDays === 1 ? '' : 's'}
            </div>
          ))}
        </div>
      )}

      {/* ── Add a link ─────────────────────────────────────────────────── */}
      <div style={{ ...S.card, padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>This must happen first</span>
            <select style={{ ...S.input, width: '100%', marginTop: 4 }}
                    value={pred} onChange={(e) => setPred(e.target.value)}>
              <option value="">Choose a task…</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.ref} · {t.name}</option>)}
            </select>
          </div>
          <div>
            <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Before this can proceed</span>
            <select style={{ ...S.input, width: '100%', marginTop: 4 }}
                    value={succ} onChange={(e) => setSucc(e.target.value)}>
              <option value="">Choose a task…</option>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.ref} · {t.name}</option>)}
            </select>
          </div>
          <div>
            <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Relationship</span>
            <select style={{ ...S.input, width: '100%', marginTop: 4 }}
                    value={kind} onChange={(e) => setKind(e.target.value)}>
              {data.vocabulary.kinds.map((k) => (
                <option key={k} value={k}>{k.replace(/([a-z])([A-Z])/g, '$1 $2')}</option>
              ))}
            </select>
          </div>
          <div>
            <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Gap after, in days</span>
            <input style={{ ...S.input, width: '100%', marginTop: 4 }} type="number" min={0}
                   value={lag} onChange={(e) => setLag(e.target.value)} />
          </div>
        </div>
        <button style={{ ...ghostBtn, marginTop: 12 }} disabled={busy} onClick={link}>
          {busy ? 'Linking…' : 'Add dependency'}
        </button>
      </div>

      {/* ── The edges ──────────────────────────────────────────────────── */}
      {data.dependencies.length === 0 ? (
        <div style={{ ...S.card, padding: '34px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 500, margin: '0 auto' }}>
            Nothing is sequenced yet. Until tasks say what they wait on, a plan is an
            ordered list with dates on it, and “if this slips, does the end date slip”
            has no answer.
          </div>
        </div>
      ) : (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
              <thead>
                <tr>{['First', 'Then', 'Relationship', 'Gap', ''].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {data.dependencies.map((d) => (
                  <tr key={d.id}>
                    <td style={{ ...S.td, fontSize: 12.5 }}>{label(d.predecessorId)}</td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>{label(d.successorId)}</td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>
                      {d.kind.replace(/([a-z])([A-Z])/g, '$1 $2')}
                    </td>
                    <td style={{ ...S.td, fontSize: 12.5, textAlign: 'right' }}>
                      {d.lagDays ? `${d.lagDays}d` : '—'}
                    </td>
                    <td style={S.td}>
                      <button style={ghostBtn} disabled={busy} onClick={() => unlink(d.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectTimeline;
