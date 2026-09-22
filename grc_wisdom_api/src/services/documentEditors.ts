/**
 * Who wrote this version of a document.
 *
 * SoD for documents looked at the audit log for DOCUMENT_CREATED and
 * DOCUMENT_CHECKED_IN. The library Edit modal writes DOCUMENT_UPDATED against
 * the current version without a checkout, so a co-editor who used it was never
 * the checkout holder, passed the rule, and could approve the words they typed.
 *
 * createdById is one person — the checkout holder, or the original author.
 * Approval has to test the set of everybody who actually wrote the version,
 * whichever route they used.
 *
 * Pure, so every refusal runs without a database.
 */

export const EDITOR_VIA = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  CHECKIN: 'CHECKIN',
} as const;

export type EditorVia = (typeof EDITOR_VIA)[keyof typeof EDITOR_VIA];

export interface SelfApprovalRefusal {
  status: 403;
  code: 'SELF_APPROVAL';
  message: string;
}

/**
 * The people who wrote this version. createdById is kept so a row that predates
 * the editor table still names the checkout holder.
 */
export function versionEditorIds(args: {
  createdById?: string | null;
  editors: { userId: string }[];
}): string[] {
  const ids = new Set<string>();
  if (args.createdById) ids.add(args.createdById);
  for (const row of args.editors) {
    if (row.userId) ids.add(row.userId);
  }
  return [...ids];
}

/**
 * Anyone on the editor set cannot sign this version, by either route.
 *
 * An empty set is not "nobody wrote it" — it is "we do not know". The existing
 * SoD audit check still runs for DOCUMENT_CREATED / DOCUMENT_CHECKED_IN. This
 * refusal is only for people we can name.
 */
export function selfApprovalRefusal(
  actorId: string,
  editorIds: string[],
): SelfApprovalRefusal | null {
  if (!actorId || !editorIds.includes(actorId)) return null;
  return {
    status: 403,
    code: 'SELF_APPROVAL',
    message:
      'Anyone who edited this version cannot approve it. Another person must sign.',
  };
}

/** Drop people who wrote the version from a proposed approver list. */
export function approversWhoDidNotEdit(
  proposed: string[],
  editorIds: string[],
  ownerId?: string | null,
): string[] {
  const blocked = new Set(editorIds);
  if (ownerId) blocked.add(ownerId);
  return Array.from(new Set(proposed.filter((id) => id && !blocked.has(id))));
}
