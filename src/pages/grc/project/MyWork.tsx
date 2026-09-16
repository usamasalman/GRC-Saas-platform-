import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, pill, ghostBtn, StatStrip, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * Everything assigned to one person, across every engagement.
 *
 * The product could answer "what is in this plan" and could not answer "what do
 * I have to do" — which is the question somebody opens it with. Every
 * multi-row task query in the API was scoped to a single project, and
 * ProjectTask has carried @@index([assigneeId, status]) since the module was
 * written with nothing reading it.
 *
 * Two rules this screen keeps, both of which it would be easy to break:
 *
 * Work is grouped by what the reader can ACT ON, not by how late it is. A list
 * sorted by lateness alone puts a task at the top that is overdue and blocked
 * on somebody else — work they cannot start. The two states where the next move
 * belongs to someone else are their own groups, at the bottom, and counted
 * separately in the headline.
 *
 * And a blocked row names its blocker. "Blocked" with nothing beside it is the
 * status everyone asks about and nobody can answer.
 */

interface Blocker {
  id: string;
  ref: string;
  title: string;
  owingSide: string;
}

interface WorkRow {
  id: string;
  ref: string;
  name: string;
  status: string;
  completionPercent: number;
  dueDate: string | null;
  priority: string;
  side: string;
  bucket: string;
  phase: { id: string; name: string } | null;
  project: {
    id: string; ref: string; name: string; status: string;
    client: string | null; provider: string | null;
  };
  blockers: Blocker[];
}

interface Summary {
  needsYou: number;
  waitingOnOthers: number;
  byBucket: Record<string, number>;
}

/** The reader-facing name for each bucket, and why it is in this group. */
const BUCKETS: { key: string; label: string; note: string; fg: string; line: string }[] = [
  {
    key: 'SentBack',
    label: 'Came back to you',
    note: 'A reviewer sent this back with a reason. Somebody is waiting on it specifically.',
    fg: 'var(--danger)',
    line: 'var(--danger-line)',
  },
  {
    key: 'Overdue',
    label: 'Overdue',
    note: 'Past the date on the plan, and nothing is standing in the way.',
    fg: 'var(--danger)',
    line: 'var(--danger-line)',
  },
  {
    key: 'DueSoon',
    label: 'Due soon',
    note: 'Within the next week.',
    fg: 'var(--warning)',
    line: 'var(--warning-line)',
  },
  {
    key: 'Open',
    label: 'Open',
    note: 'Yours to start, with no date pressing yet.',
    fg: 'var(--ink-body)',
    line: 'var(--line)',
  },
  {
    key: 'WithReviewer',
    label: 'With a reviewer',
    note: 'You have put this forward. The next move is theirs, not yours.',
    fg: 'var(--info)',
    line: 'var(--info-line)',
  },
  {
    key: 'Blocked',
    label: 'Blocked',
    note: 'Something is in the way and somebody owes it. You cannot start these.',
    fg: 'var(--ink-muted)',
    line: 'var(--line)',
  },
  {
    key: 'Done',
    label: 'Finished',
    note: 'Complete or independently confirmed.',
    fg: 'var(--success)',
    line: 'var(--success-line)',
  },
];

const PRIORITY_FG: Record<string, string> = {
  Critical: 'var(--danger)',
  High: 'var(--warning)',
  Medium: 'var(--ink-muted)',
  Low: 'var(--ink-faint)',
};

const MyWork: React.FC<{ onOpenProject?: (projectId: string) => void }> = ({ onOpenProject }) => {
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [includeDone, setIncludeDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(
        `/api/projects/my-work${includeDone ? '?includeDone=true' : ''}`,
      );
      setRows(res.data?.tasks || []);
      setSummary(res.data?.summary || null);
    } catch (err: any) {
      setError(apiError(err));
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [includeDone]);

  useEffect(() => { load(); }, [load]);

  if (loading && rows.length === 0) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading your work…</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>My work</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)', maxWidth: 640, lineHeight: 1.6 }}>
            Every task assigned to you, across every engagement you are on. Grouped by what you
            can act on rather than by date, so work that is waiting on somebody else does not sit
            at the top of your day.
          </p>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={ghostBtn} onClick={() => setIncludeDone((v) => !v)}>
            {includeDone ? 'Hide finished' : 'Show finished'}
          </button>
          <button style={ghostBtn} onClick={load}>Refresh</button>
        </span>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {summary && (
        // Two totals, never one. "You have 11 open items" is useless when six of
        // them are with a reviewer, and adding them together is the same kind of
        // figure that reads as an instruction when it is not one.
        <StatStrip items={[
          ['Needs you', summary.needsYou],
          ['Waiting on somebody else', summary.waitingOnOthers],
          ['Came back to you', summary.byBucket?.SentBack ?? 0],
          ['Overdue', summary.byBucket?.Overdue ?? 0],
        ]} />
      )}

      {rows.length === 0 && !error ? (
        <div style={{ ...S.card, padding: '48px 32px', textAlign: 'center', marginTop: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            Nothing is assigned to you
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 430, margin: '0 auto' }}>
            When somebody gives you a task on a delivery engagement it appears here, and you are
            told about it.
          </div>
        </div>
      ) : (
        BUCKETS.map((b) => {
          const inBucket = rows.filter((r) => r.bucket === b.key);
          if (inBucket.length === 0) return null;
          return (
            <div key={b.key} style={{ ...S.card, marginTop: 14, overflow: 'hidden' }}>
              <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--line)' }}>
                <span style={pill(b.fg, b.line)}>{b.label}</span>
                <span style={{ marginLeft: 8, fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>
                  {inBucket.length}
                </span>
                <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 5, lineHeight: 1.5 }}>
                  {b.note}
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                  <thead>
                    <tr>
                      {['Task', 'Engagement', 'Due', 'Progress', 'Priority'].map((h) => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inBucket.map((r) => (
                      <tr key={r.id}>
                        <td style={S.td}>
                          <div style={{ color: 'var(--ink)', fontWeight: 500 }}>{r.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                            {r.ref}
                            {r.phase && ` · ${r.phase.name}`}
                            {r.side === 'Provider' && ' · provider'}
                          </div>
                          {/* Named, not counted. */}
                          {r.blockers.map((bl) => (
                            <div key={bl.id} style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>
                              {bl.ref}: {bl.title} · owed by {bl.owingSide}
                            </div>
                          ))}
                        </td>
                        <td style={S.td}>
                          <button
                            style={{
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              color: 'var(--info)', fontSize: 12.5, textAlign: 'left',
                            }}
                            onClick={() => onOpenProject?.(r.project.id)}
                          >
                            {r.project.name}
                          </button>
                          <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                            {r.project.ref}
                            {r.project.provider && ` · delivered by ${r.project.provider}`}
                          </div>
                        </td>
                        <td style={{ ...S.td, fontSize: 12.5 }}>
                          {r.dueDate ? calendarDate(r.dueDate) : (
                            <span style={{ color: 'var(--ink-faint)' }}>no date</span>
                          )}
                        </td>
                        <td style={{ ...S.td, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                          {r.completionPercent}%
                        </td>
                        <td style={{ ...S.td, fontSize: 12, color: PRIORITY_FG[r.priority] || 'var(--ink-muted)' }}>
                          {r.priority}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default MyWork;
