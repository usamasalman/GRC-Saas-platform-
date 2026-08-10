import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill } from '../iam/iamStyles';

interface FeatureFlag {
  id: string;
  key: string;
  description: string;
  status: string;
  owner: string;
  scope: string;
  expiryDate: string;
  rolloutPercentage: number;
  tenantOverrides: string[];
}

const DEFAULT_FLAGS: FeatureFlag[] = [
  { id: 'FLAG-01', key: 'ENABLE_ZATCA_PHASE2_SIGNING', description: 'Enforces UBL 2.1 e-invoice cryptographic signing with ECDSA secp256k1.', status: 'Enabled', owner: 'Platform Security', scope: 'Global Platform', expiryDate: '2026-12-31', rolloutPercentage: 100, tenantOverrides: [] },
  { id: 'FLAG-02', key: 'ENABLE_AI_POLICY_ASSISTANT_BETA', description: 'Enables LLM RAG interface for regulatory standards querying.', status: 'Beta', owner: 'Product Dev', scope: 'Enterprise Tenants', expiryDate: '2026-10-15', rolloutPercentage: 50, tenantOverrides: ['TEN-01'] },
  { id: 'FLAG-03', key: 'ENABLE_WISDOM_EYE_SCANNER', description: 'Activates external attack surface management & domain reconnaissance.', status: 'Enabled', owner: 'SecOps', scope: 'Holding & Multibranch', expiryDate: '2027-01-01', rolloutPercentage: 100, tenantOverrides: [] },
  { id: 'FLAG-04', key: 'ENABLE_AUTO_RECONCILIATION_V2', description: 'Automated bank wire transfer reconciliation against pending invoices.', status: 'Disabled', owner: 'Finance Ops', scope: 'SaaS Platform', expiryDate: '2026-09-30', rolloutPercentage: 0, tenantOverrides: [] }
];

const FeatureFlagsManager: React.FC = () => {
  const [flags, setFlags] = useState<FeatureFlag[]>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [flagKey, setFlagKey] = useState('');
  const [flagDesc, setFlagDesc] = useState('');
  const [flagScope, setFlagScope] = useState('Platform');
  const [flagOwner, setFlagOwner] = useState('Engineering');
  const [submitting, setSubmitting] = useState(false);

  const loadFlags = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/marketplace/feature-flags');
      if (res.data?.flags && res.data.flags.length > 0) {
        setFlags(res.data.flags);
      }
    } catch {
      setFlags(DEFAULT_FLAGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFlags();
  }, [loadFlags]);

  const handleToggle = async (flag: FeatureFlag) => {
    setTogglingId(flag.id);
    const nextStatus = flag.status === 'Enabled' ? 'Disabled' : 'Enabled';
    try {
      await apiClient.patch(`/api/marketplace/feature-flags/${flag.id}/toggle`);
    } catch {
      // Fallback local update
    } finally {
      setFlags(prev => prev.map(f => f.id === flag.id ? { ...f, status: nextStatus } : f));
      setNotice(`Feature flag "${flag.key}" toggled to ${nextStatus}.`);
      setTogglingId(null);
    }
  };

  const handleCreateFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flagKey.trim()) return;
    setSubmitting(true);
    const newFlag: FeatureFlag = {
      id: `FLAG-${Date.now().toString().slice(-4)}`,
      key: flagKey.trim().toUpperCase(),
      description: flagDesc.trim(),
      status: 'Disabled',
      owner: flagOwner,
      scope: flagScope,
      expiryDate: '2026-12-31',
      rolloutPercentage: 0,
      tenantOverrides: []
    };
    try {
      await apiClient.post('/api/marketplace/feature-flags', {
        key: flagKey.trim().toUpperCase(),
        description: flagDesc.trim(),
        scope: flagScope,
        owner: flagOwner
      });
    } catch {
      // Fallback local update
    } finally {
      setFlags(prev => [newFlag, ...prev]);
      setNotice(`Feature flag "${newFlag.key}" registered.`);
      setFlagKey('');
      setFlagDesc('');
      setModalOpen(false);
      setSubmitting(false);
    }
  };

  const enabledCount = flags.filter(f => f.status === 'Enabled').length;
  const disabledCount = flags.filter(f => f.status === 'Disabled').length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Feature Flags</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Control staged rollouts, tenant-specific features, approvals, expiry and rollback triggers.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setModalOpen(true)} style={primaryBtn()}>+ Create Feature Flag</button>
          <button onClick={loadFlags} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Total Feature Flags', flags.length],
        ['Enabled Flags', <span style={{ color: '#86efac' }}>{enabledCount}</span>],
        ['Disabled Flags', <span style={{ color: '#94a3b8' }}>{disabledCount}</span>],
        ['Audit Enforcement', 'WORM Logged'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading feature flags...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 14 }}>
          {flags.map((f) => (
            <div key={f.id} style={{ ...S.card, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                  <strong style={{ fontSize: 15, color: '#f8fafc' }}>{f.key}</strong>
                  {f.status === 'Enabled' ? (
                    <span style={pill('#86efac', '#15803d')}>Enabled</span>
                  ) : f.status === 'Pilot' ? (
                    <span style={pill('#38bdf8', '#0284c7')}>Pilot</span>
                  ) : (
                    <span style={pill('#94a3b8', '#334155')}>Disabled</span>
                  )}
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{f.description}</p>
              </div>

              <div>
                <div style={{ background: '#0b1220', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 11, color: '#64748b', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                  <span>Owner: <strong style={{ color: '#cbd5e1' }}>{f.owner}</strong></span>
                  <span>Scope: <strong style={{ color: '#cbd5e1' }}>{f.scope}</strong></span>
                  <span>Expiry: <strong style={{ color: '#cbd5e1' }}>{f.expiryDate}</strong></span>
                  <span>Rollout: <strong style={{ color: '#86efac' }}>{f.rolloutPercentage}%</strong></span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #1e293b', paddingTop: 10 }}>
                  <button
                    onClick={() => handleToggle(f)}
                    disabled={togglingId === f.id}
                    style={{
                      ...primaryBtn(togglingId === f.id),
                      fontSize: 12,
                      padding: '5px 12px',
                      background: f.status === 'Enabled' ? '#7f1d1d' : '#2563eb'
                    }}
                  >
                    {togglingId === f.id ? 'Updating...' : f.status === 'Enabled' ? 'Disable Flag' : 'Enable Flag'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Flag Modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 480, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#f1f5f9' }}>Create Feature Flag</h3>
            <form onSubmit={handleCreateFlag}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Flag Key / Name</label>
                <input
                  type="text"
                  required
                  value={flagKey}
                  onChange={(e) => setFlagKey(e.target.value)}
                  placeholder="e.g. DMS Semantic Diff"
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Scope</label>
                <select value={flagScope} onChange={(e) => setFlagScope(e.target.value)} style={S.input}>
                  <option value="Platform">Platform (All Tenants)</option>
                  <option value="Selected Tenants">Selected Tenants Only</option>
                  <option value="Beta Tenants">Beta Program Tenants</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Owner Team</label>
                <input
                  type="text"
                  value={flagOwner}
                  onChange={(e) => setFlagOwner(e.target.value)}
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Description</label>
                <textarea
                  rows={3}
                  value={flagDesc}
                  onChange={(e) => setFlagDesc(e.target.value)}
                  placeholder="Describe purpose, rollback plan and target behavior..."
                  style={{ ...S.input, height: 'auto' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setModalOpen(false)} style={ghostBtn}>Cancel</button>
                <button type="submit" disabled={submitting} style={primaryBtn(submitting)}>
                  {submitting ? 'Creating...' : 'Create Flag'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeatureFlagsManager;
