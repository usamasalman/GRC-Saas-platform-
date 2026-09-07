import React, { useEffect, useRef, useState } from 'react';
import { S, primaryBtn, ghostBtn, linkBtn } from '../pages/iam/iamStyles';
import Icon from './Icon';

/**
 * In-app replacements for window.confirm and window.prompt.
 *
 * The browser's own dialogs put the server's IP address at the top — "161.97.120.202
 * says" — which reads to a customer as the machine talking rather than the
 * product. They also cannot be styled, cannot explain consequences, cannot
 * validate what was typed, and block the whole tab while open.
 *
 * There are 194 of them across this frontend. These two components are what
 * replaces them, migrated screen by screen rather than in one sweep, because a
 * half-migrated screen that mixes both is worse than either on its own.
 *
 * Confirm and Prompt are deliberately separate rather than one component with
 * an optional input. They differ in what they return, what they validate, and
 * what they have to guard: a destructive confirm's job is to make someone
 * hesitate, and a prompt's job is to get a well-formed value with as little
 * friction as possible. One component doing both does neither well.
 */

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 940,
  padding: 20,
};

/**
 * The shell both dialogs sit in.
 *
 * Escape closes, the backdrop closes, and focus moves inside on open — all
 * things the native dialog gave for free and a hand-rolled one silently loses.
 * Restoring focus on close matters most: without it a keyboard user is returned
 * to the top of the document every time they cancel.
 */
const DialogShell: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}> = ({ title, onClose, children, width = 460 }) => {
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreTo.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      style={overlay}
      // Only a click on the backdrop itself, never one that bubbled up from
      // inside the card — otherwise selecting text and releasing outside the
      // dialog dismisses the work.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ ...S.card, width: '100%', maxWidth: width, padding: 22 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 10,
        }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>{title}</h3>
          <button onClick={onClose} style={linkBtn('var(--ink-muted)')} aria-label="Close">
            <Icon name="close" size={15} label="Close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

// ─── Confirm ────────────────────────────────────────────────────────────────

export interface ConfirmProps {
  title: string;
  /** What is about to happen, in the caller's own words. */
  message: React.ReactNode;
  confirmLabel?: string;
  /** Marks the action as destructive: red button, and the warning tone. */
  destructive?: boolean;
  /**
   * Require the user to type this exact word before confirming.
   *
   * For the small number of actions that genuinely cannot be undone. Everything
   * else should just be a button — asking someone to type on every delete
   * teaches them to type without reading, which is the opposite of the point.
   */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmProps> = ({
  title, message, confirmLabel = 'Confirm', destructive, typeToConfirm,
  onConfirm, onCancel, busy,
}) => {
  const [typed, setTyped] = useState('');
  const ok = !typeToConfirm || typed.trim() === typeToConfirm;

  return (
    <DialogShell title={title} onClose={busy ? () => undefined : onCancel}>
      <div style={{ fontSize: 13, color: 'var(--ink-body)', lineHeight: 1.6 }}>
        {message}
      </div>

      {typeToConfirm && (
        <div style={{ marginTop: 14 }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
            Type <strong style={{ color: 'var(--ink)' }}>{typeToConfirm}</strong> to continue
          </span>
          <input
            style={{ ...S.input, width: '100%', marginTop: 4 }}
            value={typed}
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ok) onConfirm(); }}
          />
        </div>
      )}

      <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          style={{
            ...primaryBtn(busy || !ok),
            ...(destructive && ok && !busy
              ? { background: 'var(--danger)', borderColor: 'var(--danger)' }
              : {}),
          }}
          onClick={onConfirm}
          disabled={busy || !ok}
          autoFocus={!typeToConfirm}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
};

// ─── Prompt ─────────────────────────────────────────────────────────────────

export interface PromptProps {
  title: string;
  label: string;
  /** Shown under the field: what this value is for, or what shape it takes. */
  help?: React.ReactNode;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Multi-line for a reason or a note; single-line for a name. */
  multiline?: boolean;
  /**
   * Return a message to refuse, or null to accept.
   *
   * Validation belongs here rather than in the caller's submit handler, because
   * the native prompt could only report a problem AFTER closing — which is how
   * "that is too short" ends up as an alert on a screen the value has already
   * left.
   */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  busy?: boolean;
}

export const PromptDialog: React.FC<PromptProps> = ({
  title, label, help, initialValue = '', placeholder, confirmLabel = 'Save',
  multiline, validate, onSubmit, onCancel, busy,
}) => {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);

  const problem = validate ? validate(value) : null;
  const showProblem = touched && problem;

  const submit = () => {
    setTouched(true);
    if (problem) return;
    onSubmit(value);
  };

  return (
    <DialogShell title={title} onClose={busy ? () => undefined : onCancel} width={520}>
      <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{label}</span>

      {multiline ? (
        <textarea
          style={{ ...S.input, width: '100%', marginTop: 4, minHeight: 90, resize: 'vertical' }}
          value={value}
          autoFocus
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
        />
      ) : (
        <input
          style={{ ...S.input, width: '100%', marginTop: 4 }}
          value={value}
          autoFocus
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      )}

      {showProblem ? (
        <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 6 }}>{problem}</div>
      ) : help ? (
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 6, lineHeight: 1.5 }}>
          {help}
        </div>
      ) : null}

      <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button style={primaryBtn(busy || !!problem)} onClick={submit} disabled={busy || !!problem}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
};

export default DialogShell;
