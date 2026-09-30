import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';
import { ConfirmDialog } from '../../../components/Dialog';

/**
 * The plan template library (consulting engagement, sprint 3).
 *
 * Three levels side by side: the platform's templates, read by everyone; a
 * consulting firm's own, private to the firm; an organisation's own. A
 * template is edited by saving its next version, never in place, so a plan
 * made from an earlier version is untouched and anyone can still read what
 * that version said. Retiring hides a template from the wizard and changes no
 * plan. New templates come from "Save as template" on a plan.
 */

interface Summary {
  id: string; level: string; familyId: string; version: number; name: string; description: string | null;
  engagementType: string | null; standardCode: string | null; status: string;
  phaseCount: number; taskCount: number; latest: boolean; canMaintain: boolean;
}
interface Task {
  key: string; name: string; description: string | null; side: string; durationDays: number; weight: number;
  needsVerification: boolean | null; dependsOnKey: string | null; clauses: string[]; generate: string;
  deliverable: string | null;
}
interface Phase { id?: string; name: string; description: string | null; durationDays: number; tasks: Task[] }
interface Template extends Summary { phases: Phase[] }

const LEVELS = ['Platform', 'Firm', 'Client'] as const;
const LEVEL_TEXT: Record<string, string> = {
  Platform: 'Kept by the platform and available to every organisation and firm.',
  Firm: 'Your firm\'s own method. No other firm, and none of your clients, can see these.',
  Client: 'Your organisation\'s own templates.',
};

const TemplateLibrary: React.FC = () => {
  const [list, setList] = useState<Summary[] | null>(null);
  const [myLevel, setMyLevel] = useState('Client');
  const [open, setOpen] = useState<Template | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [retiring, setRetiring] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/plan-templates', { params: { all: '1' } });
      setList(res.data?.templates || []);
      setMyLevel(res.data?.myLevel || 'Client');
    } catch (err) {
      setList([]);
      setError(apiError(err, 'Could not load the library.'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const view = async (id: string) => {
    setError('');
    setNotice('');
    setDraft(null);
    try {
      const res = await apiClient.get(`/api/plan-templates/${id}`);
      setOpen(res.data?.template || null);
    } catch (err) {
      setError(apiError(err, 'Could not load that template.'));
    }
  };

  const saveVersion = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      // A task may wait only on one earlier in the template; a link to a task
      // that was removed or moved later is dropped rather than refused.
      const seen = new Set<string>();
      const phases = draft.phases.map((p) => ({
        name: p.name, description: p.description, durationDays: p.durationDays,
        tasks: p.tasks.map((t) => {
          const dependsOnKey = t.dependsOnKey && seen.has(t.dependsOnKey) ? t.dependsOnKey : null;
          seen.add(t.key);
          return { ...t, dependsOnKey };
        }),
      }));
      const res = await apiClient.post(`/api/plan-templates/${draft.id}/versions`, {
        name: draft.name, description: draft.description, engagementType: draft.engagementType,
        standardCode: draft.standardCode, phases,
      });
      const t = res.data?.template;
      setDraft(null);
      setOpen(t);
      setNotice(`Saved as version ${t?.version}. Plans made from earlier versions are unchanged.`);
      await load();
    } catch (err) {
      setError(apiError(err, 'Could not save the new version.'));
    } finally {
      setBusy(false);
    }
  };

  const retire = async () => {
    if (!retiring) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/api/plan-templates/${retiring.id}/retire`);
      setNotice(`"${retiring.name}" version ${retiring.version} is retired. Plans made from it are unchanged.`);
      setRetiring(null);
      setOpen(null);
      await load();
    } catch (err) {
      setError(apiError(err, 'Could not retire the template.'));
    } finally {
      setBusy(false);
    }
  };

  if (list === null) return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading the library…</div>;

  // ── One template, read or being edited ────────────────────────────────────
  if (open) {
    const t = draft || open;
    const editing = Boolean(draft);
    const setPhase = (i: number, patch: Partial<Phase>) => setDraft({ ...draft!, phases: draft!.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
    const setTask = (i: number, k: number, patch: Partial<Task>) => setPhase(i, { tasks: draft!.phases[i].tasks.map((x, j) => (j === k ? { ...x, ...patch } : x)) });
    return (
      <div>
        {error && <div style={S.error}>{error}</div>}
        {notice && <div style={{ ...S.card, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: 'var(--success)' }}>{notice}</div>}
        <div style={{ ...S.card, padding: '16px 18px' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            {editing ? (
              <input aria-label="Template name" value={t.name} onChange={(e) => setDraft({ ...draft!, name: e.target.value })}
                style={{ ...S.input, fontSize: 14, fontWeight: 600, minWidth: 260 }} />
            ) : <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{t.name}</div>}
            <span style={pill('var(--ink-muted)', 'var(--line)')}>{t.level}</span>
            <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>v{t.version}</span>
            {t.status === 'Retired' && <span style={pill('var(--danger)', 'var(--danger-line)')}>Retired</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {!editing && open.canMaintain && open.status === 'Active' && (
                <>
                  <button style={ghostBtn} onClick={() => { setNotice(''); setDraft(JSON.parse(JSON.stringify(open))); }}>Edit</button>
                  <button style={ghostBtn} onClick={() => setRetiring(open)}>Retire</button>
                </>
              )}
              {editing && (
                <>
                  <button style={primaryBtn(busy)} disabled={busy} onClick={saveVersion}>
                    {busy ? 'Saving…' : `Save as version ${(list.filter((x) => x.familyId === open.familyId).reduce((m, x) => Math.max(m, x.version), 0)) + 1}`}
                  </button>
                  <button style={ghostBtn} onClick={() => setDraft(null)}>Discard changes</button>
                </>
              )}
              <button style={ghostBtn} onClick={() => { setOpen(null); setDraft(null); }}>Back to the library</button>
            </span>
          </div>
          {t.description && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 10 }}>{t.description}</div>}
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
            {[t.engagementType, t.standardCode].filter(Boolean).join(' · ')}
          </div>

          {t.phases.map((p, i) => (
            <div key={p.id || `new-${i}`} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                <span style={{ color: 'var(--ink-faint)' }}>{i + 1}.</span>
                {editing ? (
                  <>
                    <input aria-label="Phase name" value={p.name} onChange={(e) => setPhase(i, { name: e.target.value })} style={{ ...S.input, flex: 1 }} />
                    <input aria-label="Phase days" type="number" min={1} max={365} value={p.durationDays}
                      onChange={(e) => setPhase(i, { durationDays: Number(e.target.value) })} style={{ ...S.input, width: 70 }} />
                    <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }}
                      onClick={() => setDraft({ ...draft!, phases: draft!.phases.filter((_, j) => j !== i) })}>Remove phase</button>
                  </>
                ) : (
                  <>
                    {p.name}
                    <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--ink-muted)' }}>{p.durationDays} days</span>
                  </>
                )}
              </div>
              <div style={{ margin: '6px 0 0 22px', display: 'grid', gap: 4 }}>
                {p.tasks.map((k, j) => (
                  <div key={k.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                    {editing ? (
                      <>
                        <input aria-label="Task name" value={k.name} onChange={(e) => setTask(i, j, { name: e.target.value })} style={{ ...S.input, flex: 1 }} />
                        <select aria-label="Task side" value={k.side} onChange={(e) => setTask(i, j, { side: e.target.value })} style={{ ...S.input, width: 110 }}>
                          <option value="Client">Client</option>
                          <option value="Provider">Provider</option>
                        </select>
                        <input aria-label="Task days" type="number" min={1} max={365} value={k.durationDays}
                          onChange={(e) => setTask(i, j, { durationDays: Number(e.target.value) })} style={{ ...S.input, width: 70 }} />
                        <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }}
                          onClick={() => setPhase(i, { tasks: p.tasks.filter((_, x) => x !== j) })}>Remove</button>
                      </>
                    ) : (
                      <>
                        <span>{k.name}</span>
                        {k.generate !== 'Once' && (
                          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                            one per {k.generate === 'PerTheme' ? 'theme' : 'clause'} of {k.clauses.join(', ')}
                          </span>
                        )}
                        {k.generate === 'Once' && k.clauses.length > 0 && (
                          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{k.clauses.join(', ')}</span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>
                          {k.side} · {k.durationDays}d{k.deliverable ? ` · ${k.deliverable}` : ''}
                        </span>
                      </>
                    )}
                  </div>
                ))}
                {editing && (
                  <button style={{ ...ghostBtn, padding: '2px 10px', fontSize: 11.5, justifySelf: 'start' }}
                    onClick={() => setPhase(i, {
                      tasks: [...p.tasks, {
                        key: `k${Date.now().toString(36)}`, name: 'New task', description: null, side: 'Client',
                        durationDays: 5, weight: 1, needsVerification: null, dependsOnKey: null, clauses: [],
                        generate: 'Once', deliverable: null,
                      }],
                    })}>+ Task</button>
                )}
              </div>
            </div>
          ))}
          {editing && (
            <button style={{ ...ghostBtn, marginTop: 8 }}
              onClick={() => setDraft({ ...draft!, phases: [...draft!.phases, { name: 'New phase', description: null, durationDays: 10, tasks: [] }] })}>
              + Phase
            </button>
          )}
        </div>
        {retiring && (
          <ConfirmDialog
            title={`Retire "${retiring.name}" version ${retiring.version}?`}
            message="It stops being offered in the plan wizard. Engagements already planned from it do not change."
            confirmLabel={busy ? 'Retiring…' : 'Retire'}
            busy={busy}
            onConfirm={retire}
            onCancel={() => setRetiring(null)}
          />
        )}
      </div>
    );
  }

  // ── The library ───────────────────────────────────────────────────────────
  return (
    <div>
      {error && <div style={S.error}>{error}</div>}
      {notice && <div style={{ ...S.card, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: 'var(--success)' }}>{notice}</div>}
      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 12 }}>
        Start an engagement's plan from one of these in the plan wizard. To add a template of your own, open a plan
        and use "Save as template": the client's people, names, files and dates are left out.
      </div>
      {LEVELS.filter((l) => l === 'Platform' || l === myLevel || list.some((t) => t.level === l)).map((level) => {
        const rows = list.filter((t) => t.level === level);
        return (
          <div key={level} style={{ ...S.card, marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{level} templates</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>{LEVEL_TEXT[level]}</div>
            </div>
            {rows.length === 0 && <div style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--ink-faint)' }}>None yet.</div>}
            {rows.map((t) => (
              <button key={t.id} onClick={() => view(t.id)} style={{
                display: 'flex', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left', padding: '10px 16px',
                border: 'none', borderTop: '1px solid var(--line-soft)', background: 'transparent', cursor: 'pointer',
                fontFamily: 'inherit', opacity: t.status === 'Retired' || !t.latest ? 0.6 : 1,
              }}>
                <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{t.name}</strong>
                <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>v{t.version}</span>
                {t.status === 'Retired' && <span style={pill('var(--danger)', 'var(--danger-line)')}>Retired</span>}
                {t.status !== 'Retired' && !t.latest && <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>earlier version</span>}
                <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{[t.engagementType, t.standardCode].filter(Boolean).join(' · ')}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-muted)' }}>{t.phaseCount} phases · {t.taskCount} tasks</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default TemplateLibrary;
