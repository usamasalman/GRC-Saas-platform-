import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/apiClient';

/**
 * The sign-in screen.
 *
 * This replaces the eight-portal demo directory. There is one way in; which
 * workspace you land in is decided by your account's tenant, server-side, not
 * by which tile you clicked.
 *
 * Nothing on this page enumerates users. The previous version fetched
 * /api/auth/demo-identities — a public endpoint that returned every active user
 * on the platform across every tenant — rendered them as a pick-list, and
 * pre-filled a shared password. Both the endpoint and the list are gone.
 */

const Login: React.FC = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);

  // On a brand-new deployment there is no account to sign in with, so point the
  // operator at first-run setup instead of leaving them at a form that cannot
  // succeed.
  useEffect(() => {
    apiClient
      .get('/api/auth/bootstrap-status')
      .then((res) => setNeedsSetup(res.data?.initialised === false))
      .catch(() => setNeedsSetup(false));
  }, []);

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
        // Deliberately the same message whether the address is unknown or the
        // password is wrong — anything else is a user-enumeration oracle.
        setError('Email or password is incorrect.');
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

  return (
    <div className="login-page" data-portal="saas">
      <section className="login-visual">
        <div className="brand">
          <div className="brand-mark"><span>GW</span></div>
          <div>
            <span className="brand-text">GRC Wisdom</span>
            <span className="brand-sub">Governance, risk and compliance operations</span>
          </div>
        </div>
        <h1>Sign in to your workspace</h1>
        <p>
          Risk registers, control libraries, internal audit engagements and the asset
          inventory that ties them together — in one place, with an evidence trail behind
          every change.
        </p>
        <div className="login-capabilities">
          <div className="login-cap">
            <strong>Risk &amp; controls</strong>
            <span>Inherent and residual scoring, treatment plans, appetite thresholds</span>
          </div>
          <div className="login-cap">
            <strong>Internal audit</strong>
            <span>Risk-based planning, fieldwork, findings and corrective actions</span>
          </div>
          <div className="login-cap">
            <strong>Assets &amp; suppliers</strong>
            <span>Classified inventory with the risks each asset carries</span>
          </div>
          <div className="login-cap">
            <strong>Accountability</strong>
            <span>Segregation of duties and a tamper-evident audit log</span>
          </div>
        </div>
      </section>

      <main className="login-main">
        <div className="login-panel">
          <h2>Sign in</h2>
          <p>Use the account your administrator issued you.</p>

          {needsSetup && (
            <div
              className="notice"
              style={{
                marginBottom: 16, padding: '12px 14px',
                border: '1px solid var(--info)', borderRadius: 8,
                background: 'color-mix(in srgb, var(--info) 12%, transparent)',
              }}
            >
              <strong style={{ display: 'block', marginBottom: 4 }}>
                This platform has not been set up yet.
              </strong>
              <Link to="/setup" style={{ color: 'var(--info)' }}>
                Create the first administrator account →
              </Link>
            </div>
          )}

          <form className="login-form" onSubmit={handleLogin}>
            <div className={`login-error ${error ? 'show' : ''}`} role="alert">{error}</div>

            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', paddingRight: 68, boxSizing: 'border-box' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: 8, top: '50%',
                    transform: 'translateY(-50%)', background: 'transparent',
                    border: 'none', color: 'inherit', cursor: 'pointer',
                    fontSize: '0.85em', padding: '4px 8px',
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button className="login-submit" type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12 }}>
              <Link to="/forgot-password" style={{ color: 'var(--info)' }}>Forgot password?</Link>
              <span style={{ margin: '0 8px', color: 'var(--ink-body)' }}>·</span>
              <Link to="/reset-password" style={{ color: 'var(--info)' }}>I have a reset code</Link>
            </div>
          </form>

          {mfaToken && (
            <div
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
              }}
              role="dialog"
              aria-modal="true"
              aria-label="Two-factor authentication"
            >
              <div style={{
                background: 'var(--surface-sunk)', border: '1px solid var(--line)',
                borderRadius: 12, padding: 32, width: '100%', maxWidth: 400,
                color: 'var(--ink-body)',
              }}>
                <h2 style={{ fontSize: 18, marginBottom: 8 }}>Two-factor authentication</h2>
                <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 20, lineHeight: 1.5 }}>
                  Enter the 6-digit code from your authenticator app.
                </p>
                <form onSubmit={handleMfaSubmit}>
                  <div className={`login-error ${error ? 'show' : ''}`} role="alert">{error}</div>
                  <input
                    autoFocus
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                    aria-label="Authentication code"
                    style={{
                      width: '100%', padding: '12px 14px', fontSize: 22,
                      letterSpacing: '0.35em', textAlign: 'center',
                      fontVariantNumeric: 'tabular-nums',
                      background: 'var(--surface)', color: 'var(--ink)',
                      border: '1px solid var(--line)', borderRadius: 8,
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    className="login-submit"
                    type="submit"
                    disabled={submitting || mfaCode.length < 6}
                    style={{ marginTop: 16 }}
                  >
                    {submitting ? 'Verifying…' : 'Verify'}
                  </button>
                </form>
                <button
                  type="button"
                  onClick={() => { setMfaToken(null); setMfaCode(''); setError(''); }}
                  style={{
                    marginTop: 12, width: '100%', background: 'transparent',
                    border: 'none', color: 'var(--ink-muted)', cursor: 'pointer', fontSize: 12,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Login;
