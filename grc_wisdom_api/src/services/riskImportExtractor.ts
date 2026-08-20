import { readSheetRows, normaliseHeader } from './spreadsheetExtractor';
import {
  RISK_DIRECTIONS, THREAT_TREATMENTS, OPPORTUNITY_TREATMENTS, treatmentsFor,
} from './riskLifecycle';
import { CATEGORIES } from '../controllers/riskController';

/**
 * Reads risk rows out of a spreadsheet.
 *
 * Almost every organisation arrives with a register already in Excel — that is
 * where risk management lives before it lives in a platform. Retyping two
 * hundred rows is how an adoption stalls in week one.
 *
 * Staged, like the asset importer, and for a sharper reason. Single-risk
 * creation enforces a mandatory duplicate search: a register nobody
 * deduplicates becomes a list nobody trusts. A bulk path that skipped it would
 * admit three spellings of the same risk at once, so near-duplicates against
 * the live register are flagged here and the reviewer decides.
 */

export type RiskRow = {
  title: string;
  description: string;
  category: string;
  direction: string;
  likelihood: number;
  impact: number;
  treatmentType: string;
  ownerEmail: string | null;
  identifiedVia: string;
  identifiedSource: string | null;
  reviewCadenceMonths: number;
  /** Matched to an existing asset on commit, by ref or by name. */
  assetKey: string | null;
  /** Derived here so the reviewer sees the consequence before committing. */
  inherentScore: number;
};

export type RiskCandidate = {
  rowNumber: number;
  row: RiskRow;
  confidence: 'High' | 'Medium' | 'Low';
  /** Blocking — cannot be committed as it stands. */
  issue: string | null;
  /** Non-blocking: what the parser interpreted or assumed, in plain words. */
  notes: string[];
  /**
   * True when a value was absent and assumed rather than read. Resolving
   * "cyber" to Technology is a successful read and stays bulk-acceptable;
   * inventing a category because the column was blank is not.
   */
  defaulted: boolean;
  /** Titles already in the register that look like this one. */
  possibleDuplicates: string[];
};

export type RiskExtraction = {
  candidates: RiskCandidate[];
  headerRow: number | null;
  columnsUsed: Record<string, string>;
  unmappedColumns: string[];
  warnings: string[];
};

/** Header synonyms, most specific first. */
const HEADERS: Record<string, string[]> = {
  title: ['risk title', 'risk name', 'risk event', 'risk', 'title', 'name',
    'event', 'scenario', 'description of risk'],
  description: ['risk description', 'description', 'risk detail', 'details',
    'cause event impact', 'narrative', 'cause', 'commentary', 'context'],
  category: ['risk category', 'category', 'risk type', 'classification',
    'domain', 'risk area', 'area', 'type'],
  direction: ['direction', 'threat opportunity', 'threat or opportunity',
    'upside downside', 'nature'],
  likelihood: ['inherent likelihood', 'likelihood', 'probability', 'likelyhood',
    'chance', 'frequency'],
  impact: ['inherent impact', 'impact', 'consequence', 'severity', 'magnitude'],
  treatmentType: ['treatment type', 'treatment', 'risk response', 'response',
    'treatment strategy', 'strategy', 'action type'],
  ownerEmail: ['risk owner', 'owner email', 'owner', 'accountable', 'responsible',
    'assigned to', 'risk manager'],
  identifiedVia: ['identified via', 'identified by', 'how identified', 'source',
    'origin', 'raised by', 'method'],
  identifiedSource: ['source reference', 'source ref', 'reference', 'document',
    'evidence'],
  reviewCadenceMonths: ['review cadence', 'review frequency', 'review months',
    'reassess', 'review cycle'],
  assetKey: ['related asset', 'affected asset', 'asset ref', 'asset name',
    'asset', 'applies to', 'system'],
};

const cell = (row: any[], idx: number | undefined): string => {
  if (idx === undefined || idx < 0) return '';
  const v = row?.[idx];
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('text' in v) return String((v as any).text).trim();
    if ('result' in v) return String((v as any).result).trim();
    if ('richText' in v) return (v as any).richText.map((r: any) => r.text).join('').trim();
  }
  return String(v).trim();
};

/** A title column alone is enough; everything else has a defensible default. */
function findHeader(rows: any[][]): { index: number; map: Record<string, number> } | null {
  let best: { index: number; map: Record<string, number>; score: number } | null = null;

  for (let r = 0; r < Math.min(15, rows.length); r++) {
    const row = rows[r] || [];
    const map: Record<string, number> = {};
    let score = 0;

    for (const [field, synonyms] of Object.entries(HEADERS)) {
      for (let c = 0; c < row.length; c++) {
        const h = normaliseHeader(row[c]);
        if (!h) continue;
        const exact = synonyms.indexOf(h);
        const loose = exact === -1
          ? synonyms.findIndex((syn) => syn.length > 2 && (h === syn || h.includes(syn)))
          : exact;
        if (loose === -1) continue;
        if (map[field] === undefined) {
          map[field] = c;
          score += Math.max(1, synonyms.length - loose);
        }
      }
    }
    if (map.title !== undefined && (!best || score > best.score)) best = { index: r, map, score };
  }
  return best ? { index: best.index, map: best.map } : null;
}

function matchVocab(raw: string, vocab: readonly string[]): string | null {
  if (!raw) return null;
  const n = normaliseHeader(raw);
  for (const v of vocab) if (normaliseHeader(v) === n) return v;
  for (const v of vocab) {
    const nv = normaliseHeader(v);
    if (n.includes(nv) || nv.includes(n)) return v;
  }
  return null;
}

const CATEGORY_ALIASES: Record<string, string> = {
  cyber: 'Technology', it: 'Technology', 'information security': 'Technology',
  infosec: 'Technology', security: 'Technology', digital: 'Technology',
  regulatory: 'Compliance', legal: 'Compliance', privacy: 'Compliance',
  conduct: 'Compliance', aml: 'Compliance',
  credit: 'Financial', market: 'Financial', liquidity: 'Financial', treasury: 'Financial',
  supplier: 'Third-Party', vendor: 'Third-Party', outsourcing: 'Third-Party',
  'supply chain': 'Third-Party',
  hr: 'People', workforce: 'People', staffing: 'People', culture: 'People',
  process: 'Operational', operations: 'Operational', bcm: 'Operational',
  continuity: 'Operational', fraud: 'Operational',
  strategy: 'Strategic', reputational: 'Strategic', reputation: 'Strategic',
  esg: 'Strategic',
};

const TREATMENT_ALIASES: Record<string, string> = {
  reduce: 'Mitigate', mitigation: 'Mitigate', treat: 'Mitigate', control: 'Mitigate',
  tolerate: 'Accept', retain: 'Accept', accepted: 'Accept',
  insure: 'Transfer', outsource: 'Transfer',
  terminate: 'Avoid', eliminate: 'Avoid', exit: 'Avoid',
  pursue: 'Exploit', seize: 'Exploit', capture: 'Exploit',
  improve: 'Enhance', amplify: 'Enhance',
};

const DIRECTION_ALIASES: Record<string, string> = {
  downside: 'Threat', negative: 'Threat', hazard: 'Threat',
  upside: 'Opportunity', positive: 'Opportunity', benefit: 'Opportunity',
};

const VIA_VALUES = ['Workshop', 'RCSA', 'Incident', 'InternalAudit', 'ExternalAudit',
  'Regulator', 'KRI', 'LossEvent', 'Scan'];

const VIA_ALIASES: Record<string, string> = {
  audit: 'InternalAudit', 'internal audit': 'InternalAudit',
  'external audit': 'ExternalAudit', regulator: 'Regulator', regulatory: 'Regulator',
  incident: 'Incident', event: 'Incident', 'loss event': 'LossEvent',
  'self assessment': 'RCSA', 'control self assessment': 'RCSA', assessment: 'RCSA',
  'risk workshop': 'Workshop', interview: 'Workshop', brainstorm: 'Workshop',
  scan: 'Scan', 'vulnerability scan': 'Scan', 'penetration test': 'Scan',
};

/** Numbers, or the words a business register actually uses. */
function parseScale(raw: string): { value: number; note: string | null; invalid: boolean } {
  if (!raw) return { value: 3, note: 'defaulted to 3', invalid: false };
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n >= 1 && n <= 5) return { value: Math.round(n), note: null, invalid: false };
    return { value: 3, note: null, invalid: true };
  }
  const words: Record<string, number> = {
    'very low': 1, rare: 1, negligible: 1, remote: 1, insignificant: 1,
    low: 2, unlikely: 2, minor: 2,
    medium: 3, possible: 3, moderate: 3,
    high: 4, likely: 4, major: 4, significant: 4,
    'very high': 5, 'almost certain': 5, certain: 5, severe: 5, critical: 5,
    catastrophic: 5,
  };
  const key = normaliseHeader(raw);
  if (words[key] !== undefined) {
    return { value: words[key], note: 'read "' + raw + '" as ' + words[key], invalid: false };
  }
  return { value: 3, note: null, invalid: true };
}

/**
 * Near-duplicate detection against the existing register.
 *
 * Deliberately loose: it prompts a look, it does not reject. Two risks sharing
 * three significant words are usually the same risk written twice, and a
 * register that accumulates those stops being usable within a year.
 */
function findSimilar(title: string, existing: { title: string }[]): string[] {
  const words = new Set(normaliseHeader(title).split(' ').filter((w) => w.length > 3));
  if (words.size === 0) return [];
  const hits: { title: string; overlap: number }[] = [];
  for (const e of existing) {
    const other = new Set(normaliseHeader(e.title).split(' ').filter((w) => w.length > 3));
    let overlap = 0;
    for (const w of words) if (other.has(w)) overlap++;
    const ratio = overlap / Math.max(1, Math.min(words.size, other.size));
    if (overlap >= 3 || ratio >= 0.6) hits.push({ title: e.title, overlap });
  }
  return hits.sort((a, b) => b.overlap - a.overlap).slice(0, 3).map((h) => h.title);
}

export async function extractRisksFromSpreadsheet(
  buffer: Buffer,
  fileType: 'xlsx' | 'csv',
  existingRisks: { title: string }[] = [],
): Promise<RiskExtraction> {
  const sheetData = await readSheetRows(buffer, fileType);
  if (!sheetData) {
    return {
      candidates: [], headerRow: null, columnsUsed: {}, unmappedColumns: [],
      warnings: ['The file has no readable sheet.'],
    };
  }
  const rows = sheetData.cells;
  const lineOf = (i: number) => sheetData.lineNumbers[i] ?? i + 1;

  const header = findHeader(rows);
  if (!header) {
    return {
      candidates: [], headerRow: null, columnsUsed: {}, unmappedColumns: [],
      warnings: [
        'No header row found. The sheet needs a row naming at least a risk title column — '
        + '"Risk title", "Risk", "Risk name" and "Scenario" are all recognised. '
        + 'Download the template if the register is being written from scratch.',
      ],
    };
  }

  const headerRow = rows[header.index] || [];
  const columnsUsed: Record<string, string> = {};
  for (const [field, idx] of Object.entries(header.map)) {
    columnsUsed[field] = cell(headerRow, idx) || ('column ' + (idx + 1));
  }
  const mapped = new Set(Object.values(header.map));
  const unmappedColumns = headerRow
    .map((h, i) => (!mapped.has(i) && String(h ?? '').trim() ? String(h).trim() : null))
    .filter(Boolean) as string[];

  const warnings: string[] = [];
  for (const req of ['likelihood', 'impact']) {
    if (header.map[req] === undefined) {
      warnings.push(
        'No ' + req + ' column found — every row will default to 3, so the whole import scores 9. '
        + 'Add a "' + req + '" column before importing.',
      );
    }
  }
  if (header.map.category === undefined) {
    warnings.push(
      'No category column found — every row defaults to Operational. Appetite is set per category, '
      + 'so the entire import would be judged against one ceiling.',
    );
  }

  const candidates: RiskCandidate[] = [];
  const seenTitles = new Map<string, number>();

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const title = cell(row, header.map.title);
    if (!title && row.every((v) => !cell([v], 0))) continue;

    const notes: string[] = [];
    // Set whenever a value is assumed rather than read from the file.
    let defaulted = false;
    let issue: string | null = null;

    if (!title) {
      candidates.push({
        rowNumber: lineOf(i),
        row: {
          title: '', description: '', category: 'Operational', direction: 'Threat',
          likelihood: 3, impact: 3, treatmentType: 'Mitigate', ownerEmail: null,
          identifiedVia: 'Workshop', identifiedSource: null, reviewCadenceMonths: 6,
          assetKey: null, inherentScore: 9,
        },
        confidence: 'Low',
        issue: 'No risk title in this row.',
        notes: [], defaulted: true, possibleDuplicates: [],
      });
      continue;
    }

    // ── Direction ─────────────────────────────────────────────────────
    const rawDir = cell(row, header.map.direction);
    let direction = matchVocab(rawDir, RISK_DIRECTIONS);
    if (!direction && rawDir) {
      const alias = DIRECTION_ALIASES[normaliseHeader(rawDir)];
      if (alias) { direction = alias; notes.push('read direction "' + rawDir + '" as ' + alias); }
    }
    if (!direction) { direction = 'Threat'; if (rawDir) defaulted = true; }

    // ── Category ──────────────────────────────────────────────────────
    const rawCat = cell(row, header.map.category);
    let category = matchVocab(rawCat, CATEGORIES);
    if (!category && rawCat) {
      const alias = CATEGORY_ALIASES[normaliseHeader(rawCat)];
      if (alias) { category = alias; notes.push('read category "' + rawCat + '" as ' + alias); }
    }
    if (!category) {
      category = 'Operational';
      // The single-create path coerces an unknown category silently, which is
      // wrong there too: appetite is per category, so a mis-filed risk is
      // judged against the wrong ceiling. Here it is at least reported.
      defaulted = true;
      if (rawCat) notes.push('category "' + rawCat + '" not recognised, filed as Operational');
      else notes.push('category defaulted to Operational');
    }

    // ── Scores ────────────────────────────────────────────────────────
    const l = parseScale(cell(row, header.map.likelihood));
    const imp = parseScale(cell(row, header.map.impact));
    for (const pair of [['likelihood', l], ['impact', imp]] as const) {
      const name = pair[0];
      const r = pair[1];
      if (r.invalid) {
        issue = issue ?? (
          name + ' is "' + cell(row, header.map[name]) + '" — must be 1 to 5, or one of '
          + 'Rare / Unlikely / Possible / Likely / Almost certain.'
        );
      } else if (r.note) {
        notes.push(name + ' ' + r.note);
        // "defaulted to 3" is an assumption; "read Likely as 4" is a read.
        if (r.note.startsWith('defaulted')) defaulted = true;
      }
    }

    // ── Treatment, which must agree with direction ─────────────────────
    const allowed = treatmentsFor(direction);
    const rawTreat = cell(row, header.map.treatmentType);
    let treatmentType = matchVocab(rawTreat, allowed);
    if (!treatmentType && rawTreat) {
      const alias = TREATMENT_ALIASES[normaliseHeader(rawTreat)];
      if (alias && allowed.includes(alias)) {
        treatmentType = alias;
        notes.push('read treatment "' + rawTreat + '" as ' + alias);
      } else if (alias) {
        // A real treatment word, but for the other direction. Mitigating an
        // opportunity is not a typo, it is a misunderstanding worth surfacing.
        const belongsTo = (THREAT_TREATMENTS as readonly string[]).includes(alias)
          ? 'threat' : 'opportunity';
        issue = issue ?? (
          'Treatment "' + rawTreat + '" is a ' + belongsTo + ' response, but this row is a '
          + direction.toLowerCase() + '. Allowed: ' + allowed.join(', ') + '.'
        );
      }
    }
    if (!treatmentType && !issue) {
      if (rawTreat) {
        issue = 'Treatment "' + rawTreat + '" is not one of ' + allowed.join(', ')
          + ' for a ' + direction.toLowerCase() + '.';
      } else {
        treatmentType = direction === 'Opportunity' ? 'Enhance' : 'Mitigate';
        // A blank treatment column is normal on an inherited register and the
        // default is the safe one, so this is reported without demoting the row.
        notes.push('treatment defaulted to ' + treatmentType);
      }
    }

    // ── Provenance ────────────────────────────────────────────────────
    const rawVia = cell(row, header.map.identifiedVia);
    let identifiedVia = matchVocab(rawVia, VIA_VALUES);
    if (!identifiedVia && rawVia) {
      const alias = VIA_ALIASES[normaliseHeader(rawVia)];
      if (alias) { identifiedVia = alias; notes.push('read source "' + rawVia + '" as ' + alias); }
    }
    if (!identifiedVia) {
      identifiedVia = 'Workshop';
      if (rawVia) defaulted = true;
    }

    const cadenceRaw = Number(cell(row, header.map.reviewCadenceMonths));
    const reviewCadenceMonths = Number.isFinite(cadenceRaw) && cadenceRaw >= 1 && cadenceRaw <= 36
      ? Math.round(cadenceRaw)
      : 6;

    const description = cell(row, header.map.description)
      || ('Imported from a register. ' + title);

    // ── Duplicates ────────────────────────────────────────────────────
    const dupOf = seenTitles.get(title.toLowerCase());
    if (!issue && dupOf) issue = 'Duplicates row ' + dupOf + ', which has the same title.';
    seenTitles.set(title.toLowerCase(), lineOf(i));
    const possibleDuplicates = issue ? [] : findSimilar(title, existingRisks);

    // High means the parser read every value it needed and none resembles a
    // risk already on the register — the row a person can accept without
    // opening it. Interpreting an alias does not cost the row its confidence.
    const scoresRead = header.map.likelihood !== undefined && header.map.impact !== undefined
      && !l.invalid && !imp.invalid && !(l.note || '').startsWith('defaulted')
      && !(imp.note || '').startsWith('defaulted');
    const confidence: RiskCandidate['confidence'] = issue
      ? 'Low'
      : (scoresRead && !defaulted && possibleDuplicates.length === 0) ? 'High' : 'Medium';

    candidates.push({
      rowNumber: lineOf(i),
      row: {
        title, description, category, direction,
        likelihood: l.value, impact: imp.value,
        treatmentType: treatmentType || (direction === 'Opportunity' ? 'Enhance' : 'Mitigate'),
        ownerEmail: cell(row, header.map.ownerEmail) || null,
        identifiedVia,
        identifiedSource: cell(row, header.map.identifiedSource) || null,
        reviewCadenceMonths,
        assetKey: cell(row, header.map.assetKey) || null,
        inherentScore: l.value * imp.value,
      },
      confidence, issue, notes, defaulted, possibleDuplicates,
    });
  }

  if (candidates.length === 0) warnings.push('A header row was found but no data rows follow it.');

  return { candidates, headerRow: lineOf(header.index), columnsUsed, unmappedColumns, warnings };
}

/** The columns the importer understands, for the downloadable template. */
export const RISK_TEMPLATE_COLUMNS = [
  {
    header: 'Risk title',
    example: 'Privileged access granted without recertification',
    required: true,
    help: 'The only mandatory column. Write the risk, not the control that mitigates it.',
  },
  {
    header: 'Description',
    example: 'Cause: no quarterly review. Event: standing access persists. Impact: unauthorised change to production.',
    required: false,
    help: 'Cause, event and impact. Falls back to the title when blank.',
  },
  {
    header: 'Category',
    example: 'Technology',
    required: false,
    help: CATEGORIES.join(', ')
      + '. Common words like "cyber", "regulatory" or "supplier" are understood. '
      + 'Appetite is set per category, so this one matters.',
  },
  {
    header: 'Direction',
    example: 'Threat',
    required: false,
    help: 'Threat or Opportunity. ISO 31000 counts upside as risk. Defaults to Threat.',
  },
  {
    header: 'Likelihood',
    example: '4',
    required: false,
    help: '1 to 5, or Rare / Unlikely / Possible / Likely / Almost certain.',
  },
  {
    header: 'Impact',
    example: '5',
    required: false,
    help: '1 to 5, or Insignificant / Minor / Moderate / Major / Severe.',
  },
  {
    header: 'Treatment',
    example: 'Mitigate',
    required: false,
    help: 'Threats: ' + THREAT_TREATMENTS.join(', ')
      + '. Opportunities: ' + OPPORTUNITY_TREATMENTS.join(', ')
      + '. Mixing the two is refused rather than silently corrected.',
  },
  {
    header: 'Risk owner',
    example: 'risk.manager@omniops.me',
    required: false,
    help: 'Email of a user in this entity. Falls back to whoever runs the import.',
  },
  {
    header: 'Identified via',
    example: 'InternalAudit',
    required: false,
    help: 'How it was found: ' + VIA_VALUES.join(', ') + '. Defaults to Workshop.',
  },
  {
    header: 'Source reference',
    example: 'AUD-2026-01',
    required: false,
    help: 'The workshop, report or incident it came from.',
  },
  {
    header: 'Review cadence',
    example: '6',
    required: false,
    help: 'Months between reviews, 1 to 36. Defaults to 6.',
  },
  {
    header: 'Related asset',
    example: 'AST-0001',
    required: false,
    help: 'An asset reference or name already in the register. Links the risk to it on commit, '
      + 'which is what lets impact trace back to something somebody valued.',
  },
];
