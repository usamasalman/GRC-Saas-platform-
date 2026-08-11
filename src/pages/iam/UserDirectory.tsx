import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, linkBtn, pill, STATUS_PILL, apiError } from './iamStyles';

export type Tier = 'saas' | 'org' | 'branch' | 'all';

interface UserRow {
  id: string; name: string; email: string; role: string; roleId: string | null;
  roleName: string; roleIsSystem: boolean; roleNeedsReview: boolean; capabilityCount: number;
  department: string | null; branch: string | null; status: string;
  mfaEnabled: boolean; mustChangePassword: boolean;
  tenantName: string; tenantType: string;
}
interface RoleOption { id: string; name: string; isSystem: boolean; tenantId: string | null }

const TITLES: Record<Tier, { title: string; blurb: string }> = {
  saas: { title: 'SaaS admin users', blurb: 'Platform staff operating the control plane.' },
  org: { title: 'Organization users', blurb: 'Holding, multibranch, franchise and partner tenants.' },
  branch: { title: 'Branch users', blurb: 'Locally scoped users inside individual branches.' },
  all: { title: 'All users', blurb: 'Every user inside your authorized scope.' },
};

const UserDirectory: React.FC<{ tier: Tier }> = ({ tier }) => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const q = tier === 'all' ? '' : `?tier=${tier}`;
      const [uRes, rRes] = await Promise.all([
        apiClient.get(`/api/iam/users${q}`),
        apiClient.get('/api/iam/roles').catch(() => null),
      ]);
      setUsers(uRes.data?.users || []);
      setTotals(uRes.data?.totals || {});
      setScope(uRes.data?.scope || '');
      setRoles(rRes?.data?.roles || []);
    } catch (err) {
      setError(apiError(err, 'Failed to load users'));
    } finally { setLoading(false); }
  }, [tier]);

  useEffect(() => { load(); }, [load]);

  const changeRole = async (u: UserRow) => {
    const options = roles.filter((r) => !r.tenantId || r.name === u.roleName);
    const pickList = options.map((r, i) => `${i + 1}. ${r.name}`).join('\n');
    const answer = window.prompt(`Assign a new role to ${u.email}\n\n${pickList}\n\nEnter a number:`);
    if (!answer) return;
    const chosen = options[Number(answer) - 1];
    if (!chosen) { window.alert('Invalid selection'); return; }
    try {
      await apiClient.post(`/api/iam/users/${u.id}/role`, { roleId: chosen.id });
      setNotice(`${u.email} is now ${chosen.name}`);
      await load();
    } catch (err) { window.alert(apiError(err, 'Role change failed')); }
  };

  const toggleStatus = async (u: UserRow) => {
    const next = u.status === 'Active' ? 'Suspended' : 'Active';
    const reason = window.prompt(`Reason for setting ${u.email} to ${next}:`);
    if (reason === null) return;
    try {
      await apiClient.post(`/api/iam/users/${u.id}/status`, { status: next, reason });
      setNotice(`${u.email} → ${next}`);
      await load();
    } catch (err) { window.alert(apiError(err, 'Status change failed')); }
  };

  const visible = users.filter((u) => {
    if (statusFilter && u.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q) && !u.roleName.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const cfg = TITLES[tier];

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>{cfg.title}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            {cfg.blurb} Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <button onClick={load} style={ghostBtn}>↻ Refresh</button>
      </div>

      <StatStrip items={[
        ['In view', users.length],
        ['Active', totals.active ?? 0],
        ['MFA enabled', <span style={{ color: (totals.mfaEnabled ?? 0) === 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.mfaEnabled ?? 0}</span>],
        ['No role linked', <span style={{ color: (totals.unlinkedRole ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.unlinkedRole ?? 0}</span>],
        ['Must change pw', totals.mustChangePassword ?? 0],
      ]} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="Search name, email or role…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 280 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...S.input, maxWidth: 180 }}>
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Suspended">Suspended</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading users…</div>
      ) : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={S.headRow}>
                {['User', 'Tenant', 'Role', 'Caps', 'Dept', 'MFA', 'Status', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => (
                <tr key={u.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <div style={{ color: 'var(--ink-body)' }}>{u.name}</div>
                    <div style={{ color: 'var(--ink-body)', fontSize: 11 }}>{u.email}</div>
                  </td>
                  <td style={{ ...S.td, color: 'var(--ink-muted)' }}>
                    {u.tenantName}
                    <div style={{ color: 'var(--ink-body)', fontSize: 10 }}>{u.tenantType}</div>
                  </td>
                  <td style={S.td}>
                    <span style={{ color: 'var(--ink-body)' }}>{u.roleName}</span>
                    {!u.roleIsSystem && <span style={{ ...pill('var(--violet)', 'var(--violet)'), marginLeft: 6 }}>custom</span>}
                    {u.roleNeedsReview && <span style={{ ...pill('var(--warning)', 'var(--warning-line)'), marginLeft: 4 }}>review</span>}
                    {!u.roleId && <span style={{ ...pill('var(--danger)', 'var(--danger-line)'), marginLeft: 6 }}>unlinked</span>}
                  </td>
                  <td style={{ ...S.td, color: u.capabilityCount === 0 ? 'var(--danger)' : 'var(--ink-body)' }}>{u.capabilityCount}</td>
                  <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{u.department || '—'}</td>
                  <td style={S.td}>
                    <span style={u.mfaEnabled ? pill('var(--success)', 'var(--success-line)') : pill('var(--ink-muted)', 'var(--line)')}>
                      {u.mfaEnabled ? 'on' : 'off'}
                    </span>
                  </td>
                  <td style={S.td}><span style={STATUS_PILL[u.status] || STATUS_PILL.Inactive}>{u.status}</span></td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => changeRole(u)} style={linkBtn('var(--info)')}>role</button>
                    <button onClick={() => toggleStatus(u)} style={linkBtn(u.status === 'Active' ? 'var(--warning)' : 'var(--success)')}>
                      {u.status === 'Active' ? 'suspend' : 'activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--ink-muted)' }}>
                  No users in this tier within your scope.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UserDirectory;
