import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';
import { ConfirmDialog } from '../../components/Dialog';

/**
 * Tenant subscriptions.
 *
 * Same three problems the plan catalogue had, and the same fix. The list opened
 * with three invented subscriptions belonging to invented customers with
 * real-sounding names, a failed load replaced the real ones with those, and a
 * failed create was swallowed and appended locally under a made-up
 * `SUB-${Date.now()}` id. A subscription that only ever existed in the browser
 * cannot afterwards be changed or cancelled, which is what the report of not
 * being able to edit or delete one came down to.
 *
 * Changing plan and cancelling are now real operations. Cancelling sets the
 * status and stamps an end date rather than removing the row, because the row
 * is what the invoices raised against it refer to; deleting is kept for the
 * subscription raised against the wrong tenant a minute ago, and the server
 * refuses it once any invoice has been raised since it started.
 */

interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  startDate: string;
  endDate?: string | null;
  tenant?: { id: string; name: string; type: string };
  plan?: { id: string; name: string; priceMonthly: number; maxUsers: number };
}

interface Plan {
  id: string;
  name: string;
  priceMonthly: number;
  maxUsers: number;
}

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  ACTIVE: pill('var(--success)', 'var(--success-line)'),
  PENDING: pill('var(--warning)', 'var(--warning-line)'),
  CANCELLED: pill('var(--ink-muted)', 'var(--line)'),
};

const SubscriptionManagement: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ACTIVE');
  const [endDate, setEndDate] = useState('');
  const [formErr, setFormErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [removing, setRemoving] = useState<Subscription | null>(null);
  const [removeErr, setRemoveErr] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [subsRes, plansRes] = await Promise.all([
        apiClient.get('/api/billing/subscriptions'),
        apiClient.get('/api/billing/plans'),
      ]);
      const loadedPlans: Plan[] = plansRes.data?.plans || [];
      setSubscriptions(subsRes.data?.subscriptions || []);
      setPlans(loadedPlans);
      if (loadedPlans.length > 0 && !selectedPlanId) setSelectedPlanId(loadedPlans[0].id);
    } catch (err) {
      // Reports the failure. It does not stand in a plausible customer list —
      // an operator reading invented tenants as real ones is worse than a blank
      // table, and it is how a broken endpoint goes unnoticed for a month.
      setError(apiError(err, 'Could not load subscriptions.'));
      setSubscriptions([]);
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId]);

  useEffect(() => { loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditing(null);
    setSelectedPlanId(plans[0]?.id || '');
    setSelectedStatus('ACTIVE');
    setEndDate('');
    setFormErr('');
    setModalOpen(true);
  };

  const openEdit = (sub: Subscription) => {
    setEditing(sub);
    setSelectedPlanId(sub.planId);
    setSelectedStatus(sub.status);
    setEndDate(sub.endDate ? String(sub.endDate).slice(0, 10) : '');
    setFormErr('');
    setModalOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanId) { setFormErr('Choose a plan.'); return; }
    setSubmitting(true);
    setFormErr('');
    try {
      if (editing) {
        await apiClient.patch(`/api/billing/subscriptions/${editing.id}`, {
          planId: selectedPlanId,
          status: selectedStatus,
          endDate: endDate || undefined,
        });
        setNotice('Subscription updated.');
      } else {
        await apiClient.post('/api/billing/subscriptions', { planId: selectedPlanId });
        setNotice('Subscription created.');
      }
      setModalOpen(false);
      setEditing(null);
      await loadData();
    } catch (err) {
      setFormErr(apiError(err, editing ? 'Could not update the subscription' : 'Could not create the subscription'));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setSubmitting(true);
    setRemoveErr('');
    try {
      const res = await apiClient.delete(`/api/billing/subscriptions/${removing.id}`);
      setRemoving(null);
      setNotice(res.data?.message || 'Subscription removed.');
      await loadData();
    } catch (err) {
      setRemoveErr(apiError(err, 'Could not remove the subscription'));
    } finally {
      setSubmitting(false);
    }
  };

  const activeCount = subscriptions.filter((s) => s.status === 'ACTIVE').length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Subscription Management</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Commercial subscriptions, active tiers, tenant allocations, renewals and contract terms.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={openCreate} style={primaryBtn()} disabled={plans.length === 0}>
            + New subscription
          </button>
          <button onClick={loadData} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Active subscriptions', <span style={{ color: 'var(--success)' }}>{activeCount}</span>],
        ['Available tiers', plans.length],
        ['Currency', 'SAR (Saudi riyals)'],
        ['Audit status', 'WORM logged'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12, display: 'flex', gap: 10 }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} style={{ ...ghostBtn, marginLeft: 'auto', padding: '0 8px' }}>dismiss</button>
        </div>
      )}

      {plans.length === 0 && !loading && !error && (
        <div style={{
          background: 'var(--warning-bg)', border: '1px solid var(--warning-line)',
          padding: 12, borderRadius: 6, color: 'var(--warning)', marginBottom: 14, fontSize: 12.5,
        }}>
          There are no plans in the catalogue, so nothing can be subscribed to yet. Add one under
          Plans &amp; Catalogue first.
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading subscriptions…</div>
      ) : (
        <div style={S.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Subscription</th>
                <th style={S.th}>Tenant</th>
                <th style={S.th}>Plan tier</th>
                <th style={S.th}>Monthly price</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Started</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    No subscriptions in your scope.
                  </td>
                </tr>
              ) : (
                subscriptions.map((sub) => (
                  <tr key={sub.id} style={S.bodyRow}>
                    <td style={{ ...S.td, fontFamily: 'ui-monospace, monospace', color: 'var(--info)' }}>
                      {sub.id.slice(0, 8)}
                    </td>
                    <td style={S.td}>
                      <strong style={{ color: 'var(--ink)' }}>{sub.tenant?.name || '—'}</strong>
                      {sub.tenant?.type && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{sub.tenant.type}</div>}
                    </td>
                    <td style={S.td}>
                      <span style={{ color: 'var(--ink-body)', fontWeight: 600 }}>{sub.plan?.name || '—'}</span>
                      {sub.plan?.maxUsers != null && (
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{sub.plan.maxUsers} named users</div>
                      )}
                    </td>
                    <td style={{ ...S.td, color: 'var(--success)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      SAR {Number(sub.plan?.priceMonthly || 0).toLocaleString()}/mo
                    </td>
                    <td style={S.td}>
                      <span style={STATUS_STYLE[sub.status] || pill('var(--ink-muted)', 'var(--line)')}>
                        {sub.status}
                      </span>
                      {sub.endDate && (
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3 }}>
                          ended {String(sub.endDate).slice(0, 10)}
                        </div>
                      )}
                    </td>
                    <td style={{ ...S.td, color: 'var(--ink-muted)' }}>
                      {new Date(sub.startDate).toLocaleDateString()}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => openEdit(sub)}
                        style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}
                      >
                        Change
                      </button>
                      {/* Cancelling is the route for a real subscription ending, so
                          delete is hidden once it is cancelled — the server refuses
                          it there too. */}
                      {sub.status !== 'CANCELLED' && (
                        <button
                          onClick={() => { setRemoveErr(''); setRemoving(sub); }}
                          style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px', marginLeft: 6, color: 'var(--danger)' }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 460, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--ink)' }}>
              {editing ? `Change ${editing.tenant?.name || 'subscription'}` : 'Subscribe to a plan tier'}
            </h3>

            {formErr && <div style={S.error}>{formErr}</div>}

            <form onSubmit={submit}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
                  Plan tier
                </label>
                <select value={selectedPlanId} onChange={(e) => setSelectedPlanId(e.target.value)} style={S.input}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — SAR {Number(p.priceMonthly).toLocaleString()}/mo ({p.maxUsers} users)
                    </option>
                  ))}
                </select>
              </div>

              {editing && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
                      Status
                    </label>
                    <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)} style={S.input}>
                      {['ACTIVE', 'PENDING', 'CANCELLED'].map((st) => <option key={st}>{st}</option>)}
                    </select>
                    {selectedStatus === 'CANCELLED' && (
                      <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 5, lineHeight: 1.5 }}>
                        The subscription keeps its row and its invoices. If you leave the end date
                        blank it is stamped with today, because a cancellation with no date cannot
                        tell the invoice run whether to bill this month.
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>
                      End date
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      style={S.input}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => { setModalOpen(false); setEditing(null); }} style={ghostBtn}>
                  Cancel
                </button>
                <button type="submit" disabled={submitting} style={primaryBtn(submitting)}>
                  {submitting ? 'Saving…' : editing ? 'Save changes' : 'Confirm subscription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title="Delete this subscription?"
          destructive
          confirmLabel="Delete subscription"
          busy={submitting}
          message={(
            <>
              <div>
                <strong style={{ color: 'var(--ink)' }}>{removing.tenant?.name || 'This tenant'}</strong>
                {"'"}s subscription to {removing.plan?.name || 'its plan'} will be removed entirely.
              </div>
              <div style={{ marginTop: 10, color: 'var(--ink-muted)' }}>
                This is for one raised against the wrong tenant. A subscription that has been
                invoiced should be cancelled instead — the row is what those invoices refer to.
              </div>
              {removeErr && (
                <div style={{
                  marginTop: 12, padding: '10px 12px', borderRadius: 6,
                  background: 'var(--danger-bg)', border: '1px solid var(--danger-line)',
                  color: 'var(--danger)', fontSize: 12.5, lineHeight: 1.6,
                }}>
                  {removeErr}
                </div>
              )}
            </>
          )}
          onConfirm={confirmRemove}
          onCancel={() => { setRemoving(null); setRemoveErr(''); }}
        />
      )}
    </div>
  );
};

export default SubscriptionManagement;
