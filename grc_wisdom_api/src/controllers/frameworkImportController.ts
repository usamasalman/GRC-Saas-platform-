import { Response } from 'express';
import fs from 'fs';
import path from 'path';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { extractFromSpreadsheet, CandidateKind } from '../services/spreadsheetExtractor';
import { extractFromDocument } from '../services/documentExtractor';

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const SUBJ_IMPORT = 'FrameworkImport';
const KINDS: CandidateKind[] = ['Clause', 'Control'];

/** Mirrors the base64 upload the document module already uses. */
function persistUpload(fileData: string, fileName: string): { fileUrl: string; buffer: Buffer } {
  const matches = fileData.match(/^data:(.+);base64,(.+)$/);
  const raw = matches ? matches[2] : fileData;
  const buffer = Buffer.from(raw, 'base64');
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, safeName), buffer);
  return { fileUrl: `/uploads/${safeName}`, buffer };
}

/**
 * Upload a spreadsheet and stage what it contains. Nothing reaches the
 * standards or control library here — extraction produces candidates a person
 * then accepts, edits or rejects.
 */
export const uploadImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      kind, fileName, fileData, targetStandardId,
      newStandardCode, newStandardTitle, newStandardAuthority, newStandardVersion,
    } = req.body || {};

    if (!kind || !KINDS.includes(kind)) {
      res.status(400).json({ status: 'error', message: `kind must be one of: ${KINDS.join(', ')}` });
      return;
    }
    if (!fileName || !fileData) {
      res.status(400).json({ status: 'error', message: 'fileName and fileData (base64) are required' });
      return;
    }

    const ext = String(fileName).split('.').pop()?.toLowerCase() as
      'xlsx' | 'csv' | 'pdf' | 'docx' | undefined;
    if (!ext || !['xlsx', 'csv', 'pdf', 'docx'].includes(ext)) {
      res.status(400).json({
        status: 'error',
        code: 'UNSUPPORTED_FORMAT',
        message: 'Accepted formats are .xlsx, .csv, .pdf and .docx.',
      });
      return;
    }
    // A document is prose, so there are no columns to map controls from.
    if (kind === 'Control' && (ext === 'pdf' || ext === 'docx')) {
      res.status(400).json({
        status: 'error',
        code: 'CONTROLS_NEED_A_TABLE',
        message: 'Control import needs a spreadsheet — a control set has fields (code, title, objective, domain) that prose does not separate reliably. Export the control list to .xlsx and upload that.',
      });
      return;
    }

    const tenantId = req.user!.tenantId;

    // Clauses need somewhere to land: an existing standard you own, or enough
    // detail to create one at commit time.
    if (kind === 'Clause') {
      if (targetStandardId) {
        const scope = await resolveTenantScope(tenantId);
        const std = await prisma.standard.findUnique({ where: { id: targetStandardId } });
        if (!std) { res.status(404).json({ status: 'error', message: 'Target standard not found' }); return; }
        if (std.isSystem) {
          res.status(403).json({
            status: 'error',
            code: 'SYSTEM_STANDARD',
            message: `${std.code} is a published standard and cannot be added to. Author your own framework instead.`,
          });
          return;
        }
        if (std.tenantId !== null && !scope.tenantIds.includes(std.tenantId)) {
          res.status(403).json({ status: 'error', message: 'That standard belongs to another organisation' });
          return;
        }
      } else if (!newStandardCode || !newStandardTitle) {
        res.status(400).json({
          status: 'error',
          code: 'TARGET_REQUIRED',
          message: 'Either name an existing standard to add these clauses to, or supply newStandardCode and newStandardTitle to create one.',
        });
        return;
      }
    }

    const { fileUrl, buffer } = persistUpload(String(fileData), String(fileName));
    const isDocument = ext === 'pdf' || ext === 'docx';
    const extraction = isDocument
      ? await extractFromDocument(buffer, kind, ext as 'pdf' | 'docx')
      : await extractFromSpreadsheet(buffer, kind, ext as 'xlsx' | 'csv');

    if (extraction.candidates.length === 0) {
      res.status(422).json({
        status: 'error',
        code: 'NOTHING_EXTRACTED',
        message: extraction.warnings[0] || 'No rows could be read from that file.',
        warnings: extraction.warnings,
      });
      return;
    }

    // A reference already in the target standard would be refused at commit,
    // so it is flagged now rather than after the reviewer has worked through it.
    let existingRefs = new Set<string>();
    if (kind === 'Clause' && targetStandardId) {
      const rows = await prisma.standardClause.findMany({
        where: { standardId: targetStandardId }, select: { ref: true },
      });
      existingRefs = new Set(rows.map((r) => r.ref.toLowerCase()));
    } else if (kind === 'Control') {
      const rows = await prisma.control.findMany({
        where: { tenantId }, select: { code: true },
      });
      existingRefs = new Set(rows.map((r) => r.code.toLowerCase()));
    }

    const created = await prisma.$transaction(async (tx) => {
      const imp = await tx.frameworkImport.create({
        data: {
          tenantId, kind,
          fileName: String(fileName), fileUrl, fileType: ext,
          targetStandardId: targetStandardId || null,
          newStandardCode: newStandardCode ? String(newStandardCode).trim().toUpperCase() : null,
          newStandardTitle: newStandardTitle ? String(newStandardTitle).trim() : null,
          newStandardAuthority: newStandardAuthority ? String(newStandardAuthority).trim() : null,
          newStandardVersion: newStandardVersion ? String(newStandardVersion).trim() : null,
          extractedCount: extraction.candidates.length,
          uploadedById: req.user!.id,
        },
      });

      await tx.importCandidate.createMany({
        data: extraction.candidates.map((c) => {
          const clash = c.ref && existingRefs.has(c.ref.toLowerCase());
          return {
            importId: imp.id,
            rowNumber: c.rowNumber,
            ref: c.ref, title: c.title, body: c.body, extra: c.extra,
            confidence: clash ? 'Low' : c.confidence,
            issue: clash
              ? `"${c.ref}" already exists here — accepting it would be refused at commit`
              : c.issue,
          };
        }),
      });

      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'FRAMEWORK_IMPORT_UPLOADED',
        subjectType: SUBJ_IMPORT, subjectId: imp.id,
        payload: { kind, fileName, fileType: ext, extracted: extraction.candidates.length },
      });
      return imp;
    });

    const needsReview = extraction.candidates.filter((c) => c.confidence !== 'High' || c.issue).length;
    res.status(201).json({
      status: 'success',
      message: `${extraction.candidates.length} row(s) read from ${fileName}. ${needsReview > 0 ? `${needsReview} need a look. ` : ''}Nothing has entered the library yet — review and commit to apply them.`,
      import: created,
      source: isDocument
        ? { kind: 'document', pageCount: (extraction as any).pageCount, discarded: (extraction as any).discarded }
        : { kind: 'spreadsheet', headerRow: (extraction as any).headerRow, columnsUsed: (extraction as any).columnsUsed },
      warnings: extraction.warnings,
    });
  } catch (error: any) {
    console.error('[Import Upload Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to read that file' });
  }
};

export const listImports = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imports = await prisma.frameworkImport.findMany({
      where: { tenantId: { in: scope.tenantIds } },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        targetStandard: { select: { id: true, code: true } },
        _count: { select: { candidates: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ status: 'success', count: imports.length, imports });
  } catch (error: any) {
    console.error('[Import List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list imports' });
  }
};

/** The review screen: lowest confidence first, because that is where parses go wrong. */
export const getImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        targetStandard: { select: { id: true, code: true, title: true } },
        candidates: true,
      },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }

    const rank: Record<string, number> = { Low: 0, Medium: 1, High: 2 };
    const candidates = [...imp.candidates].sort(
      (a, b) => (rank[a.confidence] - rank[b.confidence]) || (a.rowNumber - b.rowNumber),
    );

    res.json({
      status: 'success',
      import: { ...imp, candidates: undefined },
      totals: {
        extracted: imp.candidates.length,
        pending: imp.candidates.filter((c) => c.status === 'Pending').length,
        accepted: imp.candidates.filter((c) => c.status === 'Accepted').length,
        rejected: imp.candidates.filter((c) => c.status === 'Rejected').length,
        needsAttention: imp.candidates.filter((c) => c.issue || c.confidence !== 'High').length,
      },
      candidates,
    });
  } catch (error: any) {
    console.error('[Import Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load import' });
  }
};

/** Accept, reject, or correct a row before it is committed. */
export const reviewCandidate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const candidateId = req.params.candidateId as string;
    const { decision, ref, title, body, extra } = req.body || {};

    const scope = await resolveTenantScope(req.user!.tenantId);
    const cand = await prisma.importCandidate.findFirst({
      where: { id: candidateId, import: { tenantId: { in: scope.tenantIds } } },
      include: { import: { select: { id: true, status: true } } },
    });
    if (!cand) { res.status(404).json({ status: 'error', message: 'Row not found' }); return; }
    if (cand.import.status !== 'Extracted') {
      res.status(409).json({
        status: 'error',
        code: 'IMPORT_SETTLED',
        message: `This import is ${cand.import.status.toLowerCase()} and can no longer be edited.`,
      });
      return;
    }

    const data: any = {};
    if (ref !== undefined) data.ref = String(ref).trim();
    if (title !== undefined) data.title = String(title).trim();
    if (body !== undefined) data.body = body ? String(body).trim() : null;
    if (extra !== undefined) data.extra = extra ? String(extra).trim() : null;

    if (decision) {
      if (!['Accepted', 'Rejected', 'Pending'].includes(decision)) {
        res.status(400).json({ status: 'error', message: 'decision must be Accepted, Rejected or Pending' });
        return;
      }
      const finalRef = data.ref ?? cand.ref;
      const finalTitle = data.title ?? cand.title;
      if (decision === 'Accepted' && (!finalRef || !finalTitle)) {
        res.status(400).json({
          status: 'error',
          code: 'INCOMPLETE_ROW',
          message: 'A row needs both a reference and a title before it can be accepted. Correct it here, or reject it.',
        });
        return;
      }
      data.status = decision;
      // Correcting the row clears the parser's complaint about it.
      if (decision === 'Accepted') data.issue = null;
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ status: 'error', message: 'Nothing to change' });
      return;
    }

    const updated = await prisma.importCandidate.update({ where: { id: candidateId }, data });
    res.json({ status: 'success', candidate: updated });
  } catch (error: any) {
    console.error('[Candidate Review Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update row' });
  }
};

/** Accept every row that has no outstanding problem. */
export const acceptClean = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }
    if (imp.status !== 'Extracted') {
      res.status(409).json({ status: 'error', message: `This import is already ${imp.status.toLowerCase()}` });
      return;
    }

    const result = await prisma.importCandidate.updateMany({
      where: { importId: id, status: 'Pending', issue: null, confidence: 'High' },
      data: { status: 'Accepted' },
    });
    const left = await prisma.importCandidate.count({ where: { importId: id, status: 'Pending' } });

    res.json({
      status: 'success',
      message: `${result.count} clean row(s) accepted. ${left > 0 ? `${left} still need a decision.` : 'Nothing left to review.'}`,
      accepted: result.count,
      stillPending: left,
    });
  } catch (error: any) {
    console.error('[Accept Clean Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to accept rows' });
  }
};

/** The deliberate act: accepted rows become real clauses or controls. */
export const commitImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds } },
      include: { candidates: { where: { status: 'Accepted' } } },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }
    if (imp.status !== 'Extracted') {
      res.status(409).json({ status: 'error', message: `This import is already ${imp.status.toLowerCase()}` });
      return;
    }
    if (imp.candidates.length === 0) {
      res.status(409).json({
        status: 'error',
        code: 'NOTHING_ACCEPTED',
        message: 'No rows have been accepted. Review the extracted rows first — nothing is imported automatically.',
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      let standardId = imp.targetStandardId;
      let createdStandard = null;

      if (imp.kind === 'Clause' && !standardId) {
        const clash = await tx.standard.findFirst({
          where: { tenantId: imp.tenantId, code: imp.newStandardCode! },
        });
        if (clash) throw new Error(`A standard with code "${imp.newStandardCode}" already exists here`);
        createdStandard = await tx.standard.create({
          data: {
            tenantId: imp.tenantId,
            code: imp.newStandardCode!,
            title: imp.newStandardTitle!,
            authority: imp.newStandardAuthority || 'Internal',
            version: imp.newStandardVersion || '1.0',
            isSystem: false,
          },
        });
        standardId = createdStandard.id;
      }

      if (imp.kind === 'Clause') {
        await tx.standardClause.createMany({
          data: imp.candidates.map((c) => ({
            standardId: standardId!, ref: c.ref, title: c.title, text: c.body,
          })),
        });
      } else {
        await tx.control.createMany({
          data: imp.candidates.map((c) => ({
            tenantId: imp.tenantId,
            code: c.ref, title: c.title,
            objective: c.body || c.title,
            domain: c.extra || 'General',
          })),
        });
      }

      const done = await tx.frameworkImport.update({
        where: { id },
        data: {
          status: 'Committed',
          committedCount: imp.candidates.length,
          committedAt: new Date(),
          targetStandardId: standardId,
        },
      });

      await writeAudit(tx, {
        tenantId: imp.tenantId, actorId: req.user!.id, action: 'FRAMEWORK_IMPORT_COMMITTED',
        subjectType: SUBJ_IMPORT, subjectId: id,
        payload: {
          kind: imp.kind, fileName: imp.fileName, committed: imp.candidates.length,
          standardCreated: createdStandard?.code ?? null,
          refs: imp.candidates.map((c) => c.ref).slice(0, 40),
        },
      });
      return { done, createdStandard, count: imp.candidates.length };
    });

    res.json({
      status: 'success',
      message: imp.kind === 'Clause'
        ? `${result.count} clause(s) committed${result.createdStandard ? ` to the new standard ${result.createdStandard.code}` : ''}. Map controls to them to make the framework auditable.`
        : `${result.count} control(s) added to your library. Map them to clauses to show what they satisfy.`,
      import: result.done,
      standard: result.createdStandard,
    });
  } catch (error: any) {
    if (/already exists/.test(error?.message || '')) {
      res.status(409).json({ status: 'error', message: error.message });
      return;
    }
    console.error('[Import Commit Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to commit import' });
  }
};

export const discardImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({ where: { id, tenantId: { in: scope.tenantIds } } });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }
    if (imp.status === 'Committed') {
      res.status(409).json({
        status: 'error',
        message: 'This import was committed. Remove the clauses or controls it created instead.',
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.frameworkImport.update({ where: { id }, data: { status: 'Discarded' } });
      await writeAudit(tx, {
        tenantId: imp.tenantId, actorId: req.user!.id, action: 'FRAMEWORK_IMPORT_DISCARDED',
        subjectType: SUBJ_IMPORT, subjectId: id,
        payload: { fileName: imp.fileName, extracted: imp.extractedCount },
      });
    });

    res.json({ status: 'success', message: `${imp.fileName} discarded — nothing was imported` });
  } catch (error: any) {
    console.error('[Import Discard Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to discard import' });
  }
};
