import React, { useCallback, useEffect, useState } from 'react';
import apiClient, { asOperator } from '../../api/apiClient';

interface Session {
  id: string;
  reason: string;
  ticketRef: string | null;
  requestedDurationMins: number;
  status: string;
  requestedAt: string;
  approvedAt: string | null;
  reviewNote: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  endedAt: string | null;
  endedReason: string | null;
  isLive: boolean;
  minutesRemaining: number | null;
  requestedBy: { id: string; name: string; email: string; role: string };
  subjectUser: { id: string; name: string; email: string; role: string };
  approvedBy: { id: string; name: string; email: string } | null;
  tenant: { id: string; name: string };
}

interface Identity { id: string; name: string; email: string; role: string; context: string | null }

const STATUS_STYLE: Record<string, { bg: string; fg: string; br: string }> = {
  PENDING: { bg: '#3a2d0a', fg: '#fbbf24', br: '#78350f' },
  APPROVED: { bg: '#0b2e4a', fg: '#93c5fd', br: '#1e3a8a' },
  ACTIVE: { bg: '#0e2a1e', fg: '#4ade80', br: '#15803d' },
  COMPLETED: { bg: '#1e293b', fg: '#94a3b8', br: '#334155' },
  DENIED: { bg: '#3f1618', fg: '#fca5a5', br: '#7f1d1d' },
  REVOKED: { bg: '#3f1618', fg: '#fca5a5', br: '#7f1d1d' },
  EXPIRED: { bg: '#1e293b', fg: '#64748b', br: '#334155' },
};

const ImpersonationSessions: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ subjectUserId: '', reason: '', ticketRef: '', durationMins: 30 });
  const [modalErr, setModalErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [sRes, iRes] = await Promise.all([
        apiClient.get('/api/impersonation'),
        apiClient.get('/api/auth/demo-identities').catch(() => null),
      ]);
      setSessions(sRes.data?.sessions || []);
      setIdentities(iRes?.data?.users || []);
      try { setMe(JSON.parse(localStorage.getItem('grc_user_json') || 'null')); } catch { /* ignore */ }
    } catch (err: any) {
      const s = err?.response?.status;
      if (s === 401) setError('Session expired — please sign in again.');
      else if (s === 403) setError(err?.response?.data?.message || 'Not authorized.');
      else setError('Could not reach the API on port 3000.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (path: string, body: any, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(path);
    try {
      // Always act as the real operator — never inside an impersonated identity.
      await apiClient.post(path, body, asOperator());
      await load();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const start = async (s: Session) => {
    if (!window.confirm(`Start a READ-ONLY session as ${s.subjectUser.email}?\n\nAll writes will be blocked. The session expires in ${s.requestedDurationMins} minutes and is logged to ${s.tenant.name}'s audit trail.`)) return;
    setBusy(s.id);
    try {
      const res = await apiClient.post(`/api/impersonation/${s.id}/start`, {}, asOperator());
      localStorage.setItem('grc_imp_token', res.data.impersonationToken);
      localStorage.setItem('grc_imp_meta', JSON.stringify({
        sessionId: s.id,
        subject: res.data.subject,
        expiresAt: res.data.expiresAt,
      }));
      window.location.reload();
    } catch (err: any) {
      window.alert(err?.response?.data?.message || 'Could not start session');
      setBusy(null);
    }
  };

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalErr('');
    setBusy('request');
    try {
      await apiClient.post('/api/impersonation', {
        subjectUserId: form.subjectUserId,
        reason: form.reason,
        ticketRef: form.ticketRef || undefined,
        durationMins: Number(form.durationMins),
      }, asOperator());
      setShowModal(false);
      setForm({ subjectUserId: '', reason: '', ticketRef: '', durationMins: 30 });
      await load();
    } catch (err: any) {
      setModalErr(err?.response?.data?.message || 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  // Only users outside the operator's own tenant are valid subjects.
  const candidates = identities.filter((u) => u.context && u.context !== me?.context);

  const card: React.CSSProperties = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 11px', boxSizing: 'border-box', background: '#0b1220',
    border: '1px solid #1e293b', borderRadius: 6, color: '#e2e8f0', fontFamily: 'inherit', fontSize: 13,
  };
  const smBtn = (fg: string): React.CSSProperties => ({
    background: 'transparent', color: fg, border: 'none', padding: '4px 8px',
    borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
  });

  const live = sessions.filter((s) => s.isLive).length;
  const pending = sessions.filter((s) => s.status === 'PENDING').length;

  return (
    <div style={{ padding: 24, color: '#cbd5e1', fontFamily: "'JetBrains Mono','Fira Code',monospace" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Impersonation sessions</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Read-only, customer-authorized, time-boxed support access.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={{ ...smBtn('#94a3b8'), border: '1px solid #334155', padding: '8px 14px', fontSize: 13 }}>↻ Refresh</button>
          <button onClick={() => { setModalErr(''); setShowModal(true); }}
            style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
            + Request session
          </button>
        </div>
      </div>

      <div style={{ background: '#2a1215', border: '1px solid #7f1d1d', borderRadius: 8, padding: '12px 14px', marginBottom: 18, fontSize: 12, color: '#fca5a5', lineHeight: 1.6 }}>
        <strong style={{ color: '#fecaca' }}>No routine customer-data access.</strong>{' '}
        Every session requires a reason, an administrator's approval inside the target tenant, and expires automatically.
        Writes are rejected server-side — e-signatures and approvals can never be performed while impersonating.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 18 }}>
        {[['Total', sessions.length], ['Live now', live], ['Awaiting approval', pending]].map(([l, v]) => (
          <div key={String(l)} style={{ ...card, padding: 14 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 22, color: Number(v) > 0 && l !== 'Total' ? '#fbbf24' : '#f1f5f9' }}>{v}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ background: '#3f1618', border: '1px solid #7f1d1d', padding: 12, borderRadius: 6, color: '#fca5a5', marginBottom: 14, fontSize: 13 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: '#64748b', borderStyle: 'dashed' }}>
          No impersonation sessions have ever been requested.
        </div>
      ) : (
        <div style={{ ...card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#0b1220', color: '#64748b' }}>
                {['Tenant', 'Subject user', 'Requested by', 'Reason / ticket', 'Approved by', 'Status', 'Window', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 400, borderBottom: '1px solid #1e293b', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const st = STATUS_STYLE[s.status] || STATUS_STYLE.COMPLETED;
                const iAmInTargetTenant = me?.tenantId === s.tenant.id;
                const iAmRequester = me?.id === s.requestedBy.id;
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #16202f', background: s.isLive ? '#0d1f18' : 'transparent' }}>
                    <td style={{ padding: '10px 12px', color: '#e2e8f0' }}>{s.tenant.name}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ color: '#e2e8f0' }}>{s.subjectUser.name}</div>
                      <div style={{ color: '#475569', fontSize: 11 }}>{s.subjectUser.role}</div>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#94a3b8' }}>{s.requestedBy.name}</td>
                    <td style={{ padding: '10px 12px', maxWidth: 240 }}>
                      <div style={{ color: '#cbd5e1' }}>{s.reason}</div>
                      {s.ticketRef && <div style={{ color: '#60a5fa', fontSize: 11 }}>{s.ticketRef}</div>}
                    </td>
                    <td style={{ padding: '10px 12px', color: s.approvedBy ? '#86efac' : '#475569' }}>
                      {s.approvedBy?.name || '—'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: st.bg, color: st.fg, border: `1px solid ${st.br}`, whiteSpace: 'nowrap' }}>
                        {s.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {s.isLive
                        ? <span style={{ color: '#4ade80' }}>{s.minutesRemaining}m left</span>
                        : `${s.requestedDurationMins}m`}
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      {s.status === 'PENDING' && iAmInTargetTenant && (
                        <>
                          <button disabled={busy !== null} onClick={() => act(`/api/impersonation/${s.id}/approve`, { note: window.prompt('Approval note (audit evidence):') || '' })} style={smBtn('#4ade80')}>approve</button>
                          <button disabled={busy !== null} onClick={() => {
                            const n = window.prompt('Reason for denial (required):');
                            if (n) act(`/api/impersonation/${s.id}/deny`, { note: n });
                          }} style={smBtn('#fca5a5')}>deny</button>
                        </>
                      )}
                      {s.status === 'PENDING' && !iAmInTargetTenant && (
                        <span style={{ color: '#475569', fontSize: 11 }}>awaiting customer</span>
                      )}
                      {s.status === 'APPROVED' && iAmRequester && (
                        <button disabled={busy !== null} onClick={() => start(s)} style={{ ...smBtn('#93c5fd'), border: '1px solid #1e3a8a' }}>▸ start</button>
                      )}
                      {s.isLive && (iAmRequester || iAmInTargetTenant) && (
                        <button disabled={busy !== null}
                          onClick={() => act(`/api/impersonation/${s.id}/end`, { reason: window.prompt('Reason for ending:') || '' },
                            iAmInTargetTenant && !iAmRequester ? 'Revoke this active session immediately?' : undefined)}
                          style={smBtn('#fbbf24')}>
                          {iAmInTargetTenant && !iAmRequester ? 'revoke' : 'end'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...card, width: '100%', maxWidth: 480, padding: 26, borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: '#f1f5f9' }}>Request impersonation session</h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              An administrator inside the target tenant must approve before you can start.
            </p>
            {modalErr && (
              <div style={{ background: '#3f1618', border: '1px solid #7f1d1d', padding: 10, borderRadius: 6, color: '#fca5a5', marginBottom: 14, fontSize: 12 }}>{modalErr}</div>
            )}
            <form onSubmit={submitRequest}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Subject user (customer tenants only)</label>
              <select required value={form.subjectUserId} onChange={(e) => setForm({ ...form, subjectUserId: e.target.value })} style={{ ...inputStyle, marginBottom: 14 }}>
                <option value="">— select a user —</option>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>{u.context} · {u.name} ({u.role})</option>
                ))}
              </select>

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Reason (min 10 chars — customer-visible)</label>
              <textarea required minLength={10} rows={3} value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Reproduce Word export timeout on the consolidated board pack"
                style={{ ...inputStyle, marginBottom: 14, resize: 'vertical' }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Ticket reference (optional)</label>
              <input value={form.ticketRef} onChange={(e) => setForm({ ...form, ticketRef: e.target.value })}
                placeholder="INC-2026-0142" style={{ ...inputStyle, marginBottom: 14 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Duration (5–120 minutes)</label>
              <input type="number" min={5} max={120} value={form.durationMins}
                onChange={(e) => setForm({ ...form, durationMins: Number(e.target.value) })}
                style={{ ...inputStyle, marginBottom: 20 }} />

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy === 'request'}
                  style={{ flex: 1, background: busy === 'request' ? '#334155' : '#2563eb', color: '#fff', border: 'none', padding: 11, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
                  {busy === 'request' ? 'Submitting…' : 'Submit request'}
                </button>
                <button type="button" onClick={() => setShowModal(false)}
                  style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', padding: 11, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImpersonationSessions;
