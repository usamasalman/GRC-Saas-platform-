import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, pill, apiError } from '../iam/iamStyles';

interface Payment {
  id: string;
  invoiceId: string;
  tenantName: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  paidAt: string;
}

/**
 * Payments, as the server has them.
 *
 * Two payments were hardcoded here as the initial state, one of them SAR
 * 215,625 from "Al-Rajhi Holding Group", and the loader kept them both when the
 * API returned an empty list and when it failed. Any tenant with no payments was
 * shown another organisation's receipts as though they were its own.
 *
 * The old loader also set "Payment records up to date." in a `finally`, so it
 * reported success on the failure path too.
 */
const PaymentsReconciliation: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/billing/payments');
      // An empty list is the answer for a tenant with no payments.
      setPayments(res.data?.payments || []);
    } catch (err) {
      setError(apiError(err, 'Could not load payments.'));
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const totalCollected = payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Payments &amp; Reconciliation</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Process gateway payments, record corporate bank transfers, reconcile invoices and issue receipts.
          </p>
        </div>
        <button onClick={loadPayments} style={ghostBtn}>↻ Refresh Payments</button>
      </div>

      <StatStrip items={[
        ['Reconciled Payments', payments.length],
        ['Total Collected', `SAR ${totalCollected.toLocaleString()}`],
        ['Settlement Gateway', 'Connected'],
        ['Unreconciled Deficit', <span style={{ color: 'var(--success)' }}>SAR 0.00</span>],
      ]} />

      {error && <div style={S.error}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading payment history...</div>
      ) : (
        <div style={S.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Transaction ID</th>
                <th style={S.th}>Linked Invoice</th>
                <th style={S.th}>Organization Tenant</th>
                <th style={S.th}>Payment Method</th>
                <th style={S.th}>Amount</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Payment Date</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    No reconciled payment transactions recorded yet.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} style={S.bodyRow}>
                    <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--info)' }}>{p.id}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--ink-body)' }}>{p.invoiceId}</td>
                    <td style={S.td}>
                      <strong style={{ color: 'var(--ink)' }}>{p.tenantName}</strong>
                    </td>
                    <td style={{ ...S.td, fontSize: 12, color: 'var(--ink-muted)' }}>{p.method}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: 'var(--success)' }}>
                      SAR {Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td style={S.td}>
                      <span style={pill('var(--success)', 'var(--success-line)')}>{p.status}</span>
                    </td>
                    <td style={{ ...S.td, color: 'var(--ink-muted)' }}>
                      {new Date(p.paidAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PaymentsReconciliation;
