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
    return <div style={{ padding: '24px', color: 'var(--ink-muted)' }}>Loading document dashboard...</div>;
  }

  if (error) {
    return <div style={{ padding: '24px', color: 'var(--danger)' }}>{error}</div>;
  }

  return (
    <div style={{ padding: '24px', color: 'var(--ink-body)' }}>
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: 'var(--ink)' }}>Document Governance Dashboard</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--ink-muted)', fontSize: '14px' }}>
          Real-time overview of document lifecycles, approvals, and compliance acknowledgements.
        </p>
      </header>

      {/* KPI Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={{ background: 'var(--surface-sunk)', padding: '20px', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: '12px', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Documents</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--info)', marginTop: '8px' }}>{stats?.total || 0}</div>
        </div>

        <div style={{ background: 'var(--surface-sunk)', padding: '20px', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: '12px', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Drafts</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--warning)', marginTop: '8px' }}>{stats?.draft || 0}</div>
        </div>

        <div style={{ background: 'var(--surface-sunk)', padding: '20px', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: '12px', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>In Review</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--info)', marginTop: '8px' }}>{stats?.inReview || 0}</div>
        </div>

        <div style={{ background: 'var(--surface-sunk)', padding: '20px', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: '12px', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Approved</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--violet)', marginTop: '8px' }}>{stats?.approved || 0}</div>
        </div>

        <div style={{ background: 'var(--surface-sunk)', padding: '20px', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: '12px', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Published</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--success)', marginTop: '8px' }}>{stats?.published || 0}</div>
        </div>

        <div style={{ background: 'var(--surface-sunk)', padding: '20px', borderRadius: '8px', border: '1px solid var(--line)' }}>
          <div style={{ fontSize: '12px', color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>My Approvals Due</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color: (stats?.pendingMyApproval || 0) > 0 ? 'var(--danger)' : 'var(--ink-muted)', marginTop: '8px' }}>
            {stats?.pendingMyApproval || 0}
          </div>
        </div>
      </div>

      {/* Summary section */}
      <section style={{ background: 'var(--surface-sunk)', padding: '24px', borderRadius: '8px', border: '1px solid var(--line)' }}>
        <h2 style={{ fontSize: '16px', margin: '0 0 16px', color: 'var(--ink)' }}>Governance Quick Actions & Compliance Health</h2>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1', minWidth: '240px', background: 'var(--surface-sunk)', padding: '16px', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--info)' }}>Policy Acknowledgements</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-muted)' }}>
              You have <strong style={{ color: 'var(--ink)' }}>{stats?.myUnacknowledged || 0}</strong> unacknowledged policy updates.
            </p>
          </div>
          <div style={{ flex: '1', minWidth: '240px', background: 'var(--surface-sunk)', padding: '16px', borderRadius: '6px', border: '1px solid var(--line)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--warning)' }}>Returned Documents</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-muted)' }}>
              <strong style={{ color: 'var(--ink)' }}>{stats?.returned || 0}</strong> documents require revisions after review.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
