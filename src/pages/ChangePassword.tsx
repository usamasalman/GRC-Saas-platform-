import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';

const ChangePassword: React.FC = () => {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('grc_user_json') || 'null'); }
    catch { return null; }
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPassword === currentPassword) { setError('New password must differ from your current password.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }

    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/auth/change-password', { currentPassword, newPassword });
      if (res.data?.status === 'success') {
        setSuccess(true);
        // Change-password revokes existing refresh tokens — force a fresh login.
        localStorage.removeItem('grc_jwt_token');
        localStorage.removeItem('grc_refresh_token');
        setTimeout(() => navigate('/'), 2500);
      } else {
        setError(res.data?.message || 'Change failed.');
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message;
      if (status === 401) setError(msg || 'Current password is incorrect.');
      else setError(msg || 'Unable to change password.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', boxSizing: 'border-box',
    background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
    color: 'var(--ink-body)', fontFamily: 'inherit', marginBottom: 14,
  };

  const eyeBtn: React.CSSProperties = {
    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
    background: 'transparent', border: 'none', color: 'var(--ink-muted)',
    cursor: 'pointer', fontSize: 12, padding: '4px 8px',
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface-sunk)', color: 'var(--ink-body)',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace", padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 480, background: 'var(--surface-sunk)', border: '1px solid var(--line)',
        borderRadius: 12, padding: 32,
      }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Change Password</h1>
        {user?.mustChangePassword ? (
          <p style={{ color: 'var(--warning)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
            ⚠ Your administrator reset your password. You must choose a new password before continuing.
          </p>
        ) : (
          <p style={{ color: 'var(--ink-muted)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
            Signed in as <strong style={{ color: 'var(--ink-body)' }}>{user?.email || 'unknown'}</strong>.
            All other sessions will be signed out after you change your password.
          </p>
        )}

        {success ? (
          <div style={{
            background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 16,
            borderRadius: 8, color: 'var(--success)',
          }}>
            ✓ Password changed. Redirecting to login…
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', padding: 12, borderRadius: 6,
                color: 'var(--danger)', marginBottom: 16, fontSize: 13,
              }}>{error}</div>
            )}

            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Current password</label>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input
                type={showCurrent ? 'text' : 'password'} required
                value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0, paddingRight: 60 }}
              />
              <button type="button" onClick={() => setShowCurrent((s) => !s)} style={eyeBtn}>
                {showCurrent ? 'Hide' : 'Show'}
              </button>
            </div>

            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>New password (min 8 chars)</label>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input
                type={showNew ? 'text' : 'password'} required minLength={8}
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0, paddingRight: 60 }}
              />
              <button type="button" onClick={() => setShowNew((s) => !s)} style={eyeBtn}>
                {showNew ? 'Hide' : 'Show'}
              </button>
            </div>

            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Confirm new password</label>
            <input
              type={showNew ? 'text' : 'password'} required minLength={8}
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
            />

            <button
              type="submit" disabled={submitting}
              style={{
                width: '100%', padding: '12px', border: 'none', borderRadius: 6,
                background: submitting ? 'var(--ink-body)' : 'var(--info)', color: 'white',
                fontFamily: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 14,
              }}
            >
              {submitting ? 'Changing…' : 'Change Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ChangePassword;
