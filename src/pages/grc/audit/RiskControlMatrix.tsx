import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, StatStrip, primaryBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * The Risk & Control Matrix — the working document of an engagement.
 *
 * Each row is a risk; under it sit the test procedures that address it, and
 * under those the recorded result. Results are immutable once recorded, so the
 * UI stops offering the action rather than letting the request fail.
 */

const RISK_PILL: Record<string, React.CSSProperties> = {
  High: pill('var(--danger)', 'var(--danger-line)'),
  Medium: pill('var(--warning)', 'var(--warning-line)'),
  Low: pill('var(--success)', 'var(--success-line)'),
};
const CONCLUSION_PILL: Record<string, React.CSSProperties> = {
  Satisfactory: pill('var(--success)', 'var(--success-line)'),
  SatisfactoryWithExceptions: pill('var(--warning)', 'var(--warning-line)'),
  Unsatisfactory: pill('var(--danger)', 'var(--danger-line)'),
};

const TEST_TYPES = ['DesignEffectiveness', 'OperatingEffectiveness', 'Both'];
const SAMPLING = ['Statistical', 'Judgmental', 'FullPopulation', 'Inquiry', 'Observation'];

const RiskControlMatrix: React.FC<{ auditId: string | null }> = ({ auditId }) => {
  const [matrix, setMatrix] = useState<any[]>([]);
  const [audit, setAudit] = useState<any>(null);
  const [totals, setTotals] = useState<any>({});
  const [impls, setImpls] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showRow, setShowRow] = useState(false);
  const [rowForm, setRowForm] = useState({
    title: '', description: '', riskRating: 'Medium',
    implementationId: '', controlType: 'Preventive', controlNature: 'Manual',
  });

  const load = useCallback(async () => {
    if (!auditId) { setMatrix([]); setAudit(null); return; }
    setLoading(true); setError('');
    try {
      const [m, i, iss] = await Promise.all([
        apiClient.get(`/api/grc/audits/${auditId}/matrix`),
        apiClient.get('/api/grc/implementations'),
        apiClient.get('/api/grc/issues'),
      ]);
      setMatrix(m.data?.matrix || []);
      setAudit(m.data?.audit || null);
      setTotals(m.data?.totals || {});
      setImpls(i.data?.implementations || []);
      setIssues((iss.data?.issues || []).filter((x: any) => x.audit?.id === auditId));
    } catch (err) { setError(apiError(err, 'Failed to load the matrix')); }
    finally { setLoading(false); }
  }, [auditId]);

  useEffect(() => { load(); }, [load]);

  const closed = audit?.status === 'Closed' || audit?.status === 'Cancelled';

  const addRow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post(`/api/grc/audits/${auditId}/matrix`, {
        ...rowForm,
        implementationId: rowForm.implementationId || undefined,
      });
      setShowRow(false);
      setRowForm({ title: '', description: '', riskRating: 'Medium', implementationId: '', controlType: 'Preventive', controlNature: 'Manual' });
      setNotice('Risk added to the matrix');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const addProcedure = async (row: any) => {
    const objective = window.prompt(`Test objective for ${row.ref} — ${row.title}:`);
    if (!objective) return;
    const procedure = window.prompt('Describe the procedure the tester will follow:');
    if (!procedure) return;
    const testType = window.prompt(`Test type — ${TEST_TYPES.join(' / ')}:`, 'OperatingEffectiveness');
    if (!testType) return;
    const samplingMethod = window.prompt(`Sampling — ${SAMPLING.join(' / ')}:`, 'Judgmental');
    if (!samplingMethod) return;
    const sampleSize = window.prompt('Sample size:', '25');
    try {
      await apiClient.post(`/api/grc/matrix/${row.id}/procedures`, {
        objective, procedure, testType, samplingMethod, sampleSize: Number(sampleSize) || 25,
      });
      setNotice(`Procedure added under ${row.ref}`);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  /**
   * Recording a result is a one-way door — the backend rejects a second one.
   * It also rejects a conclusion that contradicts the exception count, so the
   * prompts collect exceptions first and suggest the consistent conclusion.
   */
  const recordResult = async (proc: any) => {
    const itemsTested = window.prompt(`Items tested (planned sample ${proc.sampleSize}):`, String(proc.sampleSize ?? 25));
    if (!itemsTested) return;
    const exceptionsFound = window.prompt('Exceptions found:', '0');
    if (exceptionsFound === null) return;
    const ex = Number(exceptionsFound) || 0;
    const suggested = ex === 0 ? 'Satisfactory' : 'SatisfactoryWithExceptions';
    const conclusion = window.prompt(
      ex === 0
        ? 'Conclusion — Satisfactory (an Unsatisfactory conclusion needs at least one exception):'
        : `${ex} exception(s) recorded, so the conclusion must be SatisfactoryWithExceptions or Unsatisfactory:`,
      suggested,
    );
    if (!conclusion) return;
    const narrative = window.prompt('Narrative — this is the test evidence, at least 10 characters:');
    if (!narrative) return;
    try {
      const res = await apiClient.post(`/api/grc/procedures/${proc.id}/result`, {
        itemsTested: Number(itemsTested), exceptionsFound: ex, conclusion, narrative,
      });
      setNotice(res.data?.message || 'Result recorded');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const linkFinding = async (proc: any) => {
    if (issues.length === 0) {
      window.alert('No findings on this engagement yet. Raise one on the Issues tab first, then link it here.');
      return;
    }
    const choice = window.prompt(
      `Link the result to which finding?\n${issues.map((f, n) => `${n + 1}. ${f.ref} — ${f.title}`).join('\n')}`,
      '1',
    );
    if (!choice) return;
    const finding = issues[Number(choice) - 1];
    if (!finding) { window.alert('No finding at that position.'); return; }
    try {
      const res = await apiClient.post(`/api/grc/procedures/${proc.id}/link-finding`, { findingId: finding.id });
      setNotice(res.data?.message || 'Linked');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  if (!auditId) {
    return (
      <div style={{ ...S.card, padding: 28, color: 'var(--ink-muted)', fontSize: 13 }}>
        Pick an engagement on the <strong style={{ color: 'var(--ink)' }}>Engagements</strong> tab to work on its
        risk and control matrix.
      </div>
    );
  }
  if (loading) return <div style={{ padding: 30, color: 'var(--ink-muted)' }}>Loading…</div>;

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          {notice}
          <button onClick={() => setNotice('')} style={{ ...linkBtn('var(--success)'), marginLeft: 'auto' }}>dismiss</button>
        </div>
      )}

      <StatStrip items={[
        ['Risks in scope', totals.rows ?? 0],
        ['Without a control', <span style={{ color: (totals.withoutControl ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.withoutControl ?? 0}</span>],
        ['Procedures', `${totals.completed ?? 0} / ${totals.procedures ?? 0}`],
        ['Exceptions', <span style={{ color: (totals.exceptions ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.exceptions ?? 0}</span>],
        ['Unsatisfactory tests', <span style={{ color: (totals.unsatisfactory ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.unsatisfactory ?? 0}</span>],
      ]} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
          <strong style={{ color: 'var(--ink)' }}>{audit?.ref}</strong> — {audit?.title}
          {closed && <span style={{ marginLeft: 8, ...pill('var(--ink-muted)', 'var(--line)') }}>{audit.status} — read only</span>}
        </div>
        {!closed && (
          <button style={primaryBtn()} onClick={() => setShowRow(!showRow)}>
            {showRow ? 'Cancel' : '+ Add risk'}
          </button>
        )}
      </div>

      {showRow && (
        <form onSubmit={addRow} style={{ ...S.card, padding: 16, marginBottom: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Risk title</label>
            <input required value={rowForm.title} onChange={(e) => setRowForm({ ...rowForm, title: e.target.value })} style={S.input} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>What could go wrong, and what is the consequence?</label>
            <textarea required rows={2} value={rowForm.description} onChange={(e) => setRowForm({ ...rowForm, description: e.target.value })} style={{ ...S.input, resize: 'vertical' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Inherent rating</label>
            <select value={rowForm.riskRating} onChange={(e) => setRowForm({ ...rowForm, riskRating: e.target.value })} style={S.input}>
              {['High', 'Medium', 'Low'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Control tested</label>
            <select value={rowForm.implementationId} onChange={(e) => setRowForm({ ...rowForm, implementationId: e.target.value })} style={S.input}>
              <option value="">— none mapped (this is itself a finding) —</option>
              {impls.map((i) => (
                <option key={i.id} value={i.id}>{i.control?.code} — {i.control?.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Control type</label>
            <select value={rowForm.controlType} onChange={(e) => setRowForm({ ...rowForm, controlType: e.target.value })} style={S.input}>
              {['Preventive', 'Detective', 'Corrective'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Control nature</label>
            <select value={rowForm.controlNature} onChange={(e) => setRowForm({ ...rowForm, controlNature: e.target.value })} style={S.input}>
              {['Manual', 'Automated', 'ITDependent'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" style={primaryBtn()}>Add to matrix</button>
          </div>
        </form>
      )}

      {matrix.length === 0 && (
        <div style={{ ...S.card, padding: 26, color: 'var(--ink-muted)', fontSize: 13 }}>
          The matrix is empty. Add the risks in scope, then the procedures that test the controls over them.
        </div>
      )}

      {matrix.map((row) => (
        <div key={row.id} style={{ ...S.card, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 400px' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: 'var(--brand)', fontVariantNumeric: 'tabular-nums' }}>{row.ref}</span>
                <span style={{ fontWeight: 650, color: 'var(--ink)' }}>{row.title}</span>
                <span style={RISK_PILL[row.riskRating] || RISK_PILL.Medium}>{row.riskRating}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 5 }}>{row.description}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 5 }}>
                {row.implementation
                  ? <>Control: <strong style={{ color: 'var(--ink-body)' }}>{row.implementation.control?.code} — {row.implementation.control?.title}</strong>
                      {' · '}{row.controlType} · {row.controlNature}</>
                  : <span style={{ color: 'var(--warning)' }}>No control mapped to this risk</span>}
              </div>
            </div>
            {!closed && <button style={linkBtn('var(--info)')} onClick={() => addProcedure(row)}>+ procedure</button>}
          </div>

          {(row.procedures || []).length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
              {row.procedures.map((p: any) => (
                <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div style={{ flex: '1 1 420px' }}>
                      <div style={{ fontSize: 12.5 }}>
                        <span style={{ fontWeight: 700, color: 'var(--ink-muted)', fontVariantNumeric: 'tabular-nums' }}>{p.ref}</span>{' '}
                        <span style={{ color: 'var(--ink)' }}>{p.objective}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3 }}>
                        {p.testType} · {p.samplingMethod} · sample {p.sampleSize}
                        {p.assignedTo && <> · assigned to {p.assignedTo.name}</>}
                        {p._count?.workpapers > 0 && <> · {p._count.workpapers} workpaper(s)</>}
                      </div>
                      {p.result && (
                        <div style={{ marginTop: 6, padding: '8px 10px', background: 'var(--surface-sunk)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line-soft)' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={CONCLUSION_PILL[p.result.conclusion] || CONCLUSION_PILL.Satisfactory}>{p.result.conclusion}</span>
                            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                              {p.result.itemsTested} tested · {p.result.exceptionsFound} exception(s)
                              {p.result.testedBy && <> · by {p.result.testedBy.name}</>}
                              {p.result.findingId && <> · linked to a finding</>}
                            </span>
                          </div>
                          <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 5 }}>{p.result.narrative}</div>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {!p.result && !closed && (
                        <button style={linkBtn('var(--success)')} onClick={() => recordResult(p)}>record result</button>
                      )}
                      {p.result && !p.result.findingId && p.result.conclusion !== 'Satisfactory' && !closed && (
                        <button style={linkBtn('var(--warning)')} onClick={() => linkFinding(p)}>link finding</button>
                      )}
                      {p.result && <span style={{ fontSize: 11, color: 'var(--ink-faint)', alignSelf: 'center' }}>result is final</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default RiskControlMatrix;
