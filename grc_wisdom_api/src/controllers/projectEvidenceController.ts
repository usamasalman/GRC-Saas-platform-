import { Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { writeAudit } from '../middlewares/auditMiddleware';
import { notify } from '../services/notificationService';
import { guardProject, notFound, readOnly, isFrozen, frozen } from '../services/projectGuard';
import { recomputeProject } from '../services/projectRollup';
import { isComplete } from '../services/projectLifecycle';
import {
  EVIDENCE_CLASSIFICATIONS, EVIDENCE_SIDES, MAX_EVIDENCE_BYTES,
  checkEvidenceFile, checkEvidenceAttachable, checkEvidenceWithdrawable,
  sniffMime, evidenceStanding, clauseCoverage,
} from '../services/projectEvidence';
import {
  decodeUpload, putEvidence, resolveEvidencePath, verifyStoredHash,
} from '../services/evidenceStore';

/**
 * Evidence for delivered work, and the line from that work back to the clause
 * it satisfies.
 *
 * Two things this module refuses to do, both for the same reason:
 *
 *   - evidence cannot be attached to a task that has already been verified;
 *   - evidence a verifier relied on cannot be withdrawn.
 *
 * Both would produce a sign-off citing something the signer never saw or that
 * is no longer there. The whole value of `verifiedProgress` sitting next to
 * `reportedProgress` is that somebody independent looked at something specific,
 * and that claim survives only if the something cannot move afterwards.
 *
 * Files never go near the platform's `uploads/` directory. See evidenceStore.
 */

const str = (v: unknown): string => String(v ?? '');
const MIN_NOTE = 10;

/** EVD-0001, sequential per project, matching the task and impediment refs. */
async function nextRef(projectId: string): Promise<string> {
  const count = await prisma.projectEvidence.count({ where: { projectId } });
  return `EVD-${String(count + 1).padStart(4, '0')}`;
}

const SELECT = {
  id: true, ref: true, title: true, description: true, classification: true,
  fileName: true, fileSize: true, mimeType: true, sha256: true, side: true,
  uploadedInRound: true, uploadedAt: true,
  withdrawnAt: true, withdrawnReason: true,
  uploadedBy: { select: { id: true, name: true, email: true } },
  withdrawnBy: { select: { id: true, name: true } },
  task: { select: { id: true, ref: true, name: true, status: true, verificationRound: true } },
} as const;

/**
 * Load a task and decide what this caller may do with its evidence.
 *
 * Read access follows the project, not the tenant. Evidence rows carry the
 * client's tenantId, and a delivery partner is never inside its client's
 * scope — so filtering evidence the way the control module filters its own
 * would give a consultant a 404 on a file they uploaded themselves.
 */
async function loadTask(req: AuthenticatedRequest, taskId: string) {
  const task = await prisma.projectTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, projectId: true, ref: true, name: true, status: true,
      assigneeId: true, verificationRound: true,
    },
  });
  if (!task) return null;

  const guard = await guardProject(str(req.user!.tenantId), task.projectId);
  if (!guard.project) return null;

  return { task, ...guard, project: guard.project };
}

// ─── Attach ─────────────────────────────────────────────────────────────────

export const attachEvidence = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadTask(req, str(req.params.taskId));
    if (!loaded) { notFound(res); return; }
    const { task, project, canWrite, side } = loaded;

    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const userId = str(req.user!.id);
    const isAssignee = task.assigneeId === userId;
    // A provider consultant is the usual uploader on consultant-led work and is
    // never inside the client's tenant scope, so canWrite alone would lock out
    // exactly the person producing the deliverables.
    if (!canWrite && !isAssignee && side !== 'Provider') { readOnly(res); return; }

    const blocked = checkEvidenceAttachable(task);
    if (blocked) {
      res.status(409).json({ status: 'error', code: blocked.code, message: blocked.message });
      return;
    }

    const b = req.body || {};
    if (!b.title || str(b.title).trim().length < 3) {
      res.status(400).json({ status: 'error', message: 'title is required' });
      return;
    }
    if (b.classification
        && !(EVIDENCE_CLASSIFICATIONS as readonly string[]).includes(str(b.classification))) {
      res.status(400).json({
        status: 'error',
        code: 'UNKNOWN_CLASSIFICATION',
        message: `classification must be one of: ${EVIDENCE_CLASSIFICATIONS.join(', ')}`,
      });
      return;
    }
    if (b.side && !(EVIDENCE_SIDES as readonly string[]).includes(str(b.side))) {
      res.status(400).json({
        status: 'error',
        code: 'UNKNOWN_SIDE',
        message: `side must be one of: ${EVIDENCE_SIDES.join(', ')}`,
      });
      return;
    }
    if (!b.fileData || !b.fileName) {
      res.status(400).json({
        status: 'error',
        message: 'fileData (base64) and fileName are required',
      });
      return;
    }

    let bytes: Buffer;
    try {
      bytes = decodeUpload(str(b.fileData));
    } catch {
      res.status(400).json({ status: 'error', message: 'fileData is not valid base64' });
      return;
    }

    const fileRefusal = checkEvidenceFile(str(b.fileName), bytes.length);
    if (fileRefusal) {
      res.status(400).json({
        status: 'error', code: fileRefusal.code, message: fileRefusal.message,
      });
      return;
    }

    const stored = putEvidence(bytes);
    // Read from the bytes, never from the caller. A declared content type is a
    // chosen one, and it decides how a browser later treats the download.
    const mimeType = sniffMime(stored.head, str(b.fileName));
    const ref = await nextRef(project.id);

    const result = await prisma.$transaction(async (tx) => {
      const evidence = await tx.projectEvidence.create({
        data: {
          projectId: project.id,
          taskId: task.id,
          ref,
          title: str(b.title).trim(),
          description: b.description ? str(b.description) : null,
          classification: b.classification ? str(b.classification) : 'Internal',
          side: b.side ? str(b.side) : (side || 'Client'),
          storageKey: stored.storageKey,
          fileName: str(b.fileName),
          fileSize: stored.byteLength,
          mimeType,
          sha256: stored.sha256,
          uploadedById: userId,
          // Pins this file to the round it was offered in, which is what lets a
          // report say whether the verifier actually saw it.
          uploadedInRound: task.verificationRound + 1,
        },
        select: SELECT,
      });

      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: userId,
        action: 'PROJECT_EVIDENCE_ATTACHED',
        subjectType: 'ProjectEvidence',
        subjectId: evidence.id,
        payload: {
          projectRef: project.ref, ref, task: task.ref,
          fileName: str(b.fileName), bytes: stored.byteLength, sha256: stored.sha256,
        },
      });

      // Adding evidence can change whether the task needs a reviewer at all
      // under the EvidenceTasks policy, which moves the verified figure.
      const rollup = await recomputeProject(tx, project.id);
      return { evidence, rollup };
    });

    res.status(201).json({
      status: 'success',
      evidence: result.evidence,
      rollup: result.rollup,
    });
  } catch (error: any) {
    console.error('[Evidence Attach Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to attach evidence' });
  }
};

// ─── Download ───────────────────────────────────────────────────────────────

/**
 * The only way to read an evidence file.
 *
 * Resolve the row, check project access, then stream from disk — the shape
 * documentController.downloadDocument already uses correctly. Nothing about the
 * stored file is reachable without passing through here.
 *
 * The download is forced rather than rendered. Serving an attacker-supplied
 * file inline from the API's own origin is how an upload becomes stored XSS,
 * and evidence is meant to be kept rather than browsed.
 */
export const downloadEvidence = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const evidence = await prisma.projectEvidence.findUnique({
      where: { id: str(req.params.evidenceId) },
      select: {
        id: true, projectId: true, ref: true, storageKey: true,
        fileName: true, mimeType: true, sha256: true, withdrawnAt: true,
      },
    });
    if (!evidence) { notFound(res); return; }

    const { project } = await guardProject(str(req.user!.tenantId), evidence.projectId);
    if (!project) { notFound(res); return; }

    const full = resolveEvidencePath(evidence.storageKey);
    if (!full) {
      res.status(410).json({
        status: 'error',
        code: 'FILE_MISSING',
        message: 'The stored file for this evidence is no longer on disk.',
      });
      return;
    }

    // Reading evidence is itself an auditable act: who looked at the client's
    // pen test report, and when, is a question that gets asked.
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_EVIDENCE_DOWNLOADED',
        subjectType: 'ProjectEvidence',
        subjectId: evidence.id,
        payload: { projectRef: project.ref, ref: evidence.ref, fileName: evidence.fileName },
      });
    });

    res.setHeader('Content-Type', evidence.mimeType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.download(full, evidence.fileName);
  } catch (error: any) {
    console.error('[Evidence Download Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to download evidence' });
  }
};

// ─── Withdraw ───────────────────────────────────────────────────────────────

/**
 * Retract evidence without deleting it.
 *
 * The row stays, because the fact that somebody once offered this as proof is
 * exactly the fact an investigation wants and a deleted row takes it away.
 * Withdrawn evidence stops counting toward the EvidenceTasks requirement, so
 * this is not a way to keep the credit while removing the substance.
 */
export const withdrawEvidence = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const evidence = await prisma.projectEvidence.findUnique({
      where: { id: str(req.params.evidenceId) },
      select: {
        id: true, projectId: true, taskId: true, ref: true, title: true,
        withdrawnAt: true, uploadedById: true,
        task: { select: { id: true, ref: true, status: true, verificationRound: true } },
      },
    });
    if (!evidence) { notFound(res); return; }

    const { project, canWrite, side } = await guardProject(
      str(req.user!.tenantId), evidence.projectId,
    );
    if (!project) { notFound(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }

    const userId = str(req.user!.id);
    if (!canWrite && evidence.uploadedById !== userId && side !== 'Provider') {
      readOnly(res); return;
    }

    const refusal = checkEvidenceWithdrawable(evidence, evidence.task);
    if (refusal) {
      res.status(409).json({ status: 'error', code: refusal.code, message: refusal.message });
      return;
    }

    const reason = req.body?.reason ? str(req.body.reason).trim() : '';
    if (reason.length < MIN_NOTE) {
      res.status(400).json({
        status: 'error',
        code: 'REASON_REQUIRED',
        message: `Say why it is being withdrawn — at least ${MIN_NOTE} characters. `
          + 'Evidence that disappears without an account of why is the entry an '
          + 'investigation stops at.',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const withdrawn = await tx.projectEvidence.update({
        where: { id: evidence.id },
        data: { withdrawnAt: new Date(), withdrawnById: userId, withdrawnReason: reason },
        select: SELECT,
      });

      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: userId,
        action: 'PROJECT_EVIDENCE_WITHDRAWN',
        subjectType: 'ProjectEvidence',
        subjectId: evidence.id,
        payload: {
          projectRef: project.ref, ref: evidence.ref, task: evidence.task.ref, reason,
        },
      });

      await notify(tx, {
        tenantId: project.tenantId,
        recipientId: evidence.uploadedById,
        actorId: userId,
        event: 'PROJECT_EVIDENCE_WITHDRAWN',
        subjectType: 'ProjectEvidence',
        subjectId: evidence.id,
        title: `${evidence.ref} was withdrawn`,
        body: reason,
        link: 'project-delivery',
      });

      // Withdrawing the last standing evidence can remove an EvidenceTasks
      // verification requirement, which moves the verified figure.
      const rollup = await recomputeProject(tx, project.id);
      return { withdrawn, rollup };
    });

    res.json({ status: 'success', evidence: result.withdrawn, rollup: result.rollup });
  } catch (error: any) {
    console.error('[Evidence Withdraw Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to withdraw evidence' });
  }
};

// ─── Traceability ───────────────────────────────────────────────────────────

/**
 * Map delivered work to the framework clauses it satisfies.
 *
 * Reachability is resolved against the PROJECT'S CLIENT TENANT, not the
 * caller's scope. A consultant mapping a task to a clause of a standard their
 * client owns is the ordinary case on consultant-led work, and the control
 * module's own check — which tests the caller's tenant list — would refuse it.
 * Correct there, wrong here: the question is whether the ENGAGEMENT may see the
 * standard, not whether the consultant's own organisation happens to own it.
 */
export const linkClauses = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const loaded = await loadTask(req, str(req.params.taskId));
    if (!loaded) { notFound(res); return; }
    const { task, project, canWrite, side } = loaded;

    if (isFrozen(project.status)) { frozen(res, project.status); return; }
    if (!canWrite && side !== 'Provider') { readOnly(res); return; }

    const raw = req.body?.clauseIds;
    const clauseIds: string[] = Array.isArray(raw) ? raw.map(str).filter(Boolean) : [];
    if (clauseIds.length === 0) {
      res.status(400).json({ status: 'error', message: 'clauseIds must be a non-empty array' });
      return;
    }

    const clauses = await prisma.standardClause.findMany({
      where: { id: { in: clauseIds } },
      select: {
        id: true, ref: true,
        standard: { select: { id: true, code: true, tenantId: true } },
      },
    });
    if (clauses.length !== clauseIds.length) {
      res.status(400).json({
        status: 'error', message: 'One or more clauseIds do not exist',
      });
      return;
    }

    // A platform standard (tenantId null) is available to everyone. A private
    // one is reachable only if the engagement's client owns it.
    const blocked = clauses.filter(
      (c) => c.standard.tenantId !== null && c.standard.tenantId !== project.tenantId,
    );
    if (blocked.length > 0) {
      res.status(403).json({
        status: 'error',
        code: 'CLAUSE_OUT_OF_SCOPE',
        message: 'You cannot map this engagement to another organisation\'s private '
          + `framework (${[...new Set(blocked.map((c) => c.standard.code))].join(', ')}).`,
      });
      return;
    }

    const note = req.body?.note ? str(req.body.note) : null;
    const userId = str(req.user!.id);

    const links = await prisma.$transaction(async (tx) => {
      // createMany with skipDuplicates: re-sending a clause already mapped is a
      // no-op rather than an error, because the caller's intent — "this task
      // satisfies these clauses" — is already true.
      await tx.projectTaskClause.createMany({
        data: clauses.map((c) => ({
          taskId: task.id, clauseId: c.id, note, linkedById: userId,
        })),
        skipDuplicates: true,
      });

      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: userId,
        action: 'PROJECT_TASK_CLAUSES_LINKED',
        subjectType: 'ProjectTask',
        subjectId: task.id,
        payload: {
          projectRef: project.ref, ref: task.ref,
          clauses: clauses.map((c) => `${c.standard.code} ${c.ref}`),
        },
      });

      return tx.projectTaskClause.findMany({
        where: { taskId: task.id },
        select: {
          id: true, note: true, linkedAt: true,
          clause: {
            select: {
              id: true, ref: true, title: true,
              standard: { select: { id: true, code: true, name: true } },
            },
          },
        },
      });
    });

    res.status(201).json({ status: 'success', links });
  } catch (error: any) {
    console.error('[Clause Link Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to link clauses' });
  }
};

export const unlinkClause = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const link = await prisma.projectTaskClause.findUnique({
      where: { id: str(req.params.linkId) },
      select: {
        id: true,
        task: { select: { id: true, ref: true, projectId: true } },
        clause: { select: { ref: true, standard: { select: { code: true } } } },
      },
    });
    if (!link) { notFound(res); return; }

    const { project, canWrite, side } = await guardProject(
      str(req.user!.tenantId), link.task.projectId,
    );
    if (!project) { notFound(res); return; }
    if (isFrozen(project.status)) { frozen(res, project.status); return; }
    if (!canWrite && side !== 'Provider') { readOnly(res); return; }

    await prisma.$transaction(async (tx) => {
      await tx.projectTaskClause.delete({ where: { id: link.id } });
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_TASK_CLAUSE_UNLINKED',
        subjectType: 'ProjectTask',
        subjectId: link.task.id,
        payload: {
          projectRef: project.ref, ref: link.task.ref,
          clause: `${link.clause.standard.code} ${link.clause.ref}`,
        },
      });
    });

    res.json({ status: 'success', message: 'Clause unlinked' });
  } catch (error: any) {
    console.error('[Clause Unlink Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to unlink clause' });
  }
};

// ─── The evidence register and coverage ─────────────────────────────────────

/**
 * Every piece of evidence on the engagement, and how far the plan traces.
 *
 * The two coverage figures are reported separately on purpose. Clauses merely
 * mentioned in a plan are an intention; clauses whose every mapped task is
 * finished are something an organisation can defend. Collapsing them into one
 * number would let a project claim coverage it has not delivered — the same
 * conflation the reported/verified split exists to prevent one level up.
 */
export const getEvidenceRegister = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const { project } = await guardProject(str(req.user!.tenantId), str(req.params.id));
    if (!project) { notFound(res); return; }

    const where: any = { projectId: project.id };
    if (req.query.standing === 'true') where.withdrawnAt = null;

    const [evidence, tasks] = await Promise.all([
      prisma.projectEvidence.findMany({
        where,
        orderBy: { uploadedAt: 'desc' },
        select: SELECT,
      }),
      prisma.projectTask.findMany({
        where: { projectId: project.id },
        select: {
          id: true, status: true,
          clauseLinks: {
            select: { clauseId: true, clause: { select: { standard: { select: { code: true } } } } },
          },
        },
      }),
    ]);

    const coverage = clauseCoverage(
      tasks.map((t) => ({
        id: t.id,
        status: t.status,
        clauseLinks: t.clauseLinks.map((l) => ({
          clauseId: l.clauseId,
          standardCode: l.clause.standard.code,
        })),
      })),
      isComplete,
    );

    res.json({
      status: 'success',
      projectId: project.id,
      evidence: evidence.map((e) => ({
        ...e,
        standing: evidenceStanding(e, e.task),
      })),
      coverage,
      summary: {
        total: evidence.length,
        standing: evidence.filter((e) => e.withdrawnAt === null).length,
        withdrawn: evidence.filter((e) => e.withdrawnAt !== null).length,
        bytes: evidence.reduce((n, e) => n + e.fileSize, 0),
      },
      vocabulary: {
        classifications: EVIDENCE_CLASSIFICATIONS,
        sides: EVIDENCE_SIDES,
        maxBytes: MAX_EVIDENCE_BYTES,
      },
    });
  } catch (error: any) {
    console.error('[Evidence Register Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the evidence register' });
  }
};

/**
 * Re-read the stored files and confirm they still hash to what was recorded.
 *
 * An integrity claim nobody ever checks is not an integrity claim. This is the
 * endpoint that turns the stored SHA-256 from decoration into something an
 * auditor can ask you to run in front of them.
 */
export const verifyEvidenceIntegrity = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const { project, canWrite } = await guardProject(
      str(req.user!.tenantId), str(req.params.id),
    );
    if (!project) { notFound(res); return; }
    if (!canWrite) { readOnly(res); return; }

    const evidence = await prisma.projectEvidence.findMany({
      where: { projectId: project.id, withdrawnAt: null },
      select: { id: true, ref: true, fileName: true, storageKey: true, sha256: true },
    });

    const checked = evidence.map((e) => {
      const result = verifyStoredHash(e.storageKey, e.sha256);
      return {
        id: e.id,
        ref: e.ref,
        fileName: e.fileName,
        // Three outcomes, not two. A file that has gone missing is a different
        // problem from one whose bytes changed, and reporting both as "failed"
        // would send someone looking for the wrong thing.
        result: result === null ? 'Missing' : result ? 'Intact' : 'Altered',
      };
    });

    const intact = checked.filter((c) => c.result === 'Intact').length;

    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        tenantId: project.tenantId,
        actorId: str(req.user!.id),
        action: 'PROJECT_EVIDENCE_INTEGRITY_CHECKED',
        subjectType: 'Project',
        subjectId: project.id,
        payload: {
          projectRef: project.ref, checked: checked.length, intact,
          altered: checked.filter((c) => c.result === 'Altered').length,
          missing: checked.filter((c) => c.result === 'Missing').length,
        },
      });
    });

    res.json({
      status: 'success',
      checked: checked.length,
      intact,
      altered: checked.filter((c) => c.result === 'Altered').length,
      missing: checked.filter((c) => c.result === 'Missing').length,
      files: checked,
    });
  } catch (error: any) {
    console.error('[Evidence Integrity Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to check evidence integrity' });
  }
};
