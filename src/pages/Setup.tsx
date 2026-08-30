import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/apiClient';

/**
 * First-run setup — creates the very first administrator on a fresh install.
 *
 * The server refuses this once any user exists, so this page is only ever
 * usable on an empty database. It checks that on mount and redirects rather
 * than presenting a form that will be rejected.
 */

const MIN_PASSWORD = 12;

const Setup: React.FC = () => {
  const navigate = useNavigate();

  const [checking, setChecking] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [orgName, setOrgName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient
      .get('/api/auth/bootstrap-status')
      .then((res) => {
        if (res.data?.initialised !== false) {
          navigate('/login', { replace: true });
        } else {
          setChecking(false);
        }
      })
      .catch(() => navigate('/login', { replace: true }));
  }, [navigate]);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    name.trim() && email.trim() && password.length >= MIN_PASSWORD && password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !canSubmit) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/auth/register-admin', {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        tenantName: orgName.trim() || undefined,
      });
      const data = res.data;
      if (data?.status === 'success' && data?.token) {
        localStorage.setItem('grc_jwt_token', data.token);
        if (data.refreshToken) localStorage.setItem('grc_refresh_token', data.refreshToken);
        localStorage.setItem('grc_user_json', JSON.stringify(data.user));
        if (data.user?.id) localStorage.setItem('authPersonaId', data.user.id);
        navigate('/app');
      } else {
        setError(data?.message || 'Setup failed.');
      }
    } catch (err: any) {
      const code = err?.response?.data?.code;
      if (code === 'BOOTSTRAP_CLOSED') {
        setError('This platform has already been set up. Sign in instead.');
      } else if (code === 'NOT_PROVISIONED') {
        // Distinct from a validation failure: the database is reachable but the
        // role catalogue has not been loaded, so any account made now would have
        // no capabilities at all.
        setError(
          'Platform roles have not been provisioned yet. Run "npm run provision" '
          + 'on the server, then reload this page.'
        );
      } else {
        setError(err?.response?.data?.message || 'Setup failed. Check the server logs.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="login-page" data-portal="saas">
        <main className="login-main">
          <div className="login-panel"><p>Checking platform status…</p></div>
        </main>
      </div>
    );
  }

  return (
    <div className="login-page" data-portal="saas">
      <section className="login-visual">
        <div className="brand">
          <div className="brand-mark"><span>GW</span></div>
          <div>
            <span className="brand-text">GRC Wisdom</span>
            <span className="brand-sub">First-run setup</span>
          </div>
        </div>
        <h1>Create the first administrator</h1>
        <p>
          This account owns the platform control plane: it creates organisations, issues
          user accounts and assigns roles. It can only be created once — after this, new
          accounts are issued from inside the platform.
        </p>
        <div className="login-capabilities">
          <div className="login-cap">
            <strong>Choose a strong password</strong>
            <span>At least {MIN_PASSWORD} characters. Store it in a password manager.</span>
          </div>
          <div className="login-cap">
            <strong>Turn on two-factor after signing in</strong>
            <span>Settings → Security. This account can reach every tenant.</span>
          </div>
        </div>
      </section>

      <main className="login-main">
        <div className="login-panel">
          <h2>Administrator account</h2>
          <p>These details cannot be recovered if lost — only reset from the server.</p>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className={`login-error ${error ? 'show' : ''}`} role="alert">{error}</div>

            <div className="field">
              <label htmlFor="name">Your full name</label>
              <input id="name" type="text" required value={name}
                     onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>

            <div className="field">
              <label htmlFor="email">Email address</label>
              <input id="email" type="email" required value={email}
                     onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </div>

            <div className="field">
              <label htmlFor="org">Organisation name <span style={{ opacity: 0.6 }}>(optional)</span></label>
              <input id="org" type="text" value={orgName}
                     onChange={(e) => setOrgName(e.target.value)}
                     placeholder="GRC Wisdom Control Plane" />
            </div>

            <div className="field">
              <label htmlFor="pw">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="pw"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  style={{ width: '100%', paddingRight: 68, boxSizing: 'border-box' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', color: 'inherit',
                    cursor: 'pointer', fontSize: '0.85em', padding: '4px 8px',
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {tooShort && (
                <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                  {MIN_PASSWORD - password.length} more character
                  {MIN_PASSWORD - password.length === 1 ? '' : 's'} needed.
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input
                id="confirm"
                type={showPassword ? 'text' : 'password'}
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
              {mismatch && (
                <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                  Passwords do not match.
                </div>
              )}
            </div>

            <button className="login-submit" type="submit" disabled={submitting || !canSubmit}>
              {submitting ? 'Creating account…' : 'Create administrator'}
            </button>

            <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12 }}>
              <Link to="/login" style={{ color: 'var(--info)' }}>Back to sign in</Link>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Setup;
