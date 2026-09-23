import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill , apiError } from '../iam/iamStyles';

interface Quota {
  id: string;
  tenantId: string;
  resourceType: string;
  used: number;
  limitValue: number;
  status: string;
  tenant?: { id: string; name: string; type: string };
}

/**
 * Resource quotas, as the server has them.
 *
 * Several quota rows were hardcoded here and shown whenever the API returned
 * nothing or failed. A platform operator could read a tenant over its limit when
 * no such tenant existed in their data.
 *
 * Adjusting a limit had three paths and two of them lied: if the response
 * carried no quota, or the request was refused outright, the new limit was
 * written into local state and reported as updated -- in one case with the word
 * "locally", which no operator would read as "not saved".
 */
const STATUS_PILL: Record<string, React.CSSProperties> = {
  Under:   pill('var(--success)', 'var(--success-line)'),
  Warning: pill('var(--warning)', 'var(--warning-line)'),
  Over:    pill('var(--danger)', 'var(--danger-line)'),
};

const ResourceUsageQuotas: React.FC = () => {
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editQuota, setEditQuota] = useState<Quota | null>(null);
  const [newLimit, setNewLimit] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Filter
  const [filterStatus, setFilterStatus] = useState<string>('All');

  const loadQuotas = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/usage/quotas');
      setQuotas(res.data?.quotas || []);
    } catch (err) {
      setError(apiError(err, 'Could not load quotas.'));
      setQuotas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadQuotas(); }, [loadQuotas]);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editQuota || !newLimit.trim() || submitting) return;
    const limit = Number(newLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      setError('A quota limit must be a number, zero or above.');
      return;
    }
    const quota = editQuota;
    setSubmitting(true);
    setError('');
    try {
      await apiClient.patch(`/api/usage/quotas/${quota.id}`, { limitValue: limit });
      setModalOpen(false);
      setEditQuota(null);
      setNewLimit('');
      setNotice(`Quota for ${quota.resourceType} updated to ${limit}.`);
      // The breach status is derived server-side from usage against the new
      // limit. Reload rather than recompute it here and risk disagreeing.
      await loadQuotas();
    } catch (err) {
      setError(apiError(err, 'Could not update the quota.'));
    } finally {
      setSubmitting(false);
    }
  };

  const openModal = (q: Quota) => {
    setEditQuota(q);
    setNewLimit(String(q.limitValue));
    setModalOpen(true);
  };

  const filtered = filterStatus === 'All' ? quotas : quotas.filter(q => q.status === filterStatus);
  const tenants = [...new Set(quotas.map(q => q.tenant?.name || 'Unknown'))];
  const overCount = quotas.filter(q => q.status === 'Over').length;
  const warningCount = quotas.filter(q => q.status === 'Warning').length;
  const avgUtil = quotas.length > 0
    ? Math.round(quotas.reduce((sum, q) => sum + (q.limitValue > 0 ? (q.used / q.limitValue) * 100 : 0), 0) / quotas.length)
    : 0;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Resource Usage & Quotas</h2>
        <button style={ghostBtn} onClick={loadQuotas} disabled={loading}>↻ Refresh</button>
      </div>

      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 12, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notice}</span>
          <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }} onClick={() => setNotice('')}>✕</button>
        </div>
      )}
      {error && <div style={S.error}>{error}</div>}

      <StatStrip items={[
        ['Tenants Monitored', tenants.length],
        ['Resources Near Limit', <span style={{ color: 'var(--warning)' }}>{warningCount}</span>],
        ['Over Quota', <span style={{ color: 'var(--danger)' }}>{overCount}</span>],
        ['Avg Utilisation', `${avgUtil}%`],
      ]} />

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['All', 'Under', 'Warning', 'Over'].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)} style={{
            ...ghostBtn,
            padding: '5px 12px',
            fontSize: 11,
            ...(filterStatus === s ? { background: 'var(--surface-sunk)', color: 'var(--ink-body)', borderColor: 'var(--info-line)' } : {})
          }}>{s}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 24 }}>Loading quotas…</div>
      ) : (
        <div style={{ ...S.card, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Tenant</th>
                <th style={S.th}>Resource</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Used</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Limit</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Utilisation</th>
                <th style={S.th}>Status</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(q => {
                const pct = q.limitValue > 0 ? Math.round((q.used / q.limitValue) * 100) : 0;
                return (
                  <tr key={q.id} style={S.bodyRow}>
                    <td style={S.td}>
                      <div style={{ fontWeight: 500, color: 'var(--ink-body)' }}>{q.tenant?.name || '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{q.tenant?.type}</div>
                    </td>
                    <td style={S.td}>{q.resourceType}</td>
                    <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{q.used.toLocaleString()}</td>
                    <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{q.limitValue.toLocaleString()}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <div style={{ width: 60, height: 6, background: 'var(--surface-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(pct, 100)}%`,
                            height: '100%',
                            borderRadius: 3,
                            background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)',
                            transition: 'width 0.4s ease'
                          }} />
                        </div>
                        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)' }}>{pct}%</span>
                      </div>
                    </td>
                    <td style={S.td}><span style={STATUS_PILL[q.status] || STATUS_PILL.Under}>{q.status}</span></td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <button style={{ ...ghostBtn, padding: '4px 10px', fontSize: 11 }} onClick={() => openModal(q)}>Adjust</button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ ...S.td, textAlign: 'center', color: 'var(--ink-muted)', padding: 32 }}>No quotas match the selected filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Adjust Quota Modal */}
      {modalOpen && editQuota && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900 }} onClick={() => setModalOpen(false)}>
          <form onSubmit={handleAdjust} onClick={e => e.stopPropagation()} style={{ ...S.card, padding: 28, width: 420, maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--ink)' }}>Adjust Quota</h3>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 4 }}>Tenant</div>
              <div style={{ color: 'var(--ink-body)', fontSize: 13 }}>{editQuota.tenant?.name}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 4 }}>Resource</div>
              <div style={{ color: 'var(--ink-body)', fontSize: 13 }}>{editQuota.resourceType} — currently using {editQuota.used.toLocaleString()}</div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>New Limit</label>
              <input type="number" min={1} value={newLimit} onChange={e => setNewLimit(e.target.value)} style={S.input} required autoFocus />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" style={ghostBtn} onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="submit" style={primaryBtn(submitting)} disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default ResourceUsageQuotas;
