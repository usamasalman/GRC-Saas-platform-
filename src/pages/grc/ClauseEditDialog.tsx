import React, { useState } from 'react';
import DialogShell from '../../components/Dialog';
import { S, primaryBtn, ghostBtn } from '../iam/iamStyles';

/**
 * Correct a clause: its reference, its title and its text, together.
 *
 * One dialog with three fields rather than three chained prompts. A clause is
 * usually wrong in more than one place at once, because it was transcribed in
 * one go from a PDF -- so asking for the reference, closing, asking for the
 * title, closing, is three round trips to fix one paste, and the person cannot
 * see the reference while they retype the title.
 *
 * The reference is the field that matters most and the one most often wrong.
 * Controls, the coverage report and delivery projects all address clauses by
 * it, so it is checked for emptiness here and for uniqueness by the server,
 * which is the only place that can see the other clauses in the standard.
 */
const ClauseEditDialog: React.FC<{
  clause: { id: string; ref: string; title: string; text?: string | null; mappedControlCount?: number };
  busy?: boolean;
  onSubmit: (ref: string, title: string, text: string) => void;
  onCancel: () => void;
}> = ({ clause, busy, onSubmit, onCancel }) => {
  const [ref, setRef] = useState(clause.ref || '');
  const [title, setTitle] = useState(clause.title || '');
  const [text, setText] = useState(clause.text || '');
  const [touched, setTouched] = useState(false);

  const problem = !ref.trim()
    ? 'A clause needs a reference — it is how controls and reports address it.'
    : !title.trim()
      ? 'A clause needs a title.'
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    onSubmit(ref.trim(), title.trim(), text.trim());
  };

  const label: React.CSSProperties = {
    display: 'block', fontSize: 11.5, color: 'var(--ink-muted)', marginBottom: 4,
  };

  return (
    <DialogShell title={`Edit ${clause.ref}`} onClose={busy ? () => undefined : onCancel} width={560}>
      <form onSubmit={submit}>
        <label style={label}>Reference</label>
        <input
          value={ref}
          autoFocus
          onChange={(e) => setRef(e.target.value)}
          onBlur={() => setTouched(true)}
          style={{ ...S.input, marginBottom: 4, fontFamily: 'ui-monospace, monospace' }}
          placeholder="A.5.9"
        />
        {/* Renaming a reference that controls already satisfy is legitimate — a
            framework erratum renumbers clauses — so this warns rather than
            blocks. The mapping survives; only the label changes. */}
        {(clause.mappedControlCount || 0) > 0 && ref.trim() !== clause.ref && (
          <div style={{ fontSize: 11.5, color: 'var(--warning)', marginBottom: 12, lineHeight: 1.5 }}>
            {clause.mappedControlCount} control
            {clause.mappedControlCount === 1 ? '' : 's'} currently reference {clause.ref}. They stay
            mapped to this clause under its new reference.
          </div>
        )}
        <div style={{ marginBottom: 12 }} />

        <label style={label}>Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setTouched(true)}
          style={{ ...S.input, marginBottom: 12 }}
          placeholder="Inventory of information and other associated assets"
        />

        <label style={label}>Text</label>
        <textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ ...S.input, marginBottom: 6, resize: 'vertical' }}
          placeholder="The clause as it is worded in the standard."
        />
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginBottom: 16, lineHeight: 1.5 }}>
          Optional. What an assessor reads when deciding whether a control actually satisfies this.
        </div>

        {touched && problem && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 12 }}>{problem}</div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" style={primaryBtn(busy || !!problem)} disabled={busy || !!problem}>
            {busy ? 'Saving…' : 'Save clause'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
};

export default ClauseEditDialog;
