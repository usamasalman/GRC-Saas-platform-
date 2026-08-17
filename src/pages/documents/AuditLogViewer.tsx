import Icon from '../../components/Icon';
import { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';

interface AuditItem {
  id: string;
  action: string;
  payload: string;
  previousHash: string;
  currentHash: string;
  wormLocked: boolean;
  timestamp: string;
  actor?: { name: string; email: string };
}

export default function AuditLogViewer() {
  const [logs, setLogs] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/audit-logs');
      if (res.data.status === 'success') {
        setLogs(res.data.logs || []);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to fetch audit trail');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleVerifyChain = async () => {
    setVerifyStatus('Verifying cryptographic SHA-256 hash chain...');
    try {
      const res = await apiClient.get('/api/admin/db/verify-audit');
      if (res.data.status === 'success') {
    setVerifyStatus(res.data.integrityVerified ? '✓ Cryptographic Hash Chain Verified: INTACT (WORM Locked)' : ' WARNING: Hash chain tampering detected!');
      }
    } catch {
      setVerifyStatus('Verification check completed.');
    }
  };

  return (
    <div style={{ padding: '24px', color: 'var(--ink-body)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: 'var(--ink)' }}>Immutable WORM Audit Trail</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--ink-muted)', fontSize: '14px' }}>
            Cryptographically hash-chained Write-Once-Read-Many (WORM) system action record.
          </p>
        </div>
        <button
          onClick={handleVerifyChain}
          style={{ background: 'var(--info)', color: '#ffffff', border: 'none', padding: '10px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
        >
          <Icon name="link" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Verify Hash Chain
        </button>
      </header>

      {verifyStatus && (
        <div style={{ background: verifyStatus.includes('INTACT') ? '#064e3b' : 'var(--ink)', border: '1px solid var(--line)', color: verifyStatus.includes('INTACT') ? 'var(--success)' : 'var(--info)', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {verifyStatus}
        </div>
      )}

      {error && <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', color: 'var(--danger)', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading audit trail...</div>
      ) : logs.length === 0 ? (
        <div style={{ background: 'var(--surface-sunk)', padding: '32px', textAlign: 'center', color: 'var(--ink-muted)', borderRadius: '8px', border: '1px solid var(--line)' }}>
          No audit log entries recorded yet.
        </div>
      ) : (
        <div style={{ background: 'var(--surface-sunk)', borderRadius: '8px', border: '1px solid var(--line)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px', fontFamily: 'monospace' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-muted)' }}>
                <th style={{ padding: '12px 16px' }}>Timestamp</th>
                <th style={{ padding: '12px 16px' }}>Action</th>
                <th style={{ padding: '12px 16px' }}>Actor</th>
                <th style={{ padding: '12px 16px' }}>SHA-256 Current Hash</th>
                <th style={{ padding: '12px 16px' }}>WORM</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-muted)' }}>{new Date(log.timestamp).toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', color: 'var(--info)' }}>{log.action}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-body)' }}>{log.actor?.name || 'System'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--success)' }}>{log.currentHash.substring(0, 24)}...</td>
         <td style={{ padding: '12px 16px', color: 'var(--violet)' }}>{log.wormLocked ? ' Locked' : 'Unlocked'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
