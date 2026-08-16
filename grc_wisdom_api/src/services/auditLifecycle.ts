/**
 * The engagement state machine.
 *
 * Previously any status could be set from any other, so `Planned → Closed`
 * succeeded and skipped the workpaper review gate entirely — an engagement
 * could be signed off with no evidence file, no testing and no review. The
 * gates were real; the path around them was a single field update.
 *
 * Transitions are declared here rather than inferred so the legal path is
 * readable in one place, and so the reason a move is refused can name the
 * moves that are allowed.
 */

export const AUDIT_STATUSES = ['Planned', 'Fieldwork', 'Reporting', 'Closed', 'Cancelled'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

/** Conclusions an engagement may reach (IIA Std 15.1). */
export const AUDIT_CONCLUSIONS = ['Adequate', 'NeedsImprovement', 'Inadequate'] as const;

const TRANSITIONS: Record<string, string[]> = {
  // Scoping is done; the team goes to work, or the engagement is abandoned.
  Planned:   ['Fieldwork', 'Cancelled'],
  // Testing is complete and the file is reviewed; results can be communicated.
  Fieldwork: ['Reporting', 'Cancelled'],
  // The report is issued and every finding is settled.
  Reporting: ['Closed'],
  // Terminal. Re-examining a closed engagement is a new follow-up engagement,
  // not an edit of the old one — otherwise the historical record moves.
  Closed:    [],
  Cancelled: [],
};

export function allowedNextStatuses(current: string): string[] {
  return TRANSITIONS[current] ?? [];
}

/**
 * Null when the move is legal, otherwise a message written for the person who
 * attempted it.
 */
export function checkTransition(current: string, next: string): string | null {
  if (current === next) return `The engagement is already ${current}.`;

  const allowed = allowedNextStatuses(current);
  if (allowed.length === 0) {
    return current === 'Closed'
      ? 'This engagement is closed. Raise a follow-up engagement rather than reopening it, so the original record and its conclusion stay intact.'
      : 'This engagement was cancelled and cannot be moved on.';
  }
  if (!allowed.includes(next)) {
    return `An engagement in ${current} can only move to ${allowed.join(' or ')}. Moving straight to ${next} would skip the checks in between.`;
  }
  return null;
}
