import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import fetchAllPages from '../../../api/fetchAllPages';
import DialogShell, { ReasonDialog } from '../../../components/Dialog';
import FormDialog from '../../../components/FormDialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * One information request (consulting engagement, sprint 8): what was asked,
 * every answer with its files and their hashes, every review, and what the
 * caller may do next. The organisation answers, declines, hands it on or
 * moves its due date; the firm reviews or withdraws; either the firm's Lead
 * or the project manager records an overdue request as a blocker.
 */

const fmt = (d: string | null | undefined) => calendarDate(d, { day: '2-digit', month: 'short', year: 'numeric' });
const short = (h: string | null) => (h ? `${h.slice(0, 12)}…` : '—');
const VERDICT_LABEL: Record<string, string> = { Pass: 'Pass', Fail: 'Fail', NotApplicable: 'Not applicable' };
const STATUS_TONE: Record<string, [string, string]> = {
  Open: ['var(--warning)', 'var(--warning-line)'], Returned: ['var(--danger)', 'var(--danger-line)'],
  Answered: ['var(--brand)', 'var(--brand-line)'], Accepted: ['var(--success)', 'var(--success-line)'],
};
export const statusPill = (s: string) => pill(...(STATUS_TONE[s] || ['var(--ink-muted)', 'var(--line)']));

const readFile = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve((reader.result as string).split(',')[1]);
  reader.onerror = () => reject(new Error('Could not read the file.'));
  reader.readAsDataURL(file);
});

type Dialog = null | 'answer' | 'decline' | 'reassign' | 'due' | 'review' | 'withdraw' | 'blocker' | { link: any };

const RequestDetail: React.FC<{ projectId: string; requestId: string; onClose: () => void; onChanged: () => void }> = ({
  projectId, requestId, onClose, onChanged,
}) => {
  const [data, setData] = useState<any>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/engagements/${projectId}/requests/${requestId}`);
      setData(res.data);
    } catch (err) {
      setError(apiError(err, 'Could not load the request.'));
    }
  }, [projectId, requestId]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setDialog(null);
      await load();
      onChanged();
    } catch (err) {
      setDialog(null);
      setError(apiError(err, 'That could not be done.'));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (f: any, download: boolean) => {
    setError('');
    try {
      const res = await apiClient.get(`/api/engagements/${projectId}/requests/${requestId}/files/${f.linkId}`, {
        params: download ? {} : { disposition: 'preview' }, responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      if (download) {
        const a = document.createElement('a');
        a.href = url;
        a.download = f.fileName || 'file';
        a.click();
      } else {
        window.open(url, '_blank', 'noopener');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(apiError(err, 'Could not open the file.'));
    }
  };

  if (!data) {
    return <div style={{ ...S.card, padding: 16, marginTop: 14 }}>{error ? <div style={S.error}>{error}</div> : 'Loading…'}</div>;
  }
  const r = data.request;
  const can = data.can;
  const small = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };

  return (
    <div style={{ ...S.card, marginTop: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13.5 }}>{r.ref}</strong>
        <span style={{ fontSize: 13 }}>{r.title}</span>
        <span style={statusPill(r.status)}>{r.status}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {can.answer && <button style={primaryBtn(busy)} disabled={busy} onClick={() => setDialog('answer')}>Answer</button>}
          {can.review && <button style={primaryBtn(busy)} disabled={busy} onClick={() => setDialog('review')}>Review</button>}
          {can.decline && <button style={small} disabled={busy} onClick={() => setDialog('decline')}>Decline</button>}
          {can.reassign && <button style={small} disabled={busy} onClick={() => setDialog('reassign')}>Hand to a colleague</button>}
          {can.moveDue && <button style={small} disabled={busy} onClick={() => setDialog('due')}>Move due date</button>}
          {can.recordBlocker && <button style={small} disabled={busy} onClick={() => setDialog('blocker')}>Record as blocker</button>}
          {can.withdraw && <button style={small} disabled={busy} onClick={() => setDialog('withdraw')}>Withdraw</button>}
          <button style={small} onClick={onClose}>Close</button>
        </span>
      </div>
      {error && <div style={{ ...S.error, margin: 12 }}>{error}</div>}
      <div style={{ padding: '10px 16px', fontSize: 12.5, lineHeight: 1.8, borderBottom: '1px solid var(--line-soft)' }}>
        <div>{r.kind} · about {r.targetLabel || 'the engagement'} · asked by {r.raisedBy?.name} on {fmt(r.raisedAt)}</div>
        {r.criteria && <div>What would satisfy it: {r.criteria}</div>}
        {(r.periodFrom || r.periodTo) && <div>Period: {fmt(r.periodFrom)} → {fmt(r.periodTo)}</div>}
        <div>
          Due {fmt(r.dueDate)} · assigned to {r.assignee?.name}
          {r.overdueDays > 0 && <span style={{ ...pill('var(--danger)', 'var(--danger-line)'), marginLeft: 6 }}>overdue {r.overdueDays} days</span>}
          {r.dueDuringHold && <span style={{ ...pill('var(--warning)', 'var(--warning-line)'), marginLeft: 6 }}>Due during the hold</span>}
        </div>
        {r.closeNote && <div style={{ color: 'var(--ink-muted)' }}>{r.status} by {r.closedBy?.name}: {r.closeNote}</div>}
        {data.blockers?.length > 0 && <div>Recorded as {data.blockers.map((b: any) => b.ref).join(', ')} on the Delays tab.</div>}
      </div>

      <div style={{ padding: '10px 16px' }}>
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>Answers</div>
        {data.answers.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Not answered yet.</div>}
        {data.answers.map((ans: any) => (
          <div key={ans.id} style={{ borderTop: '1px solid var(--line-soft)', padding: '8px 0', opacity: ans.replacedAt ? 0.7 : 1 }}>
            <div style={{ fontSize: 12.5 }}>
              <strong>Answer {ans.version}</strong> · {ans.kind} · {ans.answeredBy?.name} · {fmt(ans.answeredAt)}
              {ans.replacedAt && <span style={{ color: 'var(--ink-muted)' }}> · replaced {fmt(ans.replacedAt)}</span>}
            </div>
            {ans.text && <div style={{ fontSize: 12.5, marginTop: 2 }}>{ans.text}</div>}
            {ans.recordLabel && (
              <div style={{ fontSize: 12.5, marginTop: 2 }}>
                {ans.register ? `${ans.register}: ` : 'Document: '}{ans.recordLabel}
                {ans.documentVersion && (
                  <span style={{ color: 'var(--ink-muted)' }}>
                    {' '}· linked while v{ans.documentVersion} was in force
                    {ans.document?.version && ans.document.version !== ans.documentVersion ? ` (now v${ans.document.version})` : ''}
                  </span>
                )}
              </div>
            )}
            {ans.files.map((f: any) => (
              <div key={f.linkId} style={{ fontSize: 12, marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{f.fileName} · {f.classification} · SHA-256 {short(f.sha256)}</span>
                <button style={{ ...small, padding: '1px 8px' }} onClick={() => openFile(f, false)}>View</button>
                {(data.side === 'Client' || data.documentAccess === 'Download') && (
                  <button style={{ ...small, padding: '1px 8px' }} onClick={() => openFile(f, true)}>Download</button>
                )}
                {can.link && !ans.replacedAt && (
                  <button style={{ ...small, padding: '1px 8px' }} onClick={() => setDialog({ link: f })}>Link to a task or control</button>
                )}
                {(f.alsoLinkedTo || []).map((l: any) => (
                  <span key={l.id} style={{ color: 'var(--ink-muted)' }}>
                    also on {l.label} ({l.linkedBy}, {fmt(l.linkedAt)})
                    {can.link && (
                      <button style={{ ...small, padding: '0 6px', marginLeft: 4 }} disabled={busy}
                        onClick={() => act(() => apiClient.post(`/api/engagements/${projectId}/evidence-links/${l.id}/remove`))}>Remove link</button>
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {data.reviews.length > 0 && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line-soft)' }}>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>Reviews</div>
          {data.reviews.map((v: any) => (
            <div key={v.id} style={{ fontSize: 12.5, padding: '4px 0' }}>
              <span style={statusPill(v.outcome)}>{v.outcome}</span> {v.reviewer?.name} · {fmt(v.reviewedAt)}
              {data.tests.filter((t: any) => v[t.key]).map((t: any) => (
                <span key={t.key} style={{ marginLeft: 8, color: v[t.key] === 'Fail' ? 'var(--danger)' : 'var(--ink-muted)' }}>
                  {t.label}: {VERDICT_LABEL[v[t.key]]}{v.testNotes?.[t.key] ? ` (${v.testNotes[t.key]})` : ''}
                </span>
              ))}
              {v.note && <div style={{ color: 'var(--ink-muted)' }}>{v.note}</div>}
            </div>
          ))}
        </div>
      )}

      {dialog === 'answer' && (
        <AnswerDialog projectId={projectId} request={r}
          onDone={() => { setDialog(null); load(); onChanged(); }}
          onCancel={() => setDialog(null)} />
      )}
      {dialog === 'review' && (
        <ReviewDialog kind={r.kind} tests={data.tests} busy={busy}
          onSubmit={(body) => act(() => apiClient.post(`/api/engagements/${projectId}/requests/${requestId}/review`, body))}
          onCancel={() => setDialog(null)} />
      )}
      {dialog === 'decline' && (
        <ReasonDialog title={`Decline ${r.ref}?`} message="The firm is told why. The request stays on record as declined."
          label="Why can it not be answered?" confirmLabel="Decline" minLength={10} busy={busy}
          onConfirm={(reason) => act(() => apiClient.post(`/api/engagements/${projectId}/requests/${requestId}/decline`, { reason }))}
          onCancel={() => setDialog(null)} />
      )}
      {dialog === 'withdraw' && (
        <ReasonDialog title={`Withdraw ${r.ref}?`} message="The organisation is told. It stays on record as withdrawn."
          label="Why is it no longer needed?" confirmLabel="Withdraw" minLength={10} busy={busy}
          onConfirm={(reason) => act(() => apiClient.post(`/api/engagements/${projectId}/requests/${requestId}/withdraw`, { reason }))}
          onCancel={() => setDialog(null)} />
      )}
      {dialog === 'blocker' && (
        <FormDialog title={`Record ${r.ref} as a blocker?`}
          intro={<>It goes on the Delays tab as a blocker owed by the organisation{r.targetType === 'Task' ? `, on ${r.targetLabel}` : ''}, and counts from today until it is cleared.</>}
          fields={[]} submitLabel="Record as blocker" busy={busy}
          onSubmit={() => act(() => apiClient.post(`/api/engagements/${projectId}/requests/${requestId}/blocker`))}
          onCancel={() => setDialog(null)} />
      )}
      {dialog === 'due' && (
        <FormDialog title={`Move the due date of ${r.ref}`}
          intro={<>The assignee and the firm are told, and the reminders start again for the new date.</>}
          fields={[
            { name: 'due', label: 'New due date', type: 'date', required: true, initial: String(r.dueDate).slice(0, 10) },
            { name: 'reason', label: 'Why', type: 'textarea', required: true },
          ]}
          submitLabel="Move due date" busy={busy}
          validate={(v) => (v.reason.trim().length < 10 ? 'Say why, in at least 10 characters.' : null)}
          onSubmit={(v) => act(() => apiClient.patch(`/api/engagements/${projectId}/requests/${requestId}/due`, { dueDate: v.due, reason: v.reason.trim() }))}
          onCancel={() => setDialog(null)} />
      )}
      {dialog === 'reassign' && (
        <ReassignDialog projectId={projectId} current={r.assignee?.id} busy={busy}
          onSubmit={(body) => act(() => apiClient.patch(`/api/engagements/${projectId}/requests/${requestId}/assignee`, body))}
          onCancel={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && 'link' in dialog && (
        <FormDialog title={`Link ${dialog.link.fileName} to a task or control`}
          intro={<>The same file, used again: nothing is copied. The link records who made it and when; removing it never deletes the file. It does not count as the task's evidence for verification.</>}
          fields={[
            { name: 'type', label: 'Link to', type: 'select', options: ['Task', 'Control'] },
            { name: 'ref', label: 'Reference', type: 'text', required: true, placeholder: 'TSK-0001 or AC-04' },
          ]}
          submitLabel="Link" busy={busy}
          onSubmit={(v) => act(() => apiClient.post(`/api/engagements/${projectId}/evidence-links`, {
            itemKind: dialog.link.itemKind, itemId: dialog.link.itemId, targetType: v.type, targetRef: v.ref.trim(),
          }))}
          onCancel={() => setDialog(null)} />
      )}
    </div>
  );
};

// ─── Answer ─────────────────────────────────────────────────────────────────

const MODES: Record<string, string> = {
  Upload: 'Upload a file', Evidence: 'Link evidence you hold', Document: 'Link a published document', Record: 'Link a record', Text: 'Answer in words',
};

const AnswerDialog: React.FC<{ projectId: string; request: any; onDone: () => void; onCancel: () => void }> = ({
  projectId, request, onDone, onCancel,
}) => {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(request.kind === 'Clarification' ? 'Text' : 'Upload');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [classification, setClassification] = useState('Internal');
  const [text, setText] = useState('');
  const [choice, setChoice] = useState('');
  const [register, setRegister] = useState('Risks');
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [same, setSame] = useState<any>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    setChoice('');
    setOptions([]);
    const base = `/api/engagements/${projectId}`;
    const load = async () => {
      if (mode === 'Evidence') {
        const res = await apiClient.get(`${base}/evidence-choices`, { params: { pageSize: 50 } });
        setOptions([
          ...(res.data.items || []).map((i: any) => ({ value: `EvidenceItem:${i.id}`, label: `${i.title} (${i.fileName}, ${i.classification})` })),
          ...(res.data.taskFiles || []).map((p: any) => ({ value: `ProjectEvidence:${p.id}`, label: `${p.task?.ref} · ${p.title} (${p.fileName})` })),
        ]);
      } else if (mode === 'Document') {
        const rows = await fetchAllPages<any>(`${base}/documents`, 'documents');
        setOptions(rows.map((d) => ({ value: d.id, label: `${d.code} · ${d.title}` })));
      } else if (mode === 'Record') {
        const key = register === 'Risks' ? 'risks' : 'assets';
        const rows = await fetchAllPages<any>(`${base}/${key}`, key);
        setOptions(rows.map((x) => ({ value: x.id, label: `${x.ref} · ${x.title || x.name}` })));
      }
    };
    load().catch(() => setOptions([]));
  }, [mode, register, projectId]);

  // Sends the answer; a file already held comes back as an offer to link it instead.
  const send = async (body: any) => {
    setBusy(true);
    setProblem('');
    try {
      await apiClient.post(`/api/engagements/${projectId}/requests/${request.id}/answer`, body);
      onDone();
    } catch (err: any) {
      if (err?.response?.data?.code === 'SAME_FILE') setSame(err.response.data.existing);
      else setProblem(apiError(err, 'The answer could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setProblem('');
    const body: any = { kind: mode, text: text.trim() || undefined };
    if (mode === 'Upload') {
      if (!file) { setProblem('Choose the file.'); return; }
      body.fileName = file.name;
      body.fileData = await readFile(file);
      body.title = title.trim() || file.name;
      body.classification = classification;
    }
    if (mode === 'Evidence') {
      const [itemKind, itemId] = choice.split(':');
      if (!itemId) { setProblem('Choose the evidence.'); return; }
      Object.assign(body, { itemKind, itemId });
    }
    if (mode === 'Document') { if (!choice) { setProblem('Choose the document.'); return; } body.documentId = choice; }
    if (mode === 'Record') { if (!choice) { setProblem('Choose the record.'); return; } Object.assign(body, { register, recordId: choice }); }
    if (mode === 'Text' && text.trim().length < 3) { setProblem('Write the answer.'); return; }
    await send(body);
  };

  const label: React.CSSProperties = { fontSize: 12, color: 'var(--ink-muted)', display: 'block', margin: '10px 0 4px' };
  const input: React.CSSProperties = { ...S.input, width: '100%' };
  return (
    <DialogShell title={`Answer ${request.ref}`} onClose={onCancel} width={560}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginBottom: 8 }}>
        {request.title}{request.criteria ? ` — ${request.criteria}` : ''}. Your answer stays your organisation's; the firm sees it through this request only, while its access is open.
      </div>
      {same ? (
        <div style={{ fontSize: 12.5 }}>
          <div style={{ marginBottom: 10 }}>This file is already held as <strong>{same.title}</strong> ({same.fileName}, stored {fmt(same.storedAt)}). Link that one instead of storing a copy?</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={ghostBtn} onClick={onCancel}>Cancel</button>
            <button style={primaryBtn(busy)} disabled={busy}
              onClick={() => send({ kind: 'Evidence', itemKind: same.itemKind, itemId: same.itemId, text: text.trim() || undefined })}>Link the existing file</button>
          </div>
          {problem && <div style={{ ...S.error, marginTop: 8 }}>{problem}</div>}
        </div>
      ) : (
        <>
          <label style={label}>How you answer</label>
          <select style={input} aria-label="How you answer" value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {mode === 'Upload' && (
            <>
              <label style={label}>File</label>
              <input type="file" aria-label="File" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <label style={label}>Title</label>
              <input style={input} aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the file name" />
              <label style={label}>Classification</label>
              <select style={input} aria-label="Classification" value={classification} onChange={(e) => setClassification(e.target.value)}>
                {['Public', 'Internal', 'Confidential', 'Restricted'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </>
          )}
          {mode === 'Record' && (
            <>
              <label style={label}>Register</label>
              <select style={input} aria-label="Register" value={register} onChange={(e) => setRegister(e.target.value)}>
                <option value="Risks">Risks</option><option value="Assets">Assets</option>
              </select>
            </>
          )}
          {(mode === 'Evidence' || mode === 'Document' || mode === 'Record') && (
            <>
              <label style={label}>{mode === 'Evidence' ? 'Evidence' : mode === 'Document' ? 'Document' : 'Record'}</label>
              <select style={input} aria-label={mode === 'Evidence' ? 'Evidence' : mode === 'Document' ? 'Document' : 'Record'} value={choice} onChange={(e) => setChoice(e.target.value)}>
                <option value="">{options.length ? 'Choose…' : 'Nothing the scope shares'}</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {mode !== 'Evidence' && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 4 }}>Only what this engagement's scope already shares. Anything else needs a scope change.</div>}
            </>
          )}
          <label style={label}>{mode === 'Text' ? 'Answer' : 'Note (optional)'}</label>
          <textarea style={{ ...input, minHeight: 70 }} aria-label={mode === 'Text' ? 'Answer' : 'Note'} value={text} onChange={(e) => setText(e.target.value)} />
          {problem && <div style={{ ...S.error, marginTop: 8 }}>{problem}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button style={ghostBtn} onClick={onCancel}>Cancel</button>
            <button style={primaryBtn(busy)} disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Send answer'}</button>
          </div>
        </>
      )}
    </DialogShell>
  );
};

// ─── Review ─────────────────────────────────────────────────────────────────

const ReviewDialog: React.FC<{ kind: string; tests: { key: string; label: string }[]; busy: boolean; onSubmit: (body: any) => void; onCancel: () => void }> = ({
  kind, tests, busy, onSubmit, onCancel,
}) => {
  const evidence = kind === 'Evidence';
  const [verdicts, setVerdicts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState('Accepted');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState('');
  const anyFail = Object.values(verdicts).includes('Fail');
  const submit = () => {
    if (evidence) {
      const missing = tests.find((t) => !verdicts[t.key]);
      if (missing) { setProblem(`Judge "${missing.label}".`); return; }
      const failNote = tests.find((t) => verdicts[t.key] === 'Fail' && (notes[t.key] || '').trim().length < 3);
      if (failNote) { setProblem(`Say why "${failNote.label}" fails.`); return; }
    }
    const result = evidence && anyFail ? 'Returned' : outcome;
    if (result === 'Returned' && note.trim().length < 10) { setProblem('Say what is missing — at least 10 characters.'); return; }
    onSubmit({ outcome: result, note: note.trim() || undefined, ...(evidence ? { tests: verdicts, testNotes: notes } : {}) });
  };
  const input: React.CSSProperties = { ...S.input, width: '100%' };
  return (
    <DialogShell title="Review the answer" onClose={onCancel} width={560}>
      {evidence && tests.map((t) => (
        <div key={t.key} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 170 }}>{t.label}</span>
            {['Pass', 'Fail', 'NotApplicable'].map((v) => (
              <label key={v} style={{ fontSize: 12 }}>
                <input type="radio" name={t.key} aria-label={`${t.label}: ${VERDICT_LABEL[v]}`} checked={verdicts[t.key] === v} onChange={() => setVerdicts((p) => ({ ...p, [t.key]: v }))} /> {VERDICT_LABEL[v]}
              </label>
            ))}
          </div>
          {verdicts[t.key] === 'Fail' && (
            <input style={{ ...input, marginTop: 4 }} aria-label={`Why ${t.label} fails`} placeholder="Why it fails" value={notes[t.key] || ''} onChange={(e) => setNotes((p) => ({ ...p, [t.key]: e.target.value }))} />
          )}
        </div>
      ))}
      <label style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'block', margin: '10px 0 4px' }}>Outcome</label>
      <select style={input} aria-label="Outcome" value={evidence && anyFail ? 'Returned' : outcome} disabled={evidence && anyFail} onChange={(e) => setOutcome(e.target.value)}>
        <option value="Accepted">Accepted</option><option value="Returned">Returned</option>
      </select>
      {evidence && anyFail && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 4 }}>Evidence that fails a test is returned.</div>}
      <label style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'block', margin: '10px 0 4px' }}>What is missing (when returned)</label>
      <textarea style={{ ...input, minHeight: 60 }} aria-label="What is missing" value={note} onChange={(e) => setNote(e.target.value)} />
      <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 6 }}>Accepted counts toward readiness only. It does not verify a task or validate a control; that stays with the organisation.</div>
      {problem && <div style={{ ...S.error, marginTop: 8 }}>{problem}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel}>Cancel</button>
        <button style={primaryBtn(busy)} disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Save review'}</button>
      </div>
    </DialogShell>
  );
};

// ─── Hand on ────────────────────────────────────────────────────────────────

const ReassignDialog: React.FC<{ projectId: string; current: string; busy: boolean; onSubmit: (body: any) => void; onCancel: () => void }> = ({
  projectId, current, busy, onSubmit, onCancel,
}) => {
  const [people, setPeople] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    // Colleagues of the organisation; without the directory, the engagement's own team.
    fetchAllPages<any>('/api/iam/users', 'users')
      .then((rows) => setPeople(rows.filter((u) => u.status === 'Active' && u.id !== current).map((u) => ({ id: u.id, name: u.name }))))
      .catch(async () => {
        const res = await apiClient.get(`/api/projects/${projectId}/members`).catch(() => null);
        setPeople((res?.data?.members || []).filter((m: any) => m.side === 'Client' && m.active && m.userId !== current).map((m: any) => ({ id: m.userId, name: m.userName })));
      });
  }, [projectId, current]);
  if (!people) return null;
  return (
    <FormDialog title="Hand to a colleague"
      intro={<>They must be able to work on projects. The project manager is told when an assignee hands a request on.</>}
      fields={[
        { name: 'to', label: 'Colleague', type: 'select', required: true, options: people.map((p) => p.id), optionLabels: Object.fromEntries(people.map((p) => [p.id, p.name])) },
        { name: 'note', label: 'Note', type: 'textarea' },
      ]}
      submitLabel="Hand over" busy={busy}
      onSubmit={(v) => onSubmit({ assigneeId: v.to, note: v.note.trim() || undefined })}
      onCancel={onCancel} />
  );
};

export default RequestDetail;
