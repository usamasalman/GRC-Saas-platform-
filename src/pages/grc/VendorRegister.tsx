import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';
import Icon from '../../components/Icon';

/**
 * Third-party risk management.
 *
 * What was here before was a static table of four invented suppliers under a
 * KPI reading "74 Active Vendors" against an empty database. Every number on
 * this screen is now derived from what the tenant recorded, and the tier is
 * arithmetic rather than a label somebody picked.
 */

const TIER: Record<string, React.CSSProperties> = {
  Critical: pill('#7F1D1A', '#E09A94'),
  High: pill('#8A3312', '#E9B49C'),
  Medium: pill('#6B4A08', '#E8CE94'),
  Low: pill('#14532D', '#A8D5BA'),
};

/**
 * Due-diligence posture. "Never assessed" is deliberately not the same colour
 * as "current" — a blank is not a pass, and a register that renders them alike
 * is worse than no register.
 */
const POSTURE: Record<string, { fg: string; line: string; help: string }> = {
  Current: { fg: 'var(--success)', line: 'var(--success-line)', help: 'Assessed adequate and within cadence.' },
  Watch: { fg: 'var(--warning)', line: 'var(--warning-line)', help: 'Last assessment concluded needs improvement.' },
  Stale: { fg: 'var(--warning)', line: 'var(--warning-line)', help: 'Previously adequate, but the reassessment is past due.' },
  InProgress: { fg: 'var(--info)', line: 'var(--info-line)', help: 'Assessment issued; no reviewed outcome yet.' },
  Overdue: { fg: 'var(--danger)', line: 'var(--danger-line)', help: 'An issued assessment is past its due date.' },
  Failing: { fg: 'var(--danger)', line: 'var(--danger-line)', help: 'The most recent assessment concluded inadequate.' },
  NeverAssessed: { fg: 'var(--danger)', line: 'var(--danger-line)', help: 'No due diligence has ever been completed.' },
};

const money = (n: number, ccy = 'SAR') =>
  n >= 1_000_000 ? `${ccy} ${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${ccy} ${(n / 1_000).toFixed(0)}k` : `${ccy} ${n}`;

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4,
  letterSpacing: '0.03em', fontWeight: 600,
};

const humanCategory = (c: string) => c.replace(/([a-z])([A-Z])/g, '$1 $2');

type Tab = 'register' | 'diligence' | 'concentration' | 'formulas';

const VendorRegister: React.FC = () => {
  const [tab, setTab] = useState<Tab>('register');
  const [vendors, setVendors] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>({});
  const [totals, setTotals] = useState<any>({});
  const [analytics, setAnalytics] = useState<any>(null);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [postureFilter, setPostureFilter] = useState('');

  const [detail, setDetail] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const blank = {
    name: '', legalName: '', category: 'Other', description: '',
    country: '', dataLocation: '', dataAccess: 'None', hasSystemAccess: false,
    serviceCriticality: 3, substitutability: 3,
    contractRef: '', contractEnd: '', noticePeriodDays: '', annualSpend: '',
  };
  const [form, setForm] = useState<any>(blank);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [v, a] = await Promise.all([
        apiClient.get('/api/grc/vendors'),
        apiClient.get('/api/grc/vendor-analytics').catch(() => null),
      ]);
      setVendors(v.data?.vendors || []);
      setTotals(v.data?.totals || {});
      setMeta({
        categories: v.data?.categories || [], statuses: v.data?.statuses || [],
        dataAccessLevels: v.data?.dataAccessLevels || [],
        dataAccessHelp: v.data?.dataAccessHelp || {},
        formulas: v.data?.formulas || [],
      });
      setScope(v.data?.scope || '');
      setAnalytics(a?.data || null);
    } catch (err) { setError(apiError(err, 'Failed to load the vendor register')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Mirrors services/vendorRisk.computeTier so the form shows the outcome. */
  const previewTier = useMemo(() => {
    const weights: Record<string, number> = {
      None: 1, Metadata: 2, Confidential: 3, PersonalData: 4, SensitivePersonalData: 5,
    };
    const base = Math.max(weights[form.dataAccess] ?? 1, Number(form.serviceCriticality));
    const sub = Number(form.substitutability);
    let score = base * sub;
    let floored = false;
    if (form.hasSystemAccess && score < 12) { score = 12; floored = true; }
    score = Math.min(25, Math.max(1, score));
    const tier = score >= 20 ? 'Critical' : score >= 14 ? 'High' : score >= 8 ? 'Medium' : 'Low';
    const cadence = tier === 'Critical' ? 6 : tier === 'High' ? 12 : tier === 'Medium' ? 18 : 24;
    return { score, tier, cadence, base, sub, floored };
  }, [form.dataAccess, form.serviceCriticality, form.substitutability, form.hasSystemAccess]);

  const visible = useMemo(() => {
    const q = search.toLowerCase();
    return vendors.filter((v) => {
      if (tierFilter && v.tier !== tierFilter) return false;
      if (postureFilter && v.assessmentPosture !== postureFilter) return false;
      if (q && !v.name.toLowerCase().includes(q) && !v.ref.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [vendors, search, tierFilter, postureFilter]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      const res = await apiClient.post('/api/grc/vendors', {
        ...form,
        noticePeriodDays: form.noticePeriodDays ? Number(form.noticePeriodDays) : undefined,
        annualSpend: form.annualSpend ? Number(form.annualSpend) : undefined,
        contractEnd: form.contractEnd || undefined,
      });
      setShowNew(false); setForm(blank);
      setNotice(res.data?.message || 'Vendor onboarded');
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not onboard the supplier')); }
    finally { setBusy(false); }
  };

  const issueAssessment = async (v: any) => {
    const kind = window.prompt('Assessment type — Onboarding / Periodic / Triggered / Exit:', 'Periodic');
    if (!kind) return;
    const questionnaire = window.prompt('Questionnaire used:', 'SAMA CSF supplier annex');
    try {
      const res = await apiClient.post(`/api/grc/vendors/${v.id}/assessments`, { kind, questionnaire });
      setNotice(res.data?.message || 'Assessment issued');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--brand)' : 'var(--ink-muted)',
    border: `1px solid ${active ? 'var(--line)' : 'transparent'}`,
    borderBottom: active ? '2px solid var(--brand)' : 'none',
    padding: '10px 18px', borderRadius: '6px 6px 0 0',
    fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', gap: 7,
  });

  if (loading) return <div style={{ ...S.page, color: 'var(--ink-muted)' }}>Loading the vendor register…</div>;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Third-party risk</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)', maxWidth: '48rem', lineHeight: 1.55 }}>
            Every supplier the organisation depends on. Tier is derived from what they can reach, how
            badly their failure hurts, and how quickly they could be replaced — and tier is what sets
            the reassessment cadence. Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={load} style={{ ...ghostBtn, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
          <button onClick={() => { setFormErr(''); setShowNew(true); }} style={{ ...primaryBtn(), display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="plus" size={15} /> Onboard supplier
          </button>
        </div>
      </div>

      <StatStrip items={[
        ['Suppliers', totals.total ?? 0],
        ['Critical tier', <span style={{ color: (totals.critical ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.critical ?? 0}</span>],
        ['Never assessed', <span style={{ color: (totals.neverAssessed ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.neverAssessed ?? 0}</span>],
        ['Diligence overdue', <span style={{ color: (totals.assessmentOverdue ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.assessmentOverdue ?? 0}</span>],
        ['Hold personal data', totals.withPersonalData ?? 0],
        ['Annual spend', money(totals.annualSpend ?? 0)],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          <Icon name="success" size={15} />
          <span style={{ flex: 1 }}>{notice}</span>
          <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      {(totals.exitWindowPassed ?? 0) > 0 && (
        <div style={{ ...S.error, background: 'var(--warning-bg)', borderColor: 'var(--warning-line)', color: 'var(--warning)' }}>
          <Icon name="clock" size={15} />
          <span>
            <strong>{totals.exitWindowPassed}</strong> contract(s) can no longer be exited before they roll —
            the notice period has already closed. See the Diligence tab.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 18, overflowX: 'auto' }}>
        <button style={tabStyle(tab === 'register')} onClick={() => setTab('register')}>
          <Icon name="vendors" size={16} /> Register
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{vendors.length}</span>
        </button>
        <button style={tabStyle(tab === 'diligence')} onClick={() => setTab('diligence')}>
          <Icon name="approvals" size={16} /> Due diligence
        </button>
        <button style={tabStyle(tab === 'concentration')} onClick={() => setTab('concentration')}>
          <Icon name="network" size={16} /> Concentration
        </button>
        <button style={tabStyle(tab === 'formulas')} onClick={() => setTab('formulas')}>
          <Icon name="gauge" size={16} /> How tiering works
        </button>
      </div>

      {/* ── Register ──────────────────────────────────────────────────── */}
      {tab === 'register' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input placeholder="Search name or reference…" value={search}
              onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 250 }} />
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={{ ...S.input, maxWidth: 160 }}>
              <option value="">All tiers</option>
              {['Critical', 'High', 'Medium', 'Low'].map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={postureFilter} onChange={(e) => setPostureFilter(e.target.value)} style={{ ...S.input, maxWidth: 190 }}>
              <option value="">All diligence states</option>
              {Object.keys(POSTURE).map((p) => (
                <option key={p} value={p}>{p.replace(/([a-z])([A-Z])/g, '$1 $2')}</option>
              ))}
            </select>
          </div>

          <div style={{ ...S.card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 940 }}>
              <thead>
                <tr style={S.headRow}>
                  {['Supplier', 'Category', 'Can reach', 'Tier', 'Due diligence', 'Contract', 'Actions']
                    .map((h) => <th key={h} style={S.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((v) => {
                  const p = POSTURE[v.assessmentPosture] || POSTURE.NeverAssessed;
                  return (
                    <tr key={v.id} style={S.bodyRow}>
                      <td style={S.td}>
                        <button onClick={() => setDetail(v)}
                          style={{ ...linkBtn('var(--ink-body)'), fontSize: 13, padding: 0, textAlign: 'left' }}>
                          <strong>{v.ref}</strong> — {v.name}
                        </button>
                        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 3 }}>
                          {v.country}{v.dataLocation && v.dataLocation !== v.country && ` · data in ${v.dataLocation}`}
                          {v.hasSystemAccess && <span style={{ color: 'var(--warning)' }}> · system access</span>}
                        </div>
                      </td>
                      <td style={{ ...S.td, color: 'var(--ink-body)' }}>{humanCategory(v.category)}</td>
                      <td style={S.td}>
                        <span style={{
                          color: ['PersonalData', 'SensitivePersonalData'].includes(v.dataAccess)
                            ? 'var(--danger)' : 'var(--ink-body)',
                          fontWeight: ['PersonalData', 'SensitivePersonalData'].includes(v.dataAccess) ? 600 : 400,
                        }}>
                          {humanCategory(v.dataAccess)}
                        </span>
                      </td>
                      <td style={S.td}>
                        <span style={TIER[v.tier] || TIER.Medium}>{v.tier} {v.tierScore}</span>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>
                          reassess every {v.assessmentCadenceMonths}mo
                        </div>
                      </td>
                      <td style={S.td}>
                        <span style={pill(p.fg, p.line)} title={p.help}>
                          {v.assessmentPosture.replace(/([a-z])([A-Z])/g, '$1 $2')}
                        </span>
                        {v.nextAssessmentDue && (
                          <div style={{ fontSize: 10.5, color: v.assessmentOverdue ? 'var(--danger)' : 'var(--ink-faint)', marginTop: 2 }}>
                            due {String(v.nextAssessmentDue).slice(0, 10)}
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>
                        {v.contractEnd ? (
                          <>
                            <div style={{ color: 'var(--ink-body)' }}>{String(v.contractEnd).slice(0, 10)}</div>
                            {v.exitWindowPassed && (
                              <div style={{ fontSize: 10.5, color: 'var(--danger)', fontWeight: 600 }}>exit window closed</div>
                            )}
                          </>
                        ) : <span style={{ color: 'var(--ink-faint)' }}>—</span>}
                      </td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        <button style={linkBtn('var(--info)')} onClick={() => issueAssessment(v)}>assess</button>
                        <button style={linkBtn('var(--ink-muted)')} onClick={() => setDetail(v)}>open</button>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: 34, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    No suppliers match this filter.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Due diligence ─────────────────────────────────────────────── */}
      {tab === 'diligence' && analytics && (
        <div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: '52rem', lineHeight: 1.6, marginTop: 0 }}>
            Tier against due-diligence state. The top-left corner — critical suppliers never assessed —
            is the corner a regulator opens with.
          </p>
          <div style={{ ...S.card, padding: 20, overflowX: 'auto', marginBottom: 22 }}>
            <div style={{ display: 'flex', gap: 8, minWidth: 780 }}>
              <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 4 }}>
                {analytics.tierOrder.map((t: string) => (
                  <div key={t} style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 68 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)' }}>{t}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${analytics.postureOrder.length}, 92px)`, gap: 4 }}>
                  {[...analytics.tierOrder].reverse().map((t: string) => {
                    const ti = analytics.tierOrder.indexOf(t);
                    return analytics.postureOrder.map((pos: string, ci: number) => {
                      const cell = analytics.grid?.[ti]?.[ci] ?? { count: 0, refs: [] };
                      // Worst corner: highest tier, weakest diligence.
                      const sev = ((ti + 1) / analytics.tierOrder.length)
                        * (1 - ci / (analytics.postureOrder.length - 1));
                      const st = cell.count === 0
                        ? { bg: 'var(--surface)', fg: 'var(--ink-faint)', line: 'var(--line-soft)' }
                        : sev >= 0.7 ? { bg: '#F7CFCB', fg: '#7F1D1A', line: '#E09A94' }
                          : sev >= 0.45 ? { bg: '#FBDFD5', fg: '#8A3312', line: '#E9B49C' }
                            : sev >= 0.2 ? { bg: '#FDF0D5', fg: '#6B4A08', line: '#E8CE94' }
                              : { bg: '#E3F3E9', fg: '#14532D', line: '#A8D5BA' };
                      return (
                        <div key={`${t}-${pos}`} title={cell.count ? `${t} · ${pos}\n${cell.refs.join(', ')}` : `${t} · ${pos}`}
                          style={{
                            height: 48, background: st.bg, border: `1px solid ${st.line}`,
                            borderRadius: 'var(--radius-sm)', display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            fontSize: cell.count ? 16 : 11, fontWeight: cell.count ? 750 : 400,
                            color: st.fg, fontVariantNumeric: 'tabular-nums',
                          }}>
                          {cell.count || '·'}
                        </div>
                      );
                    });
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${analytics.postureOrder.length}, 92px)`, gap: 4, marginTop: 6 }}>
                  {analytics.postureOrder.map((p: string) => (
                    <div key={p} style={{ textAlign: 'center', fontSize: 10, color: 'var(--ink-muted)', fontWeight: 600, lineHeight: 1.25 }}>
                      {p.replace(/([a-z])([A-Z])/g, '$1 $2')}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {(analytics.attention || []).length > 0 && (
            <>
              <h3 style={{ fontSize: 14, color: 'var(--ink)', margin: '0 0 10px' }}>Act on these first</h3>
              <div style={{ display: 'grid', gap: 10, marginBottom: 22 }}>
                {analytics.attention.map((v: any) => (
                  <div key={v.id} style={{ ...S.card, padding: 15, borderLeft: '4px solid var(--danger)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <div style={{ flex: '1 1 340px' }}>
                        <strong style={{ color: 'var(--brand)' }}>{v.ref}</strong>
                        <span style={{ color: 'var(--ink)', fontWeight: 600, marginLeft: 8 }}>{v.name}</span>
                        <span style={{ marginLeft: 8, ...(TIER[v.tier] || TIER.Medium) }}>{v.tier} {v.tierScore}</span>
                        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 5 }}>{v.detail}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'right' }}>
                        <div>can reach <strong style={{ color: 'var(--ink-body)' }}>{humanCategory(v.dataAccess)}</strong></div>
                        {v.assetCount > 0 && <div>{v.assetCount} asset(s) depend on them</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {(analytics.contractWatch || []).length > 0 && (
            <>
              <h3 style={{ fontSize: 14, color: 'var(--ink)', margin: '0 0 6px' }}>Contract watch</h3>
              <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 10px', maxWidth: '46rem', lineHeight: 1.55 }}>
                The decision date is the contract end minus the notice period — the last day notice can
                still be served. Past it, the contract rolls whether or not anyone intended it to.
              </p>
              <div style={{ ...S.card, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
                  <thead>
                    <tr style={S.headRow}>
                      {['Supplier', 'Tier', 'Contract ends', 'Notice', 'Decide by', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.contractWatch.map((c: any) => (
                      <tr key={c.ref} style={S.bodyRow}>
                        <td style={{ ...S.td, color: 'var(--ink)' }}><strong>{c.ref}</strong> — {c.name}</td>
                        <td style={S.td}><span style={TIER[c.tier] || TIER.Medium}>{c.tier}</span></td>
                        <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>{String(c.contractEnd).slice(0, 10)}</td>
                        <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>{c.noticePeriodDays ?? '—'}d</td>
                        <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', color: c.exitWindowPassed ? 'var(--danger)' : 'var(--ink-body)', fontWeight: c.exitWindowPassed ? 650 : 400 }}>
                          {c.exitDecisionDate ? String(c.exitDecisionDate).slice(0, 10) : '—'}
                        </td>
                        <td style={S.td}>
                          {c.exitWindowPassed && (
                            <span style={pill('var(--danger)', 'var(--danger-line)')}>window closed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Concentration ─────────────────────────────────────────────── */}
      {tab === 'concentration' && analytics && (
        <div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: '52rem', lineHeight: 1.6, marginTop: 0 }}>
            How much of the estate runs through each supplier. Weight sums the criticality of every
            asset they hold, because one supplier carrying three crown jewels is a different
            proposition from one carrying thirty minor systems — and a count alone cannot tell them apart.
          </p>
          {(analytics.concentration || []).length === 0 ? (
            <div style={{ ...S.card, padding: 26, color: 'var(--ink-muted)', fontSize: 13 }}>
              No assets are attributed to a supplier yet. Set the supplier on a third-party asset in the
              Asset Register and the concentration appears here.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {analytics.concentration.map((c: any) => {
                const max = analytics.concentration[0].weight || 1;
                return (
                  <div key={c.ref} style={{ ...S.card, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 10 }}>
                      <div>
                        <strong style={{ color: 'var(--brand)' }}>{c.ref}</strong>
                        <span style={{ color: 'var(--ink)', fontWeight: 600, marginLeft: 8 }}>{c.name}</span>
                        <span style={{ marginLeft: 8, ...(TIER[c.tier] || TIER.Medium) }}>{c.tier}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {c.assetCount} asset(s){c.criticalAssets > 0 && `, ${c.criticalAssets} critical`}
                        {c.valueAtRisk > 0 && ` · ${money(c.valueAtRisk)} at risk`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, height: 10, background: 'var(--line-soft)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{
                          width: `${(c.weight / max) * 100}%`, height: '100%',
                          background: c.tier === 'Critical' ? 'var(--danger)' : c.tier === 'High' ? 'var(--warning)' : 'var(--brand)',
                        }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'right' }}>
                        weight {c.weight}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 10 }}>
                      {(c.assets || []).map((a: any) => (
                        <span key={a.ref} style={pill('var(--ink-muted)', 'var(--line)')}>
                          {a.ref} · {a.name} ({a.criticality})
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Formulas ──────────────────────────────────────────────────── */}
      {tab === 'formulas' && (
        <div style={{ display: 'grid', gap: 12 }}>
          {(meta.formulas || []).map((f: any) => (
            <div key={f.key} style={{ ...S.card, padding: 17 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{f.name}</strong>
                <span style={pill('var(--info)', 'var(--info-line)')}>{f.basis}</span>
              </div>
              <div style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: 12.5, background: 'var(--surface-sunk)', border: '1px solid var(--line-soft)',
                borderRadius: 'var(--radius-sm)', padding: '9px 12px', margin: '10px 0 9px',
                color: 'var(--ink)', overflowX: 'auto',
              }}>
                {f.expression}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.55 }}>{f.why}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Onboard ───────────────────────────────────────────────────── */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 660, padding: 26, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>Onboard a supplier</h3>
              <button onClick={() => setShowNew(false)} style={linkBtn('var(--ink-muted)')} aria-label="Close">
                <Icon name="close" size={15} label="Close" />
              </button>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.55 }}>
              Three questions set the tier: what they can reach, how badly their failure hurts, and how
              quickly they could be replaced. Tier then sets the reassessment cadence.
            </p>
            {formErr && <div style={{ ...S.error, marginBottom: 14 }}><Icon name="warning" size={15} />{formErr}</div>}

            <form onSubmit={create}>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={label}>Trading name</label>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={S.input} />
                </div>
                <div>
                  <label style={label}>Legal entity name</label>
                  <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} style={S.input} />
                </div>
                <div>
                  <label style={label}>Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={S.input}>
                    {(meta.categories || []).map((c: string) => <option key={c} value={c}>{humanCategory(c)}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Country of operation</label>
                  <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} style={S.input} placeholder="Saudi Arabia" />
                </div>
                <div>
                  <label style={label}>
                    Where the data sits
                    {['PersonalData', 'SensitivePersonalData'].includes(form.dataAccess) && (
                      <span style={{ color: 'var(--danger)' }}> · required</span>
                    )}
                  </label>
                  <input
                    required={['PersonalData', 'SensitivePersonalData'].includes(form.dataAccess)}
                    value={form.dataLocation}
                    onChange={(e) => setForm({ ...form, dataLocation: e.target.value })}
                    style={S.input} placeholder="Riyadh region" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={label}>What can they reach?</label>
                  <select value={form.dataAccess} onChange={(e) => setForm({ ...form, dataAccess: e.target.value })} style={S.input}>
                    {(meta.dataAccessLevels || []).map((d: string) => <option key={d} value={d}>{humanCategory(d)}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 5, lineHeight: 1.45 }}>
                    {meta.dataAccessHelp?.[form.dataAccess]}
                  </div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-body)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.hasSystemAccess}
                      onChange={(e) => setForm({ ...form, hasSystemAccess: e.target.checked })} />
                    They hold direct access to our systems
                  </label>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
                    A supplier that can act on the estate cannot be a low-tier relationship, so this
                    applies a floor to the tier whatever else is true.
                  </div>
                </div>
                <div>
                  <label style={label}>Contract ends</label>
                  <input type="date" value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} style={S.input} />
                </div>
                <div>
                  <label style={label}>Notice period (days)</label>
                  <input type="number" min={0} value={form.noticePeriodDays}
                    onChange={(e) => setForm({ ...form, noticePeriodDays: e.target.value })} style={S.input} placeholder="90" />
                </div>
                <div>
                  <label style={label}>Annual spend (SAR)</label>
                  <input type="number" min={0} value={form.annualSpend}
                    onChange={(e) => setForm({ ...form, annualSpend: e.target.value })} style={S.input} />
                </div>
              </div>

              <div style={{ marginTop: 20, padding: 16, background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
                {([
                  ['serviceCriticality', 'How badly does it hurt if they stop?', '1 barely noticed · 5 the business stops'],
                  ['substitutability', 'How hard would they be to replace?', '1 many alternatives · 5 effectively locked in'],
                ] as const).map(([key, question, hint]) => (
                  <div key={key} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>{question}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginBottom: 6 }}>{hint}</div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" onClick={() => setForm({ ...form, [key]: n })}
                          style={{
                            width: 36, height: 32, borderRadius: 'var(--radius-sm)',
                            border: `1px solid ${Number(form[key]) === n ? 'var(--brand)' : 'var(--field-line)'}`,
                            background: Number(form[key]) === n ? 'var(--brand-tint)' : 'var(--surface)',
                            color: Number(form[key]) === n ? 'var(--brand-strong)' : 'var(--ink-muted)',
                            fontWeight: Number(form[key]) === n ? 700 : 500,
                            cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                          }}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={{ paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Resulting tier</span>
                  <span style={TIER[previewTier.tier]}>{previewTier.tier} {previewTier.score}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                    {previewTier.base} × {previewTier.sub}
                    {previewTier.floored && ' — floored to 12 for system access'}
                    {' '}· reassess every {previewTier.cadence} months
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Onboarding…' : 'Onboard supplier'}
                </button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Detail ────────────────────────────────────────────────────── */}
      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 720, padding: 26, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>{detail.ref} — {detail.name}</h3>
              <button onClick={() => setDetail(null)} style={linkBtn('var(--ink-muted)')} aria-label="Close">
                <Icon name="close" size={15} label="Close" />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
              <span style={TIER[detail.tier]}>{detail.tier} {detail.tierScore}</span>
              <span style={pill('var(--ink-muted)', 'var(--line)')}>{humanCategory(detail.category)}</span>
              {(() => { const p = POSTURE[detail.assessmentPosture] || POSTURE.NeverAssessed;
                return <span style={pill(p.fg, p.line)}>{detail.assessmentPosture.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>; })()}
              {detail.hasSystemAccess && <span style={pill('var(--warning)', 'var(--warning-line)')}>system access</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
              {([
                ['Legal name', detail.legalName || '—'],
                ['Country', detail.country || '—'],
                ['Data location', detail.dataLocation || '—'],
                ['Can reach', humanCategory(detail.dataAccess)],
                ['Relationship owner', detail.relationshipOwner?.name],
                ['Annual spend', detail.annualSpend ? money(detail.annualSpend, detail.currency) : '—'],
                ['Contract ref', detail.contractRef || '—'],
                ['Next assessment', detail.nextAssessmentDue ? String(detail.nextAssessmentDue).slice(0, 10) : '—'],
              ] as const).map(([k, v]) => (
                <div key={k}>
                  <div style={label}>{k}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>{v as any}</div>
                </div>
              ))}
            </div>

            {detail.subprocessors && (
              <div style={{ marginBottom: 16, padding: 12, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', borderRadius: 'var(--radius)' }}>
                <div style={{ ...label, color: 'var(--warning)' }}>Fourth parties</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-body)' }}>{detail.subprocessors}</div>
              </div>
            )}

            <h4 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', margin: '0 0 8px' }}>
              Assessment history ({(detail.assessments || []).length})
            </h4>
            {(detail.assessments || []).length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--danger)' }}>
                No due diligence has ever been completed on this supplier.
              </div>
            ) : (
              (detail.assessments || []).map((a: any) => (
                <div key={a.id} style={{ padding: '10px 12px', background: 'var(--surface-sunk)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                      <strong>{a.ref}</strong> · {a.kind}{a.questionnaire && ` · ${a.questionnaire}`}
                    </span>
                    <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                      {a.score != null && <span style={{ color: 'var(--ink-muted)' }}>{a.score}/100 · </span>}
                      <strong style={{
                        color: a.outcome === 'Adequate' ? 'var(--success)'
                          : a.outcome === 'Inadequate' ? 'var(--danger)' : 'var(--warning)',
                      }}>
                        {a.outcome || a.status}
                      </strong>
                    </span>
                  </div>
                  {a.narrative && (
                    <div style={{ fontSize: 12, color: 'var(--ink-body)', marginTop: 5, lineHeight: 1.5 }}>{a.narrative}</div>
                  )}
                  <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 5 }}>
                    requested by {a.requestedBy?.name}
                    {a.reviewedBy && ` · reviewed by ${a.reviewedBy.name} on ${String(a.reviewedAt).slice(0, 10)}`}
                  </div>
                </div>
              ))
            )}

            {(detail.assets || []).length > 0 && (
              <>
                <h4 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', margin: '18px 0 8px' }}>
                  Assets they hold ({detail.assets.length})
                </h4>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {detail.assets.map((a: any) => (
                    <span key={a.id} style={pill('var(--ink-muted)', 'var(--line)')}>
                      {a.ref} · {a.name} ({a.criticalityTier})
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorRegister;
