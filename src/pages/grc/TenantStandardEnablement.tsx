import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import PickManyDialog from '../../components/PickManyDialog';
import { ConfirmDialog } from '../../components/Dialog';
import Can, { MAY, can } from '../../components/Can';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';

/**
 * Which entities are assessed against which frameworks, and changing it.
 *
 * The nav key 'tenant-standards' — "Tenant Standard Enablement" in the control
 * plane — rendered the ordinary per-entity Standards Library, which enables for
 * whoever is signed in and nobody else. So the screen whose whole name is about
 * other tenants could not name one, and a platform operator enabling ISO 27001
 * for a customer was in fact enabling it for the platform's own tenant.
 *
 * This screen is standard-first because that is the shape of the question being
 * asked: an operator has a framework in mind and wants to know, and change, who
 * is assessed against it.
 *
 * It never invents a row. Every count comes from the response; when the request
 * fails there is an error and an empty list, and the actions turn off rather
 * than acting against a tenant list the screen cannot vouch for.
 */

interface Tenant { id: string; name: string; type: string }
interface Standard { id: string; code: string; title: string; version: string; tenantId: string | null }
interface Enablement { tenantId: string; standardId: string; applicability: string; enabledAt: string }

interface Outcome { tenantId: string; tenantName: string; standardCode: string; message?: string }
interface BatchResult {
  action: 'enabled' | 'disabled';
  applied: Outcome[];
  skipped: Outcome[];
  failed: Outcome[];
}

const APPLICABILITY = ['Full', 'Partial', 'Not applicable'];

const TenantStandardEnablement: React.FC = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [enablements, setEnablements] = useState<Enablement[]>([]);
  const [scope, setScope] = useState('');

  const [loading, setLoading] = useState(true);
  /** True only after a response actually arrived. Gates every action. */
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [applicability, setApplicability] = useState('Full');
  const [picking, setPicking] = useState<'enable' | 'disable' | null>(null);
  const [confirming, setConfirming] = useState<{ tenant: Tenant; standard: Standard } | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/grc/standards/enablement-matrix');
      // Defensive on every field: strictNullChecks is off in this project, so a
      // missing array typechecks cleanly and throws on first use.
      setTenants(res.data?.tenants || []);
      setStandards(res.data?.standards || []);
      setEnablements(res.data?.enablements || []);
      setScope(res.data?.scope || '');
      setLoaded(true);
    } catch (err) {
      setError(apiError(err, 'Could not load the enablement matrix.'));
      setTenants([]);
      setStandards([]);
      setEnablements([]);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep a selection only while it still exists.
  useEffect(() => {
    if (selected && !standards.some((s) => s.id === selected)) setSelected(null);
    if (!selected && standards.length > 0) setSelected(standards[0].id);
  }, [standards, selected]);

  const enabledTenantIds = useMemo(() => {
    const by = new Map<string, Set<string>>();
    for (const e of enablements) {
      if (!by.has(e.standardId)) by.set(e.standardId, new Set());
      by.get(e.standardId)!.add(e.tenantId);
    }
    return by;
  }, [enablements]);

  // How much each entity carries overall, not just for the selected framework.
  //
  // The screen is framework-first, which answers "who has ISO 27001" well and
  // "what does Contoso have" not at all. A full pivot is a second layout; this
  // column answers the reverse question at a glance for the cost of one derived
  // map, and names the frameworks rather than only counting them.
  const perTenant = useMemo(() => {
    const by = new Map<string, string[]>();
    const codeOf = new Map(standards.map((s) => [s.id, s.code]));
    for (const e of enablements) {
      if (!by.has(e.tenantId)) by.set(e.tenantId, []);
      by.get(e.tenantId)!.push(codeOf.get(e.standardId) || '—');
    }
    for (const codes of by.values()) codes.sort();
    return by;
  }, [enablements, standards]);

  const standard = standards.find((s) => s.id === selected) || null;
  const enabledHere = (standard && enabledTenantIds.get(standard.id)) || new Set<string>();

  const shownTenants = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.type || '').toLowerCase().includes(q),
    );
  }, [tenants, search]);

  const runBatch = async (
    action: 'enable' | 'disable',
    tenantIds: string[],
  ) => {
    if (!standard || tenantIds.length === 0) return;
    setBusy(true);
    setError('');
    setNotice('');
    setResult(null);
    try {
      const res = await apiClient.post(`/api/grc/standards/bulk-${action}`, {
        standardIds: [standard.id],
        tenantIds,
        ...(action === 'enable' ? { applicability } : {}),
      });
      const d = res.data || {};
      setResult({
        action: action === 'enable' ? 'enabled' : 'disabled',
        applied: (action === 'enable' ? d.enabled : d.disabled) || [],
        skipped: (action === 'enable' ? d.alreadyEnabled : d.notEnabled) || [],
        failed: d.failed || [],
      });
      await load();
    } catch (err) {
      // The server refuses the whole request rather than applying part of it,
      // so there is nothing partial to report here — its message is the answer.
      setError(apiError(err, `Could not ${action} the standard.`));
    } finally {
      setBusy(false);
      setPicking(null);
      setConfirming(null);
    }
  };

  const mayAct = can(MAY.AUTHOR_STANDARD) && loaded;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Standard enablement</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Which entities are assessed against which frameworks. Enabling records that an entity is
            assessed against a framework; it does not yet change which clauses or controls that
            entity can see. Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
            {loaded && <> · {tenants.length} entit{tenants.length === 1 ? 'y' : 'ies'}</>}
          </p>
        </div>
        <button onClick={load} style={ghostBtn} disabled={busy}>↻ Refresh</button>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading the enablement matrix…</div>
      ) : !loaded ? (
        // No fallback list. The enablement rows name only entities that already
        // have the standard, so building a tenant list out of them would offer
        // exactly the entities that need no action and hide every one that does.
        <div style={{ ...S.card, padding: 24, color: 'var(--ink-muted)', fontSize: 13 }}>
          The entity list could not be loaded, so nothing can be enabled or disabled from here
          safely. Refresh once the API is reachable.
        </div>
      ) : standards.length === 0 ? (
        <div style={{ ...S.card, padding: 24, color: 'var(--ink-muted)', fontSize: 13 }}>
          No frameworks are available yet. Publish one from the Standard Repository, or author one
          in Framework Authoring, and it will appear here.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 300px) 1fr', gap: 14, alignItems: 'start' }}>
          {/* Frameworks */}
          <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', borderBottom: '1px solid var(--line)' }}>
              FRAMEWORKS
            </div>
            {standards.map((s) => {
              const on = (enabledTenantIds.get(s.id) || new Set()).size;
              const active = s.id === selected;
              return (
                <button
                  key={s.id}
                  onClick={() => { setSelected(s.id); setResult(null); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                    background: active ? 'var(--surface-sunk)' : 'transparent',
                    border: 'none', borderLeft: `3px solid ${active ? 'var(--brand)' : 'transparent'}`,
                    borderBottom: '1px solid var(--line-soft)', cursor: 'pointer',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{s.code}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
                    {on} of {tenants.length} entities
                    {s.tenantId === null
                      ? <span style={{ marginLeft: 6, color: 'var(--ink-faint)' }}>· published</span>
                      : <span style={{ marginLeft: 6, color: 'var(--ink-faint)' }}>· authored here</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* The selected framework across the estate */}
          <div>
            {standard && (
              <>
                <div style={{ ...S.card, padding: 16, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ fontSize: 15, color: 'var(--ink)' }}>{standard.code}</strong>
                      <div style={{ fontSize: 12, color: 'var(--ink-body)', marginTop: 2 }}>{standard.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>v{standard.version}</div>
                    </div>
                    <Can do={MAY.AUTHOR_STANDARD}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                          Applicability{' '}
                          <select
                            value={applicability}
                            onChange={(e) => setApplicability(e.target.value)}
                            style={{ ...S.input, padding: '5px 8px', fontSize: 12 }}
                          >
                            {APPLICABILITY.map((a) => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </label>
                        <button
                          onClick={() => { setResult(null); setPicking('enable'); }}
                          disabled={!mayAct || busy}
                          style={primaryBtn(!mayAct || busy)}
                        >
                          Enable for entities…
                        </button>
                        <button
                          onClick={() => { setResult(null); setPicking('disable'); }}
                          disabled={!mayAct || busy}
                          style={ghostBtn}
                        >
                          Disable for entities…
                        </button>
                      </div>
                    </Can>
                  </div>
                </div>

                <StatStrip items={[
                  ['Entities in scope', tenants.length],
                  ['Enabled', <span style={{ color: enabledHere.size > 0 ? 'var(--success)' : 'var(--ink-muted)' }}>{enabledHere.size}</span>],
                  ['Not enabled', tenants.length - enabledHere.size],
                  ['Applicability applied on enable', applicability],
                ]} />

                {result && (
                  <div style={{ ...S.card, padding: 14, marginBottom: 12 }}>
                    <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600, marginBottom: 6 }}>
                      {result.applied.length} {result.action}
                      {result.skipped.length > 0 && ` · ${result.skipped.length} already ${result.action}`}
                      {result.failed.length > 0 && ` · ${result.failed.length} failed`}
                    </div>
                    {/* Name every entity that did not do what was asked. A bare
                        count leaves the operator unable to act on the rest. */}
                    {result.failed.length > 0 && (
                      <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 12, color: 'var(--danger)' }}>
                        {result.failed.map((f) => (
                          <li key={`${f.tenantId}-${f.standardCode}`}>{f.tenantName} — {f.message || 'failed'}</li>
                        ))}
                      </ul>
                    )}
                    {result.skipped.length > 0 && (
                      <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 6 }}>
                        Already {result.action}: {result.skipped.map((s) => s.tenantName).join(', ')}
                      </div>
                    )}
                    <button onClick={() => setResult(null)} style={{ ...linkBtn('var(--ink-muted)'), marginTop: 8 }}>
                      dismiss
                    </button>
                  </div>
                )}

                <div style={{ marginBottom: 10 }}>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter entities…"
                    style={{ ...S.input, maxWidth: 280 }}
                  />
                </div>

                <div style={S.card}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={S.headRow}>
                        <th style={S.th}>Entity</th>
                        <th style={S.th}>Operating model</th>
                        <th style={S.th}>{standard.code}</th>
                        <th style={S.th}>All frameworks</th>
                        <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownTenants.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 22, textAlign: 'center', color: 'var(--ink-muted)' }}>
                            {tenants.length === 0
                              ? 'No entities in scope.'
                              : 'No entity matches that filter.'}
                          </td>
                        </tr>
                      ) : shownTenants.map((t) => {
                        const on = enabledHere.has(t.id);
                        const e = enablements.find((x) => x.tenantId === t.id && x.standardId === standard.id);
                        return (
                          <tr key={t.id} style={S.bodyRow}>
                            <td style={S.td}><strong style={{ color: 'var(--ink)' }}>{t.name}</strong></td>
                            <td style={{ ...S.td, color: 'var(--ink-muted)', fontSize: 12 }}>{t.type}</td>
                            <td style={S.td}>
                              {on
                                ? (
                                  <span style={pill('var(--success)', 'var(--success-line)')}>
                                    enabled{e?.applicability && e.applicability !== 'Full' ? ` · ${e.applicability}` : ''}
                                  </span>
                                )
                                : <span style={pill('var(--ink-muted)', 'var(--line)')}>not enabled</span>}
                            </td>
                            <td style={{ ...S.td, fontSize: 11.5, color: 'var(--ink-muted)' }}>
                              {(() => {
                                const codes = perTenant.get(t.id) || [];
                                if (codes.length === 0) return <span style={{ color: 'var(--warning)' }}>none</span>;
                                return (
                                  <>
                                    <strong style={{ color: 'var(--ink-body)' }}>{codes.length}</strong>
                                    {' · '}
                                    {codes.slice(0, 3).join(', ')}
                                    {codes.length > 3 && ` +${codes.length - 3}`}
                                  </>
                                );
                              })()}
                            </td>
                            <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <Can do={MAY.AUTHOR_STANDARD}>
                                {on
                                  ? (
                                    <button
                                      onClick={() => setConfirming({ tenant: t, standard })}
                                      disabled={busy}
                                      style={linkBtn('var(--warning)')}
                                    >
                                      disable
                                    </button>
                                  )
                                  : (
                                    <button
                                      onClick={() => runBatch('enable', [t.id])}
                                      disabled={busy}
                                      style={linkBtn('var(--brand)')}
                                    >
                                      enable
                                    </button>
                                  )}
                              </Can>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Choosing entities. PickManyDialog normally means "this is the new set",
          but enabling is additive and disabling is subtractive, so each list is
          narrowed to the entities the action can actually change and opens with
          nothing ticked. Offering an already-enabled entity under Enable would
          invite an operation that is a no-op. */}
      {picking && standard && (
        <PickManyDialog
          title={picking === 'enable' ? `Enable ${standard.code}` : `Disable ${standard.code}`}
          intro={picking === 'enable'
            ? <>Records that each chosen entity is assessed against {standard.code}, with applicability <strong>{applicability}</strong>. Entities that already have it are not listed.</>
            : <>Stops assessing each chosen entity against {standard.code}. The assessment history is not deleted — implementations and evidence hang off controls, not off this record.</>}
          items={tenants
            .filter((t) => (picking === 'enable' ? !enabledHere.has(t.id) : enabledHere.has(t.id)))
            .map((t) => ({ id: t.id, label: t.name, sublabel: t.type }))}
          initiallySelected={[]}
          confirmLabel={picking === 'enable' ? 'Enable for selected' : 'Disable for selected'}
          emptyMessage={picking === 'enable'
            ? `Every entity in scope already has ${standard.code} enabled.`
            : `No entity in scope has ${standard.code} enabled.`}
          busy={busy}
          onSubmit={(ids) => runBatch(picking, ids)}
          onCancel={() => setPicking(null)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={`Disable ${confirming.standard.code}`}
          message={(
            <>
              Stop assessing <strong>{confirming.tenant.name}</strong> against{' '}
              <strong>{confirming.standard.code}</strong>? The assessment history is kept —
              implementations and evidence hang off controls, not off this record.
            </>
          )}
          confirmLabel="Disable"
          destructive
          busy={busy}
          onConfirm={() => runBatch('disable', [confirming.tenant.id])}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
};

export default TenantStandardEnablement;
