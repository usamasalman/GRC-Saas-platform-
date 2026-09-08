import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';
import FormDialog from '../../../components/FormDialog';
import DeleteRecordButton from '../../../components/DeleteRecordButton';

/**
 * Key risk indicators, and the readings taken against them.
 *
 * There was no screen for these at all. The endpoints have existed since the
 * ERM work — list, create, record a reading — and nothing in the product
 * reached them, so the whole monitoring half of the risk module was
 * inaccessible unless you called the API yourself.
 *
 * An indicator is the one object in the register whose job is to be calibrated,
 * which is why editing matters more here than elsewhere: an amber threshold set
 * too low cries wolf every month until people stop reading it, and one set too
 * high never fires at all. Both are discovered from the readings, i.e. after
 * the indicator was created.
 */

interface Reading {
  periodLabel: string;
  value: number;
  breachLevel: string;
  recordedAt: string;
}

interface Kri {
  id: string;
  name: string;
  unit: string;
  direction: string;
  amberThreshold: number;
  redThreshold: number;
  frequency: string;
  isActive: boolean;
  owner?: { id: string; name: string };
  risk?: { id: string; ref: string; title: string } | null;
  readings: Reading[];
  latest: Reading | null;
  trend: string;
  status: string;
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  Red: pill('var(--danger)', 'var(--danger-line)'),
  Amber: pill('var(--warning)', 'var(--warning-line)'),
  Green: pill('var(--success)', 'var(--success-line)'),
  NoData: pill('var(--ink-muted)', 'var(--line)'),
};

const TREND_GLYPH: Record<string, string> = { up: '↑', down: '↓', flat: '→', unknown: '·' };

type Dlg =
  | null
  | { kind: 'create' }
  | { kind: 'edit'; kri: Kri }
  | { kind: 'reading'; kri: Kri };

const KriRegister: React.FC = () => {
  const [kris, setKris] = useState<Kri[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [risks, setRisks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState<Dlg>(null);
  const [dialogErr, setDialogErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [k, r, u] = await Promise.all([
        apiClient.get('/api/grc/kris'),
        apiClient.get('/api/grc/risks').catch(() => null),
        apiClient.get('/api/auth/tenant-users').catch(() => null),
      ]);
      setKris(k.data?.kris || []);
      setTotals(k.data?.totals || {});
      setRisks(r?.data?.risks || []);
      setUsers(u?.data?.users || []);
    } catch (err) {
      setError(apiError(err, 'Could not load the indicators.'));
      setKris([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ownerOptions = users.map((u: any) => u.name).filter(Boolean);
  const ownerIdFor = (name: string) => users.find((u: any) => u.name === name)?.id;
  const riskOptions = ['— none —', ...risks.map((r: any) => `${r.ref} ${r.title}`)];
  const riskIdFor = (label: string) => risks.find((r: any) => `${r.ref} ${r.title}` === label)?.id;

  const save = async (values: Record<string, string>) => {
    setBusy(true);
    setDialogErr('');
    const body: any = {
      name: values.name,
      unit: values.unit,
      direction: values.direction,
      amberThreshold: Number(values.amberThreshold),
      redThreshold: Number(values.redThreshold),
      frequency: values.frequency,
    };
    if (values.owner) body.ownerId = ownerIdFor(values.owner);
    if (values.risk && values.risk !== '— none —') body.riskId = riskIdFor(values.risk);
    try {
      if (dialog?.kind === 'edit') {
        body.isActive = values.isActive === 'Active';
        await apiClient.patch(`/api/grc/kris/${dialog.kri.id}`, body);
        setNotice(`${dialog.kri.name} updated`);
      } else {
        await apiClient.post('/api/grc/kris', body);
        setNotice(`${values.name} added`);
      }
      setDialog(null);
      await load();
    } catch (err) {
      setDialogErr(apiError(err, 'Could not save the indicator'));
    } finally {
      setBusy(false);
    }
  };

  const recordReading = async (values: Record<string, string>) => {
    if (dialog?.kind !== 'reading') return;
    setBusy(true);
    setDialogErr('');
    try {
      const res = await apiClient.post(`/api/grc/kris/${dialog.kri.id}/readings`, {
        periodLabel: values.periodLabel,
        value: Number(values.value),
      });
      setNotice(res.data?.message || 'Reading recorded');
      setDialog(null);
      await load();
    } catch (err) {
      setDialogErr(apiError(err, 'Could not record the reading'));
    } finally {
      setBusy(false);
    }
  };

  const visible = showInactive ? kris : kris.filter((k) => k.isActive);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Key risk indicators</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            What is measured between reviews, and what the measurements have been saying.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={primaryBtn()} onClick={() => { setDialogErr(''); setDialog({ kind: 'create' }); }}>
            + New indicator
          </button>
          <button style={ghostBtn} onClick={load}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Indicators', totals.kris ?? 0],
        ['Breaching', <span style={{ color: 'var(--danger)' }}>{totals.red ?? 0}</span>],
        ['Approaching', <span style={{ color: 'var(--warning)' }}>{totals.amber ?? 0}</span>],
        ['Within threshold', <span style={{ color: 'var(--success)' }}>{totals.green ?? 0}</span>],
        ['Never measured', totals.noData ?? 0],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12, display: 'flex', gap: 10 }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} style={{ ...linkBtn('var(--success)'), marginLeft: 'auto' }}>dismiss</button>
        </div>
      )}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-muted)', marginBottom: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Show deactivated indicators
      </label>

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading indicators…</div>
      ) : visible.length === 0 ? (
        <div style={{ ...S.card, padding: 30, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
          No indicators yet. An indicator is a number you agree to watch between formal risk
          reviews, with the level at which it stops being acceptable.
        </div>
      ) : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Indicator</th>
                <th style={S.th}>Latest</th>
                <th style={S.th}>Thresholds</th>
                <th style={S.th}>Against</th>
                <th style={S.th}>Owner</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((k) => (
                <tr key={k.id} style={{ ...S.bodyRow, opacity: k.isActive ? 1 : 0.55 }}>
                  <td style={S.td}>
                    <strong style={{ color: 'var(--ink)' }}>{k.name}</strong>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                      {k.frequency}
                      {k.unit ? ` · ${k.unit}` : ''}
                      {!k.isActive && ' · deactivated'}
                    </div>
                  </td>
                  <td style={S.td}>
                    <span style={STATUS_STYLE[k.status] || STATUS_STYLE.NoData}>{k.status}</span>
                    {k.latest ? (
                      <div style={{ fontSize: 11.5, color: 'var(--ink-body)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                        {k.latest.value} {TREND_GLYPH[k.trend] || ''} <span style={{ color: 'var(--ink-faint)' }}>{k.latest.periodLabel}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 3 }}>no readings</div>
                    )}
                  </td>
                  <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                    <span style={{ color: 'var(--warning)' }}>{k.amberThreshold}</span>
                    {' / '}
                    <span style={{ color: 'var(--danger)' }}>{k.redThreshold}</span>
                    <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                      {k.direction === 'Higher' ? 'higher is worse' : 'lower is worse'}
                    </div>
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--ink-muted)' }}>
                    {k.risk ? `${k.risk.ref} ${k.risk.title}` : '—'}
                  </td>
                  <td style={{ ...S.td, fontSize: 12, color: 'var(--ink-muted)' }}>{k.owner?.name || '—'}</td>
                  <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button style={linkBtn('var(--info)')} onClick={() => { setDialogErr(''); setDialog({ kind: 'reading', kri: k }); }}>
                      record reading
                    </button>
                    <button style={linkBtn('var(--ink-body)')} onClick={() => { setDialogErr(''); setDialog({ kind: 'edit', kri: k }); }}>
                      edit
                    </button>
                    <DeleteRecordButton
                      endpoint={`/api/grc/kris/${k.id}`}
                      what="indicator"
                      reference={k.name}
                      guidance="An indicator that has been measured should be deactivated instead — it stops being collected and the series it produced stays readable."
                      onDone={(m) => { setNotice(m); load(); }}
                      label="delete"
                      style={{ background: 'none', border: 'none', padding: 0, marginLeft: 8, textDecoration: 'underline', fontWeight: 500 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <FormDialog
          title={dialog.kind === 'edit' ? `Edit ${dialog.kri.name}` : 'New key risk indicator'}
          intro={
            <>
              An indicator is a number watched between formal reviews. The two thresholds say
              where it stops being comfortable and where it stops being acceptable — set them
              from what you would actually escalate on, not from a round number.
            </>
          }
          busy={busy}
          error={dialogErr}
          submitLabel={dialog.kind === 'edit' ? 'Save indicator' : 'Create indicator'}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true, initial: dialog.kind === 'edit' ? dialog.kri.name : '', placeholder: 'Privileged accounts without MFA' },
            { name: 'unit', label: 'Unit', type: 'text', initial: dialog.kind === 'edit' ? dialog.kri.unit : '', placeholder: 'accounts, %, days', help: 'A count-based indicator legitimately has none.' },
            { name: 'direction', label: 'Which way is bad?', type: 'select', options: ['Higher', 'Lower'], initial: dialog.kind === 'edit' ? dialog.kri.direction : 'Higher' },
            { name: 'amberThreshold', label: 'Amber threshold', type: 'number', required: true, initial: dialog.kind === 'edit' ? String(dialog.kri.amberThreshold) : '' },
            { name: 'redThreshold', label: 'Red threshold', type: 'number', required: true, initial: dialog.kind === 'edit' ? String(dialog.kri.redThreshold) : '', help: 'Red must be worse than amber in the direction chosen above; the server checks the pair together.' },
            { name: 'frequency', label: 'Measured', type: 'select', options: ['Monthly', 'Quarterly'], initial: dialog.kind === 'edit' ? dialog.kri.frequency : 'Monthly' },
            ...(ownerOptions.length > 0
              ? [{ name: 'owner', label: 'Owner', type: 'select' as const, options: ownerOptions, initial: dialog.kind === 'edit' ? (dialog.kri.owner?.name ?? '') : '' }]
              : []),
            ...(dialog.kind === 'create' && riskOptions.length > 1
              ? [{ name: 'risk', label: 'Indicator for', type: 'select' as const, options: riskOptions, help: 'Optional. Ties the indicator to a specific risk in the register.' }]
              : []),
            ...(dialog.kind === 'edit'
              ? [{ name: 'isActive', label: 'State', type: 'select' as const, options: ['Active', 'Deactivated'], initial: dialog.kri.isActive ? 'Active' : 'Deactivated', help: 'Deactivating stops collection and keeps the readings already taken.' }]
              : []),
          ]}
          onSubmit={save}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'reading' && (
        <FormDialog
          title={`Record a reading — ${dialog.kri.name}`}
          intro={
            <>
              Amber at <strong>{dialog.kri.amberThreshold}</strong>, red at{' '}
              <strong>{dialog.kri.redThreshold}</strong>,{' '}
              {dialog.kri.direction === 'Higher' ? 'higher is worse' : 'lower is worse'}. The
              breach level is worked out from the value, not chosen here.
            </>
          }
          busy={busy}
          error={dialogErr}
          submitLabel="Record reading"
          fields={[
            { name: 'periodLabel', label: 'Period', type: 'text', required: true, placeholder: dialog.kri.frequency === 'Monthly' ? '2026-09' : '2026-Q3' },
            { name: 'value', label: `Value${dialog.kri.unit ? ` (${dialog.kri.unit})` : ''}`, type: 'number', required: true },
          ]}
          onSubmit={recordReading}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default KriRegister;
