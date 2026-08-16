import ExcelJS from 'exceljs';

/**
 * Reads clause or control rows out of a spreadsheet.
 *
 * Real files never agree on column headings — the same column is "Ref",
 * "Clause", "Control ID" or "Requirement #" depending on who exported it. So
 * headers are matched by intent rather than by exact name, and the header row
 * is found rather than assumed to be row one, because exports routinely carry
 * a title block above the table.
 */

export type CandidateKind = 'Clause' | 'Control';

export type Candidate = {
  rowNumber: number;
  ref: string;
  title: string;
  body: string | null;
  extra: string | null;
  confidence: 'High' | 'Medium' | 'Low';
  issue: string | null;
};

export type ExtractionResult = {
  candidates: Candidate[];
  headerRow: number | null;
  columnsUsed: Record<string, string>;
  warnings: string[];
};

/** Header synonyms, most specific first so "control id" beats a bare "id". */
const HEADERS: Record<CandidateKind, Record<string, string[]>> = {
  Clause: {
    ref:   ['clause ref', 'clause reference', 'clause id', 'clause no', 'clause number',
            'requirement id', 'requirement no', 'requirement #', 'ref', 'reference',
            'clause', 'id', 'no', 'number', 'section'],
    title: ['clause title', 'requirement title', 'title', 'name', 'requirement', 'heading', 'subject'],
    body:  ['clause text', 'requirement text', 'text', 'description', 'details', 'detail',
            'statement', 'wording', 'guidance'],
  },
  Control: {
    ref:   ['control id', 'control ref', 'control code', 'control no', 'control number',
            'ref', 'reference', 'code', 'id', 'no'],
    title: ['control title', 'control name', 'title', 'name', 'control'],
    body:  ['objective', 'control objective', 'description', 'purpose', 'intent', 'details', 'text'],
    extra: ['domain', 'category', 'family', 'area', 'grouping', 'theme'],
  },
};

const norm = (v: any) =>
  String(v ?? '').trim().toLowerCase().replace(/[\s_\-.]+/g, ' ').replace(/[^\w %#]/g, '');

/** Clause and control references follow recognisable shapes across frameworks. */
const REF_PATTERNS: RegExp[] = [
  /^[A-Z]{1,3}\.\d+(\.\d+)*$/i,        // A.5.15   ISO annex
  /^\d+(\.\d+){1,4}$/,                 // 1.2.1    PCI, NIST
  /^[A-Z]{2}\d?\.\d+$/i,               // CC6.1    SOC 2
  /^\d+(-\d+){1,3}$/,                  // 2-2-1    NCA ECC
  /^art\.?\s?\d+[a-z]?$/i,             // Art. 11  regulations
  /^[A-Z]{2,5}[-.]\d+(\.\d+)*$/i,      // GV.OC-01 NIST CSF
  /^[A-Z]{1,4}-\d{1,3}$/i,             // AC-01
];

function refConfidence(ref: string, title: string): { confidence: Candidate['confidence']; issue: string | null } {
  if (!ref) return { confidence: 'Low', issue: 'No reference found in this row' };
  if (!title) return { confidence: 'Low', issue: 'No title found in this row' };
  const known = REF_PATTERNS.some((re) => re.test(ref));
  if (known) return { confidence: 'High', issue: null };
  // Something is there and it is short enough to be an identifier.
  if (ref.length <= 20) {
    return { confidence: 'Medium', issue: 'Reference does not match a familiar clause-numbering style — check it reads correctly' };
  }
  return { confidence: 'Low', issue: 'Reference looks too long to be an identifier' };
}

/**
 * Finds the header row by scoring the first fifteen rows against the synonym
 * lists. An export with a title block above the table would otherwise have its
 * heading parsed as data.
 */
function findHeader(rows: any[][], kind: CandidateKind): { index: number; map: Record<string, number> } | null {
  const wanted = HEADERS[kind];
  let best: { index: number; map: Record<string, number>; score: number } | null = null;

  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(norm);
    if (cells.filter(Boolean).length < 2) continue;

    const map: Record<string, number> = {};
    let score = 0;
    for (const [field, synonyms] of Object.entries(wanted)) {
      for (const syn of synonyms) {
        const at = cells.findIndex((c) => c === syn);
        if (at >= 0 && map[field] === undefined) {
          map[field] = at;
          // An exact, specific synonym is worth more than a generic one.
          score += syn.includes(' ') ? 3 : 1;
          break;
        }
      }
    }
    // A usable header needs at least a reference and a title.
    if (map.ref !== undefined && map.title !== undefined && score > (best?.score ?? 0)) {
      best = { index: i, map, score };
    }
  }
  return best ? { index: best.index, map: best.map } : null;
}

function cell(row: any[], idx: number | undefined): string {
  if (idx === undefined) return '';
  const v = row[idx];
  if (v === null || v === undefined) return '';
  // ExcelJS hands back rich text and formula objects, not just strings.
  if (typeof v === 'object') {
    if ('text' in v) return String((v as any).text).trim();
    if ('result' in v) return String((v as any).result).trim();
    if ('richText' in v) return (v as any).richText.map((t: any) => t.text).join('').trim();
    return '';
  }
  return String(v).trim();
}

export async function extractFromSpreadsheet(
  buffer: Buffer,
  kind: CandidateKind,
  fileType: 'xlsx' | 'csv',
): Promise<ExtractionResult> {
  const wb = new ExcelJS.Workbook();
  if (fileType === 'csv') {
    const { Readable } = await import('stream');
    await wb.csv.read(Readable.from(buffer.toString('utf8')));
  } else {
    await wb.xlsx.load(buffer as any);
  }

  const sheet = wb.worksheets[0];
  if (!sheet) {
    return { candidates: [], headerRow: null, columnsUsed: {}, warnings: ['The file has no readable sheet'] };
  }

  const rows: any[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as any[];
    // ExcelJS pads index 0; drop it so columns are zero-based.
    rows.push(values.slice(1));
  });

  const header = findHeader(rows, kind);
  const warnings: string[] = [];
  if (!header) {
    return {
      candidates: [],
      headerRow: null,
      columnsUsed: {},
      warnings: [
        `No header row found. The sheet needs a row naming at least a reference column and a title column — for ${kind === 'Clause' ? '"Ref" and "Title"' : '"Control ID" and "Title"'}.`,
      ],
    };
  }

  const columnsUsed: Record<string, string> = {};
  for (const [field, idx] of Object.entries(header.map)) {
    columnsUsed[field] = cell(rows[header.index], idx) || `column ${idx + 1}`;
  }

  const candidates: Candidate[] = [];
  const seen = new Map<string, number>();

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const ref = cell(row, header.map.ref);
    const title = cell(row, header.map.title);
    const body = cell(row, header.map.body) || null;
    const extra = cell(row, (header.map as any).extra) || null;

    // Skip rows that are entirely blank rather than reporting them as faults.
    if (!ref && !title && !body) continue;

    const { confidence, issue } = refConfidence(ref, title);
    let rowIssue = issue;

    // A reference repeated inside one file is always an error worth surfacing
    // before commit, because the commit itself would reject the whole batch.
    const dupOf = seen.get(ref.toLowerCase());
    if (ref && dupOf !== undefined) {
      rowIssue = `Duplicate of the entry on row ${dupOf} — the same reference cannot appear twice`;
    } else if (ref) {
      seen.set(ref.toLowerCase(), i + 1);
    }

    candidates.push({
      rowNumber: i + 1,
      ref, title, body, extra,
      confidence: rowIssue && confidence === 'High' ? 'Medium' : confidence,
      issue: rowIssue,
    });
  }

  if (candidates.length === 0) warnings.push('The header row was found but no data rows followed it');
  const low = candidates.filter((c) => c.confidence !== 'High').length;
  if (low > 0) warnings.push(`${low} of ${candidates.length} row(s) need a look before they can be accepted`);

  return { candidates, headerRow: header.index + 1, columnsUsed, warnings };
}
