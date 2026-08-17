import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';
import Icon from '../../../components/Icon';

/**
 * Risk criteria and appetite history — ISO 31000 clause 6.3.4, IIA Std 9.1.
 *
 * Two things live here because they answer the same question. The criteria say
 * what a level *means*; the appetite says how much of it the board will carry.
 * Both are audit evidence, so both are versioned, and this panel exists so the
 * evidence can actually be read — including what was in force on a past date,
 * which is the question a version history is for.
 */

const money = (n?: number | null) =>
  n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1_000).toFixed(0)}k`;

const STATUS: Record<string, React.CSSProperties> = {
  Draft: pill('var(--warning)', 'var(--warning-line)'),
  Approved: pill('var(--success)', 'var(--success-line)'),
  Superseded: pill('var(--ink-muted)', 'var(--line)'),
};

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--ink-faint)',
  marginBottom: 4, letterSpacing: '0.03em', fontWeight: 600,
};

const RiskCriteriaPanel: React.FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const [data, setData] = useState<any>(null);
  const [appetites, setAppetites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [asAt, setAsAt] = useState('');
  const [asAtCategory, setAsAtCategory] = useState('Technology');
  const [asAtResult, setAsAtResult] = useState<any>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [c, a] = await Promise.all([
        apiClient.get('/api/grc/risk-criteria'),
        apiClient.get('/api/grc/appetite').catch(() => null),
      ]);
      setData(c.data);
      setAppetites(a?.data?.appetites || []);
    } catch (err) { setError(apiError(err, 'Failed to load risk criteria')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const lookup = async () => {
    try {
      const qs = new URLSearchParams();
      if (asAt) qs.set('at', new Date(asAt).toISOString());
      if (asAtCategory) qs.set('category', asAtCategory);
      const res = await apiClient.get(`/api/grc/risk-criteria/as-at?${qs}`);
      setAsAtResult(res.data);
    } catch (err) { window.alert(apiError(err)); }
  };

  const startEdit = () => {
    const base = data?.active || data?.platformDefault;
    setEditing({
      name: `FY${new Date().getFullYear()} enterprise risk criteria`,
      impactScale: JSON.parse(JSON.stringify(base.impactScale)),
      likelihoodScale: JSON.parse(JSON.stringify(base.likelihoodScale)),
      highThreshold: base.highThreshold,
      mediumThreshold: base.mediumThreshold,
      currency: base.currency || 'SAR',
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiClient.post('/api/grc/risk-criteria', editing);
      setEditing(null);
      setNotice(res.data?.message || 'Criteria drafted');
      await load();
      onChanged?.();
    } catch (err) { window.alert(apiError(err)); }
    finally { setBusy(false); }
  };

  const approve = async (id: string) => {
    try {
      const res = await apiClient.post(`/api/grc/risk-criteria/${id}/approve`);
      setNotice(res.data?.message || 'Approved');
      await load();
      onChanged?.();
    } catch (err) { window.alert(apiError(err)); }
  };

  const withdraw = async (id: string) => {
    if (!window.confirm('Withdraw this draft? Approved versions are part of the record and cannot be removed.')) return;
    try {
      const res = await apiClient.delete(`/api/grc/risk-criteria/${id}`);
      setNotice(res.data?.message || 'Withdrawn');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  if (loading) return <div style={{ ...S.card, padding: 24, color: 'var(--ink-muted)' }}>Loading criteria…</div>;
  if (error) return <div style={S.error}><Icon name="warning" size={15} />{error}</div>;

  const active = data?.active;
  const versions = data?.versions || [];
  const draft = versions.find((v: any) => v.status === 'Draft');
  const revised = appetites.filter((a: any) => (a.version ?? 1) > 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          <Icon name="success" size={15} />
          <span style={{ flex: 1 }}>{notice}</span>
          <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      {/* ── What is in force ──────────────────────────────────────────── */}
      <div style={{ ...S.card, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              Measurement criteria in force
            </h3>
            <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: '46rem', lineHeight: 1.55 }}>
              What a level actually means, in this organisation's words. ISO 31000 clause 6.3.4 asks
              each organisation to define its own — a hospital group's "catastrophic" is not a bank's.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!draft && (
              <button style={{ ...primaryBtn(), display: 'flex', alignItems: 'center', gap: 6 }} onClick={startEdit}>
                <Icon name="edit" size={14} /> {active?.isPlatformDefault ? 'Set our own criteria' : 'Revise criteria'}
              </button>
            )}
            <button style={ghostBtn} onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? 'Hide history' : `History (${versions.length})`}
            </button>
          </div>
        </div>

        {active?.isPlatformDefault && (
          <div style={{
            marginTop: 14, padding: '11px 14px', background: 'var(--warning-bg)',
            border: '1px solid var(--warning-line)', borderRadius: 'var(--radius)',
            fontSize: 12.5, color: 'var(--warning)', display: 'flex', gap: 9, alignItems: 'flex-start',
          }}>
            <Icon name="warning" size={15} />
            <span>
              Running on the platform default. Nothing here has been approved by this organisation, so
              the scale carries no board authority — an assessor will ask who set it.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 4px' }}>
          <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{active?.name}</strong>
          {!active?.isPlatformDefault && <span style={STATUS.Approved}>v{active.version} in force</span>}
          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
            High at {active?.highThreshold}, Medium at {active?.mediumThreshold} on the 1–25 product
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, marginTop: 14 }}>
          {([['Impact', active?.impactScale], ['Likelihood', active?.likelihoodScale]] as const).map(([title, scale]) => (
            <div key={title}>
              <div style={{ ...label, marginBottom: 8 }}>{title} scale</div>
              {(scale || []).map((lv: any) => (
                <div key={lv.level} style={{
                  display: 'flex', gap: 10, padding: '8px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}>
                  <span style={{
                    minWidth: 22, height: 22, borderRadius: 4, background: 'var(--surface-sunk)',
                    border: '1px solid var(--line)', display: 'grid', placeItems: 'center',
                    fontSize: 11.5, fontWeight: 700, color: 'var(--ink-muted)',
                    fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                  }}>{lv.level}</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--ink)' }}>
                      {lv.label}
                      {lv.frequency && <span style={{ fontWeight: 400, color: 'var(--ink-faint)' }}> · {lv.frequency}</span>}
                      {lv.monetaryFrom != null && (
                        <span style={{ fontWeight: 400, color: 'var(--ink-faint)' }}>
                          {' · '}{active.currency} {money(lv.monetaryFrom)}
                          {lv.monetaryTo != null ? `–${money(lv.monetaryTo)}` : '+'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.45, marginTop: 2 }}>
                      {lv.descriptor}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Draft awaiting approval ───────────────────────────────────── */}
      {draft && (
        <div style={{ ...S.card, padding: 18, borderLeft: '4px solid var(--warning)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{draft.name}</strong>
              <span style={{ marginLeft: 8 }}><span style={STATUS.Draft}>v{draft.version} draft</span></span>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                Drafted by {draft.setBy?.name}. High at {draft.highThreshold}, Medium at {draft.mediumThreshold}.
                Approving will re-band every score in the register, and whoever drafted it cannot approve it.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={linkBtn('var(--success)')} onClick={() => approve(draft.id)}>approve</button>
              <button style={linkBtn('var(--ink-faint)')} onClick={() => withdraw(draft.id)}>withdraw</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Version history ───────────────────────────────────────────── */}
      {showHistory && (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={S.headRow}>
                {['Version', 'Name', 'Bands', 'Status', 'In force', 'Approved by'].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {versions.map((v: any) => (
                <tr key={v.id} style={S.bodyRow}>
                  <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}>v{v.version}</td>
                  <td style={{ ...S.td, color: 'var(--ink)' }}>{v.name}</td>
                  <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>
                    High ≥ {v.highThreshold} · Medium ≥ {v.mediumThreshold}
                  </td>
                  <td style={S.td}><span style={STATUS[v.status] || STATUS.Draft}>{v.status}</span></td>
                  <td style={{ ...S.td, color: 'var(--ink-muted)', fontSize: 12 }}>
                    {v.effectiveFrom ? String(v.effectiveFrom).slice(0, 10) : '—'}
                    {v.effectiveTo ? ` → ${String(v.effectiveTo).slice(0, 10)}` : v.effectiveFrom ? ' → current' : ''}
                  </td>
                  <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{v.approvedBy?.name || '—'}</td>
                </tr>
              ))}
              {versions.length === 0 && (
                <tr><td colSpan={6} style={{ ...S.td, padding: 26, textAlign: 'center', color: 'var(--ink-faint)' }}>
                  No tenant criteria set yet — the platform default is in use.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── As at ─────────────────────────────────────────────────────── */}
      <div style={{ ...S.card, padding: 18 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
          What was in force on a given date?
        </h3>
        <p style={{ margin: '5px 0 12px', fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: '44rem', lineHeight: 1.55 }}>
          The question a version history exists to answer. An acceptance taken last March was judged
          against whatever ceiling applied then — not against today's.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={label}>Date</label>
            <input type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)} style={{ ...S.input, width: 170 }} />
          </div>
          <div>
            <label style={label}>Appetite category</label>
            <select value={asAtCategory} onChange={(e) => setAsAtCategory(e.target.value)} style={{ ...S.input, width: 180 }}>
              {[...new Set(appetites.map((a: any) => a.category))].map((c: any) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <button style={{ ...primaryBtn(), display: 'flex', alignItems: 'center', gap: 6 }} onClick={lookup}>
            <Icon name="search" size={14} /> Look up
          </button>
        </div>

        {asAtResult && (
          <div style={{
            marginTop: 14, padding: 14, background: 'var(--surface-sunk)',
            border: '1px solid var(--line)', borderRadius: 'var(--radius)', fontSize: 12.5, lineHeight: 1.7,
          }}>
            <div style={{ color: 'var(--ink)' }}>
              <strong>As at {String(asAtResult.at).slice(0, 10)}</strong>
            </div>
            <div style={{ color: 'var(--ink-body)', marginTop: 5 }}>
              Criteria: {asAtResult.note}
              {!asAtResult.criteria.isPlatformDefault && (
                <> High at {asAtResult.criteria.highThreshold}, Medium at {asAtResult.criteria.mediumThreshold}.</>
              )}
            </div>
            {asAtResult.appetite ? (
              <div style={{ color: 'var(--ink-body)', marginTop: 5 }}>
                Appetite for {asAtCategory}: <strong>version {asAtResult.appetite.version}</strong> —
                appetite {asAtResult.appetite.appetiteThreshold}, tolerance{' '}
                <strong>{asAtResult.appetite.toleranceThreshold}</strong>.
                <div style={{ color: 'var(--ink-muted)', fontSize: 12, marginTop: 3 }}>
                  “{asAtResult.appetite.statement}”
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--ink-muted)', marginTop: 5 }}>
                No approved appetite for {asAtCategory} was in force on that date.
              </div>
            )}
          </div>
        )}
      </div>

      {revised.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
          {revised.length} appetite {revised.length === 1 ? 'category has' : 'categories have'} been revised;
          every prior version is retained as the basis for decisions taken while it applied.
        </div>
      )}

      {/* ── Editor ────────────────────────────────────────────────────── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 920, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 780, padding: 26, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>Draft risk criteria</h3>
              <button onClick={() => setEditing(null)} style={linkBtn('var(--ink-muted)')} aria-label="Close">
                <Icon name="close" size={15} label="Close" />
              </button>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              Write what each level means for this organisation. The descriptor is the point — a level
              without one is a number two assessors will read differently, which is exactly what
              criteria exist to prevent. A second person must approve before these bind.
            </p>

            <form onSubmit={save}>
              <label style={label}>Name</label>
              <input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                style={{ ...S.input, marginBottom: 16 }} />

              {(['impactScale', 'likelihoodScale'] as const).map((key) => (
                <div key={key} style={{ marginBottom: 20 }}>
                  <div style={{ ...label, fontSize: 12, color: 'var(--ink)', marginBottom: 8 }}>
                    {key === 'impactScale' ? 'Impact levels' : 'Likelihood levels'}
                  </div>
                  {editing[key].map((lv: any, idx: number) => (
                    <div key={lv.level} style={{
                      display: 'grid', gap: 8, marginBottom: 8, padding: 10,
                      gridTemplateColumns: '30px 150px 1fr',
                      background: 'var(--surface-sunk)', border: '1px solid var(--line-soft)',
                      borderRadius: 'var(--radius-sm)', alignItems: 'start',
                    }}>
                      <div style={{ paddingTop: 9, fontWeight: 700, color: 'var(--ink-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {lv.level}
                      </div>
                      <input required value={lv.label} placeholder="Label"
                        onChange={(e) => {
                          const next = [...editing[key]];
                          next[idx] = { ...lv, label: e.target.value };
                          setEditing({ ...editing, [key]: next });
                        }}
                        style={S.input} />
                      <div>
                        <textarea required rows={2} value={lv.descriptor} placeholder="What this level means here"
                          onChange={(e) => {
                            const next = [...editing[key]];
                            next[idx] = { ...lv, descriptor: e.target.value };
                            setEditing({ ...editing, [key]: next });
                          }}
                          style={{ ...S.input, resize: 'vertical' }} />
                        {key === 'likelihoodScale' && (
                          <input required value={lv.frequency || ''} placeholder="Expected frequency, e.g. once in 5 years"
                            onChange={(e) => {
                              const next = [...editing[key]];
                              next[idx] = { ...lv, frequency: e.target.value };
                              setEditing({ ...editing, [key]: next });
                            }}
                            style={{ ...S.input, marginTop: 6 }} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={label}>High band starts at</label>
                  <input type="number" min={2} max={25} required value={editing.highThreshold}
                    onChange={(e) => setEditing({ ...editing, highThreshold: Number(e.target.value) })} style={S.input} />
                </div>
                <div>
                  <label style={label}>Medium band starts at</label>
                  <input type="number" min={2} max={25} required value={editing.mediumThreshold}
                    onChange={(e) => setEditing({ ...editing, mediumThreshold: Number(e.target.value) })} style={S.input} />
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 6 }}>
                On a 5×5 matrix a score runs 1–25. High must sit above Medium, otherwise no score can
                ever land in the middle band.
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Drafting…' : 'Save as draft'}
                </button>
                <button type="button" onClick={() => setEditing(null)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RiskCriteriaPanel;
