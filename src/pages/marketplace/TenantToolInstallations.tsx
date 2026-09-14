import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill , apiError } from '../iam/iamStyles';

interface Installation {
  id: string;
  toolId: string;
  toolName: string;
  tenantId: string;
  tenantName: string;
  category: string;
  deployment: string;
  status: string;
  versionHealth: string;
  support: string;
  installedAt: string;
}

/**
 * Tool installations, as the server has them.
 *
 * Three installations were hardcoded here, belonging to named organisations,
 * and shown whenever the API returned nothing or failed.
 *
 * The health check was the worst of it: whatever the server said, or whether it
 * answered at all, the handler invented a latency with Math.random() and
 * reported "health check passed, connector operational", then marked the
 * installation Healthy. A degraded connector could be tested and pronounced
 * fine, with a number that came from nowhere.
 */
const TenantToolInstallations: React.FC = () => {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);

  const loadInstallations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/marketplace/installations');
      setInstallations(res.data?.installations || []);
    } catch (err) {
      setError(apiError(err, 'Could not load installations.'));
      setInstallations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInstallations();
  }, [loadInstallations]);

  const handleTestHealth = async (inst: Installation) => {
    setTestingId(inst.id);
    setError('');
    try {
      const res = await apiClient.post(`/api/marketplace/installations/${inst.id}/health`);
      // Report what the check returned. The status shown comes from reloading
      // the row, not from assuming the check passed.
      setNotice(res.data?.message || `Health check run for ${inst.toolName}.`);
      await loadInstallations();
    } catch (err) {
      setError(apiError(err, `Could not run the health check for ${inst.toolName}.`));
    } finally {
      setTestingId(null);
    }
  };

  const activeCount = installations.filter(i => i.status === 'Active').length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Tool Installations &amp; Entitlements</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Monitor purchased open-source security tools, deployment connectors, integration health and tenant entitlements.
          </p>
        </div>
        <button onClick={loadInstallations} style={ghostBtn}>↻ Refresh Installations</button>
      </div>

      <StatStrip items={[
        ['Active Entitlements', <span style={{ color: 'var(--success)' }}>{activeCount}</span>],
        ['Healthy Connectors', <span style={{ color: 'var(--info)' }}>{installations.length}</span>],
        ['Deployment Model', 'Managed &amp; Dedicated'],
        ['Support Tier', 'Standard SLA'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading installed tools...</div>
      ) : (
        <div style={S.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Tool</th>
                <th style={S.th}>Tenant Scope</th>
                <th style={S.th}>Category</th>
                <th style={S.th}>Deployment</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Version Health</th>
                <th style={S.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {installations.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    No tool entitlements installed yet. Browse the Open Source Tool Marketplace to install security tools!
                  </td>
                </tr>
              ) : (
                installations.map((inst) => (
                  <tr key={inst.id} style={S.bodyRow}>
                    <td style={S.td}>
                      <strong style={{ color: 'var(--ink)' }}>{inst.toolName}</strong>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{inst.id}</div>
                    </td>
                    <td style={S.td}>{inst.tenantName}</td>
                    <td style={S.td}>{inst.category}</td>
                    <td style={{ ...S.td, fontSize: 12, color: 'var(--ink-muted)' }}>{inst.deployment}</td>
                    <td style={S.td}>
                      <span style={pill('var(--success)', 'var(--success-line)')}>{inst.status}</span>
                    </td>
                    <td style={{ ...S.td, fontSize: 12, color: 'var(--ink-body)' }}>{inst.versionHealth}</td>
                    <td style={S.td}>
                      <button
                        onClick={() => handleTestHealth(inst)}
                        disabled={testingId === inst.id}
                        style={{ ...primaryBtn(testingId === inst.id), fontSize: 11, padding: '4px 10px' }}
                      >
                        {testingId === inst.id ? 'Checking...' : 'Test Health'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TenantToolInstallations;
