import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { ReasonDialog } from '../../../components/Dialog';
import { MAY, can } from '../../../components/Can';
import { pill, ghostBtn, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';

interface Hold {
  id: string;
  startedAt: string;
  endedAt: string | null;
  reason: string;
  resumeReason: string | null;
  startedBy: { name: string } | null;
  endedBy: { name: string } | null;
}

interface ProjectHeader {
  id: string;
  status: string;
  side: 'Client' | 'Provider' | null;
  baselineSetAt: string | null;
  baselineVersion: number;
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

const ProjectLifecycle: React.FC<{ projectId: string; onChanged: () => void }> = ({ projectId, onChanged }) => {
  const [project, setProject] = useState<ProjectHeader | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/projects/${projectId}`);
      setProject(res.data?.project || null);
    } catch {
      setProject(null);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const act = async (reason: string) => {
    if (!action) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'hold') await apiClient.patch(`/api/projects/${projectId}`, { status: 'OnHold', reason });
      if (action === 'resume') await apiClient.patch(`/api/projects/${projectId}`, { status: 'Active', reason });
      if (action === 'rebaseline') await apiClient.post(`/api/projects/${projectId}/rebaseline`, { reason });
      if (action === 'close') await apiClient.post(`/api/projects/${projectId}/close`, { outcome: 'Closed', closureNote: reason });
      setAction(null);
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
          since {calendarDate(open.startedAt)}: {open.reason.length > 60 ? `${open.reason.slice(0, 60)}…` : open.reason}
        </span>
      )}
      {mayDecide && offered.map(({ key, disabled }) => (
        <button
          key={key}
          style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12, opacity: disabled || busy ? 0.5 : 1 }}
          disabled={Boolean(disabled) || busy}
          title={disabled}
          onClick={() => { setError(''); setAction(key); }}
        >
          {ACTIONS[key].label}
        </button>
      ))}
      {error && <span style={{ fontSize: 11.5, color: 'var(--danger)', maxWidth: 320 }}>{error}</span>}
      {action && (
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
