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
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>User lifecycle &amp; transfers</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
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
        ['Pending pw change', <span style={{ color: (totals.mustChangePassword ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.mustChangePassword ?? 0}</span>],
        ['No role', <span style={{ color: (totals.unlinkedRole ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.unlinkedRole ?? 0}</span>],
      ]} />

      <input placeholder="Search name, email or entity…" value={search}
        onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 320, marginBottom: 14 }} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice} <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading…</div>
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
                    <div style={{ color: 'var(--ink-body)' }}>{u.name}</div>
                    <div style={{ color: 'var(--ink-body)', fontSize: 11 }}>{u.email}</div>
                  </td>
                  <td style={{ ...S.td, color: 'var(--ink-muted)' }}>
                    {u.tenantName}
                    <div style={{ color: 'var(--ink-body)', fontSize: 10 }}>{u.tenantType}</div>
                  </td>
                  <td style={{ ...S.td, color: 'var(--ink-body)' }}>{u.roleName}</td>
                  <td style={{ ...S.td, color: 'var(--ink-muted)' }}>
                    {u.department || '—'}
                    {u.branch && <div style={{ fontSize: 10 }}>{u.branch}</div>}
                  </td>
                  <td style={S.td}><span style={STATUS_PILL[u.status] || STATUS_PILL.Inactive}>{u.status}</span></td>
                  <td style={S.td}>
                    {u.mustChangePassword && <span style={pill('var(--warning)', 'var(--warning-line)')}>pw reset</span>}
                    {!u.roleId && <span style={{ ...pill('var(--danger)', 'var(--danger-line)'), marginLeft: 4 }}>no role</span>}
                  </td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => { setTransferErr(''); setTransfer({ targetTenantId: '', reason: '', newDepartment: '' }); setTransferFor(u); }}
                      style={linkBtn('var(--info)')}>transfer</button>
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
            <h3 style={{ margin: '0 0 18px', fontSize: 17, color: 'var(--ink)' }}>Invite user</h3>

            {tempPassword ? (
              <>
                <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ color: 'var(--success)', fontSize: 12, marginBottom: 10 }}>
                    ✓ User created. Give them this temporary password out-of-band — it is shown once and must be changed at first login.
                  </div>
                  <div style={{ background: 'var(--surface-sunk)', padding: 14, borderRadius: 6, textAlign: 'center', fontSize: 18, color: 'var(--ink)', letterSpacing: '0.08em' }}>
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

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Full name</label>
                <input required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Email</label>
                <input required type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Entity</label>
                <select value={invite.tenantId} onChange={(e) => setInvite({ ...invite, tenantId: e.target.value, roleId: '' })} style={{ ...S.input, marginBottom: 12 }}>
                  <option value="">— my own entity —</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{' '.repeat(t.depth * 2)}{t.name}</option>)}
                </select>

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Role (grants capabilities)</label>
                <select required value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })} style={{ ...S.input, marginBottom: 12 }}>
                  <option value="">— select a role —</option>
                  {assignableRoles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}{r.tenantId ? ' (custom)' : ''}</option>
                  ))}
                </select>

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Department</label>
                <input value={invite.department} onChange={(e) => setInvite({ ...invite, department: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

                <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Branch (optional)</label>
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
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: 'var(--ink)' }}>Transfer {transferFor.name}</h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              Currently at <strong style={{ color: 'var(--ink-body)' }}>{transferFor.tenantName}</strong>.
              A transfer revokes their active sessions, and a tenant-specific role is cleared.
            </p>
            {transferErr && <div style={{ ...S.error, marginBottom: 14 }}>{transferErr}</div>}
            <form onSubmit={submitTransfer}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Destination entity</label>
              <select required value={transfer.targetTenantId} onChange={(e) => setTransfer({ ...transfer, targetTenantId: e.target.value })} style={{ ...S.input, marginBottom: 12 }}>
                <option value="">— select —</option>
                {tenants.filter((t) => t.id !== transferFor.tenant?.id).map((t) => (
                  <option key={t.id} value={t.id}>{' '.repeat(t.depth * 2)}{t.name}</option>
                ))}
              </select>

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>New department (optional)</label>
              <input value={transfer.newDepartment} onChange={(e) => setTransfer({ ...transfer, newDepartment: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Reason (audit evidence, required)</label>
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
