import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';

const SUBJ_RCM = 'EngagementRisk';
const SUBJ_TEST = 'TestProcedure';
const SUBJ_WP = 'Workpaper';

const RATINGS = ['High', 'Medium', 'Low'];
const TEST_TYPES = ['DesignEffectiveness', 'OperatingEffectiveness', 'Both'];
const SAMPLING = ['Statistical', 'Judgmental', 'FullPopulation', 'Inquiry', 'Observation'];
const CONCLUSIONS = ['Satisfactory', 'SatisfactoryWithExceptions', 'Unsatisfactory'];
const SECTIONS = ['Planning', 'Fieldwork', 'Reporting'];

/** Loads an audit inside the caller's scope, or null. */
async function scopedAudit(req: AuthenticatedRequest, auditId: string) {
  const scope = await resolveTenantScope(req.user!.tenantId);
  return prisma.audit.findFirst({ where: { id: auditId, tenantId: { in: scope.tenantIds } } });
}

// ─── Risk & Control Matrix ─────────────────────────────────────────────────

export const getMatrix = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const auditId = req.params.id as string;
    const audit = await scopedAudit(req, auditId);
    if (!audit) { res.status(404).json({ status: 'error', message: 'Audit not found' }); return; }

    const rows = await prisma.engagementRisk.findMany({
      where: { auditId },
      include: {
        implementation: {
          include: { control: { select: { code: true, title: true, domain: true } } },
        },
        procedures: {
          include: {
            assignedTo: { select: { id: true, name: true, email: true } },
            result: { include: { testedBy: { select: { id: true, name: true } } } },
            _count: { select: { workpapers: true } },
          },
          orderBy: { ref: 'asc' },
        },
      },
      orderBy: { ref: 'asc' },
    });

    const procedures = rows.flatMap((r) => r.procedures);
    const results = procedures.map((p) => p.result).filter(Boolean) as any[];

    res.json({
      status: 'success',
      audit: { id: audit.id, ref: audit.ref, title: audit.title, status: audit.status },
      count: rows.length,
      totals: {
        rows: rows.length,
        withoutControl: rows.filter((r) => !r.implementationId).length,
        procedures: procedures.length,
        completed: procedures.filter((p) => p.status === 'Completed').length,
        notStarted: procedures.filter((p) => p.status === 'NotStarted').length,
        exceptions: results.reduce((a, r) => a + r.exceptionsFound, 0),
        unsatisfactory: results.filter((r) => r.conclusion === 'Unsatisfactory').length,
      },
      matrix: rows,
    });
  } catch (error: any) {
    console.error('[Matrix Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the risk and control matrix' });
  }
};

export const addMatrixRow = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const auditId = req.params.id as string;
    const { title, description, riskRating, implementationId, controlType, controlNature } = req.body || {};
    if (!title || !description) {
      res.status(400).json({ status: 'error', message: 'title and description are required' });
      return;
    }
    if (riskRating && !RATINGS.includes(riskRating)) {
      res.status(400).json({ status: 'error', message: `riskRating must be one of: ${RATINGS.join(', ')}` });
      return;
    }

    const audit = await scopedAudit(req, auditId);
    if (!audit) { res.status(404).json({ status: 'error', message: 'Audit not found' }); return; }
    if (audit.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Cannot change the matrix of a closed audit' });
      return;
    }

    // A control from another tenant must never enter this engagement's matrix.
    if (implementationId) {
      const impl = await prisma.controlImplementation.findFirst({
        where: { id: implementationId, tenantId: audit.tenantId },
      });
      if (!impl) {
        res.status(400).json({ status: 'error', message: 'Control implementation not found in this entity' });
        return;
      }
    }

    const count = await prisma.engagementRisk.count({ where: { auditId } });
    const ref = `R${count + 1}`;

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.engagementRisk.create({
        data: {
          auditId, ref,
          title: String(title).trim(),
          description: String(description).trim(),
          riskRating: riskRating || 'Medium',
          implementationId: implementationId || null,
          controlType: controlType || null,
          controlNature: controlNature || null,
        },
      });
      await writeAudit(tx, {
        tenantId: audit.tenantId, actorId: req.user!.id, action: 'RCM_ROW_ADDED',
        subjectType: SUBJ_RCM, subjectId: created.id,
        payload: { auditRef: audit.ref, ref, title, riskRating: riskRating || 'Medium', hasControl: !!implementationId },
      });
      return created;
    });

    res.status(201).json({ status: 'success', row });
  } catch (error: any) {
    console.error('[Add Matrix Row Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add matrix row' });
  }
};

// ─── Test procedures ───────────────────────────────────────────────────────

export const addProcedure = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rowId = req.params.rowId as string;
    const { objective, procedure, testType, samplingMethod, populationSize, sampleSize, assignedToId } = req.body || {};
    if (!objective || !procedure) {
      res.status(400).json({ status: 'error', message: 'objective and procedure are required' });
      return;
    }
    if (testType && !TEST_TYPES.includes(testType)) {
      res.status(400).json({ status: 'error', message: `testType must be one of: ${TEST_TYPES.join(', ')}` });
      return;
    }
    if (samplingMethod && !SAMPLING.includes(samplingMethod)) {
      res.status(400).json({ status: 'error', message: `samplingMethod must be one of: ${SAMPLING.join(', ')}` });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const row = await prisma.engagementRisk.findFirst({
      where: { id: rowId, audit: { tenantId: { in: scope.tenantIds } } },
      include: { audit: { select: { id: true, ref: true, tenantId: true, status: true } } },
    });
    if (!row) { res.status(404).json({ status: 'error', message: 'Matrix row not found' }); return; }
    if (row.audit.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Cannot add procedures to a closed audit' });
      return;
    }

    const count = await prisma.testProcedure.count({ where: { engagementRiskId: rowId } });
    const ref = `${row.ref}.T${count + 1}`;

    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.testProcedure.create({
        data: {
          engagementRiskId: rowId, ref,
          objective: String(objective).trim(),
          procedure: String(procedure).trim(),
          testType: testType || 'OperatingEffectiveness',
          samplingMethod: samplingMethod || 'Judgmental',
          populationSize: populationSize ? Number(populationSize) : null,
          sampleSize: Number(sampleSize) || 25,
          assignedToId: assignedToId || null,
          status: 'NotStarted',
        },
      });
      await writeAudit(tx, {
        tenantId: row.audit.tenantId, actorId: req.user!.id, action: 'TEST_PROCEDURE_ADDED',
        subjectType: SUBJ_TEST, subjectId: p.id,
        payload: { auditRef: row.audit.ref, ref, testType: p.testType, samplingMethod: p.samplingMethod, sampleSize: p.sampleSize },
      });
      return p;
    });

    res.status(201).json({ status: 'success', procedure: created });
  } catch (error: any) {
    console.error('[Add Procedure Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to add test procedure' });
  }
};

/**
 * Record the test outcome. Exceptions and conclusion must agree — a
 * "Satisfactory" conclusion with exceptions recorded is rejected, because that
 * inconsistency is exactly what an external reviewer would challenge.
 */
export const recordResult = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const procedureId = req.params.procedureId as string;
    const { itemsTested, exceptionsFound, conclusion, narrative } = req.body || {};

    if (!conclusion || !CONCLUSIONS.includes(conclusion)) {
      res.status(400).json({ status: 'error', message: `conclusion must be one of: ${CONCLUSIONS.join(', ')}` });
      return;
    }
    if (!narrative || String(narrative).trim().length < 10) {
      res.status(400).json({ status: 'error', message: 'A narrative of at least 10 characters is required — it is the test evidence' });
      return;
    }

    const tested = Number(itemsTested);
    const exceptions = Number(exceptionsFound) || 0;
    if (!Number.isFinite(tested) || tested < 1) {
      res.status(400).json({ status: 'error', message: 'itemsTested must be at least 1' });
      return;
    }
    if (exceptions > tested) {
      res.status(400).json({ status: 'error', message: 'exceptionsFound cannot exceed itemsTested' });
      return;
    }
    if (exceptions > 0 && conclusion === 'Satisfactory') {
      res.status(400).json({
        status: 'error',
        code: 'CONCLUSION_INCONSISTENT',
        message: `${exceptions} exception(s) were found, so the conclusion cannot be Satisfactory. Use SatisfactoryWithExceptions or Unsatisfactory.`,
      });
      return;
    }
    if (exceptions === 0 && conclusion === 'Unsatisfactory') {
      res.status(400).json({
        status: 'error',
        code: 'CONCLUSION_INCONSISTENT',
        message: 'An Unsatisfactory conclusion requires at least one exception to support it.',
      });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const proc = await prisma.testProcedure.findFirst({
      where: { id: procedureId, engagementRisk: { audit: { tenantId: { in: scope.tenantIds } } } },
      include: {
        result: true,
        engagementRisk: { include: { audit: { select: { id: true, ref: true, tenantId: true, status: true } } } },
      },
    });
    if (!proc) { res.status(404).json({ status: 'error', message: 'Test procedure not found' }); return; }
    if (proc.result) {
      res.status(409).json({ status: 'error', message: 'A result is already recorded. Results are immutable — raise a new procedure to re-test.' });
      return;
    }
    if (proc.engagementRisk.audit.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Cannot record results on a closed audit' });
      return;
    }

    const audit = proc.engagementRisk.audit;

    const result = await prisma.$transaction(async (tx) => {
      const r = await tx.testResult.create({
        data: {
          procedureId,
          itemsTested: tested,
          exceptionsFound: exceptions,
          conclusion,
          narrative: String(narrative).trim(),
          testedById: req.user!.id,
        },
      });
      await tx.testProcedure.update({ where: { id: procedureId }, data: { status: 'Completed' } });
      await writeAudit(tx, {
        tenantId: audit.tenantId, actorId: req.user!.id, action: 'TEST_RESULT_RECORDED',
        subjectType: SUBJ_TEST, subjectId: procedureId,
        payload: { auditRef: audit.ref, procedureRef: proc.ref, itemsTested: tested, exceptions, conclusion },
      });
      return r;
    });

    res.status(201).json({
      status: 'success',
      message: conclusion === 'Satisfactory'
        ? 'Result recorded — control operating effectively.'
        : `Result recorded with ${exceptions} exception(s). Raise a finding from this result if reportable.`,
      result,
      shouldRaiseFinding: conclusion !== 'Satisfactory',
    });
  } catch (error: any) {
    console.error('[Record Result Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to record test result' });
  }
};

/** Link an existing finding to the test result that evidences it. */
export const linkResultToFinding = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const procedureId = req.params.procedureId as string;
    const { findingId } = req.body || {};
    if (!findingId) { res.status(400).json({ status: 'error', message: 'findingId is required' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const proc = await prisma.testProcedure.findFirst({
      where: { id: procedureId, engagementRisk: { audit: { tenantId: { in: scope.tenantIds } } } },
      include: { result: true, engagementRisk: { include: { audit: { select: { id: true, tenantId: true } } } } },
    });
    if (!proc?.result) { res.status(404).json({ status: 'error', message: 'No test result to link' }); return; }

    const finding = await prisma.issue.findFirst({
      where: { id: findingId, auditId: proc.engagementRisk.audit.id },
    });
    if (!finding) {
      res.status(400).json({ status: 'error', message: 'Finding not found on this engagement' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.testResult.update({ where: { id: proc.result!.id }, data: { findingId } });
      await writeAudit(tx, {
        tenantId: proc.engagementRisk.audit.tenantId, actorId: req.user!.id,
        action: 'TEST_RESULT_LINKED_TO_FINDING',
        subjectType: SUBJ_TEST, subjectId: procedureId,
        payload: { findingRef: finding.ref, procedureRef: proc.ref },
      });
    });

    res.json({ status: 'success', message: `Result linked to ${finding.ref}` });
  } catch (error: any) {
    console.error('[Link Result Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to link result to finding' });
  }
};

// ─── Workpapers ────────────────────────────────────────────────────────────

export const listWorkpapers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const auditId = req.params.id as string;
    const audit = await scopedAudit(req, auditId);
    if (!audit) { res.status(404).json({ status: 'error', message: 'Audit not found' }); return; }

    const papers = await prisma.workpaper.findMany({
      where: { auditId },
      include: {
        preparedBy: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        procedure: { select: { id: true, ref: true, objective: true } },
        reviewNotes: {
          include: {
            raisedBy: { select: { id: true, name: true } },
            clearedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ section: 'asc' }, { ref: 'asc' }],
    });

    const enriched = papers.map((w) => ({
      ...w,
      openNotes: w.reviewNotes.filter((n) => n.status === 'Open').length,
    }));

    res.json({
      status: 'success',
      audit: { id: audit.id, ref: audit.ref, title: audit.title, status: audit.status },
      count: enriched.length,
      totals: {
        total: enriched.length,
        draft: enriched.filter((w) => w.status === 'Draft').length,
        awaitingReview: enriched.filter((w) => w.status === 'SubmittedForReview').length,
        reviewed: enriched.filter((w) => w.status === 'Reviewed').length,
        returned: enriched.filter((w) => w.status === 'Returned').length,
        openReviewNotes: enriched.reduce((a, w) => a + w.openNotes, 0),
      },
      workpapers: enriched,
      /// The engagement cannot be reported until this is true (IIA Std 14.5).
      fileReadyForReporting: enriched.length > 0 && enriched.every((w) => w.status === 'Reviewed'),
    });
  } catch (error: any) {
    console.error('[List Workpapers Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list workpapers' });
  }
};

export const createWorkpaper = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const auditId = req.params.id as string;
    const { ref, title, section, content, procedureId, fileName, fileUrl } = req.body || {};
    if (!title) { res.status(400).json({ status: 'error', message: 'title is required' }); return; }
    if (section && !SECTIONS.includes(section)) {
      res.status(400).json({ status: 'error', message: `section must be one of: ${SECTIONS.join(', ')}` });
      return;
    }

    const audit = await scopedAudit(req, auditId);
    if (!audit) { res.status(404).json({ status: 'error', message: 'Audit not found' }); return; }
    if (audit.status === 'Closed') {
      res.status(409).json({ status: 'error', message: 'Cannot add workpapers to a closed audit' });
      return;
    }

    const sec = section || 'Fieldwork';
    let paperRef = ref;
    if (!paperRef) {
      const prefix = sec === 'Planning' ? 'A' : sec === 'Fieldwork' ? 'B' : 'C';
      const count = await prisma.workpaper.count({ where: { auditId, section: sec } });
      paperRef = `${prefix}-${count + 1}`;
    }

    const dup = await prisma.workpaper.findFirst({ where: { auditId, ref: paperRef } });
    if (dup) {
      res.status(409).json({ status: 'error', message: `Workpaper ${paperRef} already exists on this engagement` });
      return;
    }

    const paper = await prisma.$transaction(async (tx) => {
      const created = await tx.workpaper.create({
        data: {
          auditId,
          ref: paperRef,
          title: String(title).trim(),
          section: sec,
          content: content || null,
          fileName: fileName || null,
          fileUrl: fileUrl || null,
          procedureId: procedureId || null,
          preparedById: req.user!.id,
          status: 'Draft',
        },
      });
      await writeAudit(tx, {
        tenantId: audit.tenantId, actorId: req.user!.id, action: 'WORKPAPER_CREATED',
        subjectType: SUBJ_WP, subjectId: created.id,
        payload: { auditRef: audit.ref, ref: paperRef, section: sec },
      });
      return created;
    });

    res.status(201).json({ status: 'success', workpaper: paper });
  } catch (error: any) {
    console.error('[Create Workpaper Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to create workpaper' });
  }
};

export const submitWorkpaper = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.wpId as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const wp = await prisma.workpaper.findFirst({
      where: { id, audit: { tenantId: { in: scope.tenantIds } } },
      include: { audit: { select: { tenantId: true, ref: true } } },
    });
    if (!wp) { res.status(404).json({ status: 'error', message: 'Workpaper not found' }); return; }
    if (!['Draft', 'Returned'].includes(wp.status)) {
      res.status(409).json({ status: 'error', message: `Workpaper is ${wp.status}` });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.workpaper.update({ where: { id }, data: { status: 'SubmittedForReview' } });
      await writeAudit(tx, {
        tenantId: wp.audit.tenantId, actorId: req.user!.id, action: 'WORKPAPER_SUBMITTED',
        subjectType: SUBJ_WP, subjectId: id,
        payload: { auditRef: wp.audit.ref, ref: wp.ref },
      });
    });

    res.json({ status: 'success', message: `${wp.ref} submitted for review` });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to submit workpaper' });
  }
};

/** A reviewer's coaching note. The preparer cannot raise notes on their own paper. */
export const addReviewNote = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.wpId as string;
    const { note } = req.body || {};
    if (!note) { res.status(400).json({ status: 'error', message: 'note is required' }); return; }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const wp = await prisma.workpaper.findFirst({
      where: { id, audit: { tenantId: { in: scope.tenantIds } } },
      include: { audit: { select: { tenantId: true, ref: true } } },
    });
    if (!wp) { res.status(404).json({ status: 'error', message: 'Workpaper not found' }); return; }
    if (wp.preparedById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'The preparer cannot raise review notes on their own workpaper.',
      });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const n = await tx.workpaperReviewNote.create({
        data: { workpaperId: id, note: String(note).trim(), raisedById: req.user!.id, status: 'Open' },
      });
      // A note sends the paper back to the preparer.
      await tx.workpaper.update({ where: { id }, data: { status: 'Returned' } });
      await writeAudit(tx, {
        tenantId: wp.audit.tenantId, actorId: req.user!.id, action: 'WORKPAPER_REVIEW_NOTE_RAISED',
        subjectType: SUBJ_WP, subjectId: id,
        payload: { auditRef: wp.audit.ref, ref: wp.ref },
      });
      return n;
    });

    res.status(201).json({ status: 'success', message: 'Review note raised; workpaper returned to preparer', note: created });
  } catch (error: any) {
    console.error('[Review Note Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to raise review note' });
  }
};

export const clearReviewNote = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const noteId = req.params.noteId as string;
    const { response } = req.body || {};
    if (!response) {
      res.status(400).json({ status: 'error', message: 'A response is required to clear a review note' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const note = await prisma.workpaperReviewNote.findFirst({
      where: { id: noteId, workpaper: { audit: { tenantId: { in: scope.tenantIds } } } },
      include: { workpaper: { include: { audit: { select: { tenantId: true, ref: true } } } } },
    });
    if (!note) { res.status(404).json({ status: 'error', message: 'Review note not found' }); return; }
    if (note.status === 'Cleared') {
      res.status(409).json({ status: 'error', message: 'Note is already cleared' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.workpaperReviewNote.update({
        where: { id: noteId },
        data: { status: 'Cleared', response: String(response).trim(), clearedById: req.user!.id, clearedAt: new Date() },
      });
      await writeAudit(tx, {
        tenantId: note.workpaper.audit.tenantId, actorId: req.user!.id,
        action: 'WORKPAPER_REVIEW_NOTE_CLEARED',
        subjectType: SUBJ_WP, subjectId: note.workpaperId,
        payload: { ref: note.workpaper.ref, response },
      });
    });

    res.json({ status: 'success', message: 'Review note cleared' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to clear review note' });
  }
};

/**
 * Reviewer sign-off. Two hard controls:
 *   1. The preparer cannot review their own workpaper (SoD).
 *   2. Every review note must be cleared first — an open note means the file
 *      is not complete, and signing over it is the classic QA failure.
 */
export const reviewWorkpaper = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.wpId as string;
    const { conclusion } = req.body || {};

    const scope = await resolveTenantScope(req.user!.tenantId);
    const wp = await prisma.workpaper.findFirst({
      where: { id, audit: { tenantId: { in: scope.tenantIds } } },
      include: {
        audit: { select: { tenantId: true, ref: true } },
        reviewNotes: { where: { status: 'Open' }, select: { id: true } },
      },
    });
    if (!wp) { res.status(404).json({ status: 'error', message: 'Workpaper not found' }); return; }
    if (wp.status !== 'SubmittedForReview') {
      res.status(409).json({ status: 'error', message: `Only a submitted workpaper can be signed off (current: ${wp.status})` });
      return;
    }
    if (wp.preparedById === req.user!.id) {
      res.status(403).json({
        status: 'error',
        code: 'SOD_VIOLATION',
        message: 'Independent review required: the preparer cannot sign off their own workpaper.',
      });
      return;
    }
    if (wp.reviewNotes.length > 0) {
      res.status(409).json({
        status: 'error',
        code: 'OPEN_REVIEW_NOTES',
        message: `${wp.reviewNotes.length} review note(s) are still open. Clear them before sign-off.`,
      });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.workpaper.update({
        where: { id },
        data: {
          status: 'Reviewed',
          reviewedById: req.user!.id,
          reviewedAt: new Date(),
          reviewConclusion: conclusion || 'Workpaper reviewed and accepted.',
        },
      });
      await writeAudit(tx, {
        tenantId: wp.audit.tenantId, actorId: req.user!.id, action: 'WORKPAPER_REVIEWED',
        subjectType: SUBJ_WP, subjectId: id,
        payload: { auditRef: wp.audit.ref, ref: wp.ref, preparedById: wp.preparedById },
      });
      return u;
    });

    res.json({ status: 'success', message: `${wp.ref} reviewed and signed off`, workpaper: updated });
  } catch (error: any) {
    console.error('[Review Workpaper Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to review workpaper' });
  }
};
