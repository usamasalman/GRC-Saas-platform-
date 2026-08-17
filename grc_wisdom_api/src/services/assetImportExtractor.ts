import { readSheetRows, normaliseHeader } from './spreadsheetExtractor';
import { ASSET_TYPES, ASSET_OWNERSHIP, CLASSIFICATIONS, computeCriticality } from './assetRiskScoring';

/**
 * Reads asset rows out of a spreadsheet.
 *
 * Registering assets one at a time is fine for a dozen and absurd for five
 * hundred, which is what a real inventory looks like. This reads the file a
 * facilities or IT team already keeps.
 *
 * It stages rather than imports. Asset criticality becomes the impact of every
 * risk raised against that asset, so a mis-parsed CIA rating does not stay a
 * spreadsheet problem — it propagates into the risk register and out into a
 * board pack. Nothing enters the inventory until a human has looked at what the
 * parser understood.
 */

export type AssetRow = {
  name: string;
  type: string;
  ownership: string;
  classification: string;
  confidentiality: number;
  integrity: number;
  availability: number;
  description: string | null;
  location: string | null;
  vendorName: string | null;
  contractRef: string | null;
  replacementValue: number | null;
  ownerEmail: string | null;
  custodianEmail: string | null;
  /** Derived here only so the reviewer can see it before committing. */
  criticality: number;
  criticalityTier: string;
};

export type AssetCandidate = {
  rowNumber: number;
  row: AssetRow;
  confidence: 'High' | 'Medium' | 'Low';
  /** Blocking. A candidate with an issue cannot be committed as it stands. */
  issue: string | null;
  /** Non-blocking: a value was defaulted or interpreted loosely. */
  notes: string[];
};

export type AssetExtraction = {
  candidates: AssetCandidate[];
  headerRow: number | null;
  columnsUsed: Record<string, string>;
  unmappedColumns: string[];
  warnings: string[];
};

/**
 * Header synonyms, most specific first. Real inventories come out of CMDBs,
 * finance systems and facilities spreadsheets, and none of them agree on what
 * to call a column.
 */
const HEADERS: Record<string, string[]> = {
  name: ['asset name', 'asset', 'name', 'system name', 'system', 'application',
    'application name', 'item', 'description of asset', 'title'],
  type: ['asset type', 'type', 'category', 'asset category', 'class', 'classification type', 'kind'],
  ownership: ['ownership', 'held by', 'owned by', 'internal external', 'internal or third party',
    'source', 'provisioning', 'hosting'],
  classification: ['classification', 'data classification', 'sensitivity',
    'information classification', 'confidentiality level'],
  confidentiality: ['confidentiality', 'c', 'conf', 'confidentiality rating',
    'confidentiality impact', 'cia c'],
  integrity: ['integrity', 'i', 'int', 'integrity rating', 'integrity impact', 'cia i'],
  availability: ['availability', 'a', 'avail', 'availability rating',
    'availability impact', 'cia a'],
  description: ['description', 'details', 'notes', 'purpose', 'comment', 'remarks'],
  location: ['location', 'site', 'data centre', 'data center', 'region', 'premises', 'where'],
  vendorName: ['vendor', 'supplier', 'vendor name', 'supplier name', 'provider',
    'third party', 'service provider'],
  contractRef: ['contract', 'contract ref', 'contract reference', 'agreement', 'po', 'contract no'],
  replacementValue: ['value', 'replacement value', 'replacement cost', 'cost', 'asset value',
    'book value', 'amount', 'capex'],
  ownerEmail: ['owner', 'asset owner', 'owner email', 'accountable', 'responsible', 'business owner'],
  custodianEmail: ['custodian', 'custodian email', 'operator', 'administrator', 'technical owner',
    'maintained by'],
};

const cell = (row: any[], idx: number | undefined): string => {
  if (idx === undefined || idx < 0) return '';
  const v = row?.[idx];
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    // ExcelJS returns rich text and formula results as objects.
    if ('text' in v) return String((v as any).text).trim();
    if ('result' in v) return String((v as any).result).trim();
    if ('richText' in v) return (v as any).richText.map((r: any) => r.text).join('').trim();
  }
  return String(v).trim();
};

/**
 * Finds the header row by scoring the first fifteen rows. A name column alone
 * is enough to proceed — everything else has a defensible default, and refusing
 * a file because it lacks a "classification" column would be unhelpful.
 */
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
        // Exact match first, then a contains match so "asset owner email" still lands.
        const exact = synonyms.indexOf(h);
        const loose = exact === -1
          ? synonyms.findIndex((syn) => syn.length > 2 && (h === syn || h.includes(syn)))
          : exact;
        if (loose === -1) continue;
        if (map[field] === undefined) {
          map[field] = c;
          // Earlier synonyms are more specific, so they score higher.
          score += Math.max(1, synonyms.length - loose);
        }
      }
    }
    if (map.name !== undefined && (!best || score > best.score)) best = { index: r, map, score };
  }
  return best ? { index: best.index, map: best.map } : null;
}

/** Matches a free-text cell to one of a known vocabulary, or returns null. */
function matchVocab(raw: string, vocab: readonly string[]): string | null {
  if (!raw) return null;
  const n = normaliseHeader(raw);
  for (const v of vocab) {
    const nv = normaliseHeader(v);
    if (n === nv) return v;
  }
  // Loose: "third-party", "3rd party", "external" all mean ThirdParty.
  for (const v of vocab) {
    const nv = normaliseHeader(v);
    if (n.includes(nv) || nv.includes(n)) return v;
  }
  return null;
}

const OWNERSHIP_ALIASES: Record<string, string> = {
  external: 'ThirdParty', outsourced: 'ThirdParty', supplier: 'ThirdParty',
  '3rd party': 'ThirdParty', vendor: 'ThirdParty', hosted: 'ThirdParty',
  own: 'Internal', owned: 'Internal', inhouse: 'Internal', 'in house': 'Internal',
  onprem: 'Internal', 'on prem': 'Internal', 'on premise': 'Internal',
  joint: 'Shared', hybrid: 'Shared', cohosted: 'Shared',
};

const TYPE_ALIASES: Record<string, string> = {
  data: 'Information', database: 'Information', records: 'Information', document: 'Information',
  app: 'Software', application: 'Software', system: 'Software', platform: 'Software',
  hardware: 'Physical', equipment: 'Physical', server: 'Physical', device: 'Physical',
  facility: 'Physical', building: 'Physical', vehicle: 'Physical',
  saas: 'Service', cloud: 'Service', utility: 'Service', outsourcing: 'Service',
  people: 'Personnel', staff: 'Personnel', team: 'Personnel', skill: 'Personnel',
  brand: 'Intangible', reputation: 'Intangible', licence: 'Intangible',
  license: 'Intangible', ip: 'Intangible',
};

/**
 * Parses a CIA rating. Accepts a number, or the words a business inventory
 * actually uses. A blank is not an error — it defaults to 3 and says so —
 * because refusing an otherwise good row over one empty cell helps nobody.
 */
function parseRating(raw: string): { value: number; note: string | null; invalid: boolean } {
  if (!raw) return { value: 3, note: 'defaulted to 3', invalid: false };
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n >= 1 && n <= 5) return { value: Math.round(n), note: null, invalid: false };
    return { value: 3, note: null, invalid: true };
  }
  const words: Record<string, number> = {
    'very low': 1, negligible: 1, minimal: 1, none: 1, low: 2,
    medium: 3, moderate: 3, mid: 3,
    high: 4, significant: 4, major: 4,
    'very high': 5, critical: 5, severe: 5, catastrophic: 5,
  };
  const key = normaliseHeader(raw);
  if (words[key] !== undefined) {
    return { value: words[key], note: `read "${raw}" as ${words[key]}`, invalid: false };
  }
  return { value: 3, note: null, invalid: true };
}

function parseMoney(raw: string): number | null {
  if (!raw) return null;
  // Strips currency symbols, thousands separators and trailing codes.
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function extractAssetsFromSpreadsheet(
  buffer: Buffer,
  fileType: 'xlsx' | 'csv',
): Promise<AssetExtraction> {
  const rows = await readSheetRows(buffer, fileType);
  if (!rows) {
    return {
      candidates: [], headerRow: null, columnsUsed: {}, unmappedColumns: [],
      warnings: ['The file has no readable sheet.'],
    };
  }

  const header = findHeader(rows);
  if (!header) {
    return {
      candidates: [], headerRow: null, columnsUsed: {}, unmappedColumns: [],
      warnings: [
        'No header row found. The sheet needs a row naming at least an asset name column — '
        + '"Asset name", "Asset", "System" or "Application" are all recognised. '
        + 'Download the template if the file is being written from scratch.',
      ],
    };
  }

  const headerRow = rows[header.index] || [];
  const columnsUsed: Record<string, string> = {};
  for (const [field, idx] of Object.entries(header.map)) {
    columnsUsed[field] = cell(headerRow, idx) || `column ${idx + 1}`;
  }
  const mapped = new Set(Object.values(header.map));
  const unmappedColumns = headerRow
    .map((h, i) => (!mapped.has(i) && String(h ?? '').trim() ? String(h).trim() : null))
    .filter(Boolean) as string[];

  const warnings: string[] = [];
  for (const required of ['type', 'confidentiality', 'integrity', 'availability']) {
    if (header.map[required] === undefined) {
      warnings.push(
        required === 'type'
          ? 'No type column found — every row will default to Information. Add a "Type" column to avoid correcting these by hand.'
          : `No ${required} column found — every row will default to 3, which makes criticality meaningless. Add a "${required}" column.`,
      );
    }
  }

  const candidates: AssetCandidate[] = [];
  const seenNames = new Map<string, number>();

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = cell(row, header.map.name);
    // A wholly blank line is a spacer, not a failed row.
    if (!name && row.every((v) => !cell([v], 0))) continue;

    const notes: string[] = [];
    let issue: string | null = null;

    if (!name) {
      candidates.push({
        rowNumber: i + 1,
        row: {
          name: '', type: 'Information', ownership: 'Internal', classification: 'Internal',
          confidentiality: 3, integrity: 3, availability: 3, description: null, location: null,
          vendorName: null, contractRef: null, replacementValue: null,
          ownerEmail: null, custodianEmail: null, criticality: 3, criticalityTier: 'Medium',
        },
        confidence: 'Low',
        issue: 'No asset name in this row.',
        notes: [],
      });
      continue;
    }

    // ── Type ──────────────────────────────────────────────────────────
    const rawType = cell(row, header.map.type);
    let type = matchVocab(rawType, ASSET_TYPES);
    if (!type && rawType) {
      const alias = TYPE_ALIASES[normaliseHeader(rawType)];
      if (alias) { type = alias; notes.push(`read type "${rawType}" as ${alias}`); }
    }
    if (!type) {
      type = 'Information';
      if (rawType) notes.push(`type "${rawType}" not recognised, defaulted to Information`);
      else notes.push('type defaulted to Information');
    }

    // ── Ownership ─────────────────────────────────────────────────────
    const rawOwnership = cell(row, header.map.ownership);
    let ownership = matchVocab(rawOwnership, ASSET_OWNERSHIP);
    if (!ownership && rawOwnership) {
      const alias = OWNERSHIP_ALIASES[normaliseHeader(rawOwnership)];
      if (alias) { ownership = alias; notes.push(`read "${rawOwnership}" as ${alias}`); }
    }
    const vendorName = cell(row, header.map.vendorName) || null;
    if (!ownership) {
      // A named supplier is itself evidence the asset is not held internally.
      ownership = vendorName ? 'ThirdParty' : 'Internal';
      if (vendorName) notes.push(`ownership inferred as ThirdParty from the supplier column`);
    }

    const classification = matchVocab(cell(row, header.map.classification), CLASSIFICATIONS) || 'Internal';

    // ── CIA ───────────────────────────────────────────────────────────
    const c = parseRating(cell(row, header.map.confidentiality));
    const iRating = parseRating(cell(row, header.map.integrity));
    const a = parseRating(cell(row, header.map.availability));
    for (const [labelText, r] of [['confidentiality', c], ['integrity', iRating], ['availability', a]] as const) {
      if (r.invalid) {
        issue = issue ?? `${labelText} is "${cell(row, header.map[labelText])}" — ratings must be 1 to 5, or one of Very low / Low / Medium / High / Very high.`;
      } else if (r.note) {
        notes.push(`${labelText} ${r.note}`);
      }
    }

    const derived = computeCriticality({
      confidentiality: c.value, integrity: iRating.value, availability: a.value,
    });

    // ── Blocking checks ───────────────────────────────────────────────
    if (!issue && (ownership === 'ThirdParty' || ownership === 'Shared') && !vendorName) {
      issue = 'Held by a third party but no supplier named. A third-party asset without a supplier cannot be managed.';
    }
    const dupOf = seenNames.get(name.toLowerCase());
    if (!issue && dupOf) {
      issue = `Duplicates row ${dupOf}, which has the same name.`;
    }
    seenNames.set(name.toLowerCase(), i + 1);

    // ── Confidence ────────────────────────────────────────────────────
    const ciaGiven = [header.map.confidentiality, header.map.integrity, header.map.availability]
      .every((x) => x !== undefined)
      && [c, iRating, a].every((r) => !r.note && !r.invalid);
    const confidence: AssetCandidate['confidence'] = issue
      ? 'Low'
      : ciaGiven && header.map.type !== undefined && notes.length === 0
        ? 'High'
        : 'Medium';

    candidates.push({
      rowNumber: i + 1,
      row: {
        name,
        type, ownership, classification,
        confidentiality: c.value, integrity: iRating.value, availability: a.value,
        description: cell(row, header.map.description) || null,
        location: cell(row, header.map.location) || null,
        vendorName,
        contractRef: cell(row, header.map.contractRef) || null,
        replacementValue: parseMoney(cell(row, header.map.replacementValue)),
        ownerEmail: cell(row, header.map.ownerEmail) || null,
        custodianEmail: cell(row, header.map.custodianEmail) || null,
        criticality: derived.criticality,
        criticalityTier: derived.criticalityTier,
      },
      confidence,
      issue,
      notes,
    });
  }

  if (candidates.length === 0) {
    warnings.push('A header row was found but no data rows follow it.');
  }

  return { candidates, headerRow: header.index + 1, columnsUsed, unmappedColumns, warnings };
}

/** The columns the importer understands, for the downloadable template. */
export const TEMPLATE_COLUMNS = [
  { header: 'Asset name', example: 'Core banking platform', required: true,
    help: 'The only mandatory column.' },
  { header: 'Type', example: 'Software', required: false,
    help: `One of ${ASSET_TYPES.join(', ')}. Common words like "database" or "hardware" are understood.` },
  { header: 'Ownership', example: 'Internal', required: false,
    help: 'Internal, ThirdParty or Shared. Inferred from the supplier column when left blank.' },
  { header: 'Classification', example: 'Restricted', required: false,
    help: CLASSIFICATIONS.join(', ') },
  { header: 'Confidentiality', example: '5', required: false,
    help: '1 to 5, or Very low / Low / Medium / High / Very high.' },
  { header: 'Integrity', example: '5', required: false, help: 'Same scale.' },
  { header: 'Availability', example: '4', required: false, help: 'Same scale.' },
  { header: 'Owner', example: 'risk.manager@omniops.me', required: false,
    help: 'Email of a user in this entity. Falls back to whoever runs the import.' },
  { header: 'Custodian', example: 'asset.owner@omniops.me', required: false,
    help: 'Email of whoever operates it day to day.' },
  { header: 'Location', example: 'Riyadh DC-1', required: false, help: 'Site, region or cloud.' },
  { header: 'Supplier', example: '', required: false,
    help: 'Required when ownership is ThirdParty or Shared.' },
  { header: 'Contract ref', example: '', required: false, help: 'For third-party assets.' },
  { header: 'Replacement value', example: '12000000', required: false,
    help: 'In SAR. Enables loss expectancy. Currency symbols and separators are stripped.' },
  { header: 'Description', example: 'Core deposit and lending ledger.', required: false, help: '' },
];
