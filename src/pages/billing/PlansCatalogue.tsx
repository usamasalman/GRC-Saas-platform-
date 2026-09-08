import Icon from '../../components/Icon';
import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';
import { ConfirmDialog } from '../../components/Dialog';

/**
 * The commercial plan catalogue.
 *
 * This screen used to lie in three places at once, and together they produced
 * the reported bug -- "when the plan is created i can not delete or edit once
 * its created". It could not be edited because there was no edit; it could not
 * be deleted because there was no delete; and often it had never been created
 * at all:
 *
 *   - the initial state was four invented plans, so the catalogue looked
 *     populated before a single request had been made;
 *   - a failed load fell back to those same four, so a broken endpoint looked
 *     exactly like a working one;
 *   - and a failed create was swallowed by `catch {}` and then appended to the
 *     list locally with a made-up `PLAN-${Date.now()}` id, so the plan appeared
 *     on screen, survived until the next refresh, and existed nowhere.
 *
 * A plan the server rejected cannot be edited or deleted afterwards because
 * there is nothing there to edit or delete. All three are gone: the list starts
 * empty, a failed load says so, and a failed create shows the server's reason
 * and adds nothing.
 */

interface Plan {
  id: string;
  name: string;
  priceMonthly: number;
  maxUsers: number;
  features: string;
}

const BLANK = { name: '', priceMonthly: 3000, maxUsers: 50, frameworksCount: 3, storageGb: 100 };

const PlansCatalogue: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState(BLANK);
  const [formErr, setFormErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /**
   * Set when the server refuses a price change because tenants are on the plan.
   * Holds the refusal so the dialog can ask once, with the number in it, rather
   * than warning on every edit regardless of whether anyone is subscribed.
   */
  const [repricing, setRepricing] = useState<{ message: string; affected: number } | null>(null);

  const [removing, setRemoving] = useState<Plan | null>(null);
  const [removeErr, setRemoveErr] = useState('');

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/billing/plans');
      setPlans(res.data?.plans || []);
    } catch (err) {
      // Says the catalogue could not be read. It does not substitute a
      // plausible one -- an operator pricing a deal off invented figures is a
      // worse outcome than an empty screen.
      setError(apiError(err, 'Could not load the plan catalogue.'));
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  const parseFeatures = (featuresJson: string) => {
    try { return JSON.parse(featuresJson || '{}'); } catch { return {}; }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(BLANK);
    setFormErr('');
    setRepricing(null);
    setModalOpen(true);
  };

  const openEdit = (p: Plan) => {
    const f = parseFeatures(p.features);
    setEditing(p);
    setForm({
      name: p.name,
      priceMonthly: Number(p.priceMonthly),
      maxUsers: p.maxUsers,
      frameworksCount: f.frameworks ?? 1,
      storageGb: f.storageGb ?? 10,
    });
    setFormErr('');
    setRepricing(null);
    setModalOpen(true);
  };

  const submit = async (e: React.FormEvent, confirmRepricing = false) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    setFormErr('');
    const body = {
      name: form.name.trim(),
      priceMonthly: form.priceMonthly,
      maxUsers: form.maxUsers,
      features: { frameworks: form.frameworksCount, storageGb: form.storageGb },
      ...(confirmRepricing ? { confirmRepricing: true } : {}),
    };
    try {
      if (editing) {
        await apiClient.patch(`/api/billing/plans/${editing.id}`, body);
        setNotice(`Plan "${form.name.trim()}" updated.`);
      } else {
        await apiClient.post('/api/billing/plans', body);
        setNotice(`Plan "${form.name.trim()}" added to the catalogue.`);
      }
      setModalOpen(false);
      setEditing(null);
      setRepricing(null);
      await loadPlans();
    } catch (err: any) {
      // Repricing a plan people are already paying for is a deliberate act, so
      // the server asks rather than refuses outright. Everything else is an
      // error the operator has to see and fix.
      if (err?.response?.data?.code === 'PLAN_HAS_SUBSCRIBERS') {
        setRepricing({
          message: err.response.data.message,
          affected: err.response.data.affectedSubscriptions ?? 0,
        });
      } else {
        setFormErr(apiError(err, editing ? 'Could not update the plan' : 'Could not create the plan'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setSubmitting(true);
    setRemoveErr('');
    try {
      const res = await apiClient.delete(`/api/billing/plans/${removing.id}`);
      setRemoving(null);
      setNotice(res.data?.message || 'Plan removed.');
      await loadPlans();
    } catch (err) {
      setRemoveErr(apiError(err, 'Could not remove the plan'));
    } finally {
      setSubmitting(false);
    }
  };

  const field = (labelText: string, value: number | string, onChange: (v: string) => void, type = 'number', placeholder?: string) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>{labelText}</label>
      <input
        type={type}
        required={type === 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={S.input}
      />
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Plans &amp; Commercial Catalogue</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Approved commercial packages, rate cards, quotas, discounts and minimum advertised pricing.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={openCreate} style={primaryBtn()}>+ Create Commercial Plan</button>
          <button onClick={loadPlans} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Plan tiers', plans.length],
        ['Billing cycle', 'Annual & monthly'],
        ['Tax rate', '15% Saudi VAT'],
        ['Quota enforcement', 'Hard stop'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12, display: 'flex', gap: 10 }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} style={{ ...ghostBtn, marginLeft: 'auto', padding: '0 8px' }}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading the plan catalogue…</div>
      ) : plans.length === 0 && !error ? (
        <div style={{ ...S.card, padding: 30, textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
          No plans in the catalogue yet. Create one and it becomes available for tenants to
          subscribe to.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
          {plans.map((p) => {
            const f = parseFeatures(p.features);
            return (
              <div key={p.id} style={{ ...S.card, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>{p.name}</h3>
                    <span style={pill('var(--success)', 'var(--success-line)')}>Active</span>
                  </div>
                  <div style={{ fontSize: 22, color: 'var(--info)', fontWeight: 700, marginBottom: 4 }}>
                    SAR {Number(p.priceMonthly).toLocaleString()}
                    <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 400 }}>/mo</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 14 }}>Excluding 15% VAT</div>

                  <div style={{ background: 'var(--surface)', padding: 12, borderRadius: 6, border: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-body)', display: 'grid', gap: 6 }}>
                    <div><Icon name="teams" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Named users: <strong style={{ color: 'var(--ink)' }}>{p.maxUsers}</strong></div>
                    <div>§ Enabled frameworks: <strong style={{ color: 'var(--ink)' }}>{f.frameworks || 1}</strong></div>
                    <div><Icon name="install" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Encrypted storage: <strong style={{ color: 'var(--ink)' }}>{f.storageGb || 10} GB</strong></div>
                    {f.aiCredits && <div>✦ AI RAG credits: <strong style={{ color: 'var(--info)' }}>{f.aiCredits.toLocaleString()}</strong></div>}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 14, display: 'flex', gap: 8 }}>
                  <button onClick={() => openEdit(p)} style={{ ...ghostBtn, flex: 1, fontSize: 11 }}>Edit</button>
                  {/* Offered on every plan. Whether tenants are subscribed is not
                      on this card, and the server's refusal names the number —
                      guessing here would give two places that can disagree. */}
                  <button
                    onClick={() => { setRemoveErr(''); setRemoving(p); }}
                    style={{ ...ghostBtn, flex: 1, fontSize: 11, color: 'var(--danger)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 460, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--ink)' }}>
              {editing ? `Edit ${editing.name}` : 'Add commercial plan tier'}
            </h3>

            {formErr && <div style={S.error}>{formErr}</div>}

            {repricing && (
              <div style={{
                background: 'var(--warning-bg)', border: '1px solid var(--warning-line)',
                borderRadius: 6, padding: 12, marginBottom: 14, fontSize: 12.5,
                color: 'var(--warning)', lineHeight: 1.6,
              }}>
                {repricing.message}
                <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={(e) => submit(e as any, true)}
                    style={{ ...primaryBtn(submitting), background: 'var(--warning)', borderColor: 'var(--warning)' }}
                  >
                    {submitting ? 'Saving…' : `Reprice ${repricing.affected} subscription${repricing.affected === 1 ? '' : 's'}`}
                  </button>
                  <button type="button" onClick={() => setRepricing(null)} style={ghostBtn}>
                    Leave the price alone
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={(e) => submit(e)}>
              {field('Plan name', form.name, (v) => setForm({ ...form, name: v }), 'text', 'e.g. Enterprise Intelligence Plus')}
              {field('Monthly price (SAR)', form.priceMonthly, (v) => setForm({ ...form, priceMonthly: Number(v) }))}
              {field('Max named users', form.maxUsers, (v) => setForm({ ...form, maxUsers: Number(v) }))}
              {field('Frameworks quota', form.frameworksCount, (v) => setForm({ ...form, frameworksCount: Number(v) }))}
              {field('Storage quota (GB)', form.storageGb, (v) => setForm({ ...form, storageGb: Number(v) }))}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => { setModalOpen(false); setEditing(null); setRepricing(null); }}
                  style={ghostBtn}
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting} style={primaryBtn(submitting)}>
                  {submitting ? 'Saving…' : editing ? 'Save plan' : 'Create plan tier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title={`Delete ${removing.name}?`}
          destructive
          confirmLabel="Delete plan"
          busy={submitting}
          message={(
            <>
              <div>
                <strong style={{ color: 'var(--ink)' }}>{removing.name}</strong> at SAR{' '}
                {Number(removing.priceMonthly).toLocaleString()}/mo will be removed from the
                catalogue.
              </div>
              <div style={{ marginTop: 10, color: 'var(--ink-muted)' }}>
                A plan any tenant has ever been billed under cannot be removed — the invoices
                would stop explaining themselves. Move those tenants to another plan first.
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

export default PlansCatalogue;
