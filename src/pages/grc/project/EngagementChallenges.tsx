import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell, { ReasonDialog } from '../../../components/Dialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * Challenges and proposals (consulting engagement, sprint 11): the whole
 * in-scope register beside the firm's challenges to its scores. The firm
 * raises, withdraws and proposes; the owner of a risk or asset decides its
 * challenges, one at a time or many at once; the project manager accepts a
 * proposal into the register. Nothing here moves a figure until decided.
 */

const BAND: Record<string, [string, string, string]> = {
  WithinAppetite: ['Within appetite', 'var(--success)', 'var(--success-line)'],
  WithinTolerance: ['Within tolerance', 'var(--warning)', 'var(--warning-line)'],
  BeyondTolerance: ['Beyond tolerance', 'var(--danger)', 'var(--danger-line)'],
};
const label: React.CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', margin: '8px 0 3px' };
const small: React.CSSProperties = { ...ghostBtn, padding: '3px 10px', fontSize: 11.5 };
const RISK_KEYS = [['likelihood', 'Likelihood'], ['impact', 'Impact']] as const;
const ASSET_KEYS = [['confidentiality', 'Confidentiality'], ['integrity', 'Integrity'], ['availability', 'Availability']] as const;
const scoreText = (kind: string, s: any) => (!s ? '—' : kind === 'Risk' ? `L${s.likelihood} × I${s.impact} = ${s.likelihood * s.impact}` : `C${s.confidentiality} I${s.integrity} A${s.availability}`);

const EngagementChallenges: React.FC<{ projectId: string }> = ({ projectId }) => {
  const base = `/api/engagements/${projectId}`;
  const [kind, setKind] = useState<'Risk' | 'Asset'>('Risk');
  const [data, setData] = useState<any>(null);
  const [proposals, setProposals] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [raising, setRaising] = useState<any>(null);
  const [keeping, setKeeping] = useState<string[] | null>(null);
  const [adjusting, setAdjusting] = useState<any>(null);
  const [withdrawing, setWithdrawing] = useState<any>(null);
  const [proposing, setProposing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [rejecting, setRejecting] = useState<any>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [c, p] = await Promise.all([apiClient.get(`${base}/challenges`, { params: { kind } }), apiClient.get(`${base}/proposals`)]);
      setData(c.data); setProposals(p.data); setPicked([]);
    } catch (err) {
      setError(apiError(err, 'Could not load the challenges.'));
    }
  }, [base, kind]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>) => {
    setBusy(true); setError('');
    try { await fn(); await load(); return true; } catch (err) { setError(apiError(err, 'That did not work.')); return false; } finally { setBusy(false); }
  };
  const decide = (ids: string[], decision: string, extra: Record<string, unknown> = {}) => act(() => apiClient.post(`${base}/challenges/decide`, { ids, decision, ...extra }));

  const client = data?.side === 'Client';
  const decidable = (data?.rows || []).filter((r: any) => r.mine && r.open);
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select aria-label="Register" style={{ ...S.input, maxWidth: 160 }} value={kind} onChange={(e) => setKind(e.target.value as 'Risk' | 'Asset')}>
          <option value="Risk">Risks</option><option value="Asset">Assets</option>
        </select>
        {client && decidable.length > 0 && (
          <>
            <button style={small} disabled={busy || picked.length === 0} onClick={() => decide(picked, 'Adopt')}>Adopt selected</button>
            <button style={small} disabled={busy || picked.length === 0} onClick={() => setKeeping(picked)}>Keep selected</button>
          </>
        )}
        {!client && proposals?.can?.propose && <button style={small} onClick={() => setProposing(true)}>{kind === 'Risk' ? 'Propose a risk' : 'Propose an asset'}</button>}
        {!client && proposals?.can?.propose && kind === 'Risk' && <button style={small} onClick={() => setDrafting(true)}>Draft risk appetite</button>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-muted)' }}>
          Figures, tolerance and reports read the register's own scores until a challenge is decided.{kind === 'Risk' ? ' A risk is challenged on its inherent scores; its residual follows from its verified controls.' : ''}
        </span>
      </div>
      {error && <div style={S.error}>{error}</div>}
      {data && !data.shared && <div style={{ ...S.card, padding: 16, fontSize: 13, color: 'var(--ink-muted)' }}>The scope does not share the {kind === 'Risk' ? 'risk' : 'asset'} register.</div>}
      {data?.shared && (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={S.headRow}>
                {client && <th style={S.th} />}
                <th style={S.th}>{kind}</th><th style={S.th}>Owner</th><th style={S.th}>In the register</th><th style={S.th}>Challenged to</th><th style={S.th}>Why</th><th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r: any) => (
                <tr key={r.id} style={S.bodyRow}>
                  {client && (
                    <td style={S.td}>
                      {r.mine && r.open && <input type="checkbox" aria-label={`Choose ${r.ref}`} checked={picked.includes(r.open.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, r.open.id] : x.filter((y) => y !== r.open.id)))} />}
                    </td>
                  )}
                  <td style={S.td}><div style={{ fontSize: 12.5 }}>{r.ref} · {r.title}</div>{r.category && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.category}</div>}</td>
                  <td style={S.td}>{r.owner || '—'}</td>
                  <td style={S.td}>
                    <div style={{ fontSize: 12 }}>{scoreText(kind, r.scores)}</div>
                    {kind === 'Risk' && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>residual {r.residualScore}{r.band && <> · <span style={pill(BAND[r.band][1], BAND[r.band][2])}>{BAND[r.band][0]}</span></>}</div>}
                    {kind === 'Asset' && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>criticality {r.criticality} · {r.tier}</div>}
                  </td>
                  <td style={S.td}>
                    {r.open ? (
                      <>
                        <div style={{ fontSize: 12 }}><strong>{r.open.ref}</strong> {scoreText(kind, r.open.scoresProposed)}</div>
                        {kind === 'Risk' && r.open.wouldBe && (
                          <div style={{ fontSize: 11, color: r.open.wouldBe.band === 'BeyondTolerance' ? 'var(--danger)' : 'var(--ink-muted)' }}>
                            if adopted: residual {r.open.wouldBe.residualScore}{r.open.wouldBe.band ? ` · ${BAND[r.open.wouldBe.band][0]}` : ''}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.open.raisedBy?.name}</div>
                      </>
                    ) : <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>—</span>}
                    {r.decided?.length > 0 && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{r.decided.map((d: any) => `${d.ref} ${d.status.toLowerCase()}`).join(', ')}</div>}
                  </td>
                  <td style={{ ...S.td, fontSize: 12, maxWidth: 280 }}>{r.open ? <>{r.open.reason}{r.open.restingLabel && <div style={{ color: 'var(--ink-muted)' }}>Rests on {r.open.restingLabel}</div>}</> : ''}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {!client && data.can?.raise && !r.open && <button style={small} onClick={() => setRaising(r)}>Challenge</button>}
                    {!client && r.open && data.can?.raise && <button style={small} onClick={() => setWithdrawing(r.open)}>Withdraw</button>}
                    {client && r.mine && r.open && (
                      <>
                        <button style={small} disabled={busy} onClick={() => decide([r.open.id], 'Adopt')}>Adopt</button>{' '}
                        <button style={small} disabled={busy} onClick={() => setKeeping([r.open.id])}>Keep</button>{' '}
                        <button style={small} disabled={busy} onClick={() => setAdjusting(r)}>Adjust</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: 'var(--ink-muted)' }}>Nothing in the shared register.</div>}
        </div>
      )}

      {proposals && proposals.proposals.length > 0 && (
        <div style={{ ...S.card, padding: 14, marginTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Proposed risks and assets</div>
          {proposals.proposals.map((p: any) => (
            <div key={p.id} style={{ fontSize: 12.5, padding: '6px 0', borderTop: '1px solid var(--line-soft)' }}>
              <strong>{p.ref}</strong> · {p.kind} · {p.title} · <span style={{ color: 'var(--ink-muted)' }}>{p.proposedBy?.name}</span> · {p.status}
              <div style={{ color: 'var(--ink-muted)' }}>{p.reason}{p.decisionNote ? ` — ${p.decisionNote}` : ''}</div>
              {proposals.can?.decide && p.status === 'Proposed' && (
                <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                  <button style={small} disabled={busy} onClick={() => act(() => apiClient.post(`${base}/proposals/${p.id}/decide`, { decision: 'Accepted' }))}>Accept into the register</button>
                  <button style={small} disabled={busy} onClick={() => setRejecting(p)}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {raising && <ScoreDialog title={`Challenge ${raising.ref}`} kind={kind} initial={raising.scores} withReason projectId={projectId}
        onCancel={() => setRaising(null)} onSave={(v) => act(() => apiClient.post(`${base}/challenges`, { kind, targetId: raising.id, ...v })).then((ok) => ok && setRaising(null))} />}
      {adjusting && <ScoreDialog title={`Adjust ${adjusting.ref}`} kind={kind} initial={adjusting.open.scoresProposed} projectId={projectId}
        onCancel={() => setAdjusting(null)} onSave={(v) => decide([adjusting.open.id], 'Adjust', v).then((ok) => ok && setAdjusting(null))} />}
      {keeping && (
        <ReasonDialog title={`Keep the current scores (${keeping.length})`} message="The register's scores stand. The firm sees your reason." label="Why they stand" confirmLabel="Keep" busy={busy}
          onConfirm={async (reason) => { await decide(keeping, 'Keep', { reason }); setKeeping(null); }} onCancel={() => setKeeping(null)} />
      )}
      {withdrawing && (
        <ReasonDialog title={`Withdraw ${withdrawing.ref}`} message="It stays in the history as withdrawn." label="Why" confirmLabel="Withdraw" busy={busy}
          onConfirm={async (reason) => { await act(() => apiClient.post(`${base}/challenges/${withdrawing.id}/withdraw`, { reason })); setWithdrawing(null); }} onCancel={() => setWithdrawing(null)} />
      )}
      {rejecting && (
        <ReasonDialog title={`Reject ${rejecting.ref}`} message="The firm sees your reason. Nothing enters the register." label="Why" confirmLabel="Reject" busy={busy}
          onConfirm={async (note) => { await act(() => apiClient.post(`${base}/proposals/${rejecting.id}/decide`, { decision: 'Rejected', note })); setRejecting(null); }} onCancel={() => setRejecting(null)} />
      )}
      {proposing && <ProposeDialog base={base} kind={kind} categories={proposals?.categories || []} onCancel={() => setProposing(false)} onDone={() => { setProposing(false); load(); }} />}
      {drafting && <AppetiteDialog base={base} categories={proposals?.categories || []} onCancel={() => setDrafting(false)} onDone={() => { setDrafting(false); }} />}
    </div>
  );
};

/** Scores, and for a challenge why and what it rests on. */
const ScoreDialog: React.FC<{ title: string; kind: string; initial: any; withReason?: boolean; projectId: string; onCancel: () => void; onSave: (v: Record<string, unknown>) => void }> = ({
  title, kind, initial, withReason, onCancel, onSave,
}) => {
  const keys = kind === 'Risk' ? RISK_KEYS : ASSET_KEYS;
  const [v, setV] = useState<Record<string, any>>(() => ({ ...Object.fromEntries(keys.map(([k]) => [k, initial?.[k] ?? 3])), reason: '' }));
  return (
    <DialogShell title={title} onClose={onCancel} width={480}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${keys.length}, 1fr)`, gap: 8 }}>
        {keys.map(([k, l]) => (
          <label key={k} style={{ fontSize: 12 }}>{l}
            <select style={S.input} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
        ))}
      </div>
      {withReason && (
        <>
          <label style={label} htmlFor="ch-why">Why: what the scores rest on</label>
          <textarea id="ch-why" style={{ ...S.input, minHeight: 70 }} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel}>Cancel</button>
        <button style={primaryBtn(Boolean(withReason) && v.reason.trim().length < 10)} disabled={Boolean(withReason) && v.reason.trim().length < 10} onClick={() => onSave(withReason ? v : Object.fromEntries(keys.map(([k]) => [k, v[k]])))}>Save</button>
      </div>
    </DialogShell>
  );
};

const ProposeDialog: React.FC<{ base: string; kind: string; categories: string[]; onCancel: () => void; onDone: () => void }> = ({ base, kind, categories, onCancel, onDone }) => {
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [v, setV] = useState<Record<string, any>>({ tenantId: '', title: '', description: '', reason: '', category: categories[1] || 'Operational', type: 'Information', likelihood: 3, impact: 3, confidentiality: 3, integrity: 3, availability: 3 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  useEffect(() => {
    apiClient.get(`${base}/assessment`).then((r) => { setEntities(r.data.entities || []); setV((x) => ({ ...x, tenantId: r.data.entities?.[0]?.id || '' })); }).catch(() => setEntities([]));
  }, [base]);
  const keys = kind === 'Risk' ? RISK_KEYS : ASSET_KEYS;
  const save = async () => {
    setBusy(true); setProblem('');
    try { await apiClient.post(`${base}/proposals`, { kind, ...v }); onDone(); } catch (err) { setProblem(apiError(err, 'The proposal could not be made.')); } finally { setBusy(false); }
  };
  return (
    <DialogShell title={kind === 'Risk' ? 'Propose a risk' : 'Propose an asset'} onClose={busy ? () => undefined : onCancel} width={540}>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>It enters the register only if the organisation accepts it; until then no figure counts it.</div>
      {problem && <div role="alert" style={{ ...S.error, margin: '8px 0' }}>{problem}</div>}
      <label style={label} htmlFor="pr-entity">Organisation</label>
      <select id="pr-entity" style={S.input} value={v.tenantId} onChange={(e) => setV({ ...v, tenantId: e.target.value })}>{entities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <label style={label} htmlFor="pr-title">{kind === 'Risk' ? 'Risk' : 'Asset'}</label>
      <input id="pr-title" style={S.input} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      {kind === 'Risk' ? (
        <>
          <label style={label} htmlFor="pr-cat">Category</label>
          <select id="pr-cat" style={S.input} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        </>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${keys.length}, 1fr)`, gap: 8, marginTop: 8 }}>
        {keys.map(([k, l]) => (
          <label key={k} style={{ fontSize: 12 }}>{l}
            <select style={S.input} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
        ))}
      </div>
      <label style={label} htmlFor="pr-why">Why it belongs in the register</label>
      <textarea id="pr-why" style={{ ...S.input, minHeight: 60 }} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={primaryBtn(busy)} disabled={busy || !v.title.trim() || v.reason.trim().length < 10} onClick={save}>Propose</button>
      </div>
    </DialogShell>
  );
};

const AppetiteDialog: React.FC<{ base: string; categories: string[]; onCancel: () => void; onDone: () => void }> = ({ base, categories, onCancel, onDone }) => {
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [v, setV] = useState({ tenantId: '', category: categories[1] || 'Operational', statement: '', appetiteThreshold: 9, toleranceThreshold: 16 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    apiClient.get(`${base}/assessment`).then((r) => { setEntities(r.data.entities || []); setV((x) => ({ ...x, tenantId: r.data.entities?.[0]?.id || '' })); }).catch(() => setEntities([]));
  }, [base]);
  const save = async () => {
    setBusy(true); setProblem('');
    try { setDone((await apiClient.post(`${base}/appetite-drafts`, v)).data.message); } catch (err) { setProblem(apiError(err, 'The draft could not be saved.')); } finally { setBusy(false); }
  };
  return (
    <DialogShell title="Draft risk appetite" onClose={busy ? () => undefined : (done ? onDone : onCancel)} width={520}>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>The organisation approves it on its Risk Appetite screen. Whoever drafts a statement cannot approve it.</div>
      {problem && <div role="alert" style={{ ...S.error, margin: '8px 0' }}>{problem}</div>}
      {done ? <div style={{ fontSize: 12.5, color: 'var(--success)', margin: '10px 0' }}>{done}</div> : (
        <>
          <label style={label} htmlFor="ap-entity">Organisation</label>
          <select id="ap-entity" style={S.input} value={v.tenantId} onChange={(e) => setV({ ...v, tenantId: e.target.value })}>{entities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <label style={label} htmlFor="ap-cat">Category</label>
          <select id="ap-cat" style={S.input} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <label style={label} htmlFor="ap-st">Statement</label>
          <textarea id="ap-st" style={{ ...S.input, minHeight: 60 }} value={v.statement} onChange={(e) => setV({ ...v, statement: e.target.value })} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ fontSize: 12 }}>Appetite (1–25)<input type="number" min={1} max={25} style={S.input} value={v.appetiteThreshold} onChange={(e) => setV({ ...v, appetiteThreshold: Number(e.target.value) })} /></label>
            <label style={{ fontSize: 12 }}>Tolerance (1–25)<input type="number" min={1} max={25} style={S.input} value={v.toleranceThreshold} onChange={(e) => setV({ ...v, toleranceThreshold: Number(e.target.value) })} /></label>
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        {done ? <button style={primaryBtn(false)} onClick={onDone}>Close</button> : (
          <>
            <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
            <button style={primaryBtn(busy)} disabled={busy || v.statement.trim().length < 10} onClick={save}>Save draft</button>
          </>
        )}
      </div>
    </DialogShell>
  );
};

export default EngagementChallenges;
