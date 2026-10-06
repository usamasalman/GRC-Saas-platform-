import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell from '../../../components/Dialog';
import FormDialog from '../../../components/FormDialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * The certification body (consulting engagement, sprint 13), the
 * organisation's side.
 *
 * The organisation invites its certification body for the days it sets,
 * freezes the audit pack the body reads, answers the body's questions and
 * records any nonconformity as an issue of its own. A body related to the
 * delivery firm is a warning confirmed with a reason, kept on the record.
 */

const KIND: Record<string, string> = { Question: 'Question', EvidenceRequest: 'Evidence request', Nonconformity: 'Nonconformity' };
const STATUS_TONE: Record<string, [string, string]> = {
  Invited: ['var(--info)', 'var(--line)'], Accepted: ['var(--success)', 'var(--success-line)'],
  Declined: ['var(--ink-muted)', 'var(--line)'], Revoked: ['var(--danger)', 'var(--danger-line)'],
  Open: ['var(--warning)', 'var(--warning-line)'], Answered: ['var(--success)', 'var(--success-line)'], Recorded: ['var(--success)', 'var(--success-line)'],
};
const small: React.CSSProperties = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };
const label: React.CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', margin: '8px 0 3px' };
const today = () => new Date().toISOString().slice(0, 10);
// Access is granted in whole days, stored as UTC midnight: shown as that day wherever the reader is.
const dayOf = (iso: string) => String(iso).slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const EngagementCertification: React.FC<{ projectId: string }> = ({ projectId }) => {
  const base = `/api/engagements/${projectId}/certification`;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | 'invite' | { revoke: any } | { answer: any } | { record: any }>(null);

  const load = useCallback(async () => {
    setError('');
    try { setData((await apiClient.get(base)).data); } catch (err) { setError(apiError(err, 'Could not load the certification body\'s access.')); }
  }, [base]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setError('');
    try { await fn(); setDialog(null); await load(); } catch (err) { setError(apiError(err, 'That did not work.')); } finally { setBusy(false); }
  };

  const live = (data?.access || []).find((x: any) => x.status === 'Invited' || x.status === 'Accepted');

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
        <strong style={{ fontSize: 14 }}>Certification body</strong>
        {data?.can?.invite && !live && <button style={small} onClick={() => setDialog('invite')}>Invite the certification body</button>}
      </div>
      {data && data.access.length === 0 && <div style={{ ...S.card, padding: 12, fontSize: 12.5, color: 'var(--ink-muted)' }}>No certification body is invited. It reads the frozen audit pack, read-only, for the days you set.</div>}
      {data?.access?.map((x: any) => (
        <div key={x.id} style={{ ...S.card, padding: 12, marginBottom: 8, fontSize: 12.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{x.body}</strong>
            <span style={pill(...(STATUS_TONE[x.status] || STATUS_TONE.Declined))}>{x.status}</span>
            <span>{dayOf(x.accessFrom)} to {dayOf(x.accessTo)}</span>
            {x.status === 'Accepted' && <span style={{ color: 'var(--ink-muted)' }}>{x.open ? 'reading today' : 'outside its days'}</span>}
            <span style={{ color: 'var(--ink-muted)' }}>invited by {x.invitedBy?.name}</span>
            {data.can.invite && (x.status === 'Invited' || x.status === 'Accepted') && <button style={small} onClick={() => setDialog({ revoke: x })}>Revoke access</button>}
          </div>
          {x.warnings.length > 0 && <div style={{ marginTop: 4, color: 'var(--warning)' }}>Independence: {x.warnings.join(' ')} Confirmed: {x.confirmationReason}</div>}
          {x.revokeReason && <div style={{ marginTop: 4, color: 'var(--ink-muted)' }}>Revoked: {x.revokeReason}</div>}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 8px' }}>
        <strong style={{ fontSize: 14 }}>Audit pack</strong>
        {data?.can?.freeze && <button style={small} disabled={busy} onClick={() => act(() => apiClient.post(`${base}/packs`, {}))}>Freeze the audit pack</button>}
      </div>
      {data && data.packs.length === 0 && <div style={{ ...S.card, padding: 12, fontSize: 12.5, color: 'var(--ink-muted)' }}>Nothing frozen yet. Freezing issues the Statement of Applicability, the traceability report and the readiness report, and hashes each; nothing later changes what the body reads.</div>}
      {data?.packs?.map((p: any) => (
        <div key={p.id} style={{ ...S.card, padding: 12, marginBottom: 8, fontSize: 12.5 }}>
          <div><strong>{p.ref}</strong> · frozen {new Date(p.frozenAt).toLocaleString()} by {p.frozenBy?.name}</div>
          {p.items.map((i: any) => (
            <div key={i.id} style={{ marginTop: 3, color: 'var(--ink-muted)' }}>{i.name} · {i.documentRef} · sha256 {String(i.sha256).slice(0, 16)}…</div>
          ))}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0 8px' }}>
        <strong style={{ fontSize: 14 }}>The body's questions</strong>
      </div>
      {data && data.questions.length === 0 && <div style={{ ...S.card, padding: 12, fontSize: 12.5, color: 'var(--ink-muted)' }}>No questions yet.</div>}
      {data?.questions?.map((q: any) => (
        <div key={q.id} style={{ ...S.card, padding: 12, marginBottom: 8, fontSize: 12.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{q.ref}</strong>
            <span style={pill(q.kind === 'Nonconformity' ? 'var(--danger)' : 'var(--info)', q.kind === 'Nonconformity' ? 'var(--danger-line)' : 'var(--line)')}>{KIND[q.kind]}</span>
            {q.clauseRef && <span>{q.clauseRef}</span>}
            <span style={pill(...(STATUS_TONE[q.status] || STATUS_TONE.Open))}>{q.status}</span>
            <span style={{ color: 'var(--ink-muted)' }}>{q.askedBy?.name} · {new Date(q.askedAt).toLocaleDateString()}</span>
            {q.status === 'Open' && q.kind !== 'Nonconformity' && <button style={small} onClick={() => setDialog({ answer: q })}>Answer</button>}
            {q.status === 'Open' && q.kind === 'Nonconformity' && data.can.record && <button style={small} onClick={() => setDialog({ record: q })}>Record as an issue</button>}
          </div>
          <div style={{ marginTop: 4 }}>{q.text}</div>
          {q.answer && <div style={{ marginTop: 4, color: 'var(--ink-muted)' }}>Answer: {q.answer}</div>}
          {q.issue && <div style={{ marginTop: 4, color: 'var(--ink-muted)' }}>Recorded as {q.issue.ref} ({q.issue.status})</div>}
        </div>
      ))}

      {dialog === 'invite' && data && (
        <InviteDialog bodies={data.bodies} busy={busy} onCancel={() => setDialog(null)}
          onInvite={async (body) => {
            setBusy(true); setError('');
            try { await apiClient.post(base, body); setDialog(null); await load(); return null; } catch (err: any) {
              const r = err?.response?.data;
              return r?.code === 'INDEPENDENCE_WARNING' ? { warnings: r.warnings as string[] } : { message: apiError(err, 'That did not work.') };
            } finally { setBusy(false); }
          }} />
      )}
      {dialog && typeof dialog === 'object' && 'revoke' in dialog && (
        <FormDialog title="Revoke access" intro={`${dialog.revoke.body} stops reading this engagement now.`} submitLabel="Revoke" busy={busy} error={error}
          fields={[{ name: 'reason', label: 'Why', type: 'textarea', required: true }]}
          validate={(v) => (v.reason.trim().length < 10 ? 'Say why, in at least 10 characters.' : null)}
          onSubmit={(v) => act(() => apiClient.post(`${base}/${dialog.revoke.id}/revoke`, { reason: v.reason.trim() }))} onCancel={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && 'answer' in dialog && (
        <FormDialog title={`Answer ${dialog.answer.ref}`} intro={dialog.answer.text} submitLabel="Send the answer" busy={busy} error={error}
          fields={[{ name: 'answer', label: 'Answer', type: 'textarea', required: true }]}
          onSubmit={(v) => act(() => apiClient.post(`${base}/questions/${dialog.answer.id}/answer`, { answer: v.answer.trim() }))} onCancel={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && 'record' in dialog && (
        <FormDialog title={`Record ${dialog.record.ref} as an issue`} intro="An issue of your own, source external audit, answered and closed like any other." submitLabel="Record as an issue" busy={busy} error={error}
          fields={[
            { name: 'title', label: 'Title', type: 'text', required: true, initial: `Nonconformity against ${dialog.record.clauseRef}` },
            { name: 'condition', label: 'What the body found', type: 'textarea', initial: dialog.record.text },
            { name: 'recommendation', label: 'Correction needed', type: 'textarea', required: true },
            { name: 'riskRating', label: 'Rating', type: 'select', options: ['Medium', 'High', 'Critical', 'Low'] },
          ]}
          validate={(v) => (v.recommendation.trim().length < 10 ? 'Say what correction is needed, in at least 10 characters.' : null)}
          onSubmit={(v) => act(() => apiClient.post(`${base}/questions/${dialog.record.id}/record`, { title: v.title.trim(), condition: v.condition.trim(), recommendation: v.recommendation.trim(), riskRating: v.riskRating }))}
          onCancel={() => setDialog(null)} />
      )}
    </div>
  );
};

const InviteDialog: React.FC<{
  bodies: { id: string; name: string }[]; busy: boolean; onCancel: () => void;
  onInvite: (body: any) => Promise<null | { warnings: string[] } | { message: string }>;
}> = ({ bodies, busy, onCancel, onInvite }) => {
  const [v, setV] = useState({ bodyTenantId: bodies[0]?.id || '', accessFrom: today(), accessTo: inDays(30), reason: '' });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const send = async () => {
    setProblem('');
    const out = await onInvite({ ...v, ...(warnings.length ? { confirmed: true, reason: v.reason.trim() } : {}) });
    if (out && 'warnings' in out) setWarnings(out.warnings);
    else if (out) setProblem(out.message);
  };
  return (
    <DialogShell title="Invite the certification body" onClose={busy ? () => undefined : onCancel} width={560}>
      {bodies.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>No certification body is on the platform yet. The platform operator adds one as an auditor organisation.</div>}
      {bodies.length > 0 && (
        <>
          <label style={label} htmlFor="cb-body">Certification body</label>
          <select id="cb-body" style={S.input} value={v.bodyTenantId} onChange={(e) => { setWarnings([]); setV({ ...v, bodyTenantId: e.target.value }); }}>{bodies.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <label style={label} htmlFor="cb-from">First day of access</label>
          <input id="cb-from" type="date" style={S.input} value={v.accessFrom} onChange={(e) => setV({ ...v, accessFrom: e.target.value })} />
          <label style={label} htmlFor="cb-to">Last day of access</label>
          <input id="cb-to" type="date" style={S.input} value={v.accessTo} onChange={(e) => setV({ ...v, accessTo: e.target.value })} />
        </>
      )}
      {warnings.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12.5 }}>
          <div style={{ color: 'var(--warning)' }}>{warnings.join(' ')}</div>
          <label style={label} htmlFor="cb-reason">Why it is acceptable (recorded)</label>
          <textarea id="cb-reason" style={{ ...S.input, minHeight: 60 }} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </div>
      )}
      {problem && <div style={{ ...S.error, marginTop: 8 }}>{problem}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={primaryBtn(busy || !v.bodyTenantId)} disabled={busy || !v.bodyTenantId || (warnings.length > 0 && v.reason.trim().length < 20)} onClick={send}>
          {warnings.length ? 'Confirm and invite' : 'Invite'}
        </button>
      </div>
    </DialogShell>
  );
};

export default EngagementCertification;
