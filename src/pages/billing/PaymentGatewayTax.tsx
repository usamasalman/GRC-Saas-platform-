import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';

interface GatewayConfig {
  provider: string;
  environment: string;
  vatRatePercent: number;
  currency: string;
  threeDSecureRequired: boolean;
  autoRetryDays: number;
  invoiceSequencePrefix: string;
  zatcaPhase2Enabled: boolean;
  status: string;
}

const PaymentGatewayTax: React.FC = () => {
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Form State
  const [vatRate, setVatRate] = useState(15);
  const [threeDSecure, setThreeDSecure] = useState(true);
  const [retryDays, setRetryDays] = useState(3);
  const [updating, setUpdating] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/billing/gateway-config');
      const cfg = res.data?.config;
      if (cfg) {
        setConfig(cfg);
        setVatRate(cfg.vatRatePercent);
        setThreeDSecure(cfg.threeDSecureRequired);
        setRetryDays(cfg.autoRetryDays);
      }
    } catch (err: any) {
      setError(apiError(err, 'Failed to load payment gateway config'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);
    try {
      const res = await apiClient.patch('/api/billing/gateway-config', {
        vatRatePercent: vatRate,
        threeDSecureRequired: threeDSecure,
        autoRetryDays: retryDays
      });
      setNotice(res.data?.message || 'Payment gateway configuration saved.');
      await loadConfig();
    } catch (err: any) {
      alert(apiError(err, 'Failed to update gateway config'));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Payment Gateway, Tax &amp; Settlement</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Configure tokenized payment providers, corporate IBAN transfers, 15% Saudi VAT rules, ZATCA E-Invoicing and retry policies.
          </p>
        </div>
        <button onClick={loadConfig} style={ghostBtn}>↻ Refresh Configuration</button>
      </div>

      <StatStrip items={[
        ['Gateway Status', <span style={{ color: '#86efac' }}>Healthy (Active)</span>],
        ['Hosting Region', 'OCI Riyadh (KSA)'],
        ['Saudi VAT Rate', `${vatRate}%`],
        ['ZATCA Phase 2', 'ECDSA Cleared'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading gateway parameters...</div>
      ) : config && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 16 }}>
          <div style={{ ...S.card, padding: 20 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, color: '#f1f5f9' }}>Gateway &amp; Security Settings</h3>
            <form onSubmit={handleUpdateConfig}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Primary Provider</label>
                <input type="text" disabled value={config.provider} style={{ ...S.input, background: '#090d16', color: '#64748b' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Saudi VAT Rate (%)</label>
                <input
                  type="number"
                  value={vatRate}
                  onChange={(e) => setVatRate(Number(e.target.value))}
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Failed Payment Auto-Retry (Days)</label>
                <input
                  type="number"
                  value={retryDays}
                  onChange={(e) => setRetryDays(Number(e.target.value))}
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  id="3ds"
                  checked={threeDSecure}
                  onChange={(e) => setThreeDSecure(e.target.checked)}
                />
                <label htmlFor="3ds" style={{ fontSize: 12, color: '#cbd5e1' }}>Enforce 3-D Secure Authentication</label>
              </div>

              <button type="submit" disabled={updating} style={primaryBtn(updating)}>
                {updating ? 'Saving...' : 'Save Configuration'}
              </button>
            </form>
          </div>

          <div style={{ ...S.card, padding: 20 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, color: '#f1f5f9' }}>ZATCA E-Invoicing &amp; Compliance</h3>
            <div style={{ background: '#0b1220', padding: 12, borderRadius: 6, border: '1px solid #1e293b', marginBottom: 12, fontSize: 12, color: '#cbd5e1' }}>
              <div>• Environment: <strong style={{ color: '#86efac' }}>{config.environment}</strong></div>
              <div>• Sequence Prefix: <strong style={{ color: '#38bdf8' }}>{config.invoiceSequencePrefix}</strong></div>
              <div>• Cryptographic Algorithm: <strong style={{ color: '#a5f3fc' }}>ECDSA secp256k1</strong></div>
              <div>• Data Residency: <strong style={{ color: '#86efac' }}>Oracle Cloud Infrastructure — Riyadh</strong></div>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
              All generated invoices automatically embed ZATCA Phase 2 XML payload structure, TLV Base64 QR code data, and cryptographic signature hashes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentGatewayTax;
