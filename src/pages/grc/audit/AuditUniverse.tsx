import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, StatStrip, primaryBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * The audit universe and the annual plan built from it (IIA Std 9.4).
 *
 * These two belong on one screen because the plan is only defensible as a
 * consequence of the scoring — showing a plan without the risk that justified
 * each entry invites exactly the question an assessor asks first.
 */

const TIER_PILL: Record<string, React.CSSProperties> = {
  High: pill('var(--danger)', 'var(--danger-line)'),
  Medium: pill('var(--warning)', 'var(--warning-line)'),
  Low: pill('var(--success)', 'var(--success-line)'),
};
const PLAN_PILL: Record<string, React.CSSProperties> = {
  Draft: pill('var(--ink-muted)', 'var(--line)'),
  SubmittedForApproval: pill('var(--warning)', 'var(--warning-line)'),
  Approved: pill('var(--success)', 'var(--success-line)'),
  Active: pill('var(--info)', 'var(--info-line)'),
  Closed: pill('var(--ink-muted)', 'var(--line)'),
};

const AuditUniverse: React.FC<{ onEngagementCreated?: () => void }> = ({ onEngagementCreated }) => {
  const [entities, setEntities] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [factorLabels, setFactorLabels] = useState<Record<string, string>>({});
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openPlan, setOpenPlan] = useState<string | null>(null);
  const [showEntity, setShowEntity] = useState(false);
  const [entityForm, setEntityForm] = useState({ name: '', type: 'Process', description: '' });

  const me = (() => { try { return JSON.parse(localStorage.getItem('grc_user_json') || 'null'); } catch { return null; } })();

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [u, p] = await Promise.all([
        apiClient.get('/api/grc/universe'),
        apiClient.get('/api/grc/plans'),
      ]);
      setEntities(u.data?.entities || []);
      setTotals(u.data?.totals || {});
      setFactorLabels(u.data?.factorLabels || {});
      setEntityTypes(u.data?.entityTypes || []);
      setPlans(p.data?.plans || []);
    } catch (err) { setError(apiError(err, 'Failed to load the audit universe')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/grc/universe', entityForm);
      setShowEntity(false);
      setEntityForm({ name: '', type: 'Process', description: '' });
      setNotice('Entity added to the universe — score it to place it in the plan');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  /** Six weighted factors, each 1–5. The composite is derived server-side. */
  const rescore = async (entity: any) => {
    const factors: Record<string, number> = {};
    for (const [key, label] of Object.entries(factorLabels)) {
      // The scores arrive nested under `factors`, not flat on the entity.
      const current = entity.factors?.[key] ?? 3;
      const answer = window.prompt(`${label} (1–5):`, String(current));
      if (answer === null) return;
      const n = Number(answer);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        window.alert(`${label} must be a whole number from 1 to 5.`);
        return;
      }
      factors[key] = n;
    }
    try {
      const res = await apiClient.patch(`/api/grc/universe/${entity.id}/score`, factors);
      setNotice(res.data?.message || 'Rescored');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const createPlan = async () => {
    const year = window.prompt('Fiscal year:', String(new Date().getFullYear()));
    if (!year) return;
    const title = window.prompt('Plan title:', `Annual internal audit plan ${year}`);
    if (!title) return;
    const hours = window.prompt('Total auditor capacity for the year, in hours:', '2000');
    if (!hours) return;
    try {
      const res = await apiClient.post('/api/grc/plans', {
        year: Number(year), title, totalBudgetHours: Number(hours),
      });
      setNotice(`Plan ${res.data?.plan?.year} created — add the entities it will cover`);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const addItem = async (plan: any) => {
    const highFirst = [...entities].sort((a, b) => b.riskScore - a.riskScore);
    const choice = window.prompt(
      `Which entity? Highest risk first:\n${highFirst.slice(0, 12).map((e, i) => `${i + 1}. ${e.name} (${e.riskTier}, ${e.riskScore})`).join('\n')}`,
      '1',
    );
    if (!choice) return;
    const entity = highFirst[Number(choice) - 1];
    if (!entity) { window.alert('No entity at that position.'); return; }
    const quarter = window.prompt('Planned quarter (1–4):', '1');
    if (!quarter) return;
    const hours = window.prompt('Budget hours:', String(entity.suggestedHours ?? 80));
    if (!hours) return;
    const rationale = window.prompt('Why is this in the plan?', `${entity.riskTier} risk — score ${entity.riskScore}`);
    try {
      await apiClient.post(`/api/grc/plans/${plan.id}/items`, {
        auditableEntityId: entity.id,
        plannedQuarter: Number(quarter),
        budgetHours: Number(hours),
        rationale,
      });
      setNotice(`${entity.name} added to the ${plan.year} plan`);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const act = async (url: string, body: any, ok: string) => {
    try {
      const res = await apiClient.post(url, body);
      setNotice(res.data?.message || ok);
      await load();
      onEngagementCreated?.();
    } catch (err) { window.alert(apiError(err)); }
  };

  const exportPlan = async (plan: any) => {
    const format = window.prompt('Format — xlsx, pdf or docx:', 'xlsx');
    if (!format) return;
    try {
      const res = await apiClient.get(`/api/grc/plans/${plan.id}/export?format=${format}`, { responseType: 'blob' });
      const named = (String(res.headers?.['content-disposition'] || '').match(/filename="(.+?)"/) || [])[1];
      const href = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = href; a.download = named || `plan.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
    } catch (err: any) {
      if (err?.response?.data instanceof Blob) {
        const t = await err.response.data.text();
        try { window.alert(JSON.parse(t).message); } catch { window.alert(t.slice(0, 160)); }
        return;
      }
      window.alert(apiError(err));
    }
  };

  if (loading) return <div style={{ padding: 30, color: 'var(--ink-muted)' }}>Loading…</div>;

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          {notice}
          <button onClick={() => setNotice('')} style={{ ...linkBtn('var(--success)'), float: 'right' }}>dismiss</button>
        </div>
      )}

      <StatStrip items={[
        ['Auditable entities', totals.total ?? 0],
        ['High risk', <span style={{ color: (totals.high ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{totals.high ?? 0}</span>],
        ['Never audited', <span style={{ color: (totals.neverAudited ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.neverAudited ?? 0}</span>],
        ['Overdue', <span style={{ color: (totals.overdue ?? 0) > 0 ? 'var(--warning)' : 'var(--ink)' }}>{totals.overdue ?? 0}</span>],
        ['In the current plan', totals.inPlan ?? 0],
      ]} />

      {/* ── Annual plans ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 10px' }}>
        <h3 style={{ margin: 0, fontSize: 15, color: 'var(--ink)' }}>Annual plans</h3>
        <button style={primaryBtn()} onClick={createPlan}>+ New plan</button>
      </div>

      {plans.length === 0 && (
        <div style={{ ...S.card, padding: 22, color: 'var(--ink-muted)', fontSize: 13 }}>
          No annual plan yet. An engagement can only be created from an approved plan item, so the plan
          comes first.
        </div>
      )}

      {plans.map((p) => (
        <div key={p.id} style={{ ...S.card, padding: 16, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 650, color: 'var(--ink)' }}>{p.title}</span>{' '}
              <span style={PLAN_PILL[p.status] || PLAN_PILL.Draft}>{p.status}</span>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3 }}>
                {p.year} · {p.items?.length ?? 0} engagements planned ·{' '}
                {p.allocatedHours ?? 0} of {p.totalBudgetHours} hours allocated
                {p.preparedBy && <> · prepared by {p.preparedBy.name}</>}
                {p.approvedBy && <> · approved by {p.approvedBy.name}</>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {p.status === 'Draft' && <button style={linkBtn('var(--info)')} onClick={() => addItem(p)}>add entity</button>}
              {p.status === 'Draft' && (
                <button style={linkBtn('var(--warning)')} onClick={() => act(`/api/grc/plans/${p.id}/submit`, {}, 'Submitted')}>
                  submit for approval
                </button>
              )}
              {p.status === 'SubmittedForApproval' && (
                <button
                  style={linkBtn('var(--success)')}
                  onClick={() => {
                    if (p.preparedBy?.id === me?.id) {
                      window.alert('SoD: the person who prepared the plan cannot approve it. A second approver is required.');
                      return;
                    }
                    const note = window.prompt('Approval note:');
                    if (note === null) return;
                    act(`/api/grc/plans/${p.id}/approve`, { approvalNote: note }, 'Approved');
                  }}
                >
                  approve
                </button>
              )}
              <button style={linkBtn('var(--ink-muted)')} onClick={() => exportPlan(p)}>export</button>
              <button style={linkBtn('var(--ink-muted)')} onClick={() => setOpenPlan(openPlan === p.id ? null : p.id)}>
                {openPlan === p.id ? 'hide' : 'items'}
              </button>
            </div>
          </div>

          {openPlan === p.id && (
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={S.th}>Q</th><th style={S.th}>Entity</th><th style={S.th}>Risk</th>
                    <th style={S.th}>Hours</th><th style={S.th}>Status</th>
                    <th style={S.th}>Rationale</th><th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(p.items || []).map((it: any) => (
                    <tr key={it.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                      <td style={S.td}>Q{it.plannedQuarter}</td>
                      <td style={{ ...S.td, color: 'var(--ink)' }}>{it.auditableEntity?.name}</td>
                      <td style={S.td}>
                        <span style={TIER_PILL[it.auditableEntity?.riskTier] || TIER_PILL.Medium}>
                          {it.auditableEntity?.riskTier} {it.auditableEntity?.riskScore}
                        </span>
                      </td>
                      <td style={S.td}>{it.budgetHours}</td>
                      <td style={S.td}>{it.status}</td>
                      <td style={{ ...S.td, color: 'var(--ink-muted)', maxWidth: 300 }}>{it.rationale}</td>
                      <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {p.status === 'Approved' && it.status === 'Planned' && (
                          <button
                            style={linkBtn('var(--success)')}
                            onClick={() => act(`/api/grc/plan-items/${it.id}/instantiate`, {}, 'Engagement created')}
                          >
                            start engagement
                          </button>
                        )}
                        {it.status === 'Planned' && (
                          <button
                            style={linkBtn('var(--ink-faint)')}
                            onClick={() => {
                              const reason = window.prompt('Why is this being deferred?');
                              if (!reason) return;
                              act(`/api/grc/plan-items/${it.id}/defer`, { reason }, 'Deferred');
                            }}
                          >
                            defer
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(p.items || []).length === 0 && (
                    <tr><td colSpan={7} style={{ ...S.td, color: 'var(--ink-faint)', padding: 18 }}>
                      No entities in this plan yet.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* ── Universe ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '24px 0 10px' }}>
        <h3 style={{ margin: 0, fontSize: 15, color: 'var(--ink)' }}>Audit universe</h3>
        <button style={primaryBtn()} onClick={() => setShowEntity(!showEntity)}>
          {showEntity ? 'Cancel' : '+ New entity'}
        </button>
      </div>

      {showEntity && (
        <form onSubmit={createEntity} style={{ ...S.card, padding: 16, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 260px' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Name</label>
            <input required value={entityForm.name} onChange={(e) => setEntityForm({ ...entityForm, name: e.target.value })} style={S.input} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Type</label>
            <select value={entityForm.type} onChange={(e) => setEntityForm({ ...entityForm, type: e.target.value })} style={{ ...S.input, width: 170 }}>
              {(entityTypes.length ? entityTypes : ['Process']).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Description</label>
            <input value={entityForm.description} onChange={(e) => setEntityForm({ ...entityForm, description: e.target.value })} style={S.input} />
          </div>
          <button type="submit" style={primaryBtn()}>Add</button>
        </form>
      )}

      <div style={{ ...S.card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={S.th}>Entity</th><th style={S.th}>Type</th><th style={S.th}>Score</th>
              <th style={S.th}>Tier</th><th style={S.th}>Last audited</th>
              <th style={S.th}>Suggested hours</th><th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...entities].sort((a, b) => b.riskScore - a.riskScore).map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                <td style={{ ...S.td, color: 'var(--ink)', fontWeight: 600 }}>
                  {e.name}
                  {e.neverAudited && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--warning)' }}>never audited</span>}
                  {e.isOverdue && !e.neverAudited && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--warning)' }}>overdue</span>}
                </td>
                <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{e.type}</td>
                <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>{e.riskScore}</td>
                <td style={S.td}><span style={TIER_PILL[e.riskTier] || TIER_PILL.Medium}>{e.riskTier}</span></td>
                <td style={{ ...S.td, color: 'var(--ink-muted)' }}>
                  {e.lastAuditedAt ? String(e.lastAuditedAt).slice(0, 10) : '—'}
                </td>
                <td style={S.td}>{e.suggestedHours ?? '—'}</td>
                <td style={{ ...S.td, textAlign: 'right' }}>
                  <button style={linkBtn('var(--info)')} onClick={() => rescore(e)}>rescore</button>
                </td>
              </tr>
            ))}
            {entities.length === 0 && (
              <tr><td colSpan={7} style={{ ...S.td, padding: 24, textAlign: 'center', color: 'var(--ink-faint)' }}>
                Nothing in the universe yet. Add the processes, systems and third parties that could be audited.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditUniverse;
