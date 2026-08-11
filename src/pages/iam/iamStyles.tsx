import React from 'react';

/** Premium, aligned executive light visual language for pages across the application. */
export const S = {
  page: {
    padding: '24px',
    color: 'var(--ink-body)',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    background: 'var(--surface-sunk)',
    minHeight: '100vh',
  } as React.CSSProperties,

  card: {
    background: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.02)',
  } as React.CSSProperties,

  input: {
    width: '100%',
    padding: '10px 14px',
    boxSizing: 'border-box',
    background: 'var(--surface)',
    border: '1px solid var(--field-line)',
    borderRadius: 8,
    color: 'var(--ink)',
    fontFamily: 'inherit',
    fontSize: 13,
    outline: 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  } as React.CSSProperties,

  th: {
    textAlign: 'left',
    padding: '12px 14px',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--ink-body)',
    borderBottom: '1px solid var(--line)',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,

  td: {
    padding: '12px 14px',
    fontSize: 13,
    color: 'var(--ink-body)',
    verticalAlign: 'middle',
  } as React.CSSProperties,

  headRow: {
    background: 'var(--surface-sunk)',
  } as React.CSSProperties,

  bodyRow: {
    borderBottom: '1px solid var(--line-soft)',
    transition: 'background 0.15s ease',
  } as React.CSSProperties,

  error: {
    background: 'var(--danger-bg)',
    border: '1px solid var(--danger-line)',
    padding: 14,
    borderRadius: 'var(--radius)',
    color: 'var(--danger)',
    marginBottom: 16,
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } as React.CSSProperties,
};

/** Primary action. Solid brand fill — corporate products do not gradient. */
export const primaryBtn = (disabled = false): React.CSSProperties => ({
  background: disabled ? 'var(--surface-hover)' : 'var(--brand)',
  color: disabled ? 'var(--ink-faint)' : '#fff',
  border: `1px solid ${disabled ? 'var(--line)' : 'var(--brand)'}`,
  padding: '9px 16px',
  borderRadius: 'var(--radius)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  boxShadow: disabled ? 'none' : 'var(--shadow-sm)',
  transition: 'background 0.15s ease, box-shadow 0.15s ease',
});

export const ghostBtn: React.CSSProperties = {
  background: 'var(--surface)',
  color: 'var(--ink-body)',
  border: '1px solid var(--field-line)',
  padding: '8px 14px',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  boxShadow: 'var(--shadow-sm)',
  transition: 'background 0.15s ease, border-color 0.15s ease',
};

export const linkBtn = (fg: string): React.CSSProperties => ({
  background: 'transparent',
  color: fg,
  border: 'none',
  padding: '4px 8px',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
});

/**
 * Status pill. The tint is derived from the border colour with `color-mix`
 * rather than by appending an alpha suffix to a hex string — that trick breaks
 * the moment the colour arrives as a custom property.
 */
export const pill = (fg: string, br: string): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 600,
  padding: '3px 9px',
  borderRadius: 'var(--radius-sm)',
  border: `1px solid ${br}`,
  color: fg,
  background: `color-mix(in srgb, ${br} 22%, var(--surface))`,
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  letterSpacing: '0.01em',
});

export const STATUS_PILL: Record<string, React.CSSProperties> = {
  Active: pill('var(--success)', 'var(--success-line)'),
  Suspended: pill('var(--danger)', 'var(--danger-line)'),
  Inactive: pill('var(--ink-muted)', 'var(--line)'),
};

/** High-grade StatStrip KPI banner component. */
export const StatStrip: React.FC<{ items: [string, React.ReactNode][] }> = ({ items }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
    {items.map(([label, value]) => (
      <div key={label} style={{
        ...S.card,
        padding: '16px 18px',
        position: 'relative',
        overflow: 'hidden',
        borderTop: '3px solid var(--info-line)',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--ink)' }}>{value}</div>
      </div>
    ))}
  </div>
);

/** Maps an axios error to a readable message. */
export function apiError(err: any, fallback = 'Request failed'): string {
  const s = err?.response?.status;
  const d = err?.response?.data;
  if (d?.code === 'CAPABILITY_DENIED') return `${d.message} (capability: ${d.capability})`;
  if (s === 401) return 'Session expired — please sign in again.';
  if (s === 403) return d?.message || 'Not authorized.';
  if (s === 409) return d?.message || 'Conflict.';
  if (!s) return 'Could not reach the API on port 3000.';
  return d?.message || fallback;
}
