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
      background: '#090d16', color: '#cbd5e1',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace", padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 480,
        background: '#0f172a', border: '1px solid #1e293b',
        borderRadius: 12, padding: 32,
      }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Forgot Password</h1>
        <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
          Enter your account email. A platform administrator will review the request
          and issue a one-time reset code, which they will communicate to you directly.
        </p>

        {submitted ? (
          <div style={{
            background: '#0e2a1e', border: '1px solid #14532d',
            padding: 16, borderRadius: 8, color: '#86efac',
          }}>
            ✓ If the account exists, an administrator will review your reset request shortly.
            <div style={{ marginTop: 16 }}>
              <Link to="/reset-password" style={{ color: '#93c5fd' }}>
                → I already have a reset code
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div style={{
                background: '#3f1618', border: '1px solid #7f1d1d',
                padding: 12, borderRadius: 6, color: '#fca5a5', marginBottom: 16, fontSize: 13,
              }}>{error}</div>
            )}
            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Email address</label>
            <input
              type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                background: '#0b1220', border: '1px solid #1e293b', borderRadius: 6,
                color: '#e2e8f0', fontFamily: 'inherit', marginBottom: 20,
              }}
            />
            <button
              type="submit" disabled={submitting}
              style={{
                width: '100%', padding: '12px', border: 'none', borderRadius: 6,
                background: submitting ? '#334155' : '#2563eb', color: 'white',
                fontFamily: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >
              {submitting ? 'Submitting…' : 'Request Password Reset'}
            </button>
          </form>
        )}

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <Link to="/" style={{ color: '#93c5fd' }}>← Back to login</Link>
          {!submitted && (
            <Link to="/reset-password" style={{ color: '#93c5fd' }}>Have a code?</Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
