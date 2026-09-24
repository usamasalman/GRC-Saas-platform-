import { Response } from 'express';
import ExcelJS from 'exceljs';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { prisma } from '../db';
import { writeAudit } from '../middlewares/auditMiddleware';
import { resolveTenantScope } from '../services/scopeResolver';
import { readPage, pageInfo } from '../utils/paging';
import {
  extractVendorsFromSpreadsheet, VENDOR_TEMPLATE_COLUMNS, VendorRow,
} from '../services/vendorImportExtractor';
import { computeTier, cadenceForTier, nextAssessmentFrom } from '../services/vendorRisk';
import { nextVendorRef } from './vendorController';

const SUBJ_IMPORT = 'VendorImport';
const KIND = 'Vendor';

/**
 * Bulk supplier import, staged.
 *
 * Every organisation that manages third-party risk already has a supplier list
 * in a spreadsheet, and until now the only way in was one form at a time.
 * Assets, risks and frameworks all had the whole pipeline already; suppliers
 * did not, which is the entire reason this packet is small.
 *
 * Extraction produces *candidates*, never vendors. A supplier's tier drives
 * the assessment cadence and the exit-planning date, so a mis-read data-access
 * level does not stay a spreadsheet problem: it makes a supplier look
 * lower-risk than they are and buys them a lighter review for a year. A
 * reviewer sees what the parser understood, fixes what it got wrong, and only
 * then commits.
 *
 * Nothing about the tier comes from the file. It is derived at commit from the
 * same computeTier the manual form uses, because a spreadsheet column saying
 * "Tier 3" is somebody's opinion and the tier is a calculation.
 */

// ─── Template ──────────────────────────────────────────────────────────────

export const downloadVendorTemplate = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GRC Wisdom';
    const sheet = wb.addWorksheet('Suppliers');

    sheet.addRow(VENDOR_TEMPLATE_COLUMNS.map((c) => c.header));
    sheet.addRow(VENDOR_TEMPLATE_COLUMNS.map((c) => c.example));

    const head = sheet.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F7A5A' } };
    head.height = 20;
    VENDOR_TEMPLATE_COLUMNS.forEach((c, i) => {
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
    VENDOR_TEMPLATE_COLUMNS.forEach((c) => {
      guide.addRow({ c: c.header, r: c.required ? 'Yes' : 'Optional', h: c.help });
    });
    guide.addRow({});
    guide.addRow({
      c: 'Tier',
      r: 'Derived',
      h: 'Not a column. The tier is computed from service criticality, substitutability, data '
        + 'access and system access, and never read from the file — a spreadsheet saying '
        + '"Tier 3" is an opinion, and the tier is what drives the assessment cadence.',
    });
    guide.addRow({
      c: 'Extra columns',
      r: '—',
      h: 'Anything the importer does not recognise is listed back to you and ignored. Nothing '
        + 'is silently dropped.',
    });
    guide.getColumn('h').alignment = { wrapText: true, vertical: 'top' };

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Supplier_import_template.xlsx"');
    res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error('[Vendor Template Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the template' });
  }
};

// ─── Upload and extract ────────────────────────────────────────────────────

export const uploadVendorImport = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
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
        message: 'Supplier lists are imported from a spreadsheet — xlsx or csv. A PDF has no columns to map.',
      });
      return;
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    if (buffer.length === 0) {
      res.status(400).json({ status: 'error', message: 'The uploaded file is empty' });
      return;
    }

    const extraction = await extractVendorsFromSpreadsheet(buffer, type as 'xlsx' | 'csv');
    const tenantId = req.user!.tenantId;

    const record = await prisma.$transaction(async (tx) => {
      const imp = await tx.frameworkImport.create({
        data: {
          tenantId,
          kind: KIND,
          fileName: String(fileName),
          fileUrl: `local://vendor-import/${Date.now()}-${fileName}`,
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
            // A human-readable summary in the shared columns, the full parsed
            // record in the payload — the same split the asset importer uses.
            ref: (c.row.name || '').slice(0, 120) || `(row ${c.rowNumber})`,
            title: `${c.row.category} · ${c.row.dataAccess}`
              + `${c.row.hasSystemAccess ? ' · system access' : ''}`,
            body: c.notes.length ? c.notes.join('; ') : null,
            extra: c.row.ownerEmail,
            payload: JSON.stringify(c.row),
            confidence: c.confidence,
            issue: c.issue,
            status: 'Pending',
          },
        });
      }
      await writeAudit(tx, {
        tenantId,
        actorId: req.user!.id,
        action: 'VENDOR_IMPORT_UPLOADED',
        subjectType: SUBJ_IMPORT,
        subjectId: imp.id,
        payload: {
          fileName: String(fileName),
          rows: extraction.candidates.length,
          blocked: extraction.candidates.filter((c) => c.issue).length,
          unmappedColumns: extraction.unmappedColumns,
        },
      });
      return imp;
    });

    res.status(201).json({
      status: 'success',
      importId: record.id,
      extracted: extraction.candidates.length,
      blocked: extraction.candidates.filter((c) => c.issue).length,
      headerRow: extraction.headerRow,
      columnsUsed: extraction.columnsUsed,
      // Listed back rather than dropped in silence: a column the importer did
      // not recognise is the usual reason a field comes through empty.
      unmappedColumns: extraction.unmappedColumns,
      warnings: extraction.warnings,
    });
  } catch (error: any) {
    console.error('[Vendor Import Upload Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to read the file' });
  }
};

// ─── Staged imports ────────────────────────────────────────────────────────

export const listVendorImports = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const scope = await resolveTenantScope(req.user!);
    const where = { tenantId: { in: scope.tenantIds }, kind: KIND };
    const page = readPage(req.query as Record<string, unknown>, 50);
    const [imports, total] = await Promise.all([
      prisma.frameworkImport.findMany({
        where,
        include: {
          uploadedBy: { select: { id: true, name: true } },
          _count: { select: { candidates: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: page.skip,
        take: page.take,
      }),
      prisma.frameworkImport.count({ where }),
    ]);

    res.json({
      status: 'success',
      count: imports.length,
      paging: pageInfo(total, page),
      imports: imports.map((i) => ({
        id: i.id,
        fileName: i.fileName,
        fileType: i.fileType,
        status: i.status,
        extractedCount: i.extractedCount,
        candidateCount: i._count.candidates,
        uploadedBy: i.uploadedBy,
        createdAt: i.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('[Vendor Imports List Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to list imports' });
  }
};

export const getVendorImport = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: KIND },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        candidates: { orderBy: { rowNumber: 'asc' } },
      },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }

    res.json({
      status: 'success',
      import: {
        id: imp.id,
        fileName: imp.fileName,
        status: imp.status,
        uploadedBy: imp.uploadedBy,
        createdAt: imp.createdAt,
      },
      summary: {
        total: imp.candidates.length,
        accepted: imp.candidates.filter((c) => c.status === 'Accepted').length,
        blocked: imp.candidates.filter((c) => c.issue).length,
        pending: imp.candidates.filter((c) => c.status === 'Pending').length,
        rejected: imp.candidates.filter((c) => c.status === 'Rejected').length,
      },
      candidates: imp.candidates.map((c) => ({
        id: c.id,
        rowNumber: c.rowNumber,
        ref: c.ref,
        title: c.title,
        notes: c.body,
        ownerEmail: c.extra,
        confidence: c.confidence,
        issue: c.issue,
        status: c.status,
        row: c.payload ? JSON.parse(c.payload) : null,
      })),
    });
  } catch (error: any) {
    console.error('[Vendor Import Get Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to load the import' });
  }
};

export const reviewVendorCandidate = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const candidateId = req.params.candidateId as string;
    const { status, row } = req.body || {};
    const scope = await resolveTenantScope(req.user!);

    const candidate = await prisma.importCandidate.findFirst({
      where: { id: candidateId, import: { tenantId: { in: scope.tenantIds }, kind: KIND } },
      include: { import: { select: { id: true, status: true, tenantId: true } } },
    });
    if (!candidate) { res.status(404).json({ status: 'error', message: 'Row not found' }); return; }
    if (candidate.import.status !== 'Extracted') {
      res.status(409).json({
        status: 'error',
        message: `This import is already ${candidate.import.status.toLowerCase()} and cannot be edited.`,
      });
      return;
    }

    const allowed = ['Pending', 'Accepted', 'Rejected'];
    const next = String(status || '').trim();
    if (next && !allowed.includes(next)) {
      res.status(400).json({ status: 'error', message: `status must be one of: ${allowed.join(', ')}` });
      return;
    }

    // A corrected row clears the blocking issue, because the issue described
    // the file rather than the record — the point of the review step is that a
    // person can fix what the parser could not read.
    const merged = row ? { ...(candidate.payload ? JSON.parse(candidate.payload) : {}), ...row } : null;
    const nameNow = merged ? String(merged.name || '').trim() : '';

    const updated = await prisma.importCandidate.update({
      where: { id: candidateId },
      data: {
        ...(merged ? { payload: JSON.stringify(merged), ref: nameNow || candidate.ref } : {}),
        ...(merged && nameNow ? { issue: null } : {}),
        ...(next ? { status: next } : {}),
      },
    });

    res.json({
      status: 'success',
      candidate: {
        id: updated.id,
        status: updated.status,
        issue: updated.issue,
        row: updated.payload ? JSON.parse(updated.payload) : null,
      },
    });
  } catch (error: any) {
    console.error('[Vendor Candidate Review Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to update the row' });
  }
};

export const acceptCleanVendorRows = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: KIND },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }
    if (imp.status !== 'Extracted') {
      res.status(409).json({ status: 'error', message: `This import is already ${imp.status}.` });
      return;
    }

    // Only rows with no issue. A blocked row stays blocked: accepting
    // everything at once is exactly the habit the staging step exists to break.
    const result = await prisma.importCandidate.updateMany({
      where: { importId: id, status: 'Pending', issue: null },
      data: { status: 'Accepted' },
    });

    res.json({ status: 'success', accepted: result.count });
  } catch (error: any) {
    console.error('[Vendor Accept Clean Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to accept rows' });
  }
};

// ─── Commit ────────────────────────────────────────────────────────────────

export const commitVendorImport = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: KIND },
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

    // Suppliers already on the register, matched on name. Importing the same
    // list twice is the normal way this gets used, and it must not double the
    // register.
    const names = imp.candidates
      .map((c) => (c.payload ? String((JSON.parse(c.payload) as VendorRow).name || '') : ''))
      .filter(Boolean);
    const existing = await prisma.vendor.findMany({
      where: { tenantId: imp.tenantId, name: { in: names } },
      select: { name: true },
    });
    const taken = new Set(existing.map((v) => v.name.toLowerCase()));

    // Vendor.relationshipOwnerId is required, so a supplier cannot exist
    // without somebody accountable for the relationship. Emails are resolved
    // once for the batch; a row naming nobody the register recognises is
    // skipped by name rather than quietly given to whoever ran the import.
    const emails = new Set<string>();
    for (const c of imp.candidates) {
      const p = c.payload ? JSON.parse(c.payload) as VendorRow : null;
      if (p?.ownerEmail) emails.add(p.ownerEmail.toLowerCase());
    }
    const owners = emails.size
      ? await prisma.user.findMany({
        where: { tenantId: imp.tenantId, email: { in: [...emails] }, status: 'Active' },
        select: { id: true, email: true },
      })
      : [];
    const ownerByEmail = new Map(owners.map((u) => [u.email.toLowerCase(), u.id]));

    const created: string[] = [];
    const skipped: { name: string; why: string }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const c of imp.candidates) {
        const row = c.payload ? JSON.parse(c.payload) as VendorRow : null;
        const name = String(row?.name || '').trim();
        if (!row || !name) {
          skipped.push({ name: c.ref, why: 'the row has no supplier name' });
          continue;
        }
        if (taken.has(name.toLowerCase())) {
          skipped.push({ name, why: 'already on the register' });
          continue;
        }
        taken.add(name.toLowerCase());

        const ownerEmail = String(row.ownerEmail || '').trim().toLowerCase();
        const ownerId = ownerEmail ? ownerByEmail.get(ownerEmail) : undefined;
        if (!ownerId) {
          skipped.push({
            name,
            why: ownerEmail
              ? `no active user with the email ${ownerEmail}`
              : 'no relationship owner email — a supplier cannot exist without somebody accountable for it',
          });
          continue;
        }

        // Derived, never taken from the file. The tier drives the assessment
        // cadence, so a column asserting one would let a spreadsheet decide
        // how often its own supplier gets reviewed.
        const tiering = computeTier({
          serviceCriticality: Number(row.serviceCriticality) || 3,
          substitutability: Number(row.substitutability) || 3,
          dataAccess: row.dataAccess || 'None',
          hasSystemAccess: !!row.hasSystemAccess,
        });
        const cadence = cadenceForTier(tiering.tier);
        const ref = await nextVendorRef(imp.tenantId);

        const vendor = await tx.vendor.create({
          data: {
            tenantId: imp.tenantId,
            ref,
            name,
            legalName: row.legalName || null,
            category: row.category || 'Other',
            description: row.description || null,
            country: row.country || null,
            dataLocation: row.dataLocation || null,
            dataAccess: row.dataAccess || 'None',
            hasSystemAccess: !!row.hasSystemAccess,
            contractRef: row.contractRef || null,
            contractEnd: row.contractEnd ? new Date(row.contractEnd) : null,
            currency: row.currency || 'SAR',
            relationshipOwnerId: ownerId,
            serviceCriticality: Math.min(5, Math.max(1, Number(row.serviceCriticality) || 3)),
            substitutability: Math.min(5, Math.max(1, Number(row.substitutability) || 3)),
            tier: tiering.tier,
            tierScore: tiering.tierScore,
            assessmentCadenceMonths: cadence,
            nextAssessmentDue: nextAssessmentFrom(cadence),
          },
        });
        created.push(vendor.ref);
      }

      await tx.frameworkImport.update({
        where: { id },
        data: { status: 'Committed', committedCount: created.length },
      });

      await writeAudit(tx, {
        tenantId: imp.tenantId,
        actorId: req.user!.id,
        action: 'VENDOR_IMPORT_COMMITTED',
        subjectType: SUBJ_IMPORT,
        subjectId: id,
        payload: {
          fileName: imp.fileName,
          created: created.length,
          refs: created,
          // Named, not counted. A row that did not become a supplier is the
          // thing somebody will come looking for.
          skipped,
        },
      });
    });

    res.json({
      status: 'success',
      created: created.length,
      refs: created,
      skipped,
      message: `${created.length} supplier${created.length === 1 ? '' : 's'} added to the register.`
        + (skipped.length ? ` ${skipped.length} row${skipped.length === 1 ? ' was' : 's were'} skipped.` : ''),
    });
  } catch (error: any) {
    console.error('[Vendor Import Commit Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to commit the import' });
  }
};

export const discardVendorImport = async (
  req: AuthenticatedRequest, res: Response,
): Promise<void> => {
  try {
    const id = req.params.id as string;
    const scope = await resolveTenantScope(req.user!);
    const imp = await prisma.frameworkImport.findFirst({
      where: { id, tenantId: { in: scope.tenantIds }, kind: KIND },
    });
    if (!imp) { res.status(404).json({ status: 'error', message: 'Import not found' }); return; }
    if (imp.status === 'Committed') {
      res.status(409).json({
        status: 'error',
        message: 'This import has been committed. The suppliers it created are on the register and are removed one at a time, with a reason.',
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.frameworkImport.update({ where: { id }, data: { status: 'Discarded' } });
      await writeAudit(tx, {
        tenantId: imp.tenantId,
        actorId: req.user!.id,
        action: 'VENDOR_IMPORT_DISCARDED',
        subjectType: SUBJ_IMPORT,
        subjectId: id,
        payload: { fileName: imp.fileName },
      });
    });

    res.json({ status: 'success', message: 'Import discarded. Nothing was added to the register.' });
  } catch (error: any) {
    console.error('[Vendor Import Discard Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to discard the import' });
  }
};
