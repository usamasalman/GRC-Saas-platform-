import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { ReasonDialog } from '../../../components/Dialog';
import FormDialog from '../../../components/FormDialog';
import { MAY, can } from '../../../components/Can';
import { pill, ghostBtn, apiError } from '../../iam/iamStyles';
import ResumeProposal from './ResumeProposal';
import { HOLD_ACCESS_LABELS } from './holdAccess';

interface Hold {
  id: string;
  startedAt: string;
  endedAt: string | null;
  reason: string;
  resumeReason: string | null;
  startedBy: { name: string } | null;
  endedBy: { name: string } | null;
  firmAccess: string | null;
  windowsSettledAt: string | null;
}

interface ProjectHeader {
  id: string;
  status: string;
  side: 'Client' | 'Provider' | null;
  baselineSetAt: string | null;
  baselineVersion: number;
  providerTenantId: string | null;
  deliveryStyle: string | null;
  /** Days the firm may read it after close, set ahead (sprint 7); null is 90. */
  closeWindowDays: number | null;
  holds: Hold[];
}

type Action = 'hold' | 'resume' | 'rebaseline' | 'close';

/**
 * The engagement's lifecycle, in its header on every tab.
 *
 * The API could put a project on hold, resume, rebaseline and close it, but no
 * screen offered any of them; only "Agree plan & activate" had a button
 * (consulting engagement, sprint 1). Each asks for a reason of at least 10
 * characters, the same rule the server holds, and a hold is kept as an
 * interval so the days the project stood still are nobody's delay.
 *
 * The lifecycle is the organisation's to decide: the buttons are offered to its
 * project managers, and the server refuses anyone else.
 */
const ACTIONS: Record<Action, { label: string; title: string; message: string; field: string; confirm: string }> = {
  hold: {
    label: 'Put on hold',
    title: 'Put the project on hold?',
    message: 'Work stops until it is resumed: no task changes status or progress, and no evidence, verification or blocker is recorded. The plan can still be adjusted. The days on hold are recorded as their own cause of delay, not as either side\'s.',
    field: 'Why is it going on hold?',
    confirm: 'Put on hold',
  },
  resume: {
    label: 'Resume',
    title: 'Resume the project?',
    message: 'Work starts again. The agreed baseline stays as it was; the hold is closed and its days are kept.',
    field: 'Why is it resuming now?',
    confirm: 'Resume',
  },
  rebaseline: {
    label: 'Rebaseline',
    title: 'Rebaseline the plan?',
    message: 'The current dates become the agreed plan, and the plan version goes up by one. Slippage is measured from the new baseline from now on.',
    field: 'Why is the plan being reset?',
    confirm: 'Rebaseline',
  },
  close: {
    label: 'Close',
    title: 'Close the project?',
    message: 'A closed engagement is a record: it cannot be reopened, its completion date is stamped today, and its reports lose the DRAFT banner.',
    field: 'Why is it closing, and in what state?',
    confirm: 'Close project',
  },
};

// When a hold began is an instant, read in the reader's own day: as a UTC
// calendar date it showed yesterday east of Greenwich late at night.
const heldSince = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

// Every change remounts this header (the page keys it by a version), so the
// proposal to open after a resume is remembered across that remount.
const proposeAfterResume = new Set<string>();

const ProjectLifecycle: React.FC<{ projectId: string; onChanged: () => void }> = ({ projectId, onChanged }) => {
  const [project, setProject] = useState<ProjectHeader | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // After a consulting engagement resumes: its people's end dates (S5).
  const [proposing, setProposing] = useState(false);

  const load = useCallback(async (first = false) => {
    try {
      const res = await apiClient.get(`/api/projects/${projectId}`);
      const p: ProjectHeader | null = res.data?.project || null;
      setProject(p);
      if (first && p?.status === 'Active' && proposeAfterResume.delete(projectId)) setProposing(true);
    } catch {
      setProject(null);
    }
  }, [projectId]);

  useEffect(() => { load(true); }, [load]);

  const act = async (reason: string, holdFirmAccess?: string, afterCloseDays?: number) => {
    if (!action) return;
    setBusy(true);
    setError('');
    try {
      // holdFirmAccess is left out (undefined) when no firm delivers it.
      if (action === 'hold') await apiClient.patch(`/api/projects/${projectId}`, { status: 'OnHold', reason, holdFirmAccess });
      if (action === 'resume') await apiClient.patch(`/api/projects/${projectId}`, { status: 'Active', reason });
      if (action === 'rebaseline') await apiClient.post(`/api/projects/${projectId}/rebaseline`, { reason });
      // afterCloseDays is left out (undefined) when no firm delivers it.
      if (action === 'close') await apiClient.post(`/api/projects/${projectId}/close`, { outcome: 'Closed', closureNote: reason, afterCloseDays });
      setAction(null);
      if (action === 'resume' && project?.deliveryStyle && project.providerTenantId) proposeAfterResume.add(projectId);
      await load();
      onChanged();
    } catch (err) {
      setAction(null);
      setError(apiError(err, 'That could not be done.'));
    } finally {
      setBusy(false);
    }
  };

  if (!project) return null;

  const open = project.holds.find((h) => !h.endedAt) || null;
  const mayDecide = project.side === 'Client' && can(MAY.MANAGE_PROJECT);
  const withFirm = Boolean(project.providerTenantId);
  // A hold whose days were never offered to the firm's people: the proposal
  // can be opened again until it is confirmed either way.
  const proposalWaiting = mayDecide && withFirm && Boolean(project.deliveryStyle) && project.status === 'Active'
    && project.holds.some((h) => h.endedAt && !h.windowsSettledAt);
  const offered: { key: Action; disabled?: string }[] = [];
  if (project.status === 'Active') {
    offered.push({ key: 'hold' });
    if (project.baselineSetAt) offered.push({ key: 'rebaseline' });
    offered.push({ key: 'close' });
  } else if (project.status === 'OnHold') {
    offered.push({ key: 'resume' });
    if (project.baselineSetAt) offered.push({ key: 'rebaseline' });
    offered.push({ key: 'close', disabled: 'Resume the project before closing it.' });
  }

  const statusPill = project.status === 'OnHold'
    ? pill('var(--warning)', 'var(--warning-line)')
    : project.status === 'Active'
      ? pill('var(--success)', 'var(--success-line)')
      : pill('var(--ink-muted)', 'var(--line)');

  return (
    <>
      <span style={statusPill}>{project.status === 'OnHold' ? 'On hold' : project.status}</span>
      {open && (
        <span style={{ fontSize: 11.5, color: 'var(--ink-muted)', maxWidth: 320 }} title={open.reason}>
          since {heldSince(open.startedAt)}: {open.reason.length > 60 ? `${open.reason.slice(0, 60)}…` : open.reason}
        </span>
      )}
      {mayDecide && offered.map(({ key, disabled }) => (
        <button
          key={key}
          style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12, opacity: disabled || busy ? 0.5 : 1 }}
          disabled={Boolean(disabled) || busy}
          title={disabled}
          // Close re-reads the project first, so its dialog offers the window
          // after close as set now, not as it was when the header loaded.
          onClick={async () => { setError(''); if (key === 'close') await load(); setAction(key); }}
        >
          {ACTIONS[key].label}
        </button>
      ))}
      {proposalWaiting && (
        <button
          style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }}
          disabled={busy}
          onClick={() => { setError(''); setProposing(true); }}
        >
          Access after the hold
        </button>
      )}
      {error && <span style={{ fontSize: 11.5, color: 'var(--danger)', maxWidth: 320 }}>{error}</span>}
      {action === 'hold' && withFirm && (
        <FormDialog
          title={ACTIONS.hold.title}
          intro={`${ACTIONS.hold.message} Choose what the delivery firm may do until it resumes; you can change it during the hold, and on resume the firm's people get back exactly the access they had.`}
          fields={[
            { name: 'reason', label: ACTIONS.hold.field, type: 'textarea', required: true },
            {
              name: 'firmAccess', label: 'While on hold', type: 'select', options: ['View', 'None'], initial: 'View',
              optionLabels: HOLD_ACCESS_LABELS,
              help: 'Read-only: the firm sees the engagement and changes nothing. No access: it disappears from the firm\'s lists until it resumes.',
            },
          ]}
          submitLabel={busy ? 'Working…' : ACTIONS.hold.confirm}
          busy={busy}
          validate={(v) => (v.reason.trim().length < 10 ? 'Give a little more detail — at least 10 characters.' : null)}
          onSubmit={(v) => act(v.reason.trim(), v.firmAccess)}
          onCancel={() => setAction(null)}
        />
      )}
      {action === 'close' && withFirm && (
        <FormDialog
          title={ACTIONS.close.title}
          intro={`${ACTIONS.close.message} The delivery firm keeps its own record of the engagement and may still read it, read-only, for the days below; after that its people get nothing of yours.`}
          fields={[
            { name: 'reason', label: ACTIONS.close.field, type: 'textarea', required: true },
            {
              name: 'days', label: 'Firm can read it for (days)', type: 'number', required: true,
              initial: String(project.closeWindowDays ?? 90),
              help: 'Read-only, from today: 0 to 365 days. Only your organisation can extend it later, up to 365 days after close, or revoke it.',
            },
          ]}
          submitLabel={busy ? 'Working…' : ACTIONS.close.confirm}
          busy={busy}
          validate={(v) => {
            if (v.reason.trim().length < 10) return 'Give a little more detail — at least 10 characters.';
            const n = Number(v.days);
            return Number.isInteger(n) && n >= 0 && n <= 365 ? null : 'The firm can read it for 0 to 365 days.';
          }}
          onSubmit={(v) => act(v.reason.trim(), undefined, Number(v.days))}
          onCancel={() => setAction(null)}
        />
      )}
      {proposing && (
        <ResumeProposal
          projectId={projectId}
          onDone={() => { setProposing(false); load(); }}
          onRebaseline={project.baselineSetAt ? () => { setProposing(false); setAction('rebaseline'); } : undefined}
        />
      )}
      {action && !((action === 'hold' || action === 'close') && withFirm) && (
        <ReasonDialog
          title={ACTIONS[action].title}
          message={ACTIONS[action].message}
          label={ACTIONS[action].field}
          confirmLabel={busy ? 'Working…' : ACTIONS[action].confirm}
          minLength={10}
          busy={busy}
          onConfirm={act}
          onCancel={() => setAction(null)}
        />
      )}
    </>
  );
};

export default ProjectLifecycle;
