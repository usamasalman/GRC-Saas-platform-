import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../api/apiClient';

interface TenantRow {
  id: string;
  name: string;
  type: string;
  path: string;
  parentId: string | null;
  parentName: string | null;
  depth: number;
  plan: string | null;
  planPrice: number | null;
  maxUsers: number | null;
  counts: { users: number; children: number; documents: number; tickets: number; invoices: number };
  createdAt: string;
}

interface PlanRow { id: string; name: string; priceMonthly: number; maxUsers: number }

const TYPES = ['SAAS', 'SAAS_UNIT', 'HOLDING', 'MULTIBRANCH', 'BRANCH', 'FRANCHISE', 'PARTNER'];

const TYPE_TINT: Record<string, string> = {
  SAAS: '#1f6fff', SAAS_UNIT: '#3b82f6', HOLDING: '#8b5cf6',
  MULTIBRANCH: '#0ea5e9', BRANCH: '#64748b', FRANCHISE: '#f59e0b', PARTNER: '#10b981',
};

const TenantManager: React.FC = () => {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [form, setForm] = useState({ name: '', type: 'BRANCH', parentId: '', planId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [tRes, pRes] = await Promise.all([
        apiClient.get('/api/tenants'),
        apiClient.get('/api/admin/db/table/Plan').catch(() => null),
      ]);
      setTenants(tRes.data?.tenants || []);
      setScope(tRes.data?.scope || '');
      if (pRes) setPlans(pRes.data?.records || []);
    } catch (err: any) {
      const s = err?.response?.status;
      if (s === 401) setError('Session expired. Please sign in again.');
      else if (s === 403) setError(err?.response?.data?.message || 'Not authorized to view tenants.');
      else setError('Could not reach the API on port 3000.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = (parentId = '') => {
    setEditing(null);
    setForm({ name: '', type: 'BRANCH', parentId, planId: '' });
    setNotice('');
    setShowModal(true);
  };

  const openEdit = (t: TenantRow) => {
    setEditing(t);
    setForm({ name: t.name, type: t.type, parentId: t.parentId || '', planId: '' });
    setNotice('');
    setShowModal(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setNotice('');
    try {
      if (editing) {
        await apiClient.patch(`/api/tenants/${editing.id}`, { name: form.name, type: form.type });
      } else {
        await apiClient.post('/api/tenants', {
          name: form.name,
          type: form.type,
          parentId: form.parentId || undefined,
          planId: form.planId || undefined,
        });
      }
      setShowModal(false);
      await load();
    } catch (err: any) {
      setNotice(err?.response?.data?.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (t: TenantRow) => {
    if (!window.confirm(`Delete tenant "${t.name}"? This is only possible when it holds no users, sub-entities, documents or invoices.`)) return;
    try {
      await apiClient.delete(`/api/tenants/${t.id}`);
      await load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Delete failed');
    }
  };

  const visible = tenants.filter((t) => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totals = tenants.reduce(
    (a, t) => ({
      users: a.users + t.counts.users,
      docs: a.docs + t.counts.documents,
      tickets: a.tickets + t.counts.tickets,
      roots: a.roots + (t.parentId ? 0 : 1),
    }),
    { users: 0, docs: 0, tickets: 0, roots: 0 }
  );

  const card: React.CSSProperties = {
    background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 16,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 11px', boxSizing: 'border-box', background: '#0b1220',
    border: '1px solid #1e293b', borderRadius: 6, color: '#e2e8f0', fontFamily: 'inherit', fontSize: 13,
  };
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
    background: bg, color: fg, border: 'none', padding: '8px 14px',
    borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
  });

  return (
    <div style={{ padding: 24, color: '#cbd5e1', fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Manage tenants</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Scope: <strong style={{ color: '#93c5fd' }}>{scope || '—'}</strong>
            {scope === 'PLATFORM' && ' · break-glass access is audit-logged'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={{ ...btn('transparent', '#94a3b8'), border: '1px solid #334155' }}>↻ Refresh</button>
          <button onClick={() => openCreate()} style={btn('#2563eb')}>+ New tenant</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 20 }}>
        {[
          ['Tenants', tenants.length], ['Root entities', totals.roots],
          ['Users', totals.users], ['Documents', totals.docs], ['Tickets', totals.tickets],
        ].map(([label, val]) => (
          <div key={String(label)} style={card}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, color: '#f1f5f9' }}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          placeholder="Filter by name…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: 260 }}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ ...inputStyle, maxWidth: 200 }}>
          <option value="">All operating models</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {error && (
        <div style={{ background: '#3f1618', border: '1px solid #7f1d1d', padding: 12, borderRadius: 6, color: '#fca5a5', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading tenants…</div>
      ) : (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#0b1220', color: '#64748b' }}>
                {['Entity', 'Model', 'Parent', 'Plan', 'Users', 'Docs', 'Tickets', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 400, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #16202f' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ paddingLeft: t.depth * 16, color: '#e2e8f0' }}>
                      {t.depth > 0 && <span style={{ color: '#475569' }}>└ </span>}{t.name}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 4,
                      border: `1px solid ${TYPE_TINT[t.type] || '#334155'}`,
                      color: TYPE_TINT[t.type] || '#94a3b8', whiteSpace: 'nowrap',
                    }}>{t.type}</span>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#64748b' }}>{t.parentName || '—'}</td>
                  <td style={{ padding: '10px 12px', color: t.plan ? '#86efac' : '#475569' }}>{t.plan || 'none'}</td>
                  <td style={{ padding: '10px 12px' }}>{t.counts.users}</td>
                  <td style={{ padding: '10px 12px' }}>{t.counts.documents}</td>
                  <td style={{ padding: '10px 12px' }}>{t.counts.tickets}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openCreate(t.id)} title="Add sub-entity"
                      style={{ ...btn('transparent', '#93c5fd'), padding: '4px 8px', fontSize: 11 }}>+ child</button>
                    <button onClick={() => openEdit(t)}
                      style={{ ...btn('transparent', '#94a3b8'), padding: '4px 8px', fontSize: 11 }}>edit</button>
                    <button onClick={() => remove(t)}
                      style={{ ...btn('transparent', '#fca5a5'), padding: '4px 8px', fontSize: 11 }}>del</button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>No tenants match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...card, width: '100%', maxWidth: 460, borderRadius: 12, padding: 26 }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 17, color: '#f1f5f9' }}>
              {editing ? `Edit ${editing.name}` : 'Provision new tenant'}
            </h3>
            {notice && (
              <div style={{ background: '#3f1618', border: '1px solid #7f1d1d', padding: 10, borderRadius: 6, color: '#fca5a5', marginBottom: 14, fontSize: 12 }}>{notice}</div>
            )}
            <form onSubmit={submit}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Legal / display name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Operating model</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>

              {!editing && (
                <>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Parent entity (blank = root)</label>
                  <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }}>
                    <option value="">— none (new root) —</option>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{' '.repeat(t.depth * 2)}{t.name}</option>)}
                  </select>

                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Subscription plan (optional)</label>
                  <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} style={{ ...inputStyle, marginBottom: 20 }}>
                    <option value="">— no subscription —</option>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.maxUsers} users</option>)}
                  </select>
                </>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={submitting} style={{ ...btn(submitting ? '#334155' : '#2563eb'), flex: 1, padding: 11 }}>
                  {submitting ? 'Saving…' : editing ? 'Save changes' : 'Provision tenant'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} style={{ ...btn('transparent', '#94a3b8'), border: '1px solid #334155', padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantManager;
