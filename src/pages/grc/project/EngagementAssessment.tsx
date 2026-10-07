import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import DialogShell from '../../../components/Dialog';
import { S, ghostBtn, primaryBtn, pill, StatStrip, apiError } from '../../iam/iamStyles';

/**
 * Gap assessment (consulting engagement, sprint 10): every clause of a
 * framework the scope names, for one entity it names, with its current
 * result and the reason. A Partial or Missing clause raises a gap in the
 * organisation's issue register, which it answers and closes there. The
 * Statement of Applicability is issued from the Reports tab, read off these.
 */

const RESULTS: [string, string][] = [['Conformant', 'Conformant'], ['Partial', 'Partial'], ['Missing', 'Missing'], ['NotApplicable', 'Not applicable']];
const GAP_TYPES = ['Documentation', 'Implementation', 'Evidence', 'Competence'];
const TONE: Record<string, [string, string]> = {
  Conformant: ['var(--success)', 'var(--success-line)'], Partial: ['var(--warning)', 'var(--warning-line)'],
  Missing: ['var(--danger)', 'var(--danger-line)'], NotApplicable: ['var(--ink-muted)', 'var(--line)'],
};
const label: React.CSSProperties = { display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', margin: '8px 0 3px' };

const EngagementAssessment: React.FC<{ projectId: string }> = ({ projectId }) => {
  const base = `/api/engagements/${projectId}/assessment`;
  const [data, setData] = useState<any>(null);
  const [tenantId, setTenantId] = useState('');
  const [standardId, setStandardId] = useState('');
  const [error, setError] = useState('');
  const [assessing, setAssessing] = useState<any>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiClient.get(base, { params: { tenantId: tenantId || undefined, standardId: standardId || undefined } });
      setData(res.data);
      if (!tenantId && res.data.tenantId) setTenantId(res.data.tenantId);
      if (!standardId && res.data.standardId) setStandardId(res.data.standardId);
    } catch (err) {
      setError(apiError(err, 'Could not load the assessment.'));
    }
  }, [base, tenantId, standardId]);
  useEffect(() => { load(); }, [load]);

  const rows = (data?.clauses || []).filter((c: any) => !filter || (filter === 'NotAssessed' ? !c.result : c.result === filter));
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select aria-label="Entity" style={{ ...S.input, maxWidth: 240 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          {(data?.entities || []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select aria-label="Framework" style={{ ...S.input, maxWidth: 240 }} value={standardId} onChange={(e) => setStandardId(e.target.value)}>
          {(data?.frameworks || []).map((x: any) => <option key={x.id} value={x.id}>{x.code}</option>)}
        </select>
        <select aria-label="Result" style={{ ...S.input, maxWidth: 200 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Every clause</option>
          {RESULTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="NotAssessed">Not assessed</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-muted)' }}>Issue the Statement of Applicability from the Reports tab.</span>
      </div>
      {error && <div style={S.error}>{error}</div>}
      {data && data.entities?.length === 0 && (
        <div style={{ ...S.card, padding: 16, fontSize: 13, color: 'var(--ink-muted)' }}>The binding scope names no entity and framework to assess.</div>
      )}
      {data?.summary && data.clauses?.length > 0 && (
        <StatStrip items={[
          ['Conformant', data.summary.Conformant], ['Partial', data.summary.Partial], ['Missing', data.summary.Missing],
          ['Not applicable', data.summary.NotApplicable], ['Not assessed', data.summary.NotAssessed],
        ]} />
      )}
      {data?.clauses?.length > 0 && (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={S.headRow}><th style={S.th}>Clause</th><th style={S.th}>Result</th><th style={S.th}>Why</th><th style={S.th}>Gap</th><th style={S.th} /></tr>
            </thead>
            <tbody>
              {rows.map((c: any) => (
                <tr key={c.id} style={S.bodyRow}>
                  <td style={S.td}><div style={{ fontSize: 12.5 }}>{c.ref}</div><div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{c.title}</div></td>
                  <td style={S.td}>
                    {c.result ? <span style={pill(...(TONE[c.result] || TONE.NotApplicable))}>{c.resultLabel}</span> : <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>Not assessed</span>}
                    {c.assessedBy && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{c.assessedBy} ({c.assessedSide === 'Client' ? 'organisation' : 'firm'}){c.times > 1 ? ` · assessed ${c.times} times` : ''}</div>}
                  </td>
                  <td style={{ ...S.td, fontSize: 12, maxWidth: 360 }}>{c.justification || '—'}{c.gapType && <div style={{ color: 'var(--ink-muted)' }}>Missing: {c.gapType.toLowerCase()}</div>}</td>
                  <td style={S.td}>
                    {c.gap ? `${c.gap.ref} · ${c.gap.status}` : '—'}
                    {c.carried && <span style={{ color: 'var(--brand)' }}> · Carried over</span>}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right' }}>{data.can?.assess && <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} onClick={() => setAssessing(c)}>Assess</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {assessing && (
        <AssessDialog base={base} tenantId={tenantId} clause={assessing} onCancel={() => setAssessing(null)} onDone={() => { setAssessing(null); load(); }} />
      )}
    </div>
  );
};

const AssessDialog: React.FC<{ base: string; tenantId: string; clause: any; onCancel: () => void; onDone: () => void }> = ({ base, tenantId, clause, onCancel, onDone }) => {
  const [result, setResult] = useState(clause.result || 'Conformant');
  const [justification, setJustification] = useState('');
  const [gapType, setGapType] = useState(clause.gapType || 'Implementation');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const gap = result === 'Partial' || result === 'Missing';
  const save = async () => {
    setBusy(true); setProblem('');
    try {
      await apiClient.post(base, { tenantId, clauseId: clause.id, result, justification, gapType: gap ? gapType : undefined });
      onDone();
    } catch (err) {
      setProblem(apiError(err, 'The assessment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogShell title={`Assess ${clause.ref}`} onClose={busy ? () => undefined : onCancel} width={560}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>{clause.title}</div>
      {problem && <div role="alert" style={{ ...S.error, margin: '8px 0' }}>{problem}</div>}
      <label style={label} htmlFor="as-result">Result</label>
      <select id="as-result" style={S.input} value={result} onChange={(e) => setResult(e.target.value)}>
        {RESULTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {gap && (
        <>
          <label style={label} htmlFor="as-gap">What is missing</label>
          <select id="as-gap" style={S.input} value={gapType} onChange={(e) => setGapType(e.target.value)}>
            {GAP_TYPES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 4 }}>
            {clause.gap && clause.gap.status !== 'Closed' ? `The open gap ${clause.gap.ref} carries on.` : 'A gap is raised in the organisation\'s issue register.'}
          </div>
        </>
      )}
      <label style={label} htmlFor="as-why">{result === 'NotApplicable' ? 'Why it does not apply (printed on the Statement of Applicability)' : 'Why'}</label>
      <textarea id="as-why" style={{ ...S.input, minHeight: 80 }} value={justification} onChange={(e) => setJustification(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={primaryBtn(busy || justification.trim().length < 10)} disabled={busy || justification.trim().length < 10} onClick={save}>Record assessment</button>
      </div>
    </DialogShell>
  );
};

export default EngagementAssessment;
