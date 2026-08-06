import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';

const AUDIT_STATUS_PILL: Record<string, React.CSSProperties> = {
  Planned: pill('#94a3b8', '#334155'),
  Fieldwork: pill('#fbbf24', '#78350f'),
  Reporting: pill('#93c5fd', '#1e3a8a'),
  Closed: pill('#86efac', '#15803d'),
};
const FINDING_STATUS_PILL: Record<string, React.CSSProperties> = {
  Open: pill('#fbbf24', '#78350f'),
  Responded: pill('#7dd3fc', '#075985'),
  Disputed: pill('#f0abfc', '#701a75'),
  CAPAssigned: pill('#93c5fd', '#1e3a8a'),
  PendingClosure: pill('#c4b5fd', '#5b21b6'),
  Closed: pill('#86efac', '#15803d'),
  Reopened: pill('#fca5a5', '#7f1d1d'),
};
const RATING_COLOR: Record<string, string> = { High: '#f87171', Medium: '#fbbf24', Low: '#86efac' };

const AuditProgramme: React.FC = () => {
  const [audits, setAudits] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [detail, setDetail] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: '', objective: '', scope: '', criteria: '' });
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [showFinding, setShowFinding] = useState(false);
  const [finding, setFinding] = useState({ criterion: '', condition: '', cause: '', recommendation: '', riskRating: 'Medium' });

  const me = (() => { try { return JSON.parse(localStorage.getItem('grc_user_json') || 'null'); } catch { return null; } })();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/api/grc/audits');
      setAudits(res.data?.audits || []);
      setTotals(res.data?.totals || {});
      setScope(res.data?.scope || '');
    } catch (err) { setError(apiError(err, 'Failed to load the audit programme')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (id: string) => {
    try {
      const res = await apiClient.get(`/api/grc/audits/${id}`);
      setDetail(res.data?.audit || null);
    } catch (err) { window.alert(apiError(err)); }
  };

  const createAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      const res = await apiClient.post('/api/grc/audits', form);
      setShowNew(false);
      setForm({ title: '', objective: '', scope: '', criteria: '' });
      setNotice(`Audit ${res.data?.audit?.ref} created`);
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not create audit')); }
    finally { setBusy(false); }
  };

  const setAuditStatus = async (id: string, status: string) => {
    try {
      await apiClient.patch(`/api/grc/audits/${id}`, { status });
      setNotice(`Audit moved to ${status}`);
      await load();
      if (detail?.id === id) await openDetail(id);
    } catch (err) { window.alert(apiError(err)); }
  };

  const raiseFinding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/grc/audits/${detail.id}/findings`, finding);
      setShowFinding(false);
      setFinding({ criterion: '', condition: '', cause: '', recommendation: '', riskRating: 'Medium' });
      await openDetail(detail.id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
    finally { setBusy(false); }
  };

  const respond = async (f: any) => {
    if (f.raisedBy?.id === me?.id) {
      window.alert("SoD: the person who raised the finding cannot write management's response to it.");
      return;
    }
    const responseType = window.prompt('Management response — Agree, PartiallyAgree or Disagree:', 'Agree');
    if (!responseType) return;
    const responseNarrative = window.prompt('Management position (required):');
    if (!responseNarrative) return;
    let managementActionPlan = '';
    if (responseType !== 'Disagree') {
      managementActionPlan = window.prompt('What will management do about it? (required)', f.recommendation) || '';
      if (!managementActionPlan) return;
    }
    try {
      const res = await apiClient.post(`/api/grc/issues/${f.id}/respond`, { responseType, responseNarrative, managementActionPlan });
      setNotice(res.data?.message || 'Management response recorded');
      await openDetail(detail.id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const escalate = async (f: any) => {
    const reason = window.prompt('Reason for escalation:');
    if (!reason) return;
    try {
      const res = await apiClient.post(`/api/grc/issues/${f.id}/escalate`, { reason });
      setNotice(res.data?.message || 'Escalated');
      await openDetail(detail.id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const assignCap = async (f: any) => {
    const capDescription = window.prompt('Corrective action plan description:', f.recommendation);
    if (!capDescription) return;
    const capDueDate = window.prompt('CAP due date (YYYY-MM-DD):');
    if (!capDueDate) return;
    try {
      await apiClient.post(`/api/grc/issues/${f.id}/cap`, { capOwnerId: me?.id, capDueDate, capDescription });
      await openDetail(detail.id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const submitForClosure = async (f: any) => {
    const evidenceNote = window.prompt('What was remediated, and where is the evidence? (required)');
    if (!evidenceNote) return;
    try {
      await apiClient.post(`/api/grc/issues/${f.id}/submit-closure`, { evidenceNote });
      await openDetail(detail.id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const closeFinding = async (f: any) => {
    // Independence cuts both ways: whoever raised it and whoever remediated
    // it are both barred from validating the fix.
    if (f.raisedBy?.id === me?.id) { window.alert('SoD: the auditor who raised a finding cannot close it.'); return; }
    if (f.capOwner?.id === me?.id || f.respondedBy?.id === me?.id) {
      window.alert('SoD: you cannot validate remediation you owned or accepted. A third person must close it.');
      return;
    }
    const note = window.prompt('Closure note (validation evidence — required):');
    if (!note) return;
    try {
      const res = await apiClient.post(`/api/grc/issues/${f.id}/close`, { note });
      setNotice(res.data?.message || 'Finding closed');
      await openDetail(detail.id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const reopenFinding = async (f: any) => {
    const reason = window.prompt('Reason for reopening:');
    if (!reason) return;
    try {
      await apiClient.post(`/api/grc/issues/${f.id}/reopen`, { reason });
      await openDetail(detail.id);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const visible = statusFilter ? audits.filter((a) => a.status === statusFilter) : audits;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Internal audit &amp; assurance</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Plan audits, raise findings, manage corrective actions. Scope: <strong style={{ color: '#93c5fd' }}>{scope || '—'}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <button onClick={() => { setFormErr(''); setShowNew(true); }} style={primaryBtn()}>+ Create audit</button>
        </div>
      </div>

      <StatStrip items={[
        ['Audits', totals.audits ?? 0],
        ['In fieldwork', totals.inFieldwork ?? 0],
        ['Open findings', <span style={{ color: (totals.openFindings ?? 0) > 0 ? '#fbbf24' : '#f1f5f9' }}>{totals.openFindings ?? 0}</span>],
        ['High findings', <span style={{ color: (totals.highFindings ?? 0) > 0 ? '#f87171' : '#f1f5f9' }}>{totals.highFindings ?? 0}</span>],
        ['Closure rate', <span style={{ color: (totals.closureRate ?? 0) >= 70 ? '#86efac' : '#fbbf24' }}>{totals.closureRate ?? 0}%</span>],
      ]} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...S.input, maxWidth: 200 }}>
          <option value="">All statuses</option>
          {['Planned', 'Fieldwork', 'Reporting', 'Closed'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice} <button onClick={() => setNotice('')} style={linkBtn('#86efac')}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading audits…</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {visible.map((a) => (
            <div key={a.id} style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <button onClick={() => openDetail(a.id)} style={{ ...linkBtn('#e2e8f0'), fontSize: 14, padding: 0, textAlign: 'left' }}>
                    <strong>{a.ref}</strong> — {a.title}
                  </button>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    {a.tenant.name} · lead {a.leadAuditor.name} · {a.criteria}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, flexWrap: 'wrap' }}>
                    <span style={{ color: '#94a3b8' }}>{a.findingCounts.total} findings</span>
                    {a.findingCounts.open > 0 && <span style={{ color: '#fbbf24' }}>{a.findingCounts.open} open</span>}
                    {a.findingCounts.high > 0 && <span style={{ color: '#f87171' }}>{a.findingCounts.high} high</span>}
                    <span style={{ color: '#86efac' }}>{a.findingCounts.closed} closed</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <span style={AUDIT_STATUS_PILL[a.status] || AUDIT_STATUS_PILL.Planned}>{a.status}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {a.status === 'Planned' && <button onClick={() => setAuditStatus(a.id, 'Fieldwork')} style={linkBtn('#fbbf24')}>start fieldwork</button>}
                    {a.status === 'Fieldwork' && <button onClick={() => setAuditStatus(a.id, 'Reporting')} style={linkBtn('#93c5fd')}>to reporting</button>}
                    {a.status === 'Reporting' && <button onClick={() => setAuditStatus(a.id, 'Closed')} style={linkBtn('#86efac')}>close audit</button>}
                    <button onClick={() => openDetail(a.id)} style={linkBtn('#94a3b8')}>open</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <div style={{ ...S.card, padding: 40, textAlign: 'center', color: '#64748b', borderStyle: 'dashed' }}>
              No audits yet. Create one to begin.
            </div>
          )}
        </div>
      )}

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 520, padding: 26, borderRadius: 12, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 17, color: '#f1f5f9' }}>Create audit</h3>
            {formErr && <div style={{ ...S.error, marginBottom: 14 }}>{formErr}</div>}
            <form onSubmit={createAudit}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Title</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Objective</label>
              <textarea required rows={2} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} style={{ ...S.input, marginBottom: 12, resize: 'vertical' }} />
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Scope</label>
              <textarea required rows={2} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} style={{ ...S.input, marginBottom: 12, resize: 'vertical' }} />
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: '#94a3b8' }}>Criteria (frameworks / clauses)</label>
              <input required value={form.criteria} onChange={(e) => setForm({ ...form, criteria: e.target.value })} placeholder="ISO 27001 A.5.15, NCA ECC 2-2-1" style={{ ...S.input, marginBottom: 20 }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>{busy ? 'Creating…' : 'Create audit'}</button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 760, padding: 26, borderRadius: 12, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: '#f1f5f9' }}>{detail.ref} — {detail.title}</h3>
              <button onClick={() => setDetail(null)} style={linkBtn('#94a3b8')}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>
              lead {detail.leadAuditor.name} · {detail.criteria}
              <span style={{ marginLeft: 8 }}><span style={AUDIT_STATUS_PILL[detail.status]}>{detail.status}</span></span>
            </div>
            <div style={{ background: '#0b1220', border: '1px solid #16202f', borderRadius: 6, padding: 12, marginBottom: 14, fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
              <div style={{ fontSize: 10, color: '#475569', marginBottom: 3 }}>OBJECTIVE</div>{detail.objective}
              <div style={{ fontSize: 10, color: '#475569', margin: '8px 0 3px' }}>SCOPE</div>{detail.scope}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: '#f1f5f9' }}>Findings ({detail.issues.length})</span>
              {detail.status !== 'Closed' && <button onClick={() => setShowFinding(true)} style={primaryBtn()}>+ Raise finding</button>}
            </div>

            {detail.issues.map((f: any) => (
              <div key={f.id} style={{ background: '#0b1220', border: '1px solid #16202f', borderRadius: 6, padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#e2e8f0' }}>
                    <strong>{f.ref}</strong> <span style={{ color: RATING_COLOR[f.riskRating] }}>· {f.riskRating}</span>
                  </span>
                  <span style={FINDING_STATUS_PILL[f.status] || FINDING_STATUS_PILL.Open}>{f.status}{f.reopenedCount > 0 ? ` ×${f.reopenedCount}` : ''}</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.7 }}>
                  <div><span style={{ color: '#475569' }}>Criterion:</span> {f.criterion}</div>
                  <div><span style={{ color: '#475569' }}>Condition:</span> {f.condition}</div>
                  <div><span style={{ color: '#475569' }}>Cause:</span> {f.cause}</div>
                  <div><span style={{ color: '#475569' }}>Recommendation:</span> {f.recommendation}</div>
                  {f.responseType && (
                    <div style={{ color: f.responseType === 'Disagree' ? '#f0abfc' : '#7dd3fc' }}>
                      Management {f.responseType}{f.respondedBy ? ` (${f.respondedBy.name})` : ''}: {f.responseNarrative}
                      {f.managementActionPlan && <div style={{ color: '#64748b' }}>Action plan: {f.managementActionPlan}</div>}
                    </div>
                  )}
                  {f.escalationLevel > 0 && (
                    <div style={{ color: '#fca5a5' }}>Escalated to {f.escalationLevel === 1 ? 'executive management' : 'the audit committee'}</div>
                  )}
                  {f.capOwner && <div style={{ color: '#93c5fd' }}>CAP: {f.capOwner.name}{f.capDueDate ? ` · due ${f.capDueDate.slice(0, 10)}` : ''}</div>}
                  {f.closedBy && <div style={{ color: '#86efac' }}>Closed by {f.closedBy.name} — {f.closureNote}</div>}
                  <div style={{ color: '#475569', fontSize: 10 }}>raised by {f.raisedBy.name}</div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(f.status === 'Open' || f.status === 'Reopened') && <button onClick={() => respond(f)} style={linkBtn('#7dd3fc')}>record management response</button>}
                  {f.status === 'Responded' && <button onClick={() => assignCap(f)} style={linkBtn('#93c5fd')}>assign CAP</button>}
                  {f.status === 'Disputed' && <button onClick={() => escalate(f)} style={linkBtn('#f0abfc')}>escalate</button>}
                  {f.status === 'CAPAssigned' && <button onClick={() => submitForClosure(f)} style={linkBtn('#c4b5fd')}>submit for closure</button>}
                  {f.status === 'PendingClosure' && <button onClick={() => closeFinding(f)} style={linkBtn('#86efac')}>validate &amp; close</button>}
                  {f.status === 'Closed' && <button onClick={() => reopenFinding(f)} style={linkBtn('#fca5a5')}>reopen</button>}
                </div>
              </div>
            ))}
            {detail.issues.length === 0 && <div style={{ color: '#475569', fontSize: 12 }}>No findings raised.</div>}

            {showFinding && (
              <div style={{ marginTop: 14, border: '1px solid #1e293b', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>New finding — all four fields required (TRD §7.2)</div>
                <form onSubmit={raiseFinding}>
                  {(['criterion', 'condition', 'cause', 'recommendation'] as const).map((k) => (
                    <div key={k} style={{ marginBottom: 8 }}>
                      <label style={{ display: 'block', fontSize: 11, marginBottom: 3, color: '#64748b', textTransform: 'capitalize' }}>{k}</label>
                      <input required value={(finding as any)[k]} onChange={(e) => setFinding({ ...finding, [k]: e.target.value })} style={S.input} />
                    </div>
                  ))}
                  <label style={{ display: 'block', fontSize: 11, marginBottom: 3, color: '#64748b' }}>Risk rating</label>
                  <select value={finding.riskRating} onChange={(e) => setFinding({ ...finding, riskRating: e.target.value })} style={{ ...S.input, marginBottom: 12 }}>
                    {['High', 'Medium', 'Low'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1 }}>{busy ? 'Raising…' : 'Raise finding'}</button>
                    <button type="button" onClick={() => setShowFinding(false)} style={ghostBtn}>Cancel</button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditProgramme;
