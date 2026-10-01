import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell, { ReasonDialog } from '../../../components/Dialog';
import FormDialog from '../../../components/FormDialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';
import RequestDetail, { statusPill } from './RequestDetail';

/**
 * The Requests tab of a consulting engagement (sprint 8), both sides.
 *
 * The firm's Lead and Consultants raise requests one at a time or import a
 * file of them, and ask for a scope change when what they need is outside
 * the scope; its Reviewers see. The organisation answers, and approves or
 * rejects scope changes; an approved change drafts the next scope version for
 * a second person to approve on the Scope tab.
 */

const fmt = (d: string | null | undefined) => calendarDate(d, { day: '2-digit', month: 'short', year: 'numeric' });
const KINDS = ['Evidence', 'Document', 'Dataset', 'Clarification'];
const ABOUT = ['Engagement', 'Task', 'Clause', 'Control', 'Register'];
const HINT: Record<string, string> = {
  Engagement: '', Task: 'TSK-0001', Clause: 'ISO27001 A.5.15', Control: 'AC-04', Register: 'Risks, Assets, Vendors, Documents or Controls',
};
const SERVICES = ['Documents', 'Controls', 'Risks', 'Assets', 'Vendors'];
const PAGE = 25;

const readFile = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve((reader.result as string).split(',')[1]);
  reader.onerror = () => reject(new Error('Could not read the file.'));
  reader.readAsDataURL(file);
});

const download = async (url: string, name: string) => {
  const res = await apiClient.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
  URL.revokeObjectURL(href);
};

type Dialog = null | 'raise' | 'import' | { scopeChange: { services: string[]; entityIds: string[]; frameworkIds: string[]; pending?: any } }
  | { approve: any } | { reject: any };

const EngagementRequests: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [data, setData] = useState<any>(null);
  const [changes, setChanges] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        apiClient.get(`/api/engagements/${projectId}/requests`, { params: { page, pageSize: PAGE, status: status || undefined } }),
        apiClient.get(`/api/engagements/${projectId}/scope-changes`, { params: { pageSize: 50 } }),
      ]);
      setData(r.data);
      setChanges(c.data);
    } catch (err) {
      setError(apiError(err, 'Could not load the requests.'));
    }
  }, [projectId, page, status]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setDialog(null);
      if (done) setNotice(done);
      await load();
    } catch (err) {
      setDialog(null);
      setError(apiError(err, 'That could not be done.'));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div style={{ color: 'var(--ink-muted)', padding: 20 }}>{error || 'Loading…'}</div>;
  const s = data.summary || {};
  const small = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {['Open', 'Answered', 'Returned', 'Accepted', 'Declined', 'Withdrawn'].map((k) => (
          <button key={k} style={{ ...small, ...(status === k ? { borderColor: 'var(--brand)', color: 'var(--brand)' } : {}) }}
            onClick={() => { setStatus(status === k ? '' : k); setPage(1); }}>
            {k} {s[k] ?? 0}
          </button>
        ))}
        {s.overdue > 0 && <span style={pill('var(--danger)', 'var(--danger-line)')}>{s.overdue} overdue</span>}
        <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Clauses with evidence the firm accepted: {s.acceptedClauses ?? 0}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {data.can.raise && <button style={primaryBtn(false)} onClick={() => setDialog('raise')}>Raise a request</button>}
          {data.can.import && <button style={ghostBtn} onClick={() => setDialog('import')}>Import requests</button>}
          {data.can.scopeChange && (
            <button style={ghostBtn} onClick={() => setDialog({ scopeChange: { services: [], entityIds: [], frameworkIds: [] } })}>Ask for a scope change</button>
          )}
          <button style={ghostBtn} onClick={() => download(`/api/engagements/${projectId}/requests/export`, 'requests.xlsx').catch((err) => setError(apiError(err, 'Could not export.')))}>Export</button>
        </span>
      </div>
      {error && <div style={{ ...S.error, marginBottom: 12 }}>{error}</div>}
      {notice && <div style={{ ...S.card, padding: '8px 14px', marginBottom: 12, fontSize: 12.5 }}>{notice}</div>}

      <div style={{ ...S.card, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={S.th}>Request</th><th style={S.th}>About</th><th style={S.th}>Due</th>
              <th style={S.th}>Assigned to</th><th style={S.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.requests.length === 0 && (
              <tr><td style={{ ...S.td, color: 'var(--ink-muted)' }} colSpan={5}>
                {data.side === 'Provider' ? 'No requests yet. Ask the organisation for what the work needs.' : 'The firm has not asked for anything yet.'}
              </td></tr>
            )}
            {data.requests.map((r: any) => (
              <tr key={r.id} style={{ cursor: 'pointer', background: open === r.id ? 'var(--surface-2, transparent)' : undefined }} onClick={() => setOpen(r.id)}>
                <td style={S.td}>
                  <div style={{ fontSize: 12.5 }}><strong>{r.ref}</strong> · {r.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.kind} · asked by {r.raisedBy?.name}{r.importedFrom ? ` · imported from ${r.importedFrom}` : ''}</div>
                </td>
                <td style={{ ...S.td, fontSize: 12 }}>{r.targetLabel || 'The engagement'}</td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  {fmt(r.dueDate)}
                  {r.overdueDays > 0 && <div><span style={pill('var(--danger)', 'var(--danger-line)')}>overdue {r.overdueDays} days</span></div>}
                  {r.dueDuringHold && <div><span style={pill('var(--warning)', 'var(--warning-line)')}>Due during the hold</span></div>}
                </td>
                <td style={{ ...S.td, fontSize: 12 }}>{r.assignee?.name}</td>
                <td style={S.td}><span style={statusPill(r.status)}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px', fontSize: 12, color: 'var(--ink-muted)' }}>
          {data.paging?.total ?? 0} request(s)
          <button style={{ ...small, marginLeft: 'auto' }} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <button style={small} disabled={!data.paging?.hasMore} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>

      {open && <RequestDetail key={open} projectId={projectId} requestId={open} onClose={() => setOpen(null)} onChanged={load} />}

      {changes && (changes.scopeChanges.length > 0) && (
        <div style={{ ...S.card, marginTop: 14, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13 }}>Scope changes</div>
          {changes.scopeChanges.map((c: any) => (
            <div key={c.id} style={{ padding: '8px 16px', borderTop: '1px solid var(--line-soft)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{c.ref}</strong>
              <span>
                Add {[...c.services, ...c.frameworks.map((f: any) => f.name), ...c.entities.map((x: any) => x.name), ...(c.classificationCeiling ? [`up to ${c.classificationCeiling}`] : [])].join(', ')}
              </span>
              <span style={{ color: 'var(--ink-muted)' }}>— {c.reason} · {c.requestedBy?.name}, {fmt(c.requestedAt)}</span>
              {c.pendingRequest && <span style={{ color: 'var(--ink-muted)' }}>waiting: {c.pendingRequest.title}</span>}
              <span style={statusPill(c.status === 'Approved' ? 'Accepted' : c.status === 'Rejected' ? 'Returned' : 'Open')}>
                {c.status === 'Drafted' ? 'Waiting for a second approval' : c.status}
              </span>
              {c.decisionNote && <span style={{ color: 'var(--ink-muted)' }}>{c.decidedBy?.name}: {c.decisionNote}</span>}
              {changes.can.decide && c.status === 'Pending' && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button style={primaryBtn(busy)} disabled={busy} onClick={() => setDialog({ approve: c })}>Approve change</button>
                  <button style={small} disabled={busy} onClick={() => setDialog({ reject: c })}>Reject</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {dialog === 'raise' && (
        <RaiseDialog projectId={projectId}
          onDone={(ref) => { setDialog(null); setNotice(`${ref} raised. The organisation is told.`); load(); }}
          onScopeChange={(ask) => setDialog({ scopeChange: ask })}
          onCancel={() => setDialog(null)} />
      )}
      {dialog === 'import' && (
        <ImportDialog projectId={projectId}
          onDone={(n) => { setDialog(null); setNotice(`${n} request(s) imported.`); load(); }}
          onCancel={() => setDialog(null)} />
      )}
      {dialog && typeof dialog === 'object' && 'scopeChange' in dialog && (
        <FormDialog
          title="Ask for a scope change"
          intro={<>Only the organisation decides. If it agrees, a second person of the organisation approves the new scope version before anything more is shared{dialog.scopeChange.pending ? <>; then your request &quot;{dialog.scopeChange.pending.title}&quot; is raised</> : null}.</>}
          fields={[
            { name: 'services', label: 'Register to add', type: 'select', options: ['', ...SERVICES],
              optionLabels: { '': dialog.scopeChange.services.length || dialog.scopeChange.frameworkIds.length || dialog.scopeChange.entityIds.length ? 'As the request needs' : 'None' },
              initial: dialog.scopeChange.services[0] ?? '' },
            { name: 'ceiling', label: 'Classification ceiling', type: 'select', options: ['', 'Internal', 'Confidential', 'Restricted'], optionLabels: { '': 'Keep the current ceiling' } },
            { name: 'reason', label: 'Why the work needs it', type: 'textarea', required: true },
          ]}
          submitLabel="Ask" busy={busy}
          validate={(v) => {
            if (v.reason.trim().length < 10) return 'Say why, in at least 10 characters.';
            const any = v.services || v.ceiling || dialog.scopeChange.frameworkIds.length || dialog.scopeChange.entityIds.length;
            return any ? null : 'Choose what to add.';
          }}
          onSubmit={(v) => act(() => apiClient.post(`/api/engagements/${projectId}/scope-changes`, {
            services: [...new Set([...dialog.scopeChange.services, ...(v.services ? [v.services] : [])])],
            frameworkIds: dialog.scopeChange.frameworkIds, entityIds: dialog.scopeChange.entityIds,
            classificationCeiling: v.ceiling || undefined, reason: v.reason.trim(),
            pendingRequest: dialog.scopeChange.pending,
          }), 'Scope change asked. The organisation decides.')}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog && typeof dialog === 'object' && 'approve' in dialog && (
        <FormDialog
          title={`Approve ${dialog.approve.ref}?`}
          intro={<>This drafts the next scope version in your name. Someone else of your organisation approves it on the Scope tab; until then nothing more is shared.</>}
          fields={[{ name: 'note', label: 'Note', type: 'textarea' }]}
          submitLabel="Approve change" busy={busy}
          onSubmit={(v) => act(() => apiClient.post(`/api/engagements/${projectId}/scope-changes/${dialog.approve.id}/approve`, { note: v.note.trim() || undefined }),
            'Drafted. A second person approves the new version on the Scope tab.')}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog && typeof dialog === 'object' && 'reject' in dialog && (
        <ReasonDialog title={`Reject ${dialog.reject.ref}?`} message="The firm is told why. It stays in the history."
          label="Why?" confirmLabel="Reject" minLength={10} busy={busy}
          onConfirm={(reason) => act(() => apiClient.post(`/api/engagements/${projectId}/scope-changes/${dialog.reject.id}/reject`, { reason }))}
          onCancel={() => setDialog(null)} />
      )}
    </div>
  );
};

// ─── Raise ──────────────────────────────────────────────────────────────────

const RaiseDialog: React.FC<{
  projectId: string; onDone: (ref: string) => void; onCancel: () => void;
  onScopeChange: (ask: { services: string[]; entityIds: string[]; frameworkIds: string[]; pending: any }) => void;
}> = ({ projectId, onDone, onCancel, onScopeChange }) => {
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [outside, setOutside] = useState<{ message: string; ask: any; body: any } | null>(null);
  useEffect(() => {
    apiClient.get(`/api/projects/${projectId}/members`)
      .then((r) => setTeam((r.data?.members || []).filter((m: any) => m.side === 'Client' && m.active).map((m: any) => ({ id: m.userId, name: m.userName }))))
      .catch(() => setTeam([]));
  }, [projectId]);

  const raise = async (v: Record<string, string>) => {
    setBusy(true);
    setProblem('');
    const body = {
      kind: v.kind, title: v.title.trim(), criteria: v.criteria.trim() || undefined, targetType: v.about,
      targetRef: v.about === 'Engagement' ? undefined : v.reference.trim(), periodFrom: v.from || undefined, periodTo: v.to || undefined,
      dueDate: v.due, assigneeId: v.assignee || undefined,
    };
    try {
      const res = await apiClient.post(`/api/engagements/${projectId}/requests`, body);
      onDone(res.data.request.ref);
    } catch (err: any) {
      const d = err?.response?.data;
      if (d?.code === 'OUT_OF_SCOPE' && d.scopeChange) setOutside({ message: d.message, ask: d.scopeChange, body });
      else setProblem(apiError(err, 'The request could not be raised.'));
    } finally {
      setBusy(false);
    }
  };

  if (outside) {
    return (
      <DialogShell title="Outside the scope" onClose={onCancel}>
        <div style={{ fontSize: 12.5, marginBottom: 12 }}>{outside.message} A request can only ask for what the scope shares. Ask for a scope change: if the organisation agrees, your request is raised when the new scope binds.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={ghostBtn} onClick={onCancel}>Cancel</button>
          <button style={primaryBtn(false)} onClick={() => onScopeChange({
            ...outside.ask,
            pending: outside.body,
          })}>Ask for a scope change</button>
        </div>
      </DialogShell>
    );
  }
  return (
    <FormDialog
      title="Raise a request"
      intro={<>The organisation is told. Ask only for what the engagement's scope shares; the due date must fall inside your own access dates.</>}
      fields={[
        { name: 'kind', label: 'Kind', type: 'select', options: KINDS },
        { name: 'title', label: 'What you need', type: 'text', required: true },
        { name: 'criteria', label: 'What would satisfy it', type: 'textarea' },
        { name: 'about', label: 'About', type: 'select', options: ABOUT, help: 'Engagement, or a task, clause, control or register by its reference below.' },
        { name: 'reference', label: 'Reference', type: 'text', placeholder: 'TSK-0001 · ISO27001 A.5.15 · AC-04 · Vendors' },
        { name: 'from', label: 'Period from', type: 'date' },
        { name: 'to', label: 'Period to', type: 'date' },
        { name: 'due', label: 'Due date', type: 'date', required: true },
        { name: 'assignee', label: 'Assign to', type: 'select', options: ['', ...team.map((t) => t.id)],
          optionLabels: { '': 'The project manager', ...Object.fromEntries(team.map((t) => [t.id, t.name])) },
          help: 'Only the people the organisation has put on this engagement.' },
      ]}
      submitLabel="Raise request" busy={busy} error={problem}
      validate={(v) => (v.about !== 'Engagement' && !v.reference.trim() ? `Give the ${v.about.toLowerCase()}'s reference, e.g. ${HINT[v.about]}.` : null)}
      onSubmit={raise}
      onCancel={onCancel}
    />
  );
};

// ─── Import ─────────────────────────────────────────────────────────────────

const ImportDialog: React.FC<{ projectId: string; onDone: (n: number) => void; onCancel: () => void }> = ({ projectId, onDone, onCancel }) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const base = `/api/engagements/${projectId}/requests/import`;

  const body = async () => ({ fileName: file!.name, fileData: await readFile(file!) });
  const check = async () => {
    if (!file) return;
    setBusy(true);
    setProblem('');
    try {
      setPreview((await apiClient.post(`${base}/preview`, await body())).data);
    } catch (err) {
      setPreview(null);
      setProblem(apiError(err, 'The file could not be read.'));
    } finally {
      setBusy(false);
    }
  };
  const importAll = async () => {
    setBusy(true);
    setProblem('');
    try {
      const res = await apiClient.post(base, await body());
      onDone(res.data.count);
    } catch (err: any) {
      if (err?.response?.data?.rows) setPreview({ ...err.response.data, ok: false });
      setProblem(apiError(err, 'Nothing was imported.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell title="Import requests" onClose={onCancel} width={760}>
      <div style={{ fontSize: 12.5, marginBottom: 10 }}>
        Fill in the template and check the file. Every row is checked: the assignee is on the engagement team, the due date is inside your access dates,
        what it is about is in scope, and it does not repeat an open request. One row with a problem stops the whole file; nothing is half imported.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <button style={ghostBtn} onClick={() => download(`${base}/template`, 'information-requests-template.xlsx').catch((err) => setProblem(apiError(err, 'Could not download the template.')))}>Download the template</button>
        <input type="file" accept=".xlsx,.csv" aria-label="File to import" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); }} />
        <button style={ghostBtn} disabled={!file || busy} onClick={check}>Check the file</button>
      </div>
      {problem && <div style={{ ...S.error, marginBottom: 10 }}>{problem}</div>}
      {preview && (
        <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Row</th><th style={S.th}>Request</th><th style={S.th}>Due</th><th style={S.th}>Check</th></tr></thead>
            <tbody>
              {preview.rows.map((r: any) => (
                <tr key={r.line}>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.line}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.values.kind} · {r.values.title}<div style={{ color: 'var(--ink-muted)' }}>{r.values.targetType} {r.values.reference}</div></td>
                  <td style={{ ...S.td, fontSize: 12 }}>{r.values.dueDate}</td>
                  <td style={{ ...S.td, fontSize: 12, color: r.problems.length ? 'var(--danger)' : 'var(--success)' }}>{r.problems.length ? r.problems.join(' ') : 'Ready'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel}>Cancel</button>
        <button style={primaryBtn(busy || !preview?.ok)} disabled={busy || !preview?.ok} onClick={importAll}>
          {preview?.ok ? `Import all ${preview.count}` : 'Import all'}
        </button>
      </div>
    </DialogShell>
  );
};

export default EngagementRequests;
