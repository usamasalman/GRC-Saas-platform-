import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * Start a draft plan from a template (consulting engagement, sprint 3).
 *
 * Pick a template, tick or untick its phases and tasks, add your own, and see
 * the dated plan before it is created. The dates come from the server's own
 * preview of the same computation that creates the plan, so what is shown is
 * what is made. A template is copied, never linked: changing it later changes
 * nothing here.
 */

interface TemplateSummary {
  id: string; level: string; version: number; name: string; description: string | null;
  engagementType: string | null; standardCode: string | null; phaseCount: number; taskCount: number;
}
interface TemplateTask {
  key: string; name: string; side: string; durationDays: number; generate: string;
  clauses: string[]; dependsOnKey: string | null; deliverable: string | null;
}
interface TemplatePhase { id: string; name: string; durationDays: number; tasks: TemplateTask[] }
interface Template extends TemplateSummary { phases: TemplatePhase[] }
interface CustomTask { phaseId: string; name: string; side: string; durationDays: number }
interface CustomPhase { name: string; durationDays: number; tasks: { name: string; side: string; durationDays: number }[] }
interface Preview {
  summary: {
    phases: number; tasks: number; startDate: string; endDate: string; targetEndDate: string;
    extendsTarget: boolean; unmatchedClauses: string[]; frameworkNote: string | null;
  };
  phases: { name: string; startDate: string; targetEndDate: string; custom: boolean;
    tasks: { key: string; name: string; side: string; startDate: string; dueDate: string; custom: boolean; clauseIds: string[] }[] }[];
}
interface Similar { name: string; side: string; durationDays: number; from: string }

const LEVEL_TONE: Record<string, [string, string]> = {
  Platform: ['var(--brand)', 'var(--brand-line)'],
  Firm: ['var(--warning)', 'var(--warning-line)'],
  Client: ['var(--success)', 'var(--success-line)'],
};

const PlanWizard: React.FC<{
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}> = ({ projectId, onDone, onCancel }) => {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [outPhases, setOutPhases] = useState<Set<string>>(new Set());
  const [outTasks, setOutTasks] = useState<Set<string>>(new Set());
  const [customTasks, setCustomTasks] = useState<CustomTask[]>([]);
  const [customPhases, setCustomPhases] = useState<CustomPhase[]>([]);
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [engagementType, setEngagementType] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // The plan starts when the engagement does, unless changed here.
  useEffect(() => {
    apiClient.get(`/api/projects/${projectId}`)
      .then((res) => {
        const p = res.data?.project;
        if (p?.startDate) setStart(String(p.startDate).slice(0, 10));
        setEngagementType(p?.projectType ?? null);
      })
      .catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    apiClient.get('/api/plan-templates')
      .then((res) => setTemplates(res.data?.templates || []))
      .catch((err) => { setTemplates([]); setError(apiError(err, 'Could not load the templates.')); });
  }, []);

  const choose = async (id: string) => {
    setError('');
    try {
      const res = await apiClient.get(`/api/plan-templates/${id}`);
      setTemplate(res.data?.template || null);
      setOutPhases(new Set());
      setOutTasks(new Set());
      setCustomTasks([]);
      setCustomPhases([]);
    } catch (err) {
      setError(apiError(err, 'Could not load that template.'));
    }
  };

  const body = useMemo(() => (template ? {
    templateId: template.id,
    startDate: start,
    excludePhaseIds: [...outPhases],
    excludeTaskKeys: [...outTasks],
    customTasks,
    customPhases,
  } : null), [template, start, outPhases, outTasks, customTasks, customPhases]);

  // The dated plan, recomputed by the server whenever the selection changes.
  useEffect(() => {
    if (!body) { setPreview(null); return undefined; }
    const timer = setTimeout(() => {
      apiClient.post(`/api/projects/${projectId}/plan-from-template?preview=1`, body)
        .then((res) => { setPreview(res.data); setError(''); })
        .catch((err) => { setPreview(null); setError(apiError(err, 'Could not lay the plan out.')); });
    }, 250);
    return () => clearTimeout(timer);
  }, [projectId, body]);

  const create = async () => {
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/api/projects/${projectId}/plan-from-template`, body);
      onDone();
    } catch (err) {
      setError(apiError(err, 'Could not create the plan.'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (set: Set<string>, value: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    update(next);
  };

  if (templates === null) return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading templates…</div>;

  // ── Step 1: choose ────────────────────────────────────────────────────────
  if (!template) {
    const sorted = [...templates].sort((a, b) => Number(b.engagementType === engagementType) - Number(a.engagementType === engagementType));
    return (
      <div style={{ ...S.card, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Start from a template</div>
          <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={onCancel}>Plan by hand instead</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 14 }}>
          The template is copied into this engagement. You can leave out any phase or task, add your own, and
          change anything afterwards; editing the template later does not change this plan.
        </div>
        {error && <div style={S.error}>{error}</div>}
        {sorted.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No templates are available yet.</div>}
        <div style={{ display: 'grid', gap: 10 }}>
          {sorted.map((t) => (
            <button key={t.id} onClick={() => choose(t.id)} style={{
              ...S.card, textAlign: 'left', padding: '12px 14px', cursor: 'pointer', border: '1px solid var(--line)',
              fontFamily: 'inherit', background: 'var(--surface)',
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 13.5, color: 'var(--ink)' }}>{t.name}</strong>
                <span style={pill(...(LEVEL_TONE[t.level] || LEVEL_TONE.Client))}>{t.level}</span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>v{t.version}</span>
                {t.engagementType && <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{t.engagementType}</span>}
                {t.standardCode && <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{t.standardCode}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-muted)' }}>
                  {t.phaseCount} phases · {t.taskCount} tasks
                </span>
              </div>
              {t.description && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 6 }}>{t.description}</div>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Step 2: tailor, then create ───────────────────────────────────────────
  const planned = new Map((preview?.phases || []).flatMap((p) => p.tasks.map((t) => [t.key, t] as const)));
  const plannedPhase = new Map((preview?.phases || []).filter((p) => !p.custom).map((p) => [p.name, p] as const));

  return (
    <div style={{ ...S.card, padding: '18px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{template.name}</div>
        <span style={pill(...(LEVEL_TONE[template.level] || LEVEL_TONE.Client))}>{template.level}</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>v{template.version}</span>
        <label style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
          Starts
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{ ...S.input, width: 150 }} />
        </label>
        <button style={ghostBtn} onClick={() => setTemplate(null)}>Choose another</button>
        <button style={ghostBtn} onClick={onCancel}>Cancel</button>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {template.phases.map((p) => {
        const off = outPhases.has(p.id);
        const pp = plannedPhase.get(p.name);
        return (
          <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0', opacity: off ? 0.5 : 1 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              <input type="checkbox" checked={!off} onChange={() => toggle(outPhases, p.id, setOutPhases)} />
              {p.name}
              <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--ink-muted)' }}>
                {pp && !off ? `${calendarDate(pp.startDate)} → ${calendarDate(pp.targetEndDate)}` : `${p.durationDays} days`}
              </span>
            </label>
            {!off && (
              <div style={{ margin: '6px 0 0 24px', display: 'grid', gap: 4 }}>
                {p.tasks.map((t) => {
                  const tOff = outTasks.has(t.key);
                  const at = planned.get(t.key) || planned.get(`${t.key}#1`);
                  return (
                    <label key={t.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--ink)', opacity: tOff ? 0.5 : 1 }}>
                      <input type="checkbox" checked={!tOff} onChange={() => toggle(outTasks, t.key, setOutTasks)} />
                      <span>{t.name}</span>
                      {t.generate !== 'Once' && (
                        <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                          one per {t.generate === 'PerTheme' ? 'theme' : 'clause'} of {t.clauses.join(', ')}
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                        {t.side} · {t.durationDays}d{at && !tOff ? ` · due ${calendarDate(at.dueDate)}` : ''}
                      </span>
                    </label>
                  );
                })}
                {customTasks.map((c, i) => (c.phaseId === p.id ? (
                  <div key={`c-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                    <span style={pill('var(--ink-muted)', 'var(--line)')}>Your own</span>
                    <span>{c.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)' }}>{c.side} · {c.durationDays}d</span>
                    <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }}
                      onClick={() => setCustomTasks(customTasks.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                ) : null))}
                <AddTask onAdd={(t) => setCustomTasks([...customTasks, { ...t, phaseId: p.id }])} />
              </div>
            )}
          </div>
        );
      })}

      {customPhases.map((cp, i) => (
        <div key={`cp-${i}`} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            <span style={pill('var(--ink-muted)', 'var(--line)')}>Your own</span>
            {cp.name}
            <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--ink-muted)' }}>{cp.durationDays} days</span>
            <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }}
              onClick={() => setCustomPhases(customPhases.filter((_, j) => j !== i))}>Remove</button>
          </div>
          <div style={{ margin: '6px 0 0 24px', display: 'grid', gap: 4 }}>
            {cp.tasks.map((t, j) => (
              <div key={j} style={{ fontSize: 12.5, display: 'flex' }}>
                {t.name}<span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)' }}>{t.side} · {t.durationDays}d</span>
              </div>
            ))}
            <AddTask onAdd={(t) => setCustomPhases(customPhases.map((x, j) => (j === i ? { ...x, tasks: [...x.tasks, t] } : x)))} />
          </div>
        </div>
      ))}
      <AddPhase onAdd={(ph) => setCustomPhases([...customPhases, ph])} />

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 6, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {preview ? (
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
            <div>
              <strong style={{ color: 'var(--ink)' }}>{preview.summary.phases}</strong> phases,{' '}
              <strong style={{ color: 'var(--ink)' }}>{preview.summary.tasks}</strong> tasks,{' '}
              {calendarDate(preview.summary.startDate)} → <strong style={{ color: 'var(--ink)' }}>{calendarDate(preview.summary.endDate)}</strong>
            </div>
            {preview.summary.extendsTarget && (
              <div style={{ color: 'var(--warning)' }}>
                The plan runs past the engagement's target end; the target moves to {calendarDate(preview.summary.targetEndDate)}.
              </div>
            )}
            {preview.summary.frameworkNote && <div style={{ color: 'var(--warning)' }}>{preview.summary.frameworkNote}</div>}
            {preview.summary.unmatchedClauses.length > 0 && !preview.summary.frameworkNote && (
              <div>Clauses this framework does not hold, so not mapped: {preview.summary.unmatchedClauses.join(', ')}</div>
            )}
          </div>
        ) : <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Laying the plan out…</div>}
        <button style={{ ...primaryBtn(busy || !preview), marginLeft: 'auto' }} disabled={busy || !preview} onClick={create}>
          {busy ? 'Creating…' : 'Create the draft plan'}
        </button>
      </div>
    </div>
  );
};

/**
 * One custom task. While a name is typed, library tasks that look like it are
 * offered first, the way a new risk shows possible duplicates.
 */
const AddTask: React.FC<{ onAdd: (t: { name: string; side: string; durationDays: number }) => void }> = ({ onAdd }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [side, setSide] = useState('Client');
  const [days, setDays] = useState('5');
  const [similar, setSimilar] = useState<Similar[]>([]);
  const seq = useRef(0);

  const look = useCallback((q: string) => {
    const mine = (seq.current += 1);
    if (q.trim().length < 3) { setSimilar([]); return; }
    apiClient.get('/api/plan-templates/similar-tasks', { params: { q } })
      .then((res) => { if (mine === seq.current) setSimilar(res.data?.tasks || []); })
      .catch(() => setSimilar([]));
  }, []);

  if (!open) {
    return (
      <button style={{ ...ghostBtn, padding: '2px 10px', fontSize: 11.5, justifySelf: 'start' }} onClick={() => setOpen(true)}>
        + Your own task
      </button>
    );
  }
  const n = Number(days);
  const valid = name.trim().length >= 3 && Number.isInteger(n) && n >= 1 && n <= 365;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input aria-label="Task name" placeholder="Task name" value={name}
          onChange={(e) => { setName(e.target.value); look(e.target.value); }} style={{ ...S.input, flex: 1, minWidth: 180 }} />
        <select aria-label="Side" value={side} onChange={(e) => setSide(e.target.value)} style={{ ...S.input, width: 110 }}>
          <option value="Client">Client</option>
          <option value="Provider">Provider</option>
        </select>
        <input aria-label="Days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} style={{ ...S.input, width: 70 }} />
        <button style={primaryBtn(!valid)} disabled={!valid}
          onClick={() => { onAdd({ name: name.trim(), side, durationDays: n }); setName(''); setSimilar([]); setOpen(false); }}>
          Add
        </button>
        <button style={ghostBtn} onClick={() => { setOpen(false); setSimilar([]); }}>Cancel</button>
      </div>
      {similar.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
          Already in the library:{' '}
          {similar.map((s, i) => (
            <button key={i} title={s.from} onClick={() => { setName(s.name); setSide(s.side); setDays(String(s.durationDays)); setSimilar([]); }}
              style={{ ...ghostBtn, padding: '1px 8px', fontSize: 11, margin: '2px 4px 2px 0' }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const AddPhase: React.FC<{ onAdd: (p: CustomPhase) => void }> = ({ onAdd }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState('10');
  if (!open) {
    return <button style={{ ...ghostBtn, marginTop: 8 }} onClick={() => setOpen(true)}>+ Your own phase</button>;
  }
  const n = Number(days);
  const valid = name.trim().length >= 3 && Number.isInteger(n) && n >= 1 && n <= 365;
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
      <input aria-label="Phase name" placeholder="Phase name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...S.input, flex: 1, minWidth: 180 }} />
      <input aria-label="Phase days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} style={{ ...S.input, width: 70 }} />
      <button style={primaryBtn(!valid)} disabled={!valid}
        onClick={() => { onAdd({ name: name.trim(), durationDays: n, tasks: [] }); setName(''); setOpen(false); }}>Add phase</button>
      <button style={ghostBtn} onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
};

export default PlanWizard;
