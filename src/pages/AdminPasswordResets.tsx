import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/apiClient';

interface ResetRequest {
  id: string;
  requestedAt: string;
  requestedIp?: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'USED' | 'EXPIRED';
  reviewedAt?: string | null;
  reviewNote?: string | null;
  resetCodeExpiresAt?: string | null;
  user: { id: string; email: string; name: string; role: string; tenantId: string };
}

const STATUS_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  PENDING:  { bg: 'var(--warning-bg)', fg: 'var(--warning)', border: 'var(--warning-line)' },
  APPROVED: { bg: 'var(--success-bg)', fg: 'var(--success)', border: 'var(--success-line)' },
  USED:     { bg: 'var(--surface-sunk)', fg: 'var(--info)', border: 'var(--info-line)' },
  DENIED:   { bg: 'var(--danger-bg)', fg: 'var(--danger)', border: 'var(--danger-line)' },
  EXPIRED:  { bg: 'var(--surface-sunk)', fg: 'var(--ink-muted)', border: 'var(--line)' },
};

const AdminPasswordResets: React.FC = () => {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issuedCode, setIssuedCode] = useState<{ id: string; code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/password-reset/admin');
      setRequests(res.data?.requests || []);
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message;
      if (status === 401) setError('Please log in as a platform admin.');
      else if (status === 403) setError(msg || 'Platform admin role required.');
      else setError(msg || 'Failed to load requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => {
    const note = window.prompt('Optional note for the audit trail (e.g. "verified by phone"):') || '';
    setBusy(id);
    try {
      const res = await apiClient.post(`/api/password-reset/admin/${id}/approve`, { note });
      setIssuedCode({ id, code: res.data.resetCode, expiresAt: res.data.expiresAt });
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Approve failed');
    } finally { setBusy(null); }
  };

  const deny = async (id: string) => {
    const note = window.prompt('Reason for denial (recorded in audit log):') || '';
    if (!note) return;
    setBusy(id);
    try {
      await apiClient.post(`/api/password-reset/admin/${id}/deny`, { note });
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.message || 'Deny failed');
    } finally { setBusy(null); }
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--surface-sunk)', color: 'var(--ink-body)',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace", padding: 24,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        borderBottom: '1px solid var(--line)', paddingBottom: 16, marginBottom: 24,
      }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>Password Reset Requests</h1>
          <p style={{ color: 'var(--ink-muted)', fontSize: 13, margin: '4px 0 0' }}>
            Verify the requester out-of-band before approving. The reset code is shown once.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={load}
            style={{
              padding: '8px 14px', background: 'transparent', color: 'var(--ink-muted)',
              border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13,
            }}
          >↻ Refresh</button>
          <Link to="/db-console" style={{
            padding: '8px 14px', background: 'var(--surface-sunk)', color: 'var(--ink-body)',
            borderRadius: 6, textDecoration: 'none', fontSize: 13,
          }}>← Back to console</Link>
        </div>
      </div>

      {issuedCode && (
        <div style={{
          background: 'var(--success-bg)', border: '1px solid var(--success-line)', borderRadius: 8,
          padding: 20, marginBottom: 20,
        }}>
          <div style={{ color: 'var(--success)', fontSize: 14, marginBottom: 12 }}>
            ✓ Approved. Communicate this code to the user out-of-band (phone, in-person).
            It will not be shown again. Expires: {new Date(issuedCode.expiresAt).toLocaleString()}
          </div>
          <div style={{
            fontSize: 32, letterSpacing: '0.3em', textAlign: 'center', color: 'var(--ink)',
            background: 'var(--surface-sunk)', padding: 20, borderRadius: 6, fontWeight: 700,
          }}>
            {issuedCode.code}
          </div>
          <button
            onClick={() => setIssuedCode(null)}
            style={{
              marginTop: 12, background: 'transparent', border: '1px solid var(--success-line)',
              color: 'var(--success)', padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12,
            }}
          >I have delivered the code — dismiss</button>
        </div>
      )}

      {error && (
        <div style={{
          background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', padding: 12,
          borderRadius: 6, color: 'var(--danger)', marginBottom: 16, fontSize: 13,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)' }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{ color: 'var(--ink-muted)', padding: 40, textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 8 }}>
          No reset requests yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {requests.map((r) => {
            const color = STATUS_COLORS[r.status] || STATUS_COLORS.PENDING;
            return (
              <div key={r.id} style={{
                background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 8, padding: 16,
                display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center',
              }}>
                <div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
                    <strong style={{ color: 'var(--ink-body)' }}>{r.user.name}</strong>
                    <span style={{ color: 'var(--ink-muted)', fontSize: 13 }}>{r.user.email}</span>
                    <span style={{
                      background: color.bg, color: color.fg, border: `1px solid ${color.border}`,
                      padding: '2px 8px', borderRadius: 4, fontSize: 11,
                    }}>{r.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                    Role: {r.user.role} · Requested {new Date(r.requestedAt).toLocaleString()}
                    {r.requestedIp && ` · from ${r.requestedIp}`}
                  </div>
                  {r.reviewedAt && (
                    <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                      Reviewed {new Date(r.reviewedAt).toLocaleString()}
                      {r.reviewNote && ` — "${r.reviewNote}"`}
                    </div>
                  )}
                </div>
                {r.status === 'PENDING' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => approve(r.id)}
                      disabled={busy === r.id}
                      style={{
                        background: 'var(--success-bg)', color: 'var(--success)', border: 'none',
                        padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: 13,
                      }}
                    >✓ Approve</button>
                    <button
                      onClick={() => deny(r.id)}
                      disabled={busy === r.id}
                      style={{
                        background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger-line)',
                        padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
                        fontFamily: 'inherit', fontSize: 13,
                      }}
                    >✗ Deny</button>
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

export default AdminPasswordResets;
