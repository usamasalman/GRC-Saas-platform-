import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, StatStrip, primaryBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * One register for every issue, whatever raised it.
 *
 * Aging, escalation and closure work identically for a regulator finding and
 * an internal audit finding — that is the whole reason they live in one table
 * rather than per-source silos. The lifecycle is enforced server-side; the UI
 * offers only the transition the record is actually eligible for.
 */

const RISK_PILL: Record<string, React.CSSProperties> = {
  High: pill('var(--danger)', 'var(--danger-line)'),
  Medium: pill('var(--warning)', 'var(--warning-line)'),
  Low: pill('var(--success)', 'var(--success-line)'),
};
const STATUS_PILL: Record<string, React.CSSProperties> = {
  Open: pill('var(--info)', 'var(--info-line)'),
  Reopened: pill('var(--danger)', 'var(--danger-line)'),
  Disputed: pill('var(--danger)', 'var(--danger-line)'),
  Responded: pill('var(--info)', 'var(--info-line)'),
  CAPAssigned: pill('var(--warning)', 'var(--warning-line)'),
  PendingClosure: pill('var(--info)', 'var(--info-line)'),
  Closed: pill('var(--success)', 'var(--success-line)'),
};

const SOURCES = ['ExternalAudit', 'Regulator', 'SelfIdentified', 'Incident', 'RiskAssessment'];
const SOURCE_LABEL: Record<string, string> = {
  InternalAudit: 'Internal audit',
  ExternalAudit: 'External audit',
  Regulator: 'Regulator',
  SelfIdentified: 'Self-identified',
  Incident: 'Incident',
  RiskAssessment: 'Risk assessment',
};

const IssueRegister: React.FC = () => {
  const [issues, setIssues] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [bySource, setBySource] = useState<Record<string, number>>({});
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState({ source: '', status: '', overdue: false });
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    source: 'SelfIdentified', sourceReference: '', title: '',
    condition: '', recommendation: '', riskRating: 'Medium', targetCloseDate: '',
  });

  const me = (() => { try { return JSON.parse(localStorage.getItem('grc_user_json') || 'null'); } catch { return null; } })();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams();
      if (filter.source) qs.set('source', filter.source);
      if (filter.status) qs.set('status', filter.status);
      if (filter.overdue) qs.set('overdue', 'true');
      const res = await apiClient.get(`/api/grc/issues?${qs.toString()}`);
      setIssues(res.data?.issues || []);
      setTotals(res.data?.totals || {});
      setBySource(res.data?.bySource || {});
    } catch (err) { setError(apiError(err, 'Failed to load the issue register')); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Only needed to name a CAP owner; a failure here must not block the register.
    apiClient.get('/api/iam/users').then((r) => setUsers(r.data?.users || [])).catch(() => setUsers([]));
  }, []);

  const needsSourceRef = form.source === 'Regulator' || form.source === 'ExternalAudit';

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/grc/issues', {
        ...form,
        sourceReference: form.sourceReference || undefined,
        targetCloseDate: form.targetCloseDate || undefined,
      });
      setShowNew(false);
      setForm({ source: 'SelfIdentified', sourceReference: '', title: '', condition: '', recommendation: '', riskRating: 'Medium', targetCloseDate: '' });
      setNotice('Issue raised — it now needs a management response before remediation can start');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const act = async (url: string, body: any, fallback: string) => {
    try {
      const res = await apiClient.post(url, body);
      setNotice(res.data?.message || fallback);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const respond = (i: any) => {
    if (i.raisedBy?.id === me?.id) {
      window.alert('SoD: whoever raised an issue cannot supply management’s response to it.');
      return;
    }
    const responseType = window.prompt('Response — Agree / PartiallyAgree / Disagree:', 'Agree');
    if (!responseType) return;
    const responseNarrative = window.prompt(
      responseType === 'Disagree'
        ? 'Why does management dispute this finding? A disputed issue gets no CAP and must be escalated.'
        : 'Management’s narrative response:',
    );
    if (!responseNarrative) return;
    const managementActionPlan = responseType === 'Disagree'
      ? undefined
      : window.prompt('What will management do about it?') || undefined;
    act(`/api/grc/issues/${i.id}/respond`, { responseType, responseNarrative, managementActionPlan }, 'Response recorded');
  };

  const assignCap = (i: any) => {
    if (users.length === 0) { window.alert('No users available to own the action.'); return; }
    const choice = window.prompt(
      `Who owns the corrective action?\n${users.slice(0, 20).map((u, n) => `${n + 1}. ${u.name} (${u.email})`).join('\n')}`,
      '1',
    );
    if (!choice) return;
    const owner = users[Number(choice) - 1];
    if (!owner) { window.alert('No user at that position.'); return; }
    const capDueDate = window.prompt('Due date (YYYY-MM-DD):', i.aging?.targetDate ? String(i.aging.targetDate).slice(0, 10) : '');
    if (!capDueDate) return;
    const capDescription = window.prompt('What is the corrective action?');
    act(`/api/grc/issues/${i.id}/cap`, { capOwnerId: owner.id, capDueDate, capDescription }, 'CAP assigned');
  };

  // Filtering happens server-side so the totals and the rows always agree.
  const filtered = issues;

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
        ['Open issues', totals.open ?? 0],
        ['Overdue', <span style={{ color: (totals.overdue ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.overdue ?? 0}</span>],
        ['Awaiting response', <span style={{ color: (totals.awaitingResponse ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.awaitingResponse ?? 0}</span>],
        ['Disputed', <span style={{ color: (totals.disputed ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.disputed ?? 0}</span>],
        ['Closure rate', `${totals.closureRate ?? 0}%`],
      ]} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })} style={{ ...S.input, width: 200 }}>
          <option value="">All sources</option>
          {Object.keys(SOURCE_LABEL).map((s) => (
            <option key={s} value={s}>{SOURCE_LABEL[s]}{bySource[s] ? ` (${bySource[s]})` : ''}</option>
          ))}
        </select>
        <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} style={{ ...S.input, width: 200 }}>
          <option value="">All statuses</option>
          {Object.keys(STATUS_PILL).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <label style={{ fontSize: 13, color: 'var(--ink-body)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={filter.overdue} onChange={(e) => setFilter({ ...filter, overdue: e.target.checked })} />
          Overdue only
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={primaryBtn()} onClick={() => setShowNew(!showNew)}>
            {showNew ? 'Cancel' : '+ Raise issue'}
          </button>
        </div>
      </div>

      {showNew && (
        <form onSubmit={create} style={{ ...S.card, padding: 16, marginBottom: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--ink-muted)' }}>
            Internal audit findings are raised against their engagement so they inherit its reference and
            workpaper trail. This form is for issues from every other source.
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Source</label>
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} style={S.input}>
              {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>
              Source document {needsSourceRef && <span style={{ color: 'var(--danger)' }}>· required</span>}
            </label>
            <input
              required={needsSourceRef}
              placeholder={needsSourceRef ? 'e.g. SAMA-2026-114' : 'optional'}
              value={form.sourceReference}
              onChange={(e) => setForm({ ...form, sourceReference: e.target.value })}
              style={S.input}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Risk rating</label>
            <select value={form.riskRating} onChange={(e) => setForm({ ...form, riskRating: e.target.value })} style={S.input}>
              {['High', 'Medium', 'Low'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Target close date</label>
            <input type="date" value={form.targetCloseDate} onChange={(e) => setForm({ ...form, targetCloseDate: e.target.value })} style={S.input} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Title</label>
            <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={S.input} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Condition — what was found</label>
            <textarea rows={2} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} style={{ ...S.input, resize: 'vertical' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Recommendation</label>
            <textarea required rows={2} value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })} style={{ ...S.input, resize: 'vertical' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <button type="submit" style={primaryBtn()}>Raise issue</button>
          </div>
        </form>
      )}

      {filtered.length === 0 && (
        <div style={{ ...S.card, padding: 26, color: 'var(--ink-muted)', fontSize: 13 }}>
          No issues match this filter.
        </div>
      )}

      {filtered.map((i) => {
        const raisedByMe = i.raisedBy?.id === me?.id;
        const capOwnerIsMe = i.capOwner?.id === me?.id;
        return (
          <div key={i.id} style={{
            ...S.card, padding: 16, marginBottom: 10,
            borderLeft: `3px solid ${i.aging?.isOverdue ? 'var(--danger)' : i.status === 'Closed' ? 'var(--success)' : 'var(--line)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 420px' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--brand)' }}>{i.ref}</span>
                  <span style={{ fontWeight: 650, color: 'var(--ink)' }}>{i.title}</span>
                  <span style={RISK_PILL[i.riskRating] || RISK_PILL.Medium}>{i.riskRating}</span>
                  <span style={STATUS_PILL[i.status] || STATUS_PILL.Open}>{i.status}</span>
                  {i.escalationLevel > 0 && (
                    <span style={pill('var(--danger)', 'var(--danger-line)')}>
                      escalated to {i.escalationLevel === 1 ? 'executive' : 'audit committee'}
                    </span>
                  )}
                  {i.reopenedCount > 0 && (
                    <span style={pill('var(--warning)', 'var(--warning-line)')}>reopened ×{i.reopenedCount}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>
                  {SOURCE_LABEL[i.source] || i.source}
                  {i.sourceReference && <> · {i.sourceReference}</>}
                  {i.audit && <> · {i.audit.ref}</>}
                  {' · '}raised by {i.raisedBy?.name}{raisedByMe && <span style={{ color: 'var(--info)' }}> (you)</span>}
                  {' · '}{i.aging?.ageDays}d old ({i.aging?.ageBucket})
                  {i.aging?.isOverdue && (
                    <span style={{ color: 'var(--danger)', fontWeight: 600 }}> · {i.aging.daysOverdue}d overdue</span>
                  )}
                </div>
                {i.condition && <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 7 }}>{i.condition}</div>}
                <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginTop: 5 }}>
                  <strong style={{ color: 'var(--ink-muted)' }}>Recommendation: </strong>{i.recommendation}
                </div>
                {i.responseType && (
                  <div style={{ fontSize: 12.5, marginTop: 7, padding: '8px 10px', background: 'var(--surface-sunk)', border: '1px solid var(--line-soft)', borderRadius: 'var(--radius-sm)' }}>
                    <strong style={{ color: i.responseType === 'Disagree' ? 'var(--danger)' : 'var(--ink-muted)' }}>
                      Management {i.responseType.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}
                      {i.respondedBy && ` — ${i.respondedBy.name}`}:{' '}
                    </strong>
                    <span style={{ color: 'var(--ink-body)' }}>{i.responseNarrative}</span>
                    {i.managementActionPlan && (
                      <div style={{ marginTop: 5, color: 'var(--ink-body)' }}>
                        <strong style={{ color: 'var(--ink-muted)' }}>Action plan: </strong>{i.managementActionPlan}
                      </div>
                    )}
                  </div>
                )}
                {i.capOwner && (
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 6 }}>
                    CAP owned by {i.capOwner.name}
                    {capOwnerIsMe && <span style={{ color: 'var(--info)' }}> (you)</span>}
                    {i.capDueDate && <> · due {String(i.capDueDate).slice(0, 10)}</>}
                    {i.capDescription && <> — {i.capDescription}</>}
                  </div>
                )}
                {i.status === 'Closed' && i.closedBy && (
                  <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 6 }}>
                    Closed by {i.closedBy.name} on {String(i.closedAt).slice(0, 10)}
                    {i.closureNote && <> — {i.closureNote}</>}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {['Open', 'Reopened'].includes(i.status) && (
                  <button style={linkBtn('var(--info)')} onClick={() => respond(i)}>management response</button>
                )}
                {i.status === 'Responded' && (
                  <button style={linkBtn('var(--warning)')} onClick={() => assignCap(i)}>assign CAP</button>
                )}
                {i.status === 'CAPAssigned' && (
                  <button
                    style={linkBtn('var(--info)')}
                    onClick={() => {
                      const evidenceNote = window.prompt('What evidence shows the remediation is complete?');
                      if (!evidenceNote) return;
                      act(`/api/grc/issues/${i.id}/submit-closure`, { evidenceNote }, 'Submitted for validation');
                    }}
                  >
                    submit for closure
                  </button>
                )}
                {i.status === 'PendingClosure' && (
                  <button
                    style={linkBtn('var(--success)')}
                    onClick={() => {
                      if (raisedByMe) { window.alert('SoD: whoever raised an issue cannot close it.'); return; }
                      if (capOwnerIsMe) { window.alert('SoD: the CAP owner cannot validate their own remediation.'); return; }
                      const note = window.prompt('Closure note — this is the validation evidence:');
                      if (!note) return;
                      act(`/api/grc/issues/${i.id}/close`, { note }, 'Closed');
                    }}
                  >
                    validate and close
                  </button>
                )}
                {i.status === 'Closed' && (
                  <button
                    style={linkBtn('var(--danger)')}
                    onClick={() => {
                      const reason = window.prompt('Why is this being reopened?');
                      if (!reason) return;
                      act(`/api/grc/issues/${i.id}/reopen`, { reason }, 'Reopened');
                    }}
                  >
                    reopen
                  </button>
                )}
                {i.status !== 'Closed' && (i.status === 'Disputed' || i.aging?.isOverdue) && i.escalationLevel < 2 && (
                  <button
                    style={linkBtn('var(--danger)')}
                    onClick={() => {
                      const reason = window.prompt(
                        i.escalationLevel === 0
                          ? 'Escalate to executive management — why?'
                          : 'Escalate to the audit committee — why?',
                      );
                      if (!reason) return;
                      act(`/api/grc/issues/${i.id}/escalate`, { reason }, 'Escalated');
                    }}
                  >
                    escalate
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default IssueRegister;
