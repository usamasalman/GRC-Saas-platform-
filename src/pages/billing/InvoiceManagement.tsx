import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';

/**
 * Invoices, as the server has them.
 *
 * This screen used to invent them. Three invoices were hardcoded as the initial
 * state -- one of them billed to "Al-Rajhi Holding Group" for SAR 215,625 --
 * and the loader kept them whenever the API returned an empty list, which it
 * does correctly for any tenant with no invoices. So a branch user at one
 * organisation was shown another organisation's billing.
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

interface Invoice {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  status: string;
  zatcaHash?: string;
  zatcaQr?: string;
  isCleared: boolean;
  createdAt: string;
  tenant?: { id: string; name: string };
}

const InvoiceManagement: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [genModalOpen, setGenModalOpen] = useState(false);
  const [amount, setAmount] = useState(60000);
  const [poNumber, setPoNumber] = useState('');
  const [generating, setGenerating] = useState(false);
  const [formErr, setFormErr] = useState('');

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/billing/invoices');
      // An empty list is an answer, not a failure. Substituting rows here is
      // what showed one tenant another tenant's invoices.
      setInvoices(res.data?.invoices || []);
    } catch (err) {
      setError(apiError(err, 'Could not load invoices.'));
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || generating) return;
    setGenerating(true);
    setFormErr('');
    try {
      const res = await apiClient.post('/api/billing/invoices', {
        amount,
        poNumber: poNumber.trim() || undefined,
      });
      setGenModalOpen(false);
      setNotice(res.data?.message || 'Invoice generated.');
      // The invoice, its reference and its totals are the server's to issue.
      // Reload rather than guess at any of them.
      await loadInvoices();
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
      setNotice(res.data?.message || `Invoice ${inv.id} recorded as paid.`);
      await loadInvoices();
    } catch (err) {
      setError(apiError(err, 'Could not record the payment.'));
    }
  };

  const paidCount = invoices.filter((i) => i.status === 'PAID').length;
  const unpaidCount = invoices.filter((i) => i.status === 'UNPAID').length;
  const totalInvoiced = invoices.reduce((acc, i) => acc + Number(i.amount || 0), 0);

  const money = (n: number) =>
    Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Invoice Management</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Tax invoices, clearing status and payment reconciliation.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setFormErr(''); setGenModalOpen(true); }} style={primaryBtn()}>
            + Generate Tax Invoice
          </button>
          <button onClick={loadInvoices} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Invoices', invoices.length],
        ['Paid', <span style={{ color: 'var(--success)' }}>{paidCount}</span>],
        ['Pending payment', <span style={{ color: 'var(--warning)' }}>{unpaidCount}</span>],
        ['Total invoiced', `SAR ${money(totalInvoiced)}`],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12, display: 'flex', gap: 10 }}>
          <span>{notice}</span>
          <button onClick={() => setNotice('')} style={{ ...ghostBtn, marginLeft: 'auto', padding: '0 8px' }}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading invoices…</div>
      ) : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Invoice</th>
                <th style={S.th}>Customer tenant</th>
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
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)' }}>
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
                    <td style={{ ...S.td, fontWeight: 600, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>
                      {inv.currency} {money(inv.amount)}
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
      )}

      {genModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 460, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: 'var(--ink)' }}>Generate a tax invoice</h3>

            {formErr && <div style={S.error}>{formErr}</div>}

            <form onSubmit={handleGenerateInvoice}>
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
                {/* The server adds 15% VAT and stores the total, so this preview
                    matches what the invoice will carry. */}
                <div style={{ fontSize: 11, color: 'var(--success)', marginTop: 4 }}>
                  + 15% VAT = <strong>SAR {(amount * 1.15).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</strong>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>
                  PO / contract reference
                </label>
                <input
                  type="text"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="Optional"
                  style={S.input}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setGenModalOpen(false)} style={ghostBtn}>Cancel</button>
                <button type="submit" disabled={generating} style={primaryBtn(generating)}>
                  {generating ? 'Generating…' : 'Generate invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 520, padding: 24 }}>
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
              <div>Issued: <span style={{ color: 'var(--ink-body)' }}>{new Date(selectedInvoice.createdAt).toLocaleDateString()}</span></div>
              <div>Currency: <span style={{ color: 'var(--ink-body)' }}>{selectedInvoice.currency}</span></div>
            </div>

            {/* Labelled for what it is. billingController.createInvoice builds
                the hash as `SHA256-${Date.now().toString(36)}` and the QR as
                base64 of a pipe-delimited string; its own comment calls it a
                mock. Both fields are always populated, so presenting their
                presence as clearing would mark every invoice cleared. */}
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
              <div style={{ fontSize: 16, color: 'var(--ink)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {selectedInvoice.currency} {money(selectedInvoice.amount)}
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
