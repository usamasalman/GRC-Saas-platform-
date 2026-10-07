import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import FormDialog from '../../../components/FormDialog';
import { S, ghostBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * Firm team (consulting engagement, sprint 7): the firm's people and the open
 * engagements each is on, with their allocation added up.
 *
 * An allocation is a share of a person's time on one engagement. Here it is
 * totalled across the firm's open engagements (draft, active and on hold),
 * and by client; an engagement where it is not stated is counted apart
 * rather than read as free time, and a total over 100% is flagged. The firm's
 * Lead on an engagement can change its people's allocation from here.
 */

interface Row {
  memberId: string; projectId: string; ref: string; name: string; status: string; client: string;
  engagementRole: string | null; memberStatus: string | null; allocation: number | null;
  accessFrom: string | null; accessTo: string | null; canSetAllocation: boolean;
}
interface Person {
  id: string; name: string; email: string; role: string;
  allocation: { total: number; notStated: number; over: boolean; byClient: { clientTenantId: string; client: string; percent: number; notStated: number }[] };
  engagements: Row[];
}

const PAGE = 25;

const FirmTeam: React.FC = () => {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [editing, setEditing] = useState<{ p: Person; r: Row } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get('/api/engagements/firm-team', { params: { page, pageSize: PAGE } });
      setPeople(r.data?.people || []);
      setHasMore(Boolean(r.data?.paging?.hasMore));
      setTotal(Number(r.data?.paging?.total ?? 0));
    } catch (err) {
      setError(apiError(err, 'Could not load the firm team.'));
      setPeople([]);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const save = async (raw: string) => {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      await apiClient.patch(`/api/engagements/${editing.r.projectId}/members/${editing.r.memberId}/allocation`, {
        allocation: raw === '' ? null : Number(raw),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setEditing(null);
      setError(apiError(err, 'The allocation could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 12 }}>
        Your firm's people and the open engagements each is on. Allocation is added up across engagements and by client;
        "not stated" is counted apart, and anything over 100% is flagged.
      </div>
      {error && <div style={{ ...S.error, marginBottom: 12 }}>{error}</div>}
      {people === null ? <div style={{ color: 'var(--ink-muted)', padding: 20 }}>Loading…</div> : (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Person</th><th style={S.th}>Allocation</th><th style={S.th}>By client</th><th style={S.th}>Open engagements</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td style={S.td}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{p.email}</div>
                  </td>
                  <td style={S.td}>
                    <span style={p.allocation.over ? pill('var(--danger)', 'var(--danger-line)') : pill('var(--ink-muted)', 'var(--line)')}>
                      {p.allocation.total}%
                    </span>
                    {p.allocation.over && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>Over 100%</div>}
                    {p.allocation.notStated > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{p.allocation.notStated} not stated</div>
                    )}
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>
                    {p.allocation.byClient.length === 0 ? <span style={{ color: 'var(--ink-muted)' }}>On no open engagement</span>
                      : p.allocation.byClient.map((c) => (
                        <div key={c.clientTenantId}>{c.client}: {c.percent}%{c.notStated > 0 ? ` + ${c.notStated} not stated` : ''}</div>
                      ))}
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>
                    {p.engagements.map((r) => (
                      <div key={r.memberId} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0', flexWrap: 'wrap' }}>
                        <span><strong>{r.ref}</strong> · {r.name} <span style={{ color: 'var(--ink-muted)' }}>({r.client} · {r.engagementRole || 'team'}{r.memberStatus === 'Nominated' ? ', awaiting approval' : ''})</span></span>
                        <span>{r.allocation === null ? 'not stated' : `${r.allocation}%`}</span>
                        {r.accessTo && <span style={{ color: 'var(--ink-muted)' }}>to {calendarDate(r.accessTo)}</span>}
                        {r.canSetAllocation && (
                          <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }} disabled={busy} onClick={() => setEditing({ p, r })}>Set allocation</button>
                        )}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 16px', fontSize: 12, color: 'var(--ink-muted)' }}>
            {total} {total === 1 ? 'person' : 'people'}
            <button style={{ ...ghostBtn, marginLeft: 'auto', padding: '3px 10px', fontSize: 11.5 }} disabled={page === 1} onClick={() => setPage((n) => n - 1)}>Previous</button>
            <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} disabled={!hasMore} onClick={() => setPage((n) => n + 1)}>Next</button>
          </div>
        </div>
      )}
      {editing && (
        <FormDialog
          title={`How much of ${editing.p.name}'s time does ${editing.r.ref} take?`}
          intro={<>Recorded on both organisations' trails. {editing.p.name} is at {editing.p.allocation.total}% across the firm's open engagements now.</>}
          submitLabel="Save allocation"
          busy={busy}
          fields={[
            { name: 'allocation', label: 'Allocation (%)', type: 'number', initial: editing.r.allocation === null ? '' : String(editing.r.allocation),
              help: '0 to 100. Left empty: not stated.' },
          ]}
          validate={(v) => {
            if (v.allocation === '') return null;
            const n = Number(v.allocation);
            return Number.isInteger(n) && n >= 0 && n <= 100 ? null : 'A whole number from 0 to 100, or empty.';
          }}
          onSubmit={(v) => save(v.allocation)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
};

export default FirmTeam;
