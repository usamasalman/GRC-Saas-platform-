import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/apiClient';
import { ReasonDialog } from '../../../components/Dialog';
import { S, pill, ghostBtn, apiError } from '../../iam/iamStyles';

/**
 * The evidence register, and how far the plan traces back to a framework.
 *
 * Two things this screen is careful about:
 *
 *   - it never links to a file directly. Every download goes through an
 *     authenticated endpoint, because the platform's other file path is an
 *     unauthenticated static mount and that is the mistake this module avoids.
 *   - coverage is shown as two numbers. Clauses a plan MENTIONS are an
 *     intention; clauses whose every task is finished are something an
 *     organisation can defend. One number would let a project claim coverage it
 *     has not delivered.
 */

interface Person { id: string; name: string }

interface Evidence {
  id: string;
  ref: string;
  title: string;
  description: string | null;
  classification: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
  side: string;
  uploadedInRound: number;
  uploadedAt: string;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
  standing: 'Seen' | 'Pending' | 'Withdrawn' | 'AddedLater';
  uploadedBy: Person | null;
  withdrawnBy: Person | null;
  task: { id: string; ref: string; name: string; status: string } | null;
}

interface Coverage {
  clausesCovered: number;
  clausesSatisfied: number;
  tasksMapped: number;
  tasksTotal: number;
  mappedPercent: number;
  byStandard: Record<string, { covered: number; satisfied: number }>;
}

const STANDING: Record<string, { label: string; fg: string; line: string }> = {
  Seen: { label: 'Seen at sign-off', fg: 'var(--success)', line: 'var(--success-line)' },
  Pending: { label: 'Not yet reviewed', fg: 'var(--ink-muted)', line: 'var(--line)' },
  Withdrawn: { label: 'Withdrawn', fg: 'var(--ink-faint)', line: 'var(--line)' },
  AddedLater: { label: 'Added after sign-off', fg: 'var(--danger)', line: 'var(--danger-line)' },
};

const CLASSIFICATION: Record<string, string> = {
  Public: 'var(--ink-muted)',
  Internal: 'var(--info)',
  Confidential: 'var(--warning)',
  Restricted: 'var(--danger)',
};

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B`
    : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—';

const ProjectEvidence: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [items, setItems] = useState<Evidence[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/api/projects/${projectId}/evidence`);
      setItems(res.data?.evidence || []);
      setCoverage(res.data?.coverage || null);
      setSummary(res.data?.summary || null);
    } catch (err: any) {
      setError(apiError(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Fetch the file through the authenticated endpoint and hand it to the
   * browser from memory.
   *
   * Deliberately not an <a href> to the API: the file is not reachable without
   * an Authorization header, which is the entire point of the store.
   */
  const download = async (ev: Evidence) => {
    setBusy(ev.id);
    setError('');
    try {
      const res = await apiClient.get(
        `/api/projects/evidence/${ev.id}/download`, { responseType: 'blob' },
      );
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = ev.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  };

  // The reason was collected by a prompt and its length checked afterwards, so
  // "too short" arrived as an error on a screen the text had already left.
  const [withdrawing, setWithdrawing] = useState<Evidence | null>(null);

  const withdraw = async (ev: Evidence, reason: string) => {
    setWithdrawing(null);
    setBusy(ev.id);
    setError('');
    try {
      await apiClient.post(`/api/projects/evidence/${ev.id}/withdraw`, { reason: reason.trim() });
      await load();
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  };

  const runIntegrity = async () => {
    setBusy('integrity');
    setError('');
    try {
      const res = await apiClient.get(`/api/projects/${projectId}/evidence/integrity`);
      setIntegrity(res.data);
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading the evidence register…</div>;
  }

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}

      {/* ── Traceability ───────────────────────────────────────────────── */}
      {coverage && (
        <div style={{ ...S.card, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {coverage.clausesSatisfied}
                <span style={{ fontSize: 15, color: 'var(--ink-faint)' }}>/{coverage.clausesCovered}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>clauses defensible</div>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                {coverage.mappedPercent}%
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                of work mapped ({coverage.tasksMapped}/{coverage.tasksTotal})
              </div>
            </div>
            {Object.entries(coverage.byStandard).map(([code, c]) => (
              <div key={code}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.satisfied}<span style={{ color: 'var(--ink-faint)' }}>/{c.covered}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{code}</div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button style={ghostBtn} disabled={busy === 'integrity'} onClick={runIntegrity}>
                Check integrity
              </button>
              <button style={ghostBtn} onClick={load}>Refresh</button>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 10 }}>
            A clause counts as defensible only when every task mapped to it is finished.
            The rest are claimed, not delivered.
          </div>

          {integrity && (
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)',
              fontSize: 12.5,
              color: integrity.altered > 0 || integrity.missing > 0 ? 'var(--danger)' : 'var(--success)',
            }}>
              {integrity.checked} file(s) re-read: {integrity.intact} intact
              {integrity.altered > 0 && `, ${integrity.altered} ALTERED`}
              {integrity.missing > 0 && `, ${integrity.missing} missing`}
              {integrity.altered === 0 && integrity.missing === 0
                && ' — every file still hashes to what was recorded at upload.'}
            </div>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{ ...S.card, padding: '44px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            No evidence yet
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 480, margin: '0 auto' }}>
            Attach deliverables to the tasks that produced them from the Plan tab. Under the
            evidence-led policy, attaching one is what sends the task to an independent reviewer.
          </div>
        </div>
      ) : (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          {summary && (
            <div style={{
              padding: '10px 18px', borderBottom: '1px solid var(--line)',
              fontSize: 12, color: 'var(--ink-muted)',
            }}>
              {summary.standing} standing · {summary.withdrawn} withdrawn · {fmtBytes(summary.bytes)}
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {['Evidence', 'Against', 'Class', 'Size', 'Standing', ''].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((e) => {
                  const st = STANDING[e.standing] || STANDING.Pending;
                  return (
                    <tr key={e.id} style={busy === e.id ? { opacity: 0.55 } : undefined}>
                      <td style={S.td}>
                        <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{e.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                          {e.ref} · {e.fileName} · {fmtDate(e.uploadedAt)}
                          {e.uploadedBy && ` by ${e.uploadedBy.name}`}
                        </div>
                        {e.withdrawnReason && (
                          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 3 }}>
                            Withdrawn: “{e.withdrawnReason}”
                          </div>
                        )}
                      </td>
                      <td style={{ ...S.td, fontSize: 12.5 }}>
                        {e.task
                          ? <span><span style={{ color: 'var(--ink-faint)' }}>{e.task.ref}</span> {e.task.name}</span>
                          : '—'}
                      </td>
                      <td style={S.td}>
                        <span style={pill(CLASSIFICATION[e.classification] || 'var(--ink-muted)', 'var(--line)')}>
                          {e.classification}
                        </span>
                      </td>
                      <td style={{ ...S.td, textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtBytes(e.fileSize)}
                      </td>
                      <td style={S.td}>
                        <span style={pill(st.fg, st.line)}>{st.label}</span>
                      </td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        <button style={ghostBtn} disabled={busy === e.id} onClick={() => download(e)}>
                          Download
                        </button>
                        {!e.withdrawnAt && (
                          <button
                            style={{ ...ghostBtn, marginLeft: 6 }}
                            disabled={busy === e.id}
                            onClick={() => setWithdrawing(e)}
                          >
                            Withdraw
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {withdrawing && (
        <ReasonDialog
          title={`Withdraw ${withdrawing.ref}?`}
          confirmLabel="Withdraw evidence"
          label="Why is this being withdrawn?"
          message={(
            <>
              The file stays on the record marked withdrawn rather than disappearing. Anything
              a verifier already relied on cannot be withdrawn at all.
            </>
          )}
          onConfirm={(reason) => withdraw(withdrawing, reason)}
          onCancel={() => setWithdrawing(null)}
        />
      )}
    </div>
  );
};

export default ProjectEvidence;
