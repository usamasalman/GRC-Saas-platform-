import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';

interface SummaryRow {
  clientTenantId: string;
  client: string;
  rule: string;
  description: string;
  count: number;
  engagements: number;
  routes: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  consultingOn: boolean;
}

interface DetailRow {
  projectId: string;
  rule: string;
  route: string;
  count: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/**
 * The engagement guard in shadow (consulting engagement, sprint 5).
 *
 * For each organisation and rule: how many times the guard would have refused
 * a delivery firm's request had it been enforcing, on how many engagements
 * and routes, first and last seen. It is what decides when an organisation
 * can be switched to enforcing, one organisation at a time through the
 * "Consulting Engagements" overrides above. IDs only, never what the request
 * carried; rows not seen for 90 days are deleted.
 *
 * The platform's own screen: the server refuses anyone else, and so the
 * section hides itself for them.
 */
const EngagementShadow: React.FC = () => {
  const [rows, setRows] = useState<SummaryRow[] | null>(null);
  const [retention, setRetention] = useState(90);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ tenantId: string; rule: string } | null>(null);
  const [detail, setDetail] = useState<DetailRow[]>([]);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiClient.get('/api/engagements/shadow/summary');
      setRows(res.data?.summary || []);
      setRetention(res.data?.retentionDays || 90);
    } catch (err: any) {
      if (err?.response?.status === 403) { setRows(null); return; }
      setError(apiError(err, 'Could not load the shadow refusals.'));
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const show = async (r: SummaryRow) => {
    if (open && open.tenantId === r.clientTenantId && open.rule === r.rule) { setOpen(null); return; }
    try {
      const res = await apiClient.get('/api/engagements/shadow/summary', { params: { clientTenantId: r.clientTenantId } });
      setDetail((res.data?.rows || []).filter((d: DetailRow) => d.rule === r.rule));
      setOpen({ tenantId: r.clientTenantId, rule: r.rule });
    } catch (err) {
      setError(apiError(err, 'Could not load the detail.'));
    }
  };

  if (rows === null && !error) return null;

  return (
    <div style={{ ...S.card, marginTop: 18, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14, color: 'var(--ink)' }}>Engagement guard in shadow</strong>
        <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', maxWidth: 640 }}>
          Requests from delivery firms that the consulting rules would have refused, counted but let through.
          Switch an organisation to enforcing with a "Consulting Engagements" override once its count is understood.
          IDs only; kept {retention} days after last seen.
        </span>
        <button style={{ ...ghostBtn, marginLeft: 'auto', fontSize: 12, padding: '4px 10px' }} onClick={load}>↻ Refresh</button>
      </div>
      {error && <div style={{ ...S.error, margin: 12 }}>{error}</div>}
      {rows && rows.length === 0 && (
        <div style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--ink-muted)' }}>
          Nothing would have been refused so far.
        </div>
      )}
      {rows && rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={S.headRow}>
              <th style={S.th}>Organisation</th><th style={S.th}>Rule</th><th style={S.th}>Would have refused</th>
              <th style={S.th}>Engagements</th><th style={S.th}>First seen</th><th style={S.th}>Last seen</th><th style={S.th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={`${r.clientTenantId}|${r.rule}`}>
                <tr style={S.bodyRow}>
                  <td style={S.td}>
                    {r.client}{' '}
                    <span style={r.consultingOn ? pill('var(--success)', 'var(--success-line)') : pill('var(--ink-muted)', 'var(--line)')}>
                      {r.consultingOn ? 'consulting on' : 'consulting off'}
                    </span>
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }} title={r.description}>{r.rule}</td>
                  <td style={S.td}><strong>would have refused {r.count} time{r.count === 1 ? '' : 's'}</strong></td>
                  <td style={S.td}>{r.engagements} · {r.routes} route{r.routes === 1 ? '' : 's'}</td>
                  <td style={{ ...S.td, fontSize: 11.5 }}>{when(r.firstSeenAt)}</td>
                  <td style={{ ...S.td, fontSize: 11.5 }}>{when(r.lastSeenAt)}</td>
                  <td style={S.td}>
                    <button style={linkBtn('var(--info)')} onClick={() => show(r)}>
                      {open && open.tenantId === r.clientTenantId && open.rule === r.rule ? 'Hide' : 'Routes'}
                    </button>
                  </td>
                </tr>
                {open && open.tenantId === r.clientTenantId && open.rule === r.rule && detail.map((d) => (
                  <tr key={`${d.projectId}|${d.route}`} style={{ background: 'var(--surface)' }}>
                    <td style={{ ...S.td, fontSize: 11, color: 'var(--ink-muted)' }} colSpan={2}>engagement {d.projectId}</td>
                    <td style={{ ...S.td, fontSize: 11.5, fontFamily: 'monospace' }} colSpan={2}>{d.route} · {d.count}×</td>
                    <td style={{ ...S.td, fontSize: 11 }}>{when(d.firstSeenAt)}</td>
                    <td style={{ ...S.td, fontSize: 11 }} colSpan={2}>{when(d.lastSeenAt)}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default EngagementShadow;
