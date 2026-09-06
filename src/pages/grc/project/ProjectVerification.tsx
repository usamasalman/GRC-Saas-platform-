import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/apiClient';
import { S, pill, ghostBtn, apiError } from '../../iam/iamStyles';

/**
 * The reviewer's view of one engagement: what is waiting on a decision, what
 * came back rejected, and every decision taken so far.
 *
 * The plan screen answers "what is the state of the work". This answers "what
 * do I need to look at, and what has already been signed off" — which is the
 * question an auditor arrives with, and the reason the queue and the record sit
 * on the same page rather than in two places.
 */

interface Person { id: string; name: string }

interface QueueTask {
  id: string;
  ref: string;
  name: string;
  status: string;
  completionPercent: number;
  dueDate: string | null;
  submittedAt: string | null;
  verificationRound: number;
  assignee: Person | null;
  submittedBy: Person | null;
  verifiedBy: Person | null;
  phase: { id: string; name: string; sequence: number } | null;
  timing: {
    overdue: boolean;
    daysOverdue: number;
    awaitingVerificationDays: number | null;
    verificationOverdue: boolean;
  };
  canVerify?: boolean;
  blockedReason?: string | null;
}

interface Decision {
  id: string;
  round: number;
  outcome: string;
  actorSide: string;
  note: string | null;
  reportedPercent: number;
  createdAt: string;
  actor: Person | null;
  task: { id: string; ref: string; name: string } | null;
}

interface Payload {
  verificationPolicy: string;
  canVerify: boolean;
  slaDays: number;
  queue: QueueTask[];
  rejected: QueueTask[];
  history: Decision[];
  summary: {
    awaiting: number; rejected: number; overdueReview: number;
    verifiableByYou: number; decisions: number;
  };
}

const OUTCOME: Record<string, { label: string; fg: string; line: string }> = {
  Submitted: { label: 'Submitted', fg: 'var(--info)', line: 'var(--info-line)' },
  Accepted: { label: 'Accepted', fg: 'var(--success)', line: 'var(--success-line)' },
  Rejected: { label: 'Sent back', fg: 'var(--danger)', line: 'var(--danger-line)' },
  Withdrawn: { label: 'Withdrawn', fg: 'var(--ink-muted)', line: 'var(--line)' },
  Reopened: { label: 'Reopened', fg: 'var(--warning)', line: 'var(--warning-line)' },
};

const POLICY_LABEL: Record<string, string> = {
  EveryTask: 'Every task is independently verified',
  SelectedTasks: 'Selected tasks are independently verified',
  None: 'This engagement does not use independent verification',
};

const fmtDateTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : '—';

const ProjectVerification: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/api/projects/${projectId}/verification`);
      setData(res.data);
    } catch (err: any) {
      setError(apiError(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Record a decision, then reload.
   *
   * Unlike the plan screen this does refetch: a decision moves a task out of
   * the queue and adds a row to the record, and patching both lists by hand
   * would be reimplementing the query that just changed.
   */
  const decide = async (task: QueueTask, decision: 'Accept' | 'Reject') => {
    let note: string | undefined;
    if (decision === 'Reject') {
      const answer = window.prompt(`Why is ${task.ref} being sent back?`);
      if (answer === null) return;
      if (answer.trim().length < 10) {
        setError('That reason is too short — the record needs a sentence, not a word.');
        return;
      }
      note = answer.trim();
    }

    setBusy(task.id);
    setError('');
    try {
      await apiClient.post(`/api/projects/tasks/${task.id}/verify`, { decision, note });
      await load();
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading verification…</div>;
  }
  if (!data) {
    return <div style={{ ...S.error }}>{error || 'Verification is unavailable for this project.'}</div>;
  }

  const { summary } = data;

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}

      <div style={{
        display: 'flex', gap: 18, marginBottom: 16, flexWrap: 'wrap',
        fontSize: 12.5, alignItems: 'center',
      }}>
        <span style={{ color: 'var(--ink-muted)' }}>
          {POLICY_LABEL[data.verificationPolicy] || data.verificationPolicy}
        </span>
        {summary.awaiting > 0 && (
          <span style={{ color: 'var(--ink-muted)' }}>
            <strong style={{ color: 'var(--ink)' }}>{summary.awaiting}</strong> awaiting a decision
          </span>
        )}
        {summary.overdueReview > 0 && (
          <span style={{ color: 'var(--danger)' }}>
            <strong>{summary.overdueReview}</strong> waiting over {data.slaDays} days
          </span>
        )}
        {summary.rejected > 0 && (
          <span style={{ color: 'var(--danger)' }}><strong>{summary.rejected}</strong> sent back</span>
        )}
        <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={load}>Refresh</button>
      </div>

      {!data.canVerify && (
        <div style={{
          ...S.card, padding: '12px 16px', marginBottom: 14,
          borderLeft: '3px solid var(--info)', fontSize: 12.5, color: 'var(--ink-muted)',
        }}>
          You can follow this queue but not decide on it — accepting or rejecting delivered
          work needs the verification capability.
        </div>
      )}

      {/* ── The queue ─────────────────────────────────────────────────── */}
      <div style={{ ...S.card, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>
          Waiting on a decision
        </div>
        {data.queue.length === 0 ? (
          <div style={{ padding: '28px 18px', fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center' }}>
            Nothing is waiting on a reviewer.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
              <thead>
                <tr>
                  {['Task', 'Phase', 'Submitted by', 'Waiting', 'Decision'].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.queue.map((t) => (
                  <tr key={t.id} style={busy === t.id ? { opacity: 0.55 } : undefined}>
                    <td style={S.td}>
                      <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                        {t.ref}
                        {t.verificationRound > 1 && ` · round ${t.verificationRound}`}
                      </div>
                    </td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>{t.phase?.name || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>
                      {t.submittedBy?.name || '—'}
                      <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
                        {fmtDateTime(t.submittedAt)}
                      </div>
                    </td>
                    <td style={{
                      ...S.td, fontSize: 12.5, fontVariantNumeric: 'tabular-nums',
                      color: t.timing.verificationOverdue ? 'var(--danger)' : 'var(--ink-body)',
                    }}>
                      {t.timing.awaitingVerificationDays ?? 0}d
                    </td>
                    <td style={S.td}>
                      {t.canVerify ? (
                        <>
                          <button
                            style={{ ...ghostBtn, color: 'var(--success)', borderColor: 'var(--success-line)', marginRight: 8 }}
                            disabled={busy === t.id}
                            onClick={() => decide(t, 'Accept')}
                          >
                            Accept
                          </button>
                          <button
                            style={{ ...ghostBtn, color: 'var(--danger)', borderColor: 'var(--danger-line)' }}
                            disabled={busy === t.id}
                            onClick={() => decide(t, 'Reject')}
                          >
                            Send back
                          </button>
                        </>
                      ) : (
                        // Listed rather than hidden: an item that vanishes from a
                        // queue because of a rule the user cannot see is a support
                        // ticket. One that explains itself is not.
                        <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
                          {t.blockedReason || 'Not yours to decide'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Sent back ─────────────────────────────────────────────────── */}
      {data.rejected.length > 0 && (
        <div style={{ ...S.card, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>
            Sent back for rework
          </div>
          <div style={{ padding: '4px 0' }}>
            {data.rejected.map((t) => (
              <div key={t.id} style={{
                padding: '10px 18px', display: 'flex', gap: 12,
                alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5,
              }}>
                <span style={{ color: 'var(--ink-faint)', fontSize: 11, minWidth: 66 }}>{t.ref}</span>
                <span style={{ color: 'var(--ink)', flex: 1, minWidth: 200 }}>{t.name}</span>
                <span style={{ color: 'var(--ink-muted)' }}>{t.assignee?.name || 'Unassigned'}</span>
                <span style={pill('var(--danger)', 'var(--danger-line)')}>
                  round {t.verificationRound}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── The record ────────────────────────────────────────────────── */}
      <div style={{ ...S.card, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>
          Verification record
          <span style={{ fontWeight: 400, color: 'var(--ink-faint)', fontSize: 12, marginLeft: 8 }}>
            every decision, most recent first
          </span>
        </div>
        {data.history.length === 0 ? (
          <div style={{ padding: '28px 18px', fontSize: 13, color: 'var(--ink-muted)', textAlign: 'center' }}>
            No verification decisions have been recorded yet.
          </div>
        ) : (
          <div>
            {data.history.map((h) => {
              const o = OUTCOME[h.outcome] || { label: h.outcome, fg: 'var(--ink-muted)', line: 'var(--line)' };
              return (
                <div key={h.id} style={{
                  padding: '12px 18px', borderTop: '1px solid var(--line-soft)',
                  display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap',
                }}>
                  <span style={pill(o.fg, o.line)}>{o.label}</span>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                      <span style={{ color: 'var(--ink-faint)' }}>{h.task?.ref}</span>{' '}
                      {h.task?.name}
                    </div>
                    {h.note && (
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3 }}>
                        “{h.note}”
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-faint)', textAlign: 'right' }}>
                    {h.actor?.name || 'Unknown'} · {h.actorSide}
                    <div>round {h.round} · {fmtDateTime(h.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectVerification;
