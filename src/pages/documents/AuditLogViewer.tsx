import Icon from '../../components/Icon';
import { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import Can, { CAP } from '../../components/Can';

interface VerifyResult {
  tenantName: string;
  logCount: number;
  verifiedCount: number;
  unverifiableCount: number;
  status: 'VALID' | 'VALID_SINCE' | 'UNVERIFIABLE' | 'TAMPERED';
}

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
  // Carried beside the message instead of sniffing it for the word INTACT,
  // which is how "INTACT for 64 entries, 51 unverifiable" would have been
  // painted the same green as a fully verified chain.
  const [verifyTone, setVerifyTone] = useState<'good' | 'warn' | 'bad'>('warn');

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

  /**
   * Report what the verifier said, including the parts that are neither
   * "intact" nor "tampered".
   *
   * Two things were wrong here. The catch block answered "Verification check
   * completed." — so a request that failed, including the 403 every non-platform
   * role gets from this endpoint, read as a clean bill of health. And the
   * success path collapsed the answer to INTACT or tampering, which stopped
   * being true once the verifier learned to distinguish rows it cannot check
   * from rows that were changed: a tenant can now be `integrityVerified: true`
   * with fifty-one entries nobody can verify, and "INTACT (WORM Locked)" is the
   * wrong sentence to put under that.
   */
  const say = (tone: 'good' | 'warn' | 'bad', message: string) => {
    setVerifyTone(tone);
    setVerifyStatus(message);
  };

  const handleVerifyChain = async () => {
    say('warn', 'Verifying cryptographic SHA-256 hash chain…');
    try {
      const res = await apiClient.get('/api/admin/db/verify-audit');
      if (res.data?.status !== 'success') {
        say('bad', 'The verifier answered, but not with a result. The chain is unverified.');
        return;
      }
      const results: VerifyResult[] = res.data.results || [];
      const tampered = results.filter((r) => r.status === 'TAMPERED');
      const unverifiable = results.reduce((a, r) => a + (r.unverifiableCount || 0), 0);
      const verified = results.reduce((a, r) => a + (r.verifiedCount || 0), 0);

      if (tampered.length > 0) {
        say('bad',
          `TAMPERED — ${tampered.length} trail(s) do not reproduce their hash: `
          + `${tampered.map((t) => t.tenantName).join(', ')}.`);
        return;
      }
      if (unverifiable > 0) {
        say('warn',
          `${verified} entries verified. ${unverifiable} older entries cannot be verified: they `
          + 'were written before the trail stored the instant its hash covers, so there is '
          + 'nothing to check them against. Nothing indicates tampering.');
        return;
      }
      say('good', `INTACT — all ${verified} entries reproduce their hash (WORM locked).`);
    } catch (e: any) {
      const code = e?.response?.status;
      say('bad',
        code === 403
          ? 'The chain was NOT verified. Running the verifier is a platform-operator action '
            + 'and your role does not hold it.'
          : `The chain was NOT verified: ${e?.response?.data?.message || 'the verifier could not be reached'}.`);
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
        {/* The verifier is a platform-operator route. Showing the button to a
            tenant administrator only to answer 403 is the "hallucination" Can
            exists to stop. */}
        <Can do={CAP.MONITOR_SECURITY}>
          <button
            onClick={handleVerifyChain}
            style={{ background: 'var(--info)', color: '#ffffff', border: 'none', padding: '10px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
          >
            <Icon name="link" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Verify Hash Chain
          </button>
        </Can>
      </header>

      {verifyStatus && (
        <div style={{
          background: verifyTone === 'good' ? 'var(--success-bg)' : verifyTone === 'bad' ? 'var(--danger-bg)' : 'var(--warning-bg)',
          border: `1px solid ${verifyTone === 'good' ? 'var(--success-line)' : verifyTone === 'bad' ? 'var(--danger-line)' : 'var(--warning-line)'}`,
          color: verifyTone === 'good' ? 'var(--success)' : verifyTone === 'bad' ? 'var(--danger)' : 'var(--warning)',
          padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', lineHeight: 1.5,
        }}>
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
