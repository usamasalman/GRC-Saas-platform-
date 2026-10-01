import React, { useEffect, useState } from 'react';
import apiClient from '../api/apiClient';

/**
 * "Shared with <firm>" on the organisation's own records (consulting
 * engagement, sprint 6): a record a binding engagement scope shares with a
 * delivery firm says so in the register, so the organisation's people know
 * who outside can see it. Asked only where consulting is switched on, for
 * the rows on screen, at most 200 at a time.
 */

let consultingOn: Promise<boolean> | null = null;
const consulting = () => {
  if (!consultingOn) {
    consultingOn = apiClient.get('/api/engagements/feature').then((r) => Boolean(r.data?.enabled)).catch(() => false);
  }
  return consultingOn;
};

export function useSharedWith(subjectType: 'Document' | 'Risk' | 'Asset', ids: readonly string[]): Record<string, string[]> {
  const [shared, setShared] = useState<Record<string, string[]>>({});
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    if (ids.length === 0) { setShared({}); return; }
    consulting().then(async (on) => {
      if (!on) return;
      const out: Record<string, string[]> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const res = await apiClient.get('/api/engagements/shared-with', { params: { subjectType, ids: ids.slice(i, i + 200).join(',') } });
        Object.assign(out, res.data?.sharedWith || {});
      }
      if (live) setShared(out);
    }).catch(() => undefined);
    return () => { live = false; };
    // The ids themselves, not the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, key]);
  return shared;
}

export const SharedWith: React.FC<{ firms?: string[] }> = ({ firms }) => (firms && firms.length > 0 ? (
  <span
    title="A consulting engagement's scope shares this with them"
    style={{
      marginLeft: 8, fontSize: 10.5, fontWeight: 600, color: 'var(--info)', border: '1px solid var(--info)',
      borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', verticalAlign: 'middle',
    }}
  >
    Shared with {firms.join(', ')}
  </span>
) : null);
