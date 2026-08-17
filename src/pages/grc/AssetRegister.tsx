import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';
import Icon from '../../components/Icon';
import type { IconName } from '../../components/Icon';
import AssetImport from './asset/AssetImport';

/**
 * The asset register — ISO/IEC 27001 A.5.9 inventory, valued the ISO 27005 way.
 *
 * The register exists so that "impact 4" has something underneath it. Every
 * number on this screen is derived from the CIA ratings an owner set, and the
 * arithmetic is shown rather than asserted: an assessor asking "how did you get
 * that?" should be answered by the product.
 */

const TIER: Record<string, React.CSSProperties> = {
  Critical: pill('#7F1D1A', '#E09A94'),
  High: pill('#8A3312', '#E9B49C'),
  Medium: pill('#6B4A08', '#E8CE94'),
  Low: pill('#14532D', '#A8D5BA'),
};

/** Posture is a judgement about defence, so it gets its own scale. */
const POSTURE: Record<string, { fg: string; line: string; help: string }> = {
  Protected: { fg: 'var(--success)', line: 'var(--success-line)', help: 'Every linked control is verified and effective.' },
  Partial: { fg: 'var(--warning)', line: 'var(--warning-line)', help: 'Some linked controls are only partially effective, or one has failed.' },
  Unproven: { fg: 'var(--info)', line: 'var(--info-line)', help: 'Controls are linked but none has been independently verified as effective.' },
  Failing: { fg: 'var(--danger)', line: 'var(--danger-line)', help: 'Every linked control has been assessed ineffective.' },
  Unprotected: { fg: 'var(--ink-muted)', line: 'var(--line)', help: 'No control is linked to this asset at all.' },
};

const TYPE_ICON: Record<string, IconName> = {
  Information: 'documents', Software: 'implementations', Physical: 'building',
  Service: 'network', Personnel: 'teams', Intangible: 'plans',
};

const OWNERSHIP_ICON: Record<string, IconName> = {
  Internal: 'building', ThirdParty: 'vendors', Shared: 'link',
};

const money = (n: number, ccy = 'SAR') =>
  n >= 1_000_000 ? `${ccy} ${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${ccy} ${(n / 1_000).toFixed(0)}k`
      : `${ccy} ${n}`;

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4,
  letterSpacing: '0.03em', fontWeight: 600,
};

type Tab = 'register' | 'import' | 'posture' | 'formulas';

const AssetRegister: React.FC = () => {
  const [tab, setTab] = useState<Tab>('register');
  const [assets, setAssets] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>({});
  const [totals, setTotals] = useState<any>({});
  const [analytics, setAnalytics] = useState<any>(null);
  const [impls, setImpls] = useState<any[]>([]);
  const [entities, setEntities] = useState<any[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [ownershipFilter, setOwnershipFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');

  const [detail, setDetail] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [form, setForm] = useState<any>({
    name: '', description: '', type: 'Information', ownership: 'Internal',
    classification: 'Internal', confidentiality: 3, integrity: 3, availability: 3,
    location: '', vendorName: '', contractRef: '', replacementValue: '',
    auditableEntityId: '', reviewCadenceMonths: 12,
  });

  const [riskForm, setRiskForm] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [a, an, i, u] = await Promise.all([
        apiClient.get('/api/grc/assets'),
        apiClient.get('/api/grc/asset-analytics').catch(() => null),
        apiClient.get('/api/grc/implementations').catch(() => null),
        apiClient.get('/api/grc/universe').catch(() => null),
      ]);
      setAssets(a.data?.assets || []);
      setTotals(a.data?.totals || {});
      setMeta({
        types: a.data?.types || [], typeHelp: a.data?.typeHelp || {},
        ownerships: a.data?.ownerships || [], classifications: a.data?.classifications || [],
        formulas: a.data?.formulas || [],
      });
      setScope(a.data?.scope || '');
      setAnalytics(an?.data || null);
      setImpls(i?.data?.implementations || []);
      setEntities(u?.data?.entities || []);
    } catch (err) { setError(apiError(err, 'Failed to load the asset register')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Criticality is derived here exactly as the server derives it, so the form
   *  can show the consequence of a rating before it is saved. */
  const previewCriticality = useMemo(() => {
    const c = Number(form.confidentiality), i = Number(form.integrity), a = Number(form.availability);
    const crit = Math.max(c, i, a);
    const tier = crit >= 5 ? 'Critical' : crit >= 4 ? 'High' : crit >= 3 ? 'Medium' : 'Low';
    const top: string[] = [];
    if (c === crit) top.push('confidentiality');
    if (i === crit) top.push('integrity');
    if (a === crit) top.push('availability');
    return { crit, tier, driver: top.join(' and ') };
  }, [form.confidentiality, form.integrity, form.availability]);

  const visible = useMemo(() => {
    const q = search.toLowerCase();
    return assets.filter((a) => {
      if (typeFilter && a.type !== typeFilter) return false;
      if (ownershipFilter && a.ownership !== ownershipFilter) return false;
      if (tierFilter && a.criticalityTier !== tierFilter) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.ref.toLowerCase().includes(q)
        && !(a.vendorName || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assets, search, typeFilter, ownershipFilter, tierFilter]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      const res = await apiClient.post('/api/grc/assets', {
        ...form,
        replacementValue: form.replacementValue ? Number(form.replacementValue) : undefined,
        auditableEntityId: form.auditableEntityId || undefined,
      });
      setShowNew(false);
      setForm({
        name: '', description: '', type: 'Information', ownership: 'Internal',
        classification: 'Internal', confidentiality: 3, integrity: 3, availability: 3,
        location: '', vendorName: '', contractRef: '', replacementValue: '',
        auditableEntityId: '', reviewCadenceMonths: 12,
      });
      setNotice(res.data?.message || 'Asset registered');
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not register the asset')); }
    finally { setBusy(false); }
  };

  const raiseRisk = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiClient.post(`/api/grc/assets/${riskForm.assetId}/risks`, riskForm);
      setRiskForm(null);
      setNotice(res.data?.message || 'Risk raised');
      await load();
    } catch (err) { window.alert(apiError(err)); }
    finally { setBusy(false); }
  };

  const linkControls = async (asset: any) => {
    const current = new Set((asset.controlLinks || []).map((l: any) => l.implementationId));
    const choice = window.prompt(
      `Which controls protect ${asset.ref}? Comma-separated numbers.\n\n`
      + impls.slice(0, 25).map((im, n) =>
        `${n + 1}. ${current.has(im.id) ? '[linked] ' : ''}${im.control?.code} — ${im.control?.title}`).join('\n'),
      impls.map((im, n) => (current.has(im.id) ? String(n + 1) : '')).filter(Boolean).join(','),
    );
    if (choice === null) return;
    const ids = choice.split(',').map((x) => impls[Number(x.trim()) - 1]?.id).filter(Boolean);
    try {
      const res = await apiClient.post(`/api/grc/assets/${asset.id}/controls`, { implementationIds: ids });
      setNotice(res.data?.message || 'Controls linked');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const review = async (asset: any) => {
    const note = window.prompt(`Confirm ${asset.ref} has been reviewed. Note (optional):`);
    if (note === null) return;
    try {
      const res = await apiClient.post(`/api/grc/assets/${asset.id}/review`, { note });
      setNotice(res.data?.message || 'Reviewed');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--brand)' : 'var(--ink-muted)',
    border: `1px solid ${active ? 'var(--line)' : 'transparent'}`,
    borderBottom: active ? '2px solid var(--brand)' : 'none',
    padding: '10px 18px',
    borderRadius: '6px 6px 0 0',
    fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', gap: 7,
  });

  if (loading) return <div style={{ ...S.page, color: 'var(--ink-muted)' }}>Loading the asset register…</div>;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Asset register</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)', maxWidth: '46rem', lineHeight: 1.55 }}>
            Everything the organisation depends on — physical and non-physical, held internally or by a
            supplier. Criticality is derived from the CIA ratings, and risk impact is derived from
            criticality, so an impact score can always be traced back to an asset somebody valued.
            Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={load} style={{ ...ghostBtn, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
          <button onClick={() => { setFormErr(''); setShowNew(true); }} style={{ ...primaryBtn(), display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="plus" size={15} /> Register asset
          </button>
        </div>
      </div>

      <StatStrip items={[
        ['Assets', totals.total ?? 0],
        ['Critical', <span style={{ color: (totals.critical ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.critical ?? 0}</span>],
        ['Third-party held', totals.thirdParty ?? 0],
        ['Exposed, unprotected', <span style={{ color: (totals.unprotectedButExposed ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.unprotectedButExposed ?? 0}</span>],
        ['Register value', money(totals.totalValue ?? 0)],
        ['Annualised loss', <span style={{ color: 'var(--warning)' }}>{money(totals.annualisedLoss ?? 0)}</span>],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          <Icon name="success" size={15} />
          <span style={{ flex: 1 }}>{notice}</span>
          <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 18, overflowX: 'auto' }}>
        <button style={tabStyle(tab === 'register')} onClick={() => setTab('register')}>
          <Icon name="assets" size={16} /> Inventory
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{assets.length}</span>
        </button>
        <button style={tabStyle(tab === 'import')} onClick={() => setTab('import')}>
          <Icon name="upload" size={16} /> Bulk import
        </button>
        <button style={tabStyle(tab === 'posture')} onClick={() => setTab('posture')}>
          <Icon name="matrix" size={16} /> Criticality vs protection
        </button>
        <button style={tabStyle(tab === 'formulas')} onClick={() => setTab('formulas')}>
          <Icon name="gauge" size={16} /> How the numbers are derived
        </button>
      </div>

      {/* ── Inventory ─────────────────────────────────────────────────── */}
      {tab === 'register' && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input placeholder="Search name, ref or supplier…" value={search}
              onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 260 }} />
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ ...S.input, maxWidth: 170 }}>
              <option value="">All types</option>
              {(meta.types || []).map((t: string) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={ownershipFilter} onChange={(e) => setOwnershipFilter(e.target.value)} style={{ ...S.input, maxWidth: 170 }}>
              <option value="">Internal and third-party</option>
              {(meta.ownerships || []).map((o: string) => <option key={o} value={o}>{o === 'ThirdParty' ? 'Third party' : o}</option>)}
            </select>
            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={{ ...S.input, maxWidth: 150 }}>
              <option value="">All criticality</option>
              {['Critical', 'High', 'Medium', 'Low'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div style={{ ...S.card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
              <thead>
                <tr style={S.headRow}>
                  {['Asset', 'Type', 'Held by', 'C / I / A', 'Criticality', 'Protection', 'Risk carried', 'Actions']
                    .map((h) => <th key={h} style={S.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => {
                  const p = POSTURE[a.controlPosture.posture] || POSTURE.Unprotected;
                  return (
                    <tr key={a.id} style={S.bodyRow}>
                      <td style={S.td}>
                        <button onClick={() => setDetail(a)}
                          style={{ ...linkBtn('var(--ink-body)'), fontSize: 13, padding: 0, textAlign: 'left' }}>
                          <strong>{a.ref}</strong> — {a.name}
                        </button>
                        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span>{a.classification}</span>
                          {a.location && <span>· {a.location}</span>}
                          {a.vendorName && <span>· {a.vendorName}</span>}
                          {a.reviewOverdue && <span style={{ color: 'var(--warning)', fontWeight: 600 }}>· review overdue</span>}
                        </div>
                      </td>
                      <td style={S.td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink-body)' }}>
                          <Icon name={TYPE_ICON[a.type] || 'assets'} size={14} />
                          {a.type}
                        </span>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
                          {a.tangibility === 'Physical' ? 'physical' : 'non-physical'}
                        </div>
                      </td>
                      <td style={S.td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink-body)' }}>
                          <Icon name={OWNERSHIP_ICON[a.ownership] || 'building'} size={14} />
                          {a.ownership === 'ThirdParty' ? 'Third party' : a.ownership}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>
                        {a.confidentiality} / {a.integrity} / {a.availability}
                        <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{a.drivingDimension}</div>
                      </td>
                      <td style={S.td}>
                        <span style={TIER[a.criticalityTier] || TIER.Medium}>
                          {a.criticalityTier} {a.criticality}
                        </span>
                      </td>
                      <td style={S.td}>
                        <span style={pill(p.fg, p.line)} title={p.help}>{a.controlPosture.posture}</span>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', marginTop: 2 }}>
                          {a.controlPosture.total === 0 ? 'no controls' : `${a.controlPosture.effective}/${a.controlPosture.total} effective`}
                        </div>
                      </td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>
                        {a.openRiskCount > 0 ? (
                          <>
                            <span style={{ fontWeight: 650, color: 'var(--ink)' }}>{a.openRiskCount}</span>
                            <span style={{ color: 'var(--ink-faint)' }}> open · max {a.maxResidual}</span>
                            <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>exposure {a.exposure}</div>
                          </>
                        ) : (
                          <span style={{ color: 'var(--ink-faint)' }}>none assessed</span>
                        )}
                        {a.lossExpectancy && (
                          <div style={{ fontSize: 10.5, color: 'var(--warning)' }}>
                            ALE {money(a.lossExpectancy.ale, a.currency)}
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        <button style={linkBtn('var(--danger)')}
                          onClick={() => setRiskForm({
                            assetId: a.id, assetRef: a.ref, assetName: a.name,
                            criticality: a.criticality, tier: a.criticalityTier,
                            threat: '', vulnerability: '', threatLevel: 3, vulnerabilityLevel: 3,
                            exposureFactor: '', title: '',
                          })}>
                          raise risk
                        </button>
                        <button style={linkBtn('var(--info)')} onClick={() => linkControls(a)}>controls</button>
                        <button style={linkBtn('var(--ink-muted)')} onClick={() => review(a)}>review</button>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 34, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    No assets match this filter.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Bulk import ───────────────────────────────────────────────── */}
      {tab === 'import' && <AssetImport onCommitted={load} />}

      {/* ── Criticality vs protection ─────────────────────────────────── */}
      {tab === 'posture' && analytics && (
        <div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: '52rem', lineHeight: 1.6, marginTop: 0 }}>
            Criticality against how well each asset is actually defended. The top-left corner is the
            register's worst quarter: assets whose loss would hurt most, with nothing verified
            protecting them.
          </p>
          <div style={{ ...S.card, padding: 20, overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: 8, minWidth: 620 }}>
              <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 4 }}>
                {[1, 2, 3, 4, 5].map((c) => (
                  <div key={c} style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 74 }}>
                    <span style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>
                      {c >= 5 ? 'Critical' : c >= 4 ? 'High' : c >= 3 ? 'Medium' : 'Low'}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-faint)', fontVariantNumeric: 'tabular-nums' }}>{c}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${analytics.postureOrder.length}, 104px)`, gap: 4 }}>
                  {[5, 4, 3, 2, 1].map((crit) =>
                    analytics.postureOrder.map((pos: string, ci: number) => {
                      const cell = analytics.grid?.[crit - 1]?.[ci] ?? { count: 0, refs: [] };
                      // The worst corner is high criticality with weak defence.
                      const severity = (crit / 5) * (1 - ci / (analytics.postureOrder.length - 1));
                      const style = cell.count === 0
                        ? { bg: 'var(--surface)', fg: 'var(--ink-faint)', line: 'var(--line-soft)' }
                        : severity >= 0.7 ? { bg: '#F7CFCB', fg: '#7F1D1A', line: '#E09A94' }
                          : severity >= 0.45 ? { bg: '#FBDFD5', fg: '#8A3312', line: '#E9B49C' }
                            : severity >= 0.25 ? { bg: '#FDF0D5', fg: '#6B4A08', line: '#E8CE94' }
                              : { bg: '#E3F3E9', fg: '#14532D', line: '#A8D5BA' };
                      return (
                        <div key={`${crit}-${pos}`}
                          title={cell.count ? `${pos}, criticality ${crit}\n${cell.refs.join(', ')}` : `${pos}, criticality ${crit}`}
                          style={{
                            height: 52, background: style.bg, border: `1px solid ${style.line}`,
                            borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                          }}>
                          <span style={{ fontSize: cell.count ? 17 : 11, fontWeight: cell.count ? 750 : 400, color: style.fg, fontVariantNumeric: 'tabular-nums' }}>
                            {cell.count || '·'}
                          </span>
                        </div>
                      );
                    }),
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${analytics.postureOrder.length}, 104px)`, gap: 4, marginTop: 6 }}>
                  {analytics.postureOrder.map((p: string) => (
                    <div key={p} style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--ink-muted)', fontWeight: 600 }}>{p}</div>
                  ))}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', textAlign: 'center', marginTop: 6, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Control protection →
                </div>
              </div>
            </div>
          </div>

          {(analytics.attention || []).length > 0 && (
            <>
              <h3 style={{ fontSize: 14, color: 'var(--ink)', margin: '24px 0 10px' }}>
                Act on these first
              </h3>
              <div style={{ display: 'grid', gap: 10 }}>
                {analytics.attention.map((a: any) => (
                  <div key={a.id} style={{ ...S.card, padding: 15, borderLeft: '4px solid var(--danger)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <div style={{ flex: '1 1 320px' }}>
                        <strong style={{ color: 'var(--brand)' }}>{a.ref}</strong>
                        <span style={{ color: 'var(--ink)', fontWeight: 600, marginLeft: 8 }}>{a.name}</span>
                        <span style={{ marginLeft: 8, ...(TIER[a.criticalityTier] || TIER.Medium) }}>{a.criticalityTier}</span>
                        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 5 }}>
                          {a.posture === 'Unprotected'
                            ? `Carries ${a.openRiskCount} open risk(s) with no control linked at all.`
                            : `Every control linked to this asset has been assessed ineffective.`}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ fontSize: 10.5, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Exposure</div>
                        <div style={{ fontSize: 18, fontWeight: 750, color: 'var(--danger)' }}>{a.exposure}</div>
                        {a.lossExpectancy && (
                          <div style={{ fontSize: 11, color: 'var(--warning)' }}>ALE {money(a.lossExpectancy.ale)}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Formulas ──────────────────────────────────────────────────── */}
      {tab === 'formulas' && (
        <div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: '52rem', lineHeight: 1.6, marginTop: 0 }}>
            Every number this platform derives, with the arithmetic and the standard it comes from.
            An assessor asking how a score was reached should be answered by the product.
          </p>
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
        </div>
      )}

      {/* ── Register asset ────────────────────────────────────────────── */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 640, padding: 26, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>Register an asset</h3>
              <button onClick={() => setShowNew(false)} style={linkBtn('var(--ink-muted)')} aria-label="Close">
                <Icon name="close" size={15} label="Close" />
              </button>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.55 }}>
              Rate what the loss of each dimension would cost. Criticality is the highest of the three —
              an asset is as critical as its most demanding dimension.
            </p>
            {formErr && <div style={{ ...S.error, marginBottom: 14 }}><Icon name="warning" size={15} />{formErr}</div>}

            <form onSubmit={create}>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={label}>Name</label>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={S.input} />
                </div>
                <div>
                  <label style={label}>Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={S.input}>
                    {(meta.types || []).map((t: string) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 5, lineHeight: 1.45 }}>
                    {meta.typeHelp?.[form.type]}
                  </div>
                </div>
                <div>
                  <label style={label}>Held by</label>
                  <select value={form.ownership} onChange={(e) => setForm({ ...form, ownership: e.target.value })} style={S.input}>
                    {(meta.ownerships || []).map((o: string) => (
                      <option key={o} value={o}>{o === 'ThirdParty' ? 'A third party' : o === 'Shared' ? 'Shared with a supplier' : 'The organisation'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={label}>Classification</label>
                  <select value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} style={S.input}>
                    {(meta.classifications || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {form.ownership !== 'Internal' && (
                  <>
                    <div>
                      <label style={label}>Supplier <span style={{ color: 'var(--danger)' }}>· required</span></label>
                      <input required value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} style={S.input} />
                    </div>
                    <div>
                      <label style={label}>Contract reference</label>
                      <input value={form.contractRef} onChange={(e) => setForm({ ...form, contractRef: e.target.value })} style={S.input} />
                    </div>
                  </>
                )}

                <div>
                  <label style={label}>Location</label>
                  <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} style={S.input} placeholder="Riyadh DC-1" />
                </div>
                <div>
                  <label style={label}>Replacement value (SAR)</label>
                  <input type="number" min={0} value={form.replacementValue}
                    onChange={(e) => setForm({ ...form, replacementValue: e.target.value })} style={S.input} placeholder="optional" />
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 5 }}>
                    Enables loss expectancy. Left blank, the register stays qualitative.
                  </div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={label}>Audit universe entity</label>
                  <select value={form.auditableEntityId} onChange={(e) => setForm({ ...form, auditableEntityId: e.target.value })} style={S.input}>
                    <option value="">— not placed in the universe —</option>
                    {entities.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 5 }}>
                    Placing it here means an engagement covering that entity picks up this asset's risks.
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 20, padding: 16, background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--ink)', marginBottom: 12 }}>
                  What would loss of each dimension cost?
                </div>
                {([
                  ['confidentiality', 'Confidentiality', 'Unauthorised disclosure'],
                  ['integrity', 'Integrity', 'Unauthorised change or loss of accuracy'],
                  ['availability', 'Availability', 'Loss of access'],
                ] as const).map(([key, name, hint]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <div style={{ minWidth: 130 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>{name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>{hint}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" onClick={() => setForm({ ...form, [key]: n })}
                          style={{
                            width: 34, height: 32, borderRadius: 'var(--radius-sm)',
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
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Resulting criticality</span>
                  <span style={TIER[previewCriticality.tier]}>{previewCriticality.tier} {previewCriticality.crit}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                    max({form.confidentiality}, {form.integrity}, {form.availability}) — driven by {previewCriticality.driver}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Registering…' : 'Register asset'}
                </button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Raise a risk from an asset ────────────────────────────────── */}
      {riskForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 910, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 580, padding: 26, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>Raise a risk against {riskForm.assetRef}</h3>
              <button onClick={() => setRiskForm(null)} style={linkBtn('var(--ink-muted)')} aria-label="Close">
                <Icon name="close" size={15} label="Close" />
              </button>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              ISO 27005 states risk as a <strong>threat</strong> exploiting a <strong>vulnerability</strong> of
              an asset. Name both, and the platform derives the scores from {riskForm.assetName}'s own
              valuation rather than asking you to guess an impact.
            </p>

            <form onSubmit={raiseRisk}>
              <label style={label}>Threat — what could act against this asset?</label>
              <input required value={riskForm.threat} onChange={(e) => setRiskForm({ ...riskForm, threat: e.target.value })}
                style={{ ...S.input, marginBottom: 12 }} placeholder="Ransomware encrypts production systems" />

              <label style={label}>Vulnerability — what weakness would it exploit?</label>
              <input required value={riskForm.vulnerability} onChange={(e) => setRiskForm({ ...riskForm, vulnerability: e.target.value })}
                style={{ ...S.input, marginBottom: 14 }} placeholder="Backup restoration not tested within the agreed window" />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={label}>Threat level (1–5)</label>
                  <select value={riskForm.threatLevel} onChange={(e) => setRiskForm({ ...riskForm, threatLevel: Number(e.target.value) })} style={S.input}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Vulnerability level (1–5)</label>
                  <select value={riskForm.vulnerabilityLevel} onChange={(e) => setRiskForm({ ...riskForm, vulnerabilityLevel: Number(e.target.value) })} style={S.input}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 16, padding: 14, background: 'var(--brand-tint)', border: '1px solid var(--brand-line)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-strong)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 8 }}>
                  Derived score
                </div>
                {(() => {
                  const impact = riskForm.criticality;
                  const likelihood = Math.min(5, Math.max(1, Math.ceil((riskForm.threatLevel + riskForm.vulnerabilityLevel) / 2)));
                  return (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.7 }}>
                      <div>Impact <strong>{impact}</strong> — the asset's criticality ({riskForm.tier}).</div>
                      <div>
                        Likelihood <strong>{likelihood}</strong> — ceil(({riskForm.threatLevel} + {riskForm.vulnerabilityLevel}) / 2),
                        rounded up so a serious threat is not averaged away.
                      </div>
                      <div style={{ marginTop: 5, fontWeight: 650, color: 'var(--ink)' }}>
                        Inherent score {likelihood * impact}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <label style={{ ...label, marginTop: 14 }}>Exposure factor (0–1, optional)</label>
              <input type="number" step="0.05" min={0} max={1} value={riskForm.exposureFactor}
                onChange={(e) => setRiskForm({ ...riskForm, exposureFactor: e.target.value })}
                style={S.input} placeholder="0.4 — the share of the asset's value lost if this happens" />
              <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 5 }}>
                Supplied together with a replacement value, this yields Single and Annualised Loss Expectancy.
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Raising…' : 'Raise risk'}
                </button>
                <button type="button" onClick={() => setRiskForm(null)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
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
              <span style={TIER[detail.criticalityTier]}>{detail.criticalityTier} {detail.criticality}</span>
              <span style={pill('var(--ink-muted)', 'var(--line)')}>{detail.type}</span>
              <span style={pill('var(--ink-muted)', 'var(--line)')}>{detail.tangibility === 'Physical' ? 'Physical' : 'Non-physical'}</span>
              <span style={pill('var(--ink-muted)', 'var(--line)')}>{detail.classification}</span>
              {(() => { const p = POSTURE[detail.controlPosture.posture] || POSTURE.Unprotected;
                return <span style={pill(p.fg, p.line)}>{detail.controlPosture.posture}</span>; })()}
            </div>

            {detail.description && (
              <p style={{ fontSize: 13, color: 'var(--ink-body)', lineHeight: 1.6, marginTop: 0 }}>{detail.description}</p>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, margin: '16px 0' }}>
              {([
                ['Owner', detail.owner?.name],
                ['Custodian', detail.custodian?.name || '—'],
                ['Held by', detail.ownership === 'ThirdParty' ? `Third party — ${detail.vendorName}` : detail.ownership],
                ['Location', detail.location || '—'],
                ['Replacement value', detail.replacementValue ? money(detail.replacementValue, detail.currency) : '—'],
                ['Next review', detail.nextReviewDate ? String(detail.nextReviewDate).slice(0, 10) : '—'],
              ] as const).map(([k, v]) => (
                <div key={k}>
                  <div style={label}>{k}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink)' }}>{v as any}</div>
                </div>
              ))}
            </div>

            <h4 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', margin: '18px 0 8px' }}>
              Risks carried ({(detail.riskLinks || []).length})
            </h4>
            {(detail.riskLinks || []).length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>
                No risk assessed against this asset yet.
              </div>
            ) : (
              (detail.riskLinks || []).map((l: any) => (
                <div key={l.id} style={{ padding: '10px 12px', background: 'var(--surface-sunk)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                      <strong>{l.risk?.ref}</strong> — {l.risk?.title}
                    </span>
                    <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-muted)' }}>
                      inherent {l.risk?.inherentScore} → residual <strong style={{ color: 'var(--ink)' }}>{l.risk?.residualScore}</strong>
                    </span>
                  </div>
                  {l.threat && (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 5, lineHeight: 1.5 }}>
                      <strong>Threat:</strong> {l.threat}<br />
                      <strong>Vulnerability:</strong> {l.vulnerability}
                      {l.exposureFactor != null && <> · exposure factor {l.exposureFactor}</>}
                    </div>
                  )}
                </div>
              ))
            )}

            <h4 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', margin: '18px 0 8px' }}>
              Controls protecting it ({(detail.controlLinks || []).length})
            </h4>
            {(detail.controlLinks || []).length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--warning)' }}>
                Nothing is linked. If this asset carries risk, that gap is the finding.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(detail.controlLinks || []).map((l: any) => {
                  const verified = l.implementation?.status === 'Verified';
                  const eff = l.implementation?.effectiveness;
                  const fg = !verified ? 'var(--ink-muted)'
                    : eff === 'Effective' ? 'var(--success)'
                      : eff === 'Ineffective' ? 'var(--danger)' : 'var(--warning)';
                  const line = !verified ? 'var(--line)'
                    : eff === 'Effective' ? 'var(--success-line)'
                      : eff === 'Ineffective' ? 'var(--danger-line)' : 'var(--warning-line)';
                  return (
                    <span key={l.id} style={pill(fg, line)}
                      title={`${l.implementation?.control?.title} — ${l.implementation?.status}/${eff || 'not assessed'}`}>
                      {l.implementation?.control?.code}
                    </span>
                  );
                })}
              </div>
            )}

            {detail.lossExpectancy && (
              <div style={{ marginTop: 18, padding: 14, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', borderRadius: 'var(--radius)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Loss expectancy — worst linked risk
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.65 }}>
                  SLE {money(detail.lossExpectancy.sle, detail.currency)} = {money(detail.replacementValue, detail.currency)} × exposure factor.<br />
                  ALE <strong>{money(detail.lossExpectancy.ale, detail.currency)}</strong> = SLE × {detail.lossExpectancy.aro} occurrences per year,
                  from {detail.lossExpectancy.riskRef}.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetRegister;
