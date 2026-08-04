import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from './iamStyles';

interface Capability { key: string; name: string; module: string; number: number | null }
interface Role {
  id: string; key: string; name: string; portal: string;
  scopeDescription: string | null; businessPurpose: string | null;
  capabilities: string[]; isSystem: boolean; needsReview: boolean;
  tenantId: string | null; tenantName: string | null; origin: string; userCount: number;
}

const RoleMatrix: React.FC = () => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [caps, setCaps] = useState<Capability[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [portalFilter, setPortalFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [form, setForm] = useState<{ name: string; businessPurpose: string; capabilities: string[] }>({
    name: '', businessPurpose: '', capabilities: [],
  });
  const [modalErr, setModalErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [rRes, cRes] = await Promise.all([
        apiClient.get('/api/iam/roles'),
        apiClient.get('/api/iam/capabilities'),
      ]);
      setRoles(rRes.data?.roles || []);
      setScope(rRes.data?.scope || '');
      setCaps(cRes.data?.capabilities || []);
    } catch (err) {
      setError(apiError(err, 'Failed to load the role matrix'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', businessPurpose: '', capabilities: [] });
    setModalErr(''); setShowModal(true);
  };
  const openEdit = (r: Role) => {
    setEditing(r);
    setForm({ name: r.name, businessPurpose: r.businessPurpose || '', capabilities: [...r.capabilities] });
    setModalErr(''); setShowModal(true);
  };

  const toggleCap = (key: string) => {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(key)
        ? f.capabilities.filter((c) => c !== key)
        : [...f.capabilities, key],
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.capabilities.length === 0) { setModalErr('Select at least one capability.'); return; }
    setBusy(true); setModalErr('');
    try {
      if (editing) {
        await apiClient.patch(`/api/iam/roles/${editing.id}`, {
          name: form.name, businessPurpose: form.businessPurpose,
          capabilities: form.capabilities, needsReview: false,
        });
      } else {
        await apiClient.post('/api/iam/roles', {
          name: form.name, businessPurpose: form.businessPurpose, capabilities: form.capabilities,
        });
      }
      setShowModal(false); await load();
    } catch (err) { setModalErr(apiError(err, 'Save failed')); }
    finally { setBusy(false); }
  };

  const remove = async (r: Role) => {
    if (!window.confirm(`Delete custom role "${r.name}"?`)) return;
    try { await apiClient.delete(`/api/iam/roles/${r.id}`); await load(); }
    catch (err) { window.alert(apiError(err, 'Delete failed')); }
  };

  const portals = [...new Set(roles.map((r) => r.portal))].sort();
  const visible = roles.filter((r) => {
    if (portalFilter && r.portal !== portalFilter) return false;
    if (originFilter === 'system' && !r.isSystem) return false;
    if (originFilter === 'custom' && r.isSystem) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const capName = (key: string) => caps.find((c) => c.key === key)?.name || key;
  const byModule = caps.reduce<Record<string, Capability[]>>((a, c) => {
    (a[c.module] ||= []).push(c); return a;
  }, {});

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Roles &amp; permissions</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Capability grants drive every server-side permission check. Scope: <strong style={{ color: '#93c5fd' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <button onClick={openCreate} style={primaryBtn()}>+ Custom role</button>
        </div>
      </div>

      <StatStrip items={[
        ['Roles', roles.length],
        ['TRD-defined', roles.filter((r) => r.isSystem).length],
        ['Custom', roles.filter((r) => !r.isSystem).length],
        ['Capabilities', caps.length],
        ['Need review', <span style={{ color: roles.some((r) => r.needsReview) ? '#fbbf24' : '#f1f5f9' }}>{roles.filter((r) => r.needsReview).length}</span>],
      ]} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="Filter by role name…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 240 }} />
        <select value={portalFilter} onChange={(e) => setPortalFilter(e.target.value)} style={{ ...S.input, maxWidth: 210 }}>
          <option value="">All portals</option>
          {portals.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value)} style={{ ...S.input, maxWidth: 190 }}>
          <option value="">All origins</option>
          <option value="system">TRD Appendix A</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading role matrix…</div>
      ) : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={S.headRow}>
                {['Role', 'Portal', 'Origin', 'Scope', 'Caps', 'Users', ''].map((h) => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <React.Fragment key={r.id}>
                  <tr style={S.bodyRow}>
                    <td style={S.td}>
                      <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                        style={{ ...linkBtn('#e2e8f0'), fontSize: 12, padding: 0 }}>
                        {expanded === r.id ? '▾' : '▸'} {r.name}
                      </button>
                      {r.needsReview && <span style={{ ...pill('#fbbf24', '#78350f'), marginLeft: 8 }}>review</span>}
                    </td>
                    <td style={{ ...S.td, color: '#94a3b8' }}>{r.portal}</td>
                    <td style={S.td}>
                      <span style={r.isSystem ? pill('#93c5fd', '#1e3a8a') : pill('#c4b5fd', '#5b21b6')}>
                        {r.isSystem ? 'TRD' : 'custom'}
                      </span>
                      {r.tenantName && <div style={{ color: '#475569', fontSize: 10, marginTop: 2 }}>{r.tenantName}</div>}
                    </td>
                    <td style={{ ...S.td, color: '#64748b', maxWidth: 230 }}>{r.scopeDescription}</td>
                    <td style={S.td}>{r.capabilities.length}</td>
                    <td style={S.td}>{r.userCount}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                      {r.isSystem ? (
                        <span style={{ color: '#475569', fontSize: 11 }}>read-only</span>
                      ) : (
                        <>
                          <button onClick={() => openEdit(r)} style={linkBtn('#93c5fd')}>edit</button>
                          <button onClick={() => remove(r)} style={linkBtn('#fca5a5')}>del</button>
                        </>
                      )}
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr style={{ background: '#0b1220' }}>
                      <td colSpan={7} style={{ padding: '12px 16px' }}>
                        {r.businessPurpose && (
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{r.businessPurpose}</div>
                        )}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {r.capabilities.map((c) => (
                            <span key={c} style={{ ...pill('#86efac', '#15803d'), fontSize: 11, padding: '3px 8px' }}>
                              {capName(c)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>No roles match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 620, padding: 26, borderRadius: 12, maxHeight: '88vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: '#f1f5f9' }}>
              {editing ? `Edit "${editing.name}"` : 'Create custom role'}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              Grants are enforced server-side on every request. Pick the minimum set the job needs.
            </p>
            {modalErr && <div style={{ ...S.error, marginBottom: 14 }}>{modalErr}</div>}
            <form onSubmit={submit}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Role name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...S.input, marginBottom: 14 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Business purpose</label>
              <input value={form.businessPurpose} onChange={(e) => setForm({ ...form, businessPurpose: e.target.value })}
                placeholder="Why this role exists" style={{ ...S.input, marginBottom: 16 }} />

              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
                Capabilities — <strong style={{ color: '#e2e8f0' }}>{form.capabilities.length}</strong> selected
              </div>
              <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: 12, marginBottom: 20, maxHeight: 300, overflowY: 'auto' }}>
                {Object.entries(byModule).map(([mod, list]) => (
                  <div key={mod} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>{mod}</div>
                    {list.map((c) => (
                      <label key={c.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5, fontSize: 12, cursor: 'pointer', color: form.capabilities.includes(c.key) ? '#e2e8f0' : '#94a3b8' }}>
                        <input type="checkbox" checked={form.capabilities.includes(c.key)} onChange={() => toggleCap(c.key)} style={{ marginTop: 2 }} />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Create role'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleMatrix;
