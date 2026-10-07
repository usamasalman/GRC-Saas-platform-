import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, ghostBtn, apiError } from '../../iam/iamStyles';

/**
 * The organisation's risk and asset registers as an engagement shares them
 * (consulting engagement, sprint 6): the organisations in scope, assets at or
 * below the classification ceiling, with the organisation's official scores
 * only. Read-only here; proposing and challenging come later.
 */

const PAGE = 50;

function useRegister(projectId: string, kind: 'risks' | 'assets') {
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<{ shared: boolean; total: number; hasMore: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const load = useCallback(async (p = 1) => {
    try {
      const res = await apiClient.get(`/api/engagements/${projectId}/${kind}`, { params: { page: p, pageSize: PAGE } });
      setRows((prev) => (p === 1 ? res.data[kind] : [...prev, ...res.data[kind]]));
      setMeta({ shared: res.data.shared, total: res.data.paging?.total ?? 0, hasMore: Boolean(res.data.paging?.hasMore) });
      setPage(p);
    } catch (err) {
      setError(apiError(err, `Could not load the shared ${kind}.`));
    }
  }, [projectId, kind]);
  useEffect(() => { load(1); }, [load]);
  return { rows, meta, error, more: () => load(page + 1) };
}

const NotShared: React.FC<{ what: string }> = ({ what }) => (
  <div style={{ ...S.card, padding: 16, fontSize: 13, color: 'var(--ink-muted)' }}>The scope does not share the {what}.</div>
);

const EngagementRisksAssets: React.FC<{ projectId: string }> = ({ projectId }) => {
  const risks = useRegister(projectId, 'risks');
  const assets = useRegister(projectId, 'assets');
  return (
    <div>
      <h3 style={{ margin: '0 0 8px', fontSize: 15, color: 'var(--ink)' }}>Risks</h3>
      {risks.error && <div style={S.error}>{risks.error}</div>}
      {risks.meta && !risks.meta.shared && <NotShared what="risk register" />}
      {risks.meta?.shared && (
        <div style={{ ...S.card, overflow: 'hidden', marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Risk</th><th style={S.th}>Category</th><th style={S.th}>Inherent</th>
                <th style={S.th}>Residual</th><th style={S.th}>Treatment</th><th style={S.th}>Status</th><th style={S.th}>Owner</th>
              </tr>
            </thead>
            <tbody>
              {risks.rows.map((r) => (
                <tr key={r.id} style={S.bodyRow}>
                  <td style={S.td}><div style={{ fontSize: 12.5 }}>{r.title}</div><div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.ref}</div></td>
                  <td style={S.td}>{r.category}</td>
                  <td style={S.td}>{r.inherentScore} ({r.inherentLikelihood}×{r.inherentImpact})</td>
                  <td style={S.td}><strong>{r.residualScore}</strong> ({r.residualLikelihood}×{r.residualImpact})</td>
                  <td style={S.td}>{r.treatmentType}</td>
                  <td style={S.td}>{r.status}</td>
                  <td style={S.td}>{r.owner || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {risks.meta.hasMore && <div style={{ padding: 12, textAlign: 'center' }}><button style={ghostBtn} onClick={risks.more}>Load more</button></div>}
          {risks.rows.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: 'var(--ink-muted)' }}>No risks in scope.</div>}
        </div>
      )}

      <h3 style={{ margin: '0 0 8px', fontSize: 15, color: 'var(--ink)' }}>Assets</h3>
      {assets.error && <div style={S.error}>{assets.error}</div>}
      {assets.meta && !assets.meta.shared && <NotShared what="asset register" />}
      {assets.meta?.shared && (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Asset</th><th style={S.th}>Type</th><th style={S.th}>Classification</th>
                <th style={S.th}>C / I / A</th><th style={S.th}>Criticality</th><th style={S.th}>Owner</th>
              </tr>
            </thead>
            <tbody>
              {assets.rows.map((a) => (
                <tr key={a.id} style={S.bodyRow}>
                  <td style={S.td}><div style={{ fontSize: 12.5 }}>{a.name}</div><div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{a.ref}</div></td>
                  <td style={S.td}>{a.type}</td>
                  <td style={S.td}>{a.classification}</td>
                  <td style={S.td}>{a.confidentiality} / {a.integrity} / {a.availability}</td>
                  <td style={S.td}>{a.criticalityTier}</td>
                  <td style={S.td}>{a.owner || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {assets.meta.hasMore && <div style={{ padding: 12, textAlign: 'center' }}><button style={ghostBtn} onClick={assets.more}>Load more</button></div>}
          {assets.rows.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: 'var(--ink-muted)' }}>No assets in scope.</div>}
        </div>
      )}
    </div>
  );
};

export default EngagementRisksAssets;
