import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill } from '../iam/iamStyles';

interface ImportJob {
  id: string;
  tenantId: string;
  importType: string;
  source: string;
  targetDesc: string;
  totalRecords: number;
  processedRecords: number;
  failedRecords: number;
  status: string;
  errorLog: string | null;
  startedAt: string;
  completedAt: string | null;
  tenant?: { id: string; name: string; type: string };
}

const n = Date.now();
const DEFAULT_IMPORTS: ImportJob[] = [
  { id: 'IMP-01', tenantId: 'T1', importType: 'CsvUpload', source: 'users_export_2026.csv', targetDesc: 'User Directory', totalRecords: 245, processedRecords: 245, failedRecords: 0, status: 'Completed', errorLog: null, startedAt: new Date(n - 7200000).toISOString(), completedAt: new Date(n - 6800000).toISOString(), tenant: { id: 'T1', name: 'Al-Rajhi Holding Group', type: 'Holding Parent' } },
  { id: 'IMP-02', tenantId: 'T1', importType: 'ApiSync', source: 'SAP GRC API /risks', targetDesc: 'Risk Register', totalRecords: 128, processedRecords: 128, failedRecords: 3, status: 'Partial', errorLog: '3 records skipped: duplicate ref IDs (RSK-045, RSK-112, RSK-089)', startedAt: new Date(n - 86400000).toISOString(), completedAt: new Date(n - 85000000).toISOString(), tenant: { id: 'T1', name: 'Al-Rajhi Holding Group', type: 'Holding Parent' } },
  { id: 'IMP-03', tenantId: 'T1', importType: 'TenantMigration', source: 'Legacy GRC v2.1 Export', targetDesc: 'Al-Rajhi → New Tenant', totalRecords: 1420, processedRecords: 890, failedRecords: 0, status: 'Processing', errorLog: null, startedAt: new Date(n - 3600000).toISOString(), completedAt: null, tenant: { id: 'T1', name: 'Al-Rajhi Holding Group', type: 'Holding Parent' } },
  { id: 'IMP-04', tenantId: 'T1', importType: 'CsvUpload', source: 'controls_iso27001_baseline.csv', targetDesc: 'Control Library', totalRecords: 114, processedRecords: 0, failedRecords: 0, status: 'Queued', errorLog: null, startedAt: new Date(n - 600000).toISOString(), completedAt: null, tenant: { id: 'T1', name: 'Al-Rajhi Holding Group', type: 'Holding Parent' } },
  { id: 'IMP-05', tenantId: 'T1', importType: 'ApiSync', source: 'Qualys VMDR API', targetDesc: 'ASM Asset Inventory', totalRecords: 342, processedRecords: 342, failedRecords: 18, status: 'Failed', errorLog: 'API authentication failed after 342 records — token expired mid-sync. 18 records had schema validation errors.', startedAt: new Date(n - 172800000).toISOString(), completedAt: new Date(n - 172000000).toISOString(), tenant: { id: 'T1', name: 'Al-Rajhi Holding Group', type: 'Holding Parent' } },
];

const STATUS_PILL: Record<string, React.CSSProperties> = {
  Queued:     pill('var(--ink-muted)', 'var(--line)'),
  Processing: pill('var(--info)', 'var(--info-line)'),
  Completed:  pill('var(--success)', 'var(--success-line)'),
  Failed:     pill('var(--danger)', 'var(--danger-line)'),
  Partial:    pill('var(--warning)', 'var(--warning-line)'),
};

const TYPE_PILL: Record<string, React.CSSProperties> = {
  CsvUpload:       pill('var(--success)', 'var(--success-line)'),
  ApiSync:         pill('var(--info)', 'var(--info-line)'),
  TenantMigration: pill('var(--violet)', 'var(--violet)'),
};

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const ImportsMigration: React.FC = () => {
  const [imports, setImports] = useState<ImportJob[]>(DEFAULT_IMPORTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Create modal
  const [modalOpen, setModalOpen] = useState(false);
  const [formType, setFormType] = useState('CsvUpload');
  const [formSource, setFormSource] = useState('');
  const [formTarget, setFormTarget] = useState('');
  const [formRecords, setFormRecords] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Error detail modal
  const [detailJob, setDetailJob] = useState<ImportJob | null>(null);

  const loadImports = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/usage/imports');
      if (res.data?.imports && res.data.imports.length > 0) {
        setImports(res.data.imports);
      }
    } catch {
      setImports(DEFAULT_IMPORTS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadImports(); }, [loadImports]);

  const handleRetry = async (job: ImportJob) => {
    setRetryingId(job.id);
    try {
      const res = await apiClient.post(`/api/usage/imports/${job.id}/retry`);
      if (res.data?.import) {
        setImports(prev => prev.map(j => j.id === job.id ? { ...j, ...res.data.import } : j));
      } else {
        setImports(prev => prev.map(j => j.id === job.id ? { ...j, status: 'Processing', errorLog: null, failedRecords: 0 } : j));
      }
      setNotice(`Import "${job.source}" retry initiated.`);
    } catch {
      setImports(prev => prev.map(j => j.id === job.id ? { ...j, status: 'Processing', errorLog: null } : j));
      setNotice(`Retry triggered locally for "${job.source}".`);
    } finally {
      setRetryingId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSource.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/usage/imports', {
        importType: formType,
        source: formSource.trim(),
        targetDesc: formTarget.trim(),
        totalRecords: Number(formRecords) || 0,
      });
      if (res.data?.import) {
        setImports(prev => [res.data.import, ...prev]);
      } else {
        const local: ImportJob = {
          id: `IMP-${Date.now().toString().slice(-5)}`,
          tenantId: '', importType: formType, source: formSource.trim(),
          targetDesc: formTarget.trim(), totalRecords: Number(formRecords) || 0,
          processedRecords: 0, failedRecords: 0, status: 'Queued',
          errorLog: null, startedAt: new Date().toISOString(), completedAt: null
        };
        setImports(prev => [local, ...prev]);
      }
      setNotice(`Import job for "${formSource.trim()}" created.`);
    } catch {
      const local: ImportJob = {
        id: `IMP-${Date.now().toString().slice(-5)}`,
        tenantId: '', importType: formType, source: formSource.trim(),
        targetDesc: formTarget.trim(), totalRecords: Number(formRecords) || 0,
        processedRecords: 0, failedRecords: 0, status: 'Queued',
        errorLog: null, startedAt: new Date().toISOString(), completedAt: null
      };
      setImports(prev => [local, ...prev]);
      setNotice(`Import job created locally.`);
    } finally {
      setModalOpen(false);
      setFormType('CsvUpload'); setFormSource(''); setFormTarget(''); setFormRecords('');
      setSubmitting(false);
    }
  };

  const totalCount = imports.length;
  const processingCount = imports.filter(j => j.status === 'Processing').length;
  const completedCount = imports.filter(j => j.status === 'Completed').length;
  const failedCount = imports.filter(j => j.status === 'Failed').length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Imports & Migration</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={ghostBtn} onClick={loadImports} disabled={loading}>↻ Refresh</button>
          <button style={primaryBtn()} onClick={() => setModalOpen(true)}>+ New Import</button>
        </div>
      </div>

      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 12, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notice}</span>
          <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }} onClick={() => setNotice('')}>✕</button>
        </div>
      )}
      {error && <div style={S.error}>{error}</div>}

      <StatStrip items={[
        ['Total Imports', totalCount],
        ['In Progress', <span style={{ color: 'var(--info)' }}>{processingCount}</span>],
        ['Completed', <span style={{ color: 'var(--success)' }}>{completedCount}</span>],
        ['Failed', <span style={{ color: 'var(--danger)' }}>{failedCount}</span>],
      ]} />

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 24 }}>Loading import jobs…</div>
      ) : (
        <div style={{ ...S.card, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Type</th>
                <th style={S.th}>Source</th>
                <th style={S.th}>Target</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Records</th>
                <th style={S.th}>Progress</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Started</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {imports.map(j => {
                const pct = j.totalRecords > 0 ? Math.round((j.processedRecords / j.totalRecords) * 100) : 0;
                return (
                  <tr key={j.id} style={S.bodyRow}>
                    <td style={S.td}>
                      <span style={TYPE_PILL[j.importType] || TYPE_PILL.CsvUpload}>
                        {j.importType === 'CsvUpload' ? 'CSV' : j.importType === 'ApiSync' ? 'API Sync' : 'Migration'}
                      </span>
                    </td>
                    <td style={S.td}>
                      <div style={{ fontWeight: 500, color: 'var(--ink-body)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.source}</div>
                      {j.tenant && <div style={{ fontSize: 10, color: 'var(--ink-muted)' }}>{j.tenant.name}</div>}
                    </td>
                    <td style={S.td}>{j.targetDesc || '—'}</td>
                    <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      <span>{j.processedRecords.toLocaleString()}</span>
                      <span style={{ color: 'var(--ink-muted)' }}> / {j.totalRecords.toLocaleString()}</span>
                      {j.failedRecords > 0 && <div style={{ fontSize: 10, color: 'var(--danger)' }}>{j.failedRecords} failed</div>}
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 80, height: 6, background: 'var(--surface-sunk)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            width: `${pct}%`,
                            height: '100%',
                            borderRadius: 3,
                            background: j.status === 'Failed' ? 'var(--danger)' : j.status === 'Partial' ? 'var(--warning)' : j.status === 'Processing' ? 'var(--info)' : 'var(--success)',
                            transition: 'width 0.4s ease'
                          }} />
                        </div>
                        <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-muted)' }}>{pct}%</span>
                      </div>
                    </td>
                    <td style={S.td}><span style={STATUS_PILL[j.status] || STATUS_PILL.Queued}>{j.status}</span></td>
                    <td style={S.td}>{fmtDate(j.startedAt)}</td>
                    <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {(j.status === 'Failed' || j.status === 'Partial') && (
                        <button
                          style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11, marginRight: 4 }}
                          onClick={() => handleRetry(j)}
                          disabled={retryingId === j.id}
                        >{retryingId === j.id ? '…' : '↻ Retry'}</button>
                      )}
                      {j.errorLog && (
                        <button style={{ ...ghostBtn, padding: '4px 8px', fontSize: 11 }} onClick={() => setDetailJob(j)}>📋 Log</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {imports.length === 0 && (
                <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: 'var(--ink-muted)', padding: 32 }}>No import jobs found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* New Import Modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900 }} onClick={() => setModalOpen(false)}>
          <form onSubmit={handleCreate} onClick={e => e.stopPropagation()} style={{ ...S.card, padding: 28, width: 460, maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--ink)' }}>New Import Job</h3>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Import Type</label>
              <select value={formType} onChange={e => setFormType(e.target.value)} style={S.input}>
                <option value="CsvUpload">CSV Upload</option>
                <option value="ApiSync">API Sync</option>
                <option value="TenantMigration">Tenant Migration</option>
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>
                {formType === 'CsvUpload' ? 'File Name' : formType === 'ApiSync' ? 'API Endpoint / Source' : 'Migration Source'}
              </label>
              <input value={formSource} onChange={e => setFormSource(e.target.value)} style={S.input} required autoFocus
                placeholder={formType === 'CsvUpload' ? 'users_export.csv' : formType === 'ApiSync' ? 'https://api.example.com/data' : 'Legacy System v2.1'} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Target</label>
                <input value={formTarget} onChange={e => setFormTarget(e.target.value)} style={S.input} placeholder="e.g. Risk Register" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block', marginBottom: 4 }}>Expected Records</label>
                <input type="number" min={0} value={formRecords} onChange={e => setFormRecords(e.target.value)} style={S.input} placeholder="0" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button type="button" style={ghostBtn} onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="submit" style={primaryBtn(submitting)} disabled={submitting}>{submitting ? 'Creating…' : 'Start Import'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Error Log Detail Modal */}
      {detailJob && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900 }} onClick={() => setDetailJob(null)}>
          <div onClick={e => e.stopPropagation()} style={{ ...S.card, padding: 28, width: 520, maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16, color: 'var(--ink)' }}>Import Error Log</h3>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 8 }}>{detailJob.source} → {detailJob.targetDesc}</div>
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
              padding: 14, fontSize: 12, color: 'var(--danger)',
              fontFamily: "'JetBrains Mono',monospace",
              whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto'
            }}>
              {detailJob.errorLog || 'No error details available.'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={ghostBtn} onClick={() => setDetailJob(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportsMigration;
