import React, { useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import Can, { MAY } from '../../components/Can';
import FormDialog from '../../components/FormDialog';
import { ReasonDialog } from '../../components/Dialog';
import { S, primaryBtn, ghostBtn, pill, apiError, StatStrip } from '../iam/iamStyles';
import { calendarDate } from '../../utils/calendarDate';

/**
 * Retention schedules and the disposition queue.
 *
 * The Governance menu has offered "Retention Schedules" since the beginning
 * and the entry rendered AuditLogViewer — the same component 'legal-hold' and
 * 'logs' rendered, so three menu items were one page. A mock version of this
 * screen sat unreachable in appMockEngine with hardcoded counts: 18 schedules,
 * 37 in the disposition queue, 100% deletion evidence. None of those numbers
 * came from anywhere.
 */

const SUB: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 13,
  color: 'var(--ink-muted)',
  lineHeight: 1.6,
  maxWidth: 720,
};

const H2: React.CSSProperties = {
  margin: '26px 0 10px',
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--ink)',
};

const EMPTY: React.CSSProperties = {
  padding: '30px 20px',
  textAlign: 'center',
  border: '1px dashed var(--line)',
  borderRadius: 8,
  fontSize: 12.5,
  color: 'var(--ink-muted)',
};

const STATE_COLOUR: Record<string, [string, string]> = {
  Due: ['var(--danger)', 'var(--danger-line)'],
  DueSoon: ['var(--warning)', 'var(--warning-line)'],
  Held: ['var(--info)', 'rgba(59, 130, 246, 0.3)'],
  NotDue: ['var(--ink-muted)', 'var(--line)'],
  NotScheduled: ['var(--ink-faint)', 'var(--line)'],
  Disposed: ['var(--ink-faint)', 'var(--line)'],
};

const STATE_WORD: Record<string, string> = {
  Due: 'Due now',
  DueSoon: 'Due soon',
  Held: 'Legal hold',
  NotDue: 'Not due',
  NotScheduled: 'No schedule',
  Disposed: 'Disposed',
};

const RetentionSchedules: React.FC = () => {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [held, setHeld] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [queueReadable, setQueueReadable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [disposing, setDisposing] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/retention/schedules');
      setSchedules(res.data?.schedules || []);
      setMeta(res.data || null);
    } catch (e: any) {
      setError(apiError(e, 'Failed to load retention schedules'));
    } finally {
      setLoading(false);
    }

    try {
      const q = await apiClient.get('/api/retention/queue');
      setQueue(q.data?.queue || []);
      setHeld(q.data?.held || []);
      setSummary(q.data?.summary || null);
      setQueueReadable(true);
    } catch {
      // A 403 here is the server saying the disposition queue is not this
      // person's, which is not an error to show them.
      setQueueReadable(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (values: Record<string, string>) => {
    setBusy(true);
    setError('');
    try {
      const body = {
        code: values.code,
        name: values.name,
        description: values.description,
        retainMonths: Number(values.retainMonths),
        trigger: values.trigger,
        reviewWindowDays: Number(values.reviewWindowDays),
      };
      if (editing) await apiClient.put(`/api/retention/schedules/${editing.id}`, body);
      else await apiClient.post('/api/retention/schedules', body);
      setEditing(null);
      setCreating(false);
      await load();
    } catch (e: any) {
      setError(apiError(e, 'The schedule could not be saved'));
      setEditing(null);
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  const dispose = async (reason: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.post(
        `/api/retention/documents/${disposing.id}/dispose`,
        { reason },
      );
      if (res.data?.warning) setError(res.data.warning);
      setDisposing(null);
      await load();
    } catch (e: any) {
      setError(apiError(e, 'The document could not be disposed of'));
      setDisposing(null);
    } finally {
      setBusy(false);
    }
  };

  const fields = (s: any) => [
    { name: 'code', label: 'Code', type: 'text' as const, required: true, initial: s?.code || '', placeholder: 'RET-7Y', help: 'Short, and what a disposal record names.' },
    { name: 'name', label: 'Name', type: 'text' as const, required: true, initial: s?.name || '', placeholder: 'Policy records — seven years' },
    { name: 'description', label: 'Description', type: 'textarea' as const, initial: s?.description || '' },
    {
      name: 'retainMonths',
      label: 'Keep for (months)',
      type: 'number' as const,
      required: true,
      initial: String(s?.retainMonths ?? meta?.defaults?.retainMonths ?? 84),
      help: 'A whole number of months. 84 is seven years, which is what the platform already advertises for documents.',
    },
    {
      name: 'trigger',
      label: 'Start counting from',
      type: 'select' as const,
      required: true,
      initial: s?.trigger || 'Published',
      options: (meta?.triggers || ['Published', 'Archived', 'Created']).map((t: string) => ({ value: t, label: t })),
      help: 'A document that has not reached this point yet has no disposal date.',
    },
    {
      name: 'reviewWindowDays',
      label: 'Review window (days)',
      type: 'number' as const,
      required: true,
      initial: String(s?.reviewWindowDays ?? meta?.defaults?.reviewWindowDays ?? 30),
      help: 'How long before the disposal date it appears in the queue, so disposal is a decision somebody makes rather than a date that passes.',
    },
  ];

  const row = (d: any, withAction: boolean) => {
    const [fg, br] = STATE_COLOUR[d.state] || STATE_COLOUR.NotDue;
    return (
      <div
        key={d.id}
        style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '11px 13px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5 }}
      >
        <span style={{ fontWeight: 600, color: 'var(--ink)', minWidth: 110 }}>{d.code}</span>
        <span style={{ color: 'var(--ink)', flex: 1 }}>{d.title}</span>
        <span style={pill(fg, br)}>{STATE_WORD[d.state] || d.state}</span>
        <span style={{ color: 'var(--ink-muted)', minWidth: 150, textAlign: 'right' }}>
          {d.state === 'Held'
            ? `Matter ${d.legalHoldMatter || 'unnamed'}`
            : d.disposalDueAt
              ? `${calendarDate(d.disposalDueAt)}${typeof d.daysUntil === 'number' ? ` · ${d.daysUntil < 0 ? `${-d.daysUntil}d overdue` : `${d.daysUntil}d`}` : ''}`
              : 'No disposal date'}
        </span>
        {withAction && d.state === 'Due' && (
          <Can do={MAY.DISPOSE_RECORD}>
            <button onClick={() => setDisposing(d)} disabled={busy} style={{ ...ghostBtn, color: 'var(--danger)' }}>
              Dispose
            </button>
          </Can>
        )}
      </div>
    );
  };

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>Retention Schedules</h1>
          <p style={SUB}>
            How long each class of record is kept, and what is due for a decision. Disposal
            destroys the content and keeps the record: approvals, acknowledgements and access
            history survive, so the organisation can still show what it held and that disposal
            was authorised.
          </p>
        </div>
        <Can do={MAY.DISPOSE_RECORD}>
          <button onClick={() => { setError(''); setCreating(true); }} style={primaryBtn(busy)} disabled={busy}>
            New schedule
          </button>
        </Can>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {summary && (
        <StatStrip
          items={[
            ['Due now', summary.due],
            ['Due soon', summary.dueSoon],
            ['On legal hold', summary.held],
            ['Disposed', summary.disposed],
          ]}
        />
      )}

      <h2 style={H2}>Schedules</h2>
      {loading ? (
        <div style={EMPTY}>Loading…</div>
      ) : schedules.length === 0 ? (
        <div style={EMPTY}>
          <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
            This organisation has no retention schedule
          </div>
          <div style={{ color: 'var(--ink-muted)', maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
            Nothing says how long any document is kept, so nothing has a disposal date and the
            queue below will stay empty. Records are kept indefinitely until a schedule says
            otherwise.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {schedules.map((s) => (
            <div
              key={s.id}
              style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '11px 13px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5 }}
            >
              <span style={{ fontWeight: 600, color: 'var(--ink)', minWidth: 110 }}>{s.code}</span>
              <span style={{ color: 'var(--ink)', flex: 1 }}>{s.name}</span>
              {s.isDefault && <span style={pill('var(--info)', 'rgba(59,130,246,0.3)')}>Default</span>}
              <span style={{ color: 'var(--ink-muted)' }}>
                {s.retainMonths} months from {s.trigger.toLowerCase()}
              </span>
              <span style={{ color: 'var(--ink-faint)', minWidth: 110, textAlign: 'right' }}>
                {s.documents} document{s.documents === 1 ? '' : 's'}
              </span>
              <Can do={MAY.DISPOSE_RECORD}>
                <button onClick={() => { setError(''); setEditing(s); }} style={ghostBtn} disabled={busy}>
                  Edit
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      <h2 style={H2}>Disposition queue</h2>
      {!queueReadable ? (
        <div style={EMPTY}>
          The disposition queue is for whoever holds retention and legal hold.
        </div>
      ) : queue.length === 0 ? (
        <div style={EMPTY}>
          <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
            Nothing is due for a disposal decision
          </div>
          <div style={{ color: 'var(--ink-muted)', maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
            {summary?.noSchedulesDefined
              ? 'No retention schedule has been defined, so no document has a disposal date. An empty queue here does not mean everything is up to date.'
              : summary?.notScheduled
                ? `${summary.notScheduled} document${summary.notScheduled === 1 ? ' is' : 's are'} on no schedule and will never appear here.`
                : 'Every scheduled document is still inside its retention period.'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {queue.map((d) => row(d, true))}
        </div>
      )}

      {queueReadable && held.length > 0 && (
        <>
          <h2 style={H2}>Held, and not disposable</h2>
          <p style={{ ...SUB, marginTop: 0 }}>
            Past their schedule or not, these are evidence in a matter. Disposal is refused
            while the hold stands, and releasing a hold is itself recorded.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {held.map((d) => row(d, false))}
          </div>
        </>
      )}

      {(creating || editing) && (
        <FormDialog
          title={editing ? `Edit ${editing.code}` : 'New retention schedule'}
          intro={
            editing
              ? 'Changing the period moves the disposal date of every document on this schedule.'
              : 'A schedule says how long a class of record is kept and what starts the clock.'
          }
          fields={fields(editing)}
          submitLabel={busy ? 'Saving…' : 'Save'}
          busy={busy}
          onSubmit={save}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      )}

      {disposing && (
        <ReasonDialog
          title={`Dispose of ${disposing.code}`}
          message={
            `This destroys the content of "${disposing.title}" and removes its stored file. `
            + 'The approval, acknowledgement and access history remain, and the disposal is '
            + 'recorded against the schedule it was carried out under. It cannot be undone.'
          }
          label="Why this record is being destroyed"
          confirmLabel={busy ? 'Disposing…' : 'Dispose'}
          busy={busy}
          onConfirm={dispose}
          onCancel={() => setDisposing(null)}
        />
      )}
    </div>
  );
};

export default RetentionSchedules;
