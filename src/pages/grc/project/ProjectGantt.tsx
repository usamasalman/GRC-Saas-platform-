import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, ghostBtn, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * Planned, actual and variance for every task, rolled up to phase and project.
 *
 * Three lines per task (consulting engagement, sprint 2): the plan first
 * agreed, the work as it actually ran (a forecast while unfinished), and the
 * days between the two finishes. Each variance carries its causes, and they
 * add up: days on hold, days each side owed, a rebaseline, and the rest. The
 * figures come from the server, the same ones the steering reports print.
 */

type Cause = 'onHold' | 'client' | 'provider' | 'thirdParty' | 'rebaseline' | 'unattributed';
type Causes = Record<Cause, number>;

interface Span { start: string | null; finish: string | null }
interface Figures {
  planned: Span;
  agreedFinish: string | null;
  actual: Span & { forecast: boolean };
  varianceDays: number | null;
  causes: Causes;
}
interface GanttTask extends Figures {
  id: string; ref: string; name: string; side: string; status: string; onCriticalPath: boolean;
  /** Predecessors whose owed days explain part of this task's variance. */
  drivenBy: string[];
}
interface GanttPhase extends Figures {
  id: string; sequence: number; name: string; tasks: GanttTask[];
}
interface Gantt {
  today: string;
  project: Figures & { ref: string; name: string; firstPlanKnown: boolean };
  phases: GanttPhase[];
  dependencies: { predecessorId: string; successorId: string }[];
  holds: { startedAt: string; endedAt: string | null }[];
}

const CAUSE_LABEL: Record<Cause, string> = {
  onHold: 'on hold',
  client: 'client',
  provider: 'provider',
  thirdParty: 'third party',
  rebaseline: 'rebaseline',
  unattributed: 'unattributed',
};

const DAY = 86_400_000;
const LABEL_W = 280;
const VAR_W = 150;
const TASK_H = 34;
const PHASE_H = 28;

const t = (s: string | null) => (s ? new Date(s).getTime() : null);

// Worded as services/projectVariance words them for the reports, so the
// screen and the paper read the same.
const causeText = (c: Causes): string => (Object.keys(CAUSE_LABEL) as Cause[])
  .filter((k) => c[k] > 0)
  .map((k) => `${c[k]} ${CAUSE_LABEL[k]}`)
  .join(', ');

const varianceText = (f: Figures): string => {
  if (f.varianceDays === null) return 'No agreed date';
  if (f.varianceDays === 0) return 'On plan';
  const n = Math.abs(f.varianceDays);
  const days = `${n} day${n === 1 ? '' : 's'}`;
  return f.varianceDays > 0 ? `+${days}` : `${days} early`;
};

const ProjectGantt: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [data, setData] = useState<Gantt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [side, setSide] = useState<'All' | 'Client' | 'Provider'>('All');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/api/projects/${projectId}/gantt`);
      setData(res.data);
    } catch (err) {
      setError(apiError(err, 'Could not load the Gantt.'));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const layout = useMemo(() => {
    if (!data) return null;
    const stamps: number[] = [t(data.today)!];
    const push = (f: Figures) => {
      for (const v of [f.planned.start, f.planned.finish, f.actual.start, f.actual.finish]) {
        const ms = t(v);
        if (ms !== null) stamps.push(ms);
      }
    };
    push(data.project);
    data.phases.forEach((p) => { push(p); p.tasks.forEach(push); });
    const from = Math.min(...stamps) - 3 * DAY;
    const to = Math.max(...stamps) + 3 * DAY;
    const days = Math.max(1, Math.ceil((to - from) / DAY));
    const pxPerDay = Math.max(6, Math.min(26, Math.floor(900 / days)));
    return { from, days, pxPerDay, width: days * pxPerDay };
  }, [data]);

  if (loading) return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading the Gantt…</div>;
  if (!data || !layout) return <div style={S.error}>{error || 'Could not load the Gantt.'}</div>;

  const x = (iso: string | null): number | null => {
    const ms = t(iso);
    return ms === null ? null : ((ms - layout.from) / DAY) * layout.pxPerDay;
  };

  // Rows, in order, with the y each one starts at.
  const rows: ({ kind: 'phase'; phase: GanttPhase } | { kind: 'task'; task: GanttTask })[] = [];
  for (const p of data.phases) {
    const tasks = p.tasks.filter((tk) => side === 'All' || tk.side === side);
    if (side !== 'All' && tasks.length === 0) continue;
    rows.push({ kind: 'phase', phase: p });
    tasks.forEach((tk) => rows.push({ kind: 'task', task: tk }));
  }
  const yOf = new Map<string, number>();
  let y = 0;
  for (const r of rows) {
    if (r.kind === 'task') yOf.set(r.task.id, y);
    y += r.kind === 'task' ? TASK_H : PHASE_H;
  }
  const height = Math.max(y, 40);

  const bar = (from: string | null, to: string | null, top: number, h: number, style: React.CSSProperties, title: string) => {
    const a = x(from);
    const b = x(to);
    if (a === null || b === null) return null;
    const left = Math.min(a, b);
    return (
      <div title={title} style={{
        position: 'absolute', left, top, height: h, width: Math.max(3, Math.abs(b - a)), borderRadius: 2, ...style,
      }} />
    );
  };

  const figuresTitle = (f: Figures) => [
    `Planned ${calendarDate(f.planned.start)} – ${calendarDate(f.planned.finish)}`,
    f.agreedFinish && f.agreedFinish !== f.planned.finish ? `Re-agreed finish ${calendarDate(f.agreedFinish)}` : '',
    `${f.actual.forecast ? 'Forecast' : 'Actual'} ${calendarDate(f.actual.start)} – ${calendarDate(f.actual.finish)}`,
    `Variance ${varianceText(f)}${causeText(f.causes) ? ` (${causeText(f.causes)})` : ''}`,
  ].filter(Boolean).join('\n');

  const varianceLine = (f: Figures, top: number) => {
    if (f.varianceDays === null || f.varianceDays === 0) return null;
    return bar(f.planned.finish, f.actual.finish, top, 4, {
      background: f.varianceDays > 0 ? 'var(--danger)' : 'var(--success)',
    }, `Variance ${varianceText(f)}`);
  };

  const todayX = x(data.today);
  const pr = data.project;

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}

      <div style={{ ...S.card, padding: '16px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div>
            <div style={{
              fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              color: (pr.varianceDays ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)',
            }}>
              {varianceText(pr)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
              {pr.actual.forecast ? 'forecast' : 'actual'} finish against the plan first agreed
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
            <div>Planned finish <strong style={{ color: 'var(--ink)' }}>{calendarDate(pr.planned.finish)}</strong></div>
            <div>
              {pr.actual.forecast ? 'Forecast' : 'Actual'} finish{' '}
              <strong style={{ color: 'var(--ink)' }}>{calendarDate(pr.actual.finish)}</strong>
            </div>
            {causeText(pr.causes) && <div>Why: {causeText(pr.causes)}</div>}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: 'var(--ink-muted)' }} htmlFor="gantt-side">Side</label>
            <select id="gantt-side" value={side} onChange={(e) => setSide(e.target.value as typeof side)} style={S.input}>
              <option value="All">All</option>
              <option value="Client">Client</option>
              <option value="Provider">Provider</option>
            </select>
            <button style={ghostBtn} onClick={load}>Refresh</button>
          </div>
        </div>
        {!pr.firstPlanKnown && (
          <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 10 }}>
            This engagement was rebaselined before first agreed dates were kept, so it is measured
            from its current baseline and shows no days for rebaseline.
          </div>
        )}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 12 }}>
          <span><Swatch style={{ background: 'var(--ink-faint)' }} /> Planned</span>
          <span><Swatch style={{ background: 'var(--brand)' }} /> Actual</span>
          <span><Swatch style={FORECAST} /> Forecast</span>
          <span><Swatch style={{ background: 'var(--danger)' }} /> Late</span>
          <span><Swatch style={{ background: 'var(--success)' }} /> Early</span>
          <span><Swatch style={{ background: 'var(--warning-bg)' }} /> On hold</span>
          <span><strong style={{ color: 'var(--danger)' }}>◆</strong> Critical path</span>
        </div>
      </div>

      <div style={{ ...S.card, overflowX: 'auto' }}>
        <div style={{ display: 'flex', minWidth: LABEL_W + layout.width + VAR_W }}>
          {/* Names */}
          {/* Pinned, so the names stay beside their bars while the chart scrolls. */}
          <div style={{ width: LABEL_W, flexShrink: 0, borderRight: '1px solid var(--line)', position: 'sticky', left: 0, zIndex: 2, background: 'var(--surface)' }}>
            {rows.map((r) => (r.kind === 'phase' ? (
              <div key={`p-${r.phase.id}`} style={{
                height: PHASE_H, display: 'flex', alignItems: 'center', padding: '0 12px',
                fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', background: 'var(--surface-sunk)',
              }}>
                {r.phase.sequence}. {r.phase.name}
              </div>
            ) : (
              <div key={`t-${r.task.id}`} title={r.task.name} style={{
                height: TASK_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px 0 22px',
                fontSize: 12, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden',
              }}>
                {r.task.onCriticalPath && <span style={{ color: 'var(--danger)' }} title="On the critical path">◆</span>}
                <span style={{ color: 'var(--ink-faint)' }}>{r.task.ref}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.task.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-muted)' }}>{r.task.side}</span>
              </div>
            )))}
          </div>

          {/* Bars */}
          <div style={{ position: 'relative', width: layout.width, height, flexShrink: 0 }}>
            {data.holds.map((h, i) => {
              const a = x(h.startedAt);
              const b = x(h.endedAt ?? data.today);
              if (a === null || b === null) return null;
              return (
                <div key={`h-${i}`} title="On hold" style={{
                  position: 'absolute', top: 0, bottom: 0, left: a, width: Math.max(2, b - a),
                  background: 'var(--warning-bg)',
                }} />
              );
            })}
            {todayX !== null && (
              <div title={`Today, ${calendarDate(data.today)}`} style={{
                position: 'absolute', top: 0, bottom: 0, left: todayX, width: 1, background: 'var(--brand)', opacity: 0.6,
              }} />
            )}

            {(() => {
              let top = 0;
              return rows.map((r) => {
                const at = top;
                if (r.kind === 'phase') {
                  top += PHASE_H;
                  const p = r.phase;
                  return (
                    <div key={`pb-${p.id}`} style={{ position: 'absolute', left: 0, right: 0, top: at, height: PHASE_H }} title={figuresTitle(p)}>
                      {bar(p.planned.start, p.planned.finish, 8, 5, { background: 'var(--ink-faint)' }, figuresTitle(p))}
                      {bar(p.actual.start ?? p.planned.start, p.actual.finish, 15, 5,
                        p.actual.forecast ? FORECAST : { background: 'var(--brand)' }, figuresTitle(p))}
                      {varianceLine(p, 22)}
                    </div>
                  );
                }
                top += TASK_H;
                const tk = r.task;
                const critical = tk.onCriticalPath ? { outline: '1px solid var(--danger)' } : {};
                return (
                  <div key={`tb-${tk.id}`} style={{ position: 'absolute', left: 0, right: 0, top: at, height: TASK_H }}>
                    {bar(tk.planned.start, tk.planned.finish, 6, 7, { background: 'var(--ink-faint)' }, figuresTitle(tk))}
                    {bar(tk.actual.start ?? tk.planned.start, tk.actual.finish, 15, 7,
                      { ...(tk.actual.forecast ? FORECAST : { background: 'var(--brand)' }), ...critical }, figuresTitle(tk))}
                    {varianceLine(tk, 25)}
                  </div>
                );
              });
            })()}

            <svg width={layout.width} height={height} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
              <defs>
                <marker id="gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" fill="var(--ink-muted)" />
                </marker>
              </defs>
              {data.dependencies.map((d, i) => {
                const all = data.phases.flatMap((p) => p.tasks);
                const pre = all.find((tk) => tk.id === d.predecessorId);
                const suc = all.find((tk) => tk.id === d.successorId);
                const y1 = yOf.get(d.predecessorId);
                const y2 = yOf.get(d.successorId);
                if (!pre || !suc || y1 === undefined || y2 === undefined) return null;
                const x1 = x(pre.actual.finish ?? pre.planned.finish);
                const x2 = x(suc.actual.start ?? suc.planned.start);
                if (x1 === null || x2 === null) return null;
                const a = y1 + 18;
                const b = y2 + 18;
                const bend = Math.max(x1 + 8, x2 - 8);
                return (
                  <path key={`d-${i}`} d={`M${x1},${a} H${bend} V${b} H${x2}`} fill="none"
                    stroke="var(--ink-muted)" strokeWidth={1} markerEnd="url(#gantt-arrow)" opacity={0.7} />
                );
              })}
            </svg>
          </div>

          {/* Variance */}
          <div style={{ width: VAR_W, flexShrink: 0, borderLeft: '1px solid var(--line)', position: 'sticky', right: 0, zIndex: 2, background: 'var(--surface)' }}>
            {rows.map((r) => {
              const f: Figures = r.kind === 'phase' ? r.phase : r.task;
              const h = r.kind === 'phase' ? PHASE_H : TASK_H;
              // Days owed on the work this task waited on count towards its
              // own lateness; say whose work that was.
              const via = r.kind === 'task' && r.task.drivenBy.length ? ` (via ${r.task.drivenBy.join(', ')})` : '';
              return (
                <div key={`v-${r.kind}-${r.kind === 'phase' ? r.phase.id : r.task.id}`}
                  title={causeText(f.causes) ? `${causeText(f.causes)}${via}` : undefined}
                  style={{
                    height: h, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 10px',
                    fontSize: 11.5, fontVariantNumeric: 'tabular-nums', lineHeight: 1.25,
                    background: r.kind === 'phase' ? 'var(--surface-sunk)' : undefined,
                    fontWeight: r.kind === 'phase' ? 600 : 400,
                  }}>
                  <span style={{ color: (f.varianceDays ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>
                    {varianceText(f)}{f.actual.forecast && f.varianceDays !== null ? ' (forecast)' : ''}
                  </span>
                  {causeText(f.causes) && (
                    <span style={{ color: 'var(--ink-muted)', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {causeText(f.causes)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const FORECAST: React.CSSProperties = {
  background: 'repeating-linear-gradient(45deg, var(--brand) 0 4px, transparent 4px 7px)',
  border: '1px solid var(--brand)',
};

const Swatch: React.FC<{ style: React.CSSProperties }> = ({ style }) => (
  <span style={{ display: 'inline-block', width: 14, height: 7, borderRadius: 2, verticalAlign: 'middle', marginRight: 4, ...style }} />
);

export default ProjectGantt;
