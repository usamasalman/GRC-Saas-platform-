import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell, { ReasonDialog } from '../../../components/Dialog';
import { S, ghostBtn, primaryBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * Threads on an engagement (consulting engagement, sprint 9).
 *
 * Each side sees the Engagement threads and its own internal ones; who reads
 * a thread is chosen when it starts and never widened. Posts are not edited:
 * a retraction keeps the words, marked. A thread becomes a task or a request
 * through the forms that make them, and is linked to what it became.
 */

const VIS_LABEL: Record<string, string> = { Engagement: 'Both sides', ClientInternal: 'Organisation only', FirmInternal: 'Firm only' };
const VIS_TONE: Record<string, [string, string]> = {
  Engagement: ['var(--info)', 'var(--line)'], ClientInternal: ['var(--brand)', 'var(--brand-line)'], FirmInternal: ['var(--warning)', 'var(--warning-line)'],
};
const KIND_LABEL: Record<string, string> = { Comment: 'Comment', Question: 'Question', Decision: 'Decision', ReviewNote: 'Review note' };
const SUBJECTS = ['Engagement', 'Task', 'Request', 'Document', 'Risk', 'Asset'];
const small: React.CSSProperties = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };
const label: React.CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', margin: '8px 0 3px' };
const when = (d: string) => new Date(d).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const EngagementDiscussions: React.FC<{ projectId: string }> = ({ projectId }) => {
  const base = `/api/engagements/${projectId}/threads`;
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setData((await apiClient.get(base, { params: { status: status || undefined, pageSize: 50 } })).data);
    } catch (err) {
      setError(apiError(err, 'Could not load the threads.'));
    }
  }, [base, status]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select aria-label="Status" style={{ ...S.input, maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Every thread</option><option value="Open">Open</option><option value="Resolved">Resolved</option><option value="Converted">Converted</option>
        </select>
        {data?.canWrite && <button style={primaryBtn(false)} onClick={() => setStarting(true)}>Start a thread</button>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-muted)' }}>
          {data ? `${data.paging?.total ?? data.threads.length} threads · you read ${data.visibilities.map((v: string) => VIS_LABEL[v].toLowerCase()).join(' and ')}` : ''}
        </span>
      </div>
      {error && <div style={S.error}>{error}</div>}
      {data && (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={S.headRow}><th style={S.th}>Thread</th><th style={S.th}>About</th><th style={S.th}>Who reads it</th><th style={S.th}>Status</th><th style={S.th}>Posts</th><th style={S.th}>Last post</th></tr>
            </thead>
            <tbody>
              {data.threads.map((t: any) => (
                <tr key={t.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <button style={{ ...linkBtn('var(--info)'), padding: 0, textAlign: 'left' }} onClick={() => setOpenId(t.id)}>{t.ref} · {t.title}</button>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>started by {t.createdBy?.name}</div>
                  </td>
                  <td style={S.td}>{t.subjectType === 'Engagement' ? 'The engagement' : `${t.subjectType}: ${t.subjectLabel}`}</td>
                  <td style={S.td}><span style={pill(...(VIS_TONE[t.visibility] || VIS_TONE.Engagement))}>{VIS_LABEL[t.visibility]}</span></td>
                  <td style={S.td}>{t.status === 'Converted' ? `Became ${t.convertedToLabel}` : t.status}</td>
                  <td style={S.td}>{t._count?.posts ?? 0}</td>
                  <td style={S.td}>{when(t.lastPostAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.threads.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: 'var(--ink-muted)' }}>No threads yet.</div>}
        </div>
      )}
      {starting && data && (
        <StartThread base={base} visibilities={data.visibilities} onCancel={() => setStarting(false)}
          onDone={(id) => { setStarting(false); load(); setOpenId(id); }} />
      )}
      {openId && <ThreadView projectId={projectId} base={base} threadId={openId} onClose={() => { setOpenId(null); load(); }} />}
    </div>
  );
};

const StartThread: React.FC<{ base: string; visibilities: string[]; onCancel: () => void; onDone: (id: string) => void }> = ({ base, visibilities, onCancel, onDone }) => {
  const [v, setV] = useState({ subjectType: 'Engagement', subjectId: '', visibility: visibilities[0], title: '', kind: 'Comment', body: '' });
  const [subjects, setSubjects] = useState<{ id: string; label: string }[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (v.subjectType === 'Engagement') { setSubjects([]); return; }
    const t = setTimeout(() => {
      apiClient.get(`${base}/subjects`, { params: { type: v.subjectType, q: q || undefined } })
        .then((r) => setSubjects(r.data.subjects || [])).catch(() => setSubjects([]));
    }, 250);
    return () => clearTimeout(t);
  }, [base, v.subjectType, q]);
  const start = async () => {
    setBusy(true); setProblem('');
    try {
      const res = await apiClient.post(base, { ...v, subjectId: v.subjectId || undefined });
      onDone(res.data.thread.id);
    } catch (err) {
      setProblem(apiError(err, 'The thread could not be started.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell title="Start a thread" onClose={busy ? () => undefined : onCancel} width={620}>
      {problem && <div role="alert" style={{ ...S.error, marginBottom: 8 }}>{problem}</div>}
      <label style={label} htmlFor="th-subject">About</label>
      <select id="th-subject" style={S.input} value={v.subjectType} onChange={(e) => setV({ ...v, subjectType: e.target.value, subjectId: '' })}>
        {SUBJECTS.map((s) => <option key={s} value={s}>{s === 'Engagement' ? 'The engagement' : s}</option>)}
      </select>
      {v.subjectType !== 'Engagement' && (
        <>
          <input aria-label="Search" style={{ ...S.input, marginTop: 6 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label="Which one" style={{ ...S.input, marginTop: 6 }} value={v.subjectId} onChange={(e) => setV({ ...v, subjectId: e.target.value })}>
            <option value="">Choose…</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {['Document', 'Risk', 'Asset'].includes(v.subjectType) && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 3 }}>Only records the scope shares.</div>}
        </>
      )}
      <label style={label} htmlFor="th-vis">Who reads it — fixed once it starts</label>
      <select id="th-vis" style={S.input} value={v.visibility} onChange={(e) => setV({ ...v, visibility: e.target.value })}>
        {visibilities.map((x) => <option key={x} value={x}>{VIS_LABEL[x]}</option>)}
      </select>
      <label style={label} htmlFor="th-title">Title</label>
      <input id="th-title" style={S.input} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      <label style={label} htmlFor="th-kind">First post</label>
      <select id="th-kind" style={S.input} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
        {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <textarea aria-label="Post" style={{ ...S.input, minHeight: 90, marginTop: 6 }} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={primaryBtn(busy)} disabled={busy || !v.title.trim() || !v.body.trim() || (v.subjectType !== 'Engagement' && !v.subjectId)} onClick={start}>Start thread</button>
      </div>
    </DialogShell>
  );
};

const ThreadView: React.FC<{ projectId: string; base: string; threadId: string; onClose: () => void }> = ({ projectId, base, threadId, onClose }) => {
  const [data, setData] = useState<any>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('Comment');
  const [body, setBody] = useState('');
  const [named, setNamed] = useState<string[]>([]);
  const [retracting, setRetracting] = useState<any>(null);
  const [converting, setConverting] = useState(false);
  const url = `${base}/${threadId}`;

  const load = useCallback(async () => {
    try { setData((await apiClient.get(url)).data); } catch (err) { setProblem(apiError(err, 'Could not load the thread.')); }
  }, [url]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setProblem('');
    try { await fn(); await load(); return true; } catch (err) { setProblem(apiError(err, 'That did not work.')); return false; } finally { setBusy(false); }
  };

  if (!data) return <DialogShell title="Thread" onClose={onClose} width={760}><div style={{ fontSize: 12.5 }}>{problem || 'Loading…'}</div></DialogShell>;
  const t = data.thread;
  return (
    <DialogShell title={`${t.ref} · ${t.title}`} onClose={onClose} width={760}>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={pill(...(VIS_TONE[t.visibility] || VIS_TONE.Engagement))}>{VIS_LABEL[t.visibility]}</span>
        <span>{t.subjectType === 'Engagement' ? 'About the engagement' : `About ${t.subjectType.toLowerCase()} ${t.subjectLabel}`}</span>
        <span>· {t.status === 'Converted' ? `Became ${t.convertedToLabel}` : t.status}</span>
        {data.can.resolve && (
          <button style={small} disabled={busy} onClick={() => act(() => apiClient.post(`${url}/status`, { status: t.status === 'Resolved' ? 'Open' : 'Resolved' }))}>
            {t.status === 'Resolved' ? 'Reopen' : 'Mark resolved'}
          </button>
        )}
        {data.can.convert && data.can.convertTo.length > 0 && <button style={small} disabled={busy} onClick={() => setConverting(true)}>{data.can.convertTo[0] === 'Task' ? 'Convert to a task' : 'Convert to a request'}</button>}
      </div>
      {problem && <div role="alert" style={{ ...S.error, marginBottom: 8 }}>{problem}</div>}
      <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
        {data.posts.map((p: any) => (
          <div key={p.id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--line-soft)', background: p.kind === 'Decision' ? 'var(--success-bg)' : 'transparent' }}>
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ color: 'var(--ink)' }}>{p.author?.name}</strong>
              <span>{p.side === 'Client' ? 'organisation' : 'firm'}</span>
              <span style={pill(p.kind === 'Decision' ? 'var(--success)' : 'var(--ink-muted)', p.kind === 'Decision' ? 'var(--success-line)' : 'var(--line)')}>{KIND_LABEL[p.kind]}</span>
              <span>{when(p.createdAt)}</span>
              {p.mine && !p.retractedAt && data.can.post && <button style={{ ...small, marginLeft: 'auto', padding: '0 8px' }} onClick={() => setRetracting(p)}>Retract</button>}
            </div>
            <div style={{ fontSize: 12.5, marginTop: 4, whiteSpace: 'pre-wrap', textDecoration: p.retractedAt ? 'line-through' : 'none', color: p.retractedAt ? 'var(--ink-muted)' : 'var(--ink)' }}>{p.body}</div>
            {p.retractedAt && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>Retracted on {when(p.retractedAt)}: {p.retractReason}</div>}
            {p.mentions.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>Named: {p.mentions.map((m: any) => m.name).join(', ')}</div>}
          </div>
        ))}
      </div>
      {data.can.post && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <select aria-label="Kind" style={{ ...S.input, maxWidth: 170 }} value={kind} onChange={(e) => setKind(e.target.value)}>
              {['Comment', 'Question', 'ReviewNote', ...(data.can.decide ? ['Decision'] : [])].map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <textarea aria-label="Reply" style={{ ...S.input, minHeight: 60 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply" />
          </div>
          {data.mentionable.length > 0 && (
            <div style={{ fontSize: 11.5, marginTop: 6, display: 'flex', gap: '2px 12px', flexWrap: 'wrap', color: 'var(--ink-muted)' }}>
              Name:
              {data.mentionable.map((m: any) => (
                <label key={m.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="checkbox" checked={named.includes(m.id)} onChange={(e) => setNamed((x) => (e.target.checked ? [...x, m.id] : x.filter((y) => y !== m.id)))} />
                  {m.name} ({m.side === 'Client' ? 'organisation' : 'firm'})
                </label>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button style={primaryBtn(busy || !body.trim())} disabled={busy || !body.trim()}
              onClick={async () => { if (await act(() => apiClient.post(`${url}/posts`, { kind, body, mentions: named }))) { setBody(''); setNamed([]); setKind('Comment'); } }}>
              Post
            </button>
          </div>
        </div>
      )}
      {retracting && (
        <ReasonDialog
          title="Retract this post"
          message="The words stay in the thread, struck through, with your reason. Nothing is deleted."
          label="Why"
          minLength={4}
          confirmLabel="Retract"
          busy={busy}
          onConfirm={async (reason) => { await act(() => apiClient.post(`${url}/posts/${retracting.id}/retract`, { reason })); setRetracting(null); }}
          onCancel={() => setRetracting(null)}
        />
      )}
      {converting && (
        <ConvertThread projectId={projectId} thread={t} to={data.can.convertTo[0]} url={url}
          onCancel={() => setConverting(false)} onDone={async () => { setConverting(false); await load(); }} />
      )}
    </DialogShell>
  );
};

/**
 * Makes the task or request through the route that already makes it, then
 * links the thread to it.
 */
const ConvertThread: React.FC<{ projectId: string; thread: any; to: 'Task' | 'Request'; url: string; onCancel: () => void; onDone: () => void }> = ({
  projectId, thread, to, url, onCancel, onDone,
}) => {
  const [phases, setPhases] = useState<{ id: string; name: string }[]>([]);
  const [team, setTeam] = useState<{ id: string; name: string }[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState({ name: thread.title, phaseId: '', start: today, due: '', assigneeId: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (to === 'Task') apiClient.get(`/api/projects/${projectId}/plan`).then((r) => setPhases((r.data?.phases || []).map((p: any) => ({ id: p.id, name: p.name })))).catch(() => setPhases([]));
    apiClient.get(`/api/projects/${projectId}/members`)
      .then((r) => setTeam((r.data?.members || []).filter((m: any) => m.side === 'Client' && m.active).map((m: any) => ({ id: m.userId, name: m.userName }))))
      .catch(() => setTeam([]));
  }, [projectId, to]);
  const make = async () => {
    setBusy(true); setProblem('');
    try {
      const made = to === 'Task'
        ? (await apiClient.post(`/api/projects/phases/${v.phaseId}/tasks`, { name: v.name.trim(), startDate: v.start, dueDate: v.due, assigneeId: v.assigneeId || undefined })).data.task
        : (await apiClient.post(`/api/engagements/${projectId}/requests`, { kind: 'Clarification', title: v.name.trim(), targetType: 'Engagement', dueDate: v.due, assigneeId: v.assigneeId || undefined })).data.request;
      await apiClient.post(`${url}/convert`, { type: to, id: made.id });
      onDone();
    } catch (err) {
      setProblem(apiError(err, `The ${to.toLowerCase()} could not be made.`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell title={`Convert ${thread.ref} to a ${to.toLowerCase()}`} onClose={busy ? () => undefined : onCancel} width={540}>
      {problem && <div role="alert" style={{ ...S.error, marginBottom: 8 }}>{problem}</div>}
      <label style={label} htmlFor="cv-name">{to === 'Task' ? 'Task' : 'Request (a clarification)'}</label>
      <input id="cv-name" style={S.input} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      {to === 'Task' && (
        <>
          <label style={label} htmlFor="cv-phase">Phase</label>
          <select id="cv-phase" style={S.input} value={v.phaseId} onChange={(e) => setV({ ...v, phaseId: e.target.value })}>
            <option value="">Choose…</option>
            {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label style={label} htmlFor="cv-start">Start</label>
          <input id="cv-start" type="date" style={S.input} value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />
        </>
      )}
      <label style={label} htmlFor="cv-due">Due</label>
      <input id="cv-due" type="date" style={S.input} value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} />
      <label style={label} htmlFor="cv-who">{to === 'Task' ? 'Assignee' : 'Who answers'}</label>
      <select id="cv-who" style={S.input} value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })}>
        <option value="">{to === 'Task' ? 'Unassigned' : 'Choose…'}</option>
        {team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={primaryBtn(busy)} disabled={busy || !v.name.trim() || !v.due || (to === 'Task' && !v.phaseId)} onClick={make}>Make it and link</button>
      </div>
    </DialogShell>
  );
};

export default EngagementDiscussions;
