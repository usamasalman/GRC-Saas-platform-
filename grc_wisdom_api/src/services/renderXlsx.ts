import ExcelJS from 'exceljs';
import {
  ReportDocument, draftNotice, provenanceRows, cellText, defaultChrome,
} from './reportDocument';
import { argbHex, inkOn, bareHex } from './tenantBranding';

/**
 * Renders a report as a workbook — the working format, because auditors live
 * in spreadsheets and an exported matrix is immediately useful there.
 *
 * Each section becomes its own sheet, so filters and sorting apply to one kind
 * of thing at a time.
 */

const INK = 'FF0B1524';
const FAINT = 'FF646F85';
const RULE = 'FFE1E7EF';
const SUNK = 'FFF5F7FA';
const WARN = 'FF9A6510';
const WARN_BG = 'FFFDF3E2';

/** Excel rejects these in a tab name and truncates past 31 characters. */
const safeSheetName = (name: string, taken: Set<string>): string => {
  let base = name.replace(/[*?:\\/\[\]]/g, ' ').slice(0, 31).trim() || 'Sheet';
  let out = base;
  let n = 2;
  while (taken.has(out)) {
    const suffix = ` ${n++}`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(out);
  return out;
};

export async function renderXlsx(report: ReportDocument): Promise<Buffer> {
  const p = report.provenance;
  // A spreadsheet has no pages, so most of the chrome vocabulary does not apply
  // here: no cover page, no footer, no page numbering. What DOES carry over is
  // the organisation's name, the marking and the document reference — all of
  // which belong on the provenance sheet, where a reader looking for "which
  // copy is this" will look.
  const chrome = report.chrome || defaultChrome(p);
  const headerFill = argbHex(chrome.brandColour);
  const wb = new ExcelJS.Workbook();
  wb.creator = p.generatedBy;
  wb.created = chrome.generatedAt;
  wb.title = p.reportName;

  const taken = new Set<string>();

  // Provenance leads, on its own sheet, so every other sheet is pure data
  // that filters and pivots cleanly.
  const cover = wb.addWorksheet(safeSheetName('Report', taken));
  cover.getColumn(1).width = 32;
  cover.getColumn(2).width = 96;

  const title = cover.addRow([p.reportName]);
  title.font = { bold: true, size: 14, color: { argb: INK } };
  const org = cover.addRow([chrome.displayName]);
  org.font = { bold: true, size: 11, color: { argb: `FF${chrome.textColour.replace('#', '')}` } };
  const mark = cover.addRow([chrome.marking.toUpperCase()]);
  mark.font = { bold: true, size: 9, color: { argb: FAINT } };
  if (p.subjectRef) {
    const sub = cover.addRow([p.subjectRef]);
    sub.font = { size: 11, color: { argb: FAINT } };
  }
  cover.addRow([]);

  for (const { label, value } of provenanceRows(p, chrome.generatedAt, chrome.documentRef)) {
    const r = cover.addRow([label, value]);
    r.getCell(1).font = { size: 9, color: { argb: FAINT } };
    r.getCell(2).font = { size: 9, bold: true, color: { argb: INK } };
  }

  const notice = draftNotice(p);
  if (notice) {
    cover.addRow([]);
    const w = cover.addRow([notice]);
    w.font = { bold: true, size: 10, color: { argb: WARN } };
    w.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARN_BG } };
    cover.mergeCells(w.number, 1, w.number, 2);
  }

  for (const section of report.sections) {
    const sheet = wb.addWorksheet(safeSheetName(section.title, taken));

    if (section.kind === 'fields') {
      sheet.getColumn(1).width = 32;
      sheet.getColumn(2).width = 96;
      for (const f of section.fields) {
        const r = sheet.addRow([f.label, cellText(f.value)]);
        r.getCell(1).font = { size: 9, color: { argb: FAINT } };
        r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      }
      continue;
    }

    const header = sheet.addRow(section.columns.map((c) => c.header));
    header.font = { bold: true, size: 10, color: { argb: `FF${bareHex(inkOn(chrome.brandColour))}` } };
    header.height = 22;
    header.alignment = { vertical: 'middle' };
    header.eachCell((c) => {
      // Branded to match the cover. inkOn picks white or ink for the text,
      // whichever reads on the tenant's own colour — a dark navy and a pale
      // gold both need a header that can be read.
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerFill } };
      c.border = { bottom: { style: 'thin', color: { argb: RULE } } };
    });

    section.columns.forEach((c, i) => { sheet.getColumn(i + 1).width = c.width ?? 20; });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of section.rows) {
      const r = sheet.addRow(section.columns.map((c) => cellText(row[c.key])));
      r.alignment = { vertical: 'top', wrapText: true };
      r.eachCell((c) => { c.border = { bottom: { style: 'hair', color: { argb: RULE } } }; });
    }

    if (section.rows.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: section.columns.length },
      };
    } else {
      const empty = sheet.addRow(['Nothing to report for this selection.']);
      empty.font = { italic: true, color: { argb: FAINT } };
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
