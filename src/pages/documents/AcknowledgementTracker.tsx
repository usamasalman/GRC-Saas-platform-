import { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';

interface DocumentItem {
  id: string;
  code: string;
  title: string;
  category: string;
  version: string;
  owner?: { name: string };
  acknowledgedByMe?: boolean;
}

export default function AcknowledgementTracker() {
  const [publishedDocs, setPublishedDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const fetchPublishedPolicies = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/documents', { params: { status: 'PUBLISHED' } });
      if (res.data.status === 'success') {
        setPublishedDocs(res.data.documents || []);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to fetch policy list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPublishedPolicies();
  }, []);

  const handleAcknowledge = async (docId: string) => {
    setActionMsg('');
    try {
      const res = await apiClient.post(`/api/documents/${docId}/acknowledge`);
      if (res.data.status === 'success') {
        setActionMsg(`Successfully acknowledged policy!`);
        fetchPublishedPolicies();
      }
    } catch (e: any) {
      alert(e.response?.data?.message || 'Acknowledgement failed');
    }
  };

  return (
    <div style={{ padding: '24px', color: 'var(--ink-body)' }}>
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: 'var(--ink)' }}>Policy Acknowledgements</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--ink-muted)', fontSize: '14px' }}>
          Review mandatory published compliance policies and register your formal acknowledgement.
        </p>
      </header>

      {actionMsg && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', color: 'var(--success)', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          ✓ {actionMsg}
        </div>
      )}

      {error && <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger-line)', color: 'var(--danger)', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--ink-muted)' }}>Loading published policies...</div>
      ) : publishedDocs.length === 0 ? (
        <div style={{ background: 'var(--surface-sunk)', padding: '32px', textAlign: 'center', color: 'var(--ink-muted)', borderRadius: '8px', border: '1px solid var(--line)' }}>
          No active published policies require acknowledgement at this time.
        </div>
      ) : (
        <div style={{ background: 'var(--surface-sunk)', borderRadius: '8px', border: '1px solid var(--line)', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--ink-muted)' }}>
                <th style={{ padding: '12px 16px' }}>Code</th>
                <th style={{ padding: '12px 16px' }}>Policy Title</th>
                <th style={{ padding: '12px 16px' }}>Category</th>
                <th style={{ padding: '12px 16px' }}>Version</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {publishedDocs.map((doc) => (
                <tr key={doc.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', color: 'var(--info)' }}>{doc.code}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink)' }}>{doc.title}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-body)' }}>{doc.category}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--ink-body)' }}>v{doc.version}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => handleAcknowledge(doc.id)}
                      style={{ background: 'var(--info)', color: '#ffffff', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
                    >
                      ☑ Read & Acknowledge
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
