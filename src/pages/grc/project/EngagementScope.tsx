import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell, { ReasonDialog } from '../../../components/Dialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * What an engagement shares with its delivery firm (consulting engagement,
 * sprint 6): the organisations, frameworks and registers in scope, the
 * classification ceiling and the dates, versioned like risk appetite.
 *
 * The organisation drafts a version; someone else of the organisation
 * approves it and it binds, the one before it kept as the basis of work done
 * under it. The firm sees the binding version and its history, never a draft.
 * Audit Programme and Billing are never shared.
 */

const SERVICE_LABEL: Record<string, string> = {
  Documents: 'Documents', Controls: 'Controls and evidence', Risks: 'Risk register', Assets: 'Asset register', Vendors: 'Vendors',
  AuditProgramme: 'Audit Programme', Billing: 'Billing',
};
const STATUS_TONE: Record<string, [string, string]> = {
  Binding: ['var(--success)', 'var(--success-line)'], Draft: ['var(--warning)', 'var(--warning-line)'],
};
const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : '');
const fmt = (d: string | null | undefined) => calendarDate(d, { day: '2-digit', month: 'short', year: 'numeric' });

const Checks: React.FC<{ options: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void; disabled?: string[] }> = ({ options, value, onChange, disabled = [] }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 4 }}>
    {options.map((o) => (
      <label key={o.id} style={{ fontSize: 12.5, display: 'flex', gap: 5, alignItems: 'center', opacity: disabled.includes(o.id) ? 0.5 : 1 }}>
        <input
          type="checkbox"
          checked={value.includes(o.id)}
          disabled={disabled.includes(o.id)}
          onChange={(ev) => onChange(ev.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))}
        />
        {o.name}
      </label>
    ))}
  </div>
);

const EngagementScope: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [drafting, setDrafting] = useState<any>(null);
  const [discarding, setDiscarding] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/engagements/${projectId}/scope`);
      setData(res.data);
    } catch (err) {
      setError(apiError(err, 'Could not load the scope.'));
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setDrafting(null);
      setDiscarding(null);
      await load();
    } catch (err) {
      setError(apiError(err, 'That could not be done.'));
    } finally {
      setBusy(false);
    }
  };

  const startDraft = () => {
    const binding = (data.versions || []).find((v: any) => v.status === 'Binding');
    const d = binding
      ? {
        entityIds: binding.entities.map((x: any) => x.id), frameworkIds: binding.frameworks.map((x: any) => x.id),
        services: binding.services, classificationCeiling: binding.classificationCeiling, validFrom: day(binding.validFrom), validTo: day(binding.validTo),
      }
      : { ...data.defaults, validFrom: day(data.defaults.validFrom), validTo: day(data.defaults.validTo) };
    setDrafting({ ...d, note: '' });
  };

  if (error && !data) return <div style={S.error}>{error}</div>;
  if (!data) return <div style={{ color: 'var(--ink-muted)', padding: 20 }}>Loading…</div>;
  const client = data.side === 'Client';
  const opts = data.options;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: 680, lineHeight: 1.6 }}>
          {client
            ? 'What this engagement shares with the firm. A new version is approved by someone other than the person who drafted it, then binds. Audit Programme and Billing are never shared.'
            : 'What the organisation shares with your firm on this engagement. Anything else answers as not found; to need more, ask the organisation.'}
        </p>
        {data.can?.draft && <button style={primaryBtn(busy)} disabled={busy} onClick={startDraft}>Draft a new scope version</button>}
      </div>
      {error && <div style={S.error}>{error}</div>}
      {(data.versions || []).length === 0 && (
        <div style={{ ...S.card, padding: 16, fontSize: 13, color: 'var(--ink-muted)' }}>
          No scope yet: the firm sees the engagement itself and none of the registers.
        </div>
      )}
      {(data.versions || []).map((v: any) => (
        <div key={v.id} style={{ ...S.card, padding: 16, marginBottom: 12, opacity: v.status === 'Superseded' || v.status === 'Discarded' ? 0.7 : 1 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <strong style={{ fontSize: 13.5 }}>Version {v.version}</strong>
            <span style={pill(...(STATUS_TONE[v.status] || ['var(--ink-muted)', 'var(--line)']))}>{v.status}</span>
            {v.origin === 'Migration' && <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>from the migration</span>}
            <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
              drafted by {v.draftedBy || '—'}{v.approvedBy ? ` · approved by ${v.approvedBy} ${fmt(v.approvedAt)}` : ''}
            </span>
            {client && v.status === 'Draft' && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button style={ghostBtn} disabled={busy} onClick={() => setDiscarding(v)}>Discard</button>
                <button
                  style={primaryBtn(busy || !v.canApprove)}
                  disabled={busy || !v.canApprove}
                  title={v.canApprove ? undefined : 'Someone other than the person who drafted it approves it.'}
                  onClick={() => act(() => apiClient.post(`/api/engagements/${projectId}/scope/${v.id}/approve`))}
                >
                  Approve scope
                </button>
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '4px 12px', fontSize: 12.5 }}>
            <span style={{ color: 'var(--ink-muted)' }}>Organisations</span><span>{v.entities.map((x: any) => x.name).join(', ')}</span>
            <span style={{ color: 'var(--ink-muted)' }}>Frameworks</span><span>{v.frameworks.map((x: any) => x.name).join(', ') || '—'}</span>
            <span style={{ color: 'var(--ink-muted)' }}>Registers shared</span>
            <span>{v.services.length > 0 ? v.services.map((s: string) => SERVICE_LABEL[s] || s).join(', ') : 'None: the engagement itself only'}</span>
            <span style={{ color: 'var(--ink-muted)' }}>Classification ceiling</span><span>{v.classificationCeiling}</span>
            <span style={{ color: 'var(--ink-muted)' }}>Dates</span><span>{fmt(v.validFrom)} → {fmt(v.validTo)}</span>
            {v.note && (<><span style={{ color: 'var(--ink-muted)' }}>Note</span><span>{v.note}</span></>)}
          </div>
        </div>
      ))}

      {drafting && opts && (
        <DialogShell title="Draft a new scope version" onClose={busy ? () => undefined : () => setDrafting(null)} width={640}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 10 }}>
            It binds once someone else of the organisation approves it.
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 8 }}>Organisations in scope</div>
          <Checks options={opts.entities} value={drafting.entityIds} onChange={(entityIds) => setDrafting({ ...drafting, entityIds })} />
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 12 }}>Frameworks</div>
          <Checks options={opts.frameworks} value={drafting.frameworkIds} onChange={(frameworkIds) => setDrafting({ ...drafting, frameworkIds })} />
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 12 }}>Registers shared</div>
          <Checks
            options={[...opts.services, ...opts.never].map((s: string) => ({ id: s, name: SERVICE_LABEL[s] || s }))}
            value={drafting.services}
            disabled={opts.never}
            onChange={(services) => setDrafting({ ...drafting, services })}
          />
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 2 }}>Audit Programme and Billing are never shared.</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              Classification ceiling
              <select style={{ ...S.input, display: 'block', marginTop: 4 }} value={drafting.classificationCeiling}
                onChange={(ev) => setDrafting({ ...drafting, classificationCeiling: ev.target.value })}>
                {opts.classifications.map((c: string) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              From
              <input type="date" style={{ ...S.input, display: 'block', marginTop: 4 }} value={drafting.validFrom}
                onChange={(ev) => setDrafting({ ...drafting, validFrom: ev.target.value })} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
              To
              <input type="date" style={{ ...S.input, display: 'block', marginTop: 4 }} value={drafting.validTo}
                onChange={(ev) => setDrafting({ ...drafting, validTo: ev.target.value })} />
            </label>
          </div>
          <label style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'block', marginTop: 12 }}>
            Note
            <textarea style={{ ...S.input, width: '100%', minHeight: 60, marginTop: 4 }} value={drafting.note}
              onChange={(ev) => setDrafting({ ...drafting, note: ev.target.value })} />
          </label>
          {error && <div style={{ ...S.error, marginTop: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button style={ghostBtn} disabled={busy} onClick={() => setDrafting(null)}>Cancel</button>
            <button style={primaryBtn(busy)} disabled={busy} onClick={() => act(() => apiClient.post(`/api/engagements/${projectId}/scope`, {
              ...drafting, note: drafting.note.trim() || undefined,
            }))}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </DialogShell>
      )}
      {discarding && (
        <ReasonDialog
          title={`Discard draft version ${discarding.version}?`}
          message="It stays on record as discarded; the binding version is unchanged."
          label="Why?"
          confirmLabel="Discard"
          minLength={10}
          busy={busy}
          onConfirm={(reason) => act(() => apiClient.post(`/api/engagements/${projectId}/scope/${discarding.id}/discard`, { reason }))}
          onCancel={() => setDiscarding(null)}
        />
      )}
    </div>
  );
};

export default EngagementScope;
