import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, pill, STATUS_PILL, apiError } from './iamStyles';

interface Member { id: string; name: string; email: string; role: string; status: string; mfaEnabled: boolean }
interface Department { name: string; memberCount: number; branches: string[]; members: Member[] }
interface TeamTenant { tenantId: string; tenantName: string; departmentCount: number; memberCount: number; departments: Department[] }

const TeamDirectory: React.FC = () => {
  const [teams, setTeams] = useState<TeamTenant[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/api/iam/teams');
      setTeams(res.data?.teams || []);
      setScope(res.data?.scope || '');
      // Expand the largest tenant by default so the page isn't all collapsed.
      const first = (res.data?.teams || [])[0];
      if (first) setOpen({ [first.tenantId]: true });
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
    .filter((t) => t.departments.length > 0);

  const totalDepts = teams.reduce((a, t) => a + t.departmentCount, 0);
  const totalMembers = teams.reduce((a, t) => a + t.memberCount, 0);
  const unassigned = teams.reduce(
    (a, t) => a + (t.departments.find((d) => d.name === 'Unassigned')?.memberCount || 0), 0);

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Teams &amp; departments</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Departmental structure per entity. Scope: <strong style={{ color: '#93c5fd' }}>{scope || '—'}</strong>
          </p>
        </div>
        <button onClick={load} style={ghostBtn}>↻ Refresh</button>
      </div>

      <StatStrip items={[
        ['Entities', teams.length],
        ['Departments', totalDepts],
        ['People', totalMembers],
        ['Unassigned', <span style={{ color: unassigned > 0 ? '#fbbf24' : '#f1f5f9' }}>{unassigned}</span>],
      ]} />

      <input placeholder="Search a person, email or role across all entities…" value={search}
        onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 380, marginBottom: 14 }} />

      {error && <div style={S.error}>{error}</div>}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading team directory…</div>
      ) : visible.length === 0 ? (
        <div style={{ ...S.card, padding: 40, textAlign: 'center', color: '#64748b', borderStyle: 'dashed' }}>
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
                    color: '#e2e8f0', fontFamily: 'inherit', fontSize: 14, textAlign: 'left',
                  }}
                >
                  <span>{isOpen ? '▾' : '▸'} {t.tenantName}</span>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    {t.departments.length} dept · {t.departments.reduce((a, d) => a + d.members.length, 0)} people
                  </span>
                </button>

                {isOpen && (
                  <div style={{ borderTop: '1px solid #1e293b', padding: '12px 16px' }}>
                    {t.departments.map((d) => (
                      <div key={d.name} style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 12, color: d.name === 'Unassigned' ? '#fbbf24' : '#cbd5e1' }}>{d.name}</strong>
                          <span style={{ fontSize: 11, color: '#64748b' }}>{d.members.length}</span>
                          {d.branches.map((b) => (
                            <span key={b} style={pill('#93c5fd', '#1e3a8a')}>{b}</span>
                          ))}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 8 }}>
                          {d.members.map((m) => (
                            <div key={m.id} style={{ background: '#0b1220', border: '1px solid #16202f', borderRadius: 6, padding: '8px 10px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 12, color: '#e2e8f0' }}>{m.name}</span>
                                <span style={STATUS_PILL[m.status] || STATUS_PILL.Inactive}>{m.status}</span>
                              </div>
                              <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{m.role}</div>
                              <div style={{ fontSize: 10, color: '#475569' }}>
                                {m.email}{m.mfaEnabled && <span style={{ color: '#86efac' }}> · MFA</span>}
                              </div>
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
    </div>
  );
};

export default TeamDirectory;
