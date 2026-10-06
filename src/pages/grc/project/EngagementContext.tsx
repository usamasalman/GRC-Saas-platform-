import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell, { ReasonDialog } from '../../../components/Dialog';
import { S, ghostBtn, primaryBtn, pill, StatStrip, apiError } from '../../iam/iamStyles';

/**
 * Context of the organisation and interested parties (ISO 27001 4.1 and
 * 4.2; consulting engagement, sprint 10). The register is the
 * organisation's: it records entries directly, the firm proposes them, and a
 * proposal counts for nothing until the project manager accepts it. The firm
 * sees only its own proposals and what became of them.
 */

const KIND_LABEL: Record<string, string> = { Issue: 'Issue (4.1)', InterestedParty: 'Interested party (4.2)' };
const STATUS_TONE: Record<string, [string, string]> = {
  Accepted: ['var(--success)', 'var(--success-line)'], Proposed: ['var(--info)', 'var(--line)'],
  Rejected: ['var(--danger)', 'var(--danger-line)'], Retired: ['var(--ink-muted)', 'var(--line)'],
};
const label: React.CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', margin: '8px 0 3px' };
const small: React.CSSProperties = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };

const EngagementContext: React.FC<{ projectId: string }> = ({ projectId }) => {
  const base = `/api/engagements/${projectId}/context`;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { setData((await apiClient.get(base)).data); } catch (err) { setError(apiError(err, 'Could not load the context register.')); }
  }, [base]);
  useEffect(() => { load(); }, [load]);

  const decide = async (entry: any, decision: string, note = '') => {
    setBusy(true); setError('');
    try { await apiClient.post(`${base}/${entry.id}/decide`, { decision, note }); await load(); } catch (err) { setError(apiError(err, 'That could not be decided.')); } finally { setBusy(false); }
  };

  const client = data?.side === 'Client';
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        {data?.can?.add && <button style={primaryBtn(false)} onClick={() => setAdding(true)}>{client ? 'Record an entry' : 'Propose an entry'}</button>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-muted)' }}>
          {client ? 'Only accepted entries count.' : 'You see your proposals on this engagement. Only accepted ones count.'}
        </span>
      </div>
      {error && <div style={S.error}>{error}</div>}
      {data?.counts && (
        <StatStrip items={[['Issues (4.1)', data.counts.issues], ['Interested parties (4.2)', data.counts.interestedParties], ['Proposed, not counted', data.counts.proposed]]} />
      )}
      {data && (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={S.headRow}><th style={S.th}>Entry</th><th style={S.th}>Kind</th><th style={S.th}>Where from</th><th style={S.th}>Relevance</th><th style={S.th}>Status</th><th style={S.th} /></tr>
            </thead>
            <tbody>
              {data.entries.map((x: any) => (
                <tr key={x.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <div style={{ fontSize: 12.5 }}>{x.ref} · {x.title}</div>
                    {x.requirements && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Requires: {x.requirements}</div>}
                    {x.risks?.length > 0 && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Bears on {x.risks.map((r: any) => r.ref).join(', ')}</div>}
                    {x.decisionNote && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{x.status}: {x.decisionNote}</div>}
                  </td>
                  <td style={S.td}>{KIND_LABEL[x.kind]} · {x.origin}</td>
                  <td style={S.td}>{x.source}</td>
                  <td style={S.td}>{x.relevance}</td>
                  <td style={S.td}><span style={pill(...(STATUS_TONE[x.status] || STATUS_TONE.Retired))}>{x.status}</span><div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{x.createdBy?.name}</div></td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {data.can?.decide && x.status === 'Proposed' && x.projectId === projectId && (
                      <>
                        <button style={small} disabled={busy} onClick={() => decide(x, 'Accepted')}>Accept</button>{' '}
                        <button style={small} disabled={busy} onClick={() => setRejecting(x)}>Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.entries.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: 'var(--ink-muted)' }}>Nothing recorded yet.</div>}
        </div>
      )}
      {adding && data && <AddEntry base={base} entities={data.entities} propose={!client} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
      {rejecting && (
        <ReasonDialog
          title={`Reject ${rejecting.ref}`}
          message="The firm sees that it was rejected, with your reason. It stays in the register and counts for nothing."
          label="Why"
          confirmLabel="Reject"
          busy={busy}
          onConfirm={async (reason) => { await decide(rejecting, 'Rejected', reason); setRejecting(null); }}
          onCancel={() => setRejecting(null)}
        />
      )}
    </div>
  );
};

const AddEntry: React.FC<{ base: string; entities: { id: string; name: string }[]; propose: boolean; onCancel: () => void; onDone: () => void }> = ({ base, entities, propose, onCancel, onDone }) => {
  const [v, setV] = useState({ tenantId: entities[0]?.id || '', kind: 'Issue', origin: 'External', title: '', description: '', source: '', relevance: 'Medium', requirements: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setProblem('');
    try { await apiClient.post(base, { ...v, requirements: v.kind === 'InterestedParty' ? v.requirements : undefined }); onDone(); } catch (err) { setProblem(apiError(err, 'The entry could not be recorded.')); } finally { setBusy(false); }
  };
  return (
    <DialogShell title={propose ? 'Propose an entry' : 'Record an entry'} onClose={busy ? () => undefined : onCancel} width={560}>
      {propose && <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>A proposal counts for nothing until the organisation accepts it.</div>}
      {problem && <div role="alert" style={{ ...S.error, margin: '8px 0' }}>{problem}</div>}
      <label style={label} htmlFor="cx-entity">Organisation</label>
      <select id="cx-entity" style={S.input} value={v.tenantId} onChange={set('tenantId')}>{entities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <label style={label} htmlFor="cx-kind">Kind</label>
      <select id="cx-kind" style={S.input} value={v.kind} onChange={set('kind')}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <label style={label} htmlFor="cx-origin">Internal or external</label>
      <select id="cx-origin" style={S.input} value={v.origin} onChange={set('origin')}><option>External</option><option>Internal</option></select>
      <label style={label} htmlFor="cx-title">Title</label>
      <input id="cx-title" style={S.input} value={v.title} onChange={set('title')} />
      <label style={label} htmlFor="cx-desc">Description (optional)</label>
      <textarea id="cx-desc" style={{ ...S.input, minHeight: 50 }} value={v.description} onChange={set('description')} />
      <label style={label} htmlFor="cx-source">Where it comes from</label>
      <input id="cx-source" style={S.input} value={v.source} onChange={set('source')} placeholder="A workshop, a regulator, a contract" />
      <label style={label} htmlFor="cx-rel">Relevance</label>
      <select id="cx-rel" style={S.input} value={v.relevance} onChange={set('relevance')}><option>High</option><option>Medium</option><option>Low</option></select>
      {v.kind === 'InterestedParty' && (
        <>
          <label style={label} htmlFor="cx-req">What they require</label>
          <textarea id="cx-req" style={{ ...S.input, minHeight: 50 }} value={v.requirements} onChange={set('requirements')} />
        </>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={primaryBtn(busy)} disabled={busy || !v.title.trim() || !v.source.trim()} onClick={save}>{propose ? 'Propose' : 'Record'}</button>
      </div>
    </DialogShell>
  );
};

export default EngagementContext;
