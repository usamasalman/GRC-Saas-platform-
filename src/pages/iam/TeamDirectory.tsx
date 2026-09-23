import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, primaryBtn, linkBtn, pill, STATUS_PILL, apiError } from './iamStyles';
import Can, { CAP } from '../../components/Can';

interface Member { id: string; name: string; email: string; role: string; status: string; mfaEnabled: boolean; departmentId: string | null }
interface DeptRecord { id: string; tenantId: string; name: string; head: { id: string; name: string; email: string } | null; _count: { members: number } }
interface DeptGroup { name: string; memberCount: number; branches: string[]; members: Member[] }
interface TeamTenant { tenantId: string; tenantName: string; departmentCount: number; memberCount: number; departments: DeptGroup[] }

const TeamDirectory: React.FC = () => {
  const [teams, setTeams] = useState<TeamTenant[]>([]);
  const [deptRecords, setDeptRecords] = useState<DeptRecord[]>([]);
  // Flat user list for move-picker (loaded alongside teams)
  const [allUsers, setAllUsers] = useState<Member[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // ── Create / rename dept dialog ──────────────────────────────────────────
  const [deptDialog, setDeptDialog] = useState<
    null | { kind: 'create' } | { kind: 'edit'; dept: DeptRecord }
  >(null);
  const [deptForm, setDeptForm] = useState({ name: '', headId: '' });
  const [deptErr, setDeptErr] = useState('');

  // ── Move user into dept dialog ───────────────────────────────────────────
  const [moveDialog, setMoveDialog] = useState<{ user: Member } | null>(null);
  const [moveDeptId, setMoveDeptId] = useState('');
  const [moveErr, setMoveErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [teamsRes, deptsRes, usersRes] = await Promise.all([
        apiClient.get('/api/iam/teams'),
        apiClient.get('/api/iam/departments').catch(() => ({ data: { departments: [] } })),
        apiClient.get('/api/iam/users').catch(() => ({ data: { users: [] } })),
      ]);
      setTeams(teamsRes.data?.teams || []);
      setScope(teamsRes.data?.scope || '');
      setDeptRecords(deptsRes.data?.departments || []);
      setAllUsers(usersRes.data?.users || []);
      const first = (teamsRes.data?.teams || [])[0];
      if (first) setOpen((o) => ({ [first.tenantId]: true, ...o }));
    } catch (err) {
      setError(apiError(err, 'Failed to load the team directory'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const matches = (m: Member) =>
    !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.role.toLowerCase().includes(q);

  const visible = teams
    .map((t) => ({
      ...t,
      departments: t.departments
        .map((d) => ({ ...d, members: d.members.filter(matches) }))
        .filter((d) => d.members.length > 0),
    }))
    .filter((t) => t.departments.length > 0 || !q);

  const totalDepts = teams.reduce((a, t) => a + t.departmentCount, 0);
  const totalMembers = teams.reduce((a, t) => a + t.memberCount, 0);
  const unassigned = teams.reduce(
    (a, t) => a + (t.departments.find((d) => d.name === 'Unassigned')?.memberCount || 0), 0);

  // ── Dept CRUD ─────────────────────────────────────────────────────────────

  const openCreate = () => {
    setDeptForm({ name: '', headId: '' });
    setDeptErr('');
    setDeptDialog({ kind: 'create' });
  };

  const openEdit = (dept: DeptRecord) => {
    setDeptForm({ name: dept.name, headId: dept.head?.id || '' });
    setDeptErr('');
    setDeptDialog({ kind: 'edit', dept });
  };

  const submitDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deptForm.name.trim()) { setDeptErr('Name is required'); return; }
    setBusy(true); setDeptErr('');
    try {
      const body = { name: deptForm.name.trim(), headId: deptForm.headId || undefined };
      if (deptDialog?.kind === 'create') {
        await apiClient.post('/api/iam/departments', body);
        setNotice(`Department "${deptForm.name}" created`);
      } else if (deptDialog?.kind === 'edit') {
        await apiClient.patch(`/api/iam/departments/${deptDialog.dept.id}`, body);
        setNotice(`Department updated`);
      }
      setDeptDialog(null);
      await load();
    } catch (err) { setDeptErr(apiError(err, 'Failed')); }
    finally { setBusy(false); }
  };

  const deleteDept = async (dept: DeptRecord) => {
    if (dept._count.members > 0) {
      setError(`Move the ${dept._count.members} member(s) out of "${dept.name}" before deleting it.`);
      return;
    }
    setBusy(true);
    try {
      await apiClient.delete(`/api/iam/departments/${dept.id}`);
      setNotice(`"${dept.name}" deleted`);
      await load();
    } catch (err) { setError(apiError(err, 'Delete failed')); }
    finally { setBusy(false); }
  };

  // ── Move user ─────────────────────────────────────────────────────────────

  const openMove = (user: Member) => {
    setMoveDeptId(user.departmentId || '');
    setMoveErr('');
    setMoveDialog({ user });
  };

  const submitMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveDialog) return;
    setBusy(true); setMoveErr('');
    try {
      await apiClient.post(`/api/iam/users/${moveDialog.user.id}/department`, {
        departmentId: moveDeptId || null,
      });
      setNotice(`${moveDialog.user.name} moved`);
      setMoveDialog(null);
      await load();
    } catch (err) { setMoveErr(apiError(err, 'Move failed')); }
    finally { setBusy(false); }
  };

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Teams &amp; departments</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Departmental structure per entity. Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <Can do={CAP.ADD_USER}>
            <button onClick={openCreate} style={primaryBtn()}>+ Department</button>
          </Can>
        </div>
      </div>

      <StatStrip items={[
        ['Entities', teams.length],
        ['Departments', totalDepts],
        ['People', totalMembers],
        ['Unassigned', <span style={{ color: unassigned > 0 ? 'var(--warning)' : 'var(--ink)' }}>{unassigned}</span>],
      ]} />

      {/* Department records panel */}
      {deptRecords.length > 0 && (
        <div style={{ ...S.card, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>Department records</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {deptRecords.map((d) => (
              <div key={d.id} style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
                <span style={{ color: 'var(--ink-body)' }}>{d.name}</span>
                {d.head && <span style={{ color: 'var(--ink-muted)', marginLeft: 6 }}>head: {d.head.name}</span>}
                <span style={{ color: 'var(--ink-body)', marginLeft: 6 }}>{d._count.members} member{d._count.members !== 1 ? 's' : ''}</span>
                <Can do={CAP.ADD_USER}>
                  <button onClick={() => openEdit(d)} style={{ ...linkBtn('var(--info)'), marginLeft: 8 }}>edit</button>
                  <button onClick={() => deleteDept(d)} style={{ ...linkBtn('var(--danger)'), marginLeft: 4 }}>delete</button>
                </Can>
              </div>
            ))}
          </div>
        </div>
      )}

      <input placeholder="Search a person, email or role across all entities…" value={search}
        onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 380, marginBottom: 14 }} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice} <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading team directory…</div>
      ) : visible.length === 0 ? (
        <div style={{ ...S.card, padding: 40, textAlign: 'center', color: 'var(--ink-muted)', borderStyle: 'dashed' }}>
          {search ? 'Nobody matches that search.' : 'No users in your scope.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {visible.map((t) => {
            const isOpen = !!open[t.tenantId] || !!search;
            return (
              <div key={t.tenantId} style={S.card}>
                <button
                  onClick={() => setOpen((o) => ({ ...o, [t.tenantId]: !o[t.tenantId] }))}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'transparent', border: 'none', padding: '14px 16px', cursor: 'pointer',
                    color: 'var(--ink-body)', fontFamily: 'inherit', fontSize: 14, textAlign: 'left',
                  }}
                >
                  <span>{isOpen ? '▾' : '▸'} {t.tenantName}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                    {t.departments.length} dept · {t.departments.reduce((a, d) => a + d.members.length, 0)} people
                  </span>
                </button>

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--line)', padding: '12px 16px' }}>
                    {t.departments.map((d) => (
                      <div key={d.name} style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 12, color: d.name === 'Unassigned' ? 'var(--warning)' : 'var(--ink-body)' }}>{d.name}</strong>
                          <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{d.members.length}</span>
                          {d.branches.map((b) => (
                            <span key={b} style={pill('var(--info)', 'var(--info-line)')}>{b}</span>
                          ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 8 }}>
                          {d.members.map((m) => (
                            <div key={m.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 12, color: 'var(--ink-body)' }}>{m.name}</span>
                                <span style={STATUS_PILL[m.status] || STATUS_PILL.Inactive}>{m.status}</span>
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3 }}>{m.role}</div>
                              <div style={{ fontSize: 10, color: 'var(--ink-body)' }}>
                                {m.email}{m.mfaEnabled && <span style={{ color: 'var(--success)' }}> · MFA</span>}
                              </div>
                              <Can do={CAP.ADD_USER}>
                                <button onClick={() => openMove(m)} style={{ ...linkBtn('var(--info)'), marginTop: 4, fontSize: 10 }}>
                                  move dept
                                </button>
                              </Can>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / edit department dialog */}
      {deptDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 440, padding: 26, borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 17, color: 'var(--ink)' }}>
              {deptDialog.kind === 'create' ? 'New department' : `Edit "${deptDialog.dept.name}"`}
            </h3>
            {deptErr && <div style={{ ...S.error, marginBottom: 14 }}>{deptErr}</div>}
            <form onSubmit={submitDept}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Department name</label>
              <input required value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                style={{ ...S.input, marginBottom: 14 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Head of department (optional)</label>
              <select value={deptForm.headId} onChange={(e) => setDeptForm({ ...deptForm, headId: e.target.value })}
                style={{ ...S.input, marginBottom: 20 }}>
                <option value="">— none —</option>
                {allUsers.filter((u) => u.status === 'Active').map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </select>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Saving…' : deptDialog.kind === 'create' ? 'Create' : 'Save'}
                </button>
                <button type="button" onClick={() => setDeptDialog(null)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move user to department dialog */}
      {moveDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 420, padding: 26, borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: 'var(--ink)' }}>Move {moveDialog.user.name}</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
              Assign to a department record within this organisation.
            </p>
            {moveErr && <div style={{ ...S.error, marginBottom: 14 }}>{moveErr}</div>}
            <form onSubmit={submitMove}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Department</label>
              <select value={moveDeptId} onChange={(e) => setMoveDeptId(e.target.value)}
                style={{ ...S.input, marginBottom: 20 }}>
                <option value="">— unassigned —</option>
                {deptRecords.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Moving…' : 'Move'}
                </button>
                <button type="button" onClick={() => setMoveDialog(null)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamDirectory;
