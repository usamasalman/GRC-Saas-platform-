import React, { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, ghostBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';
import { STYLE_LABEL } from './EngagementPanel';

/**
 * Completed engagements (consulting engagement, sprint 7): the delivery firm's
 * own records, frozen when each engagement closed and kept in the firm's
 * tenant for good.
 *
 * A record holds the firm's work, not the client's records: the dates, the
 * team, the phases and tasks with planned, actual and variance, the delay
 * ledger, and the copies of issued reports the client allowed it to keep.
 * While the window after close is open the engagement itself can still be
 * opened, read-only; after it, this record is what the firm has.
 */

interface RecordRow {
  id: string; ref: string; name: string; clientName: string; outcome: string; deliveryStyle: string | null;
  startDate: string; targetEndDate: string; closedAt: string; varianceDays: number | null; reportCopies: number;
}
interface Span { start: string | null; finish: string | null }
interface Detail extends RecordRow {
  projectId: string | null; projectType: string; windowUntil: string | null; windowOpen: boolean;
  madeBy: { name: string } | null;
  team: { name: string; side: string; engagementRole: string | null; roleLabel?: string; status?: string; accessFrom?: string | null; accessTo?: string | null }[];
  plan: { name: string; planned: Span; actual: Span & { forecast: boolean }; varianceDays: number | null;
    tasks: { ref: string; name: string; side: string; status: string; planned: Span | null; actual: (Span & { forecast: boolean }) | null; varianceDays: number | null }[] }[];
  figures: { planned?: Span; agreedFinish?: string | null; actual?: Span & { forecast: boolean }; varianceDays?: number | null; reportedProgress?: number; verifiedProgress?: number; baselineVersion?: number };
  delayLedger: { ref: string; kind: string; category: string; owingSide: string; title: string; raisedAt: string | null; resolvedAt: string | null; days: number }[];
}
interface Copy { id: string; reportName: string; documentRef: string; issueNumber: number; format: string; fileName: string; byteLength: number; issuedAt: string }

const PAGE = 25;
const fmt = (d: string | null | undefined) => calendarDate(d, { day: '2-digit', month: 'short', year: 'numeric' });
const variance = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n === 0 ? 'on time' : n > 0 ? `${n} days late` : `${-n} days early`);
const span = (s: Span | null | undefined) => (s ? `${fmt(s.start)} → ${fmt(s.finish)}` : '—');

const CompletedEngagements: React.FC<{ onOpen?: (p: { id: string; ref: string; name: string }) => void }> = ({ onOpen }) => {
  const [rows, setRows] = useState<RecordRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<{ record: Detail; copies: Copy[]; page: number; more: boolean } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    apiClient.get('/api/engagements/records', { params: { page, pageSize: PAGE } })
      .then((r) => {
        setRows(r.data?.records || []);
        setHasMore(Boolean(r.data?.paging?.hasMore));
        setTotal(Number(r.data?.paging?.total ?? 0));
      })
      .catch((err) => { setError(apiError(err, 'Could not load completed engagements.')); setRows([]); });
  }, [page]);

  // The copies come a page at a time; "More copies" adds the next page.
  const show = async (id: string, page = 1) => {
    setError('');
    try {
      const r = await apiClient.get(`/api/engagements/records/${id}`, { params: { page, pageSize: 50 } });
      setOpen((prev) => ({
        record: r.data.record,
        copies: [...(page > 1 && prev ? prev.copies : []), ...(r.data.reportCopies || [])],
        page, more: Boolean(r.data.paging?.hasMore),
      }));
    } catch (err) {
      setError(apiError(err, 'Could not open the record.'));
    }
  };

  const download = async (c: Copy) => {
    setError('');
    try {
      const res = await apiClient.get(`/api/engagements/report-copies/${c.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = c.fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiError(err, 'Could not download the copy.'));
    }
  };

  if (open) {
    const r = open.record;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <button style={ghostBtn} onClick={() => setOpen(null)}>Back to completed engagements</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{r.ref} · {r.name}</span>
          <span style={pill('var(--ink-muted)', 'var(--line)')}>{r.outcome}</span>
          {r.windowOpen && r.projectId && onOpen && (
            <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={() => onOpen({ id: r.projectId!, ref: r.ref, name: r.name })}>
              Open engagement (read-only)
            </button>
          )}
        </div>
        {error && <div style={{ ...S.error, marginBottom: 12 }}>{error}</div>}
        <div style={{ ...S.card, padding: 16, marginBottom: 14, fontSize: 13, lineHeight: 1.8 }}>
          <div>Client: <strong>{r.clientName}</strong> · {STYLE_LABEL[r.deliveryStyle || ''] || 'Set up the old way'} · {r.projectType}</div>
          <div>Planned {span(r.figures.planned)} · closed {fmt(r.closedAt)} · {variance(r.figures.varianceDays)}</div>
          <div>Progress at close: reported {r.figures.reportedProgress ?? '—'}% · verified {r.figures.verifiedProgress ?? '—'}%</div>
          <div style={{ color: 'var(--ink-muted)' }}>
            {r.windowUntil
              ? (r.windowOpen ? `The client lets the firm read it, read-only, until ${fmt(new Date(Date.parse(r.windowUntil) - 1).toISOString())}.` : `The window after close ended ${fmt(r.windowUntil)}; this record is what the firm keeps.`)
              : 'This record is what the firm keeps.'}
            {' '}Kept {fmt(r.closedAt)}{r.madeBy ? `, when ${r.madeBy.name} closed it` : ''}.
          </div>
        </div>

        <div style={{ ...S.card, marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13 }}>Plan: planned, actual and variance</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Phase / task</th><th style={S.th}>Planned</th><th style={S.th}>Actual</th><th style={S.th}>Variance</th></tr></thead>
            <tbody>
              {r.plan.map((ph) => (
                <React.Fragment key={ph.name}>
                  <tr>
                    <td style={{ ...S.td, fontWeight: 600 }}>{ph.name}</td>
                    <td style={S.td}>{span(ph.planned)}</td>
                    <td style={S.td}>{span(ph.actual)}{ph.actual?.forecast ? ' (forecast)' : ''}</td>
                    <td style={S.td}>{variance(ph.varianceDays)}</td>
                  </tr>
                  {ph.tasks.map((t) => (
                    <tr key={`${ph.name}-${t.ref}`}>
                      <td style={{ ...S.td, paddingLeft: 28, fontSize: 12.5 }}>{t.ref} · {t.name} <span style={{ color: 'var(--ink-muted)' }}>({t.status})</span></td>
                      <td style={{ ...S.td, fontSize: 12.5 }}>{span(t.planned)}</td>
                      <td style={{ ...S.td, fontSize: 12.5 }}>{span(t.actual)}{t.actual?.forecast ? ' (forecast)' : ''}</td>
                      <td style={{ ...S.td, fontSize: 12.5 }}>{variance(t.varianceDays)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
          <div style={{ ...S.card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13 }}>Delay ledger</div>
            {r.delayLedger.length === 0
              ? <div style={{ padding: '0 16px 12px', fontSize: 12.5, color: 'var(--ink-muted)' }}>Nothing was recorded against the plan.</div>
              : r.delayLedger.map((d) => (
                <div key={d.ref} style={{ padding: '6px 16px', borderTop: '1px solid var(--line-soft)', fontSize: 12.5 }}>
                  {d.ref} · {d.title}
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                    {d.kind} · owed by {d.owingSide} · {d.days} day{d.days === 1 ? '' : 's'} · {fmt(d.raisedAt)}{d.resolvedAt ? ` → ${fmt(d.resolvedAt)}` : ' · open at close'}
                  </div>
                </div>
              ))}
          </div>
          <div style={{ ...S.card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13 }}>Team</div>
            {r.team.map((m, i) => (
              <div key={`${m.name}-${i}`} style={{ padding: '6px 16px', borderTop: '1px solid var(--line-soft)', fontSize: 12.5 }}>
                {m.name} · {m.engagementRole || m.roleLabel || '—'}
                <span style={{ color: 'var(--ink-muted)' }}>
                  {' '}· {m.side === 'Firm' ? 'firm' : 'the client'}{m.accessFrom ? ` · ${fmt(m.accessFrom)} → ${fmt(m.accessTo)}` : ''}{m.status === 'Removed' ? ' · removed' : ''}
                </span>
              </div>
            ))}
          </div>
          <div style={{ ...S.card, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13 }}>Report copies</div>
            {open.copies.length === 0
              ? <div style={{ padding: '0 16px 12px', fontSize: 12.5, color: 'var(--ink-muted)' }}>The client kept no copies for the firm, or issued none while it allowed them.</div>
              : open.copies.map((c) => (
                <div key={c.id} style={{ padding: '6px 16px', borderTop: '1px solid var(--line-soft)', fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span>{c.reportName} · issue {c.issueNumber} · {c.format.toUpperCase()}<br />
                    <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{c.documentRef} · issued {fmt(c.issuedAt)}</span>
                  </span>
                  <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5, marginLeft: 'auto' }} onClick={() => download(c)}>Download copy</button>
                </div>
              ))}
            {open.more && (
              <div style={{ padding: '6px 16px', borderTop: '1px solid var(--line-soft)' }}>
                <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} onClick={() => show(r.id, open.page + 1)}>More copies</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 12 }}>
        Each engagement your firm delivered, kept as it stood when it closed: the dates, the team, the plan against what happened, the delay ledger and the report copies the client allowed.
      </div>
      {error && <div style={{ ...S.error, marginBottom: 12 }}>{error}</div>}
      {rows === null ? <div style={{ color: 'var(--ink-muted)', padding: 20 }}>Loading…</div> : rows.length === 0 ? (
        <div style={{ ...S.card, padding: 16, fontSize: 13, color: 'var(--ink-muted)' }}>No engagement your firm delivered has closed yet.</div>
      ) : (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Engagement</th><th style={S.th}>Client</th><th style={S.th}>Closed</th><th style={S.th}>Variance</th><th style={S.th}>Report copies</th><th style={S.th} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={S.td}><strong>{r.ref}</strong> · {r.name}<div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.outcome}</div></td>
                  <td style={S.td}>{r.clientName}</td>
                  <td style={S.td}>{fmt(r.closedAt)}</td>
                  <td style={S.td}>{variance(r.varianceDays)}</td>
                  <td style={S.td}>{r.reportCopies}</td>
                  <td style={{ ...S.td, textAlign: 'right' }}><button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} onClick={() => show(r.id)}>Open record</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px', fontSize: 12, color: 'var(--ink-muted)' }}>
            {total} record{total === 1 ? '' : 's'}
            <button style={{ ...ghostBtn, marginLeft: 'auto', padding: '3px 10px', fontSize: 11.5 }} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompletedEngagements;
