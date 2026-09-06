/**
 * Evidence for delivered work: what counts as evidence, what a reviewer
 * actually saw, and how far a plan's traceability reaches.
 *
 * Pure: no Prisma, no request, no filesystem, no ambient clock. The storage and
 * access sides live in the controller; this is the part that can be quietly
 * wrong — a coverage percentage that looks plausible, or a piece of evidence
 * counted as seen by somebody who never saw it.
 *
 * The claim this module has to defend: `verifiedProgress` means an independent
 * person looked at something specific. That is only true if the something
 * cannot change afterwards, so most of the rules below are about pinning
 * evidence to the round it was offered in.
 */

// ─── Vocabulary ─────────────────────────────────────────────────────────────

/** Matches the document module's vocabulary, so one word means one thing. */
export const EVIDENCE_CLASSIFICATIONS = [
  'Public', 'Internal', 'Confidential', 'Restricted',
] as const;
export type EvidenceClassification = (typeof EVIDENCE_CLASSIFICATIONS)[number];

/**
 * Which side produced it.
 *
 * A client-supplied asset register and a consultant-authored gap assessment are
 * different kinds of proof, and an auditor asks which is which before deciding
 * how much weight either carries.
 */
export const EVIDENCE_SIDES = ['Client', 'Provider'] as const;

/** 25 MB. Large enough for a signed PDF report, small enough to refuse a disk image. */
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export interface EvidenceRefusal {
  code: 'FILE_TOO_LARGE' | 'EMPTY_FILE' | 'DANGEROUS_TYPE' | 'UNKNOWN_CLASSIFICATION'
      | 'UNKNOWN_SIDE' | 'TASK_VERIFIED' | 'ALREADY_WITHDRAWN' | 'EVIDENCE_LOCKED';
  message: string;
}

/**
 * Extensions never accepted as evidence.
 *
 * Not a virus-scanning substitute and not pretending to be one. This blocks the
 * narrow case where a file is stored and later handed back to a browser with an
 * active content type: an uploaded .html or .svg served from the API's own
 * origin is a script running as the application. Evidence is documents and
 * images, so refusing markup costs nothing real.
 */
const DANGEROUS_EXTENSIONS = [
  'html', 'htm', 'svg', 'xhtml', 'js', 'mjs', 'exe', 'dll', 'sh', 'bat',
  'cmd', 'com', 'scr', 'jar', 'msi', 'ps1', 'vbs', 'hta',
];

export const extensionOf = (fileName: string): string => {
  const i = fileName.lastIndexOf('.');
  return i === -1 ? '' : fileName.slice(i + 1).toLowerCase();
};

export function checkEvidenceFile(
  fileName: string,
  byteLength: number,
): EvidenceRefusal | null {
  if (byteLength <= 0) {
    return { code: 'EMPTY_FILE', message: 'That file is empty.' };
  }
  if (byteLength > MAX_EVIDENCE_BYTES) {
    return {
      code: 'FILE_TOO_LARGE',
      message: `Evidence files are limited to ${Math.floor(MAX_EVIDENCE_BYTES / 1024 / 1024)} MB.`,
    };
  }
  const ext = extensionOf(fileName);
  if (DANGEROUS_EXTENSIONS.includes(ext)) {
    return {
      code: 'DANGEROUS_TYPE',
      message: `.${ext} files are not accepted as evidence. Attach a document, `
        + 'spreadsheet, image or PDF.',
    };
  }
  return null;
}

/**
 * The content type, read from the bytes rather than taken from the caller.
 *
 * A caller-declared type is a caller-chosen type: the existing document upload
 * path stores whatever `fileType` arrives in the JSON body, which means the
 * value says what the uploader wanted the browser to believe rather than what
 * the file is. Only the signatures worth distinguishing are listed; anything
 * unrecognised is served as a download rather than guessed at.
 */
const SIGNATURES: ReadonlyArray<readonly [readonly number[], string]> = [
  [[0x25, 0x50, 0x44, 0x46], 'application/pdf'],
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
  // Both modern Office formats and plain .zip start PK\x03\x04.
  [[0x50, 0x4b, 0x03, 0x04], 'application/zip'],
  // Legacy Office compound document.
  [[0xd0, 0xcf, 0x11, 0xe0], 'application/vnd.ms-office'],
];

const ZIP_BY_EXTENSION: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function sniffMime(head: readonly number[], fileName: string): string {
  for (const [sig, mime] of SIGNATURES) {
    if (sig.every((byte, i) => head[i] === byte)) {
      // A .docx IS a zip; the extension is the only thing that separates them,
      // and it is safe to trust here because the bytes already agreed it is a
      // zip container.
      if (mime === 'application/zip') {
        return ZIP_BY_EXTENSION[extensionOf(fileName)] || 'application/zip';
      }
      return mime;
    }
  }
  return 'application/octet-stream';
}

// ─── Standing: what the reviewer actually saw ───────────────────────────────

/**
 * Whether a piece of evidence was in front of the person who accepted the work.
 *
 *   Seen        offered in this round or an earlier one, still standing
 *   Pending     the work has not been accepted yet
 *   Withdrawn   offered and later retracted
 *   AddedLater  offered after the acceptance it appears to support
 *
 * AddedLater is the reading that matters. A task accepted at round 1, reopened,
 * and re-evidenced at round 2 has evidence that the round-1 reviewer never saw,
 * and a report that cannot draw that line lets evidence be back-filled behind a
 * signature. The upload path refuses to attach evidence to accepted work at
 * all, so this should be rare — but a rule enforced in one controller and a
 * fact derivable from the data are different guarantees, and reports are built
 * on the second.
 */
export type EvidenceStanding = 'Seen' | 'Pending' | 'Withdrawn' | 'AddedLater';

export function evidenceStanding(
  evidence: { uploadedInRound: number; withdrawnAt: Date | null },
  task: { status: string; verificationRound: number },
): EvidenceStanding {
  if (evidence.withdrawnAt) return 'Withdrawn';
  if (task.status !== 'Verified') return 'Pending';
  return evidence.uploadedInRound <= task.verificationRound ? 'Seen' : 'AddedLater';
}

/** Evidence still standing — not withdrawn. */
export const isStanding = (e: { withdrawnAt: Date | null }): boolean => e.withdrawnAt === null;

/**
 * Does this task carry evidence?
 *
 * Withdrawn rows do not count. Retracted proof is not proof, and a task whose
 * only evidence was withdrawn must stop satisfying an evidence requirement — or
 * withdrawing becomes a way to keep the credit while removing the substance.
 */
export const hasStandingEvidence = (
  list: readonly { withdrawnAt: Date | null }[],
): boolean => list.some(isStanding);

/**
 * Whether evidence may be attached to a task in this state.
 *
 * Accepted work is closed to new evidence. Letting a file be added after
 * sign-off produces exactly the artefact this module exists to prevent: a
 * verified task whose supporting evidence the verifier never saw. Reopen the
 * task and the addition becomes visible as a new round, which is the honest
 * version of the same act.
 */
export function checkEvidenceAttachable(task: { status: string }): EvidenceRefusal | null {
  if (task.status === 'Verified') {
    return {
      code: 'TASK_VERIFIED',
      message: 'This task has been verified. Reopen it before adding evidence, so the '
        + 'addition is visible as a new round rather than appearing behind the sign-off.',
    };
  }
  return null;
}

/**
 * Whether this evidence may be withdrawn.
 *
 * Evidence a verifier relied on cannot be pulled out from under their decision.
 * The verification stays on the record either way, so allowing the withdrawal
 * would leave an acceptance citing something no longer there — which reads, to
 * anyone auditing it later, exactly like a cover-up whether or not it was one.
 */
export function checkEvidenceWithdrawable(
  evidence: { withdrawnAt: Date | null },
  task: { status: string },
): EvidenceRefusal | null {
  if (evidence.withdrawnAt) {
    return { code: 'ALREADY_WITHDRAWN', message: 'This evidence has already been withdrawn.' };
  }
  // The round does not come into it. Because evidence cannot be attached to
  // accepted work in the first place, every piece of standing evidence on a
  // Verified task is part of what was accepted — so the status alone settles it.
  if (task.status === 'Verified') {
    return {
      code: 'EVIDENCE_LOCKED',
      message: 'This task has been verified against its evidence. Reopen it first — a '
        + 'sign-off that cites evidence which is no longer there is worse than no sign-off.',
    };
  }
  return null;
}

// ─── Traceability coverage ──────────────────────────────────────────────────

export interface ClauseCoverage {
  /** Distinct clauses any task in the plan claims to satisfy. */
  clausesCovered: number;
  /** Tasks carrying at least one clause link. */
  tasksMapped: number;
  tasksTotal: number;
  /** Of the mapped tasks, how many are actually finished. */
  tasksMappedComplete: number;
  /** Percent of tasks carrying a clause link, 0-100. */
  mappedPercent: number;
  /** Clauses whose every mapped task is complete — the defensible ones. */
  clausesSatisfied: number;
  /** Per-standard breakdown, keyed by standard code. */
  byStandard: Record<string, { covered: number; satisfied: number }>;
}

/**
 * How much of this plan can be traced to a framework clause, and how much of
 * that is actually finished.
 *
 * The two numbers are deliberately separate. A clause every one of whose tasks
 * is complete is one an organisation can defend in an audit; a clause merely
 * mentioned in a plan is an intention. Reporting them as one figure would let a
 * project claim coverage it has not delivered — the same conflation the
 * reported/verified split exists to prevent one level up.
 */
export function clauseCoverage(
  tasks: readonly {
    id: string;
    status: string;
    clauseLinks: readonly { clauseId: string; standardCode: string }[];
  }[],
  isCompleteFn: (status: string) => boolean,
): ClauseCoverage {
  const clauseTasks = new Map<string, { code: string; total: number; done: number }>();
  let tasksMapped = 0;
  let tasksMappedComplete = 0;

  for (const task of tasks) {
    if (task.clauseLinks.length === 0) continue;
    tasksMapped += 1;
    const done = isCompleteFn(task.status);
    if (done) tasksMappedComplete += 1;

    for (const link of task.clauseLinks) {
      const entry = clauseTasks.get(link.clauseId)
        || { code: link.standardCode, total: 0, done: 0 };
      entry.total += 1;
      if (done) entry.done += 1;
      clauseTasks.set(link.clauseId, entry);
    }
  }

  const byStandard: Record<string, { covered: number; satisfied: number }> = {};
  let clausesSatisfied = 0;

  for (const entry of clauseTasks.values()) {
    const satisfied = entry.total > 0 && entry.done === entry.total;
    if (satisfied) clausesSatisfied += 1;

    const std = byStandard[entry.code] || { covered: 0, satisfied: 0 };
    std.covered += 1;
    if (satisfied) std.satisfied += 1;
    byStandard[entry.code] = std;
  }

  return {
    clausesCovered: clauseTasks.size,
    tasksMapped,
    tasksTotal: tasks.length,
    tasksMappedComplete,
    mappedPercent: tasks.length === 0
      ? 0
      : Math.round((tasksMapped / tasks.length) * 100),
    clausesSatisfied,
    byStandard,
  };
}
