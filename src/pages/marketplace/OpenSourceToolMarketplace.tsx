import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';

interface Tool {
  id: string;
  name: string;
  category: string;
  license: string;
  maturity: string;
  review: string;
  deployment: string;
  description: string;
  annualPrice: number;
  risk: string;
}

const OpenSourceToolMarketplace: React.FC = () => {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Submit Tool Modal State
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [toolName, setToolName] = useState('');
  const [toolCategory, setToolCategory] = useState('Vulnerability Management');
  const [toolLicense, setToolLicense] = useState('Apache-2.0');
  const [toolDeployment, setToolDeployment] = useState('Managed GRC Wisdom Integration');
  const [toolDesc, setToolDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Buy & Install Modal State
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [installationMode, setInstallationMode] = useState('Managed GRC Wisdom Integration');
  const [justification, setJustification] = useState('');
  const [buying, setBuying] = useState(false);

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/marketplace/tools', {
        params: { search, category: categoryFilter }
      });
      setTools(res.data?.tools || []);
    } catch (err: any) {
      setError(apiError(err, 'Failed to load open source tools catalog'));
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter]);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const handleSubmitTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toolName.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/marketplace/tools', {
        name: toolName.trim(),
        category: toolCategory,
        license: toolLicense,
        deployment: toolDeployment,
        description: toolDesc.trim()
      });
      setNotice(res.data?.message || `Tool "${toolName}" submitted for security review.`);
      setToolName('');
      setToolDesc('');
      setSubmitModalOpen(false);
      await loadTools();
    } catch (err: any) {
      alert(apiError(err, 'Failed to submit tool for review'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBuyTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTool) return;
    setBuying(true);
    try {
      const res = await apiClient.post(`/api/marketplace/tools/${selectedTool.id}/buy`, {
        installationMode,
        justification
      });
      setNotice(res.data?.message || `Tool "${selectedTool.name}" entitlement granted.`);
      setBuyModalOpen(false);
      setSelectedTool(null);
      await loadTools();
    } catch (err: any) {
      alert(apiError(err, 'Failed to purchase tool entitlement'));
    } finally {
      setBuying(false);
    }
  };

  const categories = Array.from(new Set(tools.map(t => t.category)));
  const approvedCount = tools.filter(t => t.maturity === 'Approved').length;
  const underReviewCount = tools.filter(t => t.maturity === 'Under Review').length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Open Source Tool Marketplace</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Discover approved tools, connectors and managed open-source security services available for your tenant.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setSubmitModalOpen(true)} style={primaryBtn()}>+ Submit Tool for Review</button>
          <button onClick={loadTools} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Total Tools', tools.length],
        ['Approved & Ready', <span style={{ color: '#86efac' }}>{approvedCount}</span>],
        ['Under Security Review', <span style={{ color: '#fbbf24' }}>{underReviewCount}</span>],
        ['Open Source Licenses', 'MIT / Apache / GPL'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search tools by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...S.input, maxWidth: 320 }}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ ...S.input, maxWidth: 200 }}
        >
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading open source tools...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 14 }}>
          {tools.map((t) => (
            <div key={t.id} style={{ ...S.card, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: '#38bdf8', background: '#0c4a6e', padding: '2px 6px', borderRadius: 4 }}>{t.category}</span>
                  {t.maturity === 'Approved' ? (
                    <span style={pill('#86efac', '#15803d')}>Approved</span>
                  ) : (
                    <span style={pill('#fbbf24', '#b45309')}>Under Review</span>
                  )}
                </div>
                <h3 style={{ margin: '0 0 4px', fontSize: 15, color: '#f8fafc' }}>{t.name}</h3>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
                  License: {t.license} · Risk: <span style={{ color: t.risk === 'Low' ? '#86efac' : t.risk === 'High' ? '#fca5a5' : '#fde047' }}>{t.risk}</span>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{t.description}</p>
              </div>

              <div>
                <div style={{ fontSize: 11, color: '#64748b', background: '#0b1220', padding: 8, borderRadius: 6, marginBottom: 12 }}>
                  Deployment: <strong style={{ color: '#cbd5e1' }}>{t.deployment}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #1e293b', paddingTop: 10 }}>
                  <span style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600 }}>
                    {t.annualPrice > 0 ? `SAR ${Number(t.annualPrice).toLocaleString()}/yr` : 'Free / Community'}
                  </span>
                  {t.maturity === 'Approved' ? (
                    <button
                      onClick={() => { setSelectedTool(t); setBuyModalOpen(true); }}
                      style={{ ...primaryBtn(), fontSize: 12, padding: '5px 12px' }}
                    >
                      Buy &amp; Install
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, color: '#64748b' }}>Pending Review</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Submit Tool */}
      {submitModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 480, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#f1f5f9' }}>Submit Open Source Tool for Review</h3>
            <form onSubmit={handleSubmitTool}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Tool Name</label>
                <input
                  type="text"
                  required
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder="e.g. Falco Security"
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Category</label>
                <select value={toolCategory} onChange={(e) => setToolCategory(e.target.value)} style={S.input}>
                  <option value="Vulnerability Management">Vulnerability Management</option>
                  <option value="SCA / Supply Chain">SCA / Supply Chain</option>
                  <option value="Container Security">Container Security</option>
                  <option value="Cloud Security">Cloud Security</option>
                  <option value="Identity & Secrets">Identity &amp; Secrets</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>License</label>
                <input
                  type="text"
                  value={toolLicense}
                  onChange={(e) => setToolLicense(e.target.value)}
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Deployment Mode</label>
                <select value={toolDeployment} onChange={(e) => setToolDeployment(e.target.value)} style={S.input}>
                  <option value="Managed GRC Wisdom Integration">Managed GRC Wisdom Integration</option>
                  <option value="Customer-Managed Connector">Customer-Managed Connector</option>
                  <option value="Dedicated OCI Environment">Dedicated OCI Environment</option>
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Description &amp; Use Case</label>
                <textarea
                  rows={3}
                  value={toolDesc}
                  onChange={(e) => setToolDesc(e.target.value)}
                  placeholder="Describe tool capabilities and integration purpose..."
                  style={{ ...S.input, height: 'auto' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setSubmitModalOpen(false)} style={ghostBtn}>Cancel</button>
                <button type="submit" disabled={submitting} style={primaryBtn(submitting)}>
                  {submitting ? 'Submitting...' : 'Submit for Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Buy & Install */}
      {buyModalOpen && selectedTool && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 480, padding: 24 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, color: '#f1f5f9' }}>Buy &amp; Install {selectedTool.name}</h3>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>
              Category: {selectedTool.category} · Price: {selectedTool.annualPrice > 0 ? `SAR ${Number(selectedTool.annualPrice).toLocaleString()}/yr` : 'Included'}
            </div>

            <form onSubmit={handleBuyTool}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Installation Mode</label>
                <select value={installationMode} onChange={(e) => setInstallationMode(e.target.value)} style={S.input}>
                  <option value="Managed GRC Wisdom Integration">Managed GRC Wisdom Integration</option>
                  <option value="Customer-Managed Connector">Customer-Managed Connector</option>
                  <option value="Dedicated OCI Environment">Dedicated OCI Environment</option>
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Business Justification</label>
                <textarea
                  rows={3}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="State business requirement for enabling this security tool entitlement..."
                  style={{ ...S.input, height: 'auto' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setBuyModalOpen(false)} style={ghostBtn}>Cancel</button>
                <button type="submit" disabled={buying} style={primaryBtn(buying)}>
                  {buying ? 'Processing...' : 'Confirm Entitlement Purchase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default OpenSourceToolMarketplace;
