import PDFDocument from 'pdfkit';
import {
  ReportDocument, ReportSection, Column,
  draftNotice, provenanceRows, cellText,
} from './reportDocument';

/**
 * Renders a report as PDF — the issued artefact.
 *
 * pdfkit has no table primitive, so tables are drawn by hand. The important
 * judgement here is that a wide table does not belong in a portrait grid: an
 * RCM has nineteen columns, and squeezing those onto a page produces something
 * nobody can read. Past a threshold each row is laid out as a labelled block
 * instead, which is how an audit report reads anyway.
 */

const INK = '#0B1524';
const MUTED = '#55627A';
const FAINT = '#646F85';
const RULE = '#E1E7EF';
const BRAND = '#0F7A5A';
const WARN = '#9A6510';

/** Beyond this many columns a grid stops being legible on a printed page. */
const MAX_GRID_COLUMNS = 6;

const MARGIN = 46;

function pageWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/**
 * The true left edge. `doc.x` cannot be trusted for this: pdfkit moves it to
 * whatever x a positioned `text()` call used, so reading it back after drawing
 * a two-column field row returns the *value* column, and every following
 * element marches further right until it falls off the page.
 */
function left(doc: PDFKit.PDFDocument): number {
  return doc.page.margins.left;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): boolean {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed <= bottom) return false;
  doc.addPage();
  return true;
}

function heading(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 46);
  doc.moveDown(0.7);
  doc.x = left(doc);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(text, left(doc), doc.y);
  doc.moveTo(left(doc), doc.y + 3)
    .lineTo(left(doc) + pageWidth(doc), doc.y + 3)
    .lineWidth(0.7).strokeColor(RULE).stroke();
  doc.x = left(doc);
  doc.moveDown(0.6);
}

function fieldList(doc: PDFKit.PDFDocument, fields: { label: string; value: string }[]) {
  const labelW = 150;
  const valueW = pageWidth(doc) - labelW - 10;
  for (const f of fields) {
    const value = cellText(f.value) || '—';
    const h = Math.max(
      doc.font('Helvetica').fontSize(9.5).heightOfString(value, { width: valueW }),
      12,
    );
    ensureSpace(doc, h + 6);
    const top = doc.y;
    const x0 = left(doc);
    doc.font('Helvetica').fontSize(8.5).fillColor(FAINT).text(f.label, x0, top, { width: labelW });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK)
      .text(value, x0 + labelW + 10, top, { width: valueW });
    doc.x = x0;
    doc.y = top + h + 5;
  }
}

/** Proportional widths that fill the page, honouring the declared preferences. */
function fitColumns(doc: PDFKit.PDFDocument, columns: Column[]): number[] {
  const avail = pageWidth(doc);
  const weights = columns.map((c) => Math.max(6, c.width ?? 16));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / total) * avail);
}

function gridTable(doc: PDFKit.PDFDocument, columns: Column[], rows: Record<string, any>[]) {
  const widths = fitColumns(doc, columns);

  const drawHeader = () => {
    const top = doc.y;
    const h = 16;
    doc.rect(left(doc), top, pageWidth(doc), h).fill('#F5F7FA');
    let x = left(doc);
    columns.forEach((c, i) => {
      doc.fillColor(FAINT).font('Helvetica-Bold').fontSize(7.5)
        .text(c.header.toUpperCase(), x + 4, top + 5, { width: widths[i] - 8, lineBreak: false });
      x += widths[i];
    });
    doc.x = left(doc);
    doc.y = top + h;
  };

  drawHeader();

  for (const row of rows) {
    const cells = columns.map((c) => cellText(row[c.key]));
    const heights = cells.map((v, i) =>
      doc.font('Helvetica').fontSize(8).heightOfString(v || ' ', { width: widths[i] - 8 }),
    );
    const rowH = Math.max(...heights, 11) + 6;

    if (ensureSpace(doc, rowH + 4)) drawHeader();

    const top = doc.y;
    let x = left(doc);
    cells.forEach((v, i) => {
      doc.fillColor(INK).font('Helvetica').fontSize(8)
        .text(v, x + 4, top + 3, { width: widths[i] - 8 });
      x += widths[i];
    });
    doc.x = left(doc);
    doc.y = top + rowH;
    doc.moveTo(left(doc), doc.y - 2).lineTo(left(doc) + pageWidth(doc), doc.y - 2)
      .lineWidth(0.4).strokeColor(RULE).stroke();
  }
}

/** Each row as a labelled block — legible where a grid would not be. */
function stackedRecords(doc: PDFKit.PDFDocument, columns: Column[], rows: Record<string, any>[]) {
  const [first, ...rest] = columns;
  rows.forEach((row, idx) => {
    ensureSpace(doc, 60);
    if (idx > 0) doc.moveDown(0.4);

    const lead = cellText(row[first.key]) || `Row ${idx + 1}`;
    doc.x = left(doc);
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(9.5).text(lead, left(doc), doc.y);
    doc.moveDown(0.15);

    const populated = rest
      .map((c) => ({ label: c.header, value: cellText(row[c.key]) }))
      // Empty fields on a stacked layout are noise, not information.
      .filter((f) => f.value !== '');
    fieldList(doc, populated);

    doc.moveTo(left(doc), doc.y).lineTo(left(doc) + pageWidth(doc), doc.y)
      .lineWidth(0.4).strokeColor(RULE).stroke();
    doc.x = left(doc);
    doc.moveDown(0.3);
  });
}

function renderSection(doc: PDFKit.PDFDocument, section: ReportSection) {
  heading(doc, section.title);
  if (section.kind === 'fields') { fieldList(doc, section.fields); return; }

  if (section.rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(FAINT)
      .text('Nothing to report for this selection.');
    return;
  }
  if (section.columns.length <= MAX_GRID_COLUMNS) gridTable(doc, section.columns, section.rows);
  else stackedRecords(doc, section.columns, section.rows);
}

export function renderPdf(report: ReportDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Any wide table pushes the whole document to landscape, so the reader is
    // not turning the page sideways part-way through.
    const wide = report.sections.some(
      (s) => s.kind === 'table' && s.columns.length > MAX_GRID_COLUMNS,
    );
    const doc = new PDFDocument({
      size: 'A4',
      layout: wide ? 'landscape' : 'portrait',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: report.provenance.reportName,
        Author: report.provenance.generatedBy,
        Creator: 'GRC Wisdom',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const p = report.provenance;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(p.reportName);
    if (p.subjectRef) {
      doc.moveDown(0.2).font('Helvetica').fontSize(11).fillColor(MUTED).text(p.subjectRef);
    }
    doc.moveDown(0.6);

    const notice = draftNotice(p);
    if (notice) {
      const h = doc.font('Helvetica-Bold').fontSize(9).heightOfString(notice, { width: pageWidth(doc) - 16 }) + 12;
      const boxTop = doc.y;
      doc.rect(left(doc), boxTop, pageWidth(doc), h).fillAndStroke('#FDF3E2', '#EBD3A6');
      doc.fillColor(WARN).font('Helvetica-Bold').fontSize(9)
        .text(notice, left(doc) + 8, boxTop + 6, { width: pageWidth(doc) - 16 });
      doc.x = left(doc);
      doc.y = boxTop + h + 6;
    }

    heading(doc, 'Provenance');
    fieldList(doc, provenanceRows(p));

    for (const section of report.sections) renderSection(doc, section);

    // Page numbers are added last, once the count is known.
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.font('Helvetica').fontSize(7.5).fillColor(FAINT).text(
        `${p.reportName} · ${p.tenantName} · page ${i + 1} of ${range.count}`,
        MARGIN,
        doc.page.height - MARGIN + 12,
        { width: doc.page.width - MARGIN * 2, align: 'center', lineBreak: false },
      );
    }

    doc.end();
  });
}
