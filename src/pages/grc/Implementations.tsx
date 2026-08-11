import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';

const STATUS_PILL: Record<string, React.CSSProperties> = {
  Verified: pill('var(--success)', 'var(--success-line)'),
  Implemented: pill('var(--info)', 'var(--info-line)'),
  InProgress: pill('var(--warning)', 'var(--warning-line)'),
  NotStarted: pill('var(--ink-muted)', 'var(--line)'),
};
const EFFECT_COLOR: Record<string, string> = {
  Effective: 'var(--success)', PartiallyEffective: 'var(--warning)', Ineffective: 'var(--danger)', NotAssessed: 'var(--ink-muted)',
};
const JUDGE_COLOR: Record<string, string> = {
  Yes: 'var(--success)', Partial: 'var(--warning)', No: 'var(--danger)', NotAssessed: 'var(--ink-body)',
};

const Implementations: React.FC = () => {
  const [impls, setImpls] = useState<any[]>([]);
  const [controls, setControls] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [detail, setDetail] = useState<any>(null);
  const [evTitle, setEvTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ controlId: '', successCriteria: '', frequency: 'Quarterly' });
  const [formErr, setFormErr] = useState('');

  const me = (() => { try { return JSON.parse(localStorage.getItem('grc_user_json') || 'null'); } catch { return null; } })();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [iRes, cRes] = await Promise.all([
        apiClient.get('/api/grc/implementations'),
        apiClient.get('/api/grc/controls').catch(() => null),
      ]);
      setImpls(iRes.data?.implementations || []);
      setTotals(iRes.data?.totals || {});
      setScope(iRes.data?.scope || '');
      setControls(cRes?.data?.controls || []);
    } catch (err) { setError(apiError(err, 'Failed to load implementations')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    try {
      const res = await apiClient.get(`/api/grc/implementations/${id}`);
      setDetail(res.data?.implementation || null);
      setEvTitle('');
    } catch (err) { window.alert(apiError(err)); }
  };

  const setStatus = async (id: string, status: string) => {
    try {
      await apiClient.patch(`/api/grc/implementations/${id}`, { status });
      setNotice(`Status set to ${status}`);
      await load();
      if (detail?.id === id) await openDetail(id);
    } catch (err) { window.alert(apiError(err)); }
  };

  const validate = async (id: string) => {
    const effectiveness = window.prompt('Effectiveness (Effective / PartiallyEffective / Ineffective):', 'Effective');
    if (!effectiveness) return;
    const note = window.prompt('Validation note (audit evidence):') || '';
    try {
      const res = await apiClient.post(`/api/grc/implementations/${id}/validate`, { effectiveness, note });
      setNotice(res.data?.message || 'Validated');
      await load();
      if (detail?.id === id) await openDetail(id);
    } catch (err) { window.alert(apiError(err)); }
  };

  const addEvidence = async () => {
    if (!evTitle.trim() || !detail) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/grc/implementations/${detail.id}/evidence`, { title: evTitle });
      setEvTitle('');
      await openDetail(detail.id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
    finally { setBusy(false); }
  };

  const reviewEvidence = async (evId: string) => {
    const relevance = window.prompt('Relevance (Yes / Partial / No):', 'Yes');
    if (!relevance) return;
    const sufficiency = window.prompt('Sufficiency (Yes / Partial / No):', 'Yes') || 'NotAssessed';
    const authenticity = window.prompt('Authenticity (Yes / Partial / No):', 'Yes') || 'NotAssessed';
    const currency = window.prompt('Currency (Yes / Partial / No):', 'Yes') || 'NotAssessed';
    try {
      await apiClient.post(`/api/grc/evidence/${evId}/review`, { relevance, sufficiency, authenticity, currency });
      if (detail) await openDetail(detail.id);
    } catch (err) { window.alert(apiError(err)); }
  };

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      await apiClient.post('/api/grc/implementations', form);
      setShowNew(false);
      setForm({ controlId: '', successCriteria: '', frequency: 'Quarterly' });
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not create implementation')); }
    finally { setBusy(false); }
  };

  const q = search.toLowerCase();
  const visible = impls.filter((i) => {
    if (statusFilter && i.status !== statusFilter) return false;
    if (q && !i.title.toLowerCase().includes(q) && !i.control.code.toLowerCase().includes(q)) return false;
    return true;
  });

  const coverage = totals.total > 0 ? Math.round((totals.verified / totals.total) * 100) : 0;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Implementations &amp; evidence</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Verified status is reached only through independent validation. Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <button onClick={() => { setFormErr(''); setShowNew(true); }} style={primaryBtn()}>+ Implement a control</button>
        </div>
      </div>

      <StatStrip items={[
        ['Verified coverage', <span style={{ color: coverage >= 80 ? 'var(--success)' : coverage >= 50 ? 'var(--warning)' : 'var(--danger)' }}>{coverage}%</span>],
        ['Total', totals.total ?? 0],
        ['Verified', <span style={{ color: 'var(--success)' }}>{totals.verified ?? 0}</span>],
        ['Awaiting validation', <span style={{ color: (totals.awaitingValidation ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.awaitingValidation ?? 0}</span>],
        ['Overdue', <span style={{ color: (totals.overdue ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.overdue ?? 0}</span>],
      ]} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="Search control code or title…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 280 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...S.input, maxWidth: 190 }}>
          <option value="">All statuses</option>
          {['NotStarted', 'InProgress', 'Implemented', 'Verified'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice} <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading implementations…</div>
      ) : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={S.headRow}>
                {['Control', 'Entity', 'Owner', 'Freq', 'Status', 'Effectiveness', 'Evidence', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                <tr key={i.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <button onClick={() => openDetail(i.id)} style={{ ...linkBtn('var(--ink-body)'), fontSize: 12, padding: 0, textAlign: 'left' }}>
                      <strong>{i.control.code}</strong> — {i.title}
                    </button>
                    <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                      {i.mappedStandards.map((s: string) => <span key={s} style={pill('var(--info)', 'var(--info-line)')}>{s}</span>)}
                      {i.isOverdue && <span style={pill('var(--danger)', 'var(--danger-line)')}>overdue</span>}
                    </div>
                  </td>
                  <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{i.tenant.name}</td>
                  <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{i.owner.name}</td>
                  <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{i.frequency}</td>
                  <td style={S.td}><span style={STATUS_PILL[i.status] || STATUS_PILL.NotStarted}>{i.status}</span></td>
                  <td style={{ ...S.td, color: EFFECT_COLOR[i.effectiveness] || 'var(--ink-muted)' }}>{i.effectiveness}</td>
                  <td style={{ ...S.td, color: i._count.evidence === 0 ? 'var(--warning)' : 'var(--ink-body)' }}>{i._count.evidence}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    {i.status === 'NotStarted' && <button onClick={() => setStatus(i.id, 'InProgress')} style={linkBtn('var(--info)')}>start</button>}
                    {i.status === 'InProgress' && <button onClick={() => setStatus(i.id, 'Implemented')} style={linkBtn('var(--info)')}>submit</button>}
                    {i.canValidate && <button onClick={() => validate(i.id)} style={linkBtn('var(--success)')}>validate</button>}
                    {i.awaitingValidation && !i.canValidate && (
                      <span style={{ fontSize: 11, color: 'var(--warning)' }}>awaiting independent validation</span>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--ink-muted)' }}>No implementations match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 480, padding: 26, borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 17, color: 'var(--ink)' }}>Implement a control</h3>
            {formErr && <div style={{ ...S.error, marginBottom: 14 }}>{formErr}</div>}
            <form onSubmit={submitNew}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Library control</label>
              <select required value={form.controlId} onChange={(e) => setForm({ ...form, controlId: e.target.value })} style={{ ...S.input, marginBottom: 12 }}>
                <option value="">— select —</option>
                {controls.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
              </select>

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Frequency</label>
              <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} style={{ ...S.input, marginBottom: 12 }}>
                {['Continuous', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual'].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Success criteria</label>
              <textarea required rows={3} value={form.successCriteria} onChange={(e) => setForm({ ...form, successCriteria: e.target.value })}
                placeholder="What evidence would prove this control operated effectively?"
                style={{ ...S.input, marginBottom: 20, resize: 'vertical' }} />

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Creating…' : 'Create'}
                </button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 720, padding: 26, borderRadius: 12, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>{detail.control.code} — {detail.title}</h3>
              <button onClick={() => setDetail(null)} style={linkBtn('var(--ink-muted)')}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 14 }}>
              {detail.tenant.name} · owner {detail.owner.name}
              {detail.operator && ` · operator ${detail.operator.name}`} · {detail.frequency}
              <span style={{ marginLeft: 8 }}><span style={STATUS_PILL[detail.status]}>{detail.status}</span></span>
            </div>

            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 8, fontSize: 12, color: 'var(--ink-body)', lineHeight: 1.6 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-body)', marginBottom: 4 }}>CONTROL OBJECTIVE</div>
              {detail.control.objective}
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 14, fontSize: 12, color: 'var(--ink-body)', lineHeight: 1.6 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-body)', marginBottom: 4 }}>SUCCESS CRITERIA</div>
              {detail.successCriteria}
            </div>

            {detail.validatedBy && (
              <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', borderRadius: 6, padding: 12, marginBottom: 14, fontSize: 12, color: 'var(--success)' }}>
                ✓ Independently validated by {detail.validatedBy.name} as{' '}
                <strong style={{ color: EFFECT_COLOR[detail.effectiveness] }}>{detail.effectiveness}</strong>
                {detail.validationNote && <div style={{ color: 'var(--ink-muted)', marginTop: 4 }}>{detail.validationNote}</div>}
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 8 }}>
              Evidence ({detail.evidence.length})
            </div>
            {detail.evidence.map((e: any) => (
              <div key={e.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-body)' }}>{e.title}</span>
                  <span style={{ fontSize: 10, color: 'var(--ink-body)' }}>{e.uploadedBy.name}</span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10 }}>
                  {(['relevance', 'sufficiency', 'authenticity', 'currency'] as const).map((k) => (
                    <span key={k} style={{ color: JUDGE_COLOR[e[k]] || 'var(--ink-body)' }}>
                      {k}: {e[k]}
                    </span>
                  ))}
                </div>
                {e.reviewedBy
                  ? <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 5 }}>reviewed by {e.reviewedBy.name}</div>
                  : e.uploadedBy.id !== me?.id && (
                    <button onClick={() => reviewEvidence(e.id)} style={{ ...linkBtn('var(--info)'), marginTop: 5, padding: 0 }}>review evidence</button>
                  )}
              </div>
            ))}
            {detail.evidence.length === 0 && (
              <div style={{ color: 'var(--warning)', fontSize: 12, marginBottom: 10 }}>
                No evidence attached — validation is blocked until at least one item exists.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input value={evTitle} onChange={(e) => setEvTitle(e.target.value)}
                placeholder="Evidence title…" style={{ ...S.input, flex: 1 }} />
              <button onClick={addEvidence} disabled={busy || !evTitle.trim()} style={primaryBtn(busy || !evTitle.trim())}>
                Attach
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Implementations;
