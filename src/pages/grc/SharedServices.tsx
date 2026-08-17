import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';
import Icon from '../../components/Icon';
import type { IconName } from '../../components/Icon';

/**
 * Shared services inside a group.
 *
 * What was here before was four sentences of static text describing a concept
 * the platform did not model. The concept is real: when group IT operates
 * access recertification for eight subsidiaries, one failed control is eight
 * failed controls — and each subsidiary's own register shows green, because the
 * control belongs to the parent.
 *
 * The number this screen exists to produce is the blast radius: failures
 * multiplied by the entities relying on them.
 */

const FUNCTION_ICON: Record<string, IconName> = {
  IT: 'implementations', Security: 'shield', HR: 'teams', Finance: 'payments',
  Legal: 'documents', Procurement: 'vendors', Facilities: 'building', Other: 'network',
};

const POSTURE: Record<string, { fg: string; line: string; help: string }> = {
  Operating: { fg: 'var(--success)', line: 'var(--success-line)', help: 'Every control this service operates is verified and effective.' },
  Partial: { fg: 'var(--warning)', line: 'var(--warning-line)', help: 'Some controls are not yet independently verified.' },
  Unproven: { fg: 'var(--info)', line: 'var(--info-line)', help: 'Controls are attached but none has been verified.' },
  Failing: { fg: 'var(--danger)', line: 'var(--danger-line)', help: 'At least one control this service operates has been assessed ineffective.' },
  NoControls: { fg: 'var(--ink-muted)', line: 'var(--line)', help: 'No control is attached, so the service cannot be assured at all.' },
};

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4,
  letterSpacing: '0.03em', fontWeight: 600,
};

const SharedServices: React.FC = () => {
  const [services, setServices] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>({});
  const [totals, setTotals] = useState<any>({});
  const [tenants, setTenants] = useState<any[]>([]);
  const [impls, setImpls] = useState<any[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const blank = { name: '', function: 'IT', description: '', slaSummary: '', reportingCadence: 'Quarterly' };
  const [form, setForm] = useState<any>(blank);

  const me = (() => { try { return JSON.parse(localStorage.getItem('grc_user_json') || 'null'); } catch { return null; } })();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s, i] = await Promise.all([
        apiClient.get('/api/grc/shared-services'),
        apiClient.get('/api/grc/implementations').catch(() => null),
      ]);
      setServices(s.data?.services || []);
      setTotals(s.data?.totals || {});
      setTenants(s.data?.availableTenants || []);
      setMeta({
        functions: s.data?.functions || [], cadences: s.data?.cadences || [],
      });
      setScope(s.data?.scope || '');
      setImpls(i?.data?.implementations || []);
    } catch (err) { setError(apiError(err, 'Failed to load shared services')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      const res = await apiClient.post('/api/grc/shared-services', form);
      setShowNew(false); setForm(blank);
      setNotice(res.data?.message || 'Service created');
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not create the service')); }
    finally { setBusy(false); }
  };

  const setConsumers = async (s: any) => {
    const current = new Set((s.consumers || []).map((c: any) => c.consumerTenantId));
    const options = tenants.filter((t) => t.id !== s.providerTenantId);
    if (options.length === 0) {
      window.alert('There are no other entities in your scope to enrol on this service.');
      return;
    }
    const choice = window.prompt(
      `Which entities rely on ${s.ref}? Comma-separated numbers.\n\n`
      + options.map((t, n) => `${n + 1}. ${current.has(t.id) ? '[enrolled] ' : ''}${t.name}`).join('\n'),
      options.map((t, n) => (current.has(t.id) ? String(n + 1) : '')).filter(Boolean).join(','),
    );
    if (choice === null) return;
    const ids = choice.split(',').map((x) => options[Number(x.trim()) - 1]?.id).filter(Boolean);
    try {
      const res = await apiClient.post(`/api/grc/shared-services/${s.id}/consumers`, { consumerTenantIds: ids });
      setNotice(res.data?.message || 'Consumers updated');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const setControls = async (s: any) => {
    const current = new Set((s.controls || []).map((c: any) => c.implementationId));
    const choice = window.prompt(
      `Which controls does ${s.ref} operate on its consumers' behalf? Comma-separated numbers.\n\n`
      + impls.slice(0, 25).map((im, n) =>
        `${n + 1}. ${current.has(im.id) ? '[attached] ' : ''}${im.control?.code} — ${im.control?.title}`).join('\n'),
      impls.map((im, n) => (current.has(im.id) ? String(n + 1) : '')).filter(Boolean).join(','),
    );
    if (choice === null) return;
    const ids = choice.split(',').map((x) => impls[Number(x.trim()) - 1]?.id).filter(Boolean);
    try {
      const res = await apiClient.post(`/api/grc/shared-services/${s.id}/controls`, { implementationIds: ids });
      setNotice(res.data?.message || 'Controls attached');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const accept = async (s: any) => {
    if (!window.confirm(
      `Accept ${s.ref} — ${s.name} — on behalf of your entity?\n\n`
      + `You are recording that your entity relies on this service and its stated SLA.`,
    )) return;
    try {
      const res = await apiClient.post(`/api/grc/shared-services/${s.id}/accept`, {});
      setNotice(res.data?.message || 'Accepted');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  if (loading) return <div style={{ ...S.page, color: 'var(--ink-muted)' }}>Loading shared services…</div>;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Shared services</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)', maxWidth: '50rem', lineHeight: 1.55 }}>
            Capabilities one entity runs on behalf of others. Modelling them makes the concentration
            visible: a control operated centrally for eight entities is one control and eight
            dependencies, and a failure is eight failures rather than one.
            Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={load} style={{ ...ghostBtn, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="refresh" size={15} /> Refresh
          </button>
          <button onClick={() => { setFormErr(''); setShowNew(true); }} style={{ ...primaryBtn(), display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="plus" size={15} /> New service
          </button>
        </div>
      </div>

      <StatStrip items={[
        ['Services', totals.total ?? 0],
        ['Entities served', totals.entitiesServed ?? 0],
        ['Controls operated', totals.controlsOperated ?? 0],
        ['Failing', <span style={{ color: (totals.failing ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.failing ?? 0}</span>],
        ['Downstream failures', <span style={{ color: (totals.totalBlastRadius ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.totalBlastRadius ?? 0}</span>],
        ['Not yet accepted', <span style={{ color: (totals.unaccepted ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.unaccepted ?? 0}</span>],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          <Icon name="success" size={15} />
          <span style={{ flex: 1 }}>{notice}</span>
          <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      {services.length === 0 && (
        <div style={{ ...S.card, padding: 30, color: 'var(--ink-muted)', fontSize: 13, lineHeight: 1.6 }}>
          No shared services recorded. If a central function — group IT, group security, group HR —
          operates controls on behalf of other entities, record it here so the dependency is visible on
          both sides rather than assumed.
        </div>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {services.map((s) => {
          const p = POSTURE[s.posture] || POSTURE.NoControls;
          const isProvider = s.providerTenant?.id === me?.tenantId;
          const myLink = (s.consumers || []).find((c: any) => c.consumerTenantId === me?.tenantId);
          return (
            <div key={s.id} style={{
              ...S.card, padding: 18,
              borderLeft: `4px solid ${s.blastRadius > 0 ? 'var(--danger)' : s.posture === 'NoControls' ? 'var(--line)' : 'var(--brand)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 380px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <Icon name={FUNCTION_ICON[s.function] || 'network'} size={17} />
                    <strong style={{ color: 'var(--brand)', fontVariantNumeric: 'tabular-nums' }}>{s.ref}</strong>
                    <span style={{ fontSize: 15, fontWeight: 650, color: 'var(--ink)' }}>{s.name}</span>
                    <span style={pill(p.fg, p.line)} title={p.help}>{s.posture === 'NoControls' ? 'No controls' : s.posture}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 5 }}>
                    {s.function} · provided by <strong style={{ color: 'var(--ink-body)' }}>{s.providerTenant?.name}</strong>
                    {' · '}owner {s.serviceOwner?.name}
                    {' · '}reports {s.reportingCadence.toLowerCase()}
                  </div>
                  {s.slaSummary && (
                    <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 8, padding: '8px 11px', background: 'var(--surface-sunk)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius-sm)' }}>
                      <span style={{ ...label, display: 'inline', marginRight: 6 }}>SLA</span>{s.slaSummary}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 20, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  <div>
                    <div style={label}>Relied on by</div>
                    <div style={{ fontSize: 20, fontWeight: 750, color: 'var(--ink)' }}>{s.consumerCount}</div>
                  </div>
                  <div>
                    <div style={label}>Controls</div>
                    <div style={{ fontSize: 20, fontWeight: 750, color: 'var(--ink)' }}>{s.controlCount}</div>
                  </div>
                  <div title="Failed controls multiplied by the entities relying on them">
                    <div style={label}>Blast radius</div>
                    <div style={{ fontSize: 20, fontWeight: 750, color: s.blastRadius > 0 ? 'var(--danger)' : 'var(--ink-faint)' }}>
                      {s.blastRadius}
                    </div>
                  </div>
                </div>
              </div>

              {s.blastRadius > 0 && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--danger)' }}>
                  {s.failing} control(s) here have been assessed ineffective, and {s.consumerCount} entity(ies)
                  rely on them — so this is <strong>{s.blastRadius} downstream control failures</strong>, not {s.failing}.
                </div>
              )}

              {s.unacceptedConsumers.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--warning)' }}>
                  Relied on without formal acceptance by: {s.unacceptedConsumers.join(', ')}
                </div>
              )}

              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {(s.consumers || []).map((c: any) => (
                  <span key={c.id} style={pill(
                    c.acceptedAt ? 'var(--success)' : 'var(--warning)',
                    c.acceptedAt ? 'var(--success-line)' : 'var(--warning-line)',
                  )}>
                    {c.consumerTenant?.name}{!c.acceptedAt && ' · unaccepted'}
                  </span>
                ))}
                {(s.controls || []).map((c: any) => {
                  const eff = c.implementation?.effectiveness;
                  const verified = c.implementation?.status === 'Verified';
                  const fg = !verified ? 'var(--ink-muted)'
                    : eff === 'Effective' ? 'var(--success)'
                      : eff === 'Ineffective' ? 'var(--danger)' : 'var(--warning)';
                  const line = !verified ? 'var(--line)'
                    : eff === 'Effective' ? 'var(--success-line)'
                      : eff === 'Ineffective' ? 'var(--danger-line)' : 'var(--warning-line)';
                  return (
                    <span key={c.id} style={pill(fg, line)}
                      title={`${c.implementation?.control?.title} — ${c.implementation?.status}/${eff || 'not assessed'}`}>
                      {c.implementation?.control?.code}
                    </span>
                  );
                })}
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {isProvider && (
                  <>
                    <button style={linkBtn('var(--info)')} onClick={() => setConsumers(s)}>who relies on this</button>
                    <button style={linkBtn('var(--info)')} onClick={() => setControls(s)}>controls operated</button>
                  </>
                )}
                {myLink && !myLink.acceptedAt && (
                  <button style={linkBtn('var(--success)')} onClick={() => accept(s)}>accept for my entity</button>
                )}
                {myLink?.acceptedAt && (
                  <span style={{ fontSize: 11.5, color: 'var(--ink-faint)', alignSelf: 'center' }}>
                    accepted by {myLink.acceptedBy?.name} on {String(myLink.acceptedAt).slice(0, 10)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 560, padding: 26, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>New shared service</h3>
              <button onClick={() => setShowNew(false)} style={linkBtn('var(--ink-muted)')} aria-label="Close">
                <Icon name="close" size={15} label="Close" />
              </button>
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.55 }}>
              Describe a capability your entity runs for others. Once created, record which entities rely
              on it and which controls it operates on their behalf — that pairing is what makes the
              dependency visible on both sides.
            </p>
            {formErr && <div style={{ ...S.error, marginBottom: 14 }}><Icon name="warning" size={15} />{formErr}</div>}
            <form onSubmit={create}>
              <label style={label}>Service name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={{ ...S.input, marginBottom: 12 }} placeholder="Group Identity & Access" />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={label}>Function</label>
                  <select value={form.function} onChange={(e) => setForm({ ...form, function: e.target.value })} style={S.input}>
                    {(meta.functions || []).map((f: string) => <option key={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label}>Reports</label>
                  <select value={form.reportingCadence} onChange={(e) => setForm({ ...form, reportingCadence: e.target.value })} style={S.input}>
                    {(meta.cadences || []).map((c: string) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <label style={label}>What consuming entities are entitled to expect</label>
              <textarea rows={3} value={form.slaSummary} onChange={(e) => setForm({ ...form, slaSummary: e.target.value })}
                style={{ ...S.input, marginBottom: 20, resize: 'vertical' }}
                placeholder="Joiner within 1 business day; leaver within 4 hours; quarterly recertification." />

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Creating…' : 'Create service'}
                </button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SharedServices;
