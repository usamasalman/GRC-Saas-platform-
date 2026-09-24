import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, pill, apiError } from '../iam/iamStyles';

interface OpenDefect { id: string; severity: string; title: string }

interface ComplianceCert {
  cert: string;
  status: string;
  authority: string;
  openDefects: OpenDefect[];
}

interface AvailabilityDomain {
  ad: string;
  status: string;
  role: string;
}

interface InfraLayer {
  layer: string;
  tech: string;
  status: string;
  details: string;
}

interface ArchData {
  kind: 'target';
  statement: string;
  region: string;
  dataResidency: string;
  residency: { status: string; openDefects: OpenDefect[] };
  compliance: ComplianceCert[];
  availabilityDomains: AvailabilityDomain[];
  infrastructureLayers: InfraLayer[];
  metrics: { rpoSeconds: string; rtoMinutes: string; latencyInternalMs: string };
}

/**
 * The intended OCI Riyadh architecture, shown as intended.
 *
 * This page presented the target as the running deployment — both Riyadh
 * domains ACTIVE, every layer Healthy, "100% KSA Sovereign", ZATCA and CITC
 * Certified — and when the server could not be reached it drew the same
 * picture from a copy held here. The deployment is one Contabo server, and the
 * register holds open High defects against residency, ZATCA and PDPL. Nothing
 * here is measured, so nothing here is shown as running or held: statuses are
 * the server's, open defects are named, and a failed load says so (QA-028).
 */
const OciRiyadhArchitecture: React.FC = () => {
  const [arch, setArch] = useState<ArchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadArch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/system/architecture');
      setArch(res.data?.status === 'success' ? res.data.architecture : null);
      if (res.data?.status !== 'success') setError('The architecture could not be read.');
    } catch (err) {
      setArch(null);
      setError(apiError(err, 'The architecture could not be read.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadArch(); }, [loadArch]);

  const dash = '—';
  const statusPill = (status: string, defects: OpenDefect[] = []) => (defects.length > 0
    ? pill('var(--warning)', 'var(--warning-line)')
    : status === 'Verified'
      ? pill('var(--success)', 'var(--success-line)')
      : pill('var(--ink-muted)', 'var(--line)'));
  const defectLines = (defects: OpenDefect[]) => defects.map((d) => (
    <div key={d.id} style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>
      {d.id} ({d.severity}): {d.title}
    </div>
  ));

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>OCI Riyadh Target Architecture</h2>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>The intended Kingdom of Saudi Arabia deployment, and what is known against it</div>
        </div>
        <button style={ghostBtn} onClick={loadArch} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {arch && (
        <div style={{ ...S.card, padding: 14, marginBottom: 18, fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.6 }}>
          {arch.statement}
        </div>
      )}

      <StatStrip items={[
        ['Target region', arch ? arch.region : dash],
        ['Data residency', arch ? arch.residency.status : dash],
        ['Recovery point', arch ? arch.metrics.rpoSeconds : dash],
        ['Recovery time', arch ? arch.metrics.rtoMinutes : dash],
      ]} />

      {arch && arch.residency.openDefects.length > 0 && (
        <div style={{ ...S.card, padding: 14, marginBottom: 18 }}>
          <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{arch.dataResidency}: {arch.residency.status}</strong>
          {defectLines(arch.residency.openDefects)}
        </div>
      )}

      {arch && (
        <>
          <h3 style={{ margin: '20px 0 10px', fontSize: 15, color: 'var(--ink)' }}>Availability domains</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 24 }}>
            {arch.availabilityDomains.map((ad) => (
              <div key={ad.ad} style={{ ...S.card, padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{ad.ad}</strong>
                  <span style={statusPill(ad.status)}>{ad.status}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{ad.role}</div>
              </div>
            ))}
          </div>

          <h3 style={{ margin: '20px 0 10px', fontSize: 15, color: 'var(--ink)' }}>Regulatory frameworks</h3>
          <div style={{ ...S.card, overflow: 'auto', marginBottom: 24 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={S.headRow}>
                  <th style={S.th}>Framework</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Authority</th>
                </tr>
              </thead>
              <tbody>
                {arch.compliance.map((c) => (
                  <tr key={c.cert} style={S.bodyRow}>
                    <td style={S.td}><strong style={{ color: 'var(--ink-body)' }}>{c.cert}</strong></td>
                    <td style={S.td}>
                      <span style={statusPill(c.status, c.openDefects)}>{c.status}</span>
                      {defectLines(c.openDefects)}
                    </td>
                    <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{c.authority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ margin: '20px 0 10px', fontSize: 15, color: 'var(--ink)' }}>Infrastructure layers</h3>
          <div style={{ ...S.card, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={S.headRow}>
                  <th style={S.th}>Layer</th>
                  <th style={S.th}>Technology</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {arch.infrastructureLayers.map((l) => (
                  <tr key={l.layer} style={S.bodyRow}>
                    <td style={S.td}><strong style={{ color: 'var(--ink-body)' }}>{l.layer}</strong></td>
                    <td style={{ ...S.td, color: 'var(--info)' }}>{l.tech}</td>
                    <td style={S.td}><span style={statusPill(l.status)}>{l.status}</span></td>
                    <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{l.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default OciRiyadhArchitecture;
