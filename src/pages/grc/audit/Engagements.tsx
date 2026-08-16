import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * Engagements — the list of audits and their findings.
 *
 * The sanctioned way an engagement comes into existence is instantiation from
 * an approved plan item, so those sit at the top of this screen. A special
 * engagement outside the plan is still possible — a board request or a fraud
 * investigation is not in last year's plan — but it must carry a written
 * reason, and it is badged as unplanned wherever it appears.
 */

const AUDIT_STATUS_PILL: Record<string, React.CSSProperties> = {
  Planned: pill('var(--ink-muted)', 'var(--line)'),
  Fieldwork: pill('var(--warning)', 'var(--warning-line)'),
  Reporting: pill('var(--info)', 'var(--info-line)'),
  Closed: pill('var(--success)', 'var(--success-line)'),
  Cancelled: pill('var(--ink-faint)', 'var(--line)'),
};
const FINDING_STATUS_PILL: Record<string, React.CSSProperties> = {
  Open: pill('var(--warning)', 'var(--warning-line)'),
  Responded: pill('var(--info)', 'var(--info-line)'),
  Disputed: pill('var(--danger)', 'var(--danger-line)'),
  CAPAssigned: pill('var(--info)', 'var(--info-line)'),
  PendingClosure: pill('var(--info)', 'var(--info-line)'),
  Closed: pill('var(--success)', 'var(--success-line)'),
  Reopened: pill('var(--danger)', 'var(--danger-line)'),
};
const RATING_COLOR: Record<string, string> = { High: 'var(--danger)', Medium: 'var(--warning)', Low: 'var(--success)' };

const CONCLUSIONS = ['Adequate', 'NeedsImprovement', 'Inadequate'];

type Props = {
  selectedId: string | null;
  onSelect: (id: string, ref: string) => void;
};

const Engagements: React.FC<Props> = ({ selectedId, onSelect }) => {
  const [audits, setAudits] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [detail, setDetail] = useState<any>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: '', objective: '', scope: '', criteria: '', unplannedReason: '' });
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  const [showFinding, setShowFinding] = useState(false);
  const [finding, setFinding] = useState({ criterion: '', condition: '', cause: '', recommendation: '', riskRating: 'Medium' });

  const me = (() => { try { return JSON.parse(localStorage.getItem('grc_user_json') || 'null'); } catch { return null; } })();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [a, p] = await Promise.all([
        apiClient.get('/api/grc/audits'),
        apiClient.get('/api/grc/plans'),
      ]);
      setAudits(a.data?.audits || []);
      setTotals(a.data?.totals || {});
      // Plan items on an approved plan that have not yet become engagements.
      setPending(
        (p.data?.plans || [])
          .filter((pl: any) => ['Approved', 'Active'].includes(pl.status))
          .flatMap((pl: any) => (pl.items || [])
            .filter((it: any) => it.status === 'Planned')
            .map((it: any) => ({ ...it, planYear: pl.year }))),
      );
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

  const startFromPlan = async (item: any) => {
    try {
      const res = await apiClient.post(`/api/grc/plan-items/${item.id}/instantiate`, {});
      setNotice(res.data?.message || 'Engagement created');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const createAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      const res = await apiClient.post('/api/grc/audits', form);
      setShowNew(false);
      setForm({ title: '', objective: '', scope: '', criteria: '', unplannedReason: '' });
      setNotice(`${res.data?.audit?.ref} created as a special engagement outside the annual plan`);
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not create engagement')); }
    finally { setBusy(false); }
  };

  // IIA Std 15.1 — an engagement cannot be reported without an overall
  // judgement, so this has to be reachable before "to reporting".
  const recordConclusion = async (a: any) => {
    const conclusion = window.prompt(
      `Overall conclusion for ${a.ref} — ${CONCLUSIONS.join(', ')}:`,
      a.conclusion || 'Adequate',
    );
    if (!conclusion) return;
    if (!CONCLUSIONS.includes(conclusion)) {
      window.alert(`Conclusion must be one of: ${CONCLUSIONS.join(', ')}`);
      return;
    }
    const conclusionNarrative = window.prompt('What is that conclusion based on? (required)', a.conclusionNarrative || '');
    if (!conclusionNarrative) return;
    try {
      await apiClient.patch(`/api/grc/audits/${a.id}`, { conclusion, conclusionNarrative });
      setNotice(`Conclusion recorded on ${a.ref}: ${conclusion}`);
      await load();
      if (detail?.id === a.id) await openDetail(a.id);
    } catch (err) { window.alert(apiError(err)); }
  };

  /**
   * Downloads a report. axios must be told to expect binary, otherwise the
   * response is decoded as text and the file arrives corrupt.
   */
  const download = async (url: string, fallbackName: string) => {
    try {
      const res = await apiClient.get(url, { responseType: 'blob' });
      const disposition = String(res.headers?.['content-disposition'] || '');
      const named = (disposition.match(/filename="(.+?)"/) || [])[1];
      const href = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = named || fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (err: any) {
      // An error body arrives as a Blob too, so it has to be read back out.
      if (err?.response?.data instanceof Blob) {
        const text = await err.response.data.text();
        try { window.alert(JSON.parse(text).message || text); }
        catch { window.alert(text.slice(0, 200)); }
        return;
      }
      window.alert(apiError(err));
    }
  };

  const exportAudit = async (a: any, kind: 'rcm' | 'report') => {
    const format = window.prompt('Format — xlsx, pdf or docx:', 'xlsx');
    if (!format) return;
    if (!['xlsx', 'pdf', 'docx'].includes(format)) {
      window.alert('Format must be xlsx, pdf or docx.');
      return;
    }
    await download(
      `/api/grc/audits/${a.id}/export/${kind}?format=${format}`,
      `${a.ref}_${kind}.${format}`,
    );
  };

  const setAuditStatus = async (id: string, status: string) => {
    const body: any = { status };
    if (status === 'Cancelled') {
      const cancellationReason = window.prompt('Why is this engagement being abandoned? (required)');
      if (!cancellationReason) return;
      body.cancellationReason = cancellationReason;
    }
    try {
      await apiClient.patch(`/api/grc/audits/${id}`, body);
      setNotice(`Engagement moved to ${status}`);
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
    <div>
      <StatStrip items={[
        ['Engagements', totals.audits ?? 0],
        ['In fieldwork', totals.inFieldwork ?? 0],
        ['Open findings', <span style={{ color: (totals.openFindings ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.openFindings ?? 0}</span>],
        ['High findings', <span style={{ color: (totals.highFindings ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.highFindings ?? 0}</span>],
        ['Closure rate', <span style={{ color: (totals.closureRate ?? 0) >= 70 ? 'var(--success)' : 'var(--warning)' }}>{totals.closureRate ?? 0}%</span>],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          {notice}
          <button onClick={() => setNotice('')} style={{ ...linkBtn('var(--success)'), marginLeft: 'auto' }}>dismiss</button>
        </div>
      )}

      {/* Approved plan items waiting to become engagements — the sanctioned route. */}
      {pending.length > 0 && (
        <div style={{ ...S.card, padding: 16, marginBottom: 14, borderLeft: '3px solid var(--brand)' }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--ink)', marginBottom: 4 }}>
            Ready to start from the approved plan
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>
            These carry the risk rationale and budget that justified them, so starting one here keeps the
            engagement traceable back to the board-approved plan.
          </div>
          {pending.map((it) => (
            <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--line-soft)', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-body)' }}>
                <strong style={{ color: 'var(--ink)' }}>{it.auditableEntity?.name}</strong>
                {' · '}{it.planYear} Q{it.plannedQuarter} · {it.budgetHours}h
                <span style={{ color: RATING_COLOR[it.auditableEntity?.riskTier] || 'var(--ink-muted)' }}>
                  {' · '}{it.auditableEntity?.riskTier} risk
                </span>
                {it.rationale && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>{it.rationale}</div>}
              </div>
              <button style={primaryBtn()} onClick={() => startFromPlan(it)}>Start engagement</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...S.input, maxWidth: 200 }}>
          <option value="">All statuses</option>
          {['Planned', 'Fieldwork', 'Reporting', 'Closed', 'Cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <button onClick={() => { setFormErr(''); setShowNew(true); }} style={ghostBtn}>+ Special engagement</button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading engagements…</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {visible.map((a) => (
            <div key={a.id} style={{
              ...S.card,
              outline: selectedId === a.id ? '2px solid var(--brand)' : 'none',
              outlineOffset: -1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <button onClick={() => openDetail(a.id)} style={{ ...linkBtn('var(--ink-body)'), fontSize: 14, padding: 0, textAlign: 'left' }}>
                    <strong>{a.ref}</strong> — {a.title}
                  </button>
                  {a.unplannedReason && (
                    <span style={{ marginLeft: 8, ...pill('var(--warning)', 'var(--warning-line)') }}>outside the plan</span>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>
                    {a.tenant.name} · lead {a.leadAuditor.name} · {a.criteria}
                  </div>
                  {a.unplannedReason && (
                    <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 3 }}>
                      Run outside the annual plan: {a.unplannedReason}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, flexWrap: 'wrap' }}>
                    {a.conclusion && (
                      <span style={{ color: a.conclusion === 'Adequate' ? 'var(--success)' : a.conclusion === 'Inadequate' ? 'var(--danger)' : 'var(--warning)' }}>
                        {a.conclusion === 'NeedsImprovement' ? 'Needs improvement' : a.conclusion}
                      </span>
                    )}
                    <span style={{ color: 'var(--ink-muted)' }}>{a.findingCounts.total} findings</span>
                    {a.findingCounts.open > 0 && <span style={{ color: 'var(--warning)' }}>{a.findingCounts.open} open</span>}
                    {a.findingCounts.high > 0 && <span style={{ color: 'var(--danger)' }}>{a.findingCounts.high} high</span>}
                    <span style={{ color: 'var(--success)' }}>{a.findingCounts.closed} closed</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <span style={AUDIT_STATUS_PILL[a.status] || AUDIT_STATUS_PILL.Planned}>{a.status}</span>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => onSelect(a.id, a.ref)}
                      style={linkBtn(selectedId === a.id ? 'var(--brand)' : 'var(--info)')}
                    >
                      {selectedId === a.id ? '✓ working on this' : 'work on this'}
                    </button>
                    {a.status === 'Planned' && <button onClick={() => setAuditStatus(a.id, 'Fieldwork')} style={linkBtn('var(--warning)')}>start fieldwork</button>}
                    {a.status === 'Fieldwork' && (
                      <button onClick={() => recordConclusion(a)} style={linkBtn('var(--info)')}>
                        {a.conclusion ? 'revise conclusion' : 'record conclusion'}
                      </button>
                    )}
                    {a.status === 'Fieldwork' && <button onClick={() => setAuditStatus(a.id, 'Reporting')} style={linkBtn('var(--info)')}>to reporting</button>}
                    {(a.status === 'Planned' || a.status === 'Fieldwork') && (
                      <button onClick={() => setAuditStatus(a.id, 'Cancelled')} style={linkBtn('var(--ink-faint)')}>cancel</button>
                    )}
                    {a.status === 'Reporting' && <button onClick={() => setAuditStatus(a.id, 'Closed')} style={linkBtn('var(--success)')}>close audit</button>}
                    <button onClick={() => exportAudit(a, 'rcm')} style={linkBtn('var(--ink-muted)')}>RCM</button>
                    <button onClick={() => exportAudit(a, 'report')} style={linkBtn('var(--ink-muted)')}>report</button>
                    <button onClick={() => openDetail(a.id)} style={linkBtn('var(--ink-muted)')}>open</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <div style={{ ...S.card, padding: 40, textAlign: 'center', color: 'var(--ink-muted)', borderStyle: 'dashed' }}>
              No engagements yet. Approve an annual plan on the Universe &amp; Plan tab, then start one from a plan item.
            </div>
          )}
        </div>
      )}

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 560, padding: 26, borderRadius: 12, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 17, color: 'var(--ink)' }}>Special engagement</h3>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--ink-muted)' }}>
              This engagement will not be part of the approved annual plan. That is legitimate for a board
              request or an investigation, but it consumes plan capacity, so the reason is recorded and the
              engagement is badged as unplanned wherever it appears.
            </p>
            {formErr && <div style={{ ...S.error, marginBottom: 14 }}>{formErr}</div>}
            <form onSubmit={createAudit}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Why is this being run outside the plan?</label>
              <textarea
                required rows={2} minLength={10}
                value={form.unplannedReason}
                onChange={(e) => setForm({ ...form, unplannedReason: e.target.value })}
                placeholder="e.g. Requested by the Audit Committee on 12 Feb following the payments incident."
                style={{ ...S.input, marginBottom: 12, resize: 'vertical' }}
              />
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Title</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Objective</label>
              <textarea required rows={2} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} style={{ ...S.input, marginBottom: 12, resize: 'vertical' }} />
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Scope</label>
              <textarea required rows={2} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} style={{ ...S.input, marginBottom: 12, resize: 'vertical' }} />
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Criteria (frameworks / clauses)</label>
              <input required value={form.criteria} onChange={(e) => setForm({ ...form, criteria: e.target.value })} placeholder="ISO 27001 A.5.15, NCA ECC 2-2-1" style={{ ...S.input, marginBottom: 20 }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>{busy ? 'Creating…' : 'Create engagement'}</button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detail && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 760, padding: 26, borderRadius: 12, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: 'var(--ink)' }}>{detail.ref} — {detail.title}</h3>
              <button onClick={() => setDetail(null)} style={linkBtn('var(--ink-muted)')}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 14 }}>
              lead {detail.leadAuditor.name} · {detail.criteria}
              <span style={{ marginLeft: 8 }}><span style={AUDIT_STATUS_PILL[detail.status]}>{detail.status}</span></span>
            </div>
            <div style={{ background: 'var(--surface-sunk)', border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12, color: 'var(--ink-body)', lineHeight: 1.6 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginBottom: 3, letterSpacing: '0.05em' }}>OBJECTIVE</div>{detail.objective}
              <div style={{ fontSize: 10, color: 'var(--ink-faint)', margin: '8px 0 3px', letterSpacing: '0.05em' }}>SCOPE</div>{detail.scope}
              {detail.conclusion && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--ink-faint)', margin: '8px 0 3px', letterSpacing: '0.05em' }}>CONCLUSION</div>
                  <span style={{ color: detail.conclusion === 'Adequate' ? 'var(--success)' : detail.conclusion === 'Inadequate' ? 'var(--danger)' : 'var(--warning)' }}>
                    {detail.conclusion}
                  </span> — {detail.conclusionNarrative}
                </>
              )}
              {detail.cancellationReason && (
                <>
                  <div style={{ fontSize: 10, color: 'var(--ink-faint)', margin: '8px 0 3px', letterSpacing: '0.05em' }}>CANCELLED</div>
                  {detail.cancellationReason}
                </>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>Findings ({detail.issues.length})</span>
              {!['Closed', 'Cancelled'].includes(detail.status) && (
                <button onClick={() => setShowFinding(true)} style={primaryBtn()}>+ Raise finding</button>
              )}
            </div>

            {detail.issues.map((f: any) => (
              <div key={f.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-body)' }}>
                    <strong>{f.ref}</strong> <span style={{ color: RATING_COLOR[f.riskRating] }}>· {f.riskRating}</span>
                  </span>
                  <span style={FINDING_STATUS_PILL[f.status] || FINDING_STATUS_PILL.Open}>{f.status}{f.reopenedCount > 0 ? ` ×${f.reopenedCount}` : ''}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
                  <div><span style={{ color: 'var(--ink-body)' }}>Criterion:</span> {f.criterion}</div>
                  <div><span style={{ color: 'var(--ink-body)' }}>Condition:</span> {f.condition}</div>
                  <div><span style={{ color: 'var(--ink-body)' }}>Cause:</span> {f.cause}</div>
                  <div><span style={{ color: 'var(--ink-body)' }}>Recommendation:</span> {f.recommendation}</div>
                  {f.responseType && (
                    <div style={{ color: f.responseType === 'Disagree' ? 'var(--danger)' : 'var(--info)' }}>
                      Management {f.responseType}{f.respondedBy ? ` (${f.respondedBy.name})` : ''}: {f.responseNarrative}
                      {f.managementActionPlan && <div style={{ color: 'var(--ink-muted)' }}>Action plan: {f.managementActionPlan}</div>}
                    </div>
                  )}
                  {f.escalationLevel > 0 && (
                    <div style={{ color: 'var(--danger)' }}>Escalated to {f.escalationLevel === 1 ? 'executive management' : 'the audit committee'}</div>
                  )}
                  {f.capOwner && <div style={{ color: 'var(--info)' }}>CAP: {f.capOwner.name}{f.capDueDate ? ` · due ${f.capDueDate.slice(0, 10)}` : ''}</div>}
                  {f.closedBy && <div style={{ color: 'var(--success)' }}>Closed by {f.closedBy.name} — {f.closureNote}</div>}
                  <div style={{ color: 'var(--ink-faint)', fontSize: 10 }}>raised by {f.raisedBy.name}</div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(f.status === 'Open' || f.status === 'Reopened') && <button onClick={() => respond(f)} style={linkBtn('var(--info)')}>record management response</button>}
                  {f.status === 'Responded' && <button onClick={() => assignCap(f)} style={linkBtn('var(--info)')}>assign CAP</button>}
                  {f.status === 'Disputed' && <button onClick={() => escalate(f)} style={linkBtn('var(--danger)')}>escalate</button>}
                  {f.status === 'CAPAssigned' && <button onClick={() => submitForClosure(f)} style={linkBtn('var(--info)')}>submit for closure</button>}
                  {f.status === 'PendingClosure' && <button onClick={() => closeFinding(f)} style={linkBtn('var(--success)')}>validate &amp; close</button>}
                  {f.status === 'Closed' && <button onClick={() => reopenFinding(f)} style={linkBtn('var(--danger)')}>reopen</button>}
                </div>
              </div>
            ))}
            {detail.issues.length === 0 && <div style={{ color: 'var(--ink-muted)', fontSize: 12 }}>No findings raised.</div>}

            {showFinding && (
              <div style={{ marginTop: 14, border: '1px solid var(--line)', borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>
                  New finding — criterion, condition, cause and recommendation are all required
                </div>
                <form onSubmit={raiseFinding}>
                  {(['criterion', 'condition', 'cause', 'recommendation'] as const).map((k) => (
                    <div key={k} style={{ marginBottom: 8 }}>
                      <label style={{ display: 'block', fontSize: 11, marginBottom: 3, color: 'var(--ink-muted)', textTransform: 'capitalize' }}>{k}</label>
                      <input required value={(finding as any)[k]} onChange={(e) => setFinding({ ...finding, [k]: e.target.value })} style={S.input} />
                    </div>
                  ))}
                  <label style={{ display: 'block', fontSize: 11, marginBottom: 3, color: 'var(--ink-muted)' }}>Risk rating</label>
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

export default Engagements;
