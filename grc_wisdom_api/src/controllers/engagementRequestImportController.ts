import { Response } from 'express';
import ExcelJS from 'exceljs';
import { prisma } from '../db';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { bindingScope } from '../services/engagementScope';
import { decodeUpload } from '../services/evidenceStore';
import { readSheetRows, normaliseHeader } from '../services/spreadsheetExtractor';
import { cellText, neutralise, MAX_IMPORT_ROWS, REQUEST_KINDS, TARGET_TYPES, overdueDays } from '../services/engagementRequests';
import { createRequests, NewRequest } from '../services/engagementRequestStore';
import { requestAccess, firmMay, checkNewRequest } from './engagementRequestController';
import { str, send } from './engagementController';

/**
 * Requests in bulk (consulting engagement, sprint 8), the way the risk and
 * vendor imports work: a template to download, a preview that checks every
 * row, then the import. Unlike those, a file of requests goes in whole or not
 * at all: one row that fails stops the file, and the preview says which and
 * why. Every cell is read as text; a formula is refused rather than run.
 */

const COLUMNS = [
  { header: 'Kind', required: true, example: 'Evidence', help: `One of ${REQUEST_KINDS.join(', ')}.` },
  { header: 'Title', required: true, example: 'Quarterly access recertification, Q3', help: 'What you are asking for, in a line.' },
  { header: 'What would satisfy it', required: false, example: 'Signed recertification records for every in-scope system', help: 'The criteria the answer will be reviewed against.' },
  { header: 'About', required: true, example: 'Control', help: `One of ${TARGET_TYPES.join(', ')}.` },
  { header: 'Reference', required: false, example: 'AC-04', help: 'Engagement: leave empty. Task: its reference (TSK-0001). Clause: the framework code and the clause (ISO27001 A.5.15). Control: its code (AC-04). Register: Documents, Controls, Risks, Assets or Vendors.' },
  { header: 'Period from', required: false, example: '2026-07-01', help: 'The period the evidence should cover, if it has one.' },
  { header: 'Period to', required: false, example: '2026-09-30', help: 'The end of that period.' },
  { header: 'Due date', required: true, example: '2026-10-20', help: 'Inside your own access dates on this engagement, and not already past.' },
  { header: 'Assignee email', required: false, example: '', help: 'Someone the organisation has put on this engagement. Empty: the project manager.' },
] as const;

const KEYS = ['kind', 'title', 'criteria', 'targetType', 'reference', 'periodFrom', 'periodTo', 'dueDate', 'assignee'] as const;

/** GET /api/engagements/:projectId/requests/import/template — the file to fill in, with its instructions. */
export const requestTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await requestAccess(req);
    if (!a.ok) { send(res, a); return; }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GRC Wisdom';
    const sheet = wb.addWorksheet('Requests');
    sheet.addRow(COLUMNS.map((c) => c.header));
    sheet.addRow(COLUMNS.map((c) => c.example));
    const head = sheet.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F7A5A' } };
    sheet.getRow(2).font = { italic: true, color: { argb: 'FF7C8A85' } };
    COLUMNS.forEach((c, i) => { sheet.getColumn(i + 1).width = Math.max(16, Math.min(40, c.header.length + 10)); });
    // Text columns, so a value is kept as typed rather than turned into a date or a formula.
    COLUMNS.forEach((_, i) => { sheet.getColumn(i + 1).numFmt = '@'; });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const guide = wb.addWorksheet('How to fill this in');
    guide.columns = [{ header: 'Column', key: 'c', width: 24 }, { header: 'Required', key: 'r', width: 11 }, { header: 'What to put in it', key: 'h', width: 96 }];
    guide.getRow(1).font = { bold: true };
    COLUMNS.forEach((c) => guide.addRow({ c: c.header, r: c.required ? 'Yes' : 'Optional', h: c.help }));
    guide.addRow({});
    guide.addRow({ c: 'The example row', r: '', h: 'Row 2 is an example. Replace it or delete it; it is imported like any other row.' });
    guide.addRow({ c: 'All or nothing', r: '', h: `Every row is checked before anything is created. If one row has a problem, nothing is imported and the preview says what to fix. At most ${MAX_IMPORT_ROWS} rows.` });
    guide.addRow({ c: 'Formulas', r: '', h: 'Type values, not formulas. A cell holding a formula is refused.' });
    guide.addRow({ c: 'Outside the scope', r: '', h: 'A request can only ask for what the engagement\'s scope shares. For anything wider, ask for a scope change on the Requests tab.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="information-requests-template.xlsx"');
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (error: any) {
    console.error('[Request Template Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to build the template' });
  }
};

interface PreviewRow { line: number; values: Record<string, string>; problems: string[]; ref?: string }

/** Reads and checks every row of an uploaded file. Nothing is written. */
async function checkFile(req: AuthenticatedRequest, a: Extract<Awaited<ReturnType<typeof requestAccess>>, { ok: true }>): Promise<
  { ok: false; status: number; code: string; message: string } | { ok: true; rows: PreviewRow[]; good: NewRequest[]; fileName: string }
> {
  const fileName = str(req.body?.fileName).trim();
  const ext = fileName.toLowerCase().endsWith('.csv') ? 'csv' : fileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : null;
  if (!ext || !req.body?.fileData) return { ok: false, status: 400, code: 'BAD_FILE', message: 'Upload the template as .xlsx or .csv.' };
  let buffer: Buffer;
  try { buffer = decodeUpload(str(req.body.fileData)); } catch { return { ok: false, status: 400, code: 'BAD_FILE', message: 'The file could not be read.' }; }
  let sheet: Awaited<ReturnType<typeof readSheetRows>>;
  try { sheet = await readSheetRows(buffer, ext); } catch { return { ok: false, status: 400, code: 'BAD_FILE', message: 'The file could not be read as a spreadsheet.' }; }
  if (!sheet || sheet.cells.length === 0) return { ok: false, status: 400, code: 'EMPTY_FILE', message: 'The file has no rows.' };
  const asText = (v: unknown) => { const t = cellText(v); return 'text' in t ? t.text : ''; };
  const header = sheet.cells[0].map((v) => normaliseHeader(asText(v)));
  const expected = COLUMNS.map((c) => normaliseHeader(c.header));
  if (expected.some((h, i) => header[i] !== h)) {
    return { ok: false, status: 400, code: 'BAD_TEMPLATE', message: `Use the template's columns, in order: ${COLUMNS.map((c) => c.header).join(', ')}.` };
  }
  const body = sheet.cells.slice(1);
  if (body.length === 0) return { ok: false, status: 400, code: 'EMPTY_FILE', message: 'The file has no requests under the header.' };
  if (body.length > MAX_IMPORT_ROWS) return { ok: false, status: 400, code: 'TOO_MANY_ROWS', message: `At most ${MAX_IMPORT_ROWS} requests in one file.` };

  const scope = await bindingScope(a.e.id);
  const now = new Date();
  const rows: PreviewRow[] = [];
  const good: NewRequest[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < body.length; i++) {
    const line = sheet.lineNumbers[i + 1];
    const values: Record<string, string> = {};
    const problems: string[] = [];
    KEYS.forEach((k, c) => {
      const t = cellText(body[i][c]);
      if ('formula' in t) { problems.push(`${COLUMNS[c].header} holds a formula; type the value instead.`); values[k] = ''; }
      else values[k] = t.text;
    });
    let assigneeId: string | undefined;
    if (values.assignee) {
      const person = await prisma.user.findFirst({ where: { email: { equals: values.assignee, mode: 'insensitive' } }, select: { id: true } });
      const onTeam = person && await prisma.projectMember.findFirst({
        where: { projectId: a.e.id, userId: person.id, side: 'Client', active: true, user: { status: 'Active' } }, select: { id: true },
      });
      if (!onTeam) problems.push(`${values.assignee} is not on this engagement's team.`);
      else assigneeId = person!.id;
    }
    if (problems.length === 0) {
      const checked = await checkNewRequest({
        e: a.e, raiserId: a.userId, scope, byRef: true, now,
        body: {
          kind: values.kind, title: values.title, criteria: values.criteria || undefined,
          targetType: values.targetType || 'Engagement', targetId: values.reference,
          periodFrom: values.periodFrom, periodTo: values.periodTo, dueDate: values.dueDate, assigneeId,
        },
      });
      if (!checked.ok) problems.push(checked.message);
      else {
        const key = [checked.value.kind, checked.value.targetType, checked.value.targetId ?? '', checked.value.title.toLowerCase()].join('|');
        if (seen.has(key)) problems.push('The same request appears earlier in this file.');
        else { seen.add(key); good.push({ ...checked.value, importedFrom: fileName.slice(0, 200) }); }
      }
    }
    rows.push({ line, values, problems });
  }
  return { ok: true, rows, good, fileName };
}

/** POST /api/engagements/:projectId/requests/import/preview — every row checked, nothing created. */
export const previewRequestImport = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await requestAccess(req);
    if (!a.ok) { send(res, a); return; }
    const refusal = firmMay(a, 'request');
    if (refusal) { send(res, refusal); return; }
    const checked = await checkFile(req, a);
    if (!checked.ok) { send(res, checked); return; }
    const problems = checked.rows.filter((r) => r.problems.length > 0).length;
    res.json({ status: 'success', ok: problems === 0, count: checked.rows.length, problems, rows: checked.rows });
  } catch (error: any) {
    console.error('[Request Import Preview Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to read the file' });
  }
};

/**
 * POST /api/engagements/:projectId/requests/import — the same checks again,
 * then every request in one transaction and one trail entry naming them all;
 * or nothing, with the rows to fix.
 */
export const importRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await requestAccess(req);
    if (!a.ok) { send(res, a); return; }
    const refusal = firmMay(a, 'request');
    if (refusal) { send(res, refusal); return; }
    const checked = await checkFile(req, a);
    if (!checked.ok) { send(res, checked); return; }
    const bad = checked.rows.filter((r) => r.problems.length > 0);
    if (bad.length > 0) {
      res.status(400).json({
        status: 'error', code: 'IMPORT_HAS_PROBLEMS',
        message: `${bad.length} row(s) need fixing; nothing was imported.`, rows: checked.rows,
      });
      return;
    }
    const made = await prisma.$transaction((tx) => createRequests(tx, {
      e: a.e, raisedById: a.userId, requests: checked.good, action: 'ENGAGEMENT_REQUESTS_IMPORTED',
      source: { fileName: checked.fileName, count: checked.good.length },
    }), { timeout: 60_000 });
    res.status(201).json({ status: 'success', count: made.length, refs: made.map((m) => m.ref) });
  } catch (error: any) {
    console.error('[Request Import Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to import the requests' });
  }
};

/**
 * GET /api/engagements/:projectId/requests/export — the requests as a
 * spreadsheet. Every text is written inert: a title starting with = or @
 * stays text when the file is opened.
 */
export const exportRequests = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const a = await requestAccess(req);
    if (!a.ok) { send(res, a); return; }
    const [rows, holds] = await Promise.all([
      prisma.informationRequest.findMany({
        where: { projectId: a.e.id }, orderBy: { ref: 'asc' },
        select: {
          ref: true, kind: true, title: true, criteria: true, targetLabel: true, periodFrom: true, periodTo: true, dueDate: true,
          status: true, raisedAt: true, raisedBy: { select: { name: true } }, assignee: { select: { name: true } },
        },
      }),
      prisma.projectHold.findMany({ where: { projectId: a.e.id }, select: { startedAt: true, endedAt: true } }),
    ]);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GRC Wisdom';
    const sheet = wb.addWorksheet('Requests');
    sheet.columns = [
      { header: 'Ref', key: 'ref', width: 11 }, { header: 'Kind', key: 'kind', width: 14 }, { header: 'Title', key: 'title', width: 44 },
      { header: 'What would satisfy it', key: 'criteria', width: 44 }, { header: 'About', key: 'target', width: 34 },
      { header: 'Period', key: 'period', width: 24 }, { header: 'Due', key: 'due', width: 12 }, { header: 'Overdue days', key: 'overdue', width: 13 },
      { header: 'Status', key: 'status', width: 12 }, { header: 'Raised by', key: 'raisedBy', width: 22 }, { header: 'Assignee', key: 'assignee', width: 22 },
    ];
    sheet.getRow(1).font = { bold: true };
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
    for (const r of rows) {
      sheet.addRow({
        ref: neutralise(r.ref), kind: neutralise(r.kind), title: neutralise(r.title), criteria: neutralise(r.criteria ?? ''),
        target: neutralise(r.targetLabel ?? ''), period: r.periodFrom || r.periodTo ? `${day(r.periodFrom)} to ${day(r.periodTo)}` : '',
        due: day(r.dueDate), overdue: ['Open', 'Returned'].includes(r.status) ? overdueDays(r.dueDate, holds) : 0,
        status: r.status, raisedBy: neutralise(r.raisedBy.name), assignee: neutralise(r.assignee.name),
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${a.e.ref}-requests.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  } catch (error: any) {
    console.error('[Request Export Error]:', error);
    res.status(500).json({ status: 'error', message: 'Failed to export the requests' });
  }
};
