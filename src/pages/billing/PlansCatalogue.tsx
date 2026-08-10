import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';

interface Plan {
  id: string;
  name: string;
  priceMonthly: number;
  maxUsers: number;
  features: string;
}

const PlansCatalogue: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [priceMonthly, setPriceMonthly] = useState(3000);
  const [maxUsers, setMaxUsers] = useState(50);
  const [frameworksCount, setFrameworksCount] = useState(3);
  const [storageGb, setStorageGb] = useState(100);
  const [submitting, setSubmitting] = useState(false);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/billing/plans');
      setPlans(res.data?.plans || []);
    } catch (err: any) {
      setError(apiError(err, 'Failed to load commercial plans catalogue'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/billing/plans', {
        name: name.trim(),
        priceMonthly,
        maxUsers,
        features: { frameworks: frameworksCount, storageGb }
      });
      setNotice(res.data?.message || `Plan "${name}" created.`);
      setName('');
      setModalOpen(false);
      await loadPlans();
    } catch (err: any) {
      alert(apiError(err, 'Failed to create plan tier'));
    } finally {
      setSubmitting(false);
    }
  };

  const parseFeatures = (featuresJson: string) => {
    try {
      return JSON.parse(featuresJson || '{}');
    } catch {
      return {};
    }
  };

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Plans &amp; Commercial Catalogue</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Approved commercial packages, rate cards, quotas, discounts and minimum advertised pricing.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setModalOpen(true)} style={primaryBtn()}>+ Create Commercial Plan</button>
          <button onClick={loadPlans} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Active Package Tiers', plans.length],
        ['Billing Cycle', 'Annual &amp; Monthly'],
        ['Tax Rate', '15% Saudi VAT'],
        ['Quota Enforcement', 'Hard Stop'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading plan catalogue...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {plans.map((p) => {
            const f = parseFeatures(p.features);
            return (
              <div key={p.id} style={{ ...S.card, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 16, color: '#f8fafc' }}>{p.name}</h3>
                    <span style={pill('#86efac', '#15803d')}>Active</span>
                  </div>
                  <div style={{ fontSize: 22, color: '#38bdf8', fontWeight: 700, marginBottom: 4 }}>
                    SAR {Number(p.priceMonthly).toLocaleString()}<span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>/mo</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>Excluding 15% VAT</div>

                  <div style={{ background: '#0b1220', padding: 12, borderRadius: 6, border: '1px solid #1e293b', fontSize: 12, color: '#cbd5e1', display: 'grid', gap: 6 }}>
                    <div>👥 Named Users: <strong style={{ color: '#f1f5f9' }}>{p.maxUsers}</strong></div>
                    <div>§ Enabled Frameworks: <strong style={{ color: '#f1f5f9' }}>{f.frameworks || 1}</strong></div>
                    <div>💾 Encrypted Storage: <strong style={{ color: '#f1f5f9' }}>{f.storageGb || 10} GB</strong></div>
                    {f.aiCredits && <div>✦ AI RAG Credits: <strong style={{ color: '#a5f3fc' }}>{f.aiCredits.toLocaleString()}</strong></div>}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid #1e293b', paddingTop: 12, marginTop: 14, display: 'flex', gap: 8 }}>
                  <button onClick={() => alert(`Plan ${p.name} rate card active.`)} style={{ ...ghostBtn, flex: 1, fontSize: 11 }}>
                    Rate Card
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal for creating plan */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 460, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#f1f5f9' }}>Add Commercial Plan Tier</h3>
            <form onSubmit={handleCreatePlan}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Plan Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Enterprise Intelligence Plus"
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Monthly Price (SAR)</label>
                <input
                  type="number"
                  required
                  value={priceMonthly}
                  onChange={(e) => setPriceMonthly(Number(e.target.value))}
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Max Named Users</label>
                <input
                  type="number"
                  value={maxUsers}
                  onChange={(e) => setMaxUsers(Number(e.target.value))}
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Frameworks Quota</label>
                <input
                  type="number"
                  value={frameworksCount}
                  onChange={(e) => setFrameworksCount(Number(e.target.value))}
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Storage Quota (GB)</label>
                <input
                  type="number"
                  value={storageGb}
                  onChange={(e) => setStorageGb(Number(e.target.value))}
                  style={S.input}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setModalOpen(false)} style={ghostBtn}>Cancel</button>
                <button type="submit" disabled={submitting} style={primaryBtn(submitting)}>
                  {submitting ? 'Creating...' : 'Create Plan Tier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlansCatalogue;
