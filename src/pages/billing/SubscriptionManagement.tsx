import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';

interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  startDate: string;
  endDate?: string;
  tenant?: { id: string; name: string; type: string };
  plan?: { id: string; name: string; priceMonthly: number; maxUsers: number };
}

interface Plan {
  id: string;
  name: string;
  priceMonthly: number;
  maxUsers: number;
}

const SubscriptionManagement: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [subRes, planRes] = await Promise.all([
        apiClient.get('/api/billing/subscriptions'),
        apiClient.get('/api/billing/plans')
      ]);
      setSubscriptions(subRes.data?.subscriptions || []);
      const loadedPlans = planRes.data?.plans || [];
      setPlans(loadedPlans);
      if (loadedPlans.length > 0 && !selectedPlanId) {
        setSelectedPlanId(loadedPlans[0].id);
      }
    } catch (err: any) {
      setError(apiError(err, 'Failed to load subscription data'));
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanId) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/billing/subscriptions', { planId: selectedPlanId });
      setNotice(res.data?.message || 'Subscription created successfully.');
      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      alert(apiError(err, 'Failed to create subscription'));
    } finally {
      setSubmitting(false);
    }
  };

  const activeCount = subscriptions.filter(s => s.status === 'ACTIVE').length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Subscription Management</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Manage commercial subscriptions, active tiers, tenant allocations, renewals and contract terms.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setModalOpen(true)} style={primaryBtn()}>+ New Subscription</button>
          <button onClick={loadData} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Active Subscriptions', <span style={{ color: '#86efac' }}>{activeCount}</span>],
        ['Available Tiers', plans.length],
        ['Currency', 'SAR (Saudi Riyals)'],
        ['Audit Status', 'WORM Logged'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading subscriptions...</div>
      ) : (
        <div style={S.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Subscription ID</th>
                <th style={S.th}>Tenant</th>
                <th style={S.th}>Plan Tier</th>
                <th style={S.th}>Monthly Price</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Start Date</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                    No active subscriptions found for this tenant scope.
                  </td>
                </tr>
              ) : (
                subscriptions.map((sub) => (
                  <tr key={sub.id} style={S.bodyRow}>
                    <td style={{ ...S.td, fontFamily: 'monospace', color: '#38bdf8' }}>{sub.id}</td>
                    <td style={S.td}>
                      <strong style={{ color: '#f1f5f9' }}>{sub.tenant?.name || 'Your Organization'}</strong>
                      {sub.tenant?.type && <div style={{ fontSize: 11, color: '#64748b' }}>{sub.tenant.type}</div>}
                    </td>
                    <td style={S.td}>
                      <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{sub.plan?.name || 'Custom Plan'}</span>
                      {sub.plan?.maxUsers && <div style={{ fontSize: 11, color: '#64748b' }}>{sub.plan.maxUsers} named users</div>}
                    </td>
                    <td style={{ ...S.td, color: '#86efac', fontWeight: 600 }}>
                      SAR {Number(sub.plan?.priceMonthly || 0).toLocaleString()}/mo
                    </td>
                    <td style={S.td}>
                      <span style={pill('#86efac', '#15803d')}>{sub.status}</span>
                    </td>
                    <td style={{ ...S.td, color: '#94a3b8' }}>
                      {new Date(sub.startDate).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal for creating subscription */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 460, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#f1f5f9' }}>Subscribe to Plan Tier</h3>
            <form onSubmit={handleCreateSubscription}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Select Plan Tier</label>
                <select
                  value={selectedPlanId}
                  onChange={(e) => setSelectedPlanId(e.target.value)}
                  style={S.input}
                >
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — SAR {Number(p.priceMonthly).toLocaleString()}/mo ({p.maxUsers} users)
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setModalOpen(false)} style={ghostBtn}>Cancel</button>
                <button type="submit" disabled={submitting} style={primaryBtn(submitting)}>
                  {submitting ? 'Subscribing...' : 'Confirm Subscription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionManagement;
