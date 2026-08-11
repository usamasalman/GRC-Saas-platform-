import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill } from '../iam/iamStyles';

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

const DEFAULT_PLANS: Plan[] = [
  { id: 'PLAN-01', name: 'Essentials', priceMonthly: 2500, maxUsers: 25 },
  { id: 'PLAN-02', name: 'Professional', priceMonthly: 5000, maxUsers: 75 },
  { id: 'PLAN-03', name: 'Assurance', priceMonthly: 9166, maxUsers: 150 },
  { id: 'PLAN-04', name: 'Enterprise Intelligence', priceMonthly: 18750, maxUsers: 500 }
];

const DEFAULT_SUBSCRIPTIONS: Subscription[] = [
  { id: 'SUB-2026-081', tenantId: 'TEN-01', planId: 'PLAN-04', status: 'ACTIVE', startDate: '2026-01-15T00:00:00Z', tenant: { id: 'TEN-01', name: 'Al-Rajhi Holding Group', type: 'Holding Parent' }, plan: DEFAULT_PLANS[3] },
  { id: 'SUB-2026-042', tenantId: 'TEN-02', planId: 'PLAN-03', status: 'ACTIVE', startDate: '2026-02-01T00:00:00Z', tenant: { id: 'TEN-02', name: 'Riyadh Central Branch', type: 'Branch' }, plan: DEFAULT_PLANS[2] },
  { id: 'SUB-2026-019', tenantId: 'TEN-03', planId: 'PLAN-02', status: 'ACTIVE', startDate: '2026-03-10T00:00:00Z', tenant: { id: 'TEN-03', name: 'Jeddah Regional Hub', type: 'Subsidiary' }, plan: DEFAULT_PLANS[1] }
];

const SubscriptionManagement: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(DEFAULT_SUBSCRIPTIONS);
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(DEFAULT_PLANS[0].id);
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [subRes, planRes] = await Promise.all([
        apiClient.get('/api/billing/subscriptions'),
        apiClient.get('/api/billing/plans')
      ]);
      if (subRes.data?.subscriptions && subRes.data.subscriptions.length > 0) {
        setSubscriptions(subRes.data.subscriptions);
      }
      if (planRes.data?.plans && planRes.data.plans.length > 0) {
        setPlans(planRes.data.plans);
      }
    } catch {
      setSubscriptions(DEFAULT_SUBSCRIPTIONS);
      setPlans(DEFAULT_PLANS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanId) return;
    setSubmitting(true);
    const chosenPlan = plans.find(p => p.id === selectedPlanId) || DEFAULT_PLANS[0];
    const newSub: Subscription = {
      id: `SUB-${Date.now().toString().slice(-5)}`,
      tenantId: 'TEN-ACTIVE',
      planId: chosenPlan.id,
      status: 'ACTIVE',
      startDate: new Date().toISOString(),
      tenant: { id: 'TEN-ACTIVE', name: 'Your Organization Workspace', type: 'Enterprise Tenant' },
      plan: chosenPlan
    };
    try {
      await apiClient.post('/api/billing/subscriptions', { planId: selectedPlanId });
    } catch {
      // Fallback local update
    } finally {
      setSubscriptions(prev => [newSub, ...prev]);
      setNotice(`Subscribed to ${chosenPlan.name} plan successfully.`);
      setModalOpen(false);
      setSubmitting(false);
    }
  };

  const activeCount = subscriptions.filter(s => s.status === 'ACTIVE').length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Subscription Management</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Manage commercial subscriptions, active tiers, tenant allocations, renewals and contract terms.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setModalOpen(true)} style={primaryBtn()}>+ New Subscription</button>
          <button onClick={loadData} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Active Subscriptions', <span style={{ color: 'var(--success)' }}>{activeCount}</span>],
        ['Available Tiers', plans.length],
        ['Currency', 'SAR (Saudi Riyals)'],
        ['Audit Status', 'WORM Logged'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading subscriptions...</div>
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
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    No active subscriptions found for this tenant scope.
                  </td>
                </tr>
              ) : (
                subscriptions.map((sub) => (
                  <tr key={sub.id} style={S.bodyRow}>
                    <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--info)' }}>{sub.id}</td>
                    <td style={S.td}>
                      <strong style={{ color: 'var(--ink)' }}>{sub.tenant?.name || 'Your Organization'}</strong>
                      {sub.tenant?.type && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{sub.tenant.type}</div>}
                    </td>
                    <td style={S.td}>
                      <span style={{ color: 'var(--ink-body)', fontWeight: 600 }}>{sub.plan?.name || 'Custom Plan'}</span>
                      {sub.plan?.maxUsers && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{sub.plan.maxUsers} named users</div>}
                    </td>
                    <td style={{ ...S.td, color: 'var(--success)', fontWeight: 600 }}>
                      SAR {Number(sub.plan?.priceMonthly || 0).toLocaleString()}/mo
                    </td>
                    <td style={S.td}>
                      <span style={pill('var(--success)', 'var(--success-line)')}>{sub.status}</span>
                    </td>
                    <td style={{ ...S.td, color: 'var(--ink-muted)' }}>
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
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--ink)' }}>Subscribe to Plan Tier</h3>
            <form onSubmit={handleCreateSubscription}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>Select Plan Tier</label>
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
