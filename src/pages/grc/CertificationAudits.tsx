import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import FormDialog from '../../components/FormDialog';
import { S, ghostBtn, pill, apiError } from '../iam/iamStyles';

/**
 * Certification audits (consulting engagement, sprint 13): the certification
 * body's own screen.
 *
 * The body sees the engagements it is invited to, accepts or declines, and,
 * inside the days the organisation set, reads the frozen audit pack and asks
 * questions, asks for evidence or raises a nonconformity. It changes nothing
 * in the organisation's records.
 */

const KIND: Record<string, string> = { Question: 'Question', EvidenceRequest: 'Evidence request', Nonconformity: 'Nonconformity' };
const small: React.CSSProperties = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };
// Access is granted in whole days, stored as UTC midnight: shown as that day wherever the reader is.
const dayOf = (iso: string) => String(iso).slice(0, 10);

const CertificationAudits: React.FC = () => {
  const [mine, setMine] = useState<any[] | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [view, setView] = useState<any>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setMine((await apiClient.get('/api/certification/mine')).data.access); } catch (err) { setError(apiError(err, 'Could not load your audits.')); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openPack = useCallback(async (a: any) => {
    setError(''); setOpen(a);
    try { setView((await apiClient.get(`/api/certification/${a.id}`)).data); } catch (err) { setView(null); setError(apiError(err, 'The audit pack is not open to you today.')); }
  }, []);

  const respond = async (a: any, decision: 'Accepted' | 'Declined') => {
    setBusy(true); setError('');
    try { await apiClient.post(`/api/certification/${a.id}/respond`, { decision }); await load(); } catch (err) { setError(apiError(err, 'That did not work.')); } finally { setBusy(false); }
  };

  const download = async (item: any) => {
    setError('');
    try {
      const res = await apiClient.get(`/api/certification/${open.id}/items/${item.id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = item.fileName; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setError(apiError(err, 'The report could not be read.')); }
  };

  return (
    <div style={S.page}>
      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>Certification Audits</h1>
      <p style={{ fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 0 }}>Engagements an organisation has invited you to audit. Read-only, for the days it set.</p>
      {error && <div style={S.error}>{error}</div>}
      {mine && mine.length === 0 && <div style={{ ...S.card, padding: 14, fontSize: 12.5, color: 'var(--ink-muted)' }}>No organisation has invited you yet.</div>}
      {mine?.map((a) => (
        <div key={a.id} style={{ ...S.card, padding: 12, marginBottom: 8, fontSize: 12.5 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{a.project?.tenant?.name}</strong><span>{a.project?.ref} · {a.project?.name}</span>
            <span style={pill(a.status === 'Accepted' ? 'var(--success)' : 'var(--info)', a.status === 'Accepted' ? 'var(--success-line)' : 'var(--line)')}>{a.status}</span>
            <span>{dayOf(a.accessFrom)} to {dayOf(a.accessTo)}</span>
            {a.status === 'Invited' && <><button style={small} disabled={busy} onClick={() => respond(a, 'Accepted')}>Accept</button><button style={small} disabled={busy} onClick={() => respond(a, 'Declined')}>Decline</button></>}
            {a.status === 'Accepted' && (a.open ? <button style={small} onClick={() => openPack(a)}>Open the audit pack</button> : <span style={{ color: 'var(--ink-muted)' }}>outside your days</span>)}
          </div>
        </div>
      ))}

      {open && view && (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>{view.project.ref} · {view.project.name}</strong>
            <button style={small} onClick={() => setAsking(true)}>Ask the organisation</button>
            <button style={small} onClick={() => { setOpen(null); setView(null); }}>Close</button>
          </div>
          {view.packs.length === 0 && <div style={{ ...S.card, padding: 12, fontSize: 12.5, color: 'var(--ink-muted)' }}>The organisation has not frozen an audit pack yet.</div>}
          {view.packs.map((p: any) => (
            <div key={p.id} style={{ ...S.card, padding: 12, marginBottom: 8, fontSize: 12.5 }}>
              <div><strong>{p.ref}</strong> · frozen {new Date(p.frozenAt).toLocaleString()}</div>
              {p.items.map((i: any) => (
                <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                  <span>{i.name}</span><span style={{ color: 'var(--ink-muted)' }}>{i.documentRef} · sha256 {String(i.sha256).slice(0, 16)}…</span>
                  <button style={small} onClick={() => download(i)}>Download</button>
                </div>
              ))}
            </div>
          ))}
          <strong style={{ display: 'block', fontSize: 13, margin: '14px 0 6px' }}>Your questions</strong>
          {view.questions.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>None yet.</div>}
          {view.questions.map((q: any) => (
            <div key={q.id} style={{ ...S.card, padding: 12, marginBottom: 8, fontSize: 12.5 }}>
              <div><strong>{q.ref}</strong> · {KIND[q.kind]}{q.clauseRef ? ` · ${q.clauseRef}` : ''} · {q.status}</div>
              <div style={{ marginTop: 4 }}>{q.text}</div>
              {q.answer && <div style={{ marginTop: 4, color: 'var(--ink-muted)' }}>Answer: {q.answer}</div>}
              {q.status === 'Recorded' && <div style={{ marginTop: 4, color: 'var(--ink-muted)' }}>Recorded by the organisation as an issue.</div>}
            </div>
          ))}
        </div>
      )}

      {asking && open && (
        <FormDialog title="Ask the organisation" intro="A question, a request for evidence, or a nonconformity against a clause." submitLabel="Send" busy={busy} error={error}
          fields={[
            { name: 'kind', label: 'What it is', type: 'select', options: ['Question', 'EvidenceRequest', 'Nonconformity'], optionLabels: KIND },
            { name: 'clauseRef', label: 'Clause (needed for a nonconformity)', type: 'text' },
            { name: 'text', label: 'Text', type: 'textarea', required: true },
          ]}
          validate={(v) => (v.text.trim().length < 10 ? 'At least 10 characters.' : v.kind === 'Nonconformity' && !v.clauseRef.trim() ? 'Name the clause.' : null)}
          onSubmit={async (v) => {
            setBusy(true); setError('');
            try { await apiClient.post(`/api/certification/${open.id}/questions`, { kind: v.kind, clauseRef: v.clauseRef.trim() || undefined, text: v.text.trim() }); setAsking(false); await openPack(open); } catch (err) { setError(apiError(err, 'That did not work.')); } finally { setBusy(false); }
          }}
          onCancel={() => setAsking(false)} />
      )}
    </div>
  );
};

export default CertificationAudits;
