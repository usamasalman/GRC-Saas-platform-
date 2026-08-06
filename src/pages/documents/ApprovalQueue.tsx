import { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';

interface DocumentItem {
  id: string;
  code: string;
  title: string;
  category: string;
  version: string;
  owner?: { id: string; name: string; email: string };
  approvals?: any[];
  /** Present only when this document awaits the current user's signature. */
  myApproval?: {
    id: string;
    sequenceOrder: number;
    canSignNow: boolean;
    waitingOn: string | null;
  } | null;
}

export default function ApprovalQueue() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal State for Digital Signature
  const [signingDoc, setSigningDoc] = useState<DocumentItem | null>(null);
  const [password, setPassword] = useState('');
  const [decision, setDecision] = useState('Approved');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [signatureHash, setSignatureHash] = useState('');

  const fetchPendingApprovals = async () => {
    setLoading(true);
    setError('');
    try {
      // Only documents awaiting THIS user's signature. Listing every in-review
      // document offered a Sign & Approve the server then refused, because
      // approval comes from an assigned queue row, not from holding the role.
      const res = await apiClient.get('/api/documents', {
        params: { status: 'IN_REVIEW', pendingForMe: 'true' },
      });
      if (res.data.status === 'success') {
        setDocuments(res.data.documents || []);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to fetch approval queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingApprovals();
  }, []);

  const openApproveModal = (doc: DocumentItem) => {
    setSigningDoc(doc);
    setPassword('');
    setDecision('Approved');
    setActionError('');
    setSignatureHash('');
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signingDoc) return;

    setSubmitting(true);
    setActionError('');

    try {
      const res = await apiClient.post(`/api/documents/${signingDoc.id}/approve`, {
        password,
        decision,
      });

      if (res.data.status === 'success') {
        setSignatureHash(res.data.signatureHash);
        setTimeout(() => {
          setSigningDoc(null);
          fetchPendingApprovals();
        }, 1500);
      }
    } catch (e: any) {
      setActionError(e.response?.data?.message || 'Approval failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRejectSubmit = async (doc: DocumentItem) => {
    const rejectReason = prompt('Enter reason for rejecting/returning document:', 'Requires revisions');
    if (rejectReason === null) return;

    try {
      const res = await apiClient.post(`/api/documents/${doc.id}/reject`, { reason: rejectReason });
      if (res.data.status === 'success') {
        fetchPendingApprovals();
      }
    } catch (e: any) {
      alert(e.response?.data?.message || 'Rejection failed');
    }
  };

  return (
    <div style={{ padding: '24px', color: '#e2e8f0' }}>
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#f8fafc' }}>Approval Queue</h1>
        <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' }}>
          Review and digitally sign pending compliance document submissions with SoD protection.
        </p>
      </header>

      {error && <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>Loading pending approvals...</div>
      ) : documents.length === 0 ? (
        <div style={{ background: '#1e293b', padding: '32px', textAlign: 'center', color: '#94a3b8', borderRadius: '8px', border: '1px solid #334155' }}>
          ✓ No documents currently pending your review or approval.
        </div>
      ) : (
        <div style={{ background: '#1e293b', borderRadius: '8px', border: '1px solid #334155', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <th style={{ padding: '12px 16px' }}>Code</th>
                <th style={{ padding: '12px 16px' }}>Title</th>
                <th style={{ padding: '12px 16px' }}>Category</th>
                <th style={{ padding: '12px 16px' }}>Version</th>
                <th style={{ padding: '12px 16px' }}>Author / Owner</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', color: '#38bdf8' }}>{doc.code}</td>
                  <td style={{ padding: '12px 16px', color: '#f8fafc' }}>{doc.title}</td>
                  <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>{doc.category}</td>
                  <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>v{doc.version}</td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8' }}>{doc.owner?.name || 'Unknown'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {/* Approvals are sequenced: an earlier signatory must go first. */}
                    {doc.myApproval && !doc.myApproval.canSignNow ? (
                      <span style={{ fontSize: '12px', color: '#fbbf24' }}>
                        Waiting on {doc.myApproval.waitingOn}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => openApproveModal(doc)}
                          style={{ background: '#059669', color: '#ffffff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                        >
                          ✓ Sign &amp; Approve
                        </button>
                        <button
                          onClick={() => handleRejectSubmit(doc)}
                          style={{ background: '#dc2626', color: '#ffffff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                        >
                          ✕ Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Digital Signature & Step-up Re-Auth Modal */}
      {signingDoc && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleApproveSubmit} style={{ background: '#0f172a', border: '1px solid #059669', borderRadius: '8px', width: '500px', maxWidth: '90vw', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <span style={{ color: '#34d399', fontSize: '12px', fontWeight: 'bold' }}>STEP-UP DIGITAL SIGNATURE RE-AUTHENTICATION</span>
              <h2 style={{ margin: '4px 0 0', fontSize: '18px', color: '#f8fafc' }}>
                Approve {signingDoc.code} — {signingDoc.title}
              </h2>
            </div>

            {actionError && <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '8px 12px', borderRadius: '4px', fontSize: '13px' }}>{actionError}</div>}

            {signatureHash ? (
              <div style={{ background: '#064e3b', border: '1px solid #059669', color: '#a7f3d0', padding: '16px', borderRadius: '6px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', marginBottom: '8px' }}>✓ Digital Signature Recorded</div>
                <div style={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all', background: '#022c22', padding: '8px', borderRadius: '4px' }}>
                  SHA-256: {signatureHash}
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Approval Notes / Decision</label>
                  <input
                    type="text"
                    value={decision}
                    onChange={(e) => setDecision(e.target.value)}
                    placeholder="e.g. Approved following review"
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '8px 12px', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#f59e0b', marginBottom: '4px' }}>Re-enter Password to Confirm Digital Signature *</label>
                  <input
                    type="password"
                    required
                    placeholder="Enter your account password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ width: '100%', background: '#1e293b', border: '1px solid #f59e0b', color: '#e2e8f0', padding: '8px 12px', borderRadius: '6px', fontSize: '13px' }}
                  />
                  <span style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                    Signing generates an immutable SHA-256 cryptographic hash chained into the audit log.
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setSigningDoc(null)}
                    style={{ background: '#334155', color: '#e2e8f0', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    style={{ background: '#059669', color: '#ffffff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}
                  >
                    {submitting ? 'Verifying & Signing...' : 'Confirm Digital Signature'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
