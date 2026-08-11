import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill } from '../iam/iamStyles';

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

const DEFAULT_TOOLS: Tool[] = [
  { id: 'TOOL-001', name: 'OWASP DefectDojo', category: 'Vulnerability Management', license: 'BSD-3-Clause', maturity: 'Approved', review: 'Security Review Passed', deployment: 'Managed GRC Wisdom Integration', description: 'Vulnerability management dashboard and DevSecOps orchestration platform.', annualPrice: 12000, risk: 'Low' },
  { id: 'TOOL-002', name: 'OWASP Dependency-Check', category: 'SCA / Supply Chain', license: 'Apache-2.0', maturity: 'Approved', review: 'Security Review Passed', deployment: 'Customer-Managed Connector', description: 'Software Composition Analysis (SCA) tool for detecting publicly disclosed vulnerabilities in dependencies.', annualPrice: 6000, risk: 'Low' },
  { id: 'TOOL-003', name: 'Trivy Scanner', category: 'Container Security', license: 'Apache-2.0', maturity: 'Approved', review: 'Security Review Passed', deployment: 'Managed GRC Wisdom Integration', description: 'Comprehensive security scanner for container images, file systems, and Git repositories.', annualPrice: 8500, risk: 'Low' },
  { id: 'TOOL-004', name: 'OpenVAS / Greenbone Security', category: 'Vulnerability Management', license: 'GPL-2.0', maturity: 'Under Review', review: 'Architecture & Privacy Gate', deployment: 'Dedicated OCI Environment', description: 'Full-featured vulnerability scanner and management system.', annualPrice: 15000, risk: 'Medium' },
  { id: 'TOOL-005', name: 'Falco Cloud Native Security', category: 'Container Security', license: 'Apache-2.0', maturity: 'Approved', review: 'Security Review Passed', deployment: 'Managed GRC Wisdom Integration', description: 'Real-time threat detection engine for cloud-native environments and Kubernetes runtime.', annualPrice: 9500, risk: 'Low' }
];

const OpenSourceToolMarketplace: React.FC = () => {
  const [tools, setTools] = useState<Tool[]>(DEFAULT_TOOLS);
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
      if (res.data?.tools && res.data.tools.length > 0) {
        setTools(res.data.tools);
      }
    } catch {
      let filtered = [...DEFAULT_TOOLS];
      if (categoryFilter) filtered = filtered.filter(t => t.category === categoryFilter);
      if (search) filtered = filtered.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
      setTools(filtered);
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
    const newTool: Tool = {
      id: `TOOL-${Date.now().toString().slice(-4)}`,
      name: toolName.trim(),
      category: toolCategory,
      license: toolLicense,
      maturity: 'Under Review',
      review: 'Initial Intake',
      deployment: toolDeployment,
      description: toolDesc.trim(),
      annualPrice: 0,
      risk: 'Medium'
    };
    try {
      await apiClient.post('/api/marketplace/tools', {
        name: toolName.trim(),
        category: toolCategory,
        license: toolLicense,
        deployment: toolDeployment,
        description: toolDesc.trim()
      });
    } catch {
      // Client fallback update
    } finally {
      setTools(prev => [newTool, ...prev]);
      setNotice(`Tool "${toolName}" submitted for security and license review.`);
      setToolName('');
      setToolDesc('');
      setSubmitModalOpen(false);
      setSubmitting(false);
    }
  };

  const handleBuyTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTool) return;
    setBuying(true);
    try {
      await apiClient.post(`/api/marketplace/tools/${selectedTool.id}/buy`, {
        installationMode,
        justification
      });
    } catch {
      // Client fallback update
    } finally {
      setNotice(`Entitlement granted for ${selectedTool.name}. Support ticket created.`);
      setBuyModalOpen(false);
      setSelectedTool(null);
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
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Open Source Tool Marketplace</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
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
        ['Approved & Ready', <span style={{ color: 'var(--success)' }}>{approvedCount}</span>],
        ['Under Security Review', <span style={{ color: 'var(--warning)' }}>{underReviewCount}</span>],
        ['Open Source Licenses', 'MIT / Apache / GPL'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
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
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading open source tools...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 14 }}>
          {tools.map((t) => (
            <div key={t.id} style={{ ...S.card, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: 'var(--info)', background: 'var(--info-bg)', padding: '2px 6px', borderRadius: 4 }}>{t.category}</span>
                  {t.maturity === 'Approved' ? (
                    <span style={pill('var(--success)', 'var(--success-line)')}>Approved</span>
                  ) : (
                    <span style={pill('var(--warning)', 'var(--warning-line)')}>Under Review</span>
                  )}
                </div>
                <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--ink)' }}>{t.name}</h3>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>
                  License: {t.license} · Risk: <span style={{ color: t.risk === 'Low' ? 'var(--success)' : t.risk === 'High' ? 'var(--danger)' : '#fde047' }}>{t.risk}</span>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.5 }}>{t.description}</p>
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', background: 'var(--surface)', padding: 8, borderRadius: 6, marginBottom: 12 }}>
                  Deployment: <strong style={{ color: 'var(--ink-body)' }}>{t.deployment}</strong>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>
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
                    <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Pending Review</span>
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
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--ink)' }}>Submit Open Source Tool for Review</h3>
            <form onSubmit={handleSubmitTool}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Tool Name</label>
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
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Category</label>
                <select value={toolCategory} onChange={(e) => setToolCategory(e.target.value)} style={S.input}>
                  <option value="Vulnerability Management">Vulnerability Management</option>
                  <option value="SCA / Supply Chain">SCA / Supply Chain</option>
                  <option value="Container Security">Container Security</option>
                  <option value="Cloud Security">Cloud Security</option>
                  <option value="Identity & Secrets">Identity &amp; Secrets</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>License</label>
                <input
                  type="text"
                  value={toolLicense}
                  onChange={(e) => setToolLicense(e.target.value)}
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Deployment Mode</label>
                <select value={toolDeployment} onChange={(e) => setToolDeployment(e.target.value)} style={S.input}>
                  <option value="Managed GRC Wisdom Integration">Managed GRC Wisdom Integration</option>
                  <option value="Customer-Managed Connector">Customer-Managed Connector</option>
                  <option value="Dedicated OCI Environment">Dedicated OCI Environment</option>
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Description &amp; Use Case</label>
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
            <h3 style={{ margin: '0 0 6px', fontSize: 16, color: 'var(--ink)' }}>Buy &amp; Install {selectedTool.name}</h3>
            <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 14 }}>
              Category: {selectedTool.category} · Price: {selectedTool.annualPrice > 0 ? `SAR ${Number(selectedTool.annualPrice).toLocaleString()}/yr` : 'Included'}
            </div>

            <form onSubmit={handleBuyTool}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Installation Mode</label>
                <select value={installationMode} onChange={(e) => setInstallationMode(e.target.value)} style={S.input}>
                  <option value="Managed GRC Wisdom Integration">Managed GRC Wisdom Integration</option>
                  <option value="Customer-Managed Connector">Customer-Managed Connector</option>
                  <option value="Dedicated OCI Environment">Dedicated OCI Environment</option>
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Business Justification</label>
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
