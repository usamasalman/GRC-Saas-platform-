import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, StatStrip, primaryBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';
import DeleteRecordButton from '../../../components/DeleteRecordButton';
import { PromptDialog } from '../../../components/Dialog';
import FormDialog from '../../../components/FormDialog';

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
const RESPONSE_TYPES = ['Agree', 'PartiallyAgree', 'Disagree'];
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
  /**
   * The finding being corrected, or null when raising a new one.
   *
   * The register had eight endpoints and not one could fix a typo — every
   * operation moved the finding forward through its lifecycle. Auditors write
   * findings in the field against a deadline; a wrong rating or a half-finished
   * recommendation was permanent.
   */
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({
    source: 'SelfIdentified', sourceReference: '', title: '',
    condition: '', recommendation: '', riskRating: 'Medium', targetCloseDate: '',
  });

  /**
   * Every lifecycle dialog this screen opens, in one state.
   *
   * The issue travels with the dialog rather than being looked up on submit: the
   * register reloads under the dialog on every action, so the row it was opened
   * from is a different object by the time the answer comes back.
   */
  type Dlg =
    | null
    | { kind: 'respond'; i: any }
    | { kind: 'assignCap'; i: any }
    | { kind: 'submitClosure'; i: any }
    | { kind: 'close'; i: any }
    | { kind: 'reopen'; i: any }
    | { kind: 'escalate'; i: any };
  const [dlg, setDlg] = useState<Dlg>(null);
  const [dlgBusy, setDlgBusy] = useState(false);

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

  const BLANK_ISSUE = {
    source: 'SelfIdentified', sourceReference: '', title: '',
    condition: '', recommendation: '', riskRating: 'Medium', targetCloseDate: '',
  };

  const openCreate = () => { setEditing(null); setForm(BLANK_ISSUE); setShowNew(true); };

  const openEdit = (i: any) => {
    setEditing(i);
    setForm({
      source: i.source || 'SelfIdentified',
      sourceReference: i.sourceReference || '',
      title: i.title || '',
      condition: i.condition || '',
      recommendation: i.recommendation || '',
      riskRating: i.riskRating || 'Medium',
      targetCloseDate: i.targetCloseDate ? String(i.targetCloseDate).slice(0, 10) : '',
    });
    setShowNew(true);
  };

  /**
   * Save a corrected finding.
   *
   * Source is not sent. It decides which lifecycle and which SoD rules apply --
   * a regulator finding is not the same object as a self-identified one -- and
   * the server does not accept it on a PATCH either.
   */
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await apiClient.patch(`/api/grc/issues/${editing.id}`, {
        title: form.title,
        condition: form.condition,
        recommendation: form.recommendation,
        riskRating: form.riskRating,
        targetCloseDate: form.targetCloseDate || undefined,
      });
      setShowNew(false);
      setEditing(null);
      setNotice(`${editing.ref} updated`);
      await load();
    } catch (err) { setNotice(apiError(err)); }
  };

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
    } catch (err) { setError(apiError(err)); }
  };

  const act = async (url: string, body: any, fallback: string) => {
    try {
      const res = await apiClient.post(url, body);
      setNotice(res.data?.message || fallback);
      await load();
    } catch (err) { setError(apiError(err)); }
  };

  // Every transition below is the same shape, so the dialog bookkeeping is too:
  // hold the dialog open while the request is in flight, then close it either
  // way. A refusal lands in the page banner with the rest of this screen's.
  const actFromDialog = async (url: string, body: any, fallback: string) => {
    setDlgBusy(true);
    try { await act(url, body, fallback); }
    finally { setDlgBusy(false); setDlg(null); }
  };

  // The SoD checks run on the click, not on submit, so the dialog never opens
  // for someone who is not allowed to fill it in.
  const openRespond = (i: any) => {
    if (i.raisedBy?.id === me?.id) {
      setError('SoD: whoever raised an issue cannot supply management’s response to it.');
      return;
    }
    setDlg({ kind: 'respond', i });
  };

  const respond = (i: any, values: Record<string, string>) => {
    // Disputing commits management to nothing, so no action plan is sent — not
    // even one left in the field before the position was changed to Disagree.
    const managementActionPlan = values.responseType === 'Disagree'
      ? undefined
      : values.managementActionPlan || undefined;
    actFromDialog(
      `/api/grc/issues/${i.id}/respond`,
      { responseType: values.responseType, responseNarrative: values.responseNarrative, managementActionPlan },
      'Response recorded',
    );
  };

  // One line per user, and the same line is the value — the id is looked back up
  // on submit, since the picker can only offer lines it built from this list.
  const ownerOption = (u: any) => `${u.name} (${u.email})`;

  const openAssignCap = (i: any) => {
    if (users.length === 0) { setError('No users available to own the action.'); return; }
    setDlg({ kind: 'assignCap', i });
  };

  const assignCap = (i: any, values: Record<string, string>) => {
    const owner = users.find((u) => ownerOption(u) === values.owner);
    actFromDialog(
      `/api/grc/issues/${i.id}/cap`,
      { capOwnerId: owner?.id, capDueDate: values.capDueDate, capDescription: values.capDescription },
      'CAP assigned',
    );
  };

  // Independence cuts both ways: whoever raised it and whoever remediated it are
  // both barred from validating the fix.
  const openClose = (i: any) => {
    if (i.raisedBy?.id === me?.id) { setError('SoD: whoever raised an issue cannot close it.'); return; }
    if (i.capOwner?.id === me?.id) { setError('SoD: the CAP owner cannot validate their own remediation.'); return; }
    setDlg({ kind: 'close', i });
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
          <button style={primaryBtn()} onClick={() => (showNew ? (setShowNew(false), setEditing(null)) : openCreate())}>
            {showNew ? 'Cancel' : '+ Raise issue'}
          </button>
        </div>
      </div>

      {showNew && (
        <form onSubmit={editing ? saveEdit : create} style={{ ...S.card, padding: 16, marginBottom: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--ink-muted)' }}>
            {editing
              ? `Correcting ${editing.ref}. Changing the rating moves the target close date to `
                + 'match the remediation window for the new rating, unless you set a date yourself.'
              : 'Internal audit findings are raised against their engagement so they inherit its '
                + 'reference and workpaper trail. This form is for issues from every other source.'}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Source</label>
            <select
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              style={S.input}
              // Fixed once raised. Source selects which lifecycle and which
              // separation-of-duties rules apply, so a regulator finding is not the
              // same object as a self-identified one; the server ignores it here too.
              disabled={!!editing}
            >
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
            <button type="submit" style={primaryBtn()}>
              {editing ? `Save ${editing.ref}` : 'Raise issue'}
            </button>
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
                  <button style={linkBtn('var(--info)')} onClick={() => openRespond(i)}>management response</button>
                )}
                {/* Both are offered only while the finding is awaiting a response.
                    Once management has answered, editing the wording underneath
                    their response would record them as agreeing to something they
                    never read — the server refuses for the same reason. */}
                {['Open', 'Reopened'].includes(i.status) && (
                  <button style={linkBtn('var(--ink-body)')} onClick={() => openEdit(i)}>edit</button>
                )}
                {['Open', 'Reopened'].includes(i.status) && (
                  <DeleteRecordButton
                    endpoint={`/api/grc/issues/${i.id}`}
                    what="finding"
                    reference={i.ref}
                    name={i.title}
                    guidance="A finding that was genuinely raised and should not stand is closed with a reason instead, which records both the finding and the judgement about it."
                    onDone={(m) => { setNotice(m); load(); }}
                    label="delete"
                    style={{
                      background: 'none', border: 'none', padding: 0,
                      textDecoration: 'underline', fontWeight: 500, fontSize: 12,
                    }}
                  />
                )}
                {i.status === 'Responded' && (
                  <button style={linkBtn('var(--warning)')} onClick={() => openAssignCap(i)}>assign CAP</button>
                )}
                {i.status === 'CAPAssigned' && (
                  <button style={linkBtn('var(--info)')} onClick={() => setDlg({ kind: 'submitClosure', i })}>
                    submit for closure
                  </button>
                )}
                {i.status === 'PendingClosure' && (
                  <button style={linkBtn('var(--success)')} onClick={() => openClose(i)}>
                    validate and close
                  </button>
                )}
                {i.status === 'Closed' && (
                  <button style={linkBtn('var(--danger)')} onClick={() => setDlg({ kind: 'reopen', i })}>
                    reopen
                  </button>
                )}
                {i.status !== 'Closed' && (i.status === 'Disputed' || i.aging?.isOverdue) && i.escalationLevel < 2 && (
                  <button style={linkBtn('var(--danger)')} onClick={() => setDlg({ kind: 'escalate', i })}>
                    escalate
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {dlg?.kind === 'respond' && (
        <FormDialog
          title={`Management response — ${dlg.i.ref}`}
          intro={(
            <>
              <div><strong style={{ color: 'var(--ink)' }}>{dlg.i.title}</strong></div>
              <div style={{ marginTop: 6, color: 'var(--ink-muted)' }}>
                Recommendation: {dlg.i.recommendation}
              </div>
            </>
          )}
          submitLabel="Record response"
          busy={dlgBusy}
          fields={[
            {
              name: 'responseType', label: 'Position', type: 'select', options: RESPONSE_TYPES,
              help: 'Disagree disputes the finding: no corrective action plan can be assigned to it, '
                + 'and escalation is the only route forward.',
            },
            {
              name: 'responseNarrative', label: 'Management’s position', type: 'textarea', required: true,
              help: 'Management’s own words on the finding — this is what is shown against it from here on.',
            },
            {
              name: 'managementActionPlan', label: 'What will management do about it?', type: 'textarea',
              help: 'Not required, and not recorded, if the position is Disagree.',
            },
          ]}
          validate={(v) => (v.responseType !== 'Disagree' && !v.managementActionPlan?.trim()
            ? 'An action plan is required unless management disagrees with the finding.'
            : null)}
          onSubmit={(v) => respond(dlg.i, v)}
          onCancel={() => setDlg(null)}
        />
      )}

      {dlg?.kind === 'assignCap' && (
        <FormDialog
          title={`Corrective action plan — ${dlg.i.ref}`}
          intro={'The owner is answerable for the remediation and is notified of it, which also bars '
            + 'them from validating their own fix later.'}
          submitLabel="Assign CAP"
          busy={dlgBusy}
          fields={[
            { name: 'owner', label: 'Who owns the corrective action?', type: 'select', options: users.map(ownerOption) },
            {
              name: 'capDueDate', label: 'Due date', type: 'date', required: true,
              initial: dlg.i.aging?.targetDate ? String(dlg.i.aging.targetDate).slice(0, 10) : '',
              help: 'Pre-filled with the target close date for this rating. A later date does not move '
                + 'the target, so the issue still ages as overdue against the original.',
            },
            {
              name: 'capDescription', label: 'What is the corrective action?', type: 'textarea',
              placeholder: dlg.i.recommendation || '',
              help: 'Left blank, whatever is already recorded on the issue stands.',
            },
          ]}
          onSubmit={(v) => assignCap(dlg.i, v)}
          onCancel={() => setDlg(null)}
        />
      )}

      {dlg?.kind === 'submitClosure' && (
        <PromptDialog
          title={`Submit ${dlg.i.ref} for closure`}
          label="What evidence shows the remediation is complete?"
          multiline
          confirmLabel="Submit for closure"
          busy={dlgBusy}
          placeholder="e.g. MFA enforced on all 34 admin accounts on 3 March. Screenshots and the change ticket are on the shared drive."
          help={'The issue moves to pending closure. Someone other than you and whoever raised it has '
            + 'to validate this before it actually closes.'}
          validate={(v) => (v.trim() ? null : 'A note is required.')}
          onSubmit={(evidenceNote) => actFromDialog(
            `/api/grc/issues/${dlg.i.id}/submit-closure`, { evidenceNote }, 'Submitted for validation',
          )}
          onCancel={() => setDlg(null)}
        />
      )}

      {dlg?.kind === 'close' && (
        <PromptDialog
          title={`Validate and close ${dlg.i.ref}`}
          label="Closure note — this is the validation evidence"
          multiline
          confirmLabel="Validate and close"
          busy={dlgBusy}
          placeholder="e.g. Re-tested the control on 12 April across 20 accounts; all enforced."
          help={'What you checked, not what you were told. This is the record that the fix was verified '
            + 'rather than taken on trust.'}
          validate={(v) => (v.trim() ? null : 'A closure note is required.')}
          onSubmit={(note) => actFromDialog(`/api/grc/issues/${dlg.i.id}/close`, { note }, 'Closed')}
          onCancel={() => setDlg(null)}
        />
      )}

      {dlg?.kind === 'reopen' && (
        <PromptDialog
          title={`Reopen ${dlg.i.ref}`}
          label="Why is this being reopened?"
          multiline
          confirmLabel="Reopen issue"
          busy={dlgBusy}
          placeholder="e.g. The control failed again in the September walkthrough."
          help={'The issue goes back to Reopened and its reopen count goes up, which is what a repeat '
            + 'failure looks like on the report. The management response is voided with it, so '
            + 'management has to go on record again before a new CAP can be assigned.'}
          validate={(v) => (v.trim() ? null : 'A reason is required.')}
          onSubmit={(reason) => actFromDialog(`/api/grc/issues/${dlg.i.id}/reopen`, { reason }, 'Reopened')}
          onCancel={() => setDlg(null)}
        />
      )}

      {dlg?.kind === 'escalate' && (
        <PromptDialog
          title={dlg.i.escalationLevel === 0
            ? `Escalate ${dlg.i.ref} to executive management`
            : `Escalate ${dlg.i.ref} to the audit committee`}
          label={dlg.i.escalationLevel === 0
            ? 'Why does this need executive management?'
            : 'Why does this need the audit committee?'}
          multiline
          confirmLabel="Escalate"
          busy={dlgBusy}
          placeholder="e.g. Management disputes the criterion and two meetings have not resolved it."
          help={dlg.i.escalationLevel === 0
            ? 'The issue is badged as escalated from then on, and the reason is written to its audit trail with your name and the time.'
            : 'This issue is already with executive management. The audit committee is the last level, so it cannot be escalated again after this.'}
          validate={(v) => (v.trim() ? null : 'A reason is required.')}
          onSubmit={(reason) => actFromDialog(`/api/grc/issues/${dlg.i.id}/escalate`, { reason }, 'Escalated')}
          onCancel={() => setDlg(null)}
        />
      )}
    </div>
  );
};

export default IssueRegister;
