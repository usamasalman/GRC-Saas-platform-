import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import apiClient from '../api/apiClient';

const PORTAL_CONFIGS: Record<string, any> = {
  saas: {
    title: 'SaaS Administration Login',
    headline: 'Operate the GRC Wisdom platform with controlled privilege.',
    desc: 'Separate platform owner, security and billing personas demonstrate least privilege, break-glass access and commercial segregation.',
    caps: [
      ['Tenant control plane', 'Organizations, subscriptions and user lifecycle'],
      ['Commercial governance', 'Plans, rate cards, invoices and quotas'],
      ['Platform trust', 'Security, audit logs, uptime and support'],
      ['Product governance', 'GRC modules and tested open-source marketplace'],
      ['Service management', 'ITSM queues, SLAs, knowledge and customer support'],
      ['Security services', 'Wisdom Eye ASM and Eye Phish operations']
    ]
  },
  holding: {
    title: 'Holding / Group Login',
    headline: 'Govern subsidiaries without weakening entity isolation.',
    desc: 'Group and regional administrators receive different dashboards, entity scopes and inherited governance rights.',
    caps: [
      ['Five-level hierarchy', 'Holding, subsidiary, BU, branch, department'],
      ['Group assurance', 'Consolidated risks, audits and reports'],
      ['Shared governance', 'Parent controls, policies and services'],
      ['Regional access', 'Selected entities with no peer-region visibility'],
      ['People & ITSM', 'Group teams, users, transfers and service desk'],
      ['Security services', 'Central Wisdom Eye and Eye Phish execution']
    ]
  },
  multibranch: {
    title: 'Multi-Branch Organization Login',
    headline: 'Central governance with branch-level execution.',
    desc: 'Organization administrators manage branches, standards, users and consolidated GRC performance.',
    caps: [
      ['Corporate dashboard', 'Branch scorecards and overdue actions'],
      ['Branch lifecycle', 'Provisioning, suspension and access'],
      ['Central standards', 'Inherited controls and local exceptions'],
      ['Consolidated reporting', 'Risk, audit, vendor and document views'],
      ['User lifecycle', 'Departments, roles and branch transfers'],
      ['Service portfolio', 'ITSM, billing, marketplace and security services']
    ]
  },
  branch: {
    title: 'Branch Operations Login',
    headline: 'Execute GRC work within a restricted local scope.',
    desc: 'Branch administrators manage local users, evidence, risks, assets, vendors, audits and documents without peer-branch access.',
    caps: [
      ['Local GRC workspace', 'Controls, implementations and evidence'],
      ['Branch assurance', 'Audits, findings and corrective actions'],
      ['Local inventory', 'Assets, applications and vendors'],
      ['Corporate oversight', 'Inherited standards and required policies'],
      ['Branch support', 'ITSM tickets and knowledge access'],
      ['Local services', 'Wisdom Eye findings, Eye Phish and tool entitlements']
    ]
  },
  document: {
    title: 'Document Governance Login',
    headline: 'Test the complete enterprise document lifecycle.',
    desc: 'Switch between document owner, compliance approver and staff employee to experience authoring, versioning, approval, publication and acknowledgement.',
    caps: [
      ['Controlled authoring', 'Manual multi-section creation and batch import'],
      ['Version governance', 'Check-out, check-in, diff and restore'],
      ['Digital approval', 'Sequential e-signature and SHA-256 evidence'],
      ['Records lifecycle', 'Acknowledgement, retention and legal hold'],
      ['Operational support', 'Document ITSM and governance team access']
    ]
  },
  auditor: {
    title: 'External Auditor Login',
    headline: 'Inspect assurance evidence without edit rights.',
    desc: 'A time-limited external auditor can review approved documents, signatures, hashes and immutable activity logs.',
    caps: [
      ['Read-only access', 'Selected engagement scope only'],
      ['Evidence verification', 'Document versions and signatures'],
      ['Audit log export', 'Immutable events and hash checks'],
      ['Session governance', 'Time-limited and fully logged'],
      ['Auditor support', 'Engagement contacts and scoped ITSM tickets']
    ]
  },
  partner: {
    title: 'Consulting Partner / MSP Login',
    headline: 'Manage isolated client workspaces from one portfolio.',
    desc: 'Partner owners and engagement managers receive portfolio analytics, private content, workload and workspace transfer views.',
    caps: [
      ['Client isolation', 'No cross-client data leakage'],
      ['Portfolio delivery', 'Engagements, milestones and health'],
      ['Private IP library', 'Reusable partner standards and templates'],
      ['Commercial control', 'Wholesale pricing and transfer workflow'],
      ['Customer operations', 'Pre-sales, post-sales, ITSM and team management'],
      ['Security services', 'Wisdom Eye and Eye Phish managed offerings']
    ]
  },
  franchise: {
    title: 'Franchise Governance Login',
    headline: 'Standardize the network while preserving franchisee separation.',
    desc: 'Franchisor and franchisee administrators demonstrate mandatory controls, local exceptions, scorecards and isolated location operations.',
    caps: [
      ['Network governance', 'Region, franchisee and location hierarchy'],
      ['Mandatory baseline', 'Franchisor controls and policies'],
      ['Local flexibility', 'Controlled exception workflows'],
      ['Scorecards', 'Ranking, alerts and remediation'],
      ['Network operations', 'Users, teams, service desk and billing'],
      ['Security services', 'Central ASM and phishing campaigns']
    ]
  }
};

const PortalLogin = () => {
  const { portalId } = useParams<{ portalId: string }>();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<any[]>([]);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const config = portalId ? PORTAL_CONFIGS[portalId] : null;

  useEffect(() => {
    if (!config) {
      navigate('/');
      return;
    }
    // Use the dedicated public endpoint — no hashes exposed.
    apiClient
      .get('/api/auth/demo-identities')
      .then((res) => {
        const users = res.data?.users || [];
        const forPortal = users
          .map((u: any) => ({ ...u, portal: portalFromContext(u.context, u.email) }))
          .filter((u: any) => u.portal === portalId);
        setDemoAccounts(forPortal);
        if (forPortal.length > 0) handleSelectAccount(forPortal[0]);
      })
      .catch(() => setDemoAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalId]);

  const handleSelectAccount = (acc: any) => {
    setSelectedAccount(acc);
    setEmail(acc.email);
    // Never show the stored hash — leave the field empty so the user must type,
    // or seed with the default demo password for convenience.
    setPassword('Demo@2026');
    setError('');
  };

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
        // Backend issued a short-lived MFA challenge token. Prompt for TOTP code.
        setMfaToken(data.mfaToken);
      } else {
        setError(data?.message || 'Login failed');
      }
    } catch (err: any) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.message;
      if (status === 401) {
        setError(serverMsg || 'Email or password is incorrect. Please try again.');
      } else if (status === 400) {
        setError(serverMsg || 'Please provide both email and password.');
      } else {
        setError('Unable to reach the login service. Is the API running on port 3000?');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Shared success handler for both the direct login path and the MFA challenge path.
  function completeSignIn(data: any) {
    localStorage.setItem('grc_jwt_token', data.token);
    if (data.refreshToken) localStorage.setItem('grc_refresh_token', data.refreshToken);
    localStorage.setItem('grc_user_json', JSON.stringify(data.user));
    if (data.user?.id) localStorage.setItem('authPersonaId', data.user.id);
    if (data.user?.mustChangePassword) {
      navigate('/change-password');
    } else {
      navigate('/app');
    }
  }

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
        setError(res.data?.message || 'MFA verification failed');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Invalid MFA code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Same portal-mapping the backend uses in authController.portalFor().
  function portalFromContext(context: string | null, email: string): string {
    if (context === 'GRC Wisdom SaaS Control Plane') return 'saas';
    if (context === 'Al Noor Holding Group') return 'holding';
    if (context === 'OmniOps') return 'multibranch';
    if (context === 'Hayat National Hospital — Madinah') return 'branch';
    if (context === 'Global Bank — Information Security') return 'document';
    if (context === 'GRC Consulting Partners') return 'partner';
    if (context === 'RetailCo Franchise Network') return 'franchise';
    if (email === 'marcus.thorne@auditco.com') return 'auditor';
    return 'saas';
  }

  const accounts = demoAccounts;

  if (!config) return null;

  return (
    <div className="login-page" data-portal={portalId}>
      <section className="login-visual">
        <div className="brand">
          <div className="brand-mark">
            <span>GW</span>
          </div>
          <div>
            <span className="brand-text">GRC Wisdom</span>
            <span className="brand-sub">Platform owner, security and billing control plane.</span>
          </div>
        </div>
        <h1>{config.headline}</h1>
        <p>{config.desc}</p>
        <div className="login-capabilities">
          {config.caps.map((cap: string[], index: number) => (
            <div className="login-cap" key={index}>
              <strong>{cap[0]}</strong>
              <span>{cap[1]}</span>
            </div>
          ))}
        </div>
      </section>

      <main className="login-main">
        <div className="login-panel">
          <h2>{config.title}</h2>
          <p>Select a demo identity or enter the listed credentials.</p>
          <form className="login-form" onSubmit={handleLogin}>
            <div className={`login-error ${error ? 'show' : ''}`}>{error}</div>

            <div className="field">
              <label>Email address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', paddingRight: '68px', boxSizing: 'border-box' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontSize: '0.85em',
                    padding: '4px 8px',
                  }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="notice" style={{ marginBottom: '12px' }}>
              {selectedAccount && `Signing in as ${selectedAccount.role || 'user'}${selectedAccount.context ? ' — ' + selectedAccount.context : ''}`}
            </div>

            <button className="login-submit" type="submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Secure Login'}
            </button>

            <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12 }}>
              <Link to="/forgot-password" style={{ color: '#93c5fd' }}>Forgot password?</Link>
              <span style={{ margin: '0 8px', color: '#334155' }}>·</span>
              <Link to="/reset-password" style={{ color: '#93c5fd' }}>I have a reset code</Link>
            </div>
          </form>

          {mfaToken && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            }}>
              <div style={{
                background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
                padding: 32, width: '100%', maxWidth: 400,
                fontFamily: "'JetBrains Mono', monospace", color: '#cbd5e1',
              }}>
                <h2 style={{ fontSize: 18, marginBottom: 8 }}>Two-Factor Authentication</h2>
                <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20, lineHeight: 1.5 }}>
                  Enter the 6-digit code from your authenticator app.
                </p>
                <form onSubmit={handleMfaSubmit}>
                  {error && (
                    <div style={{
                      background: '#3f1618', border: '1px solid #7f1d1d', padding: 10,
                      borderRadius: 6, color: '#fca5a5', marginBottom: 14, fontSize: 13,
                    }}>{error}</div>
                  )}
                  <input
                    type="text" autoFocus required
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000" maxLength={6} inputMode="numeric"
                    style={{
                      width: '100%', padding: '12px', boxSizing: 'border-box',
                      background: '#0b1220', border: '1px solid #1e293b', borderRadius: 6,
                      color: '#e2e8f0', fontFamily: 'inherit', fontSize: 24,
                      textAlign: 'center', letterSpacing: '0.3em', marginBottom: 16,
                    }}
                  />
                  <button
                    type="submit" disabled={submitting || mfaCode.length !== 6}
                    style={{
                      width: '100%', padding: '12px', border: 'none', borderRadius: 6,
                      background: submitting ? '#334155' : '#2563eb', color: 'white',
                      fontFamily: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {submitting ? 'Verifying…' : 'Verify Code'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMfaToken(null); setMfaCode(''); setError(''); }}
                    style={{
                      width: '100%', marginTop: 10, padding: '10px',
                      background: 'transparent', border: '1px solid #334155', borderRadius: 6,
                      color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                    }}
                  >
                    Cancel
                  </button>
                </form>
              </div>
            </div>
          )}

          <section className="account-section">
            <h3>Available identities</h3>
            <div className="account-list">
              {accounts.map((a: any) => (
                <div
                  className={`account-item ${selectedAccount?.id === a.id ? 'selected' : ''}`}
                  key={a.id}
                  onClick={() => handleSelectAccount(a)}
                >
                  <div className="account-avatar" style={{ '--account-color': a.color } as any}>
                    {a.name
                      .split(' ')
                      .map((x: string) => x[0])
                      .slice(0, 2)
                      .join('')}
                  </div>
                  <div>
                    <strong>{a.name}</strong>
                    <small>
                      {a.role} · {a.context}
                    </small>
                  </div>
                  <span className="account-demo">Use demo</span>
                </div>
              ))}
            </div>
          </section>

          <Link className="back-link" to="/">
            ← Back to portal directory
          </Link>
        </div>
      </main>
    </div>
  );
};

export default PortalLogin;
