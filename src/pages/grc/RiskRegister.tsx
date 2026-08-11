import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';

const RATING_COLOR: Record<string, string> = { High: 'var(--danger)', Medium: 'var(--warning)', Low: 'var(--success)' };
const STATUS_PILL: Record<string, React.CSSProperties> = {
  Open: pill('var(--warning)', 'var(--warning-line)'),
  UnderTreatment: pill('var(--info)', 'var(--info-line)'),
  Accepted: pill('var(--violet)', 'var(--violet)'),
  Closed: pill('var(--success)', 'var(--success-line)'),
};

function ratingOf(score: number) { return score >= 15 ? 'High' : score >= 8 ? 'Medium' : 'Low'; }

const RiskRegister: React.FC = () => {
  const [risks, setRisks] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [impls, setImpls] = useState<any[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [detail, setDetail] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: 'Operational', likelihood: 3, impact: 3, treatmentType: 'Mitigate' });
  const [dupes, setDupes] = useState<any[] | null>(null);
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  const me = (() => { try { return JSON.parse(localStorage.getItem('grc_user_json') || 'null'); } catch { return null; } })();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [rRes, iRes] = await Promise.all([
        apiClient.get('/api/grc/risks'),
        apiClient.get('/api/grc/implementations').catch(() => null),
      ]);
      setRisks(rRes.data?.risks || []);
      setTotals(rRes.data?.totals || {});
      setCategories(rRes.data?.categories || []);
      setImpls(iRes?.data?.implementations || []);
      setScope(rRes.data?.scope || '');
    } catch (err) { setError(apiError(err, 'Failed to load the risk register')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitNew = async (e: React.FormEvent, force = false) => {
    e.preventDefault();
    setBusy(true); setFormErr(''); setDupes(null);
    try {
      await apiClient.post('/api/grc/risks', { ...form, force });
      setShowNew(false);
      setForm({ title: '', description: '', category: 'Operational', likelihood: 3, impact: 3, treatmentType: 'Mitigate' });
      await load();
    } catch (err: any) {
      if (err?.response?.data?.code === 'POSSIBLE_DUPLICATES') {
        setDupes(err.response.data.candidates || []);
      } else {
        setFormErr(apiError(err, 'Could not create risk'));
      }
    } finally { setBusy(false); }
  };

  const addTreatment = async (riskId: string) => {
    const title = window.prompt('Treatment action title:');
    if (!title) return;
    const dueDate = window.prompt('Due date (YYYY-MM-DD):');
    if (!dueDate) return;
    try {
      await apiClient.post(`/api/grc/risks/${riskId}/treatments`, { title, dueDate });
      setNotice('Treatment action added');
      await load();
      if (detail?.id === riskId) openDetail(riskId);
    } catch (err) { window.alert(apiError(err)); }
  };

  const completeTreatment = async (treatmentId: string, riskId: string) => {
    try {
      await apiClient.post(`/api/grc/treatments/${treatmentId}/complete`);
      await load();
      if (detail?.id === riskId) openDetail(riskId);
    } catch (err) { window.alert(apiError(err)); }
  };

  const accept = async (risk: any) => {
    if (risk.ownerId === me?.id) { window.alert('SoD: the risk owner cannot approve acceptance of their own risk.'); return; }
    const until = window.prompt('Accept until (YYYY-MM-DD):');
    if (!until) return;
    const reason = window.prompt('Acceptance justification:');
    if (!reason) return;
    try {
      const res = await apiClient.post(`/api/grc/risks/${risk.id}/accept`, { until, reason });
      setNotice(res.data?.message || 'Risk accepted');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const linkControls = async (risk: any) => {
    const options = impls.filter((i) => i.tenant?.id === risk.tenant.id);
    if (options.length === 0) { window.alert('No control implementations available in this entity.'); return; }
    const list = options.map((o, i) => `${i + 1}. ${o.control.code} — ${o.status}/${o.effectiveness}`).join('\n');
    const picks = window.prompt(`Link verified controls to reduce residual risk.\nEnter numbers comma-separated:\n\n${list}`);
    if (picks === null) return;
    const ids = picks.split(',').map((n) => options[Number(n.trim()) - 1]?.id).filter(Boolean);
    try {
      const res = await apiClient.post(`/api/grc/risks/${risk.id}/links`, { implementationIds: ids });
      setNotice(res.data?.message || 'Controls linked');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const openDetail = async (id: string) => {
    const r = risks.find((x) => x.id === id) || detail;
    setDetail(r);
  };

  const q = search.toLowerCase();
  const visible = risks.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (q && !r.title.toLowerCase().includes(q) && !r.ref.toLowerCase().includes(q)) return false;
    return true;
  });

  // 5×5 heatmap by residual L×I
  const heat: Record<string, any[]> = {};
  for (const r of risks) {
    const key = `${r.residualLikelihood}-${r.residualImpact}`;
    (heat[key] ||= []).push(r);
  }

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Risk register</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Residual score is computed from linked-control effectiveness. Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <button onClick={() => { setFormErr(''); setDupes(null); setShowNew(true); }} style={primaryBtn()}>+ New risk</button>
        </div>
      </div>

      <StatStrip items={[
        ['Total', totals.total ?? 0],
        ['High residual', <span style={{ color: (totals.highResidual ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.highResidual ?? 0}</span>],
        ['Under treatment', totals.underTreatment ?? 0],
        ['Accepted', totals.accepted ?? 0],
        ['Overdue actions', <span style={{ color: (totals.overdueTreatments ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.overdueTreatments ?? 0}</span>],
      ]} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 16, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input placeholder="Search title or ref…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 240 }} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...S.input, maxWidth: 180 }}>
              <option value="">All statuses</option>
              {['Open', 'UnderTreatment', 'Accepted', 'Closed'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {error && <div style={S.error}>{error}</div>}
          {notice && (
            <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
              {notice} <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
            </div>
          )}

          {loading ? (
            <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading risks…</div>
          ) : (
            <div style={{ ...S.card, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={S.headRow}>
                    {['Risk', 'Owner', 'Inherent', 'Residual', 'Treatment', 'Status', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id} style={S.bodyRow}>
                      <td style={S.td}>
                        <button onClick={() => setDetail(r)} style={{ ...linkBtn('var(--ink-body)'), fontSize: 12, padding: 0, textAlign: 'left' }}>
                          <strong>{r.ref}</strong> — {r.title}
                        </button>
                        <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                          <span style={pill('var(--ink-muted)', 'var(--line)')}>{r.category}</span>
                          {r.linkedControls.map((c: string) => <span key={c} style={pill('var(--info)', 'var(--info-line)')}>{c}</span>)}
                          {r.acceptanceExpired && <span style={pill('var(--danger)', 'var(--danger-line)')}>acceptance expired</span>}
                        </div>
                      </td>
                      <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{r.owner.name}</td>
                      <td style={{ ...S.td, color: RATING_COLOR[r.inherentRating] }}>{r.inherentScore} <span style={{ color: 'var(--ink-body)', fontSize: 10 }}>({r.inherentLikelihood}×{r.inherentImpact})</span></td>
                      <td style={{ ...S.td, color: RATING_COLOR[r.residualRating], fontWeight: 500 }}>
                        {r.residualScore} <span style={{ color: 'var(--ink-body)', fontSize: 10 }}>({r.residualLikelihood}×{r.residualImpact})</span>
                        {r.residualScore < r.inherentScore && <span style={{ color: 'var(--success)', fontSize: 10 }}> ▼</span>}
                      </td>
                      <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{r.treatmentType}</td>
                      <td style={S.td}><span style={STATUS_PILL[r.status] || STATUS_PILL.Open}>{r.status}</span></td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        <button onClick={() => linkControls(r)} style={linkBtn('var(--info)')}>controls</button>
                        {r.status !== 'Accepted' && r.status !== 'Closed' && (
                          <button onClick={() => accept(r)} style={linkBtn('var(--violet)')}>accept</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: 'var(--ink-muted)' }}>No risks match the filter.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 5×5 residual heatmap */}
        <div style={{ ...S.card, padding: 14, minWidth: 210 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>Residual heatmap</div>
          <div style={{ display: 'flex', gap: 3 }}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', fontSize: 9, color: 'var(--ink-body)', paddingRight: 2 }}>
              {[5, 4, 3, 2, 1].map((n) => <div key={n} style={{ height: 30, display: 'flex', alignItems: 'center' }}>{n}</div>)}
            </div>
            <div>
              <div style={{ display: 'grid', gridTemplateRows: 'repeat(5,30px)', gridTemplateColumns: 'repeat(5,30px)', gap: 3 }}>
                {[5, 4, 3, 2, 1].map((impact) =>
                  [1, 2, 3, 4, 5].map((lik) => {
                    const cell = heat[`${lik}-${impact}`] || [];
                    const score = lik * impact;
                    const bg = score >= 15 ? 'var(--danger)' : score >= 8 ? 'var(--warning)' : 'var(--success)';
                    return (
                      <div key={`${lik}-${impact}`} title={`L${lik} × I${impact} = ${score}`}
                        style={{ background: cell.length ? bg : 'var(--surface)', border: '1px solid var(--line)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: cell.length ? 'var(--ink)' : 'var(--ink-body)' }}>
                        {cell.length || ''}
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,30px)', gap: 3, fontSize: 9, color: 'var(--ink-body)', marginTop: 2 }}>
                {[1, 2, 3, 4, 5].map((n) => <div key={n} style={{ textAlign: 'center' }}>{n}</div>)}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 9, color: 'var(--ink-body)', marginTop: 6 }}>Likelihood → · Impact ↑</div>
        </div>
      </div>

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 500, padding: 26, borderRadius: 12, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 17, color: 'var(--ink)' }}>New risk</h3>
            {formErr && <div style={{ ...S.error, marginBottom: 14 }}>{formErr}</div>}
            {dupes && (
              <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', borderRadius: 6, padding: 12, marginBottom: 14, fontSize: 12 }}>
                <div style={{ color: 'var(--warning)', marginBottom: 8 }}>Similar risks already exist — review before creating a duplicate:</div>
                {dupes.map((d) => <div key={d.id} style={{ color: 'var(--ink-muted)', marginBottom: 3 }}>{d.ref} — {d.title} <span style={{ color: 'var(--ink-body)' }}>({d.status})</span></div>)}
                <button onClick={(e) => submitNew(e as any, true)} style={{ ...linkBtn('var(--danger)'), marginTop: 6 }}>Create anyway</button>
              </div>
            )}
            <form onSubmit={(e) => submitNew(e)}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Title</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Description (cause → event → impact)</label>
              <textarea required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...S.input, marginBottom: 12, resize: 'vertical' }} />

              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={S.input}>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Treatment</label>
                  <select value={form.treatmentType} onChange={(e) => setForm({ ...form, treatmentType: e.target.value })} style={S.input}>
                    {['Mitigate', 'Accept', 'Transfer', 'Avoid'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Likelihood (1–5)</label>
                  <input type="number" min={1} max={5} value={form.likelihood} onChange={(e) => setForm({ ...form, likelihood: Number(e.target.value) })} style={S.input} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Impact (1–5)</label>
                  <input type="number" min={1} max={5} value={form.impact} onChange={(e) => setForm({ ...form, impact: Number(e.target.value) })} style={S.input} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: RATING_COLOR[ratingOf(form.likelihood * form.impact)], marginBottom: 20 }}>
                Inherent score: {form.likelihood * form.impact} ({ratingOf(form.likelihood * form.impact)})
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>{busy ? 'Creating…' : 'Create risk'}</button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 640, padding: 26, borderRadius: 12, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>{detail.ref} — {detail.title}</h3>
              <button onClick={() => setDetail(null)} style={linkBtn('var(--ink-muted)')}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 14 }}>
              {detail.category} · owner {detail.owner.name} · treatment {detail.treatmentType}
              <span style={{ marginLeft: 8 }}><span style={STATUS_PILL[detail.status]}>{detail.status}</span></span>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: 12, marginBottom: 14, fontSize: 12, color: 'var(--ink-body)', lineHeight: 1.6 }}>
              {detail.description}
            </div>
            <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
              <div><span style={{ fontSize: 10, color: 'var(--ink-body)' }}>INHERENT</span><div style={{ color: RATING_COLOR[detail.inherentRating], fontSize: 18 }}>{detail.inherentScore}</div></div>
              <div style={{ alignSelf: 'center', color: 'var(--ink-body)' }}>→</div>
              <div><span style={{ fontSize: 10, color: 'var(--ink-body)' }}>RESIDUAL</span><div style={{ color: RATING_COLOR[detail.residualRating], fontSize: 18 }}>{detail.residualScore}</div></div>
              <div style={{ alignSelf: 'center', fontSize: 11, color: 'var(--ink-muted)' }}>
                {detail.linkedControls.length} control(s) linked
              </div>
            </div>

            {detail.acceptedBy && (
              <div style={{ background: '#1a1229', border: '1px solid var(--violet)', borderRadius: 6, padding: 10, marginBottom: 14, fontSize: 12, color: 'var(--violet)' }}>
                Accepted by {detail.acceptedBy.name} until {detail.acceptedUntil?.slice(0, 10)} — {detail.acceptanceReason}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Treatment actions ({detail.treatments.length})</span>
              <button onClick={() => addTreatment(detail.id)} style={linkBtn('var(--info)')}>+ add action</button>
            </div>
            {detail.treatments.map((t: any) => (
              <div key={t.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: 10, marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: 12, color: t.status === 'Done' ? 'var(--ink-muted)' : 'var(--ink-body)', textDecoration: t.status === 'Done' ? 'line-through' : 'none' }}>{t.title}</span>
                  {t.dueDate && <span style={{ fontSize: 10, color: 'var(--ink-body)', marginLeft: 8 }}>due {t.dueDate.slice(0, 10)}</span>}
                </div>
                {t.status === 'Open'
                  ? <button onClick={() => completeTreatment(t.id, detail.id)} style={linkBtn('var(--success)')}>complete</button>
                  : <span style={pill('var(--success)', 'var(--success-line)')}>done</span>}
              </div>
            ))}
            {detail.treatments.length === 0 && <div style={{ color: 'var(--ink-body)', fontSize: 12 }}>No treatment actions yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default RiskRegister;
