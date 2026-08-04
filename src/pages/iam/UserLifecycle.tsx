import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, STATUS_PILL, apiError } from './iamStyles';

interface UserRow {
  id: string; name: string; email: string; roleName: string; roleId: string | null;
  department: string | null; branch: string | null; status: string;
  mustChangePassword: boolean; tenantName: string; tenantType: string;
  tenant: { id: string };
}
interface RoleOption { id: string; name: string; isSystem: boolean; tenantId: string | null }
interface TenantOption { id: string; name: string; type: string; depth: number }

const UserLifecycle: React.FC = () => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: '', email: '', roleId: '', tenantId: '', department: '', branch: '' });
  const [inviteErr, setInviteErr] = useState('');
  const [tempPassword, setTempPassword] = useState('');

  const [transferFor, setTransferFor] = useState<UserRow | null>(null);
  const [transfer, setTransfer] = useState({ targetTenantId: '', reason: '', newDepartment: '' });
  const [transferErr, setTransferErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [uRes, rRes, tRes] = await Promise.all([
        apiClient.get('/api/iam/users'),
        apiClient.get('/api/iam/roles').catch(() => null),
        apiClient.get('/api/tenants').catch(() => null),
      ]);
      setUsers(uRes.data?.users || []);
      setTotals(uRes.data?.totals || {});
      setRoles(rRes?.data?.roles || []);
      setTenants(tRes?.data?.tenants || []);
    } catch (err) {
      setError(apiError(err, 'Failed to load user lifecycle data'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setInviteErr(''); setTempPassword('');
    try {
      const res = await apiClient.post('/api/iam/users/invite', {
        name: invite.name, email: invite.email, roleId: invite.roleId,
        tenantId: invite.tenantId || undefined,
        department: invite.department || undefined,
        branch: invite.branch || undefined,
      });
      setTempPassword(res.data?.temporaryPassword || '');
      setInvite({ name: '', email: '', roleId: '', tenantId: '', department: '', branch: '' });
      await load();
    } catch (err) { setInviteErr(apiError(err, 'Invite failed')); }
    finally { setBusy(false); }
  };

  const submitTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferFor) return;
    setBusy(true); setTransferErr('');
    try {
      const res = await apiClient.post(`/api/iam/users/${transferFor.id}/transfer`, {
        targetTenantId: transfer.targetTenantId,
        reason: transfer.reason,
        newDepartment: transfer.newDepartment || undefined,
      });
      setNotice(res.data?.message || 'Transferred');
      setTransferFor(null);
      setTransfer({ targetTenantId: '', reason: '', newDepartment: '' });
      await load();
    } catch (err) { setTransferErr(apiError(err, 'Transfer failed')); }
    finally { setBusy(false); }
  };

  const q = search.toLowerCase();
  const visible = users.filter((u) =>
    !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.tenantName.toLowerCase().includes(q));

  // Only platform roles are safe to offer for an invite into an arbitrary tenant.
  const assignableRoles = roles.filter((r) => !r.tenantId || r.tenantId === invite.tenantId);

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>User lifecycle &amp; transfers</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Invite-only provisioning, entity transfers, suspension. No self-signup.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <button onClick={() => { setInviteErr(''); setTempPassword(''); setInviteOpen(true); }} style={primaryBtn()}>+ Invite user</button>
        </div>
      </div>

      <StatStrip items={[
        ['Users', users.length],
        ['Active', totals.active ?? 0],
        ['Suspended', users.filter((u) => u.status === 'Suspended').length],
        ['Pending pw change', <span style={{ color: (totals.mustChangePassword ?? 0) > 0 ? '#fbbf24' : '#f1f5f9' }}>{totals.mustChangePassword ?? 0}</span>],
        ['No role', <span style={{ color: (totals.unlinkedRole ?? 0) > 0 ? '#fca5a5' : '#f1f5f9' }}>{totals.unlinkedRole ?? 0}</span>],
      ]} />

      <input placeholder="Search name, email or entity…" value={search}
        onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 320, marginBottom: 14 }} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice} <button onClick={() => setNotice('')} style={linkBtn('#86efac')}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading…</div>
      ) : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={S.headRow}>
                {['User', 'Current entity', 'Role', 'Dept / branch', 'Status', 'Flags', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => (
                <tr key={u.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <div style={{ color: '#e2e8f0' }}>{u.name}</div>
                    <div style={{ color: '#475569', fontSize: 11 }}>{u.email}</div>
                  </td>
                  <td style={{ ...S.td, color: '#94a3b8' }}>
                    {u.tenantName}
                    <div style={{ color: '#475569', fontSize: 10 }}>{u.tenantType}</div>
                  </td>
                  <td style={{ ...S.td, color: '#cbd5e1' }}>{u.roleName}</td>
                  <td style={{ ...S.td, color: '#64748b' }}>
                    {u.department || '—'}
                    {u.branch && <div style={{ fontSize: 10 }}>{u.branch}</div>}
                  </td>
                  <td style={S.td}><span style={STATUS_PILL[u.status] || STATUS_PILL.Inactive}>{u.status}</span></td>
                  <td style={S.td}>
                    {u.mustChangePassword && <span style={pill('#fbbf24', '#78350f')}>pw reset</span>}
                    {!u.roleId && <span style={{ ...pill('#fca5a5', '#7f1d1d'), marginLeft: 4 }}>no role</span>}
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => { setTransferErr(''); setTransfer({ targetTenantId: '', reason: '', newDepartment: '' }); setTransferFor(u); }}
                      style={linkBtn('#93c5fd')}>transfer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 480, padding: 26, borderRadius: 12, maxHeight: '88vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 17, color: '#f1f5f9' }}>Invite user</h3>

            {tempPassword ? (
              <>
                <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ color: '#86efac', fontSize: 12, marginBottom: 10 }}>
                    ✓ User created. Give them this temporary password out-of-band — it is shown once and must be changed at first login.
                  </div>
                  <div style={{ background: '#020617', padding: 14, borderRadius: 6, textAlign: 'center', fontSize: 18, color: '#f1f5f9', letterSpacing: '0.08em' }}>
                    {tempPassword}
                  </div>
                </div>
                <button onClick={() => { setTempPassword(''); setInviteOpen(false); }} style={{ ...primaryBtn(), width: '100%', padding: 11 }}>
                  Done
                </button>
              </>
            ) : (
              <form onSubmit={submitInvite}>
                {inviteErr && <div style={{ ...S.error, marginBottom: 14 }}>{inviteErr}</div>}

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Full name</label>
                <input required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Email</label>
                <input required type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Entity</label>
                <select value={invite.tenantId} onChange={(e) => setInvite({ ...invite, tenantId: e.target.value, roleId: '' })} style={{ ...S.input, marginBottom: 12 }}>
                  <option value="">— my own entity —</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{' '.repeat(t.depth * 2)}{t.name}</option>)}
                </select>

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Role (grants capabilities)</label>
                <select required value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })} style={{ ...S.input, marginBottom: 12 }}>
                  <option value="">— select a role —</option>
                  {assignableRoles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}{r.tenantId ? ' (custom)' : ''}</option>
                  ))}
                </select>

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Department</label>
                <input value={invite.department} onChange={(e) => setInvite({ ...invite, department: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Branch (optional)</label>
                <input value={invite.branch} onChange={(e) => setInvite({ ...invite, branch: e.target.value })} style={{ ...S.input, marginBottom: 20 }} />

                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                    {busy ? 'Creating…' : 'Create user'}
                  </button>
                  <button type="button" onClick={() => setInviteOpen(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {transferFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 460, padding: 26, borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: '#f1f5f9' }}>Transfer {transferFor.name}</h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              Currently at <strong style={{ color: '#cbd5e1' }}>{transferFor.tenantName}</strong>.
              A transfer revokes their active sessions, and a tenant-specific role is cleared.
            </p>
            {transferErr && <div style={{ ...S.error, marginBottom: 14 }}>{transferErr}</div>}
            <form onSubmit={submitTransfer}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Destination entity</label>
              <select required value={transfer.targetTenantId} onChange={(e) => setTransfer({ ...transfer, targetTenantId: e.target.value })} style={{ ...S.input, marginBottom: 12 }}>
                <option value="">— select —</option>
                {tenants.filter((t) => t.id !== transferFor.tenant?.id).map((t) => (
                  <option key={t.id} value={t.id}>{' '.repeat(t.depth * 2)}{t.name}</option>
                ))}
              </select>

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>New department (optional)</label>
              <input value={transfer.newDepartment} onChange={(e) => setTransfer({ ...transfer, newDepartment: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Reason (audit evidence, required)</label>
              <textarea required rows={3} value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })}
                style={{ ...S.input, marginBottom: 20, resize: 'vertical' }} />

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Transferring…' : 'Transfer user'}
                </button>
                <button type="button" onClick={() => setTransferFor(null)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserLifecycle;
