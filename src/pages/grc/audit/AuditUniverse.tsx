import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { PromptDialog, ReasonDialog } from '../../../components/Dialog';
import FormDialog from '../../../components/FormDialog';
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

/**
 * How an entity reads in the plan's entity picker.
 *
 * The leading position is what makes each option unique — two entities can share
 * a name, a tier and a score — so the selected string maps back to exactly one
 * row. The suggested hours ride along because the hours field below is filled in
 * before the entity is chosen.
 */
const rankedLabel = (e: any, i: number) =>
  `${i + 1}. ${e.name} — ${e.riskTier} risk, score ${e.riskScore}, ${e.suggestedHours ?? 80}h suggested`;

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

  // One piece of state for whatever dialog is open rather than a boolean each.
  // Two cannot be open at once, and a union makes that true by construction.
  // `ranked` is captured when the add-entity dialog opens so the picker cannot
  // reorder underneath a selection that has already been made.
  type Dlg =
    | { kind: 'rescore'; entity: any }
    | { kind: 'newPlan' }
    | { kind: 'addItem'; plan: any; ranked: any[] }
    | { kind: 'export'; plan: any }
    | { kind: 'approve'; plan: any }
    | { kind: 'defer'; item: any }
    | null;
  const [dialog, setDialog] = useState<Dlg>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  // A refusal from the server, shown inside the form that caused it. Closing the
  // dialog to put it in the page banner would throw away everything typed.
  const [dialogError, setDialogError] = useState('');

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
    } catch (err) { setError(apiError(err)); }
  };

  /** Six weighted factors, each 1–5. The composite is derived server-side. */
  const rescore = (entity: any) => { setDialogError(''); setDialog({ kind: 'rescore', entity }); };

  const doRescore = async (entity: any, values: Record<string, string>) => {
    setDialogBusy(true); setDialogError('');
    const factors: Record<string, number> = {};
    for (const key of Object.keys(factorLabels)) factors[key] = Number(values[key]);
    try {
      const res = await apiClient.patch(`/api/grc/universe/${entity.id}/score`, factors);
      setNotice(res.data?.message || 'Rescored');
      setDialog(null);
      await load();
    } catch (err) { setDialogError(apiError(err)); }
    finally { setDialogBusy(false); }
  };

  const createPlan = () => { setDialogError(''); setDialog({ kind: 'newPlan' }); };

  const doCreatePlan = async (v: Record<string, string>) => {
    setDialogBusy(true); setDialogError('');
    try {
      const res = await apiClient.post('/api/grc/plans', {
        year: Number(v.year), title: v.title, totalBudgetHours: Number(v.hours),
      });
      setNotice(`Plan ${res.data?.plan?.year} created — add the entities it will cover`);
      setDialog(null);
      await load();
    } catch (err) { setDialogError(apiError(err)); }
    finally { setDialogBusy(false); }
  };

  const addItem = (plan: any) => {
    setDialogError('');
    setDialog({ kind: 'addItem', plan, ranked: [...entities].sort((a, b) => b.riskScore - a.riskScore) });
  };

  const doAddItem = async (plan: any, ranked: any[], v: Record<string, string>) => {
    // The picker's options were built from this same array, so an exact label
    // match is the position that was chosen.
    const entity = ranked[ranked.findIndex((e, i) => rankedLabel(e, i) === v.entity)];
    if (!entity) { setDialogError('Choose an entity from the list.'); return; }
    setDialogBusy(true); setDialogError('');
    try {
      await apiClient.post(`/api/grc/plans/${plan.id}/items`, {
        auditableEntityId: entity.id,
        plannedQuarter: Number(v.quarter),
        budgetHours: Number(v.hours),
        rationale: v.rationale,
      });
      setNotice(`${entity.name} added to the ${plan.year} plan`);
      setDialog(null);
      await load();
    } catch (err) { setDialogError(apiError(err)); }
    finally { setDialogBusy(false); }
  };

  const act = async (url: string, body: any, ok: string) => {
    try {
      const res = await apiClient.post(url, body);
      setNotice(res.data?.message || ok);
      await load();
      onEngagementCreated?.();
    } catch (err) { setError(apiError(err)); }
  };

  const approvePlan = (plan: any) => {
    // Checked here as well as on the server so the dialog never opens on a plan
    // this person could only ever be refused for.
    if (plan.preparedBy?.id === me?.id) {
      setError('SoD: the person who prepared the plan cannot approve it. A second approver is required.');
      return;
    }
    setError('');
    setDialog({ kind: 'approve', plan });
  };

  const doApprovePlan = async (plan: any, approvalNote: string) => {
    setDialogBusy(true);
    try {
      await act(`/api/grc/plans/${plan.id}/approve`, { approvalNote }, 'Approved');
      setDialog(null);
    } finally { setDialogBusy(false); }
  };

  const doDefer = async (item: any, reason: string) => {
    setDialogBusy(true);
    try {
      await act(`/api/grc/plan-items/${item.id}/defer`, { reason }, 'Deferred');
      setDialog(null);
    } finally { setDialogBusy(false); }
  };

  const exportPlan = (plan: any) => { setDialogError(''); setDialog({ kind: 'export', plan }); };

  const doExportPlan = async (plan: any, format: string) => {
    setDialogBusy(true); setDialogError('');
    try {
      const res = await apiClient.get(`/api/grc/plans/${plan.id}/export?format=${format}`, { responseType: 'blob' });
      const named = (String(res.headers?.['content-disposition'] || '').match(/filename="(.+?)"/) || [])[1];
      const href = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = href; a.download = named || `plan.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
      setDialog(null);
    } catch (err: any) {
      // The export responds as a blob, so a refusal arrives as a blob too and
      // the message has to be read out of the body rather than off the error.
      if (err?.response?.data instanceof Blob) {
        const t = await err.response.data.text();
        try { setDialogError(JSON.parse(t).message); } catch { setDialogError(t.slice(0, 160)); }
        return;
      }
      setDialogError(apiError(err));
    } finally { setDialogBusy(false); }
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
                <button style={linkBtn('var(--success)')} onClick={() => approvePlan(p)}>
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
                            onClick={() => setDialog({ kind: 'defer', item: it })}
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

      {/* ── Dialogs ─────────────────────────────────────────────────────────
          Scoring an entity and planning one need several answers each. Asked one
          at a time you cannot see what you have already answered, cannot go back,
          and abandoning the last question discards the rest — so each is a single
          form, validated before anything is sent. */}

      {dialog?.kind === 'rescore' && (
        <FormDialog
          title={`Rescore ${dialog.entity.name}`}
          intro="Six weighted factors, each 1–5. The composite score and the risk tier
            are derived from these on the server, and the tier is what decides where
            this sits in the plan."
          submitLabel="Save scores"
          busy={dialogBusy}
          error={dialogError}
          fields={Object.entries(factorLabels).map(([key, label]) => ({
            name: key,
            label,
            type: 'number' as const,
            required: true,
            // The scores arrive nested under `factors`, not flat on the entity.
            initial: String(dialog.entity.factors?.[key] ?? 3),
          }))}
          validate={(v) => {
            const bad = Object.entries(factorLabels).find(([key]) => {
              const n = Number(v[key]);
              return !Number.isInteger(n) || n < 1 || n > 5;
            });
            return bad ? `${bad[1]} must be a whole number from 1 to 5.` : null;
          }}
          onSubmit={(v) => doRescore(dialog.entity, v)}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'newPlan' && (
        <FormDialog
          title="New annual plan"
          intro="The plan is the record of what internal audit committed to cover this
            year. An engagement can only be created from an approved item on it."
          submitLabel="Create plan"
          busy={dialogBusy}
          error={dialogError}
          fields={[
            { name: 'year', label: 'Fiscal year', type: 'number', required: true, initial: String(new Date().getFullYear()) },
            { name: 'title', label: 'Plan title', type: 'text', required: true, initial: `Annual internal audit plan ${new Date().getFullYear()}` },
            {
              name: 'hours', label: 'Total auditor capacity for the year, in hours',
              type: 'number', required: true, initial: '2000',
              help: 'What the team can actually deliver. Each entity added to the plan draws its budget from this.',
            },
          ]}
          onSubmit={doCreatePlan}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'addItem' && (
        <FormDialog
          title={`Add an entity to the ${dialog.plan.year} plan`}
          intro="Highest risk first. The rationale is what an assessor reads when they
            ask why this entity earned a slot and another did not."
          submitLabel="Add to plan"
          busy={dialogBusy}
          error={dialogError}
          fields={[
            {
              name: 'entity', label: 'Entity', type: 'select', required: true,
              options: dialog.ranked.map(rankedLabel),
            },
            { name: 'quarter', label: 'Planned quarter', type: 'select', required: true, options: ['1', '2', '3', '4'], initial: '1' },
            {
              name: 'hours', label: 'Budget hours', type: 'number', required: true,
              initial: String(dialog.ranked[0]?.suggestedHours ?? 80),
              help: 'Pre-filled with the suggestion for the entity at the top of the list — each entity carries its own suggestion in the picker above.',
            },
            {
              name: 'rationale', label: 'Why is this in the plan?', type: 'textarea',
              initial: dialog.ranked[0] ? `${dialog.ranked[0].riskTier} risk — score ${dialog.ranked[0].riskScore}` : '',
            },
          ]}
          onSubmit={(v) => doAddItem(dialog.plan, dialog.ranked, v)}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'export' && (
        <FormDialog
          title={`Export the ${dialog.plan.year} plan`}
          submitLabel="Export"
          busy={dialogBusy}
          error={dialogError}
          fields={[{
            name: 'format', label: 'Format', type: 'select',
            options: ['xlsx', 'pdf', 'docx'], initial: 'xlsx',
          }]}
          onSubmit={(v) => doExportPlan(dialog.plan, v.format)}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'approve' && (
        <PromptDialog
          title={`Approve the ${dialog.plan.year} plan?`}
          label="Approval note"
          multiline
          confirmLabel="Approve plan"
          busy={dialogBusy}
          help="Optional. Once the plan is approved, each planned item on it can be turned into a live engagement."
          onSubmit={(note) => doApprovePlan(dialog.plan, note)}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'defer' && (
        <ReasonDialog
          title="Defer this engagement?"
          confirmLabel="Defer"
          label="Why is this being deferred?"
          busy={dialogBusy}
          message={(
            <>
              {dialog.item.auditableEntity?.name} stays on the plan rather than
              leaving it, so the coverage that was promised and not delivered
              stays visible. The reason is recorded against the plan item — it is
              what answers the audit committee when they ask what happened to
              Q{dialog.item.plannedQuarter}.
            </>
          )}
          onConfirm={(reason) => doDefer(dialog.item, reason)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default AuditUniverse;
