import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell from '../../../components/Dialog';
import FormDialog from '../../../components/FormDialog';
import { S, ghostBtn, primaryBtn, pill, StatStrip, apiError } from '../../iam/iamStyles';

/**
 * Readiness and management review (consulting engagement, sprint 12).
 *
 * Readiness is computed per clause from the records already held; nobody
 * types it in. The firm's Lead gives an opinion beside it and the
 * engagement's owner signs off; both keep the figures as they stood. A
 * management review (9.3) is the organisation's record: the firm may prepare
 * it, the project manager records it once every input is considered.
 */

const DIM_LABEL: Record<string, string> = {
  documented: 'Documented', implemented: 'Implemented', evidenced: 'Evidenced', gapsClosed: 'Gaps closed', risksTreated: 'Risks treated', records: 'Records period',
};
const VERDICT_TONE: Record<string, [string, string]> = {
  Ready: ['var(--success)', 'var(--success-line)'], 'Nearly ready': ['var(--warning)', 'var(--warning-line)'],
  'Not ready': ['var(--danger)', 'var(--danger-line)'], 'Not applicable': ['var(--ink-muted)', 'var(--line)'],
};
const OPINION: Record<string, string> = { Ready: 'Ready', ReadyWithConditions: 'Ready with conditions', NotReady: 'Not ready' };
const small: React.CSSProperties = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };
const label: React.CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', margin: '8px 0 3px' };

const EngagementReadiness: React.FC<{ projectId: string }> = ({ projectId }) => {
  const base = `/api/engagements/${projectId}`;
  const [data, setData] = useState<any>(null);
  const [reviews, setReviews] = useState<any>(null);
  const [tenantId, setTenantId] = useState('');
  const [standardId, setStandardId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | 'period' | 'opinion' | 'signoff' | { review: any } | { action: any }>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [r, m] = await Promise.all([
        apiClient.get(`${base}/readiness`, { params: { tenantId: tenantId || undefined, standardId: standardId || undefined } }),
        apiClient.get(`${base}/management-reviews`),
      ]);
      setData(r.data); setReviews(m.data);
      if (!tenantId && r.data.tenantId) setTenantId(r.data.tenantId);
      if (!standardId && r.data.standardId) setStandardId(r.data.standardId);
    } catch (err) {
      setError(apiError(err, 'Could not compute readiness.'));
    }
  }, [base, tenantId, standardId]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setError('');
    try { await fn(); setDialog(null); await load(); } catch (err) { setError(apiError(err, 'That did not work.')); } finally { setBusy(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select aria-label="Entity" style={{ ...S.input, maxWidth: 220 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>{(data?.entities || []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select aria-label="Framework" style={{ ...S.input, maxWidth: 200 }} value={standardId} onChange={(e) => setStandardId(e.target.value)}>{(data?.frameworks || []).map((x: any) => <option key={x.id} value={x.id}>{x.code}</option>)}</select>
        {data && <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Records period: {data.recordsPeriodMonths} months</span>}
        {data?.can?.setPeriod && <button style={small} onClick={() => setDialog('period')}>Set the records period</button>}
        {data?.can?.opine && <button style={small} onClick={() => setDialog('opinion')}>Give readiness opinion</button>}
        {data?.can?.signOff && <button style={small} onClick={() => setDialog('signoff')}>Sign off readiness</button>}
      </div>
      {error && <div style={S.error}>{error}</div>}
      {data?.summary && data.clauses?.length > 0 && (
        <StatStrip items={[['Ready', data.summary.Ready], ['Nearly ready', data.summary['Nearly ready']], ['Not ready', data.summary['Not ready']], ['Not applicable', data.summary['Not applicable']], ['Management review (9.3)', data.managementReview93 ? 'Satisfied' : 'Not yet']]} />
      )}
      {data?.clauses?.length > 0 && (
        <div style={{ ...S.card, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={S.headRow}><th style={S.th}>Clause</th>{data.dimensions.map((d: string) => <th key={d} style={S.th}>{DIM_LABEL[d]}</th>)}<th style={S.th}>Readiness</th></tr></thead>
            <tbody>
              {data.clauses.map((c: any) => (
                <tr key={c.id} style={S.bodyRow}>
                  <td style={S.td}><div style={{ fontSize: 12.5 }}>{c.ref}</div><div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{c.title}</div></td>
                  {data.dimensions.map((d: string) => (
                    <td key={d} style={{ ...S.td, fontSize: 12 }} title={d === 'records' ? c.why.controls.map((x: any) => `${x.code}: ${x.evidenceCount} items over ${x.evidenceDays} days`).join('\n') : undefined}>
                      {c.checks[d] ? '✓' : '—'}
                      {d === 'records' && !c.checks[d] && c.why.controls.length > 0 && <div style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>{Math.max(...c.why.controls.map((x: any) => x.evidenceDays))} days of evidence</div>}
                      {d === 'gapsClosed' && c.why.openGaps.length > 0 && <div style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>{c.why.openGaps.join(', ')}</div>}
                    </td>
                  ))}
                  <td style={S.td}><span style={pill(...(VERDICT_TONE[c.verdict] || VERDICT_TONE['Not applicable']))}>{c.verdict}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(data?.opinions?.length > 0 || data?.signOffs?.length > 0) && (
        <div style={{ ...S.card, padding: 14, marginTop: 12, fontSize: 12.5 }}>
          {data.opinions.slice(0, 3).map((o: any) => (
            <div key={o.id} style={{ marginBottom: 6 }}><strong>The firm's opinion: {OPINION[o.verdict]}</strong> · {o.givenBy?.name} · {new Date(o.givenAt).toLocaleDateString()}<div>{o.opinion}</div>{o.conditions && <div style={{ color: 'var(--ink-muted)' }}>Conditions: {o.conditions}</div>}</div>
          ))}
          {data.signOffs.slice(0, 3).map((s: any) => (
            <div key={s.id} style={{ marginBottom: 6 }}><strong>Signed off</strong> · {s.signedBy?.name} · {new Date(s.signedAt).toLocaleDateString()}<div>{s.note}</div></div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 8px' }}>
        <strong style={{ fontSize: 14 }}>Management reviews (9.3)</strong>
        {reviews?.can?.prepare && <button style={small} onClick={() => setDialog({ review: null })}>{reviews.side === 'Client' ? 'Start a management review' : 'Prepare a management review'}</button>}
      </div>
      {reviews?.reviews?.map((r: any) => (
        <div key={r.id} style={{ ...S.card, padding: 12, marginBottom: 8, fontSize: 12.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{r.ref}</strong>
            <span style={pill(r.status === 'Recorded' ? 'var(--success)' : 'var(--info)', r.status === 'Recorded' ? 'var(--success-line)' : 'var(--line)')}>{r.status}</span>
            {r.heldOn && <span>held {new Date(r.heldOn).toLocaleDateString()}</span>}
            <span style={{ color: 'var(--ink-muted)' }}>prepared by {r.preparedBy?.name}{r.recordedBy ? ` · recorded by ${r.recordedBy.name}` : ''}</span>
            {r.status === 'Draft' && <button style={small} onClick={() => setDialog({ review: r })}>Edit</button>}
            {r.status === 'Draft' && reviews.can?.record && <button style={small} disabled={busy || r.missing.length > 0} onClick={() => act(() => apiClient.post(`${base}/management-reviews/${r.id}/record`, {}))}>Record the review</button>}
            {reviews.side === 'Client' && <button style={small} onClick={() => setDialog({ action: r })}>Add an action</button>}
          </div>
          {r.missing.length > 0 && <div style={{ color: 'var(--ink-muted)', marginTop: 4 }}>Still to record: {r.missing.join('; ')}</div>}
          {r.decisions && <div style={{ marginTop: 4 }}>Decisions: {r.decisions}</div>}
          {r.actions?.length > 0 && <div style={{ marginTop: 4, color: 'var(--ink-muted)' }}>Actions: {r.actions.map((x: any) => `${x.description}${x.linkLabel ? ` (${x.linkLabel})` : ''}`).join('; ')}</div>}
        </div>
      ))}

      {dialog === 'period' && (
        <FormDialog title="Set the records period" intro="How many months of operating evidence a control needs to be ready for Stage 2." submitLabel="Save" busy={busy} error={error}
          fields={[{ name: 'months', label: 'Months', type: 'number', required: true, initial: String(data?.recordsPeriodMonths ?? 3) }, { name: 'reason', label: 'Why', type: 'textarea', required: true }]}
          validate={(v) => (v.reason.trim().length < 10 ? 'Say why, in at least 10 characters.' : null)}
          onSubmit={(v) => act(() => apiClient.patch(`${base}/records-period`, { months: Number(v.months), reason: v.reason.trim() }))} onCancel={() => setDialog(null)} />
      )}
      {dialog === 'opinion' && (
        <FormDialog title="Give readiness opinion" intro="Beside the computed figures; it never changes them. The figures as they stand are kept with it." submitLabel="Give opinion" busy={busy} error={error}
          fields={[
            { name: 'verdict', label: 'Opinion', type: 'select', options: ['Ready', 'ReadyWithConditions', 'NotReady'], optionLabels: OPINION },
            { name: 'opinion', label: 'Opinion', type: 'textarea', required: true }, { name: 'conditions', label: 'Conditions (if any)', type: 'textarea' },
          ]}
          onSubmit={(v) => act(() => apiClient.post(`${base}/readiness/opinion`, { verdict: v.verdict, opinion: v.opinion.trim(), conditions: v.conditions.trim() || undefined }))} onCancel={() => setDialog(null)} />
      )}
      {dialog === 'signoff' && (
        <FormDialog title="Sign off readiness" intro="As sponsor, on the figures and the firm's opinion as they stand now." submitLabel="Sign off" busy={busy} error={error}
          fields={[{ name: 'note', label: 'What you are signing off', type: 'textarea', required: true }]}
          validate={(v) => (v.note.trim().length < 10 ? 'At least 10 characters.' : null)}
          onSubmit={(v) => act(() => apiClient.post(`${base}/readiness/sign-off`, { note: v.note.trim() }))} onCancel={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && 'action' in dialog && (
        <FormDialog title={`Add an action to ${dialog.action.ref}`} intro="An action the review decided, linked to the issue or engagement task that carries it." submitLabel="Add the action" busy={busy} error={error}
          fields={[
            { name: 'description', label: 'Action', type: 'textarea', required: true },
            { name: 'linkRef', label: 'Issue or task reference (optional)', type: 'text', placeholder: 'e.g. GAP-2026-001' },
          ]}
          validate={(v) => (v.description.trim().length < 5 ? 'Describe the action.' : null)}
          onSubmit={(v) => act(() => apiClient.post(`${base}/management-reviews/${dialog.action.id}/actions`, { description: v.description.trim(), linkRef: v.linkRef.trim() || undefined }))}
          onCancel={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && 'review' in dialog && reviews && (
        <ReviewDialog base={base} review={dialog.review} inputs={reviews.inputs} entities={reviews.entities} busy={busy}
          onCancel={() => setDialog(null)} onSave={(body) => act(() => (dialog.review ? apiClient.patch(`${base}/management-reviews/${dialog.review.id}`, body) : apiClient.post(`${base}/management-reviews`, body)))} />
      )}
    </div>
  );
};

const ReviewDialog: React.FC<{ base: string; review: any; inputs: { key: string; label: string }[]; entities: { id: string; name: string }[]; busy: boolean; onCancel: () => void; onSave: (b: any) => void }> = ({
  review, inputs, entities, busy, onCancel, onSave,
}) => {
  const [v, setV] = useState({
    tenantId: review?.tenantId || entities[0]?.id || '', heldOn: review?.heldOn ? String(review.heldOn).slice(0, 10) : '',
    attendees: (review?.attendees || []).join(', '), decisions: review?.decisions || '', inputs: { ...(review?.inputs || {}) } as Record<string, string>,
  });
  return (
    <DialogShell title={review ? `Edit ${review.ref}` : 'Management review'} onClose={busy ? () => undefined : onCancel} width={680}>
      {!review && (
        <>
          <label style={label} htmlFor="mr-org">Organisation</label>
          <select id="mr-org" style={S.input} value={v.tenantId} onChange={(e) => setV({ ...v, tenantId: e.target.value })}>{entities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </>
      )}
      <label style={label} htmlFor="mr-held">Held on</label>
      <input id="mr-held" type="date" style={S.input} value={v.heldOn} onChange={(e) => setV({ ...v, heldOn: e.target.value })} />
      <label style={label} htmlFor="mr-att">Attendees (comma separated)</label>
      <input id="mr-att" style={S.input} value={v.attendees} onChange={(e) => setV({ ...v, attendees: e.target.value })} />
      <div style={{ maxHeight: 300, overflow: 'auto', marginTop: 6 }}>
        {inputs.map((i) => (
          <div key={i.key}>
            <label style={label} htmlFor={`mr-${i.key}`}>{i.label}</label>
            <textarea id={`mr-${i.key}`} style={{ ...S.input, minHeight: 40 }} value={v.inputs[i.key] || ''} onChange={(e) => setV({ ...v, inputs: { ...v.inputs, [i.key]: e.target.value } })} />
          </div>
        ))}
      </div>
      <label style={label} htmlFor="mr-dec">Decisions (9.3.3)</label>
      <textarea id="mr-dec" style={{ ...S.input, minHeight: 60 }} value={v.decisions} onChange={(e) => setV({ ...v, decisions: e.target.value })} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={primaryBtn(busy)} disabled={busy} onClick={() => onSave({ tenantId: v.tenantId, heldOn: v.heldOn || undefined, attendees: String(v.attendees).split(',').map((x: string) => x.trim()).filter(Boolean), inputs: v.inputs, decisions: v.decisions })}>Save</button>
      </div>
    </DialogShell>
  );
};

export default EngagementReadiness;
