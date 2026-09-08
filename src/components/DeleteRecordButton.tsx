import React, { useState } from 'react';
import apiClient from '../api/apiClient';
import { apiError } from '../pages/iam/iamStyles';
import { ConfirmDialog } from './Dialog';

/**
 * A delete control that lets the server do the judging.
 *
 * Every register needed the same three things -- a button, a confirmation, and
 * somewhere to put the refusal when the server says no -- and the third is the
 * one a hand-rolled delete always drops. The endpoints refuse with specifics:
 * "This risk has 3 treatment actions and 2 linked controls attached. Deleting it
 * would remove those too... Close it instead." Throwing that away and showing
 * "Delete failed" would waste the only genuinely useful part.
 *
 * So the refusal is rendered inside the still-open dialog rather than as a
 * toast. The user is looking at the thing they tried to delete, and the message
 * tells them what to do with it instead; a notification that slides away three
 * seconds later, over a row that has not changed, does not.
 *
 * The button does not try to predict the answer. Screens hide it where the
 * outcome is knowable from the row -- an accepted risk, a retired asset -- but
 * whether a vendor has assessments attached is not on screen, and guessing at it
 * here would mean two places that can disagree about the same rule.
 */
const DeleteRecordButton: React.FC<{
  /** Full path, e.g. `/api/grc/assets/${a.id}`. */
  endpoint: string;
  /** What is being removed, lowercase: "asset", "finding", "shared service". */
  what: string;
  /** The record's reference, used in the dialog title: "Delete AST-014?" */
  reference: string;
  /** The record's name, shown in bold so the user can see they picked the right row. */
  name?: string;
  /**
   * The one line explaining what to do instead when this is not a mistaken entry.
   * Written per register because "archive it" means something different in each.
   */
  guidance: React.ReactNode;
  /** Reload the list. */
  onDone: (message: string) => void;
  label?: string;
  style?: React.CSSProperties;
}> = ({ endpoint, what, reference, name, guidance, onDone, label = 'Delete', style }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');

  const run = async () => {
    setBusy(true);
    setRefusal('');
    try {
      const res = await apiClient.delete(endpoint);
      setOpen(false);
      onDone(res.data?.message || `${reference} deleted`);
    } catch (err: any) {
      setRefusal(apiError(err, `Could not delete this ${what}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => { setRefusal(''); setOpen(true); }}
        style={{
          background: 'var(--surface-sunk)',
          border: '1px solid var(--line)',
          color: 'var(--danger)',
          fontSize: 11,
          fontWeight: 600,
          padding: '4px 8px',
          borderRadius: 4,
          cursor: 'pointer',
          ...style,
        }}
        title={`Remove a ${what} entered in error`}
      >
        {label}
      </button>

      {open && (
        <ConfirmDialog
          title={`Delete ${reference}?`}
          destructive
          confirmLabel={`Delete ${what}`}
          busy={busy}
          message={(
            <>
              {name && (
                <div>
                  <strong style={{ color: 'var(--ink)' }}>{name}</strong> will be removed entirely.
                </div>
              )}
              <div style={{ marginTop: name ? 10 : 0, color: 'var(--ink-muted)' }}>
                This is for a {what} entered in error — a duplicate, or a test row. {guidance}
              </div>
              {refusal && (
                <div style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: 'var(--danger-bg)',
                  border: '1px solid var(--danger-line)',
                  color: 'var(--danger)',
                  fontSize: 12.5,
                  lineHeight: 1.6,
                }}>
                  {refusal}
                </div>
              )}
            </>
          )}
          onConfirm={run}
          onCancel={() => { setOpen(false); setRefusal(''); }}
        />
      )}
    </>
  );
};

export default DeleteRecordButton;
