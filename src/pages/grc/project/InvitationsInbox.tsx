import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import fetchAllPages from '../../../api/fetchAllPages';
import { ReasonDialog, ConfirmDialog } from '../../../components/Dialog';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';
import EngagementPanel, { STYLE_LABEL } from './EngagementPanel';

/**
 * Invitations to deliver an engagement, and the ones this organisation sent
 * (consulting engagement, sprint 4).
 *
 * A firm sees an invitation's summary only: the client, the engagement's name
 * and dates, the delivery style offered and the message, never the engagement
 * itself. Accepting makes the person who accepts the firm's Lead, for the
 * client to approve; the Lead then nominates the firm's people from here, and
 * each needs the client's approval before they can open the engagement.
 */

interface Row {
  id: string; projectId: string; state: string; deliveryStyle: string; message: string | null;
  invitedAt: string; expiresAt: string; responseNote: string | null; revokeReason: string | null; iAmLead: boolean;
  client: { id: string; name: string }; firm: { id: string; name: string };
  invitedBy: { name: string } | null; respondedBy: { name: string } | null;
  project: { ref: string; name: string; startDate: string; targetEndDate: string };
}

const TONE: Record<string, [string, string]> = {
  Pending: ['var(--warning)', 'var(--warning-line)'], Accepted: ['var(--success)', 'var(--success-line)'],
};

const InvitationsInbox: React.FC = () => {
  const [received, setReceived] = useState<Row[] | null>(null);
  const [sent, setSent] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'accept' | 'decline'; row: Row }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      // Every page of each box: this is the list itself (QA-021).
      const [inbox, outbox] = await Promise.all([
        fetchAllPages<Row>('/api/engagements/invitations', 'invitations', { box: 'received' }),
        fetchAllPages<Row>('/api/engagements/invitations', 'invitations', { box: 'sent' }),
      ]);
      setReceived(inbox);
      setSent(outbox);
    } catch (err) {
      setReceived([]);
      setError(apiError(err, 'Could not load invitations.'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const answer = async (row: Row, kind: 'accept' | 'decline', reason?: string) => {
    setBusy(true);
    setError('');
    try {
      await apiClient.post(`/api/engagements/invitations/${row.id}/${kind}`, kind === 'decline' ? { reason } : {});
      setDialog(null);
      setNotice(kind === 'accept'
        ? `Accepted. You are ${row.firm.name}'s Lead on ${row.project.ref}, awaiting ${row.client.name}'s approval. Nominate your people below.`
        : 'Declined. It stays on record.');
      if (kind === 'accept') setOpen(row.projectId);
      await load();
    } catch (err) {
      setDialog(null);
      setError(apiError(err, 'That could not be done.'));
    } finally {
      setBusy(false);
    }
  };

  if (received === null) return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading invitations…</div>;

  const card = (r: Row, side: 'firm' | 'client') => (
    <div key={r.id} style={{ borderTop: '1px solid var(--line-soft)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={pill(...(TONE[r.state] || ['var(--ink-muted)', 'var(--line)']))}>{r.state}</span>
        <strong style={{ fontSize: 13 }}>{side === 'firm' ? r.client.name : r.firm.name}</strong>
        <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{r.project.ref} · {r.project.name}</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
          {calendarDate(r.project.startDate)} → {calendarDate(r.project.targetEndDate)} · {STYLE_LABEL[r.deliveryStyle] || r.deliveryStyle}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {side === 'firm' && r.state === 'Pending' && (
            <>
              <button style={primaryBtn(busy)} disabled={busy} onClick={() => setDialog({ kind: 'accept', row: r })}>Accept</button>
              <button style={ghostBtn} disabled={busy} onClick={() => setDialog({ kind: 'decline', row: r })}>Decline</button>
            </>
          )}
          {side === 'firm' && r.state === 'Accepted' && r.iAmLead && (
            <button style={ghostBtn} onClick={() => setOpen(open === r.projectId ? null : r.projectId)}>
              {open === r.projectId ? 'Hide the team' : 'Manage the team'}
            </button>
          )}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 4 }}>
        Sent {calendarDate(r.invitedAt)}{r.invitedBy ? ` by ${r.invitedBy.name}` : ''}
        {r.state === 'Pending' ? ` · answer by ${calendarDate(r.expiresAt)}` : ''}
        {r.respondedBy ? ` · answered by ${r.respondedBy.name}` : ''}
        {r.responseNote ? ` · "${r.responseNote}"` : ''}{r.revokeReason ? ` · withdrawn: ${r.revokeReason}` : ''}
      </div>
      {r.message && <div style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 6 }}>{r.message}</div>}
      {side === 'firm' && open === r.projectId && r.state === 'Accepted' && (
        <div style={{ marginTop: 10 }}><EngagementPanel projectId={r.projectId} onChanged={load} /></div>
      )}
    </div>
  );

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}
      {notice && <div style={{ ...S.card, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: 'var(--success)' }}>{notice}</div>}
      <div style={{ ...S.card, marginBottom: 14, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>Invitations received</div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
            To your organisation, from organisations asking you to deliver an engagement. You see the engagement once you accept
            and the client approves you.
          </div>
        </div>
        {received.length === 0 && <div style={{ padding: '0 16px 12px', fontSize: 12.5, color: 'var(--ink-faint)' }}>None.</div>}
        {received.map((r) => card(r, 'firm'))}
      </div>
      {sent.length > 0 && (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>Invitations sent</div>
          {sent.map((r) => card(r, 'client'))}
        </div>
      )}

      {dialog?.kind === 'accept' && (
        <ConfirmDialog
          title={`Accept ${dialog.row.project.ref} for ${dialog.row.firm.name}?`}
          message={`You become the firm's Lead on this engagement, awaiting ${dialog.row.client.name}'s approval. Nobody from the firm, you included, can open it until ${dialog.row.client.name} approves them.`}
          confirmLabel={busy ? 'Accepting…' : 'Accept'}
          busy={busy}
          onConfirm={() => answer(dialog.row, 'accept')}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'decline' && (
        <ReasonDialog
          title={`Decline ${dialog.row.project.ref}?`}
          message="The organisation is told, and the invitation stays on record."
          label="Why are you declining?"
          confirmLabel="Decline"
          minLength={3}
          busy={busy}
          onConfirm={(reason) => answer(dialog.row, 'decline', reason)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default InvitationsInbox;
