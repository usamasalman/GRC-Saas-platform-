import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import FormDialog from '../../components/FormDialog';
import { ReasonDialog } from '../../components/Dialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../iam/iamStyles';

/**
 * Switching an organisation's consulting rules from counted to enforced
 * (consulting engagement, sprint 6), on the platform's Feature Flags screen.
 *
 * Zero refusals is the wrong test, since a refusal can be the rule working.
 * The test is no unexplained refusals: every rule and route marked "keep
 * refusing" or "rule fixed", a quiet fortnight with real firm activity, no
 * engagement still set up the old way, and the organisation's administrator
 * having confirmed. Then enforcement starts at least seven days ahead, the
 * firms' Leads told now, and it can be switched back to shadow at once.
 */

const CHECK_LABEL: Record<string, string> = {
  allExplained: 'Every rule and route explained',
  quietFortnight: 'No unexplained refusal in 14 days',
  firmActivity: 'Real firm activity in those 14 days',
  noMigrationWaiting: 'No engagement still set up the old way',
  clientConfirmed: 'The organisation\'s administrator confirmed',
};
const WEEK = 7 * 86_400_000;

const EnforcementReadiness: React.FC<{ organisations: { id: string; name: string }[] }> = ({ organisations }) => {
  const [orgId, setOrgId] = useState('');
  const [r, setR] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [marking, setMarking] = useState<any>(null);
  const [scheduling, setScheduling] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  const load = useCallback(async (id: string) => {
    setError('');
    if (!id) { setR(null); return; }
    try {
      const res = await apiClient.get('/api/engagements/enforcement/readiness', { params: { clientTenantId: id } });
      setR(res.data.readiness);
    } catch (err) {
      setError(apiError(err, 'Could not work out the readiness.'));
    }
  }, []);
  useEffect(() => { load(orgId); }, [orgId, load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); setMarking(null); setScheduling(false); setRollingBack(false); await load(orgId); }
    catch (err) { setMarking(null); setScheduling(false); setRollingBack(false); setError(apiError(err)); }
    finally { setBusy(false); }
  };

  const enforcement = r?.enforcement;
  const scheduled = enforcement?.override?.enabled && enforcement.override.effectiveFrom && !enforcement.on;

  return (
    <div style={{ ...S.card, marginTop: 18, padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
        <strong style={{ fontSize: 14, color: 'var(--ink)' }}>Consulting enforcement by organisation</strong>
        <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', maxWidth: 620 }}>
          Switched on per organisation once nothing the guard would refuse is unexplained, with seven days' notice to the firms.
        </span>
      </div>
      <select style={{ ...S.input, maxWidth: 360 }} value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Organisation">
        <option value="">Choose an organisation…</option>
        {organisations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {error && <div style={{ ...S.error, marginTop: 10 }}>{error}</div>}
      {r && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            {enforcement.on
              ? <span style={pill('var(--success)', 'var(--success-line)')}>Enforced</span>
              : scheduled
                ? <span style={pill('var(--warning)', 'var(--warning-line)')}>Enforced from {new Date(enforcement.override.effectiveFrom).toLocaleDateString()}</span>
                : <span style={pill('var(--ink-muted)', 'var(--line)')}>Shadow mode</span>}
            {!r.consultingOn && <span style={{ marginLeft: 8, color: 'var(--warning)' }}>Consulting is off for {r.client}: enforcement would have no effect.</span>}
          </div>
          {Object.entries(r.checks).map(([k, ok]) => (
            <div key={k} style={{ fontSize: 12.5, padding: '2px 0', color: ok ? 'var(--success)' : 'var(--ink-body)' }}>
              {ok ? '✓' : '○'} {CHECK_LABEL[k] || k}
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', margin: '6px 0 10px' }}>
            {r.detail.unmarked} unexplained · {r.detail.recentUnexplained} in 14 days · {r.detail.firmActivity} firm action(s) · {r.detail.migrationWaiting} waiting to migrate
            {r.detail.confirmation ? ` · confirmed by ${r.detail.confirmation.by}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={primaryBtn(busy || !r.ready || !r.consultingOn)} disabled={busy || !r.ready || !r.consultingOn}
              title={r.ready ? undefined : 'Every check must pass first.'} onClick={() => setScheduling(true)}>
              Schedule enforcement
            </button>
            {(enforcement.on || scheduled) && (
              <button style={ghostBtn} disabled={busy} onClick={() => setRollingBack(true)}>Back to shadow mode</button>
            )}
          </div>
          {r.shadow.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
              <thead><tr style={S.headRow}><th style={S.th}>Rule</th><th style={S.th}>Route</th><th style={S.th}>Count</th><th style={S.th}>Last seen</th><th style={S.th}>Explained</th><th style={S.th} /></tr></thead>
              <tbody>
                {r.shadow.map((s: any) => (
                  <tr key={s.id} style={S.bodyRow}>
                    <td style={S.td}>{s.rule}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11.5 }}>{s.route}</td>
                    <td style={S.td}>{s.count}</td>
                    <td style={S.td}>{new Date(s.lastSeenAt).toLocaleString()}</td>
                    <td style={S.td}>
                      {s.disposition === 'KeepRefusing' ? 'Correct, keep refusing' : s.disposition === 'RuleFixed' ? 'Rule fixed' : '—'}
                      {s.unexplained && <span style={{ color: 'var(--warning)' }}> · unexplained</span>}
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} disabled={busy} onClick={() => setMarking(s)}>Explain</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {marking && (
        <FormDialog
          title={`Explain ${marking.rule} on ${marking.route}`}
          intro="Correct, keep refusing: the rule is right and the refusal is what should happen. Rule fixed: the rule was wrong and has been fixed; if it is seen again, it counts as unexplained."
          submitLabel="Save"
          busy={busy}
          fields={[
            { name: 'disposition', label: 'Explanation', type: 'select', options: ['KeepRefusing', 'RuleFixed'],
              optionLabels: { KeepRefusing: 'Correct, keep refusing', RuleFixed: 'Rule fixed' } },
            { name: 'note', label: 'Note', type: 'textarea', required: true },
          ]}
          validate={(v) => (v.note.trim().length < 10 ? 'Add a note of at least 10 characters.' : null)}
          onSubmit={(v) => act(() => apiClient.patch(`/api/engagements/shadow/${marking.id}/disposition`, { disposition: v.disposition, note: v.note.trim() }))}
          onCancel={() => setMarking(null)}
        />
      )}
      {scheduling && r && (
        <FormDialog
          title={`Enforce ${r.client}'s consulting rules`}
          intro="From the date chosen, only approved people inside their dates and role work on its engagements. The firms' Leads are told now; it can be switched back to shadow mode at any time."
          submitLabel="Schedule enforcement"
          busy={busy}
          fields={[
            { name: 'from', label: 'Enforced from', type: 'date', required: true, initial: new Date(Date.now() + WEEK + 86_400_000).toISOString().slice(0, 10) },
            { name: 'note', label: 'Note on the override', type: 'textarea', required: true },
          ]}
          validate={(v) => (new Date(`${v.from}T00:00:00Z`).getTime() < Date.now() + WEEK ? 'At least seven days ahead, so the firms are told first.'
            : v.note.trim().length < 10 ? 'Add a note of at least 10 characters.' : null)}
          onSubmit={(v) => act(() => apiClient.post('/api/engagements/enforcement/schedule', {
            clientTenantId: orgId, effectiveFrom: new Date(`${v.from}T00:00:00Z`).toISOString(), note: v.note.trim(),
          }))}
          onCancel={() => setScheduling(false)}
        />
      )}
      {rollingBack && r && (
        <ReasonDialog
          title={`Return ${r.client} to shadow mode?`}
          message="At once: firms work as before on engagements set up the old way or migrated from them, and what the rules would refuse is counted again. The firms' Leads are told."
          label="Why?"
          confirmLabel="Back to shadow mode"
          minLength={10}
          busy={busy}
          onConfirm={(note) => act(() => apiClient.post('/api/engagements/enforcement/rollback', { clientTenantId: orgId, note }))}
          onCancel={() => setRollingBack(false)}
        />
      )}
    </div>
  );
};

export default EnforcementReadiness;
