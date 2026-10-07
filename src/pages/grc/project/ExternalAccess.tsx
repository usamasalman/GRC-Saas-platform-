import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import fetchAllPages from '../../../api/fetchAllPages';
import FormDialog from '../../../components/FormDialog';
import { ReasonDialog } from '../../../components/Dialog';
import { CAP, can } from '../../../components/Can';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';
import { STYLE_LABEL } from './EngagementPanel';

/**
 * Scope and external access (consulting engagement, sprint 6): the
 * organisation's view of who from outside can see what.
 *
 *   - Enforcement readiness, for the organisation's administrator: the
 *     checklist the platform switches enforcement on against, and the
 *     confirmation only the organisation can give.
 *   - Engagements set up the old way: the one-time migration onto approved
 *     people, on one screen, before enforcement.
 *   - External access review: every outside person by engagement, their role,
 *     dates and last activity, the binding scope and the document setting;
 *     revoke a person, or confirm the access as reviewed.
 */

const fmt = (d: string | null | undefined) => calendarDate(d, { day: '2-digit', month: 'short', year: 'numeric' });
const CHECK_LABEL: Record<string, string> = {
  allExplained: 'Every rule and route the guard would refuse is explained',
  quietFortnight: 'No unexplained refusal in the last 14 days',
  firmActivity: 'Firms worked on your engagements in those 14 days',
  noMigrationWaiting: 'No engagement still set up the old way',
  clientConfirmed: 'Your administrator has confirmed',
};
const STATE_LABEL: Record<string, string> = {
  Open: 'Open', NotStarted: 'Not started', Ended: 'Ended', AwaitingApproval: 'Awaiting approval',
};

const Section: React.FC<{ title: string; intro?: string; children: React.ReactNode }> = ({ title, intro, children }) => (
  <div style={{ marginBottom: 24 }}>
    <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--ink)' }}>{title}</h3>
    {intro && <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: 760, lineHeight: 1.6 }}>{intro}</p>}
    {children}
  </div>
);

// ─── Enforcement readiness ─────────────────────────────────────────────────

const EnforcementStatus: React.FC = () => {
  const [r, setR] = useState<any>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    apiClient.get('/api/engagements/enforcement/status').then((res) => setR(res.data.readiness)).catch(() => setR(null));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!r) return null;
  return (
    <Section
      title="Enforcement readiness"
      intro="Until your consulting rules are enforced, firms on engagements set up the old way work as before and what the rules would refuse is counted. The platform switches enforcement on once every check passes, with seven days' notice to the firms, and can switch it back."
    >
      <div style={{ ...S.card, padding: 16 }}>
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          Enforcement is <strong>{r.enforcement.on ? 'on' : r.enforcement.override?.enabled && r.enforcement.override.effectiveFrom ? `scheduled for ${fmt(r.enforcement.override.effectiveFrom)}` : 'off (shadow mode)'}</strong>
          {!r.consultingOn && ' · consulting is off, so enforcement would have no effect'}
        </div>
        {Object.entries(r.checks).map(([k, ok]) => (
          <div key={k} style={{ fontSize: 12.5, padding: '2px 0', color: ok ? 'var(--success)' : 'var(--ink-body)' }}>
            {ok ? '✓' : '○'} {CHECK_LABEL[k] || k}
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 6 }}>
          {r.detail.unmarked} refusal(s) not yet explained · {r.detail.firmActivity} firm action(s) in 14 days
          {r.detail.confirmation ? ` · confirmed by ${r.detail.confirmation.by} ${fmt(r.detail.confirmation.at)}` : ''}
        </div>
        {error && <div style={{ ...S.error, marginTop: 8 }}>{error}</div>}
        <div style={{ marginTop: 10 }}>
          <button style={primaryBtn(busy || !r.checks.noMigrationWaiting)} disabled={busy || !r.checks.noMigrationWaiting}
            title={r.checks.noMigrationWaiting ? undefined : 'Migrate every engagement set up the old way first.'}
            onClick={() => setConfirming(true)}>
            Confirm we are ready
          </button>
        </div>
      </div>
      {confirming && (
        <ReasonDialog
          title="Confirm you are ready for enforcement?"
          message="Recorded on your organisation's trail. The platform still switches enforcement on, and only once every check passes."
          label="Note"
          confirmLabel="Confirm we are ready"
          minLength={10}
          busy={busy}
          onConfirm={async (note) => {
            setBusy(true); setError('');
            try { await apiClient.post('/api/engagements/enforcement/confirm', { note }); setConfirming(false); load(); } catch (err) { setConfirming(false); setError(apiError(err)); } finally { setBusy(false); }
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Section>
  );
};

// ─── Migration ─────────────────────────────────────────────────────────────

const Migration: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [picks, setPicks] = useState<Record<string, { keep: Record<string, boolean>; role: Record<string, string>; style: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    apiClient.get('/api/engagements/migration').then((res) => {
      const list = res.data?.engagements || [];
      setRows(list);
      setPicks(Object.fromEntries(list.map((e: any) => [e.id, {
        keep: Object.fromEntries(e.proposal.map((p: any) => [p.userId, true])),
        role: Object.fromEntries(e.proposal.map((p: any) => [p.userId, p.engagementRole])),
        style: 'ConsultantLed',
      }])));
    }).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!rows || rows.length === 0) return null;

  const migrate = async (e: any) => {
    const pick = picks[e.id];
    const members = e.proposal.filter((p: any) => pick.keep[p.userId]).map((p: any) => ({ userId: p.userId, engagementRole: pick.role[p.userId] }));
    setBusy(e.id); setError('');
    try {
      await apiClient.post(`/api/engagements/${e.id}/migrate`, { deliveryStyle: pick.style, members });
      load(); onDone();
    } catch (err) { setError(apiError(err, 'The engagement could not be migrated.')); } finally { setBusy(null); }
  };
  const set = (id: string, patch: any) => setPicks((all) => ({ ...all, [id]: { ...all[id], ...patch } }));

  return (
    <Section
      title="Engagements set up the old way"
      intro="These name a firm the old way: everyone in the firm can read them. Confirm who keeps access, approved from today to the engagement's target end, and the delivery style. The person marked Accountable is proposed as Lead; nobody is made Reviewer unless you choose it. Version 1 of the scope keeps what the firm has today: the engagement, none of your registers."
    >
      {error && <div style={S.error}>{error}</div>}
      {rows.map((e) => {
        const pick = picks[e.id];
        if (!pick) return null;
        return (
          <div key={e.id} style={{ ...S.card, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
              <strong style={{ fontSize: 13.5 }}>{e.ref} · {e.name}</strong>
              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{e.firm} · to {fmt(e.targetEndDate)}{e.relationshipExists ? '' : ' · a relationship will be recorded as migrated'}</span>
            </div>
            {e.blocked && <div style={{ fontSize: 12.5, color: 'var(--warning)', marginBottom: 8 }}>{e.blocked}</div>}
            {e.proposal.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Nobody from {e.firm} worked on it; after migrating, the firm has no access until someone is approved.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={S.headRow}><th style={S.th}>Keep</th><th style={S.th}>Person</th><th style={S.th}>Why proposed</th><th style={S.th}>Role</th></tr></thead>
                <tbody>
                  {e.proposal.map((p: any) => (
                    <tr key={p.userId} style={S.bodyRow}>
                      <td style={S.td}>
                        <input type="checkbox" aria-label={`Keep ${p.name}`} checked={Boolean(pick.keep[p.userId])}
                          onChange={(ev) => set(e.id, { keep: { ...pick.keep, [p.userId]: ev.target.checked } })} />
                      </td>
                      <td style={S.td}>{p.name}<div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{p.email}</div></td>
                      <td style={S.td}>{p.source === 'Team' ? `On the team${p.raci ? ` (RACI ${p.raci})` : ''}` : p.source === 'Assigned' ? 'Assigned its tasks' : 'Worked on it'}</td>
                      <td style={S.td}>
                        <select style={S.input} value={pick.role[p.userId]} aria-label={`Role for ${p.name}`}
                          onChange={(ev) => set(e.id, { role: { ...pick.role, [p.userId]: ev.target.value } })}>
                          {['Lead', 'Consultant', 'Reviewer'].map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <label style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                Delivery style{' '}
                <select style={S.input} value={pick.style} onChange={(ev) => set(e.id, { style: ev.target.value })}>
                  <option value="ConsultantLed">{STYLE_LABEL.ConsultantLed} (as today)</option>
                  <option value="ClientLed">{STYLE_LABEL.ClientLed}</option>
                </select>
              </label>
              <button style={{ ...primaryBtn(Boolean(busy) || Boolean(e.blocked)), marginLeft: 'auto' }} disabled={Boolean(busy) || Boolean(e.blocked)} onClick={() => migrate(e)}>
                {busy === e.id ? 'Migrating…' : 'Migrate engagement'}
              </button>
            </div>
          </div>
        );
      })}
    </Section>
  );
};

// ─── External access review ────────────────────────────────────────────────

const AccessReview: React.FC<{ version: number }> = ({ version }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<{ e: any; p: any } | null>(null);
  const [reviewing, setReviewing] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetchAllPages<any>('/api/engagements/external-access', 'engagements').then(setRows).catch((err) => { setError(apiError(err)); setRows([]); });
  }, []);
  useEffect(() => { load(); }, [load, version]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); setRevoking(null); setReviewing(null); load(); } catch (err) { setRevoking(null); setReviewing(null); setError(apiError(err)); } finally { setBusy(false); }
  };
  if (!rows) return <div style={{ color: 'var(--ink-muted)', padding: 20 }}>Loading…</div>;
  return (
    <Section
      title="External access review"
      intro="Every person from outside your organisation who can see an engagement, what the engagement shares and until when. Revoke anyone who should not have access, and confirm the rest as reviewed."
    >
      {error && <div style={S.error}>{error}</div>}
      {rows.length === 0 && <div style={{ ...S.card, padding: 16, fontSize: 13, color: 'var(--ink-muted)' }}>No firm delivers any of your open engagements.</div>}
      {rows.map((e) => (
        <div key={e.id} style={{ ...S.card, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
            <strong style={{ fontSize: 13.5 }}>{e.ref} · {e.name}</strong>
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>{e.firm}</span>
            {e.deliveryStyle && <span style={pill('var(--brand)', 'var(--brand-line)')}>{STYLE_LABEL[e.deliveryStyle] || e.deliveryStyle}</span>}
            <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Documents {e.documentAccess === 'Download' ? 'downloadable' : 'view only'}</span>
            {e.canDecide && !e.oldWay && (
              <button style={{ ...ghostBtn, marginLeft: 'auto' }} disabled={busy} onClick={() => setReviewing(e)}>Confirm access</button>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 8 }}>
            {e.oldWay
              ? 'Set up the old way: everyone in the firm can read it until it is migrated.'
              : e.scope
                ? `Scope v${e.scope.version}: ${e.scope.services.length ? e.scope.services.join(', ') : 'the engagement only'}, up to ${e.scope.classificationCeiling}, to ${fmt(e.scope.validTo)}`
                : 'No scope yet: the engagement only.'}
            {e.lastReview ? ` · last reviewed by ${e.lastReview.by} ${fmt(e.lastReview.at)}` : ' · never reviewed'}
          </div>
          {e.people.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={S.headRow}><th style={S.th}>Person</th><th style={S.th}>Role</th><th style={S.th}>Access</th><th style={S.th}>Last activity</th><th style={S.th} /></tr></thead>
              <tbody>
                {e.people.map((p: any) => (
                  <tr key={p.memberId} style={S.bodyRow}>
                    <td style={S.td}>{p.name}<div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{p.email}</div></td>
                    <td style={S.td}>{p.engagementRole || '—'}</td>
                    <td style={S.td}>{STATE_LABEL[p.state] || p.state} · {fmt(p.accessFrom)} → {fmt(p.accessTo)}</td>
                    <td style={S.td}>{p.lastActivity ? new Date(p.lastActivity).toLocaleDateString() : '—'}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      {e.canDecide && <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} disabled={busy} onClick={() => setRevoking({ e, p })}>Revoke</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
      {revoking && (
        <ReasonDialog
          title={`Revoke ${revoking.p.name}'s access to ${revoking.e.ref}?`}
          message="Their access ends now. It is recorded on both organisations' trails; the firm can nominate them again for your approval."
          label="Why?"
          confirmLabel="Revoke"
          minLength={10}
          busy={busy}
          onConfirm={(reason) => act(() => apiClient.post(`/api/engagements/${revoking.e.id}/members/${revoking.p.memberId}/remove`, { reason }))}
          onCancel={() => setRevoking(null)}
        />
      )}
      {reviewing && (
        <FormDialog
          title={`Confirm access to ${reviewing.ref}`}
          intro="You have looked at who from outside can see this engagement and what it shares, and it is right. Recorded on both organisations' trails."
          submitLabel="Confirm access"
          busy={busy}
          fields={[{ name: 'note', label: 'Note', type: 'textarea', required: true }]}
          validate={(v) => (v.note.trim().length < 10 ? 'Add a note of at least 10 characters.' : null)}
          onSubmit={(v) => act(() => apiClient.post(`/api/engagements/${reviewing.id}/access-review`, { note: v.note.trim() }))}
          onCancel={() => setReviewing(null)}
        />
      )}
    </Section>
  );
};

const ExternalAccess: React.FC = () => {
  const [version, setVersion] = useState(0);
  return (
    <div>
      {can(CAP.ADD_USER) && <EnforcementStatus key={`e${version}`} />}
      <Migration onDone={() => setVersion((v) => v + 1)} />
      <AccessReview version={version} />
    </div>
  );
};

export default ExternalAccess;
