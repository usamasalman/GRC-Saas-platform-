import React, { useState } from 'react';
import DialogShell from './Dialog';
import { S, primaryBtn, ghostBtn } from '../pages/iam/iamStyles';

/**
 * A small declarative form in a dialog.
 *
 * This exists for the chained-prompt pattern, which is the worst of the native
 * dialogs still in the app. Recording a management response asked three
 * questions in a row: the response type, then the narrative, then the action
 * plan — three separate blocking popups, each one closing before the next
 * appeared. You could not see what you had already answered, could not go back,
 * and cancelling the third threw away the first two. The type was typed as free
 * text and validated after the fact, so "agreed" was accepted by the prompt and
 * rejected by the server a moment later.
 *
 * One dialog, all the fields, validated before anything is sent.
 *
 * Deliberately small. It covers text, long text, a fixed choice, a number and a
 * date, which is what the prompts it replaces were collecting. A screen needing
 * more than that should have a real form rather than bend this one — the point
 * is to remove popups, not to grow a form framework.
 */

export type Field =
  | { name: string; label: string; type: 'text' | 'textarea' | 'number' | 'date'; required?: boolean; placeholder?: string; help?: React.ReactNode; initial?: string }
  | { name: string; label: string; type: 'select'; options: readonly string[]; required?: boolean; help?: React.ReactNode; initial?: string };

export interface FormDialogProps {
  title: string;
  /** Shown above the fields: what this is for, in the caller's words. */
  intro?: React.ReactNode;
  fields: readonly Field[];
  submitLabel?: string;
  /** Marks the action as destructive: red submit button. */
  destructive?: boolean;
  busy?: boolean;
  /** Cross-field validation. Return a message to refuse, or null to accept. */
  validate?: (values: Record<string, string>) => string | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
  /** A server refusal, rendered inside the still-open dialog. */
  error?: string;
}

const FormDialog: React.FC<FormDialogProps> = ({
  title, intro, fields, submitLabel = 'Save', destructive, busy, validate,
  onSubmit, onCancel, error,
}) => {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) {
      // A select defaults to its first option rather than to empty. An empty
      // select that looks like it has an answer selected is how a form gets
      // submitted with a value nobody chose.
      initial[f.name] = f.initial ?? (f.type === 'select' ? (f.options[0] ?? '') : '');
    }
    return initial;
  });
  const [touched, setTouched] = useState(false);

  const missing = fields.find((f) => f.required && !String(values[f.name] ?? '').trim());
  const problem = missing
    ? `${missing.label} is required.`
    : validate
      ? validate(values)
      : null;

  const set = (name: string, v: string) => setValues((prev) => ({ ...prev, [name]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    const trimmed: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) trimmed[k] = String(v ?? '').trim();
    onSubmit(trimmed);
  };

  const label: React.CSSProperties = {
    display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 4,
  };
  const help: React.CSSProperties = {
    fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 4, marginBottom: 12, lineHeight: 1.5,
  };

  return (
    <DialogShell title={title} onClose={busy ? () => undefined : onCancel} width={540}>
      {intro && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.6, marginBottom: 16 }}>
          {intro}
        </div>
      )}

      {error && (
        <div style={{
          background: 'var(--danger-bg)', border: '1px solid var(--danger-line)',
          color: 'var(--danger)', borderRadius: 6, padding: '10px 12px',
          fontSize: 12.5, marginBottom: 14, lineHeight: 1.6,
        }}>
          {error}
        </div>
      )}

      <form onSubmit={submit}>
        {fields.map((f, i) => (
          <div key={f.name}>
            <label style={label} htmlFor={`fd-${f.name}`}>
              {f.label}
              {f.required && <span style={{ color: 'var(--danger)' }}> *</span>}
            </label>

            {f.type === 'textarea' ? (
              <textarea
                id={`fd-${f.name}`}
                rows={4}
                style={{ ...S.input, width: '100%', resize: 'vertical' }}
                value={values[f.name] ?? ''}
                autoFocus={i === 0}
                placeholder={f.placeholder}
                onChange={(e) => set(f.name, e.target.value)}
                onBlur={() => setTouched(true)}
              />
            ) : f.type === 'select' ? (
              // A fixed set of answers is a select, not free text. The prompts
              // these replace asked people to type one of three words and told
              // them afterwards if they had typed it wrong.
              <select
                id={`fd-${f.name}`}
                style={{ ...S.input, width: '100%' }}
                value={values[f.name] ?? ''}
                autoFocus={i === 0}
                onChange={(e) => set(f.name, e.target.value)}
              >
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                id={`fd-${f.name}`}
                type={f.type}
                style={{ ...S.input, width: '100%' }}
                value={values[f.name] ?? ''}
                autoFocus={i === 0}
                placeholder={f.placeholder}
                onChange={(e) => set(f.name, e.target.value)}
                onBlur={() => setTouched(true)}
              />
            )}

            {f.help ? <div style={help}>{f.help}</div> : <div style={{ marginBottom: 12 }} />}
          </div>
        ))}

        {touched && problem && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{problem}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="submit"
            style={{
              ...primaryBtn(busy || !!problem),
              ...(destructive && !problem && !busy
                ? { background: 'var(--danger)', borderColor: 'var(--danger)' }
                : {}),
            }}
            disabled={busy || !!problem}
          >
            {busy ? 'Working…' : submitLabel}
          </button>
        </div>
      </form>
    </DialogShell>
  );
};

export default FormDialog;
