import React, { useMemo, useState } from 'react';
import DialogShell from './Dialog';
import { S, primaryBtn, ghostBtn } from '../pages/iam/iamStyles';

/**
 * Pick several things from a list.
 *
 * This replaces the worst prompt pattern in the app: a numbered list pasted
 * into window.prompt with "Comma-separated numbers." underneath. Those prompts
 * truncated the list — the asset screen printed the first 25 controls, the
 * shared-services screen the first 12 entities — while still indexing the full
 * array, so anything past the cut-off was selectable only by guessing a number
 * that was never shown. Mistyping one digit silently selected a different
 * record, and nothing echoed back what had been chosen.
 *
 * Everything is listed, searchable, and shown with its current state. What is
 * already selected is checked when the dialog opens, so the operation reads as
 * "change this set" rather than "retype it from memory" — which matters because
 * these endpoints replace the whole set rather than adding to it, and a user
 * who forgets to re-tick an existing link unlinks it.
 */

export interface PickItem {
  id: string;
  label: string;
  /** Secondary line: a title, an owner, whatever distinguishes near-identical labels. */
  sublabel?: string;
}

const PickManyDialog: React.FC<{
  title: string;
  /** What this set means, in the caller's words. */
  intro?: React.ReactNode;
  items: readonly PickItem[];
  initiallySelected?: readonly string[];
  confirmLabel?: string;
  /** Shown when the list is empty — always more useful than an empty box. */
  emptyMessage?: React.ReactNode;
  busy?: boolean;
  onSubmit: (ids: string[]) => void;
  onCancel: () => void;
}> = ({
  title, intro, items, initiallySelected = [], confirmLabel = 'Save',
  emptyMessage, busy, onSubmit, onCancel,
}) => {
  const [picked, setPicked] = useState<Set<string>>(new Set(initiallySelected));
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || (i.sublabel || '').toLowerCase().includes(q),
    );
  }, [items, query]);

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Counted against the original selection rather than shown as a bare total,
  // because the endpoints replace the set: "3 selected" does not tell you that
  // you are about to remove two.
  const initial = new Set(initiallySelected);
  const adding = [...picked].filter((id) => !initial.has(id)).length;
  const removing = [...initial].filter((id) => !picked.has(id)).length;

  return (
    <DialogShell title={title} onClose={busy ? () => undefined : onCancel} width={560}>
      {intro && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.6, marginBottom: 14 }}>
          {intro}
        </div>
      )}

      {items.length === 0 ? (
        <div style={{
          padding: '14px 16px', borderRadius: 6, fontSize: 13,
          background: 'var(--surface-sunk)', border: '1px solid var(--line)',
          color: 'var(--ink-muted)', lineHeight: 1.6,
        }}>
          {emptyMessage || 'There is nothing to choose from yet.'}
        </div>
      ) : (
        <>
          {items.length > 8 && (
            <input
              style={{ ...S.input, width: '100%', marginBottom: 10 }}
              value={query}
              autoFocus
              placeholder="Search…"
              onChange={(e) => setQuery(e.target.value)}
            />
          )}

          <div style={{
            maxHeight: 300, overflowY: 'auto',
            border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', padding: 6,
          }}>
            {shown.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12.5, color: 'var(--ink-faint)' }}>
                Nothing matches “{query}”.
              </div>
            ) : shown.map((i) => (
              <label
                key={i.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '6px 6px', cursor: 'pointer', borderRadius: 4,
                  background: picked.has(i.id) ? 'var(--surface-sunk)' : undefined,
                }}
              >
                <input
                  type="checkbox"
                  checked={picked.has(i.id)}
                  onChange={() => toggle(i.id)}
                  style={{ marginTop: 2 }}
                />
                <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                  {i.label}
                  {i.sublabel && (
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-muted)' }}>
                      {i.sublabel}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 8, lineHeight: 1.5 }}>
            {picked.size} selected
            {adding > 0 && <> · {adding} to add</>}
            {removing > 0 && (
              <span style={{ color: 'var(--warning)' }}> · {removing} to remove</span>
            )}
          </div>
        </>
      )}

      <div style={{ marginTop: 18, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        <button
          style={primaryBtn(busy || items.length === 0)}
          onClick={() => onSubmit([...picked])}
          disabled={busy || items.length === 0}
        >
          {busy ? 'Saving…' : confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
};

export default PickManyDialog;
