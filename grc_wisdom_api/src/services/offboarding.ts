/**
 * Offboarding a person, and handing over what they held.
 *
 * There was no handover anywhere. Nothing in the API reassigns ownership of
 * anything from one person to another -- no updateMany touches an owner,
 * assignee or approver column -- so the only way to remove somebody was the
 * platform database console, whose delete is four lines with no audit entry,
 * no transaction and no tenant scoping.
 *
 * ── The count is right and the word is wrong ────────────────────────────────
 *
 * 89 fields are typed User or User? with a relation. They are not ninety
 * ownership references: 25 are a live responsibility somebody must pick up,
 * and most of the rest are a record of who did something. Reassigning those
 * would forge history -- who signed an approval, who acknowledged a policy,
 * who validated a control, who placed a legal hold, who read a document. The
 * split below is the packet.
 *
 * ── A third answer: withdraw ────────────────────────────────────────────────
 *
 * Two things can be neither moved nor left, and a binary split has no slot for
 * them:
 *
 *   An AcknowledgementRequest names the one person who may sign it --
 *   acknowledgeDocument writes the caller's own id -- and the API has exactly
 *   one write to that table, a createMany. There is no cancel. Leave the rows
 *   and the leaver sits on "who has not signed this" for every policy they
 *   were ever issued, holding coverage below 100% forever with no way out.
 *
 *   A document checked out by the leaver is locked against edit, checkin and
 *   submission for everybody else. The only release is force-release, which
 *   needs a different capability and has no caller at all, so a successor
 *   inherits a document nobody can open.
 *
 * ── Offboarding has to actually end access ──────────────────────────────────
 *
 * User.status is read by nothing in the auth path. login never consults it,
 * requireAuth never loads the User row, and refresh checks only the token. So
 * marking somebody Inactive did not stop them working. That is fixed
 * alongside, because an offboarding that leaves the account usable is not one.
 *
 * Pure, and with no Prisma import, so every refusal runs without a database.
 */

/**
 * What moves to the successor.
 *
 * Kept as data rather than as twenty-five hand-written updateMany calls,
 * because the list IS the decision and a reviewer has to be able to read it in
 * one place. `where` narrows a table whose person-column means different
 * things depending on the row's state.
 */
export interface HandoverTarget {
  /** The Prisma model delegate name, camelCased. */
  model: string;
  /** The scalar foreign-key column holding the person. */
  column: string;
  /** What the column means, for the audit entry and the preview screen. */
  label: string;
  /** Extra predicate, for columns that are a duty only in some states. */
  where?: Record<string, unknown>;
  /** True when the model carries tenantId directly and must be scoped by it. */
  tenantScoped: boolean;
}

export const HANDOVER_TARGETS: readonly HandoverTarget[] = [
  { model: 'tenantStandardEnablement', column: 'ownerId', label: 'framework ownership', tenantScoped: true },
  { model: 'controlImplementation', column: 'ownerId', label: 'control implementations owned', tenantScoped: true },
  { model: 'controlImplementation', column: 'operatorId', label: 'controls operated', tenantScoped: true },
  { model: 'risk', column: 'ownerId', label: 'risks owned', tenantScoped: true },
  { model: 'riskTreatmentAction', column: 'ownerId', label: 'treatment actions owned', tenantScoped: false },
  { model: 'auditableEntity', column: 'ownerId', label: 'auditable entities owned', tenantScoped: true },
  { model: 'auditPlanItem', column: 'assignedLeadId', label: 'audit plan items led', tenantScoped: false },
  { model: 'audit', column: 'leadAuditorId', label: 'audits led', tenantScoped: true },
  { model: 'issue', column: 'capOwnerId', label: 'corrective actions owned', tenantScoped: true },
  { model: 'testProcedure', column: 'assignedToId', label: 'test procedures assigned', tenantScoped: false },
  { model: 'workflowStepRun', column: 'assigneeId', label: 'workflow steps assigned', tenantScoped: false },
  { model: 'document', column: 'ownerId', label: 'documents owned', tenantScoped: true },
  // Decided rows carry signatureHash, signerRole and sessionInfo. Rewriting
  // approverId on one would re-attribute a digital signature to somebody who
  // never signed, so only an undecided obligation moves.
  {
    model: 'approvalQueue',
    column: 'approverId',
    label: 'approvals awaiting signature',
    where: { status: 'PENDING' },
    tenantScoped: false,
  },
  { model: 'ticket', column: 'assigneeId', label: 'tickets assigned', tenantScoped: true },
  { model: 'asset', column: 'ownerId', label: 'assets owned', tenantScoped: true },
  { model: 'asset', column: 'custodianId', label: 'assets in custody', tenantScoped: true },
  { model: 'vendor', column: 'relationshipOwnerId', label: 'vendor relationships owned', tenantScoped: true },
  { model: 'sharedService', column: 'serviceOwnerId', label: 'shared services owned', tenantScoped: false },
  // Only an unanswered attestation. A submitted one is a statement the leaver
  // made, and rcsaController refuses anybody but the named respondent, so an
  // unanswered one left behind can be answered by nobody.
  {
    model: 'rcsaAssessment',
    column: 'respondentId',
    label: 'control attestations outstanding',
    where: { status: 'Pending' },
    tenantScoped: true,
  },
  { model: 'kri', column: 'ownerId', label: 'key risk indicators owned', tenantScoped: true },
  { model: 'project', column: 'ownerId', label: 'projects owned', tenantScoped: true },
  { model: 'project', column: 'managerId', label: 'projects managed', tenantScoped: true },
  { model: 'project', column: 'sponsorId', label: 'projects sponsored', tenantScoped: true },
  { model: 'projectPhase', column: 'ownerId', label: 'project phases owned', tenantScoped: false },
  { model: 'projectTask', column: 'assigneeId', label: 'project tasks assigned', tenantScoped: false },
  // Heading a department is a standing duty. onDelete: SetNull never fires
  // here because the user row is deliberately never deleted, so leaving it
  // would show a closed account as the head of a department on the org chart
  // with nothing prompting anybody to fix it.
  { model: 'department', column: 'headId', label: 'departments headed', tenantScoped: true },
];

/**
 * What is withdrawn rather than moved.
 *
 * Named here so it is a decision in the same file as the other two, rather
 * than a quiet special case in a controller.
 */
export const WITHDRAW_TARGETS = [
  'acknowledgement requests the leaver can no longer sign',
  'documents the leaver left checked out',
] as const;

/**
 * Columns that must NEVER move, listed for the test to hold.
 *
 * Not exhaustive of the 64 history relations -- it is the set somebody might
 * plausibly mistake for ownership, which is what a guard is for.
 */
export const NEVER_MOVE = [
  'actorId',          // who did a thing, in the audit log
  'validatedById',    // an independent validation is an act, not an assignment
  'preparedById',     // and three separation-of-duties gates compare against it
  'disposedById',     // who authorised destroying a record
  'placedById',       // who placed a legal hold
  'uploadedById',     // who supplied a piece of evidence
  'signedById',       // any signature
  'createdById',      // who wrote a version
] as const;

// ─── Refusals ───────────────────────────────────────────────────────────────

export interface OffboardRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface OffboardDecision {
  ok: true;
  reason: string;
}

export interface PersonFacts {
  id: string;
  tenantId: string;
  status: string;
  name: string;
}

/**
 * Whether this handover may proceed.
 *
 * Ordered so the answer a caller can act on comes first.
 */
export function planOffboarding(input: {
  actorId: string;
  leaver: PersonFacts | null;
  successor: PersonFacts | null;
  reason: unknown;
}): OffboardRefusal | OffboardDecision {
  if (!input.leaver) {
    return { ok: false, status: 404, code: 'LEAVER_NOT_FOUND', message: 'That person is not in this organisation.' };
  }

  if (input.leaver.id === input.actorId) {
    return {
      ok: false,
      status: 400,
      code: 'CANNOT_OFFBOARD_SELF',
      message: 'You cannot offboard yourself. Somebody else has to carry out the handover, so that the record shows two people.',
    };
  }

  if (input.leaver.status === 'Inactive') {
    return {
      ok: false,
      status: 409,
      code: 'ALREADY_OFFBOARDED',
      message: 'This person has already been offboarded.',
    };
  }

  if (!input.successor) {
    return {
      ok: false,
      status: 400,
      code: 'SUCCESSOR_REQUIRED',
      message: 'Name who takes over. Deactivating somebody without a successor leaves every risk, control and document they owned pointing at an account that cannot act.',
    };
  }

  if (input.successor.id === input.leaver.id) {
    return {
      ok: false,
      status: 400,
      code: 'SUCCESSOR_IS_LEAVER',
      message: 'The successor cannot be the person leaving.',
    };
  }

  if (input.successor.tenantId !== input.leaver.tenantId) {
    return {
      ok: false,
      status: 400,
      code: 'SUCCESSOR_OTHER_TENANT',
      message: 'The successor belongs to another organisation. Handing records across would move them out of the tenant that owns them.',
    };
  }

  if (input.successor.status !== 'Active') {
    return {
      ok: false,
      status: 400,
      code: 'SUCCESSOR_NOT_ACTIVE',
      message: `${input.successor.name} is ${input.successor.status.toLowerCase()}, so handing over to them would move the work to another account that cannot act.`,
    };
  }

  const reason = String(input.reason ?? '').trim();
  if (reason.length < 4) {
    return {
      ok: false,
      status: 400,
      code: 'OFFBOARD_REASON_REQUIRED',
      message: 'Say why this person is being offboarded. It is the one line explaining the handover to whoever reads the audit log.',
    };
  }

  return { ok: true, reason };
}

// ─── Separation of duties on the approvals that move ────────────────────────

export interface ApprovalRow {
  id: string;
  documentId: string;
  /** Everyone who wrote the version this approval is against. */
  editorIds: readonly string[];
  /** Approvers already assigned to this document, excluding the leaver. */
  otherApproverIds: readonly string[];
}

export interface ApprovalPlan {
  /** Approval rows the successor may hold. */
  move: string[];
  /**
   * Rows the successor may not hold, which are withdrawn instead.
   *
   * Leaving them is not an option: an approval slot held by a deactivated
   * person is a document nobody can advance, and this codebase has no way to
   * reassign one afterwards. Withdrawing changes the quorum for that document,
   * which is why each one is named in the audit entry rather than counted.
   */
  withdraw: { id: string; documentId: string; why: string }[];
}

export function planApprovalHandover(
  rows: readonly ApprovalRow[],
  successorId: string,
): ApprovalPlan {
  const move: string[] = [];
  const withdraw: { id: string; documentId: string; why: string }[] = [];

  for (const row of rows) {
    if (row.editorIds.includes(successorId)) {
      withdraw.push({
        id: row.id,
        documentId: row.documentId,
        why: 'the successor wrote this version, and whoever edited a version cannot approve it',
      });
      continue;
    }
    if (row.otherApproverIds.includes(successorId)) {
      withdraw.push({
        id: row.id,
        documentId: row.documentId,
        why: 'the successor is already an approver on this document, and one person cannot hold two signatures on it',
      });
      continue;
    }
    move.push(row.id);
  }

  return { move, withdraw };
}

// ─── Reporting ──────────────────────────────────────────────────────────────

export interface HandoverCount {
  label: string;
  model: string;
  column: string;
  count: number;
}

export interface HandoverSummary {
  /** Per-target counts, only where something would actually move. */
  moving: HandoverCount[];
  total: number;
  /**
   * Said rather than derived from a zero. Somebody who owned nothing and
   * somebody whose records were already moved look identical in a total, and
   * an offboarding that reports "0 records" should say which it is.
   */
  ownsNothing: boolean;
}

export function summariseHandover(counts: readonly HandoverCount[]): HandoverSummary {
  const moving = counts.filter((c) => c.count > 0);
  const total = moving.reduce((n, c) => n + c.count, 0);
  return { moving, total, ownsNothing: total === 0 };
}
