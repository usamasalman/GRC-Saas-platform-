import { Response } from 'express';
import ExcelJS from 'exceljs';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import {
  extractRisksFromSpreadsheet, RISK_TEMPLATE_COLUMNS, RiskRow,
} from '../services/riskImportExtractor';
import { scoreOf, nextReviewFrom } from '../services/riskScoring';
import { treatmentsFor } from '../services/riskLifecycle';
import { CATEGORIES } from './riskController';

const SUBJ_IMPORT = 'RiskImport';

/**
 * Bulk risk import, staged.
 *
 * The register is where every downstream decision starts, so this path has the
 * same discipline as creating one risk by hand — including the duplicate check.
 * Skipping it in bulk would be the fastest way to fill a register with three
 * spellings of the same risk and lose the trust of everyone reading it.
 */

// ─── Template ──────────────────────────────────────────────────────────────

export const downloadRiskTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GRC Wisdom';
    const sheet = wb.addWorksheet('Risks');

    sheet.addRow(RISK_TEMPLATE_COLUMNS.map((c) => c.header));
    sheet.addRow(RISK_TEMPLATE_COLUMNS.map((c) => c.example));

    const head = sheet.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F7A5A' } };
    head.height = 20;
    RISK_TEMPLATE_COLUMNS.forEach((c, i) => {
      sheet.getColumn(i + 1).width = Math.max(16, Math.min(46, c.header.length + 10));
    });
    sheet.getRow(2).font = { italic: true, color: { argb: 'FF7C8A85' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const guide = wb.addWorksheet('How to fill this in');
    guide.columns = [
      { header: 'Column', key: 'c', width: 22 },
      { header: 'Required', key: 'r', width: 11 },
      { header: 'What to put in it', key: 'h', width: 92 },
    ];
    guide.getRow(1).font = { bold: true };
    RISK_TEMPLATE_COLUMNS.forEach((c) => {
      guide.addRow({ c: c.header, r: c.required ? 'Yes' : 'Optional', h: c.help });
    });
    guide.addRow({});
    guide.addRow({
      c: 'Inherent score',
      r: 'Derived',
      h: 'Not a column. Inherent score is likelihood x impact, computed on import.',
    });
    guide.addRow({
      c: 'Residual score',
      r: 'Derived',
      h: 'Not a column. An imported risk opens with residual equal to inherent because no control is '
        + 'linked yet. Link controls afterwards and residual recomputes from their verified effectiveness.',
    });
    guide.addRow({
      c: 'Duplicates',
      r: '—',
      h: 'Rows whose title resembles a risk already in the register are flagged for you to judge. '
        + 'They are not rejected, and they are not imported silently either.',
    });
    guide.getColumn('h').alignment = { wrapText: true, vertical: 'top' };

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Risk_import_template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('[Risk Template Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the template' });
  }
};

// ─── Upload and extract ────────────────────────────────────────────────────

export const uploadRiskImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { fileName, fileType, contentBase64 } = req.body || {};
    if (!fileName || !contentBase64) {
      res.status(400).json({ status: 'error', message: 'fileName and contentBase64 are required' });
      return;
    }
    const type = String(fileType || '').toLowerCase();
    if (!['xlsx', 'csv'].includes(type)) {
      res.status(400).json({
        status: 'error',
        code: 'UNSUPPORTED_FILE_TYPE',
        message: 'A register is imported from a spreadsheet — xlsx or csv. A PDF has no columns to map.',
      });
      return;
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    if (buffer.length === 0) {
      res.status(400).json({ status: 'error', message: 'The uploaded file is empty' });
      return;
    }

    const tenantId = req.user!.tenantId;
    // The live register, so near-duplicates can be flagged at extraction time
    // rather than discovered weeks later by whoever has to clean it up.
    const existing = await prisma.risk.findMany({
      where: { tenantId, status: { not: 'Closed' } },
      select: { title: true },
    });

    const extraction = await extractRisksFromSpreadsheet(buffer, type as 'xlsx' | 'csv', existing);

    const record = await prisma.$transaction(async (tx) => {
      const imp = await tx.frameworkImport.create({
        data: {
          tenantId, kind: 'Risk',
          fileName: String(fileName),
          fileUrl: 'local://risk-import/' + Date.now() + '-' + fileName,
          fileType: type,
          status: 'Extracted',
          extractedCount: extraction.candidates.length,
          uploadedById: req.user!.id,
        },
      });
      for (const c of extraction.candidates) {
        await tx.importCandidate.create({
          data: {
            importId: imp.id,
            rowNumber: c.rowNumber,
            ref: c.row.title.slice(0, 120) || '(row ' + c.rowNumber + ')',
            title: c.row.category + ' · ' + c.row.direction + ' · inherent ' + c.row.inherentScore,
            body: c.notes.length ? c.notes.join('; ') : null,
            extra: c.possibleDuplicates.length ? JSON.stringify(c.possibleDuplicates) : null,
            payload: JSON.stringify(c.row),
            confidence: c.confidence,
            issue: c.issue,
            status: 'Pending',
          },
        });
      }
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'RISK_IMPORT_UPLOADED',
        subjectType: SUBJ_IMPORT, subjectId: imp.id,
        payload: {
          fileName, fileType: type,
          extracted: extraction.candidates.length,
          blocked: extraction.candidates.filter((c) => c.issue).length,
          possibleDuplicates: extraction.candidates.filter((c) => c.possibleDuplicates.length).length,
          columnsUsed: extraction.columnsUsed,
        },
      });
      return imp;
    });

    const blocked = extraction.candidates.filter((c) => c.issue).length;
    const dupes = extraction.candidates.filter((c) => c.possibleDuplicates.length).length;
    const parts: string[] = [];
    if (blocked) parts.push(blocked + ' needing correction');
    if (dupes) parts.push(dupes + ' resembling a risk already on the register');

    res.status(201).json({
      status: 'success',
      message: extraction.candidates.length === 0
        ? 'Nothing could be read from that file. See the warnings below.'
        : extraction.candidates.length + ' row(s) read'
          + (parts.length ? ', ' + parts.join(' and ') : '')
          + '. Nothing has entered the register yet — review, then commit.',
      import: record,
      headerRow: extraction.headerRow,
      columnsUsed: extraction.columnsUsed,
      unmappedColumns: extraction.unmappedColumns,
      warnings: extraction.warnings,
    });
  } catch (error: any) {
    console.error('[Risk Import Upload Error]:', error);
    res.status(500).json({
      status: 'error',
      message: 'Could not read that file. If it opens in Excel, try saving it as .xlsx or .csv and uploading again.',
    });
  }
};

// ─── Review ────────────────────────────────────────────────────────────────

export const listRiskImports = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imports = await prisma.frameworkImport.findMany({
      where: { tenantId: { in: scope.tenantIds }, kind: 'Risk' },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { candidates: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ status: 'success', count: imports.length, imports });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to list imports' });
  }
};

export const getRiskImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: 'Risk' },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        candidates: { orderBy: { rowNumber: 'asc' } },
      },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }

    const order: Record<string, number> = { Low: 0, Medium: 1, High: 2 };
    const candidates = [...imp.candidates]
      .map((c) => ({
        ...c,
        parsed: c.payload ? JSON.parse(c.payload) as RiskRow : null,
        possibleDuplicates: c.extra ? JSON.parse(c.extra) as string[] : [],
      }))
      .sort((a, b) => {
        if (!!a.issue !== !!b.issue) return a.issue ? -1 : 1;
        const d = (order[a.confidence] ?? 3) - (order[b.confidence] ?? 3);
        return d !== 0 ? d : a.rowNumber - b.rowNumber;
      });

    res.json({
      status: 'success',
      import: { ...imp, candidates: undefined },
      candidates,
      categories: CATEGORIES,
      totals: {
        total: candidates.length,
        blocked: candidates.filter((c) => c.issue).length,
        duplicates: candidates.filter((c) => c.possibleDuplicates.length > 0).length,
        accepted: candidates.filter((c) => c.status === 'Accepted').length,
        rejected: candidates.filter((c) => c.status === 'Rejected').length,
        pending: candidates.filter((c) => c.status === 'Pending').length,
        high: candidates.filter((c) => c.confidence === 'High').length,
      },
    });
  } catch (error: any) {
    console.error('[Risk Import Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the import' });
  }
};

export const reviewRiskCandidate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const candidateId = req.params.candidateId as string;
    const { status, corrections } = req.body || {};
    if (status && !['Accepted', 'Rejected', 'Pending'].includes(status)) {
      res.status(400).json({ status: 'error', message: 'status must be Accepted, Rejected or Pending' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const cand = await prisma.importCandidate.findFirst({
      where: { id: candidateId, import: { tenantId: { in: scope.tenantIds }, kind: 'Risk' } },
      include: { import: { select: { id: true, tenantId: true, status: true } } },
    });
    if (!cand) { res.status(404).json({ status: 'error', message: 'Row not found' }); return; }
    if (cand.import.status !== 'Extracted') {
      res.status(409).json({ status: 'error', message: 'This import is ' + cand.import.status + ' and can no longer be edited.' });
      return;
    }

    const data: any = {};
    const parsed = cand.payload ? JSON.parse(cand.payload) as RiskRow : null;

    if (corrections && parsed) {
      for (const k of ['title', 'description', 'identifiedSource', 'ownerEmail', 'assetKey'] as const) {
        if (corrections[k] !== undefined) (parsed as any)[k] = corrections[k] || null;
      }
      if (corrections.category !== undefined) {
        if (!CATEGORIES.includes(corrections.category)) {
          res.status(400).json({ status: 'error', message: 'category must be one of: ' + CATEGORIES.join(', ') });
          return;
        }
        parsed.category = corrections.category;
      }
      if (corrections.direction !== undefined) {
        if (!['Threat', 'Opportunity'].includes(corrections.direction)) {
          res.status(400).json({ status: 'error', message: 'direction must be Threat or Opportunity' });
          return;
        }
        parsed.direction = corrections.direction;
        // Changing direction can strand the treatment, so re-default it rather
        // than leaving an "Avoided opportunity" behind.
        if (!treatmentsFor(parsed.direction).includes(parsed.treatmentType)) {
          parsed.treatmentType = parsed.direction === 'Opportunity' ? 'Enhance' : 'Mitigate';
        }
      }
      if (corrections.treatmentType !== undefined) {
        const allowed = treatmentsFor(parsed.direction);
        if (!allowed.includes(corrections.treatmentType)) {
          res.status(400).json({
            status: 'error',
            code: 'TREATMENT_DIRECTION_MISMATCH',
            message: 'For a ' + parsed.direction.toLowerCase() + ', treatment must be one of: ' + allowed.join(', '),
          });
          return;
        }
        parsed.treatmentType = corrections.treatmentType;
      }
      for (const k of ['likelihood', 'impact'] as const) {
        if (corrections[k] !== undefined) {
          const n = Number(corrections[k]);
          if (!Number.isInteger(n) || n < 1 || n > 5) {
            res.status(400).json({ status: 'error', message: k + ' must be a whole number from 1 to 5' });
            return;
          }
          parsed[k] = n;
        }
      }
      parsed.inherentScore = scoreOf(parsed.likelihood, parsed.impact).score;

      let issue: string | null = null;
      if (!parsed.title) issue = 'No risk title.';
      else if (!treatmentsFor(parsed.direction).includes(parsed.treatmentType)) {
        issue = 'Treatment does not match the direction.';
      }
      data.issue = issue;
      data.payload = JSON.stringify(parsed);
      data.ref = parsed.title.slice(0, 120);
      data.title = parsed.category + ' · ' + parsed.direction + ' · inherent ' + parsed.inherentScore;
      data.confidence = issue ? 'Low' : 'High';
    }

    if (status) {
      // `??` would be wrong: a successful correction sets data.issue to null and
      // `null ?? cand.issue` falls back to the old one, blocking the row forever.
      const effectiveIssue = 'issue' in data ? data.issue : cand.issue;
      if (status === 'Accepted' && effectiveIssue) {
        res.status(409).json({
          status: 'error',
          code: 'ROW_BLOCKED',
          message: 'This row cannot be accepted as it stands: ' + effectiveIssue,
        });
        return;
      }
      data.status = status;
    }

    const updated = await prisma.importCandidate.update({ where: { id: candidateId }, data });
    res.json({
      status: 'success',
      message: corrections ? 'Row corrected.' : 'Row ' + String(status).toLowerCase() + '.',
      candidate: { ...updated, parsed },
    });
  } catch (error: any) {
    console.error('[Risk Candidate Review Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update the row' });
  }
};

/**
 * Accepts rows the parser read cleanly. Anything resembling an existing risk is
 * deliberately excluded — a possible duplicate is exactly the row a person has
 * to look at, and bulk-accepting it defeats the check.
 */
export const acceptCleanRiskRows = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: 'Risk' },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }

    const result = await prisma.importCandidate.updateMany({
      where: { importId: id, status: 'Pending', issue: null, confidence: 'High', extra: null },
      data: { status: 'Accepted' },
    });

    res.json({
      status: 'success',
      message: result.count + ' row(s) the parser read cleanly are accepted. '
        + 'Anything defaulted, flagged, or resembling a risk already on the register still needs your eye.',
      accepted: result.count,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to accept rows' });
  }
};

// ─── Commit ────────────────────────────────────────────────────────────────

export const commitRiskImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: 'Risk' },
      include: { candidates: { where: { status: 'Accepted' } } },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }
    if (imp.status !== 'Extracted') {
      res.status(409).json({ status: 'error', message: 'This import is already ' + imp.status + '.' });
      return;
    }
    if (imp.candidates.length === 0) {
      res.status(409).json({
        status: 'error',
        code: 'NOTHING_ACCEPTED',
        message: 'No rows are accepted yet. Review the rows and accept the ones you want before committing.',
      });
      return;
    }

    const emails = new Set<string>();
    const assetKeys = new Set<string>();
    for (const c of imp.candidates) {
      const p = c.payload ? JSON.parse(c.payload) as RiskRow : null;
      if (p?.ownerEmail) emails.add(p.ownerEmail.toLowerCase());
      if (p?.assetKey) assetKeys.add(p.assetKey.toLowerCase().trim());
    }
    const users = emails.size
      ? await prisma.user.findMany({
        where: { tenantId: imp.tenantId, email: { in: [...emails] } },
        select: { id: true, email: true },
      })
      : [];
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    // An asset key may be a reference or a name; both are matched so a register
    // written by a person still links up.
    const assets = assetKeys.size
      ? await prisma.asset.findMany({
        where: { tenantId: imp.tenantId },
        select: { id: true, ref: true, name: true, auditableEntityId: true },
      })
      : [];
    const assetByKey = new Map<string, typeof assets[number]>();
    for (const a of assets) {
      assetByKey.set(a.ref.toLowerCase(), a);
      assetByKey.set(a.name.toLowerCase().trim(), a);
    }

    const created: { ref: string; title: string; score: number }[] = [];
    const unresolvedOwners: string[] = [];
    const unmatchedAssets: string[] = [];
    let assetLinks = 0;

    await prisma.$transaction(async (tx) => {
      let count = await tx.risk.count({ where: { tenantId: imp.tenantId } });

      for (const c of imp.candidates) {
        const p = c.payload ? JSON.parse(c.payload) as RiskRow : null;
        if (!p || !p.title) continue;

        const { l, i, score } = scoreOf(p.likelihood, p.impact);
        count += 1;
        const ref = 'RSK-' + String(count).padStart(3, '0');

        const ownerId = (p.ownerEmail && userByEmail.get(p.ownerEmail.toLowerCase())) || req.user!.id;
        if (p.ownerEmail && !userByEmail.has(p.ownerEmail.toLowerCase())) {
          unresolvedOwners.push(p.ownerEmail);
        }

        const risk = await tx.risk.create({
          data: {
            tenantId: imp.tenantId, ref,
            title: p.title, description: p.description,
            category: p.category, direction: p.direction,
            ownerId, treatmentType: p.treatmentType,
            identifiedVia: p.identifiedVia,
            identifiedSource: p.identifiedSource,
            inherentLikelihood: l, inherentImpact: i, inherentScore: score,
            // No control is linked yet, so residual opens equal to inherent.
            // Linking controls afterwards recomputes it from their verified
            // effectiveness — the file cannot assert a residual.
            residualLikelihood: l, residualImpact: i, residualScore: score,
            reviewCadenceMonths: p.reviewCadenceMonths,
            nextReviewDate: nextReviewFrom(p.reviewCadenceMonths),
          },
        });
        await tx.riskScoreSnapshot.create({
          data: {
            tenantId: imp.tenantId, riskId: risk.id, score,
            inherentScore: score, residualScore: score, reason: 'Created',
          },
        });

        if (p.assetKey) {
          const asset = assetByKey.get(p.assetKey.toLowerCase().trim());
          if (asset) {
            await tx.assetRiskLink.create({ data: { assetId: asset.id, riskId: risk.id } });
            assetLinks++;
            // Inherit the asset's place in the audit universe, so an engagement
            // covering that area sees this risk without anyone re-linking it.
            if (asset.auditableEntityId) {
              await tx.riskEntityLink.create({
                data: { riskId: risk.id, auditableEntityId: asset.auditableEntityId },
              });
            }
          } else {
            unmatchedAssets.push(p.assetKey);
          }
        }

        created.push({ ref, title: p.title, score });
      }

      await tx.frameworkImport.update({
        where: { id },
        data: { status: 'Committed', committedCount: created.length },
      });
      await writeAudit(tx, {
        tenantId: imp.tenantId, actorId: req.user!.id, action: 'RISK_IMPORT_COMMITTED',
        subjectType: SUBJ_IMPORT, subjectId: id,
        payload: {
          fileName: imp.fileName,
          committed: created.length,
          refs: created.map((c) => c.ref),
          assetLinks,
          unresolvedOwners: [...new Set(unresolvedOwners)],
          unmatchedAssets: [...new Set(unmatchedAssets)],
        },
      });
    });

    const notes: string[] = [];
    if (assetLinks > 0) {
      notes.push(assetLinks + ' risk(s) were linked to an asset, so their impact traces back to something valued.');
    }
    if (unresolvedOwners.length) {
      notes.push(
        new Set(unresolvedOwners).size + ' owner email(s) did not match a user in this entity — '
        + 'those risks are owned by you until reassigned: '
        + [...new Set(unresolvedOwners)].slice(0, 5).join(', ') + '.',
      );
    }
    if (unmatchedAssets.length) {
      notes.push(
        new Set(unmatchedAssets).size + ' asset reference(s) matched nothing in the register: '
        + [...new Set(unmatchedAssets)].slice(0, 5).join(', ')
        + '. Import the assets first if you want the link.',
      );
    }

    res.json({
      status: 'success',
      message: created.length + ' risk(s) added to the register.' + (notes.length ? ' ' + notes.join(' ') : ''),
      committed: created.length,
      created: created.slice(0, 50),
      assetLinks,
      notes,
    });
  } catch (error: any) {
    console.error('[Risk Import Commit Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to commit the import' });
  }
};

export const discardRiskImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: 'Risk' },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }
    if (imp.status === 'Committed') {
      res.status(409).json({
        status: 'error',
        message: 'This import has already been committed. The risks it created are part of the register; close them individually if they were wrong.',
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.frameworkImport.update({ where: { id }, data: { status: 'Discarded' } });
      await writeAudit(tx, {
        tenantId: imp.tenantId, actorId: req.user!.id, action: 'RISK_IMPORT_DISCARDED',
        subjectType: SUBJ_IMPORT, subjectId: id,
        payload: { fileName: imp.fileName, extracted: imp.extractedCount },
      });
    });

    res.json({ status: 'success', message: imp.fileName + ' discarded. Nothing was written to the register.' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to discard the import' });
  }
};
