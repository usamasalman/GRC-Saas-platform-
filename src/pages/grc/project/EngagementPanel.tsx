import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import fetchAllPages from '../../../api/fetchAllPages';
import FormDialog from '../../../components/FormDialog';
import { ReasonDialog } from '../../../components/Dialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

/**
 * The consulting firm on an engagement (consulting engagement, sprint 4).
 *
 * The organisation invites a firm (to the firm's organisation, for 14 days,
 * with the delivery style), approves or turns down each person the firm's Lead
 * nominates, and may change the style. The firm's Lead nominates its people
 * and can remove them. Nobody from the firm has access until approved, and
 * approvals stay with the organisation's own people. Shown only when the
 * "Consulting Engagements" flag is on; the server refuses every action when
 * it is not.
 */

interface Member {
  id: string; engagementRole: string; memberStatus: string; roleLabel: string; active: boolean;
  accessFrom: string | null; accessTo: string | null; nominatedAt: string | null; decidedAt: string | null;
  decisionNote: string | null; user: { id: string; name: string; email: string };
  nominatedBy: { name: string } | null; decidedBy: { name: string } | null;
}
interface Invitation {
  id: string; state: string; deliveryStyle: string; invitedAt: string; expiresAt: string; respondedAt: string | null;
  responseNote: string | null; revokeReason: string | null; firm: { id: string; name: string };
  invitedBy: { name: string } | null; respondedBy: { name: string } | null;
}
interface Engagement {
  engagement: { id: string; ref: string; name: string; status: string; deliveryStyle: string | null; client: string; firm: string | null };
  side: 'Client' | 'Provider';
  relationship: { establishedAt: string } | null;
  invitations: Invitation[];
  members: Member[];
  me: { engagementRole: string; memberStatus: string } | null;
  can: { invite: boolean; decide: boolean; changeStyle: boolean; nominate: boolean };
}

export const STYLE_LABEL: Record<string, string> = { ClientLed: 'Client-led', ConsultantLed: 'Consultant-led' };
const STYLE_HELP: Record<string, string> = {
  ClientLed: 'The consultant reviews, comments and requests; your people draft and decide.',
  ConsultantLed: 'The consultant may draft documents, propose controls and assign your tasks; your people still approve.',
};
const ROLE_HELP: Record<string, string> = {
  Lead: 'Accepts, adds the firm\'s people, submits deliverables for you to approve.',
  Consultant: 'Works assigned tasks, drafts, raises requests and challenges.',
  Reviewer: 'Checks the firm\'s drafts before they reach you; changes nothing.',
};
const STATE_TONE: Record<string, [string, string]> = {
  Pending: ['var(--warning)', 'var(--warning-line)'], Accepted: ['var(--success)', 'var(--success-line)'],
  Approved: ['var(--success)', 'var(--success-line)'], Nominated: ['var(--warning)', 'var(--warning-line)'],
};
const tone = (s: string) => pill(...(STATE_TONE[s] || ['var(--ink-muted)', 'var(--line)']));

type Dialog =
  | null
  | { kind: 'invite' } | { kind: 'revoke'; inv: Invitation } | { kind: 'style' }
  | { kind: 'approve'; m: Member } | { kind: 'reject'; m: Member } | { kind: 'remove'; m: Member }
  | { kind: 'nominate' };

const EngagementPanel: React.FC<{ projectId: string; onChanged?: () => void }> = ({ projectId, onChanged }) => {
  const [on, setOn] = useState<boolean | null>(null);
  const [data, setData] = useState<Engagement | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [firms, setFirms] = useState<{ id: string; name: string }[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const f = await apiClient.get('/api/engagements/feature');
      setOn(Boolean(f.data?.enabled));
      if (!f.data?.enabled) return;
      const res = await apiClient.get(`/api/engagements/${projectId}`);
      setData(res.data);
    } catch {
      setData(null);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setDialog(null);
      await load();
      onChanged?.();
    } catch (err) {
      setDialog(null);
      setError(apiError(err, 'That could not be done.'));
    } finally {
      setBusy(false);
    }
  };

  const openInvite = async () => {
    try {
      const rows = await fetchAllPages<{ id: string; name: string }>('/api/projects/engageable-providers', 'providers', { purpose: 'invite' });
      setFirms(rows);
      setDialog({ kind: 'invite' });
    } catch (err) {
      setError(apiError(err, 'Could not load the firms.'));
    }
  };

  const openNominate = async () => {
    try {
      const rows = await fetchAllPages<{ id: string; name: string; status: string }>('/api/iam/users', 'users');
      const taken = new Set((data?.members || []).filter((m) => m.active).map((m) => m.user.id));
      setPeople(rows.filter((u) => u.status === 'Active' && !taken.has(u.id)));
      setDialog({ kind: 'nominate' });
    } catch (err) {
      setError(apiError(err, 'Could not load your firm\'s people.'));
    }
  };

  if (!on || !data) return null;
  const e = data.engagement;
  const members = data.members.filter((m) => m.memberStatus !== 'Removed' && m.memberStatus !== 'Rejected');
  const past = data.members.filter((m) => m.memberStatus === 'Removed' || m.memberStatus === 'Rejected');

  return (
    <div style={{ ...S.card, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>Consulting firm</div>
        {e.firm && <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{e.firm}</span>}
        {e.deliveryStyle && (
          <span style={pill('var(--brand)', 'var(--brand-line)')} title={STYLE_HELP[e.deliveryStyle]}>
            {STYLE_LABEL[e.deliveryStyle] || e.deliveryStyle}
          </span>
        )}
        {data.relationship && (
          <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>relationship since {calendarDate(data.relationship.establishedAt)}</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {data.can.changeStyle && <button style={ghostBtn} onClick={() => setDialog({ kind: 'style' })}>Change delivery style</button>}
          {data.can.invite && <button style={primaryBtn(false)} onClick={openInvite}>Invite a firm</button>}
          {data.can.nominate && <button style={primaryBtn(false)} onClick={openNominate}>Nominate a person</button>}
        </span>
      </div>
      {error && <div style={{ ...S.error, margin: 12 }}>{error}</div>}

      {data.side === 'Client' && data.invitations.length > 0 && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-soft)' }}>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 6 }}>Invitations</div>
          {data.invitations.map((i) => (
            <div key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12.5, padding: '3px 0', flexWrap: 'wrap' }}>
              <span style={tone(i.state)}>{i.state}</span>
              <strong>{i.firm.name}</strong>
              <span style={{ color: 'var(--ink-muted)' }}>
                {STYLE_LABEL[i.deliveryStyle]} · sent {calendarDate(i.invitedAt)}{i.invitedBy ? ` by ${i.invitedBy.name}` : ''}
                {i.state === 'Pending' ? ` · expires ${calendarDate(i.expiresAt)}` : ''}
                {i.responseNote ? ` · "${i.responseNote}"` : ''}{i.revokeReason ? ` · withdrawn: ${i.revokeReason}` : ''}
              </span>
              {i.state === 'Pending' && data.can.decide && (
                <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11, marginLeft: 'auto' }} onClick={() => setDialog({ kind: 'revoke', inv: i })}>
                  Withdraw
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {(members.length > 0 || past.length > 0) && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={S.th}>Firm person</th><th style={S.th}>Role</th><th style={S.th}>Status</th>
              <th style={S.th}>Access</th><th style={S.th}>Nominated / decided</th><th style={S.th} />
            </tr>
          </thead>
          <tbody>
            {[...members, ...past].map((m) => (
              <tr key={m.id} style={{ opacity: m.active ? 1 : 0.55 }}>
                <td style={S.td}>
                  <div style={{ fontSize: 12.5 }}>{m.user.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{m.roleLabel}</div>
                </td>
                <td style={S.td} title={ROLE_HELP[m.engagementRole]}>{m.engagementRole}</td>
                <td style={S.td}>
                  <span style={tone(m.memberStatus)}>{m.memberStatus === 'Nominated' ? 'Awaiting approval' : m.memberStatus}</span>
                  {m.decisionNote && <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{m.decisionNote}</div>}
                </td>
                <td style={{ ...S.td, fontSize: 12 }}>
                  {m.memberStatus === 'Approved' ? `${calendarDate(m.accessFrom)} → ${calendarDate(m.accessTo)}` : 'None'}
                </td>
                <td style={{ ...S.td, fontSize: 11.5, color: 'var(--ink-muted)' }}>
                  {m.nominatedBy?.name || '—'}{m.decidedBy ? ` / ${m.decidedBy.name}` : ''}
                </td>
                <td style={{ ...S.td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {m.memberStatus === 'Nominated' && data.can.decide && (
                    <>
                      <button style={{ ...primaryBtn(busy), padding: '3px 10px', fontSize: 11.5, marginRight: 6 }} disabled={busy}
                        onClick={() => setDialog({ kind: 'approve', m })}>Approve</button>
                      <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5, marginRight: 6 }} disabled={busy}
                        onClick={() => setDialog({ kind: 'reject', m })}>Turn down</button>
                    </>
                  )}
                  {m.active && (data.can.decide || data.can.nominate) && (
                    <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5 }} disabled={busy}
                      onClick={() => setDialog({ kind: 'remove', m })}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {members.length === 0 && past.length === 0 && (
        <div style={{ padding: '12px 16px', fontSize: 12.5, color: 'var(--ink-muted)' }}>
          {e.firm
            ? 'The firm has accepted. Its Lead nominates its people; each one needs your approval before they can see anything.'
            : data.can.invite ? 'No firm delivers this engagement. Invite one: it sees only the invitation until it accepts.' : 'No firm delivers this engagement.'}
        </div>
      )}

      {dialog?.kind === 'invite' && (
        <FormDialog
          title={`Invite a firm to deliver ${e.ref}?`}
          intro={<>The invitation goes to the firm's organisation and expires in 14 days. Until it is accepted the firm sees only the invitation, and after that only the people you approve can open the engagement.</>}
          submitLabel="Send invitation"
          busy={busy}
          fields={[
            { name: 'firm', label: 'Firm', type: 'select', required: true, options: firms.map((f) => f.id),
              optionLabels: Object.fromEntries(firms.map((f) => [f.id, f.name])) },
            { name: 'style', label: 'Delivery style', type: 'select', options: ['ClientLed', 'ConsultantLed'], optionLabels: STYLE_LABEL,
              help: 'Client-led keeps your records yours: the consultant proposes and you decide. Only you can change it later.' },
            { name: 'message', label: 'Message to the firm', type: 'textarea' },
          ]}
          validate={(v) => (v.firm ? null : 'Choose a firm. Only firms with consulting switched on are listed.')}
          onSubmit={(v) => act(() => apiClient.post('/api/engagements/invitations', {
            projectId, firmTenantId: v.firm, deliveryStyle: v.style, message: v.message?.trim() || undefined,
          }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'revoke' && (
        <ReasonDialog
          title={`Withdraw the invitation to ${dialog.inv.firm.name}?`}
          message="It stays on record. To invite again, send a new one."
          label="Why is it withdrawn?"
          confirmLabel="Withdraw"
          minLength={10}
          busy={busy}
          onConfirm={(reason) => act(() => apiClient.post(`/api/engagements/invitations/${dialog.inv.id}/revoke`, { reason }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'style' && (
        <FormDialog
          title="Change the delivery style?"
          intro={<>Recorded on both organisations' trails. Nothing already approved changes: who approved each item stays as it was.</>}
          submitLabel="Change style"
          busy={busy}
          fields={[
            { name: 'style', label: 'Delivery style', type: 'select', options: ['ClientLed', 'ConsultantLed'], optionLabels: STYLE_LABEL,
              initial: e.deliveryStyle === 'ClientLed' ? 'ConsultantLed' : 'ClientLed' },
            { name: 'reason', label: 'Why', type: 'textarea', required: true },
          ]}
          validate={(v) => (v.reason.trim().length < 10 ? 'Say why, in at least 10 characters.' : null)}
          onSubmit={(v) => act(() => apiClient.patch(`/api/engagements/${projectId}/delivery-style`, { deliveryStyle: v.style, reason: v.reason.trim() }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'approve' && (
        <FormDialog
          title={`Approve ${dialog.m.user.name}?`}
          intro={<>They can open this engagement as {dialog.m.engagementRole} within the window you set. Approving, verifying and accepting stay with your own people whatever their role.</>}
          submitLabel="Approve"
          busy={busy}
          fields={[
            { name: 'role', label: 'Role', type: 'select', options: ['Lead', 'Consultant', 'Reviewer'], initial: dialog.m.engagementRole,
              help: ROLE_HELP[dialog.m.engagementRole] },
            { name: 'from', label: 'Access from', type: 'date' },
            { name: 'to', label: 'Access to', type: 'date', help: 'Left empty: from the engagement start (or today) to 30 days after its target end.' },
          ]}
          onSubmit={(v) => act(() => apiClient.post(`/api/engagements/${projectId}/members/${dialog.m.id}/approve`, {
            engagementRole: v.role, accessFrom: v.from || undefined, accessTo: v.to || undefined,
          }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'reject' && (
        <ReasonDialog
          title={`Turn down ${dialog.m.user.name}?`}
          message="They get no access to this engagement. The firm can nominate someone else."
          label="Why?"
          confirmLabel="Turn down"
          minLength={10}
          busy={busy}
          onConfirm={(reason) => act(() => apiClient.post(`/api/engagements/${projectId}/members/${dialog.m.id}/reject`, { reason }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'remove' && (
        <ReasonDialog
          title={`Remove ${dialog.m.user.name} from ${e.ref}?`}
          message="Their access ends now. It is recorded on both organisations' trails."
          label="Why?"
          confirmLabel="Remove"
          minLength={10}
          busy={busy}
          onConfirm={(reason) => act(() => apiClient.post(`/api/engagements/${projectId}/members/${dialog.m.id}/remove`, { reason }))}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'nominate' && (
        <FormDialog
          title={`Nominate a person to ${e.ref}`}
          intro={<>{e.client} approves each person before they can open the engagement.</>}
          submitLabel="Nominate"
          busy={busy}
          fields={[
            { name: 'user', label: 'Person', type: 'select', required: true, options: people.map((p) => p.id),
              optionLabels: Object.fromEntries(people.map((p) => [p.id, p.name])) },
            { name: 'role', label: 'Role', type: 'select', options: ['Consultant', 'Reviewer'],
              help: `${ROLE_HELP.Consultant} A Reviewer: ${ROLE_HELP.Reviewer}` },
            { name: 'title', label: 'Job title on the engagement', type: 'text', placeholder: 'Senior ISO 27001 consultant' },
          ]}
          validate={(v) => (v.user ? null : 'Choose a person.')}
          onSubmit={(v) => act(() => apiClient.post(`/api/engagements/${projectId}/nominations`, {
            userId: v.user, engagementRole: v.role, roleLabel: v.title?.trim() || undefined,
          }))}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default EngagementPanel;
