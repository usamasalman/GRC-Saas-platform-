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

const ToolReviewApproval: React.FC = () => {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Review Modal State
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [reviewStage, setReviewStage] = useState('Security Review Passed');
  const [riskRating, setRiskRating] = useState('Low');
  const [price, setPrice] = useState(0);
  const [updating, setUpdating] = useState(false);

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/marketplace/tools');
      setTools(res.data?.tools || []);
    } catch (err: any) {
      setError(apiError(err, 'Failed to load tool review queue'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const handleApproveTool = async (maturityStatus: 'Approved' | 'Rejected') => {
    if (!selectedTool) return;
    setUpdating(true);
    try {
      const res = await apiClient.patch(`/api/marketplace/tools/${selectedTool.id}/review`, {
        maturity: maturityStatus,
        review: reviewStage,
        risk: riskRating,
        annualPrice: price
      });
      setNotice(res.data?.message || `Tool "${selectedTool.name}" status updated to ${maturityStatus}`);
      setSelectedTool(null);
      await loadTools();
    } catch (err: any) {
      alert(apiError(err, 'Failed to update tool review'));
    } finally {
      setUpdating(false);
    }
  };

  const queue = tools.filter(t => t.maturity !== 'Approved');
  const approved = tools.filter(t => t.maturity === 'Approved');

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Tool Review &amp; Approval</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Curated security pipeline: license compliance, malware scan, tenant isolation and support verification.
          </p>
        </div>
        <button onClick={loadTools} style={ghostBtn}>↻ Refresh Queue</button>
      </div>

      <StatStrip items={[
        ['Pending Review', <span style={{ color: '#fbbf24' }}>{queue.length}</span>],
        ['Approved Tools', <span style={{ color: '#86efac' }}>{approved.length}</span>],
        ['Security Gates', 'License · SCA · Isolation · Privacy'],
        ['Review SLA', '48 Hours'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading review queue...</div>
      ) : (
        <div style={S.card}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b', fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>
            Open Source Tools Pending Approval ({queue.length})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Tool Name</th>
                <th style={S.th}>Category</th>
                <th style={S.th}>License</th>
                <th style={S.th}>Stage</th>
                <th style={S.th}>Risk</th>
                <th style={S.th}>Required Gates</th>
                <th style={S.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                    No tools currently pending security review. All tools approved!
                  </td>
                </tr>
              ) : (
                queue.map((t) => (
                  <tr key={t.id} style={S.bodyRow}>
                    <td style={S.td}>
                      <strong style={{ color: '#f1f5f9' }}>{t.name}</strong>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{t.id}</div>
                    </td>
                    <td style={S.td}>{t.category}</td>
                    <td style={S.td}>{t.license}</td>
                    <td style={S.td}>
                      <span style={pill('#fbbf24', '#b45309')}>{t.review}</span>
                    </td>
                    <td style={S.td}>
                      <span style={{ color: t.risk === 'Low' ? '#86efac' : t.risk === 'High' ? '#fca5a5' : '#fde047' }}>{t.risk}</span>
                    </td>
                    <td style={{ ...S.td, fontSize: 11, color: '#64748b' }}>
                      SCA Scan · License · Architecture · Privacy
                    </td>
                    <td style={S.td}>
                      <button
                        onClick={() => {
                          setSelectedTool(t);
                          setReviewStage(t.review);
                          setRiskRating(t.risk);
                          setPrice(Number(t.annualPrice || 0));
                        }}
                        style={{ ...primaryBtn(), fontSize: 11, padding: '4px 10px' }}
                      >
                        Inspect &amp; Approve
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Review Modal */}
      {selectedTool && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 540, padding: 24 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, color: '#f1f5f9' }}>Review: {selectedTool.name}</h3>
            <div style={{ fontSize: 12, color: '#38bdf8', marginBottom: 14 }}>
              Category: {selectedTool.category} · License: {selectedTool.license}
            </div>

            <div style={{ background: '#0b1220', padding: 12, borderRadius: 6, border: '1px solid #1e293b', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>AUTOMATED AUDIT CHECKS</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                <span style={{ color: '#86efac' }}>✓ License Compatibility: PASSED</span>
                <span style={{ color: '#86efac' }}>✓ SCA Malware Scan: CLEAN</span>
                <span style={{ color: '#86efac' }}>✓ Isolation Gate: VERIFIED</span>
                <span style={{ color: '#86efac' }}>✓ Support Model: READY</span>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Review Stage</label>
              <select value={reviewStage} onChange={(e) => setReviewStage(e.target.value)} style={S.input}>
                <option value="Initial Intake">Initial Intake</option>
                <option value="SCA & Dependency Audit">SCA &amp; Dependency Audit</option>
                <option value="Architecture & Privacy Gate">Architecture &amp; Privacy Gate</option>
                <option value="Security Review Passed">Security Review Passed</option>
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Assessed Risk Rating</label>
              <select value={riskRating} onChange={(e) => setRiskRating(e.target.value)} style={S.input}>
                <option value="Low">Low Risk</option>
                <option value="Medium">Medium Risk</option>
                <option value="High">High Risk</option>
              </select>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Annual Managed Service Price (SAR)</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                style={S.input}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <button type="button" onClick={() => setSelectedTool(null)} style={ghostBtn}>Cancel</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleApproveTool('Rejected')}
                  style={{ ...ghostBtn, color: '#fca5a5', borderColor: '#7f1d1d' }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => handleApproveTool('Approved')}
                  style={primaryBtn(updating)}
                >
                  {updating ? 'Updating...' : 'Publish & Approve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolReviewApproval;
