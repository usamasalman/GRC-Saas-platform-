import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, apiError } from '../iam/iamStyles';

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

/**
 * Payment gateway and tax configuration.
 *
 * This screen used to show a hardcoded configuration -- provider "Saudi Payment
 * Gateway (Tokenized)", environment "Production (OCI Riyadh)", ZATCA phase 2
 * enabled, status "Healthy" -- whenever the API could not be read. An operator
 * had no way to tell a live configuration from an invented one, and the invented
 * one always said everything was fine.
 *
 * Saving was the same shape: the refusal was swallowed and the form's values
 * written into local state with "configuration saved". Tax rate and 3-D Secure
 * are settlement controls; reporting them saved when they were rejected is the
 * worst available outcome.
 */
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
    } catch (err) {
      setError(apiError(err, 'Could not load the gateway configuration.'));
      setConfig(null);
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
    setError('');
    try {
      await apiClient.patch('/api/billing/gateway-config', {
        vatRatePercent: vatRate,
        threeDSecureRequired: threeDSecure,
        autoRetryDays: retryDays,
      });
      setNotice('Payment gateway configuration saved.');
      // Re-read rather than assume the write landed as sent.
      await loadConfig();
    } catch (err) {
      setError(apiError(err, 'Could not save the configuration.'));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Payment Gateway, Tax &amp; Settlement</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Configure tokenized payment providers, corporate IBAN transfers, 15% Saudi VAT rules, ZATCA E-Invoicing and retry policies.
          </p>
        </div>
        <button onClick={loadConfig} style={ghostBtn}>↻ Refresh Configuration</button>
      </div>

      {/* Read from the configuration the server returned. The previous version
          hardcoded "Healthy (Active)" and "ECDSA Cleared", so the screen
          asserted the gateway was up and invoices were cryptographically
          cleared regardless of what was true. */}
      <StatStrip items={[
        ['Gateway status', config
          ? <span style={{ color: config.status === 'Healthy' ? 'var(--success)' : 'var(--warning)' }}>{config.status}</span>
          : '—'],
        ['Environment', config?.environment || '—'],
        ['VAT rate', config ? `${config.vatRatePercent}%` : '—'],
        ['Currency', config?.currency || '—'],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading gateway parameters...</div>
      ) : config && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(330px,1fr))', gap: 16 }}>
          <div style={{ ...S.card, padding: 20 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, color: 'var(--ink)' }}>Gateway &amp; Security Settings</h3>
            <form onSubmit={handleUpdateConfig}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Primary Provider</label>
                <input type="text" disabled value={config.provider} style={{ ...S.input, background: 'var(--surface-sunk)', color: 'var(--ink-muted)' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Saudi VAT Rate (%)</label>
                <input
                  type="number"
                  value={vatRate}
                  onChange={(e) => setVatRate(Number(e.target.value))}
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Failed Payment Auto-Retry (Days)</label>
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
                <label htmlFor="3ds" style={{ fontSize: 12, color: 'var(--ink-body)' }}>Enforce 3-D Secure Authentication</label>
              </div>

              <button type="submit" disabled={updating} style={primaryBtn(updating)}>
                {updating ? 'Saving...' : 'Save Configuration'}
              </button>
            </form>
          </div>

          <div style={{ ...S.card, padding: 20 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, color: 'var(--ink)' }}>ZATCA E-Invoicing &amp; Compliance</h3>
            <div style={{ background: 'var(--surface)', padding: 12, borderRadius: 6, border: '1px solid var(--line)', marginBottom: 12, fontSize: 12, color: 'var(--ink-body)' }}>
              <div>• Environment: <strong style={{ color: 'var(--success)' }}>{config.environment}</strong></div>
              <div>• Sequence Prefix: <strong style={{ color: 'var(--info)' }}>{config.invoiceSequencePrefix}</strong></div>
              <div>• ZATCA phase 2: <strong style={{ color: config.zatcaPhase2Enabled ? 'var(--success)' : 'var(--ink-muted)' }}>
                {config.zatcaPhase2Enabled ? 'Enabled' : 'Not enabled'}
              </strong></div>
            </div>
            {/* Said plainly, because the previous copy claimed the opposite.
                billingController.createInvoice builds the hash as
                `SHA256-${Date.now().toString(36)}` and the QR as base64 of a
                pipe-delimited string — the code's own comment calls it a mock.
                There is no XML payload, no TLV encoding, no ECDSA signature and
                no clearing request. Presenting that as compliance proof is the
                sort of claim a tax authority tests. */}
            <p style={{ margin: 0, fontSize: 12, color: 'var(--warning)', lineHeight: 1.55 }}>
              Invoices currently carry a placeholder reference, not a cleared ZATCA Phase 2
              document. No XML payload is generated, no TLV QR is encoded, nothing is signed and
              nothing is submitted for clearing. Do not rely on these invoices for tax filing
              until a real integration is in place.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentGatewayTax;
