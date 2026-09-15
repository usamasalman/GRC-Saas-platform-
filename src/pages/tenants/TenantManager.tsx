import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import { ConfirmDialog } from '../../components/Dialog';

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
  suspendedAt?: string | null;
  suspendedRootId?: string | null;
  suspendedReason?: string | null;
}

interface PlanRow { id: string; name: string; priceMonthly: number; maxUsers: number }
interface RoleRow { id: string; name: string; portal: string }

/**
 * What the server hands back once, and only once.
 *
 * Both onboard and invite mint a temporary password, hash it, and return the
 * plaintext in that one response. It is never retrievable afterwards, so the
 * screen has to be deliberate about showing it: prominently, with its expiry,
 * and saying plainly that it will not appear again.
 */
interface Provisioned {
  tenantName: string;
  adminEmail: string;
  adminRole: string;
  temporaryPassword: string;
  expiresAt: string | null;
}

const TYPES = ['SAAS', 'SAAS_UNIT', 'HOLDING', 'MULTIBRANCH', 'BRANCH', 'FRANCHISE', 'PARTNER'];

const TYPE_TINT: Record<string, string> = {
  SAAS: '#1f6fff', SAAS_UNIT: 'var(--info)', HOLDING: 'var(--violet)',
  MULTIBRANCH: 'var(--info)', BRANCH: 'var(--ink-muted)', FRANCHISE: 'var(--warning)', PARTNER: 'var(--success)',
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
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [form, setForm] = useState({
    name: '', type: 'BRANCH', parentId: '', planId: '',
    adminName: '', adminEmail: '', adminRoleId: '',
  });
  const [provisioned, setProvisioned] = useState<Provisioned | null>(null);
  /** An existing tenant that has nobody in it, being given its first administrator. */
  const [adopting, setAdopting] = useState<TenantRow | null>(null);
  const [suspending, setSuspending] = useState<TenantRow | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [actionErr, setActionErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [tRes, pRes, rRes] = await Promise.all([
        apiClient.get('/api/tenants'),
        apiClient.get('/api/admin/db/table/Plan').catch(() => null),
        // A tenant cannot be provisioned without naming its administrator's
        // role, so this list is load-bearing rather than decorative. Caught
        // individually: the tenant table is still worth showing without it.
        apiClient.get('/api/iam/roles').catch(() => null),
      ]);
      setTenants(tRes.data?.tenants || []);
      setScope(tRes.data?.scope || '');
      if (pRes) setPlans(pRes.data?.records || []);
      setRoles(rRes?.data?.roles || []);
    } catch (err: any) {
      const s = err?.response?.status;
      if (s === 401) setError('Session expired. Please sign in again.');
      else if (s === 403) setError(err?.response?.data?.message || 'Not authorized to view tenants.');
      else setError('Could not reach the backend API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = (parentId = '') => {
    setEditing(null);
    setForm({
      name: '', type: 'BRANCH', parentId, planId: '',
      adminName: '', adminEmail: '', adminRoleId: '',
    });
    setNotice('');
    setShowModal(true);
  };

  const openEdit = (t: TenantRow) => {
    setEditing(t);
    setForm({
      name: t.name, type: t.type, parentId: t.parentId || '', planId: '',
      adminName: '', adminEmail: '', adminRoleId: '',
    });
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
        setShowModal(false);
        await load();
        return;
      }

      // Onboard, not create.
      //
      // This posted to /api/tenants, which makes a tenant and nobody in it. The
      // organisation then exists, appears in every list, counts against nothing,
      // and cannot be entered by anyone at all -- the operator's only remaining
      // move is to go and invite a user into it from another screen, if they
      // realise they have to.
      //
      // /api/tenants/onboard has existed the whole time, is routed, is
      // capability-guarded, and creates the tenant and its first administrator
      // in one transaction with one audit record. Nothing called it.
      const res = await apiClient.post('/api/tenants/onboard', {
        name: form.name,
        type: form.type,
        parentId: form.parentId || undefined,
        planId: form.planId || undefined,
        admin: {
          name: form.adminName,
          email: form.adminEmail,
          roleId: form.adminRoleId,
        },
      });

      setShowModal(false);
      // Held outside the modal, because the modal is about to close and this is
      // the only time this value exists anywhere.
      setProvisioned({
        tenantName: form.name,
        adminEmail: res.data?.administrator?.email || form.adminEmail,
        adminRole: res.data?.administrator?.role || '',
        temporaryPassword: res.data?.temporaryPassword || '',
        expiresAt: res.data?.temporaryPasswordExpiresAt || null,
      });
      await load();
    } catch (err: any) {
      setNotice(err?.response?.data?.message || 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Give an organisation that has nobody in it its first administrator.
   *
   * Every tenant created before this screen sent an administrator is in that
   * state, and so is any created through the API directly. inviteUser has always
   * accepted a tenantId and checked it against scope; no screen sent one, so
   * there was no way to do this from the product at all.
   */
  const adopt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adopting) return;
    setSubmitting(true);
    setNotice('');
    try {
      const res = await apiClient.post('/api/iam/users/invite', {
        tenantId: adopting.id,
        name: form.adminName,
        email: form.adminEmail,
        roleId: form.adminRoleId,
      });
      setProvisioned({
        tenantName: adopting.name,
        adminEmail: res.data?.user?.email || form.adminEmail,
        adminRole: res.data?.user?.role || '',
        temporaryPassword: res.data?.temporaryPassword || '',
        expiresAt: res.data?.temporaryPasswordExpiresAt || null,
      });
      setAdopting(null);
      await load();
    } catch (err: any) {
      setNotice(err?.response?.data?.message || 'Could not create the administrator');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Stop an organisation, or start it again.
   *
   * The refusals matter more than the success here: the server will not let an
   * operator suspend their own organisation, anything containing it, or the
   * platform tenant, because the suspension lands on the next request — which
   * is the one that would undo it. Its message is surfaced verbatim rather than
   * replaced with a generic failure.
   */
  const setSuspended = async (tenant: TenantRow, suspend: boolean, reason?: string) => {
    setSubmitting(true);
    setActionErr('');
    try {
      const res = await apiClient.post(
        `/api/tenants/${tenant.id}/${suspend ? 'suspend' : 'reactivate'}`,
        suspend ? { reason: reason || '' } : {},
      );
      setSuspending(null);
      setSuspendReason('');
      setNotice(res.data?.message || '');
      await load();
    } catch (err: any) {
      setActionErr(err?.response?.data?.message || 'The change could not be made.');
    } finally {
      setSubmitting(false);
    }
  };

  const [removing, setRemoving] = useState<TenantRow | null>(null);
  const [removeErr, setRemoveErr] = useState('');

  const remove = async (t: TenantRow) => {
    setRemoveErr('');
    try {
      await apiClient.delete(`/api/tenants/${t.id}`);
      setRemoving(null);
      await load();
    } catch (err: any) {
      // Kept in the open dialog: the refusal names what the tenant still holds,
      // which is the answer to "why can I not delete this".
      setRemoveErr(err?.response?.data?.message || 'Delete failed');
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
    background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 10, padding: 16,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 11px', boxSizing: 'border-box', background: 'var(--surface)',
    border: '1px solid var(--line)', borderRadius: 6, color: 'var(--ink-body)', fontFamily: 'inherit', fontSize: 13,
  };
  const btn = (bg: string, fg = '#fff'): React.CSSProperties => ({
    background: bg, color: fg, border: 'none', padding: '8px 14px',
    borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
  });

  return (
    <div style={{ padding: 24, color: 'var(--ink-body)', fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Manage tenants</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
            {scope === 'PLATFORM' && ' · break-glass access is audit-logged'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={{ ...btn('transparent', 'var(--ink-muted)'), border: '1px solid var(--line)' }}>↻ Refresh</button>
          <button onClick={() => openCreate()} style={btn('var(--info)')}>+ New tenant</button>
        </div>
      </div>

      {/* Shown once, because it exists once. The server hashes the password and
          returns the plaintext in that single response; there is no endpoint
          that can produce it again. Leaving it in a toast that auto-dismisses,
          or only in the modal that just closed, would lose it. */}
      {provisioned && (
        <div style={{
          background: 'var(--success-bg)', border: '1px solid var(--success-line)',
          borderRadius: 10, padding: 16, marginBottom: 20,
        }}>
          <div style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600, marginBottom: 6 }}>
            {provisioned.tenantName} is provisioned and can be signed in to.
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-body)', lineHeight: 1.7 }}>
            <div>{provisioned.adminEmail}{provisioned.adminRole && ` · ${provisioned.adminRole}`}</div>
            <div style={{ marginTop: 8 }}>
              Temporary password:{' '}
              <code style={{
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 4, padding: '3px 8px', fontSize: 13, color: 'var(--ink)',
                userSelect: 'all',
              }}>{provisioned.temporaryPassword}</code>
            </div>
            <div style={{ marginTop: 8, color: 'var(--ink-muted)' }}>
              This will not be shown again. Pass it to them out of band; it must be changed at
              first sign-in
              {provisioned.expiresAt && `, and stops working on ${new Date(provisioned.expiresAt).toLocaleDateString()}`}.
            </div>
          </div>
          <button
            onClick={() => setProvisioned(null)}
            style={{ ...btn('transparent', 'var(--ink-muted)'), border: '1px solid var(--line)', marginTop: 12 }}
          >
            I have copied it
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 20 }}>
        {[
          ['Tenants', tenants.length], ['Root entities', totals.roots],
          ['Users', totals.users], ['Documents', totals.docs], ['Tickets', totals.tickets],
        ].map(([label, val]) => (
          <div key={String(label)} style={card}>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 22, color: 'var(--ink)' }}>{val}</div>
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
        <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', padding: 12, borderRadius: 6, color: 'var(--danger)', marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading tenants…</div>
      ) : (
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface)', color: 'var(--ink-muted)' }}>
                {['Entity', 'Model', 'Parent', 'Plan', 'Users', 'Docs', 'Tickets', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 400, borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ paddingLeft: t.depth * 16, color: t.suspendedAt ? 'var(--ink-muted)' : 'var(--ink-body)' }}>
                      {t.depth > 0 && <span style={{ color: 'var(--ink-body)' }}>└ </span>}{t.name}
                    </span>
                    {/* A suspended organisation looks identical to an operating
                        one in every list unless the list says otherwise, and an
                        operator acting on the wrong assumption is how a customer
                        stays off the platform for a week longer than intended. */}
                    {t.suspendedAt && (
                      <div style={{ paddingLeft: t.depth * 16, marginTop: 3 }}>
                        <span style={{
                          fontSize: 10, padding: '2px 7px', borderRadius: 4,
                          border: '1px solid var(--warning-line)', color: 'var(--warning)',
                        }}>
                          suspended{t.suspendedRootId && t.suspendedRootId !== t.id ? ' · by parent' : ''}
                        </span>
                        {t.suspendedReason && (
                          <span style={{ fontSize: 10.5, color: 'var(--ink-muted)', marginLeft: 6 }}>
                            {t.suspendedReason}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 4,
                      border: `1px solid ${TYPE_TINT[t.type] || 'var(--ink-body)'}`,
                      color: TYPE_TINT[t.type] || 'var(--ink-muted)', whiteSpace: 'nowrap',
                    }}>{t.type}</span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--ink-muted)' }}>{t.parentName || '—'}</td>
                  <td style={{ padding: '10px 12px', color: t.plan ? 'var(--success)' : 'var(--ink-body)' }}>{t.plan || 'none'}</td>
                  {/* Zero was rendered as a plain "0" beside every other count,
                      which is true and says nothing. A tenant with no users
                      cannot be entered by anyone, and that is the one number on
                      this row that means the organisation does not work. */}
                  <td style={{ padding: '10px 12px' }}>
                    {t.counts.users === 0
                      ? <span style={{ color: 'var(--warning)' }} title="Nobody can sign in to this organisation">0 · no one</span>
                      : t.counts.users}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{t.counts.documents}</td>
                  <td style={{ padding: '10px 12px' }}>{t.counts.tickets}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                    {t.counts.users === 0 && (
                      <button
                        onClick={() => {
                          setNotice('');
                          // Cleared, because this dialog shares the create form's
                          // state: without it, opening "add administrator" for one
                          // organisation offers the name and email of the person
                          // provisioned into the last one, pre-filled and ready to
                          // submit against the wrong tenant.
                          setForm((f) => ({ ...f, adminName: '', adminEmail: '', adminRoleId: '' }));
                          setAdopting(t);
                        }}
                        title="Create the first administrator for this organisation"
                        style={{ ...btn('transparent', 'var(--warning)'), padding: '4px 8px', fontSize: 11 }}
                      >
                        + admin
                      </button>
                    )}
                    <button onClick={() => openCreate(t.id)} title="Add sub-entity"
                      style={{ ...btn('transparent', 'var(--info)'), padding: '4px 8px', fontSize: 11 }}>+ child</button>
                    <button onClick={() => openEdit(t)}
                      style={{ ...btn('transparent', 'var(--ink-muted)'), padding: '4px 8px', fontSize: 11 }}>edit</button>
                    {/* Offered only where it can succeed. A tenant suspended
                        because its parent was cannot be lifted on its own — the
                        server refuses, and a button whose only outcome is a
                        refusal is worse than no button. */}
                    {t.suspendedAt
                      ? (t.suspendedRootId === t.id || !t.suspendedRootId) && (
                        <button onClick={() => { setActionErr(''); setSuspended(t, false); }}
                          disabled={submitting}
                          title="Let this organisation back in"
                          style={{ ...btn('transparent', 'var(--success)'), padding: '4px 8px', fontSize: 11 }}>reactivate</button>
                      )
                      : (
                        <button onClick={() => { setActionErr(''); setSuspendReason(''); setSuspending(t); }}
                          disabled={submitting}
                          title="Stop this organisation signing in, without deleting anything"
                          style={{ ...btn('transparent', 'var(--warning)'), padding: '4px 8px', fontSize: 11 }}>suspend</button>
                      )}
                    <button onClick={() => { setRemoveErr(''); setRemoving(t); }}
                      style={{ ...btn('transparent', 'var(--danger)'), padding: '4px 8px', fontSize: 11 }}>del</button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--ink-muted)' }}>No tenants match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...card, width: '100%', maxWidth: 460, borderRadius: 12, padding: 26 }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 17, color: 'var(--ink)' }}>
              {editing ? `Edit ${editing.name}` : 'Provision new tenant'}
            </h3>
            {notice && (
              <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', padding: 10, borderRadius: 6, color: 'var(--danger)', marginBottom: 14, fontSize: 12 }}>{notice}</div>
            )}
            <form onSubmit={submit}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Legal / display name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Operating model</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>

              {!editing && (
                <>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Parent entity (blank = root)</label>
                  <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }}>
                    <option value="">— none (new root) —</option>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{' '.repeat(t.depth * 2)}{t.name}</option>)}
                  </select>

                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Subscription plan (optional)</label>
                  <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} style={{ ...inputStyle, marginBottom: 20 }}>
                    <option value="">— no subscription —</option>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.maxUsers} users</option>)}
                  </select>

                  {/* Not optional, and not a separate step. An organisation
                      nobody can sign in to is not provisioned, it is just a row. */}
                  <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600, marginBottom: 2 }}>
                      First administrator
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
                      Created with the organisation, in one step. A temporary password is issued
                      once and must be changed at first sign-in.
                    </div>
                  </div>

                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Administrator name</label>
                  <input
                    required
                    value={form.adminName}
                    onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                    style={{ ...inputStyle, marginBottom: 14 }}
                  />

                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Administrator email</label>
                  <input
                    required
                    type="email"
                    value={form.adminEmail}
                    onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                    style={{ ...inputStyle, marginBottom: 14 }}
                  />

                  <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Administrator role</label>
                  <select
                    required
                    value={form.adminRoleId}
                    onChange={(e) => setForm({ ...form, adminRoleId: e.target.value })}
                    style={{ ...inputStyle, marginBottom: 8 }}
                  >
                    <option value="">— choose a role —</option>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.portal}</option>)}
                  </select>
                  {roles.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 14, lineHeight: 1.5 }}>
                      The role list could not be loaded, so an organisation cannot be provisioned
                      right now. Refresh and try again.
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 20, lineHeight: 1.5 }}>
                    You can only grant a role whose privileges you hold yourself; the server
                    refuses and names the excess otherwise.
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="submit"
                  disabled={submitting || (!editing && roles.length === 0)}
                  style={{ ...btn(submitting || (!editing && roles.length === 0) ? 'var(--ink-body)' : 'var(--info)'), flex: 1, padding: 11 }}
                >
                  {submitting ? 'Saving…' : editing ? 'Save changes' : 'Provision with administrator'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} style={{ ...btn('transparent', 'var(--ink-muted)'), border: '1px solid var(--line)', padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* A reason, because the person refused at the door is shown it. Not
          required by the server — an operator acting in a hurry should not be
          blocked — but asked for every time. */}
      {suspending && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...card, width: '100%', maxWidth: 480, borderRadius: 12, padding: 26 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: 'var(--ink)' }}>
              Suspend {suspending.name}?
            </h3>
            <p style={{ margin: '0 0 6px', fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.7 }}>
              Nobody in this organisation will be able to sign in, and open sessions stop working on
              their next request. Nothing is deleted: the data stays exactly where it is, reports
              still count it, and reactivating is one click.
            </p>
            {suspending.counts.children > 0 && (
              <p style={{ margin: '0 0 6px', fontSize: 12.5, color: 'var(--warning)', lineHeight: 1.7 }}>
                This reaches the {suspending.counts.children} entit{suspending.counts.children === 1 ? 'y' : 'ies'} beneath
                it as well — a group whose branches keep trading is not suspended.
              </p>
            )}
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              The reason is shown to anyone who tries to sign in.
            </p>
            {actionErr && (
              <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', padding: 10, borderRadius: 6, color: 'var(--danger)', marginBottom: 14, fontSize: 12, lineHeight: 1.6 }}>{actionErr}</div>
            )}
            <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Reason</label>
            <input
              value={suspendReason}
              autoFocus
              placeholder="e.g. Unpaid invoices since August"
              onChange={(e) => setSuspendReason(e.target.value)}
              style={{ ...inputStyle, marginBottom: 20 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setSuspended(suspending, true, suspendReason)}
                style={{ ...btn(submitting ? 'var(--ink-body)' : 'var(--warning)'), flex: 1, padding: 11 }}
              >
                {submitting ? 'Suspending…' : 'Suspend organisation'}
              </button>
              <button type="button" onClick={() => { setSuspending(null); setActionErr(''); }} style={{ ...btn('transparent', 'var(--ink-muted)'), border: '1px solid var(--line)', padding: 11 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* A refusal from a row control has no dialog to live in — the server's
          message is the whole answer and it must not vanish. */}
      {actionErr && !suspending && (
        <div style={{ position: 'fixed', left: 20, right: 20, bottom: 20, zIndex: 950, display: 'flex', justifyContent: 'center' }}>
          <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', color: 'var(--danger)', padding: '12px 16px', borderRadius: 8, fontSize: 12.5, maxWidth: 640, lineHeight: 1.6 }}>
            {actionErr}
            <button onClick={() => setActionErr('')} style={{ ...btn('transparent', 'var(--ink-muted)'), marginLeft: 12, padding: '2px 8px', fontSize: 11 }}>dismiss</button>
          </div>
        </div>
      )}

      {adopting && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...card, width: '100%', maxWidth: 460, borderRadius: 12, padding: 26 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: 'var(--ink)' }}>
              First administrator for {adopting.name}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              Nobody can sign in to this organisation. A temporary password is issued once and must
              be changed at first sign-in.
            </p>
            {notice && (
              <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', padding: 10, borderRadius: 6, color: 'var(--danger)', marginBottom: 14, fontSize: 12 }}>{notice}</div>
            )}
            <form onSubmit={adopt}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Name</label>
              <input required value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Email</label>
              <input required type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Role</label>
              <select required value={form.adminRoleId} onChange={(e) => setForm({ ...form, adminRoleId: e.target.value })} style={{ ...inputStyle, marginBottom: 20 }}>
                <option value="">— choose a role —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.portal}</option>)}
              </select>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={submitting || roles.length === 0} style={{ ...btn(submitting || roles.length === 0 ? 'var(--ink-body)' : 'var(--info)'), flex: 1, padding: 11 }}>
                  {submitting ? 'Creating…' : 'Create administrator'}
                </button>
                <button type="button" onClick={() => setAdopting(null)} style={{ ...btn('transparent', 'var(--ink-muted)'), border: '1px solid var(--line)', padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title={`Delete the tenant "${removing.name}"?`}
          destructive
          typeToConfirm={removing.name}
          confirmLabel="Delete tenant"
          message={(
            <>
              <div>
                A tenant is the root of everything inside it. This is only possible while it
                holds no users, sub-entities, documents or invoices — the server checks and
                refuses with whatever is still there.
              </div>
              <div style={{ marginTop: 10, color: 'var(--ink-muted)' }}>
                Type the name to confirm. This is the one deletion in the product with a whole
                customer behind it.
              </div>
              {removeErr && (
                <div style={{
                  marginTop: 12, padding: '10px 12px', borderRadius: 6,
                  background: 'var(--danger-bg)', border: '1px solid var(--danger-line)',
                  color: 'var(--danger)', fontSize: 12.5, lineHeight: 1.6,
                }}>
                  {removeErr}
                </div>
              )}
            </>
          )}
          onConfirm={() => remove(removing)}
          onCancel={() => { setRemoving(null); setRemoveErr(''); }}
        />
      )}
    </div>
  );
};

export default TenantManager;
