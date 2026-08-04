import { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';

interface DocStats {
  total: number;
  draft: number;
  inReview: number;
  approved: number;
  published: number;
  archived: number;
  returned: number;
  pendingMyApproval: number;
  myUnacknowledged: number;
}

export default function DocumentDashboard() {
  const [stats, setStats] = useState<DocStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/documents/stats');
      if (res.data.status === 'success') {
        setStats(res.data.stats);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load document statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return <div style={{ padding: '24px', color: '#94a3b8' }}>Loading document dashboard...</div>;
  }

  if (error) {
    return <div style={{ padding: '24px', color: '#ef4444' }}>{error}</div>;
  }

  return (
    <div style={{ padding: '24px', color: '#e2e8f0' }}>
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#f8fafc' }}>Document Governance Dashboard</h1>
        <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '14px' }}>
          Real-time overview of document lifecycles, approvals, and compliance acknowledgements.
        </p>
      </header>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={{ background: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Documents</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#38bdf8', marginTop: '8px' }}>{stats?.total || 0}</div>
        </div>

        <div style={{ background: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Drafts</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#f59e0b', marginTop: '8px' }}>{stats?.draft || 0}</div>
        </div>

        <div style={{ background: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>In Review</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#60a5fa', marginTop: '8px' }}>{stats?.inReview || 0}</div>
        </div>

        <div style={{ background: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Approved</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#a78bfa', marginTop: '8px' }}>{stats?.approved || 0}</div>
        </div>

        <div style={{ background: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Published</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#34d399', marginTop: '8px' }}>{stats?.published || 0}</div>
        </div>

        <div style={{ background: '#1e293b', padding: '20px', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>My Approvals Due</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: (stats?.pendingMyApproval || 0) > 0 ? '#ef4444' : '#94a3b8', marginTop: '8px' }}>
            {stats?.pendingMyApproval || 0}
          </div>
        </div>
      </div>

      {/* Summary section */}
      <section style={{ background: '#1e293b', padding: '24px', borderRadius: '8px', border: '1px solid #334155' }}>
        <h2 style={{ fontSize: '16px', margin: '0 0 16px', color: '#f8fafc' }}>Governance Quick Actions & Compliance Health</h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1', minWidth: '240px', background: '#0f172a', padding: '16px', borderRadius: '6px', border: '1px solid #334155' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: '#38bdf8' }}>Policy Acknowledgements</h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
              You have <strong style={{ color: '#f8fafc' }}>{stats?.myUnacknowledged || 0}</strong> unacknowledged policy updates.
            </p>
          </div>
          <div style={{ flex: '1', minWidth: '240px', background: '#0f172a', padding: '16px', borderRadius: '6px', border: '1px solid #334155' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: '#f59e0b' }}>Returned Documents</h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
              <strong style={{ color: '#f8fafc' }}>{stats?.returned || 0}</strong> documents require revisions after review.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
