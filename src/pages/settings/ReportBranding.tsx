import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../api/apiClient';
import { S, pill, ghostBtn, primaryBtn, apiError } from '../iam/iamStyles';

/**
 * How this organisation's reports are dressed.
 *
 * Two things this screen is careful to show rather than hide:
 *
 *   - what is INHERITED versus what this organisation has set itself. A branch
 *     that leaves a field blank renders under its group's identity, and an
 *     admin who cannot see that will not understand why changing the group
 *     changed their report.
 *   - when a chosen colour is too pale to read as text. It is still accepted —
 *     it is genuinely their brand — but headings fall back to ink, and finding
 *     that out here is better than finding it on a report already sent to a
 *     board.
 */

interface Effective {
  displayName: string;
  brandColour: string;
  textColour: string;
  marking: string;
  footerText: string | null;
  sourceTenantId: string | null;
  isDefault: boolean;
}

interface Branding {
  tenantId: string | null;
  displayName: string | null;
  brandColour: string | null;
  marking: string | null;
  footerText: string | null;
  inheritsFromParent: boolean;
  hasLogo: boolean;
  logoFileName: string | null;
  logoBytes: number | null;
  effective: Effective;
}

const fmtBytes = (n: number | null): string =>
  n === null ? '' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(0)} KB`;

const ReportBranding: React.FC = () => {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [markings, setMarkings] = useState<string[]>([]);
  const [maxLogoBytes, setMaxLogoBytes] = useState(512 * 1024);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [saved, setSaved] = useState('');

  const [form, setForm] = useState({
    displayName: '', brandColour: '', marking: '', footerText: '',
    inheritsFromParent: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/tenants/branding');
      const b: Branding = res.data?.branding;
      setBranding(b);
      setMarkings(res.data?.vocabulary?.markings || []);
      setMaxLogoBytes(res.data?.vocabulary?.maxLogoBytes || 512 * 1024);
      setForm({
        displayName: b?.displayName || '',
        brandColour: b?.brandColour || '',
        marking: b?.marking || '',
        footerText: b?.footerText || '',
        inheritsFromParent: b?.inheritsFromParent ?? true,
      });
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setError('');
    setWarning('');
    setSaved('');
    try {
      const res = await apiClient.patch('/api/tenants/branding', {
        displayName: form.displayName || null,
        brandColour: form.brandColour || null,
        marking: form.marking || undefined,
        footerText: form.footerText || null,
        inheritsFromParent: form.inheritsFromParent,
      });
      setBranding(res.data?.branding);
      if (res.data?.warning) setWarning(res.data.warning);
      setSaved('Saved. New reports will use this.');
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (file: File) => {
    if (file.size > maxLogoBytes) {
      setError(`That logo is ${fmtBytes(file.size)}. The limit is ${fmtBytes(maxLogoBytes)} — `
        + 'it is read on every report render.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const b64: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Could not read that file'));
        r.readAsDataURL(file);
      });
      const res = await apiClient.post('/api/tenants/branding/logo', {
        fileData: b64, fileName: file.name,
      });
      setBranding(res.data?.branding);
      setSaved('Logo stored. It will appear on the cover of new reports.');
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading branding…</div>;
  }

  const eff = branding?.effective;
  const field: React.CSSProperties = { ...S.input, width: '100%', marginTop: 4 };
  const label: React.CSSProperties = { fontSize: 11.5, color: 'var(--ink-muted)' };
  const inheritedNote = (own: any) => (own ? null : (
    <span style={{ fontSize: 11, color: 'var(--ink-faint)', marginLeft: 6 }}>inherited</span>
  ));

  return (
    <div style={{ maxWidth: 780 }}>
      {error && <div style={S.error}>{error}</div>}
      {warning && (
        <div style={{
          ...S.card, padding: '12px 16px', marginBottom: 14,
          borderLeft: '3px solid var(--warning)', color: 'var(--warning)', fontSize: 13,
        }}>
          {warning}
        </div>
      )}
      {saved && (
        <div style={{ fontSize: 12.5, color: 'var(--success)', marginBottom: 12 }}>{saved}</div>
      )}

      {/* ── What a report will actually use ────────────────────────────── */}
      {eff && (
        <div style={{ ...S.card, padding: '16px 18px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 10 }}>
            What your reports use today
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{
              width: 34, height: 34, borderRadius: 6,
              background: eff.brandColour, border: '1px solid var(--line)',
            }} />
            <div>
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{eff.displayName}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', fontVariantNumeric: 'tabular-nums' }}>
                {eff.brandColour}
                {eff.textColour !== eff.brandColour && ' · headings drawn in ink for legibility'}
              </div>
            </div>
            <span style={pill('var(--ink-muted)', 'var(--line)')}>{eff.marking}</span>
            {eff.isDefault && (
              <span style={pill('var(--warning)', 'var(--warning-line)')}>
                Using the platform default
              </span>
            )}
            {!eff.isDefault && eff.sourceTenantId !== branding?.tenantId && (
              <span style={pill('var(--info)', 'var(--info-line)')}>
                Inherited from a parent organisation
              </span>
            )}
          </div>
          {eff.footerText && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 10 }}>
              Footer: {eff.footerText}
            </div>
          )}
        </div>
      )}

      <div style={{ ...S.card, padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <div>
            <span style={label}>Name on reports{inheritedNote(branding?.displayName)}</span>
            <input
              style={field}
              value={form.displayName}
              placeholder={eff?.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>
          <div>
            <span style={label}>Brand colour{inheritedNote(branding?.brandColour)}</span>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                type="color"
                value={form.brandColour || eff?.brandColour || '#0F7A5A'}
                onChange={(e) => setForm({ ...form, brandColour: e.target.value.toUpperCase() })}
                style={{ width: 42, height: 32, padding: 2, border: '1px solid var(--line)', borderRadius: 6 }}
                aria-label="Brand colour"
              />
              <input
                style={{ ...S.input, flex: 1 }}
                value={form.brandColour}
                placeholder={eff?.brandColour}
                onChange={(e) => setForm({ ...form, brandColour: e.target.value })}
              />
            </div>
          </div>
          <div>
            <span style={label}>Confidentiality marking{inheritedNote(branding?.marking)}</span>
            <select
              style={field}
              value={form.marking}
              onChange={(e) => setForm({ ...form, marking: e.target.value })}
            >
              <option value="">Inherit ({eff?.marking})</option>
              {markings.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={label}>Footer text{inheritedNote(branding?.footerText)}</span>
            <input
              style={field}
              value={form.footerText}
              placeholder="Registered in England 12345678"
              onChange={(e) => setForm({ ...form, footerText: e.target.value })}
            />
          </div>
        </div>

        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 16,
          fontSize: 12.5, color: 'var(--ink-body)', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={form.inheritsFromParent}
            onChange={(e) => setForm({ ...form, inheritsFromParent: e.target.checked })}
            style={{ marginTop: 2 }}
          />
          <span>
            Inherit anything left blank from the parent organisation
            <span style={{ display: 'block', color: 'var(--ink-faint)', fontSize: 11.5 }}>
              Turn this off for an entity that must not carry its parent's mark.
              Blank fields then fall to the platform default instead.
            </span>
          </span>
        </label>

        <div style={{ marginTop: 18, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={primaryBtn(busy)} disabled={busy} onClick={save}>Save</button>

          <label style={{ ...ghostBtn, cursor: 'pointer' }}>
            {branding?.hasLogo ? 'Replace logo' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg"
              style={{ display: 'none' }}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
                e.target.value = '';
              }}
            />
          </label>

          {branding?.hasLogo && (
            <span style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>
              {branding.logoFileName} · {fmtBytes(branding.logoBytes)}
            </span>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 12, lineHeight: 1.6 }}>
          PNG or JPEG, under {fmtBytes(maxLogoBytes)}. SVG is not accepted — it cannot be
          embedded in a PDF here and would carry script into an issued document.
          Warnings such as the DRAFT banner are never drawn in your brand colour, so a
          pale palette cannot make them disappear.
        </div>
      </div>
    </div>
  );
};

export default ReportBranding;
