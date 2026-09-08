import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';

/**
 * The platform operator's entrance.
 *
 * Reachable only by typing the address. Nothing links here: not the customer
 * sign-in page, not the marketing copy, not the app shell. That is the point of
 * it — "the platform admin of this saas have separate login but with hide from
 * the other in the platform". Adding a convenience link from /login would undo
 * the whole feature, so if you are tempted, don't.
 *
 * Deliberately plain. The customer page sells the product with a feature list
 * and a brand panel; this one is a form. An operator does not need persuading,
 * and a page that looks like an internal tool is a page nobody screenshots for
 * a marketing deck.
 *
 * The separation is not a security boundary and is not presented as one. The
 * URL is not a secret in any real sense, the server refuses non-operator
 * accounts here, and every route behind it checks capabilities regardless of
 * which page issued the token. What this fixes is confusion: two audiences with
 * different jobs were sharing one door.
 */

const PlatformLogin: React.FC = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  function completeSignIn(data: any) {
    localStorage.setItem('grc_jwt_token', data.token);
    if (data.refreshToken) localStorage.setItem('grc_refresh_token', data.refreshToken);
    localStorage.setItem('grc_user_json', JSON.stringify(data.user));
    if (data.user?.id) localStorage.setItem('authPersonaId', data.user.id);
    navigate(data.user?.mustChangePassword ? '/change-password' : '/app');
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/auth/login', {
        email: email.trim().toLowerCase(),
        password,
        entrance: 'platform',
      });
      const data = res.data;
      if (data?.status === 'success' && data?.token) {
        completeSignIn(data);
      } else if (data?.status === 'mfa_required') {
        setMfaToken(data.mfaToken);
      } else {
        setError(data?.message || 'Sign-in failed.');
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.message;
      if (status === 401) {
        setError('Email or password is incorrect.');
      } else if (status === 403) {
        // A customer who guessed the address gets told this is not their door,
        // and no more. There is nothing here to enumerate: they had to supply a
        // valid password to see this at all.
        setError(serverMsg || 'This account does not sign in here.');
      } else if (status === 429) {
        setError(serverMsg || 'Too many attempts. Try again in a few minutes.');
      } else if (status === 400) {
        setError(serverMsg || 'Enter both your email address and password.');
      } else {
        setError('Cannot reach the sign-in service. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/auth/mfa/challenge', {
        mfaToken,
        token: mfaCode.trim(),
      });
      if (res.data?.status === 'success' && res.data?.token) {
        completeSignIn(res.data);
      } else {
        setError(res.data?.message || 'Verification failed.');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'That code was not accepted. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const wrap: React.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: 24,
  };
  const card: React.CSSProperties = {
    width: '100%',
    maxWidth: 380,
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-lg, 10px)',
    padding: 28,
  };
  const label: React.CSSProperties = {
    display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 5,
  };
  const input: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    color: 'var(--ink)',
    background: 'var(--field)',
    border: '1px solid var(--field-line)',
    borderRadius: 'var(--radius-sm, 6px)',
    marginBottom: 14,
    boxSizing: 'border-box',
  };
  const button: React.CSSProperties = {
    width: '100%',
    padding: '11px 14px',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--on-dark, #fff)',
    background: submitting ? 'var(--ink-faint)' : 'var(--navy, #14243c)',
    border: 'none',
    borderRadius: 'var(--radius-sm, 6px)',
    cursor: submitting ? 'default' : 'pointer',
  };

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ marginBottom: 22 }}>
          <div style={{
            fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--ink-faint)', fontWeight: 600, marginBottom: 6,
          }}>
            Control plane
          </div>
          <h1 style={{ margin: 0, fontSize: 19, color: 'var(--ink)' }}>Platform operator sign-in</h1>
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.6 }}>
            For staff who run the platform itself — tenants, subscriptions, module publishing and
            system health. Customer accounts sign in at the main login page.
          </p>
        </div>

        {error && (
          <div style={{
            background: 'var(--danger-bg)', border: '1px solid var(--danger-line)',
            color: 'var(--danger)', borderRadius: 6, padding: '10px 12px',
            fontSize: 12.5, marginBottom: 16, lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        {mfaToken ? (
          <form onSubmit={handleMfaSubmit}>
            <label style={label} htmlFor="platform-mfa">Authenticator code</label>
            <input
              id="platform-mfa"
              style={{ ...input, letterSpacing: '0.3em', fontFamily: 'ui-monospace, monospace' }}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
            />
            <button type="submit" style={button} disabled={submitting}>
              {submitting ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin}>
            <label style={label} htmlFor="platform-email">Work email</label>
            <input
              id="platform-email"
              type="email"
              style={input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />

            <label style={label} htmlFor="platform-password">Password</label>
            <input
              id="platform-password"
              type={showPassword ? 'text' : 'password'}
              style={{ ...input, marginBottom: 6 }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <label style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5,
              color: 'var(--ink-muted)', marginBottom: 18, cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
              />
              Show password
            </label>

            <button type="submit" style={button} disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default PlatformLogin;
