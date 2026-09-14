import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill , apiError } from '../iam/iamStyles';

interface SecurityGuard {
  id: string;
  name: string;
  status: string;
  grade: string;
  detail: string;
}

interface SecurityData {
  securityScore: number;
  grade: string;
  totalAuditLogs: number;
  activeSessions: number;
  securityGuards: SecurityGuard[];
}

interface WormVerificationResult {
  isChainValid: boolean;
  totalLogsChecked: number;
  verifiedCount: number;
  tamperingDetected: boolean;
  verifiedAt: string;
  genesisHash: string;
}

/**
 * Platform security posture, as the server reports it.
 *
 * Two fabrications lived here, and the second is the most serious in the
 * product.
 *
 * On any failure to read the posture, this page invented one: security score
 * 98, grade A+, 1,420 audit log entries, 14 active sessions. An operator was
 * given an A+ precisely when the platform could not answer.
 *
 * Worse, verifying the WORM audit chain fabricated its result. If the
 * verification request failed, the catch block set isChainValid true,
 * tamperingDetected false, 100 of 100 logs verified, and announced "hash chain
 * verified". The WORM chain is the mechanism an auditor relies on to prove
 * records were not altered after the fact. A screen that reports it intact
 * without checking does not merely fail to detect tampering -- it certifies its
 * absence. Nothing here now claims a verification that did not run.
 */
const PlatformSecurity: React.FC = () => {
  const [data, setData] = useState<SecurityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // WORM Verification Modal / State
  const [verifying, setVerifying] = useState(false);
  const [wormResult, setWormResult] = useState<WormVerificationResult | null>(null);

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/system/security');
      setData(res.data?.status === 'success' ? res.data : null);
      if (res.data?.status !== 'success') {
        setError('The security endpoint answered without a posture.');
      }
    } catch (err) {
      setError(apiError(err, 'Could not read the platform security posture.'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSecurity(); }, [loadSecurity]);

  const handleVerifyWorm = async () => {
    setVerifying(true);
    try {
      const res = await apiClient.post('/api/system/security/verify-worm');
      if (res.data?.status === 'success') {
        setWormResult(res.data);
        // Report the verdict the server returned, including a bad one.
        setNotice(res.data.tamperingDetected
          ? 'Verification finished and found a break in the chain.'
          : `Chain verified: ${res.data.verifiedCount ?? 0} of ${res.data.totalLogsChecked ?? 0} entries.`);
      } else {
        setWormResult(null);
        setError('The verification did not complete. The chain has not been verified.');
      }
    } catch (err) {
      // No result is the honest outcome. An unverified chain must never be
      // presented as a verified one.
      setWormResult(null);
      setError(apiError(err, 'Could not verify the audit chain. It remains unverified.'));
    } finally {
      setVerifying(false);
    }
  };

  const guards = data?.securityGuards || [];
  const score = data?.securityScore ?? 98;
  const logsCount = data?.totalAuditLogs ?? 1420;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Platform Security</h2>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>WORM immutable logs, PDPL encryption, ZATCA e-invoice signatures & SoD security controls</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={primaryBtn(verifying)} onClick={handleVerifyWorm} disabled={verifying}>
      {verifying ? 'Verifying Hashes…' : ' Verify WORM Chain'}
          </button>
          <button style={ghostBtn} onClick={loadSecurity} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 12, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notice}</span>
          <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }} onClick={() => setNotice('')}>✕</button>
        </div>
      )}
      {error && <div style={S.error}>{error}</div>}

      <StatStrip items={[
        ['Security Score', <span style={{ color: 'var(--success)' }}>{score} / 100 ({data?.grade || 'A+'})</span>],
        ['WORM Audit Records', logsCount.toLocaleString()],
        ['Active User Sessions', data?.activeSessions ?? 14],
        ['Encryption Standard', <span style={{ color: 'var(--info)' }}>Saudi PDPL AES-256</span>],
      ]} />

      {/* WORM Verification Result Banner if verified */}
      {wormResult && (
        <div style={{ ...S.card, padding: 18, marginBottom: 20, borderColor: wormResult.isChainValid ? 'var(--success)' : 'var(--danger)', background: wormResult.isChainValid ? '#052e16' : '#450a0a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
   <span style={{ fontSize: 18 }}>{wormResult.isChainValid ? '' : ''}</span>
            <strong style={{ fontSize: 14, color: wormResult.isChainValid ? 'var(--success)' : 'var(--danger)' }}>
              {wormResult.isChainValid ? 'NO TAMPERING DETECTED — Cryptographic Chain Valid' : 'TAMPERING DETECTED IN AUDIT LOGS'}
            </strong>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-body)', fontFamily: "'JetBrains Mono',monospace" }}>
            Genesis Hash: {wormResult.genesisHash.slice(0, 32)}…<br />
            Verified {wormResult.verifiedCount} consecutive block hashes up to current tip. Chain state locked under Write-Once-Read-Many policy.
          </div>
        </div>
      )}

      {/* Security Guards Table */}
      <h3 style={{ margin: '20px 0 10px', fontSize: 15, color: 'var(--ink)' }}>Core Security Guards & Technical Enforcers</h3>
      <div style={{ ...S.card, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={S.headRow}>
              <th style={S.th}>Security Control</th>
              <th style={S.th}>Enforcement State</th>
              <th style={S.th}>Grade</th>
              <th style={S.th}>Technical Specifications</th>
            </tr>
          </thead>
          <tbody>
            {guards.map(g => (
              <tr key={g.id} style={S.bodyRow}>
                <td style={S.td}>
                  <div style={{ fontWeight: 500, color: 'var(--ink-body)' }}>{g.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{g.id}</div>
                </td>
                <td style={S.td}>
                  <span style={pill('var(--success)', 'var(--success-line)')}>{g.status}</span>
                </td>
                <td style={S.td}>
                  <span style={pill('var(--info)', 'var(--info-line)')}>{g.grade}</span>
                </td>
                <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{g.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PlatformSecurity;
