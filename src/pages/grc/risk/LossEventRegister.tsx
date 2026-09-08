import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';
import FormDialog from '../../../components/FormDialog';
import DeleteRecordButton from '../../../components/DeleteRecordButton';

/**
 * Operational loss events.
 *
 * Like the indicators, these had endpoints and no screen. Loss data is the
 * empirical half of an operational risk programme — it is the only thing that
 * says whether the register's estimates were any good — and it was unreachable
 * from the product.
 *
 * The detection lag is shown next to every event because it is the figure
 * people notice least and act on most: an event discovered four months after it
 * happened is a control failure in its own right, separate from whatever the
 * loss itself cost.
 */

const CATEGORIES = [
  'InternalFraud', 'ExternalFraud', 'EmploymentPractices', 'ClientsProductsBusinessPractices',
  'DamageToPhysicalAssets', 'BusinessDisruptionSystemFailure', 'ExecutionDeliveryProcessManagement',
] as const;

/** The Basel category names are unreadable as written; these are the same things in English. */
const CATEGORY_LABEL: Record<string, string> = {
  InternalFraud: 'Internal fraud',
  ExternalFraud: 'External fraud',
  EmploymentPractices: 'Employment practices & workplace safety',
  ClientsProductsBusinessPractices: 'Clients, products & business practices',
  DamageToPhysicalAssets: 'Damage to physical assets',
  BusinessDisruptionSystemFailure: 'Business disruption & system failure',
  ExecutionDeliveryProcessManagement: 'Execution, delivery & process management',
};
const LABEL_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_LABEL).map(([k, v]) => [v, k]),
);

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  Open: pill('var(--warning)', 'var(--warning-line)'),
  UnderInvestigation: pill('var(--info)', 'var(--info-line)'),
  Closed: pill('var(--success)', 'var(--success-line)'),
};

interface LossEvent {
  id: string;
  ref: string;
  title: string;
  description: string;
  category: string;
  occurredAt: string;
  discoveredAt: string;
  grossAmount: number;
  recoveredAmount: number;
  netAmount: number;
  detectionLagDays: number;
  currency: string;
  status: string;
  issueId?: string | null;
  risk?: { id: string; ref: string; title: string } | null;
}

type Dlg = null | { kind: 'create' } | { kind: 'edit'; ev: LossEvent };

const money = (n: number, ccy: string) =>
  `${ccy} ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const LossEventRegister: React.FC = () => {
  const [events, setEvents] = useState<LossEvent[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dlg>(null);
  const [dialogErr, setDialogErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/grc/loss-events');
      setEvents(res.data?.events || []);
      setTotals(res.data?.totals || {});
    } catch (err) {
      setError(apiError(err, 'Could not load the loss register.'));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (values: Record<string, string>) => {
    setBusy(true);
    setDialogErr('');
    const body: any = {
      title: values.title,
      description: values.description,
      category: LABEL_TO_CATEGORY[values.category] || values.category,
      occurredAt: values.occurredAt,
      discoveredAt: values.discoveredAt,
      grossAmount: Number(values.grossAmount),
      recoveredAmount: values.recoveredAmount ? Number(values.recoveredAmount) : 0,
    };
    try {
      if (dialog?.kind === 'edit') {
        body.status = values.status;
        await apiClient.patch(`/api/grc/loss-events/${dialog.ev.id}`, body);
        setNotice(`${dialog.ev.ref} updated`);
      } else {
        const res = await apiClient.post('/api/grc/loss-events', body);
        setNotice(res.data?.message || 'Loss event recorded');
      }
      setDialog(null);
      await load();
    } catch (err) {
      setDialogErr(apiError(err, 'Could not save the loss event'));
    } finally {
      setBusy(false);
    }
  };

  const dateFields = (ev?: LossEvent) => [
    {
      name: 'occurredAt', label: 'Occurred on', type: 'date' as const, required: true,
      initial: ev ? String(ev.occurredAt).slice(0, 10) : '',
    },
    {
      name: 'discoveredAt', label: 'Discovered on', type: 'date' as const, required: true,
      initial: ev ? String(ev.discoveredAt).slice(0, 10) : '',
      help: 'The gap between these two is the detection lag, and it is often the more '
        + 'useful number — an event found four months late is a control failure of its own.',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Loss events</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            What actually went wrong, what it cost, and how long it took to notice.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={primaryBtn()} onClick={() => { setDialogErr(''); setDialog({ kind: 'create' }); }}>
            + Record a loss
          </button>
          <button style={ghostBtn} onClick={load}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Events', totals.events ?? 0],
        ['Still open', <span style={{ color: 'var(--warning)' }}>{totals.open ?? 0}</span>],
        ['Gross', money(totals.grossAmount ?? 0, 'SAR')],
        ['Recovered', <span style={{ color: 'var(--success)' }}>{money(totals.recoveredAmount ?? 0, 'SAR')}</span>],
        ['Net', <strong>{money(totals.netAmount ?? 0, 'SAR')}</strong>],
        ['Avg detection lag', `${totals.avgDetectionLagDays ?? 0} days`],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12, display: 'flex', gap: 10 }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} style={{ ...linkBtn('var(--success)'), marginLeft: 'auto' }}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading the loss register…</div>
      ) : events.length === 0 ? (
        <div style={{ ...S.card, padding: 30, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
          No loss events recorded. This is where what actually happened gets written down, which
          is the only thing that tells you whether the register's estimates were any good.
        </div>
      ) : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Event</th>
                <th style={S.th}>Category</th>
                <th style={S.th}>Occurred</th>
                <th style={S.th}>Lag</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Gross</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Net</th>
                <th style={S.th}>Status</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <strong style={{ color: 'var(--ink)' }}>{e.ref}</strong>
                    <div style={{ fontSize: 12, color: 'var(--ink-body)' }}>{e.title}</div>
                    {e.risk && (
                      <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>against {e.risk.ref}</div>
                    )}
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--ink-muted)' }}>
                    {CATEGORY_LABEL[e.category] || e.category}
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--ink-muted)' }}>
                    {String(e.occurredAt).slice(0, 10)}
                  </td>
                  <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: e.detectionLagDays > 30 ? 'var(--warning)' : 'var(--ink-muted)' }}>
                      {e.detectionLagDays}d
                    </span>
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {money(e.grossAmount, e.currency)}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--ink)' }}>
                    {money(e.netAmount, e.currency)}
                  </td>
                  <td style={S.td}>
                    <span style={STATUS_STYLE[e.status] || pill('var(--ink-muted)', 'var(--line)')}>
                      {e.status}
                    </span>
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button style={linkBtn('var(--ink-body)')} onClick={() => { setDialogErr(''); setDialog({ kind: 'edit', ev: e }); }}>
                      edit
                    </button>
                    {/* A closed event, or one that raised a finding, is refused by the
                        server — it is part of the argument the register makes. */}
                    {e.status !== 'Closed' && (
                      <DeleteRecordButton
                        endpoint={`/api/grc/loss-events/${e.id}`}
                        what="loss event"
                        reference={e.ref}
                        name={e.title}
                        guidance="An event that genuinely happened should be closed with the recovered amount set to what was actually recovered."
                        onDone={(m) => { setNotice(m); load(); }}
                        label="delete"
                        style={{ background: 'none', border: 'none', padding: 0, marginLeft: 8, textDecoration: 'underline', fontWeight: 500 }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <FormDialog
          title={dialog.kind === 'edit' ? `Edit ${dialog.ev.ref}` : 'Record a loss event'}
          intro="What happened, when it happened, when it was found, and what it cost gross and net of recovery."
          busy={busy}
          error={dialogErr}
          submitLabel={dialog.kind === 'edit' ? 'Save event' : 'Record event'}
          validate={(v) => {
            if (v.occurredAt && v.discoveredAt && v.discoveredAt < v.occurredAt) {
              return 'An event cannot be discovered before it happened.';
            }
            if (v.grossAmount && v.recoveredAmount
                && Number(v.recoveredAmount) > Number(v.grossAmount)) {
              return 'Recovered cannot exceed the gross loss.';
            }
            return null;
          }}
          fields={[
            { name: 'title', label: 'What happened', type: 'text', required: true, initial: dialog.kind === 'edit' ? dialog.ev.title : '' },
            { name: 'description', label: 'Detail', type: 'textarea', required: true, initial: dialog.kind === 'edit' ? dialog.ev.description : '' },
            {
              name: 'category', label: 'Category', type: 'select',
              options: CATEGORIES.map((c) => CATEGORY_LABEL[c]),
              initial: dialog.kind === 'edit' ? CATEGORY_LABEL[dialog.ev.category] : undefined,
            },
            ...dateFields(dialog.kind === 'edit' ? dialog.ev : undefined),
            { name: 'grossAmount', label: 'Gross loss', type: 'number', required: true, initial: dialog.kind === 'edit' ? String(dialog.ev.grossAmount) : '' },
            { name: 'recoveredAmount', label: 'Recovered', type: 'number', initial: dialog.kind === 'edit' ? String(dialog.ev.recoveredAmount) : '0' },
            ...(dialog.kind === 'edit'
              ? [{ name: 'status', label: 'Status', type: 'select' as const, options: ['Open', 'UnderInvestigation', 'Closed'], initial: dialog.ev.status }]
              : []),
          ]}
          onSubmit={save}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default LossEventRegister;
