import React, { useState } from 'react';
import DialogShell from '../../components/Dialog';
import { S, primaryBtn, ghostBtn } from '../iam/iamStyles';

/**
 * Correct a control's title, objective and domain.
 *
 * The code is shown but not editable, and the server does not accept it either.
 * Implementations, test results, evidence and the coverage report all address a
 * control by its code; renaming it would leave a year of test history filed
 * under a code that no longer appears anywhere. A control that needs a
 * different code is a different control -- clone it and retire this one.
 */
const ControlEditDialog: React.FC<{
  control: { id: string; code: string; title: string; objective: string; domain: string };
  busy?: boolean;
  onSubmit: (title: string, objective: string, domain: string) => void;
  onCancel: () => void;
}> = ({ control, busy, onSubmit, onCancel }) => {
  const [title, setTitle] = useState(control.title || '');
  const [objective, setObjective] = useState(control.objective || '');
  const [domain, setDomain] = useState(control.domain || '');
  const [touched, setTouched] = useState(false);

  const problem = !title.trim()
    ? 'A control needs a title.'
    : !objective.trim()
      ? 'A control needs an objective — it is what an assessor tests against.'
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    onSubmit(title.trim(), objective.trim(), domain.trim());
  };

  const label: React.CSSProperties = {
    display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 4,
  };

  return (
    <DialogShell title={`Edit ${control.code}`} onClose={busy ? () => undefined : onCancel} width={560}>
      <form onSubmit={submit}>
        <div style={{
          fontSize: 11.5, color: 'var(--ink-faint)', marginBottom: 14, lineHeight: 1.5,
        }}>
          The code <strong style={{ color: 'var(--ink-muted)', fontFamily: 'ui-monospace, monospace' }}>
            {control.code}
          </strong>{' '}
          stays as it is. Implementations, test results and the coverage report all address this
          control by it.
        </div>

        <label style={label}>Title</label>
        <input
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setTouched(true)}
          style={{ ...S.input, marginBottom: 12 }}
        />

        <label style={label}>Objective</label>
        <textarea
          rows={4}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          onBlur={() => setTouched(true)}
          style={{ ...S.input, marginBottom: 6, resize: 'vertical' }}
        />
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginBottom: 14, lineHeight: 1.5 }}>
          What this control is for. An assessor reads it to decide whether the evidence offered
          actually demonstrates the control works.
        </div>

        <label style={label}>Domain</label>
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          style={{ ...S.input, marginBottom: 16 }}
          placeholder="Access Control"
        />

        {touched && problem && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{problem}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" style={primaryBtn(busy || !!problem)} disabled={busy || !!problem}>
            {busy ? 'Saving…' : 'Save control'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
};

export default ControlEditDialog;
