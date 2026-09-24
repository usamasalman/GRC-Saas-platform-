import { useState, useEffect, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import PagingBar, { type PageInfo } from '../../components/PagingBar';
import { S, pill, ghostBtn, StatStrip, apiError } from '../iam/iamStyles';
import { calendarDate } from '../../utils/calendarDate';

/**
 * What this person has been asked to read, and — for whoever issued it — who
 * has not read it.
 *
 * This screen used to list EVERY published document in the organisation and put
 * a "Read & Acknowledge" button on each one, whether or not the reader had been
 * asked for it and whether or not they had already signed. Its own DocumentItem
 * interface declared `acknowledgedByMe` and nothing ever set it — the API did
 * not return it and the render never read it — so the button appeared on rows
 * already signed, and the second click produced a 409 rendered inside the
 * success banner.
 *
 * It was called a tracker and tracked nothing: the endpoint that answers "who
 * has signed" existed, routed, and no screen called it.
 *
 * Both halves are here now, and both rest on the acknowledgement REQUESTS that
 * publishing raises. Before those existed the coverage figure divided
 * signatures by every active user in the organisation, so a policy issued to
 * one department reported as a few percent read and the people who actually
 * owed it could not be named.
 */

interface RequestRow {
  documentId: string;
  version: string;
  requestedAt: string;
  dueAt: string | null;
  acknowledgedByMe: boolean;
  document: {
    id: string;
    code: string;
    title: string;
    category: string;
    classification: string;
    status: string;
    publishedAt: string | null;
    owner?: { name: string } | null;
  };
}

interface Outstanding {
  userId: string;
  name: string;
  email: string | null;
  role: string | null;
  department: string | null;
  requestedAt: string;
  dueAt: string | null;
}

interface Coverage {
  requested: number;
  signed: number;
  outstanding: number;
  percent: number | null;
  caveat: string | null;
}

export default function AcknowledgementTracker() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Paged (QA-021); the two counts above the list cover every request.
  const [page, setPage] = useState(1);
  const [paging, setPaging] = useState<PageInfo | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // The coverage half, opened per document.
  const [tracking, setTracking] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<{
    coverage: Coverage;
    outstanding: Outstanding[];
    audience: { kind: string; value: string | null } | null;
    version: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/documents/my-acknowledgements', { params: { page } });
      setRows(res.data?.requests || []);
      setPaging(res.data?.paging || null);
      setWaiting(res.data?.outstanding ?? 0);
    } catch (e: any) {
      setError(apiError(e, 'Your acknowledgements could not be loaded.'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const acknowledge = async (r: RequestRow) => {
    setBusy(r.documentId);
    setError('');
    setNotice('');
    try {
      await apiClient.post(`/api/documents/${r.documentId}/acknowledge`);
      setNotice(`Acknowledged ${r.document.code}.`);
      await load();
    } catch (e: any) {
      setError(apiError(e, 'The acknowledgement could not be recorded.'));
    } finally {
      setBusy(null);
    }
  };

  const openTracker = async (documentId: string) => {
    setTracking(documentId);
    setCoverage(null);
    setError('');
    try {
      const res = await apiClient.get(`/api/documents/${documentId}/acknowledgements`);
      setCoverage({
        coverage: res.data?.coverage,
        outstanding: res.data?.outstanding || [],
        audience: res.data?.audience || null,
        version: res.data?.version || '',
      });
    } catch (e: any) {
      setError(apiError(e, 'The coverage could not be loaded.'));
      setTracking(null);
    }
  };

  // Only a fallback for the count before the server's paging arrives.
  const signed = rows.filter((r) => r.acknowledgedByMe);

  if (loading && rows.length === 0) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 24 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: 'var(--ink)' }}>Policy acknowledgements</h1>
        <p style={{ margin: '5px 0 0', color: 'var(--ink-muted)', fontSize: 13, maxWidth: 640, lineHeight: 1.6 }}>
          What you have been asked to read. Only documents issued to you appear here — this is
          not every published policy in the organisation.
        </p>
      </header>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ ...S.card, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: 'var(--success)' }}>
          {notice}
        </div>
      )}

      <StatStrip items={[
        ['Waiting on you', waiting],
        ['Acknowledged', paging ? paging.total - waiting : signed.length],
      ]} />

      {rows.length === 0 ? (
        <div style={{ ...S.card, padding: '48px 32px', textAlign: 'center', marginTop: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            Nothing has been issued to you
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
            When a policy is published to an audience you are part of, it appears here and you
            are told about it.
          </div>
        </div>
      ) : (
        <div style={{ ...S.card, marginTop: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  {['Policy', 'Version', 'Asked', 'Due', 'Status', ''].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.documentId}-${r.version}`}>
                    <td style={S.td}>
                      <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{r.document.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                        {r.document.code} · {r.document.category}
                        {r.document.owner?.name && ` · owned by ${r.document.owner.name}`}
                      </div>
                    </td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>v{r.version}</td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>{calendarDate(r.requestedAt)}</td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>
                      {r.dueAt ? calendarDate(r.dueAt) : <span style={{ color: 'var(--ink-faint)' }}>—</span>}
                    </td>
                    <td style={S.td}>
                      {r.acknowledgedByMe
                        ? <span style={pill('var(--success)', 'var(--success-line)')}>Acknowledged</span>
                        : <span style={pill('var(--warning)', 'var(--warning-line)')}>Waiting on you</span>}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {/* Offered only where it can succeed. The button used to
                          render on every row, so signing twice produced a 409
                          shown in the success banner. */}
                      {!r.acknowledgedByMe && (
                        <button
                          style={ghostBtn}
                          disabled={busy === r.documentId}
                          onClick={() => acknowledge(r)}
                        >
                          {busy === r.documentId ? 'Recording…' : 'I have read this'}
                        </button>
                      )}
                      <button
                        style={{ ...ghostBtn, marginLeft: 6 }}
                        onClick={() => openTracker(r.documentId)}
                        title="Who else has been asked, and who has not signed"
                      >
                        Coverage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PagingBar paging={paging} onPage={setPage} noun="documents" disabled={loading} />
        </div>
      )}

      {tracking && (
        <div style={{ ...S.card, marginTop: 16, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <strong style={{ fontSize: 14, color: 'var(--ink)' }}>Coverage</strong>
            {coverage?.audience && (
              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                issued to {coverage.audience.kind === 'Everyone'
                  ? 'everyone'
                  : `${coverage.audience.kind.toLowerCase()} “${coverage.audience.value}”`}
                {coverage.version && ` · v${coverage.version}`}
              </span>
            )}
            <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={() => setTracking(null)}>
              Close
            </button>
          </div>

          {!coverage ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Loading…</div>
          ) : coverage.coverage?.caveat ? (
            // An em dash and a reason, never a zero or a hundred. Both of those
            // read as a finding when the truth is that nobody was asked.
            <div style={{
              padding: '10px 12px', borderRadius: 6,
              background: 'var(--warning-bg)', border: '1px solid var(--warning-line)',
              fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.6,
            }}>
              {coverage.coverage.caveat}
            </div>
          ) : (
            <>
              <StatStrip items={[
                ['Asked', coverage.coverage.requested],
                ['Signed', coverage.coverage.signed],
                ['Outstanding', coverage.coverage.outstanding],
                ['Read', `${coverage.coverage.percent}%`],
              ]} />

              {coverage.outstanding.length > 0 ? (
                <>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '12px 0 6px' }}>
                    {/* Named, not counted. The whole point of a tracker. */}
                    Has not signed yet:
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                      <thead>
                        <tr>{['Name', 'Role', 'Department', 'Asked'].map((h) => (
                          <th key={h} style={S.th}>{h}</th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {coverage.outstanding.map((o) => (
                          <tr key={o.userId}>
                            <td style={S.td}>
                              <div style={{ color: 'var(--ink)' }}>{o.name}</div>
                              {o.email && (
                                <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{o.email}</div>
                              )}
                            </td>
                            <td style={{ ...S.td, fontSize: 12.5 }}>{o.role || '—'}</td>
                            <td style={{ ...S.td, fontSize: 12.5 }}>{o.department || '—'}</td>
                            <td style={{ ...S.td, fontSize: 12.5 }}>{calendarDate(o.requestedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--success)', marginTop: 10 }}>
                  Everyone asked has acknowledged this version.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
