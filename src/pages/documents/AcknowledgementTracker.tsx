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
    <div style={{ padding: '24px', color: '#e2e8f0' }}>
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#f8fafc' }}>Policy Acknowledgements</h1>
        <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' }}>
          Review mandatory published compliance policies and register your formal acknowledgement.
        </p>
      </header>

      {actionMsg && (
        <div style={{ background: '#064e3b', border: '1px solid #059669', color: '#a7f3d0', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          ✓ {actionMsg}
        </div>
      )}

      {error && <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>Loading published policies...</div>
      ) : publishedDocs.length === 0 ? (
        <div style={{ background: '#1e293b', padding: '32px', textAlign: 'center', color: '#94a3b8', borderRadius: '8px', border: '1px solid #334155' }}>
          No active published policies require acknowledgement at this time.
        </div>
      ) : (
        <div style={{ background: '#1e293b', borderRadius: '8px', border: '1px solid #334155', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <th style={{ padding: '12px 16px' }}>Code</th>
                <th style={{ padding: '12px 16px' }}>Policy Title</th>
                <th style={{ padding: '12px 16px' }}>Category</th>
                <th style={{ padding: '12px 16px' }}>Version</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {publishedDocs.map((doc) => (
                <tr key={doc.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 'bold', color: '#38bdf8' }}>{doc.code}</td>
                  <td style={{ padding: '12px 16px', color: '#f8fafc' }}>{doc.title}</td>
                  <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>{doc.category}</td>
                  <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>v{doc.version}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => handleAcknowledge(doc.id)}
                      style={{ background: '#0284c7', color: '#ffffff', border: 'none', padding: '6px 14px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}
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
