import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, WidthType, AlignmentType, BorderStyle, PageOrientation, ShadingType,
} from 'docx';
import {
  ReportDocument, ReportSection, Column,
  draftNotice, provenanceRows, cellText,
} from './reportDocument';

/**
 * Renders a report as Word — the format for a report that will be edited
 * before it goes to committee.
 *
 * Unlike the PDF renderer this keeps wide tables as tables, because a Word
 * document is scrolled and resized rather than printed at a fixed size, and an
 * editor expects to be able to work in the grid.
 */

const INK = '0B1524';
const MUTED = '55627A';
const FAINT = '646F85';
const RULE = 'E1E7EF';
const SUNK = 'F5F7FA';
const BRAND = '0F7A5A';
const WARN = '9A6510';
const WARN_BG = 'FDF3E2';

/** A wide table needs the page turned; anything narrower reads fine upright. */
const LANDSCAPE_THRESHOLD = 6;

const thinBorder = {
  top: { style: BorderStyle.SINGLE, size: 1, color: RULE },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: RULE },
  left: { style: BorderStyle.SINGLE, size: 1, color: RULE },
  right: { style: BorderStyle.SINGLE, size: 1, color: RULE },
};

const text = (s: string, opts: any = {}) =>
  new Paragraph({ children: [new TextRun({ text: s, ...opts })], spacing: { after: opts.after ?? 60 } });

function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    text: title,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
  });
}

function cell(content: string, opts: { bold?: boolean; color?: string; shade?: string; width?: number } = {}): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text: content || '',
        bold: opts.bold,
        color: opts.color ?? INK,
        size: opts.bold ? 16 : 17,   // half-points: 8pt header, 8.5pt body
      })],
    })],
    borders: thinBorder,
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade, color: 'auto' } : undefined,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
  });
}

function fieldTable(fields: { label: string; value: string }[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: fields.map((f) => new TableRow({
      children: [
        cell(f.label, { color: FAINT, width: 28, shade: SUNK }),
        cell(cellText(f.value) || '—', { width: 72 }),
      ],
    })),
  });
}

function dataTable(columns: Column[], rows: Record<string, any>[]): Table {
  const total = columns.reduce((a, c) => a + Math.max(6, c.width ?? 16), 0);
  const pct = columns.map((c) => (Math.max(6, c.width ?? 16) / total) * 100);

  const header = new TableRow({
    tableHeader: true,   // repeats the header when the table spans pages
    children: columns.map((c, i) =>
      cell(c.header.toUpperCase(), { bold: true, color: FAINT, shade: SUNK, width: pct[i] })),
  });

  const body = rows.map((r) => new TableRow({
    children: columns.map((c, i) => cell(cellText(r[c.key]), { width: pct[i] })),
  }));

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] });
}

function renderSection(section: ReportSection): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [sectionHeading(section.title)];
  if (section.kind === 'fields') { out.push(fieldTable(section.fields)); return out; }
  if (section.rows.length === 0) {
    out.push(text('Nothing to report for this selection.', { italics: true, color: FAINT }));
    return out;
  }
  out.push(dataTable(section.columns, section.rows));
  return out;
}

export async function renderDocx(report: ReportDocument): Promise<Buffer> {
  const p = report.provenance;
  const wide = report.sections.some(
    (s) => s.kind === 'table' && s.columns.length > LANDSCAPE_THRESHOLD,
  );

  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: p.reportName, heading: HeadingLevel.TITLE, spacing: { after: 120 } }),
  ];
  if (p.subjectRef) children.push(text(p.subjectRef, { color: MUTED, size: 22, after: 160 }));

  const notice = draftNotice(p);
  if (notice) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({
        children: [new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: notice, bold: true, color: WARN, size: 18 })],
          })],
          shading: { type: ShadingType.CLEAR, fill: WARN_BG, color: 'auto' },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'EBD3A6' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'EBD3A6' },
            left: { style: BorderStyle.SINGLE, size: 12, color: WARN },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'EBD3A6' },
          },
          margins: { top: 120, bottom: 120, left: 140, right: 140 },
        })],
      })],
    }));
    children.push(text('', { after: 160 }));
  }

  children.push(sectionHeading('Provenance'), fieldTable(provenanceRows(p)));
  for (const section of report.sections) children.push(...renderSection(section));

  const doc = new Document({
    creator: p.generatedBy,
    title: p.reportName,
    description: `${p.reportName} — ${p.tenantName}`,
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 20, color: INK } },
        title: { run: { size: 36, bold: true, color: INK } },
        heading2: { run: { size: 24, bold: true, color: BRAND } },
      },
    },
    sections: [{
      properties: wide
        ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } }
        : {},
      footers: undefined,
      children: [
        ...children,
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 320 },
          children: [new TextRun({
            text: `${p.reportName} · ${p.tenantName} · generated ${new Date().toISOString().slice(0, 10)}`,
            size: 15, color: FAINT,
          })],
        }),
      ],
    }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
