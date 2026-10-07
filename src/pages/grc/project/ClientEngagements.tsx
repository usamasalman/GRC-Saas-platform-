import React, { useEffect, useState } from 'react';
import fetchAllPages from '../../../api/fetchAllPages';
import { S, ghostBtn, primaryBtn, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';
import EngagementPanel, { STYLE_LABEL } from './EngagementPanel';

/**
 * The delivery firm's engagements across every client (consulting
 * engagement, sprint 6), one card each.
 *
 * A card is the firm's own record: the engagement, the client, its dates,
 * who invited the firm, its Lead and where the reader stands. Before a
 * person's access starts the card is all they see, with "Access starts on";
 * the firm's Lead can still set up the firm's team from it, because that is
 * the firm's data, not the client's. Opening the workspace is decided by the
 * server on every request.
 */

export interface EngagementCard {
  id: string; ref: string; name: string; client: string; status: string; startDate: string; targetEndDate: string;
  deliveryStyle: string | null; invitedBy: string | null; lead: string | null;
  me: { memberId: string; engagementRole: string | null; memberStatus: string; accessFrom: string | null; accessTo: string | null } | null;
  state: 'AwaitingApproval' | 'NotStarted' | 'Open' | 'Ended' | 'NoAccessOnHold' | 'NotOnTeam' | 'OldWay';
  canOpen: boolean; accessEndsSoon: boolean;
}

const fmt = (d: string | null | undefined) => calendarDate(d, { day: '2-digit', month: 'short', year: 'numeric' });

const STATE: Record<EngagementCard['state'], [string, string, string]> = {
  Open: ['Open', 'var(--success)', 'var(--success-line)'],
  NotStarted: ['Not started', 'var(--warning)', 'var(--warning-line)'],
  AwaitingApproval: ['Awaiting approval', 'var(--warning)', 'var(--warning-line)'],
  Ended: ['Access ended', 'var(--danger)', 'var(--danger-line)'],
  NoAccessOnHold: ['On hold, no access', 'var(--danger)', 'var(--danger-line)'],
  NotOnTeam: ['Not on the team', 'var(--ink-muted)', 'var(--line)'],
  OldWay: ['Set up the old way', 'var(--ink-muted)', 'var(--line)'],
};

export function stateLine(c: EngagementCard): string {
  if (c.state === 'NotStarted') return `Access starts on ${fmt(c.me?.accessFrom)}`;
  if (c.state === 'AwaitingApproval') return `Waiting for ${c.client} to approve you`;
  if (c.state === 'Ended') return `Access ended ${fmt(c.me?.accessTo)}`;
  if (c.state === 'NoAccessOnHold') return `${c.client} has put it on hold with no access for the firm`;
  if (c.state === 'Open') return c.me?.accessTo ? `Access ends ${fmt(c.me.accessTo)}` : 'Access open';
  if (c.state === 'OldWay') return 'Open to the whole firm until the organisation moves it onto approved people';
  return c.lead ? `Led by ${c.lead}` : 'Not on the team';
}

const ClientEngagements: React.FC<{ onOpen: (p: { id: string; ref: string; name: string }) => void }> = ({ onOpen }) => {
  const [rows, setRows] = useState<EngagementCard[] | null>(null);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState<string | null>(null);

  useEffect(() => {
    fetchAllPages<EngagementCard>('/api/engagements/mine', 'engagements')
      .then(setRows)
      .catch((err) => { setError(apiError(err, 'Could not load your engagements.')); setRows([]); });
  }, []);

  if (!rows) return <div style={{ color: 'var(--ink-muted)', padding: 20 }}>Loading…</div>;
  return (
    <div>
      {error && <div style={S.error}>{error}</div>}
      {rows.length === 0 && (
        <div style={{ ...S.card, padding: 16, fontSize: 13, color: 'var(--ink-muted)' }}>
          No client engagements yet. An organisation invites your firm; accepted invitations appear here.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
        {rows.map((c) => {
          const [label, fg, line] = STATE[c.state];
          const leadSetsUp = c.me?.engagementRole === 'Lead' && c.me.memberStatus === 'Approved' && !c.canOpen;
          return (
            <div key={c.id} style={{ ...S.card, padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{c.client}</div>
                  <strong style={{ fontSize: 14, color: 'var(--ink)' }}>{c.name}</strong>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-faint)' }}>{c.ref}</div>
                </div>
                <span style={pill(fg, line)}>{label}</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-body)' }}>
                {fmt(c.startDate)} → {fmt(c.targetEndDate)}
                {c.deliveryStyle ? ` · ${STYLE_LABEL[c.deliveryStyle] || c.deliveryStyle}` : ''}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                {c.invitedBy ? `Invited by ${c.invitedBy}` : ''}{c.lead ? ` · Lead ${c.lead}` : ''}
              </div>
              <div style={{ fontSize: 12.5, color: c.accessEndsSoon ? 'var(--warning)' : 'var(--ink-body)' }}>{stateLine(c)}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {c.canOpen && <button style={primaryBtn(false)} onClick={() => onOpen(c)}>Open workspace</button>}
                {leadSetsUp && (
                  <button style={ghostBtn} onClick={() => setSetup(setup === c.id ? null : c.id)}>
                    {setup === c.id ? 'Hide the team' : 'Set up your team'}
                  </button>
                )}
              </div>
              {setup === c.id && <div style={{ marginTop: 8 }}><EngagementPanel projectId={c.id} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ClientEngagements;
