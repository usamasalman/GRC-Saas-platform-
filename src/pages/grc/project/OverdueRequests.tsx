import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import FormDialog from '../../../components/FormDialog';
import { S, ghostBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * Overdue information requests on the Delays tab (consulting engagement,
 * sprint 8). For information only: an overdue request is never a delay by
 * itself. The firm's Lead or the project manager records one as a blocker
 * owed by the organisation, linked to its task. Days on hold are not counted.
 * Shows nothing on an engagement without requests.
 */
const OverdueRequests: React.FC<{ projectId: string; onRecorded: () => void }> = ({ projectId, onRecorded }) => {
  const [data, setData] = useState<any>(null);
  const [recording, setRecording] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    apiClient.get(`/api/engagements/${projectId}/requests`, { params: { overdue: 1 } })
      .then((r) => setData(r.data))
      .catch(() => setData(null));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  if (!data || data.requests.length === 0) return null;
  const record = async () => {
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/api/engagements/${projectId}/requests/${recording.id}/blocker`);
      setRecording(null);
      load();
      onRecorded();
    } catch (err) {
      setRecording(null);
      setError(apiError(err, 'It could not be recorded.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...S.card, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>
        Overdue requests
        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-muted)', marginLeft: 8 }}>
          For information: none of these counts as a delay until it is recorded as a blocker. Days on hold are not counted.
        </span>
      </div>
      {error && <div style={{ ...S.error, margin: 12 }}>{error}</div>}
      {data.requests.map((r: any) => (
        <div key={r.id} style={{ padding: '8px 16px', borderTop: '1px solid var(--line-soft)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{r.ref}</strong> {r.title}
          <span style={pill('var(--danger)', 'var(--danger-line)')}>overdue {r.overdueDays} days</span>
          <span style={{ color: 'var(--ink-muted)' }}>due {calendarDate(r.dueDate)} · {r.assignee?.name} · {r.targetLabel || 'the engagement'}</span>
          <span style={{ marginLeft: 'auto' }}>
            {r.blockerRecorded
              ? <span style={{ color: 'var(--ink-muted)' }}>Recorded as a blocker</span>
              : data.can.recordBlocker && (
                <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} disabled={busy} onClick={() => setRecording(r)}>Record as blocker</button>
              )}
          </span>
        </div>
      ))}
      {recording && (
        <FormDialog
          title={`Record ${recording.ref} as a blocker?`}
          intro={<>A blocker owed by the organisation{recording.targetType === 'Task' ? `, on ${recording.targetLabel}` : ''}, counting from today until it is cleared.</>}
          fields={[]} submitLabel="Record as blocker" busy={busy}
          onSubmit={record} onCancel={() => setRecording(null)}
        />
      )}
    </div>
  );
};

export default OverdueRequests;
