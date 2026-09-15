import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../../api/apiClient';
import FormDialog from '../../../components/FormDialog';
import { ConfirmDialog } from '../../../components/Dialog';
import Can, { MAY } from '../../../components/Can';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';

/**
 * Who is on this engagement, and how much of them it has.
 *
 * ProjectMember modelled all of this from the start — side, role, R/A/C/I,
 * allocation, and an active flag so removal keeps history — and was written in
 * exactly one place in the API and read nowhere. The portfolio rendered a
 * member count, so the product displayed the size of a set nobody could change
 * and which could only ever be two: the owner and the manager, added at
 * creation.
 *
 * The owner's complaint was precisely this: "who will be inculde and manage ...
 * one person works on differrent project this will be specify that
 * organization which have the resourses".
 */

interface Member {
  id: string;
  userId: string;
  userName: string;
  email: string | null;
  side: string;
  roleLabel: string;
  raci: string;
  allocation: number | null;
  active: boolean;
}

interface Candidate { id: string; name: string; email: string; tenantId: string }

const RACI_MEANS: Record<string, string> = {
  R: 'Responsible — does the work',
  A: 'Accountable — answers for it',
  C: 'Consulted — asked before decisions',
  I: 'Informed — told after them',
};

const ProjectTeam: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [accountable, setAccountable] = useState<{ ownerId: string; managerId: string } | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
  const [sides, setSides] = useState<string[]>(['Client']);
  const [raciOptions, setRaciOptions] = useState<string[]>(['R', 'A', 'C', 'I']);

  const [people, setPeople] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get(`/api/projects/${projectId}/members`);
      setMembers(res.data?.members || []);
      setAccountable(res.data?.accountable || null);
      setHasProvider(Boolean(res.data?.hasProvider));
      setSides(res.data?.sides || ['Client']);
      setRaciOptions(res.data?.raci || ['R', 'A', 'C', 'I']);
      setLoaded(true);
    } catch (err) {
      setError(apiError(err, 'Could not load the team.'));
      setMembers([]);
      setLoaded(false);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // The people who could be added. Caught separately: the team is still worth
  // showing without it, with the add control turned off rather than offering a
  // list the screen cannot vouch for.
  useEffect(() => {
    apiClient.get('/api/auth/tenant-users')
      .then((res) => setPeople(res.data?.users || []))
      .catch(() => setPeople([]));
  }, []);

  const active = useMemo(() => members.filter((m) => m.active), [members]);
  const past = useMemo(() => members.filter((m) => !m.active), [members]);

  const isAccountable = (m: Member) => accountable !== null
    && (m.userId === accountable.ownerId || m.userId === accountable.managerId);

  const stated = active.filter((m) => m.allocation !== null);
  const totalStated = stated.reduce((n, m) => n + (m.allocation || 0), 0);

  const submit = async (
    values: Record<string, string>,
    member: Member | null,
  ) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = {
        roleLabel: values.roleLabel,
        raci: values.raci,
        side: values.side,
        // An empty box means unstated, which is not the same as zero.
        allocation: values.allocation === '' ? null : Number(values.allocation),
      };
      if (member) {
        await apiClient.patch(`/api/projects/${projectId}/members/${member.id}`, body);
        setNotice('Team member updated.');
      } else {
        const match = people.find((p) => `${p.name} · ${p.email}` === values.person);
        if (!match) {
          setError('That person was not found in the list.');
          return;
        }
        const res = await apiClient.post(`/api/projects/${projectId}/members`, {
          ...body, userId: match.id,
        });
        setNotice(res.data?.message || 'Added to the engagement.');
      }
      setAdding(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(apiError(err, 'The change could not be made.'));
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => { setError(''); setAdding(true); };
  const openEdit = (m: Member) => { setError(''); setEditing(m); };
  const openRemove = (m: Member) => { setError(''); setRemoving(m); };

  const remove = async (m: Member) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiClient.delete(`/api/projects/${projectId}/members/${m.id}`);
      setNotice(res.data?.message || 'Taken off the engagement.');
      setRemoving(null);
      await load();
    } catch (err) {
      setError(apiError(err, 'Could not remove them.'));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };

  const fields = (m: Member | null) => [
    ...(m ? [] : [{
      name: 'person',
      label: 'Person',
      type: 'select' as const,
      options: people.map((p) => `${p.name} · ${p.email}`),
      help: 'Only people from the organisations on this engagement can be added; the server '
        + 'refuses anyone else.',
    }]),
    {
      name: 'roleLabel',
      label: 'Role on this engagement',
      value: m?.roleLabel || '',
      help: 'What they do here — "Lead Consultant", "ISMS Manager". A list of names without roles '
        + 'cannot be read by anybody who was not there.',
    },
    {
      name: 'raci',
      label: 'RACI',
      type: 'select' as const,
      options: raciOptions,
      value: m?.raci || 'R',
      help: raciOptions.map((r) => RACI_MEANS[r] || r).join(' · '),
    },
    ...(hasProvider ? [{
      name: 'side',
      label: 'Side',
      type: 'select' as const,
      options: sides,
      value: m?.side || 'Client',
      help: 'Which organisation they answer to on this engagement.',
    }] : []),
    {
      name: 'allocation',
      label: 'Allocation (%)',
      value: m?.allocation === null || m?.allocation === undefined ? '' : String(m.allocation),
      help: 'Leave blank where the organisation does not track it. Blank is not zero — an unstated '
        + 'allocation is counted separately rather than read as free time.',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>Team</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-muted)', maxWidth: 620, lineHeight: 1.6 }}>
            Who is on this engagement and what they answer for. The owner and the manager are on it
            by definition and are changed on the engagement itself.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn} disabled={busy}>↻ Refresh</button>
          <Can do={MAY.MANAGE_PROJECT}>
            <button
              onClick={openAdd}
              disabled={busy || !loaded || people.length === 0}
              title={people.length === 0 ? 'The people list could not be loaded' : undefined}
              style={primaryBtn(busy || !loaded || people.length === 0)}
            >
              + Add someone
            </button>
          </Can>
        </div>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>
          {notice} <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      {loaded && (
        <StatStrip items={[
          ['On the engagement', active.length],
          // The denominator travels with it: "180% across 2 of 5" is readable,
          // a bare 180% is not.
          ['Allocation stated', stated.length === 0
            ? <span style={{ color: 'var(--ink-muted)' }}>none</span>
            : <>{totalStated}% across {stated.length} of {active.length}</>],
          ['Previously on it', past.length],
        ]} />
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 24 }}>Loading the team…</div>
      ) : !loaded ? (
        <div style={{ ...S.card, padding: 20, color: 'var(--ink-muted)', fontSize: 13 }}>
          The team could not be loaded, so nothing is shown and nothing can be changed from here.
        </div>
      ) : (
        <div style={S.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={S.headRow}>
                <th style={S.th}>Person</th>
                <th style={S.th}>Role</th>
                <th style={S.th}>RACI</th>
                {hasProvider && <th style={S.th}>Side</th>}
                <th style={S.th}>Allocation</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {active.length === 0 ? (
                <tr>
                  <td colSpan={hasProvider ? 6 : 5} style={{ padding: 22, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    Nobody is on this engagement.
                  </td>
                </tr>
              ) : active.map((m) => (
                <tr key={m.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <strong style={{ color: 'var(--ink)' }}>{m.userName}</strong>
                    {isAccountable(m) && (
                      <span style={{ marginLeft: 6 }}>
                        <span style={pill('var(--info)', 'var(--info)')}>
                          {accountable && m.userId === accountable.ownerId ? 'owner' : 'manager'}
                        </span>
                      </span>
                    )}
                    {m.email && <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{m.email}</div>}
                  </td>
                  <td style={{ ...S.td, color: 'var(--ink-body)' }}>{m.roleLabel}</td>
                  <td style={S.td} title={RACI_MEANS[m.raci] || ''}>
                    <span style={pill(m.raci === 'A' ? 'var(--violet)' : 'var(--ink-muted)', 'var(--line)')}>{m.raci}</span>
                  </td>
                  {hasProvider && <td style={{ ...S.td, color: 'var(--ink-muted)', fontSize: 12 }}>{m.side}</td>}
                  <td style={S.td}>
                    {m.allocation === null
                      ? <span style={{ color: 'var(--ink-faint)' }}>not stated</span>
                      : <span style={{ color: 'var(--ink-body)' }}>{m.allocation}%</span>}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Can do={MAY.MANAGE_PROJECT}>
                      <button onClick={() => openEdit(m)} disabled={busy} style={linkBtn('var(--ink-body)')}>edit</button>
                      {/* Offered only where it can succeed. The owner and the
                          manager are on the team by definition and the server
                          refuses; a button whose only outcome is a refusal is
                          worse than no button. */}
                      {!isAccountable(m) && (
                        <button onClick={() => openRemove(m)} disabled={busy} style={linkBtn('var(--danger)')}>remove</button>
                      )}
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {past.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--ink-muted)', lineHeight: 1.7 }}>
          {/* Kept, because who was on an engagement while a decision was taken
              has to stay answerable after they leave it. */}
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Previously on this engagement</div>
          {past.map((m) => (
            <div key={m.id}>{m.userName} · {m.roleLabel}</div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <FormDialog
          title={editing ? `Change ${editing.userName}` : 'Add someone to the engagement'}
          submitLabel={busy ? 'Saving…' : (editing ? 'Save' : 'Add to engagement')}
          busy={busy}
          fields={fields(editing) as any}
          onSubmit={(v) => submit(v as Record<string, string>, editing)}
          onCancel={() => { setAdding(false); setEditing(null); }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Take ${removing.userName} off this engagement?`}
          confirmLabel="Remove"
          destructive
          busy={busy}
          message={(
            <>
              They stop being on the team. Their assignment history is kept, so who was on the
              engagement while a decision was taken stays answerable afterwards.
            </>
          )}
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
};

export default ProjectTeam;
