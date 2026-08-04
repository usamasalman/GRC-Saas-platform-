import React from 'react';

/** Shared visual language for the IAM pages. */
export const S = {
  page: {
    padding: 24,
    color: '#cbd5e1',
    fontFamily: "'JetBrains Mono','Fira Code',monospace",
  } as React.CSSProperties,
  card: {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 10,
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '9px 11px',
    boxSizing: 'border-box',
    background: '#0b1220',
    border: '1px solid #1e293b',
    borderRadius: 6,
    color: '#e2e8f0',
    fontFamily: 'inherit',
    fontSize: 13,
  } as React.CSSProperties,
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    fontWeight: 400,
    borderBottom: '1px solid #1e293b',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
  td: { padding: '10px 12px' } as React.CSSProperties,
  headRow: { background: '#0b1220', color: '#64748b' } as React.CSSProperties,
  bodyRow: { borderBottom: '1px solid #16202f' } as React.CSSProperties,
  error: {
    background: '#3f1618',
    border: '1px solid #7f1d1d',
    padding: 12,
    borderRadius: 6,
    color: '#fca5a5',
    marginBottom: 14,
    fontSize: 13,
  } as React.CSSProperties,
};

export const primaryBtn = (disabled = false): React.CSSProperties => ({
  background: disabled ? '#334155' : '#2563eb',
  color: '#fff',
  border: 'none',
  padding: '8px 14px',
  borderRadius: 6,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
});

export const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#94a3b8',
  border: '1px solid #334155',
  padding: '8px 14px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 13,
};

export const linkBtn = (fg: string): React.CSSProperties => ({
  background: 'transparent',
  color: fg,
  border: 'none',
  padding: '4px 7px',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 11,
});

export const pill = (fg: string, br: string): React.CSSProperties => ({
  fontSize: 10,
  padding: '2px 7px',
  borderRadius: 4,
  border: `1px solid ${br}`,
  color: fg,
  whiteSpace: 'nowrap',
});

export const STATUS_PILL: Record<string, React.CSSProperties> = {
  Active: pill('#86efac', '#15803d'),
  Suspended: pill('#fca5a5', '#7f1d1d'),
  Inactive: pill('#94a3b8', '#334155'),
};

/** KPI strip used at the top of each IAM page. */
export const StatStrip: React.FC<{ items: [string, React.ReactNode][] }> = ({ items }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 18 }}>
    {items.map(([label, value]) => (
      <div key={label} style={{ ...S.card, padding: 14 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 22, color: '#f1f5f9' }}>{value}</div>
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
