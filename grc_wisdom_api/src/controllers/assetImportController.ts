import { Response } from 'express';
import ExcelJS from 'exceljs';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import {
  extractAssetsFromSpreadsheet, TEMPLATE_COLUMNS, AssetRow,
} from '../services/assetImportExtractor';
import { computeCriticality, nextAssetReview } from '../services/assetRiskScoring';

const SUBJ_IMPORT = 'AssetImport';

/**
 * Bulk asset import, staged.
 *
 * Extraction produces *candidates*, never assets. An asset's criticality
 * becomes the impact of every risk raised against it, so a mis-read CIA rating
 * does not stay a spreadsheet problem — it propagates into the register and out
 * into a board pack. A reviewer sees what the parser understood, fixes what it
 * got wrong, and only then commits.
 */

// ─── Template ──────────────────────────────────────────────────────────────

/**
 * A filled-in template beats documentation nobody reads. Row 1 is the headers
 * the parser recognises, row 2 is a worked example, and a second sheet explains
 * each column.
 */
export const downloadTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GRC Wisdom';
    const sheet = wb.addWorksheet('Assets');

    sheet.addRow(TEMPLATE_COLUMNS.map((c) => c.header));
    sheet.addRow(TEMPLATE_COLUMNS.map((c) => c.example));

    const head = sheet.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F7A5A' } };
    head.height = 20;
    TEMPLATE_COLUMNS.forEach((c, i) => {
      sheet.getColumn(i + 1).width = Math.max(16, Math.min(30, c.header.length + 8));
    });
    sheet.getRow(2).font = { italic: true, color: { argb: 'FF7C8A85' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const guide = wb.addWorksheet('How to fill this in');
    guide.columns = [
      { header: 'Column', key: 'c', width: 24 },
      { header: 'Required', key: 'r', width: 11 },
      { header: 'What to put in it', key: 'h', width: 84 },
    ];
    guide.getRow(1).font = { bold: true };
    TEMPLATE_COLUMNS.forEach((c) => {
      guide.addRow({ c: c.header, r: c.required ? 'Yes' : 'Optional', h: c.help });
    });
    guide.addRow({});
    guide.addRow({
      c: 'Criticality',
      r: 'Derived',
      h: 'Not a column. Criticality is max(Confidentiality, Integrity, Availability), computed on import and never read from the file.',
    });
    guide.addRow({
      c: 'Extra columns',
      r: '—',
      h: 'Anything the importer does not recognise is listed back to you and ignored. Nothing is silently dropped.',
    });
    guide.getColumn('h').alignment = { wrapText: true, vertical: 'top' };

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Asset_import_template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('[Asset Template Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the template' });
  }
};

// ─── Upload and extract ────────────────────────────────────────────────────

export const uploadAssetImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
        message: 'Asset inventories are imported from a spreadsheet — xlsx or csv. A PDF has no columns to map.',
      });
      return;
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    if (buffer.length === 0) {
      res.status(400).json({ status: 'error', message: 'The uploaded file is empty' });
      return;
    }

    const extraction = await extractAssetsFromSpreadsheet(buffer, type as 'xlsx' | 'csv');
    const tenantId = req.user!.tenantId;

    const record = await prisma.$transaction(async (tx) => {
      const imp = await tx.frameworkImport.create({
        data: {
          tenantId, kind: 'Asset',
          fileName: String(fileName),
          fileUrl: `local://asset-import/${Date.now()}-${fileName}`,
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
            // The staging row keeps a human-readable summary in the shared
            // columns and the full parsed record in the payload.
            ref: c.row.name.slice(0, 120) || `(row ${c.rowNumber})`,
            title: `${c.row.type} · ${c.row.ownership} · criticality ${c.row.criticality}`,
            body: c.notes.length ? c.notes.join('; ') : null,
            extra: c.row.vendorName,
            payload: JSON.stringify(c.row),
            confidence: c.confidence,
            issue: c.issue,
            status: c.issue ? 'Pending' : 'Pending',
          },
        });
      }
      await writeAudit(tx, {
        tenantId, actorId: req.user!.id, action: 'ASSET_IMPORT_UPLOADED',
        subjectType: SUBJ_IMPORT, subjectId: imp.id,
        payload: {
          fileName, fileType: type,
          extracted: extraction.candidates.length,
          blocked: extraction.candidates.filter((c) => c.issue).length,
          columnsUsed: extraction.columnsUsed,
        },
      });
      return imp;
    });

    const blocked = extraction.candidates.filter((c) => c.issue).length;
    res.status(201).json({
      status: 'success',
      message: extraction.candidates.length === 0
        ? 'Nothing could be read from that file. See the warnings below.'
        : `${extraction.candidates.length} row(s) read${blocked ? `, ${blocked} needing correction` : ''}. Nothing has entered the register yet — review, then commit.`,
      import: record,
      headerRow: extraction.headerRow,
      columnsUsed: extraction.columnsUsed,
      unmappedColumns: extraction.unmappedColumns,
      warnings: extraction.warnings,
    });
  } catch (error: any) {
    console.error('[Asset Import Upload Error]:', error);
    res.status(500).json({
      status: 'error',
      message: 'Could not read that file. If it opens in Excel, try saving it as .xlsx or .csv and uploading again.',
    });
  }
};

// ─── Review ────────────────────────────────────────────────────────────────

export const listAssetImports = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imports = await prisma.frameworkImport.findMany({
      where: { tenantId: { in: scope.tenantIds }, kind: 'Asset' },
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

export const getAssetImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: 'Asset' },
      include: {
        uploadedBy: { select: { id: true, name: true, email: true } },
        candidates: { orderBy: { rowNumber: 'asc' } },
      },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }

    // Review starts where the parser is least sure, not at row one.
    const order: Record<string, number> = { Low: 0, Medium: 1, High: 2 };
    const candidates = [...imp.candidates]
      .map((c) => ({ ...c, parsed: c.payload ? JSON.parse(c.payload) as AssetRow : null }))
      .sort((a, b) => {
        if (!!a.issue !== !!b.issue) return a.issue ? -1 : 1;
        const d = (order[a.confidence] ?? 3) - (order[b.confidence] ?? 3);
        return d !== 0 ? d : a.rowNumber - b.rowNumber;
      });

    res.json({
      status: 'success',
      import: { ...imp, candidates: undefined },
      candidates,
      totals: {
        total: candidates.length,
        blocked: candidates.filter((c) => c.issue).length,
        accepted: candidates.filter((c) => c.status === 'Accepted').length,
        rejected: candidates.filter((c) => c.status === 'Rejected').length,
        pending: candidates.filter((c) => c.status === 'Pending').length,
        high: candidates.filter((c) => c.confidence === 'High').length,
        needsLook: candidates.filter((c) => c.confidence !== 'High').length,
      },
    });
  } catch (error: any) {
    console.error('[Asset Import Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the import' });
  }
};

/** Accept, reject, or correct a single row before commit. */
export const reviewAssetCandidate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const candidateId = req.params.candidateId as string;
    const { status, corrections } = req.body || {};
    if (status && !['Accepted', 'Rejected', 'Pending'].includes(status)) {
      res.status(400).json({ status: 'error', message: 'status must be Accepted, Rejected or Pending' });
      return;
    }

    const scope = await resolveTenantScope(req.user!.tenantId);
    const cand = await prisma.importCandidate.findFirst({
      where: { id: candidateId, import: { tenantId: { in: scope.tenantIds }, kind: 'Asset' } },
      include: { import: { select: { id: true, tenantId: true, status: true } } },
    });
    if (!cand) { res.status(404).json({ status: 'error', message: 'Row not found' }); return; }
    if (cand.import.status !== 'Extracted') {
      res.status(409).json({ status: 'error', message: `This import is ${cand.import.status} and can no longer be edited.` });
      return;
    }

    const data: any = {};
    let parsed = cand.payload ? JSON.parse(cand.payload) as AssetRow : null;

    if (corrections && parsed) {
      // Only the fields a reviewer can sensibly fix; criticality is re-derived
      // rather than accepted, so a correction cannot smuggle in a chosen tier.
      for (const k of ['name', 'type', 'ownership', 'classification', 'description',
        'location', 'vendorName', 'contractRef', 'ownerEmail', 'custodianEmail'] as const) {
        if (corrections[k] !== undefined) (parsed as any)[k] = corrections[k] || null;
      }
      for (const k of ['confidentiality', 'integrity', 'availability'] as const) {
        if (corrections[k] !== undefined) {
          const n = Number(corrections[k]);
          if (!Number.isInteger(n) || n < 1 || n > 5) {
            res.status(400).json({ status: 'error', message: `${k} must be a whole number from 1 to 5` });
            return;
          }
          parsed[k] = n;
        }
      }
      if (corrections.replacementValue !== undefined) {
        const v = Number(corrections.replacementValue);
        parsed.replacementValue = Number.isFinite(v) && v > 0 ? v : null;
      }

      const derived = computeCriticality(parsed);
      parsed.criticality = derived.criticality;
      parsed.criticalityTier = derived.criticalityTier;

      // Re-run the blocking checks against the corrected row.
      let issue: string | null = null;
      if (!parsed.name) issue = 'No asset name.';
      else if ((parsed.ownership === 'ThirdParty' || parsed.ownership === 'Shared') && !parsed.vendorName) {
        issue = 'Held by a third party but no supplier named.';
      }
      data.issue = issue;
      data.payload = JSON.stringify(parsed);
      data.ref = parsed.name.slice(0, 120);
      data.title = `${parsed.type} · ${parsed.ownership} · criticality ${parsed.criticality}`;
      data.extra = parsed.vendorName;
      data.confidence = issue ? 'Low' : 'High';
    }

    if (status) {
      if (status === 'Accepted' && (data.issue ?? cand.issue)) {
        res.status(409).json({
          status: 'error',
          code: 'ROW_BLOCKED',
          message: `This row cannot be accepted as it stands: ${data.issue ?? cand.issue}`,
        });
        return;
      }
      data.status = status;
    }

    const updated = await prisma.importCandidate.update({ where: { id: candidateId }, data });
    res.json({
      status: 'success',
      message: corrections ? 'Row corrected.' : `Row ${status?.toLowerCase()}.`,
      candidate: { ...updated, parsed },
    });
  } catch (error: any) {
    console.error('[Asset Candidate Review Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update the row' });
  }
};

/** Accept every row the parser is confident about and that carries no issue. */
export const acceptCleanRows = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: 'Asset' },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }

    const result = await prisma.importCandidate.updateMany({
      where: { importId: id, status: 'Pending', issue: null, confidence: 'High' },
      data: { status: 'Accepted' },
    });

    res.json({
      status: 'success',
      message: `${result.count} row(s) the parser read cleanly are accepted. Anything defaulted or flagged still needs your eye.`,
      accepted: result.count,
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to accept rows' });
  }
};

// ─── Commit ────────────────────────────────────────────────────────────────

/**
 * Writes the accepted rows into the register. Everything derived is derived
 * here — criticality from the CIA triad, the reference from the tenant's
 * running count — so a spreadsheet cannot assert a criticality nobody chose.
 */
export const commitAssetImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: 'Asset' },
      include: { candidates: { where: { status: 'Accepted' } } },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }
    if (imp.status !== 'Extracted') {
      res.status(409).json({ status: 'error', message: `This import is already ${imp.status}.` });
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

    // Resolve owner and custodian emails once for the whole batch.
    const emails = new Set<string>();
    for (const c of imp.candidates) {
      const p = c.payload ? JSON.parse(c.payload) as AssetRow : null;
      if (p?.ownerEmail) emails.add(p.ownerEmail.toLowerCase());
      if (p?.custodianEmail) emails.add(p.custodianEmail.toLowerCase());
    }
    const users = emails.size
      ? await prisma.user.findMany({
        where: { tenantId: imp.tenantId, email: { in: [...emails] } },
        select: { id: true, email: true },
      })
      : [];
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    // Existing suppliers, so an imported vendor name links to the real record.
    const vendors = await prisma.vendor.findMany({
      where: { tenantId: imp.tenantId },
      select: { id: true, name: true },
    });
    const vendorByName = new Map(vendors.map((v) => [v.name.toLowerCase().trim(), v.id]));

    const created: { ref: string; name: string; tier: string }[] = [];
    const unresolvedOwners: string[] = [];
    const unmatchedVendors: string[] = [];

    await prisma.$transaction(async (tx) => {
      let count = await tx.asset.count({ where: { tenantId: imp.tenantId } });

      for (const c of imp.candidates) {
        const p = c.payload ? JSON.parse(c.payload) as AssetRow : null;
        if (!p || !p.name) continue;

        const derived = computeCriticality(p);
        count += 1;
        const ref = `AST-${String(count).padStart(4, '0')}`;

        const ownerId = (p.ownerEmail && userByEmail.get(p.ownerEmail.toLowerCase())) || req.user!.id;
        if (p.ownerEmail && !userByEmail.has(p.ownerEmail.toLowerCase())) {
          unresolvedOwners.push(p.ownerEmail);
        }
        const custodianId = p.custodianEmail
          ? userByEmail.get(p.custodianEmail.toLowerCase()) ?? null
          : null;

        const vendorId = p.vendorName
          ? vendorByName.get(p.vendorName.toLowerCase().trim()) ?? null
          : null;
        if (p.vendorName && !vendorId) unmatchedVendors.push(p.vendorName);

        await tx.asset.create({
          data: {
            tenantId: imp.tenantId, ref,
            name: p.name,
            description: p.description,
            type: p.type, ownership: p.ownership, classification: p.classification,
            confidentiality: p.confidentiality, integrity: p.integrity, availability: p.availability,
            criticality: derived.criticality, criticalityTier: derived.criticalityTier,
            ownerId, custodianId,
            location: p.location,
            vendorName: p.vendorName, vendorId,
            contractRef: p.contractRef,
            replacementValue: p.replacementValue,
            currency: 'SAR',
            status: 'Active',
            reviewCadenceMonths: 12,
            nextReviewDate: nextAssetReview(12),
          },
        });
        created.push({ ref, name: p.name, tier: derived.criticalityTier });
      }

      await tx.frameworkImport.update({
        where: { id },
        data: { status: 'Committed', committedCount: created.length },
      });
      await writeAudit(tx, {
        tenantId: imp.tenantId, actorId: req.user!.id, action: 'ASSET_IMPORT_COMMITTED',
        subjectType: SUBJ_IMPORT, subjectId: id,
        payload: {
          fileName: imp.fileName,
          committed: created.length,
          refs: created.map((c) => c.ref),
          unresolvedOwners: [...new Set(unresolvedOwners)],
          unmatchedVendors: [...new Set(unmatchedVendors)],
        },
      });
    });

    const notes: string[] = [];
    if (unresolvedOwners.length) {
      notes.push(
        `${new Set(unresolvedOwners).size} owner email(s) did not match a user in this entity — those assets are owned by you until reassigned: ${[...new Set(unresolvedOwners)].slice(0, 5).join(', ')}.`,
      );
    }
    if (unmatchedVendors.length) {
      notes.push(
        `${new Set(unmatchedVendors).size} supplier name(s) have no vendor record yet, so they are held as text: ${[...new Set(unmatchedVendors)].slice(0, 5).join(', ')}. Onboard them in Third-party risk to link them properly.`,
      );
    }

    res.json({
      status: 'success',
      message: `${created.length} asset(s) added to the register.`
        + (notes.length ? ` ${notes.join(' ')}` : ''),
      committed: created.length,
      created: created.slice(0, 50),
      notes,
    });
  } catch (error: any) {
    console.error('[Asset Import Commit Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to commit the import' });
  }
};

export const discardAssetImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!.tenantId);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: 'Asset' },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }
    if (imp.status === 'Committed') {
      res.status(409).json({
        status: 'error',
        message: 'This import has already been committed. The assets it created are part of the register; retire them individually if they were wrong.',
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.frameworkImport.update({ where: { id }, data: { status: 'Discarded' } });
      await writeAudit(tx, {
        tenantId: imp.tenantId, actorId: req.user!.id, action: 'ASSET_IMPORT_DISCARDED',
        subjectType: SUBJ_IMPORT, subjectId: id,
        payload: { fileName: imp.fileName, extracted: imp.extractedCount },
      });
    });

    res.json({ status: 'success', message: `${imp.fileName} discarded. Nothing was written to the register.` });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: 'Failed to discard the import' });
  }
};
