import React, { useEffect, useState } from 'react';
import apiClient from '../api/apiClient';
import { S } from '../pages/iam/iamStyles';

interface PackageUsage {
  holder: { id: string; name: string };
  plan: { id: string; name: string };
  limits: { users: number | null; frameworks: number | null; storageGb: number | null };
  used: { users: number; frameworks: number; storageBytes: number };
}

const GB = 1024 ** 3;

/**
 * The customer's package, and what its group has used of each limit.
 *
 * Read-only. The platform sets packages and enables frameworks within them
 * (QA-031); this is where a customer sees how close they are before an
 * addition is refused, rather than finding out from the refusal.
 *
 * `focus` puts one limit first — the one the screen showing it is about.
 */
const PackagePanel: React.FC<{ focus?: 'frameworks' | 'users' | 'storage' }> = ({ focus }) => {
  const [pkg, setPkg] = useState<PackageUsage | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [platform, setPlatform] = useState(false);

  useEffect(() => {
    apiClient.get('/api/billing/package')
      .then((res) => { setPlatform(res.data?.platform === true); setPkg(res.data?.package ?? null); })
      .catch(() => setFailed(true));
  }, []);

  // The platform's own organisations have no package; nothing to show them.
  if (failed || pkg === undefined || platform) return null;

  if (pkg === null) {
    return (
      <div style={{ ...S.card, padding: 14, marginBottom: 16, fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--ink)' }}>No package is assigned.</strong> Frameworks, users and files are
        added within a package, which the platform assigns.
      </div>
    );
  }

  const rows: { key: 'frameworks' | 'users' | 'storage'; label: string; used: number; limit: number | null; show: (n: number) => string }[] = [
    { key: 'frameworks', label: 'Frameworks', used: pkg.used.frameworks, limit: pkg.limits.frameworks, show: (n) => String(n) },
    { key: 'users', label: 'Named users', used: pkg.used.users, limit: pkg.limits.users, show: (n) => String(n) },
    {
      key: 'storage', label: 'Storage', used: pkg.used.storageBytes, limit: pkg.limits.storageGb === null ? null : pkg.limits.storageGb * GB,
      show: (n) => `${(n / GB).toFixed(n < GB ? 3 : 2)} GB`,
    },
  ];
  if (focus) rows.sort((a, b) => (a.key === focus ? -1 : b.key === focus ? 1 : 0));

  return (
    <div style={{ ...S.card, padding: 14, marginBottom: 16 }}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-body)', marginBottom: 10 }}>
        Package: <strong style={{ color: 'var(--ink)' }}>{pkg.plan.name}</strong>
        <span style={{ color: 'var(--ink-muted)' }}> · held by {pkg.holder.name}, shared by its branches</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {rows.map((r) => {
          const full = r.limit !== null && r.used >= r.limit;
          const pct = r.limit ? Math.min(100, Math.round((r.used / r.limit) * 100)) : 0;
          return (
            <div key={r.key}>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{r.label}</div>
              <div style={{ fontSize: 14, color: full ? 'var(--warning)' : 'var(--ink)', fontWeight: 600, margin: '2px 0 4px' }}>
                {r.show(r.used)} {r.limit === null ? '· limit not set' : `of ${r.show(r.limit)}`}
              </div>
              {r.limit !== null && (
                <div style={{ height: 4, borderRadius: 2, background: 'var(--line)' }}>
                  <div style={{ width: `${pct}%`, height: 4, borderRadius: 2, background: full ? 'var(--warning)' : 'var(--success)' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PackagePanel;
