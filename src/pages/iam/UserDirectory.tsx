import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, linkBtn, pill, STATUS_PILL, apiError } from './iamStyles';
import FormDialog from '../../components/FormDialog';
import Can, { MAY } from '../../components/Can';

export type Tier = 'saas' | 'org' | 'branch' | 'all';

interface UserRow {
  id: string; name: string; email: string; role: string; roleId: string | null;
  roleName: string; roleIsSystem: boolean; roleNeedsReview: boolean; capabilityCount: number;
  department: string | null; branch: string | null; status: string;
  mfaEnabled: boolean; mustChangePassword: boolean;
  tenantId: string; tenantName: string; tenantType: string;
}
interface RoleOption { id: string; name: string; isSystem: boolean; tenantId: string | null }
interface DeptOption { id: string; name: string }

const TITLES: Record<Tier, { title: string; blurb: string }> = {
  saas: { title: 'SaaS admin users', blurb: 'Platform staff operating the control plane.' },
  org: { title: 'Organization users', blurb: 'Holding, multibranch, franchise and partner tenants.' },
  branch: { title: 'Branch users', blurb: 'Locally scoped users inside individual branches.' },
  all: { title: 'All users', blurb: 'Every user inside your authorized scope.' },
};

const UserDirectory: React.FC<{ tier: Tier }> = ({ tier }) => {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('Active');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (tier !== 'all') params.set('tier', tier);
      if (departmentFilter) params.set('department', departmentFilter);
      // This screen manages people rather than assigning work to them, so it
      // asks for everybody and filters below. The endpoint now returns Active
      // only unless asked, which is what stops the pickers offering leavers.
      params.set('status', 'any');
      const qs = params.toString() ? `?${params.toString()}` : '';
      const [uRes, rRes, dRes] = await Promise.all([
        apiClient.get(`/api/iam/users${qs}`),
        apiClient.get('/api/iam/roles').catch(() => null),
        apiClient.get('/api/iam/departments').catch(() => null),
      ]);
      setUsers(uRes.data?.users || []);
      setTotals(uRes.data?.totals || {});
      setScope(uRes.data?.scope || '');
      setRoles(rRes?.data?.roles || []);
      setDepts(dRes?.data?.departments || []);
    } catch (err) {
      setError(apiError(err, 'Failed to load users'));
    } finally { setLoading(false); }
  }, [tier, departmentFilter]);

  useEffect(() => { load(); }, [load]);

  /**
   * The open dialog. Both actions are about one user, and both were prompts
   * that could fail after the fact — the role list was numbered and a typed
   * number outside it produced "Invalid selection" with nothing to correct.
   */
  const [dialog, setDialog] = useState<
    null | { kind: 'role'; u: UserRow } | { kind: 'status'; u: UserRow; next: string }
    | { kind: 'offboard'; u: UserRow }
  >(null);

  // What the leaver holds, fetched before anything is asked of the
  // administrator. An offboarding moves every risk, control, document, project
  // and open ticket they own; confirming that on a dialog alone would ask
  // somebody to authorise a blast radius they were never shown.
  const [preview, setPreview] = useState<any>(null);
  const [successorId, setSuccessorId] = useState('');
  const [offboardReason, setOffboardReason] = useState('');
  const [roleDialogValue, setRoleDialogValue] = useState('');

  const [dialogBusy, setDialogBusy] = useState(false);

  const openRoleDialog = (u: UserRow) => {
    setRoleDialogValue(u.roleId || '');
    setDialog({ kind: 'role', u });
  };

  /**
   * Platform roles (tenantId null) are always offered — they are the standard
   * set and any tenant may use them. Custom roles (tenantId set) are offered
   * only when they belong to the user's own tenant: a custom role for Tenant A
   * cannot be assigned to someone in Tenant B, and the server enforces this
   * too. Before this fix the filter was `!r.tenantId || r.name === u.roleName`,
   * which kept the role the person already held but excluded every other custom
   * role their tenant had defined — so a custom role could never actually be
   * assigned.
   */
  const roleOptionsFor = (u: UserRow) =>
    roles.filter((r) => !r.tenantId || r.tenantId === u.tenantId);

  const saveRole = async (u: UserRow, roleId: string) => {
    const chosen = roles.find((r) => r.id === roleId);
    if (!chosen) return;
    setDialogBusy(true);
    try {
      await apiClient.post(`/api/iam/users/${u.id}/role`, { roleId: chosen.id });
      setDialog(null);
      setNotice(`${u.email} is now ${chosen.name}`);
      await load();
    } catch (err) { setError(apiError(err, 'Role change failed')); setDialog(null); }
    finally { setDialogBusy(false); }
  };

  const saveStatus = async (u: UserRow, next: string, reason: string) => {
    setDialogBusy(true);
    try {
      await apiClient.post(`/api/iam/users/${u.id}/status`, { status: next, reason });
      setDialog(null);
      setNotice(`${u.email} → ${next}`);
      await load();
    } catch (err) { setError(apiError(err, 'Status change failed')); setDialog(null); }
    finally { setDialogBusy(false); }
  };

  const openOffboard = async (u: UserRow) => {
    setPreview(null);
    setSuccessorId('');
    setOffboardReason('');
    setDialog({ kind: 'offboard', u });
    try {
      const res = await apiClient.get(`/api/iam/users/${u.id}/offboard-preview`);
      setPreview(res.data || null);
    } catch (err) {
      setError(apiError(err, 'Could not work out what this person holds'));
      setDialog(null);
    }
  };

  const doOffboard = async (u: UserRow) => {
    setDialogBusy(true);
    try {
      const res = await apiClient.post(`/api/iam/users/${u.id}/offboard`, {
        successorId,
        reason: offboardReason,
      });
      setDialog(null);
      setNotice(res.data?.message || `${u.email} offboarded`);
      await load();
    } catch (err) {
      setError(apiError(err, 'Offboarding failed'));
      setDialog(null);
    } finally { setDialogBusy(false); }
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
          <option value="Active">Active only</option>
          <option value="">All statuses</option>
          <option value="Suspended">Suspended</option>
          <option value="Inactive">Inactive (leavers)</option>
        </select>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          style={{ ...S.input, maxWidth: 200 }}
        >
          <option value="">All departments</option>
          {depts.map((d) => (
            <option key={d.id} value={d.name}>{d.name}</option>
          ))}
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
                    <button onClick={() => openRoleDialog(u)} style={linkBtn('var(--info)')}>role</button>
                    <button onClick={() => setDialog({ kind: 'status', u, next: u.status === 'Active' ? 'Suspended' : 'Active' })} style={linkBtn(u.status === 'Active' ? 'var(--warning)' : 'var(--success)')}>
                      {u.status === 'Active' ? 'suspend' : 'activate'}
                    </button>
                    {u.status !== 'Inactive' && (
                      <Can do={MAY.OFFBOARD_USER}>
                        <button onClick={() => openOffboard(u)} style={linkBtn('var(--danger)')}>
                          offboard
                        </button>
                      </Can>
                    )}
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

      {dialog?.kind === 'offboard' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 560, padding: 26, borderRadius: 12, maxHeight: '86vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: 'var(--ink)' }}>
              Offboard {dialog.u.name}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              Everything this person is responsible for moves to their successor, and their
              access ends. The account is not deleted: their name stays on the approvals they
              signed, the policies they acknowledged and the audit entries they caused.
            </p>

            {!preview ? (
              <div style={{ color: 'var(--ink-muted)', fontSize: 12.5, padding: '12px 0' }}>
                Working out what they hold…
              </div>
            ) : (
              <>
                <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
                    {preview.summary?.ownsNothing
                      ? 'This person holds nothing that needs handing over'
                      : `${preview.summary?.total} record${preview.summary?.total === 1 ? '' : 's'} will move`}
                  </div>
                  {preview.summary?.ownsNothing ? (
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
                      Nothing names them as owner, assignee or approver. A successor is still
                      required, so the record says who picked the work up.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(preview.summary?.moving || []).map((m: any) => (
                        <div key={`${m.model}.${m.column}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-muted)' }}>
                          <span>{m.label}</span>
                          <strong style={{ color: 'var(--ink)' }}>{m.count}</strong>
                        </div>
                      ))}
                    </div>
                  )}

                  {(preview.withdraw?.acknowledgementRequests > 0 || preview.withdraw?.checkedOutDocuments > 0) && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--warning)', lineHeight: 1.6 }}>
                      {preview.withdraw.acknowledgementRequests > 0 && (
                        <div>
                          {preview.withdraw.acknowledgementRequests} acknowledgement request
                          {preview.withdraw.acknowledgementRequests === 1 ? '' : 's'} will be
                          withdrawn — they can no longer sign, and leaving them would hold
                          those policies below full coverage forever.
                        </div>
                      )}
                      {preview.withdraw.checkedOutDocuments > 0 && (
                        <div>
                          {preview.withdraw.checkedOutDocuments} checked-out document
                          {preview.withdraw.checkedOutDocuments === 1 ? '' : 's'} will be
                          released, or nobody could open them again.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
                  Who takes over
                </label>
                <select
                  value={successorId}
                  onChange={(e) => setSuccessorId(e.target.value)}
                  style={{ ...S.input, marginBottom: 14 }}
                >
                  <option value="">Choose a successor…</option>
                  {users
                    .filter((c) => c.id !== dialog.u.id && c.status === 'Active' && c.tenantId === dialog.u.tenantId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name} — {c.roleName}</option>
                    ))}
                </select>

                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
                  Why they are leaving
                </label>
                <textarea
                  value={offboardReason}
                  onChange={(e) => setOffboardReason(e.target.value)}
                  rows={3}
                  placeholder="The one line that explains this handover to whoever reads the audit log."
                  style={{ ...S.input, marginBottom: 18, fontFamily: 'inherit' }}
                />
              </>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setDialog(null)} style={ghostBtn} disabled={dialogBusy}>Cancel</button>
              <button
                onClick={() => doOffboard(dialog.u)}
                disabled={dialogBusy || !preview || !successorId || offboardReason.trim().length < 4}
                style={{ ...ghostBtn, color: 'var(--danger)', borderColor: 'var(--danger-line)', opacity: (!preview || !successorId || offboardReason.trim().length < 4) ? 0.5 : 1 }}
              >
                {dialogBusy ? 'Handing over…' : 'Offboard and hand over'}
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog?.kind === 'role' && (() => {
        const opts = roleOptionsFor(dialog.u);
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
            <div style={{ ...S.card, width: '100%', maxWidth: 460, padding: 26, borderRadius: 12 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 17, color: 'var(--ink)' }}>Assign a role to {dialog.u.email}</h3>
              <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
                Currently <strong style={{ color: 'var(--ink-body)' }}>{dialog.u.roleName}</strong>. The role decides what this person can do; the menu and the API both follow it.
              </p>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 6, color: 'var(--ink-muted)' }}>Role</label>
              <select
                value={roleDialogValue}
                onChange={(e) => setRoleDialogValue(e.target.value)}
                style={{ ...S.input, marginBottom: 20 }}
              >
                <option value="">— select a role —</option>
                {opts.some((r) => r.isSystem) && (
                  <optgroup label="Platform roles">
                    {opts.filter((r) => r.isSystem).map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </optgroup>
                )}
                {opts.some((r) => !r.isSystem) && (
                  <optgroup label={`Custom roles — ${dialog.u.tenantName}`}>
                    {opts.filter((r) => !r.isSystem).map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  disabled={dialogBusy || !roleDialogValue}
                  style={{ flex: 1, padding: 11, cursor: roleDialogValue ? 'pointer' : 'default', background: roleDialogValue ? 'var(--brand)' : 'var(--ink-muted)', color: '#fff', border: 'none', borderRadius: 6, fontFamily: 'inherit', fontSize: 13 }}
                  onClick={() => roleDialogValue && saveRole(dialog.u, roleDialogValue)}
                >
                  {dialogBusy ? 'Saving…' : 'Assign role'}
                </button>
                <button onClick={() => setDialog(null)} style={{ padding: 11, cursor: 'pointer', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, fontFamily: 'inherit', fontSize: 13, color: 'var(--ink-muted)' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {dialog?.kind === 'status' && (
        <FormDialog
          title={`Set ${dialog.u.email} to ${dialog.next}`}
          destructive={dialog.next === 'Suspended'}
          submitLabel={dialog.next === 'Suspended' ? 'Suspend user' : 'Reactivate user'}
          busy={dialogBusy}
          intro={dialog.next === 'Suspended'
            ? 'A suspended user cannot sign in. Their records, approvals and audit history stay exactly as they are.'
            : 'The user can sign in again with the role they already hold.'}
          fields={[{
            name: 'reason',
            label: 'Reason',
            type: 'textarea',
            required: true,
            help: 'Recorded against the account. This is what someone reads later when they ask why the access changed.',
          }]}
          onSubmit={(v) => saveStatus(dialog.u, dialog.next, v.reason)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default UserDirectory;
