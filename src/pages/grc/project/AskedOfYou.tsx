import React, { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, ghostBtn, pill } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * Information requests waiting for your answer, across engagements
 * (consulting engagement, sprint 8), in My Work. They are answered from the
 * Requests tab of each engagement. Shows nothing when nobody is waiting on you.
 */
const AskedOfYou: React.FC<{ onOpenProject?: (projectId: string) => void }> = ({ onOpenProject }) => {
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    apiClient.get('/api/engagements/requests/mine', { params: { page, pageSize: 20 } })
      .then((r) => { setRows(r.data?.requests || []); setHasMore(Boolean(r.data?.paging?.hasMore)); })
      .catch(() => setRows([]));
  }, [page]);

  if (rows.length === 0 && page === 1) return null;
  return (
    <div style={{ ...S.card, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>
        Asked of you
        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-muted)', marginLeft: 8 }}>Requests from consulting firms; answer them from the engagement's Requests tab.</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} style={{ padding: '8px 16px', borderTop: '1px solid var(--line-soft)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{r.ref}</strong> {r.title}
          <span style={{ color: 'var(--ink-muted)' }}>{r.project.ref} · {r.project.name}{r.project.firm ? ` · ${r.project.firm}` : ''}</span>
          <span style={{ color: 'var(--ink-muted)' }}>due {calendarDate(r.dueDate)}</span>
          {r.overdueDays > 0 && <span style={pill('var(--danger)', 'var(--danger-line)')}>overdue {r.overdueDays} days</span>}
          {r.status === 'Returned' && <span style={pill('var(--danger)', 'var(--danger-line)')}>Returned</span>}
          {onOpenProject && (
            <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5, marginLeft: 'auto' }} onClick={() => onOpenProject(r.project.id)}>Open</button>
          )}
        </div>
      ))}
      {(page > 1 || hasMore) && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderTop: '1px solid var(--line-soft)' }}>
          <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  );
};

export default AskedOfYou;
