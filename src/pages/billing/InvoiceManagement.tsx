import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';

/**
 * Invoices, as the server has them.
 *
 * This screen used to invent them. A few rows were hardcoded as the initial
 * state and the loader kept them whenever the API returned an empty list, which
 * it does correctly for any tenant with no invoices. So a user at one
 * organisation could see another organisation's billing.
 *
 * Generating was worse. The refusal was swallowed by `catch {}` and a fabricated
 * invoice was appended anyway, carrying a ZATCA hash and QR code built in the
 * browser from Date.now(). Paying did the same: the server refused, the row
 * flipped to PAID locally. That is the answer to the tester who asked why a
 * Group Admin could generate and pay an invoice -- the account could not, and
 * the screen said it had.
 *
 * Nothing here reports an outcome the server did not confirm. Every write
 * reloads from the API, and a refusal is shown with the server's own words.
 */

interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface Invoice {
  id: string;
  tenantId: string;
  amount: number;
  netAmount?: number | null;
  vatAmount?: number | null;
  vatRate?: number | null;
  currency: string;
  status: string;
  subscriptionId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  periodLabel?: string | null;
  poNumber?: string | null;
  lines?: InvoiceLineItem[];
  subscription?: {
    id: string;
    plan?: { id: string; name: string; priceMonthly: number };
  } | null;
  issuedBy?: { id: string; name: string; email: string } | null;
  zatcaHash?: string;
  zatcaQr?: string;
  isCleared: boolean;
  createdAt: string;
  tenant?: { id: string; name: string };
}

interface Ledger {
  invoiced: number;
  paid: number;
  outstanding: number;
  invoiceCount: number;
  unpaidCount: number;
  neverInvoiced: boolean;
}

interface SubscriptionWithLedger {
  id: string;
  tenantId: string;
  status: string;
  startDate: string;
  endDate?: string | null;
  tenant?: { id: string; name: string; type: string };
  plan?: { id: string; name: string; priceMonthly: number; maxUsers: number };
  ledger?: Ledger;
}

interface PreviewDecision {
  period: { start: string; end: string; label: string };
  lines: { description: string; quantity: number; unitPrice: number; amount: number }[];
  totals: { netAmount: number; vatAmount: number; totalAmount: number; vatRate: number };
  months: string[];
}

const QUARTERS = [
  { label: 'Q1 (Jan – Mar)', month: '01' },
  { label: 'Q2 (Apr – Jun)', month: '04' },
  { label: 'Q3 (Jul – Sep)', month: '07' },
  { label: 'Q4 (Oct – Dec)', month: '10' },
];

const InvoiceManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'invoices' | 'subscriptions'>('invoices');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionWithLedger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Generation Modal
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [billingMode, setBillingMode] = useState<'plan' | 'manual'>('plan');
  const [selectedSubId, setSelectedSubId] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedQuarterMonth, setSelectedQuarterMonth] = useState('01');
  const [preview, setPreview] = useState<PreviewDecision | null>(null);
  const [previewErr, setPreviewErr] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Manual fallback inputs
  const [amount, setAmount] = useState(60000);
  const [poNumber, setPoNumber] = useState('');
  const [generating, setGenerating] = useState(false);
  const [formErr, setFormErr] = useState('');

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [invRes, subRes] = await Promise.all([
        apiClient.get('/api/billing/invoices'),
        apiClient.get('/api/billing/subscriptions').catch(() => ({ data: { subscriptions: [] } })),
      ]);
      setInvoices(invRes.data?.invoices || []);
      const subs: SubscriptionWithLedger[] = subRes.data?.subscriptions || [];
      setSubscriptions(subs);
      if (subs.length > 0 && !selectedSubId) {
        setSelectedSubId(subs[0].id);
      }
    } catch (err) {
      setError(apiError(err, 'Could not load billing records.'));
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [selectedSubId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Update preview whenever subscription, year or quarter changes in plan mode
  useEffect(() => {
    if (!genModalOpen || billingMode !== 'plan' || !selectedSubId) {
      setPreview(null);
      return;
    }

    let active = true;
    setPreviewLoading(true);
    setPreviewErr('');

    const anchor = `${selectedYear}-${selectedQuarterMonth}-15`;
    apiClient.post('/api/billing/invoices/preview', {
      subscriptionId: selectedSubId,
      periodKind: 'Quarter',
      anchor,
    }).then((res) => {
      if (active) {
        setPreview(res.data?.decision || null);
        setPreviewErr('');
      }
    }).catch((err) => {
      if (active) {
        setPreview(null);
        setPreviewErr(apiError(err, 'Could not preview invoice for this period.'));
      }
    }).finally(() => {
      if (active) setPreviewLoading(false);
    });

    return () => { active = false; };
  }, [genModalOpen, billingMode, selectedSubId, selectedYear, selectedQuarterMonth]);

  const openGenerateModal = (presetSubId?: string) => {
    setFormErr('');
    setPreviewErr('');
    if (presetSubId) {
      setSelectedSubId(presetSubId);
      setBillingMode('plan');
    } else if (subscriptions.length > 0) {
      setBillingMode('plan');
      if (!selectedSubId) setSelectedSubId(subscriptions[0].id);
    } else {
      setBillingMode('manual');
    }
    setGenModalOpen(true);
  };

  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generating) return;
    setGenerating(true);
    setFormErr('');

    try {
      const payload: Record<string, unknown> = {
        poNumber: poNumber.trim() || undefined,
      };

      if (billingMode === 'plan') {
        if (!selectedSubId) {
          setFormErr('Please select a client subscription.');
          setGenerating(false);
          return;
        }
        payload.subscriptionId = selectedSubId;
        payload.periodKind = 'Quarter';
        payload.anchor = `${selectedYear}-${selectedQuarterMonth}-15`;
      } else {
        if (!amount || amount <= 0) {
          setFormErr('Please enter a valid invoice amount.');
          setGenerating(false);
          return;
        }
        payload.amount = amount;
      }

      const res = await apiClient.post('/api/billing/invoices', payload);
      setGenModalOpen(false);
      setNotice(res.data?.message || 'Invoice generated.');
      await loadData();
    } catch (err) {
      setFormErr(apiError(err, 'Could not generate the invoice.'));
    } finally {
      setGenerating(false);
    }
  };

  const handlePayInvoice = async (inv: Invoice) => {
    setError('');
    try {
      const res = await apiClient.post(`/api/billing/invoices/${inv.id}/pay`);
      setNotice(res.data?.message || `Invoice ${inv.id.slice(0, 8)} recorded as paid.`);
      await loadData();
    } catch (err) {
      setError(apiError(err, 'Could not record the payment.'));
    }
  };

  const paidCount = invoices.filter((i) => i.status === 'PAID').length;
  const unpaidCount = invoices.filter((i) => i.status === 'UNPAID').length;
  const totalInvoiced = invoices.reduce((acc, i) => acc + Number(i.amount || 0), 0);
  const totalOutstanding = subscriptions.reduce((acc, s) => acc + (s.ledger?.outstanding || 0), 0);

  const money = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Invoice Management</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Period invoicing, plan line items and subscription ledger reconciliation.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => openGenerateModal()} style={primaryBtn()}>
            + Generate Tax Invoice
          </button>
          <button onClick={loadData} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Invoices', invoices.length],
        ['Paid', <span style={{ color: 'var(--success)' }}>{paidCount}</span>],
        ['Pending payment', <span style={{ color: 'var(--warning)' }}>{unpaidCount}</span>],
        ['Total invoiced', `SAR ${money(totalInvoiced)}`],
        ['Total outstanding', <span style={{ color: totalOutstanding > 0 ? 'var(--warning)' : 'var(--ink)' }}>SAR {money(totalOutstanding)}</span>],
      ]} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
        <button
          onClick={() => setActiveTab('invoices')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'invoices' ? '2px solid var(--info)' : '2px solid transparent',
            color: activeTab === 'invoices' ? 'var(--ink)' : 'var(--ink-muted)',
            fontWeight: activeTab === 'invoices' ? 600 : 400,
            padding: '8px 14px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          All Invoices ({invoices.length})
        </button>
        <button
          onClick={() => setActiveTab('subscriptions')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'subscriptions' ? '2px solid var(--info)' : '2px solid transparent',
            color: activeTab === 'subscriptions' ? 'var(--ink)' : 'var(--ink-muted)',
            fontWeight: activeTab === 'subscriptions' ? 600 : 400,
            padding: '8px 14px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Subscriptions Ledger (Paid vs. Outstanding)
        </button>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12, display: 'flex', gap: 10 }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} style={{ ...ghostBtn, marginLeft: 'auto', padding: '0 8px' }}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading billing records…</div>
      ) : activeTab === 'invoices' ? (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Invoice</th>
                <th style={S.th}>Customer tenant</th>
                <th style={S.th}>Period / Plan</th>
                <th style={S.th}>Total (incl. 15% VAT)</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Clearing</th>
                <th style={S.th}>Issued</th>
                <th style={S.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    No invoices in your scope.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} style={S.bodyRow}>
                    <td style={{ ...S.td, fontFamily: 'ui-monospace, monospace', color: 'var(--info)' }}>
                      {inv.id.slice(0, 8)}
                    </td>
                    <td style={S.td}>
                      <strong style={{ color: 'var(--ink)' }}>{inv.tenant?.name || '—'}</strong>
                    </td>
                    <td style={S.td}>
                      {inv.periodLabel ? (
                        <div>
                          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{inv.periodLabel}</span>
                          {inv.subscription?.plan && (
                            <span style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block' }}>
                              {inv.subscription.plan.name}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--ink-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ ...S.td, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                      {inv.currency} {money(inv.amount)}
                      {inv.lines && inv.lines.length > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--ink-muted)', fontWeight: 400, display: 'block' }}>
                          {inv.lines.length} line item{inv.lines.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </td>
                    <td style={S.td}>
                      <span style={inv.status === 'PAID'
                        ? pill('var(--success)', 'var(--success-line)')
                        : pill('var(--warning)', 'var(--warning-line)')}>
                        {inv.status}
                      </span>
                    </td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11, color: inv.isCleared ? 'var(--success)' : 'var(--ink-muted)' }}>
                        {inv.isCleared ? 'Marked cleared' : 'Not cleared'}
                      </span>
                    </td>
                    <td style={{ ...S.td, color: 'var(--ink-muted)' }}>
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setSelectedInvoice(inv)} style={{ ...ghostBtn, fontSize: 11, padding: '4px 8px' }}>
                          View
                        </button>
                        {inv.status !== 'PAID' && (
                          <button onClick={() => handlePayInvoice(inv)} style={{ ...primaryBtn(), fontSize: 11, padding: '4px 8px' }}>
                            Record payment
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Subscriptions Ledger View (Paid vs Outstanding) */
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Customer</th>
                <th style={S.th}>Plan</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Invoiced</th>
                <th style={S.th}>Paid</th>
                <th style={S.th}>Outstanding</th>
                <th style={S.th}>Invoices</th>
                <th style={S.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    No subscriptions in your scope.
                  </td>
                </tr>
              ) : (
                subscriptions.map((sub) => {
                  const l = sub.ledger || { invoiced: 0, paid: 0, outstanding: 0, invoiceCount: 0, unpaidCount: 0, neverInvoiced: true };
                  return (
                    <tr key={sub.id} style={S.bodyRow}>
                      <td style={S.td}>
                        <strong style={{ color: 'var(--ink)' }}>{sub.tenant?.name || '—'}</strong>
                      </td>
                      <td style={S.td}>
                        <span style={{ color: 'var(--ink)' }}>{sub.plan?.name || '—'}</span>
                        {sub.plan && (
                          <span style={{ fontSize: 11, color: 'var(--ink-muted)', display: 'block' }}>
                            SAR {money(sub.plan.priceMonthly)} / mo
                          </span>
                        )}
                      </td>
                      <td style={S.td}>
                        <span style={sub.status === 'ACTIVE'
                          ? pill('var(--success)', 'var(--success-line)')
                          : pill('var(--ink-muted)', 'var(--line)')}>
                          {sub.status}
                        </span>
                      </td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>
                        SAR {money(l.invoiced)}
                      </td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', color: 'var(--success)' }}>
                        SAR {money(l.paid)}
                      </td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: l.outstanding > 0 ? 'var(--warning)' : 'var(--ink)' }}>
                        SAR {money(l.outstanding)}
                      </td>
                      <td style={S.td}>
                        {l.neverInvoiced ? (
                          <span style={{ fontSize: 11, color: 'var(--warning)' }}>Never billed</span>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--ink-body)' }}>
                            {l.invoiceCount} ({l.unpaidCount} unpaid)
                          </span>
                        )}
                      </td>
                      <td style={S.td}>
                        {sub.status === 'ACTIVE' && (
                          <button
                            onClick={() => openGenerateModal(sub.id)}
                            style={{ ...primaryBtn(), fontSize: 11, padding: '4px 8px' }}
                          >
                            Bill for period
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Generate Tax Invoice Modal */}
      {genModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 520, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--ink)' }}>Generate a tax invoice</h3>

            {/* Mode selection */}
            {subscriptions.length > 0 && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => setBillingMode('plan')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: billingMode === 'plan' ? '2px solid var(--info)' : '1px solid var(--line)',
                    background: billingMode === 'plan' ? 'var(--surface-sunk)' : 'var(--surface)',
                    color: billingMode === 'plan' ? 'var(--ink)' : 'var(--ink-muted)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Bill Subscription (Plan Lines)
                </button>
                <button
                  type="button"
                  onClick={() => setBillingMode('manual')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: billingMode === 'manual' ? '2px solid var(--info)' : '1px solid var(--line)',
                    background: billingMode === 'manual' ? 'var(--surface-sunk)' : 'var(--surface)',
                    color: billingMode === 'manual' ? 'var(--ink)' : 'var(--ink-muted)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Custom Manual Amount
                </button>
              </div>
            )}

            {formErr && <div style={{ ...S.error, marginBottom: 12 }}>{formErr}</div>}

            <form onSubmit={handleGenerateInvoice}>
              {billingMode === 'plan' ? (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>
                      Client & Subscription
                    </label>
                    <select
                      value={selectedSubId}
                      onChange={(e) => setSelectedSubId(e.target.value)}
                      style={S.input}
                      required
                    >
                      {subscriptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.tenant?.name || 'Unknown'} — {s.plan?.name || 'No Plan'} ({s.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>
                        Billing Period
                      </label>
                      <select
                        value={selectedQuarterMonth}
                        onChange={(e) => setSelectedQuarterMonth(e.target.value)}
                        style={S.input}
                      >
                        {QUARTERS.map((q) => (
                          <option key={q.month} value={q.month}>{q.label}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ width: 110 }}>
                      <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>
                        Year
                      </label>
                      <select
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(Number(e.target.value))}
                        style={S.input}
                      >
                        {[2025, 2026, 2027].map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Plan Lines Preview */}
                  <div style={{ background: 'var(--surface-sunk)', padding: 12, borderRadius: 8, border: '1px solid var(--line)', marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Invoice Lines (Derived from Plan)
                    </div>
                    {previewLoading ? (
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Calculating plan lines…</div>
                    ) : previewErr ? (
                      <div style={{ fontSize: 12, color: 'var(--danger)' }}>{previewErr}</div>
                    ) : preview ? (
                      <div>
                        {preview.lines.map((l, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                            <span style={{ color: 'var(--ink)' }}>{l.description}</span>
                            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>SAR {money(l.amount)}</span>
                          </div>
                        ))}
                        <div style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 6, fontSize: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-muted)', marginBottom: 2 }}>
                            <span>Net subtotal</span>
                            <span>SAR {money(preview.totals.netAmount)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-muted)', marginBottom: 4 }}>
                            <span>VAT ({preview.totals.vatRate * 100}%)</span>
                            <span>SAR {money(preview.totals.vatAmount)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>
                            <span>Total payable</span>
                            <span style={{ color: 'var(--success)' }}>SAR {money(preview.totals.totalAmount)}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>No preview available.</div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>
                    Subtotal (SAR, excluding VAT)
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    style={S.input}
                  />
                  <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
                    + 15% VAT = <strong>SAR {(amount * 1.15).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</strong>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>
                  PO / contract reference (optional)
                </label>
                <input
                  type="text"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="e.g. PO-2026-0042"
                  style={S.input}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setGenModalOpen(false)} style={ghostBtn}>Cancel</button>
                <button
                  type="submit"
                  disabled={generating || (billingMode === 'plan' && (!preview || !!previewErr))}
                  style={primaryBtn(generating || (billingMode === 'plan' && (!preview || !!previewErr)))}
                >
                  {generating ? 'Generating…' : 'Generate invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Invoice Modal */}
      {selectedInvoice && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 540, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>Tax invoice</h3>
                <div style={{ fontSize: 12, color: 'var(--info)', fontFamily: 'ui-monospace, monospace' }}>
                  {selectedInvoice.id}
                </div>
              </div>
              <span style={selectedInvoice.status === 'PAID'
                ? pill('var(--success)', 'var(--success-line)')
                : pill('var(--warning)', 'var(--warning-line)')}>
                {selectedInvoice.status}
              </span>
            </div>

            <div style={{ background: 'var(--surface)', padding: 12, borderRadius: 6, border: '1px solid var(--line)', marginBottom: 14, fontSize: 12 }}>
              <div>Customer: <strong style={{ color: 'var(--ink)' }}>{selectedInvoice.tenant?.name || '—'}</strong></div>
              {selectedInvoice.periodLabel && (
                <div>Period: <strong style={{ color: 'var(--ink)' }}>{selectedInvoice.periodLabel}</strong></div>
              )}
              {selectedInvoice.subscription?.plan && (
                <div>Plan: <span style={{ color: 'var(--ink-body)' }}>{selectedInvoice.subscription.plan.name}</span></div>
              )}
              {selectedInvoice.poNumber && (
                <div>PO Ref: <span style={{ color: 'var(--ink-body)' }}>{selectedInvoice.poNumber}</span></div>
              )}
              <div>Issued: <span style={{ color: 'var(--ink-body)' }}>{new Date(selectedInvoice.createdAt).toLocaleDateString()}</span></div>
              <div>Currency: <span style={{ color: 'var(--ink-body)' }}>{selectedInvoice.currency}</span></div>
            </div>

            {/* Line items if present */}
            {selectedInvoice.lines && selectedInvoice.lines.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>Line Items</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, border: '1px solid var(--line)' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-sunk)', borderBottom: '1px solid var(--line)' }}>
                      <th style={{ ...S.th, padding: '6px 8px' }}>Description</th>
                      <th style={{ ...S.th, padding: '6px 8px', textAlign: 'right' }}>Qty</th>
                      <th style={{ ...S.th, padding: '6px 8px', textAlign: 'right' }}>Unit Price</th>
                      <th style={{ ...S.th, padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.lines.map((l) => (
                      <tr key={l.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '6px 8px', color: 'var(--ink)' }}>{l.description}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--ink-body)' }}>{l.quantity}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--ink-body)' }}>SAR {money(l.unitPrice)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--ink)' }}>SAR {money(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ background: 'var(--surface-sunk)', padding: 12, borderRadius: 6, border: '1px solid var(--warning-line)', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 6, fontWeight: 600 }}>
                PLACEHOLDER REFERENCE — NOT A CLEARED ZATCA DOCUMENT
              </div>
              {selectedInvoice.zatcaHash && (
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all', marginBottom: 6 }}>
                  {selectedInvoice.zatcaHash}
                </div>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
                Nothing has been signed or submitted to ZATCA for this invoice.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                {selectedInvoice.netAmount !== null && selectedInvoice.netAmount !== undefined && (
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                    Net: SAR {money(selectedInvoice.netAmount)} + 15% VAT: SAR {money(selectedInvoice.vatAmount || 0)}
                  </div>
                )}
                <div style={{ fontSize: 16, color: 'var(--ink)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {selectedInvoice.currency} {money(selectedInvoice.amount)}
                </div>
              </div>
              <button onClick={() => setSelectedInvoice(null)} style={primaryBtn()}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceManagement;
