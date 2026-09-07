import React, { useMemo, useState } from 'react';
import { S, primaryBtn, ghostBtn, linkBtn } from '../iam/iamStyles';
import Icon from '../../components/Icon';

/**
 * Choose which clauses a control satisfies.
 *
 * This replaces a window.prompt that asked the user to type clause references
 * from memory as a comma-separated string. That prompt listed only the standard
 * CODES, never the clause refs; matched with exact case- and whitespace-
 * sensitive string equality; silently mapped a bare "5.1" to the first clause
 * with that ref in ANY standard, so a control could land against the wrong
 * framework entirely; and aborted the whole edit if one token was unrecognised.
 *
 * A picker of this exact kind already existed two hundred lines below it in the
 * same file, on the control-CREATE path. The edit path was simply never built.
 *
 * Search and per-standard grouping are here because of the numbers involved:
 * this product ships hundreds of clauses and the reported estate has 731
 * controls, none of them mapped. A flat list is unusable at that size, and so
 * is anything that requires one dialog per control — hence the multi-select
 * mode, which maps the same clause set across many controls at once.
 */

export interface PickableClause {
  id: string;
  ref: string;
  title: string;
  standardCode: string;
}

interface Props {
  /** What is being mapped: one control, or several at once. */
  subject: string;
  clauses: PickableClause[];
  initiallySelected: string[];
  onSubmit: (clauseIds: string[]) => void;
  onCancel: () => void;
  busy?: boolean;
  /** Shown when mapping many controls, where the change replaces every mapping. */
  bulkWarning?: string;
}

const ClauseMapDialog: React.FC<Props> = ({
  subject, clauses, initiallySelected, onSubmit, onCancel, busy, bulkWarning,
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(initiallySelected));
  const [query, setQuery] = useState('');
  const [standard, setStandard] = useState('');

  const standards = useMemo(
    () => [...new Set(clauses.map((c) => c.standardCode))].sort(),
    [clauses],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clauses.filter((c) => {
      if (standard && c.standardCode !== standard) return false;
      if (!q) return true;
      // Ref and title both, because a user knows a clause either by its number
      // or by what it is about, rarely by both.
      return c.ref.toLowerCase().includes(q) || c.title.toLowerCase().includes(q);
    });
  }, [clauses, query, standard]);

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /**
   * Select or clear everything currently visible, not everything that exists.
   *
   * Acting on the filtered set is the point: filter to one standard, take all
   * of it, then move on. A control that operates on the whole library would be
   * a way to map 700 clauses by accident.
   */
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const toggleVisible = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allVisibleSelected) visible.forEach((c) => next.delete(c.id));
    else visible.forEach((c) => next.add(c.id));
    return next;
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 940, padding: 20,
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        style={{ ...S.card, width: '100%', maxWidth: 720, padding: 22, display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}
        role="dialog"
        aria-modal="true"
        aria-label={`Map clauses for ${subject}`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>
            Clauses satisfied by {subject}
          </h3>
          <button onClick={onCancel} style={linkBtn('var(--ink-muted)')} aria-label="Close" disabled={busy}>
            <Icon name="close" size={15} label="Close" />
          </button>
        </div>

        {bulkWarning && (
          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 6,
            background: 'var(--warning-bg, rgba(154,101,16,0.08))',
            color: 'var(--warning)', fontSize: 12, lineHeight: 1.5,
          }}>
            {bulkWarning}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <input
            style={{ ...S.input, flex: 1, minWidth: 200 }}
            placeholder="Search by clause reference or title"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            style={{ ...S.input, width: 190 }}
            value={standard}
            onChange={(e) => setStandard(e.target.value)}
          >
            <option value="">All frameworks</option>
            {standards.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          margin: '10px 2px', fontSize: 12, color: 'var(--ink-muted)',
        }}>
          <span>
            <strong style={{ color: 'var(--ink)' }}>{selected.size}</strong> selected
            {visible.length !== clauses.length && ` · ${visible.length} shown of ${clauses.length}`}
          </span>
          {visible.length > 0 && (
            <button style={linkBtn('var(--info)')} onClick={toggleVisible}>
              {allVisibleSelected ? 'Clear these' : 'Select these'}
            </button>
          )}
          {selected.size > 0 && (
            <button style={linkBtn('var(--ink-muted)')} onClick={() => setSelected(new Set())}>
              Clear all
            </button>
          )}
        </div>

        <div style={{
          flex: 1, overflowY: 'auto', border: '1px solid var(--line)',
          borderRadius: 6, minHeight: 200,
        }}>
          {visible.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--ink-muted)' }}>
              {clauses.length === 0
                ? 'No clauses exist yet. Add clauses to a standard first.'
                : 'Nothing matches that search.'}
            </div>
          ) : (
            visible.map((c) => (
              <label
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '9px 12px', borderBottom: '1px solid var(--line)',
                  cursor: 'pointer', fontSize: 12.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  {/* The framework is always shown. Two standards routinely use
                      the same clause number, and the old prompt matched a bare
                      ref against whichever came first. */}
                  <span style={{ color: 'var(--ink-faint)' }}>{c.standardCode}</span>
                  {' '}
                  <strong style={{ color: 'var(--ink)' }}>{c.ref}</strong>
                  {' — '}
                  {c.title}
                </span>
              </label>
            ))
          )}
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={ghostBtn} onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            style={primaryBtn(busy)}
            onClick={() => onSubmit([...selected])}
            disabled={busy}
          >
            {busy ? 'Saving…'
              : selected.size === 0 ? 'Remove all mappings'
                : `Map to ${selected.size} clause${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClauseMapDialog;
