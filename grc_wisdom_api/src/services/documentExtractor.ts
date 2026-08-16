import { Candidate, CandidateKind } from './spreadsheetExtractor';

/**
 * Reads clauses out of a PDF or Word document.
 *
 * Harder than a spreadsheet, where a column means one thing. A document is a
 * single stream of text in which the running header, the page numbers and the
 * table of contents all superficially resemble clause content — a naive line
 * scan produces a candidate list mostly made of noise.
 *
 * So the text is cleaned before anything is detected: repeated furniture is
 * removed, contents entries are dropped, and wrapped lines are rejoined. Only
 * then are clause boundaries looked for.
 */

export type DocExtraction = {
  candidates: Candidate[];
  pageCount: number | null;
  warnings: string[];
  /** What the cleaner removed, so a reviewer can judge whether it over-reached. */
  discarded: { furniture: number; contents: number; pageNumbers: number };
};

/** Same shapes the spreadsheet extractor recognises, anchored to line starts. */
const REF_AT_START = new RegExp(
  '^(' + [
    '[A-Z]{1,3}\\.\\d+(?:\\.\\d+)*',        // A.5.15
    '\\d+(?:\\.\\d+){1,4}',                 // 1.2.1
    '[A-Z]{2}\\d?\\.\\d+',                  // CC6.1
    '\\d+(?:-\\d+){1,3}',                   // 2-2-1
    'Art(?:icle)?\\.?\\s?\\d+[a-z]?',       // Article 11
    '[A-Z]{2,5}[-.]\\d+(?:\\.\\d+)*',       // GV.OC-01
    '[A-Z]{1,4}-\\d{1,3}',                  // AC-01
  ].join('|') + ')(?=[\\s:.\\u2014-]|$)',
  'i',
);

const PAGE_NUMBER = /^-{0,2}\s*(page\s+)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?\s*-{0,2}$/i;
/** A contents line: a title, dot or space leaders, then a page number. */
const TOC_LINE = /[.·\s]{4,}\d{1,4}\s*$/;

function cleanLines(raw: string): { lines: string[]; discarded: DocExtraction['discarded'] } {
  const all = raw
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/ /g, ' ').trimEnd());

  // Running headers and footers repeat on nearly every page. Anything short
  // that appears many times is furniture, not content.
  const freq = new Map<string, number>();
  for (const l of all) {
    const k = l.trim();
    if (k.length > 3 && k.length < 90) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const pages = Math.max(1, Math.round(all.length / 45));
  const furnitureThreshold = Math.max(3, Math.floor(pages * 0.5));
  const furniture = new Set(
    [...freq.entries()].filter(([, n]) => n >= furnitureThreshold).map(([k]) => k),
  );

  const discarded = { furniture: 0, contents: 0, pageNumbers: 0 };
  const lines: string[] = [];

  for (const line of all) {
    const t = line.trim();
    if (!t) { lines.push(''); continue; }
    if (PAGE_NUMBER.test(t)) { discarded.pageNumbers++; continue; }
    if (furniture.has(t)) { discarded.furniture++; continue; }
    // A contents entry carries a reference but no substance — importing it
    // would create a clause whose text is a page number.
    if (TOC_LINE.test(t)) { discarded.contents++; continue; }
    lines.push(t);
  }
  return { lines, discarded };
}

/**
 * Rejoins wrapped lines. A line that does not start a new clause and does not
 * end a sentence is a continuation of the one above it.
 */
function rejoin(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line) { out.push(''); continue; }
    const startsClause = REF_AT_START.test(line);
    const prev = out[out.length - 1];

    // A clause heading is complete in itself. Headings rarely end in a full
    // stop, so without this the requirement paragraph below gets welded onto
    // the title and every clause reads as one run-on line.
    const prevIsHeading = (() => {
      if (prev === undefined || prev === '') return false;
      const split = splitRef(prev);
      return !!split && looksLikeTitle(split.rest);
    })();

    const prevContinues =
      prev !== undefined && prev !== '' && !/[.:;!?]$/.test(prev)
      && !startsClause && !prevIsHeading;

    if (prevContinues) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out;
}

/** Splits "8.2.1 Business impact analysis" into its reference and its title. */
function splitRef(line: string): { ref: string; rest: string } | null {
  const m = line.match(REF_AT_START);
  if (!m) return null;
  const ref = m[1].trim();
  const rest = line.slice(m[0].length).replace(/^[\s:.—-]+/, '').trim();
  return { ref, rest };
}

/** A title is a short phrase; a paragraph of requirement text is not one. */
function looksLikeTitle(s: string): boolean {
  if (!s || s.length > 120) return false;
  if (/[.;]\s/.test(s)) return false;          // more than one sentence
  const words = s.split(/\s+/).length;
  return words >= 1 && words <= 18;
}

export function extractFromDocumentText(
  text: string,
  kind: CandidateKind,
  pageCount: number | null,
): DocExtraction {
  const warnings: string[] = [];
  const { lines: cleaned, discarded } = cleanLines(text);
  const lines = rejoin(cleaned);

  const candidates: Candidate[] = [];
  const seen = new Map<string, number>();
  let current: { ref: string; title: string; body: string[]; line: number; confidence: Candidate['confidence'] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.join(' ').trim();
    let issue: string | null = null;
    let confidence = current.confidence;

    if (!current.title) {
      issue = 'No title could be read for this clause';
      confidence = 'Low';
    }
    const dupOf = seen.get(current.ref.toLowerCase());
    if (dupOf !== undefined) {
      issue = `Reference also appears near line ${dupOf} — the document may repeat it, or the parse ran on`;
      confidence = 'Low';
    } else {
      seen.set(current.ref.toLowerCase(), current.line);
    }

    candidates.push({
      rowNumber: current.line,
      ref: current.ref,
      title: current.title || '',
      body: body || null,
      extra: null,
      confidence,
      issue,
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const split = splitRef(line);
    if (split) {
      flush();
      let title = '';
      let confidence: Candidate['confidence'] = 'High';

      if (looksLikeTitle(split.rest)) {
        title = split.rest;
      } else if (!split.rest) {
        // The title sits on the following line, which is common in standards
        // that put the number on its own line.
        const next = lines.slice(i + 1).find((l) => l);
        if (next && looksLikeTitle(next)) { title = next; confidence = 'Medium'; }
      } else {
        // The remainder is a paragraph — take its opening as a provisional
        // title and flag it, because that is a guess rather than a reading.
        title = split.rest.split(/(?<=[.;])\s/)[0].slice(0, 110);
        confidence = 'Medium';
      }

      current = { ref: split.ref, title, body: [], line: i + 1, confidence };
      if (split.rest && split.rest !== title) current.body.push(split.rest);
      continue;
    }

    if (current) current.body.push(line);
  }
  flush();

  if (candidates.length === 0) {
    warnings.push(
      'No clause references were recognised. The document may be a scan with no text layer, or it may number its clauses in a style the parser does not know.',
    );
  }
  const weak = candidates.filter((c) => c.confidence !== 'High').length;
  if (weak > 0) warnings.push(`${weak} of ${candidates.length} clause(s) need a look before they can be accepted`);
  if (discarded.contents > 0) warnings.push(`${discarded.contents} contents-page line(s) ignored`);
  if (discarded.furniture > 0) warnings.push(`${discarded.furniture} repeated header or footer line(s) ignored`);

  return { candidates, pageCount, warnings, discarded };
}

/** PDF and Word both reduce to plain text before detection begins. */
export async function extractFromDocument(
  buffer: Buffer,
  kind: CandidateKind,
  fileType: 'pdf' | 'docx',
): Promise<DocExtraction> {
  if (fileType === 'pdf') {
    // pdf-parse v2 exposes a class rather than the callable v1 exported.
    const { PDFParse } = await import('pdf-parse') as any;
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return extractFromDocumentText(parsed.text || '', kind, parsed.total ?? null);
    } finally {
      // The parser holds the document open; release it either way.
      await parser.destroy?.();
    }
  }
  const mammoth: any = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return extractFromDocumentText(result.value || '', kind, null);
}
