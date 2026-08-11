import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/apiClient';

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      await apiClient.post('/api/password-reset/request', {
        email: email.trim().toLowerCase(),
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Unable to submit request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface-sunk)', color: 'var(--ink-body)',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace", padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--surface-sunk)', border: '1px solid var(--line)',
        borderRadius: 12, padding: 32,
      }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Forgot Password</h1>
        <p style={{ color: 'var(--ink-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
          Enter your account email. A platform administrator will review the request
          and issue a one-time reset code, which they will communicate to you directly.
        </p>

        {submitted ? (
          <div style={{
            background: 'var(--success-bg)', border: '1px solid var(--success-line)',
            padding: 16, borderRadius: 8, color: 'var(--success)',
          }}>
            ✓ If the account exists, an administrator will review your reset request shortly.
            <div style={{ marginTop: 16 }}>
              <Link to="/reset-password" style={{ color: 'var(--info)' }}>
                → I already have a reset code
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                background: 'var(--danger-bg)', border: '1px solid var(--danger-line)',
                padding: 12, borderRadius: 6, color: 'var(--danger)', marginBottom: 16, fontSize: 13,
              }}>{error}</div>
            )}
            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Email address</label>
            <input
              type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
                color: 'var(--ink-body)', fontFamily: 'inherit', marginBottom: 20,
              }}
            />
            <button
              type="submit" disabled={submitting}
              style={{
                width: '100%', padding: '12px', border: 'none', borderRadius: 6,
                background: submitting ? 'var(--ink-body)' : 'var(--info)', color: 'white',
                fontFamily: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >
              {submitting ? 'Submitting…' : 'Request Password Reset'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <Link to="/" style={{ color: 'var(--info)' }}>← Back to login</Link>
          {!submitted && (
            <Link to="/reset-password" style={{ color: 'var(--info)' }}>Have a code?</Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
