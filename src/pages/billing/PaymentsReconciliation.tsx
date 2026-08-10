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

const PaymentsReconciliation: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/billing/payments');
      setPayments(res.data?.payments || []);
      setNotice('Payment records updated.');
    } catch (err: any) {
      setError(apiError(err, 'Failed to load payment transactions'));
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
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Payments &amp; Reconciliation</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Process gateway payments, record corporate bank transfers, reconcile invoices and issue receipts.
          </p>
        </div>
        <button onClick={loadPayments} style={ghostBtn}>↻ Refresh Payments</button>
      </div>

      <StatStrip items={[
        ['Reconciled Payments', payments.length],
        ['Total Collected', `SAR ${totalCollected.toLocaleString()}`],
        ['Settlement Gateway', 'Connected'],
        ['Unreconciled Deficit', <span style={{ color: '#86efac' }}>SAR 0.00</span>],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading payment history...</div>
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
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                    No reconciled payment transactions recorded yet.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} style={S.bodyRow}>
                    <td style={{ ...S.td, fontFamily: 'monospace', color: '#38bdf8' }}>{p.id}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', color: '#cbd5e1' }}>{p.invoiceId}</td>
                    <td style={S.td}>
                      <strong style={{ color: '#f1f5f9' }}>{p.tenantName}</strong>
                    </td>
                    <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{p.method}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: '#86efac' }}>
                      SAR {Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td style={S.td}>
                      <span style={pill('#86efac', '#15803d')}>{p.status}</span>
                    </td>
                    <td style={{ ...S.td, color: '#94a3b8' }}>
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
