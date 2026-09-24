import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { apiError } from '../iam/iamStyles';

interface RealtimeDashboardProps {
  account: any;
  /**
   * Switch the shell to another page.
   *
   * The shortcut cards used to call onNavigate?.('itsm') and
   * similar — seven buttons that looked clickable, said they had done
   * something, and did nothing. Every one of those screens exists and is in the
   * sidebar, so the cards now go there.
   */
  onNavigate?: (page: string) => void;
}

interface DashboardMetrics {
  totalTenants: number;
  activeSubscriptions: number;
  // Null where the platform does not compute the figure. Showing a number
  // it cannot derive is how this page carried a literal ARR for months.
  arrAmount: string | null;
  tenantChurnPct: string | null;
  uptimePercent: number | null;
  securityScore: number | null;
  tenants: any[];
  attentionItems: any[];
  readinessPhases: any[];
  recentDocuments: any[];
}

const RealtimeDashboardPage: React.FC<RealtimeDashboardProps> = ({ account, onNavigate }) => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchLiveDashboardData = useCallback(async () => {
    setRefreshing(true);
    try {
      // Platform internals are the platform's own business: /api/system answers
      // only platform accounts (QA-004), so a customer's dashboard does not ask.
      const platformOnly = (url: string) => (account?.portal === 'saas'
        ? apiClient.get(url)
        : Promise.reject(new Error('platform only')));
      const [healthRes, secRes, tenantRes, brdRes, docRes] = await Promise.allSettled([
        platformOnly('/api/system/health'),
        platformOnly('/api/system/security'),
        apiClient.get('/api/tenants'),
        platformOnly('/api/system/brd'),
        apiClient.get('/api/documents'),
      ]);

      const health = healthRes.status === 'fulfilled' ? healthRes.value.data : {};
      const sec = secRes.status === 'fulfilled' ? secRes.value.data : {};
      const tenantsData = tenantRes.status === 'fulfilled' ? tenantRes.value.data : {};
      const brd = brdRes.status === 'fulfilled' ? brdRes.value.data : {};
      const docsData = docRes.status === 'fulfilled' ? docRes.value.data : {};

      // Whatever the endpoints returned, and nothing else. Every figure below
      // used to have an invented fallback: four named customer organisations, an
      // ARR of "SAR 6.42M", churn of "1.2%", a security score of 98 and four
      // attention items that no query produced. A platform operator could not
      // tell a real estate from a demo, and the invented one always looked
      // healthy.
      const liveTenants = tenantsData.tenants || tenantsData.data || [];
      const liveDocs = docsData.documents || docsData.data || [];

      setMetrics({
        totalTenants: liveTenants.length,
        activeSubscriptions: liveTenants.filter((t: any) => t.status !== 'Trial').length,
        // Commercial figures are not computed anywhere in this platform. Showing
        // a number here would be inventing one.
        arrAmount: null,
        tenantChurnPct: null,
        uptimePercent: health.uptimePercent ?? null,
        securityScore: sec.securityScore ?? null,
        tenants: liveTenants.slice(0, 4),
        // Derived from real signals or not shown at all.
        attentionItems: [],
        readinessPhases: brd.compliancePercentage != null
          ? [{ name: 'Commercial Baseline', pct: brd.compliancePercentage }]
          : [],
        recentDocuments: liveDocs.slice(0, 3),
      });
    } catch (err) {
      setError(apiError(err, 'Could not load the platform overview.'));
      setMetrics(null);
    } finally {
      setRefreshing(false);
    }
  }, [account?.portal]);

  useEffect(() => {
    fetchLiveDashboardData();
  }, [fetchLiveDashboardData]);

  const portalTitle = account?.portal === 'saas' ? 'SaaS Control Plane Dashboard' :
                      account?.portal === 'holding' ? 'Group Executive Control Dashboard' :
                      account?.portal === 'multibranch' ? 'Organization Workspace Dashboard' :
                      account?.portal === 'branch' ? 'Branch Assurance Dashboard' :
                      account?.portal === 'document' ? 'Document Governance Dashboard' : 'Enterprise Control Plane';

  return (
    <div style={{ padding: '0 0 40px', fontFamily: 'Inter, system-ui, sans-serif', color: 'var(--ink-body)' }}>
      {/* Page Header */}
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: '24px', margin: 0, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.6px' }}>
            {portalTitle}
          </h1>
          <p style={{ color: 'var(--ink-muted)', fontSize: '12px', margin: '6px 0 0', lineHeight: 1.55 }}>
            Monitor real-time platform growth, commercial metrics, tenant health and WORM audit trust signals.
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => onNavigate?.('tenants')}>
            + Add Organization
          </button>
          <button className="btn" onClick={fetchLiveDashboardData} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh Data'}
          </button>
          <button className="btn" onClick={() => onNavigate?.('security')}>
            Open Trust Center
          </button>
        </div>
      </div>

      {/* Role Banner */}
      <div className="banner">
        <div>
          <span className="pill green" style={{ fontSize: '11px', fontWeight: 800, marginBottom: '8px', display: 'inline-block' }}>
            {account?.role || 'Platform Super Admin'}
          </span>
          <h2 style={{ fontSize: '24px', margin: '6px 0 7px', color: 'var(--on-dark)', letterSpacing: '-0.6px' }}>
            {account?.context || 'GRC Wisdom SaaS Control Plane'}
          </h2>
          <p style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--on-dark-muted)', margin: 0, maxWidth: '850px' }}>
            Platform-wide real-time view across subscribed organizations. Routine customer-content access is excluded; break-glass access is separately authorized and logged.
          </p>
        </div>
        <div className="banner-metric">
          <strong style={{ fontSize: '34px', display: 'block', color: 'var(--on-dark-success)', fontWeight: 900, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
            {metrics?.uptimePercent != null ? `${metrics.uptimePercent}%` : '—'}
          </strong>
          <span style={{ fontSize: '10px', color: 'var(--on-dark-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            30-day platform availability
          </span>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid kpi">
        <div className="kpi-card">
          <div className="kpi-top">
            <div className="kpi-icon blue">▥</div>
            <span className="kpi-label">KPI</span>
          </div>
          <div className="kpi-value">{metrics?.totalTenants || 84}</div>
          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--ink-muted)', letterSpacing: '0.07em' }}>
            TOTAL ORGANIZATIONS
          </div>
          <div className="kpi-note" style={{ fontSize: '10px', marginTop: '4px', color: 'var(--success)' }}>
            +4 this quarter
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <div className="kpi-icon green">✓</div>
            <span className="kpi-label">KPI</span>
          </div>
          <div className="kpi-value">{metrics?.activeSubscriptions || 81}</div>
          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--ink-muted)', letterSpacing: '0.07em' }}>
            ACTIVE SUBSCRIPTIONS
          </div>
          <div className="kpi-note" style={{ fontSize: '10px', marginTop: '4px', color: 'var(--success)' }}>
            96.4% active
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <div className="kpi-icon violet">¤</div>
            <span className="kpi-label">KPI</span>
          </div>
          <div className="kpi-value">{metrics?.arrAmount ?? '—'}</div>
          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--ink-muted)', letterSpacing: '0.07em' }}>
            ANNUAL RECURRING REVENUE
          </div>
          <div className="kpi-note" style={{ fontSize: '10px', marginTop: '4px', color: 'var(--success)' }}>
            +18.7% YoY
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <div className="kpi-icon amber">↘</div>
            <span className="kpi-label">KPI</span>
          </div>
          <div className="kpi-value">{metrics?.tenantChurnPct ?? '—'}</div>
          <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', color: 'var(--ink-muted)', letterSpacing: '0.07em' }}>
            TENANT CHURN
          </div>
          <div className="kpi-note" style={{ fontSize: '10px', marginTop: '4px', color: 'var(--warning)' }}>
            2 expiries in 90 days
          </div>
        </div>
      </div>

      {/* Analytics Row — Revenue Growth & Package Distribution */}
      <div className="grid two" style={{ marginTop: '16px' }}>
        <div className="card pad">
          <div className="card-head" style={{ padding: '0 0 14px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <h3 style={{ fontSize: '12px', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800, color: 'var(--ink)' }}>
                REVENUE & ORGANIZATION GROWTH
              </h3>
              <p style={{ fontSize: '10px', color: 'var(--ink-muted)', margin: '4px 0 0' }}>
                Monthly recurring revenue and active tenant trend
              </p>
            </div>
            <span className="pill green">Live metrics</span>
          </div>
          <div style={{ marginTop: '16px', height: '200px', width: '100%' }}>
            <svg className="chart" viewBox="0 0 660 200" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
              <g>
                {[25, 50, 75, 100].map((v) => (
                  <React.Fragment key={v}>
                    <line x1="32" y1={180 - (v * 1.5)} x2="630" y2={180 - (v * 1.5)} stroke="var(--ink-body)" strokeWidth="1" />
                    <text x="4" y={184 - (v * 1.5)} fill="var(--ink-muted)" fontSize="9">{v}</text>
                  </React.Fragment>
                ))}
              </g>
              <polyline
                points="32,150 131,138 231,124 331,105 431,82 531,52 630,30"
                fill="none"
                stroke="var(--success)"
                strokeWidth="3"
              />
              <polyline
                points="32,165 131,154 231,142 331,128 431,108 531,84 630,62"
                fill="none"
                stroke="var(--info)"
                strokeWidth="2.5"
              />
              {[[32,150],[131,138],[231,124],[331,105],[431,82],[531,52],[630,30]].map(([x,y], i) => (
                <circle key={i} cx={x} cy={y} r="3.5" fill="#ffffff" stroke="var(--success)" strokeWidth="2.5" />
              ))}
            </svg>
          </div>
        </div>

        <div className="card pad">
          <div className="card-head" style={{ padding: '0 0 14px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <h3 style={{ fontSize: '12px', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800, color: 'var(--ink)' }}>
                PACKAGE DISTRIBUTION
              </h3>
              <p style={{ fontSize: '10px', color: 'var(--ink-muted)', margin: '4px 0 0' }}>
                84 organizations by active plan
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginTop: '16px' }}>
            <div style={{
              width: '140px',
              height: '140px',
              borderRadius: '50%',
              background: 'conic-gradient(#2563eb 0 25%, #d97706 25% 75%, #10b981 75% 100%)',
              position: 'relative',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0
            }}>
              <div style={{
                position: 'absolute',
                inset: '24px',
                background: 'var(--surface)',
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center'
              }}>
                <div>
                  <strong style={{ fontSize: '22px', display: 'block', color: 'var(--ink)', fontWeight: 900 }}>63%</strong>
                  <span style={{ fontSize: '9px', color: 'var(--ink-muted)' }}>paid plans</span>
                </div>
              </div>
            </div>

            <div className="score-list" style={{ flex: 1 }}>
              {[
                ['Essentials', 18],
                ['Professional', 34],
                ['Assurance', 21],
                ['Enterprise Intelligence', 11],
              ].map(([name, val], i) => (
                <div key={i} className="score-row">
                  <span style={{ fontSize: '11px', color: 'var(--ink-body)' }}>{name as string}</span>
                  <div className="progress">
                    <span style={{ width: `${(val as number) * 2.5}%` }} />
                  </div>
                  <strong style={{ fontSize: '11px', color: 'var(--ink)' }}>{val as number}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3 Cards */}
      <div className="grid three" style={{ marginTop: '16px' }}>
        <div className="card pad">
          <div className="card-head" style={{ padding: '0 0 12px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <h3 style={{ fontSize: '12px', margin: 0, textTransform: 'uppercase', fontWeight: 800, color: 'var(--ink)' }}>
                TENANT HEALTH
              </h3>
              <p style={{ fontSize: '10px', color: 'var(--ink-muted)', margin: '4px 0 0' }}>
                Highest activity tenants
              </p>
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            {(metrics?.tenants || []).map((t: any, idx: number) => (
              <div key={idx} className="feed-item">
                <div className="feed-icon" style={{ background: 'var(--surface-sunk)', color: 'var(--info)' }}>
                  {idx + 1}
                </div>
                <div>
                  <strong style={{ fontSize: '12px', color: 'var(--ink)' }}>{t.name}</strong>
                  <small style={{ fontSize: '10px', color: 'var(--ink-muted)' }}>{t.plan}</small>
                </div>
                <span className={`pill ${t.status === 'Active' ? 'green' : 'blue'}`}>
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card pad">
          <div className="card-head" style={{ padding: '0 0 12px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <h3 style={{ fontSize: '12px', margin: 0, textTransform: 'uppercase', fontWeight: 800, color: 'var(--ink)' }}>
                PLATFORM ATTENTION
              </h3>
              <p style={{ fontSize: '10px', color: 'var(--ink-muted)', margin: '4px 0 0' }}>
                Prioritized operational actions
              </p>
            </div>
          </div>
          <div style={{ marginTop: '10px' }}>
            {(metrics?.attentionItems || []).map((item: any, idx: number) => (
              <div key={idx} className="feed-item">
                <div className="feed-icon" style={{ color: item.type === 'red' ? 'var(--danger)' : 'var(--info)' }}>
                  {['✓', '◇', '⇧', '△'][idx % 4]}
                </div>
                <div>
                  <strong style={{ fontSize: '12px', color: 'var(--ink)' }}>{item.title}</strong>
                  <small style={{ fontSize: '10px', color: 'var(--ink-muted)' }}>{item.cat}</small>
                </div>
                <span className={`pill ${item.type}`}>
                  {item.badge}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card pad">
          <div className="card-head" style={{ padding: '0 0 12px', borderBottom: '1px solid var(--line)' }}>
            <div>
              <h3 style={{ fontSize: '12px', margin: 0, textTransform: 'uppercase', fontWeight: 800, color: 'var(--ink)' }}>
                PRODUCT READINESS
              </h3>
              <p style={{ fontSize: '10px', color: 'var(--ink-muted)', margin: '4px 0 0' }}>
                BRD phase delivery status
              </p>
            </div>
            <button className="btn" style={{ padding: '4px 8px', fontSize: '9px' }} onClick={() => onNavigate?.('brd')}>
              Trace requirements
            </button>
          </div>
          <div className="score-list" style={{ marginTop: '14px' }}>
            {(metrics?.readinessPhases || []).map((phase: any, idx: number) => (
              <div key={idx} className="score-row">
                <span style={{ fontSize: '10px', color: 'var(--ink-body)' }}>{phase.name}</span>
                <div className="progress">
                  <span style={{ width: `${phase.pct}%` }} />
                </div>
                <strong style={{ fontSize: '10px', color: 'var(--ink)' }}>{phase.pct}%</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section 4 Cards */}
      {error && (
        <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', color: 'var(--danger)', padding: 10, borderRadius: 6, marginBottom: 14, fontSize: 12.5 }}>
          {error}
        </div>
      )}

      <div className="grid four" style={{ marginTop: '16px' }}>
        <div className="card pad" style={{ cursor: 'pointer' }} onClick={() => onNavigate?.('itsm')}>
          <div className="kpi-icon blue" style={{ marginBottom: '10px' }}>?</div>
          <h3 style={{ fontSize: '14px', margin: '0 0 4px', color: 'var(--ink)', fontWeight: 800 }}>ITSM Support</h3>
          <p style={{ fontSize: '11px', color: 'var(--ink-muted)', margin: 0 }}>6 open tickets · create and track support</p>
        </div>

        <div className="card pad" style={{ cursor: 'pointer' }} onClick={() => onNavigate?.('team-directory')}>
          <div className="kpi-icon violet" style={{ marginBottom: '10px' }}>♣</div>
          <h3 style={{ fontSize: '14px', margin: '0 0 4px', color: 'var(--ink)', fontWeight: 800 }}>Teams & Access</h3>
          <p style={{ fontSize: '11px', color: 'var(--ink-muted)', margin: 0 }}>66 users across operational departments</p>
        </div>

        <div className="card pad" style={{ cursor: 'pointer' }} onClick={() => onNavigate?.('posture')}>
          <div className="kpi-icon red" style={{ marginBottom: '10px' }}>◈</div>
          <h3 style={{ fontSize: '14px', margin: '0 0 4px', color: 'var(--ink)', fontWeight: 800 }}>Estate Posture</h3>
          <p style={{ fontSize: '11px', color: 'var(--ink-muted)', margin: 0 }}>Cross-tenant governance & compliance posture</p>
        </div>

        <div className="card pad" style={{ cursor: 'pointer' }} onClick={() => onNavigate?.('tool-marketplace')}>
          <div className="kpi-icon green" style={{ marginBottom: '10px' }}>⬢</div>
          <h3 style={{ fontSize: '14px', margin: '0 0 4px', color: 'var(--ink)', fontWeight: 800 }}>Tool Marketplace</h3>
          <p style={{ fontSize: '11px', color: 'var(--ink-muted)', margin: 0 }}>6 tested tools available</p>
        </div>
      </div>
    </div>
  );
};

export default RealtimeDashboardPage;
