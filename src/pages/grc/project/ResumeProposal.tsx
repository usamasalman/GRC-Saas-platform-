import React, { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell from '../../../components/Dialog';
import { S, primaryBtn, ghostBtn, linkBtn, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

interface Person {
  memberId: string;
  name: string;
  engagementRole: string | null;
  currentEnd: string;
  proposedEnd: string;
}

interface Proposal {
  holds: number;
  startedAt: string;
  endedAt: string;
  days: number;
  /** The engagement's own access window, offered the same days; null when it has none yet. */
  engagement: { currentEnd: string; proposedEnd: string } | null;
  people: Person[];
}

interface Row extends Person { ticked: boolean; date: string }

const day = (iso: string) => iso.slice(0, 10);
// A hold's start and end are instants, read in the reader's own day; an end of
// access is a calendar date (calendarDate).
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

/**
 * After a consulting engagement resumes: give the firm's people back the days
 * the hold took (consulting engagement, sprint 5).
 *
 * One screen, each person's current end of access beside the proposed one,
 * all ticked, and above them the engagement's own access window, which every
 * person's sits inside. The organisation unticks or edits and confirms once;
 * the server writes one audit entry per change. The engagement's target end is not
 * moved here: the Gantt already counts those days as on hold, against nobody,
 * and "Rebaseline" is how the dates are agreed again.
 */
const ResumeProposal: React.FC<{
  projectId: string;
  onDone: () => void;
  /** Offered when the plan has a baseline to re-agree. */
  onRebaseline?: () => void;
}> = ({ projectId, onDone, onRebaseline }) => {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [engagementEnd, setEngagementEnd] = useState<{ ticked: boolean; date: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.get(`/api/engagements/${projectId}/resume-proposal`)
      .then((res) => {
        const p: Proposal | null = res.data?.proposal || null;
        setProposal(p);
        // A hold of less than a day moves nobody's date: nothing to tick.
        setRows(p && p.days > 0 ? p.people.map((x) => ({ ...x, ticked: true, date: day(x.proposedEnd) })) : []);
        setEngagementEnd(p && p.days > 0 && p.engagement ? { ticked: true, date: day(p.engagement.proposedEnd) } : null);
      })
      .catch((err) => setError(apiError(err, 'The proposal could not be loaded.')))
      .finally(() => setLoaded(true));
  }, [projectId]);

  const settle = async (changes: { memberId: string; accessTo: string }[], engagementAccessTo?: string) => {
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/api/engagements/${projectId}/resume-proposal`, { changes, ...(engagementAccessTo ? { engagementAccessTo } : {}) });
      onDone();
    } catch (err) {
      setError(apiError(err, 'That could not be confirmed.'));
    } finally {
      setBusy(false);
    }
  };

  const ticked = rows.filter((r) => r.ticked);
  const engagementTicked = engagementEnd?.ticked ? engagementEnd.date : undefined;
  const badDate = ticked.find((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date))
    || (engagementTicked !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(engagementTicked) ? { name: 'the engagement' } : undefined);
  const set = (id: string, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.memberId === id ? { ...r, ...patch } : r)));

  return (
    <DialogShell title="Access after the hold" onClose={busy ? () => undefined : onDone} width={640}>
      {!loaded && <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Loading…</div>}
      {loaded && !proposal && !error && (
        <div style={{ fontSize: 13, color: 'var(--ink-body)' }}>There is no hold whose days are waiting to be offered.</div>
      )}
      {proposal && (
        <>
          <div style={{ fontSize: 13, color: 'var(--ink-body)', lineHeight: 1.6 }}>
            The engagement was on hold {proposal.days} day{proposal.days === 1 ? '' : 's'}
            {' '}({when(proposal.startedAt)} to {when(proposal.endedAt)}
            {proposal.holds > 1 ? `, over ${proposal.holds} holds` : ''}). Each person below can have those days
            added to the end of their access{proposal.engagement ? ', and so can the engagement\'s own access window, which every person\'s sits inside' : ''}.
            {' '}Untick anyone who should keep their date, or change a date, then confirm once. The target end date is not moved.
          </div>
          {rows.length === 0 && !engagementEnd ? (
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 12 }}>
              {proposal.days === 0
                ? 'The hold lasted less than a day, so no end date needs moving.'
                : 'Nobody from the firm had access running through the hold, so no end date needs moving.'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
              <thead>
                <tr style={S.headRow}>
                  <th style={S.th} aria-label="Apply" />
                  <th style={S.th}>Person</th>
                  <th style={S.th}>Current end</th>
                  <th style={S.th}>New end</th>
                </tr>
              </thead>
              <tbody>
                {engagementEnd && proposal.engagement && (
                  <tr style={S.bodyRow}>
                    <td style={S.td}>
                      <input
                        type="checkbox"
                        checked={engagementEnd.ticked}
                        aria-label="Move the engagement's access end"
                        onChange={(e) => setEngagementEnd({ ...engagementEnd, ticked: e.target.checked })}
                      />
                    </td>
                    <td style={S.td}>
                      Engagement access
                      <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}> · every person's sits inside it</span>
                    </td>
                    <td style={S.td}>{calendarDate(proposal.engagement.currentEnd, { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td style={S.td}>
                      <input
                        type="date"
                        style={{ ...S.input, opacity: engagementEnd.ticked ? 1 : 0.5 }}
                        value={engagementEnd.date}
                        disabled={!engagementEnd.ticked}
                        aria-label="New end date for the engagement's access"
                        onChange={(e) => setEngagementEnd({ ...engagementEnd, date: e.target.value })}
                      />
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.memberId} style={S.bodyRow}>
                    <td style={S.td}>
                      <input
                        type="checkbox"
                        checked={r.ticked}
                        aria-label={`Move ${r.name}'s end date`}
                        onChange={(e) => set(r.memberId, { ticked: e.target.checked })}
                      />
                    </td>
                    <td style={S.td}>
                      {r.name}
                      {r.engagementRole && <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}> · {r.engagementRole}</span>}
                    </td>
                    <td style={S.td}>{calendarDate(r.currentEnd, { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td style={S.td}>
                      <input
                        type="date"
                        style={{ ...S.input, opacity: r.ticked ? 1 : 0.5 }}
                        value={r.date}
                        disabled={!r.ticked}
                        aria-label={`New end date for ${r.name}`}
                        onChange={(e) => set(r.memberId, { date: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 10 }}>{error}</div>}
      <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {proposal && onRebaseline && (
          <button style={linkBtn('var(--info)')} disabled={busy} onClick={onRebaseline}>
            Rebaseline the plan
          </button>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {proposal && (rows.length > 0 || engagementEnd) && (
            <button style={ghostBtn} disabled={busy} onClick={() => settle([])}>Leave end dates as they are</button>
          )}
          {proposal ? (
            <button
              style={primaryBtn(busy || Boolean(badDate))}
              disabled={busy || Boolean(badDate)}
              title={badDate ? `Give ${badDate.name} an end date.` : undefined}
              onClick={() => settle(ticked.map((r) => ({ memberId: r.memberId, accessTo: r.date })), engagementTicked)}
            >
              {busy ? 'Working…' : rows.length === 0 && !engagementEnd ? 'Done' : (() => {
                const n = ticked.length + (engagementTicked ? 1 : 0);
                return `Confirm ${n} new end date${n === 1 ? '' : 's'}`;
              })()}
            </button>
          ) : (
            <button style={ghostBtn} onClick={onDone}>Close</button>
          )}
        </span>
      </div>
    </DialogShell>
  );
};

export default ResumeProposal;
