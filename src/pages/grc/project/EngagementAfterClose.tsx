import React, { useState } from 'react';
import apiClient from '../../../api/apiClient';
import FormDialog from '../../../components/FormDialog';
import { ReasonDialog } from '../../../components/Dialog';
import { S, ghostBtn, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * After the engagement closes (consulting engagement, sprint 7), on the
 * consulting firm card of the Team tab.
 *
 * The organisation sets ahead how long the firm may still read the
 * engagement, read-only, once it closes (0 to 365 days, 90 unless it says
 * otherwise) and whether the firm keeps a copy of each issued report. After
 * close only the organisation extends the window, never past 365 days after
 * the close, or revokes it; each change has a reason, is on both trails and
 * the firm's Lead is told. A closed engagement can be followed by another
 * with the same firm, and the organisation says whether the one before is
 * in scope for it. The firm sees all of this and changes none of it.
 */

export interface AfterCloseData {
  engagement: {
    id: string; ref: string; name: string; status: string;
    afterClose: { days: number; closedAt: string | null; until: string | null; setAt: string | null };
    reportCopiesAllowed: boolean;
    previousInScope: boolean;
    previous: { id: string; ref: string; name: string; status: string } | null;
    followOns: { id: string; ref: string; name: string; status: string }[];
  };
  side: 'Client' | 'Provider';
  can: { changeCloseWindow: boolean; setReportCopies: boolean; followOn: boolean; setPreviousInScope: boolean };
}

export interface OpenProject { id: string; ref: string; name: string }

type Dialog = null | 'days' | 'until' | 'revoke' | 'copies' | 'followOn' | 'previous';

const DAY = 86_400_000;
const fmt = (d: string | number | Date | null | undefined) => (d === null || d === undefined ? '—' : calendarDate(new Date(d).toISOString()));
const isoDay = (d: number) => new Date(d).toISOString().slice(0, 10);
const note = (v: Record<string, string>): string | null => ((v.reason || '').trim().length < 10 ? 'Say why, in at least 10 characters.' : null);
const row: React.CSSProperties = { padding: '10px 16px', borderBottom: '1px solid var(--line-soft)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5 };
const small: React.CSSProperties = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };

const EngagementAfterClose: React.FC<{
  projectId: string; data: AfterCloseData; onChanged: () => void; onOpenProject?: (p: OpenProject) => void;
}> = ({ projectId, data, onChanged, onOpenProject }) => {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<OpenProject | null>(null);
  const e = data.engagement;
  const a = e.afterClose;
  const ended = e.status === 'Closed' || e.status === 'Cancelled';
  // The window's end is a moment; the last day it covers is the one before it.
  const lastDay = a.until ? Date.parse(a.until) - 1 : null;
  const open = a.until ? Date.parse(a.until) > Date.now() : false;
  const latest = a.closedAt ? Date.parse(a.closedAt) + 365 * DAY : null;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setDialog(null);
      onChanged();
    } catch (err) {
      setDialog(null);
      setError(apiError(err, 'That could not be done.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div style={row}>
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>After close</span>
        <span>
          {!ended && `The firm can read it, read-only, for ${a.days} day${a.days === 1 ? '' : 's'} after close.`}
          {ended && lastDay !== null && (open
            ? `The firm can read it, read-only, until ${fmt(lastDay)}.`
            : `The firm's read-only access ended ${fmt(a.until)}.`)}
        </span>
        <span style={{ color: 'var(--ink-muted)' }}>
          Report copies: {e.reportCopiesAllowed ? 'the firm keeps a copy of each issued report' : 'the firm keeps none'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {data.can.changeCloseWindow && !ended && <button style={small} disabled={busy} onClick={() => setDialog('days')}>Window after close</button>}
          {data.can.setReportCopies && <button style={small} disabled={busy} onClick={() => setDialog('copies')}>Report copies</button>}
          {data.can.changeCloseWindow && ended && a.closedAt && <button style={small} disabled={busy} onClick={() => setDialog('until')}>Extend or shorten</button>}
          {data.can.changeCloseWindow && ended && open && <button style={small} disabled={busy} onClick={() => setDialog('revoke')}>Revoke now</button>}
          {data.can.followOn && <button style={small} disabled={busy} onClick={() => setDialog('followOn')}>Start a follow-on</button>}
        </span>
      </div>
      {(e.previous || e.followOns.length > 0 || made) && (
        <div style={row}>
          {e.previous && (
            <span>
              Follows <strong>{e.previous.ref}</strong> · {e.previous.name}.{' '}
              <span style={{ color: 'var(--ink-muted)' }}>
                {e.previousInScope
                  ? 'In scope: the firm\'s approved people may read it, read-only.'
                  : 'Not in scope: the firm reads only this engagement.'}
              </span>
            </span>
          )}
          {e.followOns.length > 0 && (
            <span>
              Followed by{' '}
              {e.followOns.map((f, i) => (
                <React.Fragment key={f.id}>
                  {i > 0 && ', '}
                  {onOpenProject
                    ? <button style={{ ...small, padding: '1px 8px' }} onClick={() => onOpenProject(f)}>{f.ref}</button>
                    : <strong>{f.ref}</strong>}
                  {' '}{f.name} ({f.status})
                </React.Fragment>
              ))}
            </span>
          )}
          {made && !e.followOns.some((f) => f.id === made.id) && <span>{made.ref} created as a draft.</span>}
          {data.can.setPreviousInScope && (
            <button style={{ ...small, marginLeft: 'auto' }} disabled={busy} onClick={() => setDialog('previous')}>Change what the firm reads before</button>
          )}
        </div>
      )}
      {error && <div style={{ ...S.error, margin: 12 }}>{error}</div>}

      {dialog === 'days' && (
        <FormDialog
          title="How long may the firm read it after close?"
          intro={<>From the day it closes, read-only. The Close dialog shows these days again to confirm. Recorded on both organisations' trails.</>}
          submitLabel="Save"
          busy={busy}
          fields={[
            { name: 'days', label: 'Firm can read it for (days)', type: 'number', required: true, initial: String(a.days), help: '0 to 365 days; 90 unless you say otherwise.' },
            { name: 'reason', label: 'Why', type: 'textarea', required: true },
          ]}
          validate={(v) => {
            const n = Number(v.days);
            return Number.isInteger(n) && n >= 0 && n <= 365 ? note(v) : 'The firm can read it for 0 to 365 days.';
          }}
          onSubmit={(v) => act(() => apiClient.patch(`/api/engagements/${projectId}/close-window`, { days: Number(v.days), reason: v.reason.trim() }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'until' && latest !== null && (
        <FormDialog
          title="Change until when the firm may read it"
          intro={<>Read-only, to the end of the date you choose, and no later than {fmt(latest)}, 365 days after close. A date already past ends it today. The firm's Lead is told.</>}
          submitLabel="Save"
          busy={busy}
          fields={[
            { name: 'until', label: 'Firm can read it until', type: 'date', required: true, initial: lastDay !== null ? isoDay(lastDay) : '' },
            { name: 'reason', label: 'Why', type: 'textarea', required: true },
          ]}
          validate={note}
          onSubmit={(v) => act(() => apiClient.patch(`/api/engagements/${projectId}/close-window`, { until: v.until, reason: v.reason.trim() }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'revoke' && (
        <ReasonDialog
          title="Revoke the firm's read-only access now?"
          message="From now the firm's people get nothing of this engagement. The firm keeps its own record and any report copies it was allowed. You can extend it again, up to 365 days after close."
          label="Why?"
          confirmLabel="Revoke now"
          minLength={10}
          busy={busy}
          onConfirm={(reason) => act(() => apiClient.patch(`/api/engagements/${projectId}/close-window`, { revoke: true, reason }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'copies' && (
        <FormDialog
          title="Report copies for the firm"
          intro={<>When on, the firm keeps a copy of each report you issue from now on, in its own records, for good. Turning it off stops the copies still to come; copies already made stay the firm's.</>}
          submitLabel="Save"
          busy={busy}
          fields={[
            {
              name: 'allowed', label: 'Firm keeps copies of issued reports', type: 'select', options: ['Yes', 'No'],
              initial: e.reportCopiesAllowed ? 'No' : 'Yes',
            },
            { name: 'reason', label: 'Why', type: 'textarea', required: true },
          ]}
          validate={note}
          onSubmit={(v) => act(() => apiClient.patch(`/api/engagements/${projectId}/report-copies`, { allowed: v.allowed === 'Yes', reason: v.reason.trim() }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'followOn' && (
        <FormDialog
          title={`Start a follow-on to ${e.ref}?`}
          intro={<>A new draft engagement with the same firm. The plan comes across with its dates moved and none of its progress; tasks, blockers and gaps still open come across marked "Carried over", each gap with its corrective action plan. The firm's people are nominated again, and each needs your approval before they can open it.</>}
          submitLabel="Start follow-on"
          busy={busy}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true, initial: `${e.name} — follow-on` },
            { name: 'start', label: 'Starts', type: 'date', required: true, initial: isoDay(Date.now()) },
            { name: 'target', label: 'Target end', type: 'date', help: 'Left empty: as long as the engagement before.' },
            {
              name: 'inScope', label: 'The engagement before is in scope', type: 'select', options: ['No', 'Yes'],
              optionLabels: { No: 'No — the firm reads only the follow-on', Yes: 'Yes — its approved people may read it, read-only' },
            },
          ]}
          onSubmit={(v) => act(async () => {
            const res = await apiClient.post(`/api/engagements/${projectId}/follow-on`, {
              name: v.name, startDate: v.start, targetEndDate: v.target || undefined, previousInScope: v.inScope === 'Yes',
            });
            const p: OpenProject = res.data.project;
            setMade(p);
            onOpenProject?.(p);
          })}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'previous' && e.previous && (
        <FormDialog
          title={`May the firm read ${e.previous.ref}?`}
          intro={<>While this engagement runs, its approved firm people may read the engagement before it, read-only, when it is in scope. Recorded on both trails; the firm's Lead is told.</>}
          submitLabel="Save"
          busy={busy}
          fields={[
            {
              name: 'inScope', label: 'The engagement before is in scope', type: 'select', options: ['Yes', 'No'],
              initial: e.previousInScope ? 'No' : 'Yes',
            },
            { name: 'reason', label: 'Why', type: 'textarea', required: true },
          ]}
          validate={note}
          onSubmit={(v) => act(() => apiClient.patch(`/api/engagements/${projectId}/previous-in-scope`, { inScope: v.inScope === 'Yes', reason: v.reason.trim() }))}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
};

export default EngagementAfterClose;
