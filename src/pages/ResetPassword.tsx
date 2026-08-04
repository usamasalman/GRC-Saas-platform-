import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/password-reset/complete', {
        email: email.trim().toLowerCase(),
        code: code.trim().toUpperCase(),
        newPassword,
      });
      if (res.data?.status === 'success') {
        setSuccess(true);
        setTimeout(() => navigate('/'), 2500);
      } else {
        setError(res.data?.message || 'Reset failed.');
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message;
      if (status === 401) setError(msg || 'Invalid or expired reset code.');
      else setError(msg || 'Unable to reset password.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', boxSizing: 'border-box',
    background: '#0b1220', border: '1px solid #1e293b', borderRadius: 6,
    color: '#e2e8f0', fontFamily: 'inherit', marginBottom: 14,
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#090d16', color: '#cbd5e1',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace", padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 480, background: '#0f172a', border: '1px solid #1e293b',
        borderRadius: 12, padding: 32,
      }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Reset Password</h1>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
          Enter your email, the one-time code your administrator gave you,
          and choose a new password (min 8 characters).
        </p>

        {success ? (
          <div style={{
            background: '#0e2a1e', border: '1px solid #14532d', padding: 16,
            borderRadius: 8, color: '#86efac',
          }}>
            ✓ Password reset. Redirecting to login…
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                background: '#3f1618', border: '1px solid #7f1d1d', padding: 12, borderRadius: 6,
                color: '#fca5a5', marginBottom: 16, fontSize: 13,
              }}>{error}</div>
            )}
            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Email address</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />

            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Reset code (8 characters)</label>
            <input
              type="text" required value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              style={{ ...inputStyle, letterSpacing: '0.2em', fontSize: 16, textAlign: 'center' }}
            />

            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>New password</label>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <input
                type={showPassword ? 'text' : 'password'} required minLength={8}
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                style={{ ...inputStyle, marginBottom: 0, paddingRight: 60 }}
              />
              <button
                type="button" onClick={() => setShowPassword((s) => !s)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', color: '#94a3b8',
                  cursor: 'pointer', fontSize: 12, padding: '4px 8px',
                }}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Confirm new password</label>
            <input
              type={showPassword ? 'text' : 'password'} required minLength={8}
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
            />

            <button
              type="submit" disabled={submitting}
              style={{
                width: '100%', padding: '12px', border: 'none', borderRadius: 6,
                background: submitting ? '#334155' : '#2563eb', color: 'white',
                fontFamily: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 14,
              }}
            >
              {submitting ? 'Resetting…' : 'Reset Password'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13 }}>
          <Link to="/" style={{ color: '#93c5fd' }}>← Back to login</Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
