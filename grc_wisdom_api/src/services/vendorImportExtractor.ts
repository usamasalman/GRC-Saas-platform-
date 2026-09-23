import { readSheetRows, normaliseHeader } from './spreadsheetExtractor';

/**
 * Reads vendor rows out of a spreadsheet.
 *
 * Every organisation that manages third-party risk already has a supplier list
 * in a spreadsheet. This reads it. The register is where downstream decisions
 * start — a mis-read data-access level makes a supplier look lower-risk than
 * they are and drives a lighter review cadence — so nothing is committed until
 * a human has looked at what the parser understood.
 */

export const VENDOR_CATEGORIES = [
  'CloudHosting', 'Software', 'ProfessionalServices', 'Outsourcing',
  'Logistics', 'Facilities', 'Staffing', 'Financial', 'Other',
] as const;

export const DATA_ACCESS_LEVELS = [
  'None', 'Metadata', 'Confidential', 'PersonalData', 'SensitivePersonalData',
] as const;

export type VendorRow = {
  name: string;
  legalName: string | null;
  category: string;
  description: string | null;
  country: string | null;
  dataLocation: string | null;
  dataAccess: string;
  hasSystemAccess: boolean;
  serviceCriticality: number;
  substitutability: number;
  contractRef: string | null;
  contractEnd: string | null;   // ISO date string or null
  noticePeriodDays: number | null;
  annualSpend: number | null;
  currency: string;
  ownerEmail: string | null;
};

export type VendorCandidate = {
  rowNumber: number;
  row: VendorRow;
  confidence: 'High' | 'Medium' | 'Low';
  /** Blocking — cannot be committed as it stands. */
  issue: string | null;
  /** Non-blocking: what the parser interpreted or assumed. */
  notes: string[];
};

export type VendorExtraction = {
  candidates: VendorCandidate[];
  headerRow: number | null;
  columnsUsed: Record<string, string>;
  unmappedColumns: string[];
  warnings: string[];
};

const HEADERS: Record<string, string[]> = {
  name: ['vendor name', 'supplier name', 'vendor', 'supplier', 'company', 'organisation',
    'organization', 'name', 'third party', 'third-party', 'provider'],
  legalName: ['legal name', 'legal entity', 'registered name', 'legal entity name', 'official name'],
  category: ['category', 'type', 'vendor type', 'supplier type', 'service type', 'kind'],
  description: ['description', 'details', 'service description', 'notes', 'remarks', 'purpose'],
  country: ['country', 'country of origin', 'supplier country', 'operating country', 'jurisdiction'],
  dataLocation: ['data location', 'data residency', 'data storage', 'data region',
    'storage location', 'hosted in', 'where data is stored'],
  dataAccess: ['data access', 'data access level', 'data classification', 'data sensitivity',
    'access level', 'data type', 'data tier'],
  hasSystemAccess: ['system access', 'has system access', 'direct access', 'system integration',
    'privileged access', 'access to systems'],
  serviceCriticality: ['criticality', 'service criticality', 'business criticality',
    'impact', 'importance', 'dependency level'],
  substitutability: ['substitutability', 'replaceability', 'lock-in', 'lock in',
    'ease of replacement', 'switching cost'],
  contractRef: ['contract ref', 'contract reference', 'contract', 'po number', 'po',
    'agreement ref', 'contract id'],
  contractEnd: ['contract end', 'expiry', 'contract expiry', 'end date', 'renewal date',
    'contract expiration', 'expires'],
  noticePeriodDays: ['notice period', 'notice days', 'termination notice', 'exit notice',
    'notice period (days)', 'notice (days)'],
  annualSpend: ['annual spend', 'spend', 'cost', 'annual cost', 'yearly spend',
    'annual fee', 'contract value', 'spend per year'],
  currency: ['currency', 'ccy', 'spend currency'],
  ownerEmail: ['owner', 'relationship owner', 'owner email', 'vendor owner',
    'supplier owner', 'accountable', 'responsible'],
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
    if (map.name !== undefined && (!best || score > best.score)) best = { index: r, map, score };
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
  cloud: 'CloudHosting', hosting: 'CloudHosting', 'cloud hosting': 'CloudHosting',
  saas: 'Software', paas: 'Software', software: 'Software', 'it software': 'Software',
  consulting: 'ProfessionalServices', advisory: 'ProfessionalServices',
  'professional services': 'ProfessionalServices', audit: 'ProfessionalServices',
  outsourcing: 'Outsourcing', bpo: 'Outsourcing', managed: 'Outsourcing',
  logistics: 'Logistics', courier: 'Logistics', shipping: 'Logistics',
  facilities: 'Facilities', maintenance: 'Facilities', cleaning: 'Facilities',
  staffing: 'Staffing', recruitment: 'Staffing', hr: 'Staffing',
  bank: 'Financial', banking: 'Financial', insurance: 'Financial', payment: 'Financial',
};

const DATA_ACCESS_ALIASES: Record<string, string> = {
  none: 'None', 'no data': 'None', 'no access': 'None',
  metadata: 'Metadata', 'meta data': 'Metadata',
  confidential: 'Confidential', internal: 'Confidential', sensitive: 'Confidential',
  personal: 'PersonalData', 'personal data': 'PersonalData', pii: 'PersonalData',
  'sensitive personal': 'SensitivePersonalData', spd: 'SensitivePersonalData',
  'sensitive personal data': 'SensitivePersonalData', 'special category': 'SensitivePersonalData',
};

function parseScale(raw: string, label: string): { value: number; note: string | null; invalid: boolean } {
  if (!raw) return { value: 3, note: `${label} defaulted to 3`, invalid: false };
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return { value: Math.round(n), note: null, invalid: false };
  const words: Record<string, number> = {
    'very low': 1, low: 2, medium: 3, moderate: 3, high: 4, 'very high': 5, critical: 5,
  };
  const key = normaliseHeader(raw);
  if (words[key] !== undefined) return { value: words[key], note: `read "${raw}" as ${words[key]}`, invalid: false };
  return { value: 3, note: null, invalid: true };
}

function parseBool(raw: string): boolean {
  const n = normaliseHeader(raw);
  return ['yes', 'true', '1', 'y', 'x', 'direct', 'integrated'].includes(n);
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  // Accept ISO, DD/MM/YYYY, MM/DD/YYYY, Excel serial (number)
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 40000 && serial < 90000) {
    // Excel date serial: days since 1900-01-01 (with the 1900 leap year bug)
    const d = new Date(Date.UTC(1900, 0, serial - 1));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const cleaned = raw.replace(/\s/g, '');
  // Try ISO first
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) return cleaned.slice(0, 10);
  // DD/MM/YYYY
  const dmy = cleaned.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

function parseMoney(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function extractVendorsFromSpreadsheet(
  buffer: Buffer,
  fileType: 'xlsx' | 'csv',
): Promise<VendorExtraction> {
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
        'No header row found. The sheet needs a row naming at least a vendor name column — '
        + '"Vendor name", "Supplier", "Company" or "Provider" are all recognised. '
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
  if (header.map.dataAccess === undefined) {
    warnings.push(
      'No "Data access" column found — every row will default to None. '
      + 'Add a "Data access" column so the importer can flag suppliers who handle personal data.',
    );
  }

  const candidates: VendorCandidate[] = [];
  const seenNames = new Map<string, number>();

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = cell(row, header.map.name);
    if (!name && row.every((v) => !cell([v], 0))) continue;

    const notes: string[] = [];
    let issue: string | null = null;

    if (!name) {
      candidates.push({
        rowNumber: lineOf(i),
        row: {
          name: '', legalName: null, category: 'Other', description: null,
          country: null, dataLocation: null, dataAccess: 'None', hasSystemAccess: false,
          serviceCriticality: 3, substitutability: 3,
          contractRef: null, contractEnd: null, noticePeriodDays: null,
          annualSpend: null, currency: 'SAR', ownerEmail: null,
        },
        confidence: 'Low',
        issue: 'No vendor name in this row.',
        notes: [],
      });
      continue;
    }

    // ── Category ──────────────────────────────────────────────────────
    const rawCat = cell(row, header.map.category);
    let category = matchVocab(rawCat, VENDOR_CATEGORIES);
    if (!category && rawCat) {
      const alias = CATEGORY_ALIASES[normaliseHeader(rawCat)];
      if (alias) { category = alias; notes.push(`read category "${rawCat}" as ${alias}`); }
    }
    if (!category) {
      category = 'Other';
      if (rawCat) notes.push(`category "${rawCat}" not recognised, defaulted to Other`);
    }

    // ── Data access ───────────────────────────────────────────────────
    const rawDA = cell(row, header.map.dataAccess);
    let dataAccess = matchVocab(rawDA, DATA_ACCESS_LEVELS);
    if (!dataAccess && rawDA) {
      const alias = DATA_ACCESS_ALIASES[normaliseHeader(rawDA)];
      if (alias) { dataAccess = alias; notes.push(`read data access "${rawDA}" as ${alias}`); }
    }
    if (!dataAccess) {
      dataAccess = 'None';
      if (rawDA) notes.push(`data access "${rawDA}" not recognised, defaulted to None`);
    }

    // ── Scales ────────────────────────────────────────────────────────
    const crit = parseScale(cell(row, header.map.serviceCriticality), 'service criticality');
    const sub = parseScale(cell(row, header.map.substitutability), 'substitutability');
    for (const [lbl, r] of [['service criticality', crit], ['substitutability', sub]] as const) {
      if (r.invalid) {
        issue = issue ?? `${lbl} is "${cell(row, header.map[lbl === 'service criticality' ? 'serviceCriticality' : 'substitutability'])}" — must be 1 to 5 or Very low / Low / Medium / High / Very high.`;
      } else if (r.note) {
        notes.push(r.note);
      }
    }

    // ── Contract end date ─────────────────────────────────────────────
    const rawDate = cell(row, header.map.contractEnd);
    const contractEnd = parseDate(rawDate);
    if (rawDate && !contractEnd) {
      notes.push(`contract end "${rawDate}" could not be read as a date — leave it blank or use YYYY-MM-DD`);
    }

    // ── Notice period ─────────────────────────────────────────────────
    const rawNotice = cell(row, header.map.noticePeriodDays);
    let noticePeriodDays: number | null = null;
    if (rawNotice) {
      const n = parseInt(rawNotice, 10);
      noticePeriodDays = Number.isFinite(n) && n > 0 ? n : null;
      if (!noticePeriodDays) notes.push(`notice period "${rawNotice}" not a whole number — ignored`);
    }

    // ── Blocking: duplicate name ──────────────────────────────────────
    const dupOf = seenNames.get(name.toLowerCase());
    if (!issue && dupOf !== undefined) {
      issue = `Duplicates row ${dupOf} which has the same vendor name.`;
    }
    seenNames.set(name.toLowerCase(), lineOf(i));

    // ── Confidence ────────────────────────────────────────────────────
    const hasKeyFields = header.map.dataAccess !== undefined && header.map.category !== undefined;
    const confidence: VendorCandidate['confidence'] = issue
      ? 'Low'
      : hasKeyFields && notes.length === 0
        ? 'High'
        : 'Medium';

    candidates.push({
      rowNumber: lineOf(i),
      row: {
        name,
        legalName: cell(row, header.map.legalName) || null,
        category,
        description: cell(row, header.map.description) || null,
        country: cell(row, header.map.country) || null,
        dataLocation: cell(row, header.map.dataLocation) || null,
        dataAccess,
        hasSystemAccess: parseBool(cell(row, header.map.hasSystemAccess)),
        serviceCriticality: crit.value,
        substitutability: sub.value,
        contractRef: cell(row, header.map.contractRef) || null,
        contractEnd,
        noticePeriodDays,
        annualSpend: parseMoney(cell(row, header.map.annualSpend)),
        currency: cell(row, header.map.currency) || 'SAR',
        ownerEmail: cell(row, header.map.ownerEmail) || null,
      },
      confidence,
      issue,
      notes,
    });
  }

  if (candidates.length === 0) {
    warnings.push('A header row was found but no data rows follow it.');
  }

  return { candidates, headerRow: lineOf(header.index), columnsUsed, unmappedColumns, warnings };
}

export const VENDOR_TEMPLATE_COLUMNS = [
  { header: 'Vendor name', example: 'Acme Cloud Ltd', required: true,
    help: 'The only mandatory column.' },
  { header: 'Legal name', example: 'Acme Cloud Limited', required: false,
    help: 'Registered legal entity name, if different from the trading name.' },
  { header: 'Category', example: 'CloudHosting', required: false,
    help: `One of ${VENDOR_CATEGORIES.join(', ')}. Common words like "cloud" or "consulting" are understood.` },
  { header: 'Data access', example: 'Confidential', required: false,
    help: `One of ${DATA_ACCESS_LEVELS.join(', ')}. The highest classification of data this supplier can reach.` },
  { header: 'System access', example: 'No', required: false,
    help: 'Yes or No. Whether the supplier can act on your systems directly.' },
  { header: 'Service criticality', example: '4', required: false,
    help: '1 to 5. How badly the organisation is hurt if this supplier stops.' },
  { header: 'Substitutability', example: '3', required: false,
    help: '1 to 5. How hard they would be to replace inside the notice period.' },
  { header: 'Country', example: 'Saudi Arabia', required: false,
    help: 'Country of operations or legal registration.' },
  { header: 'Data location', example: 'Riyadh, KSA', required: false,
    help: 'Where data is stored or processed. Relevant for PDPL cross-border transfer rules.' },
  { header: 'Contract ref', example: 'CTR-2024-0042', required: false,
    help: 'Your internal contract reference.' },
  { header: 'Contract end', example: '2026-12-31', required: false,
    help: 'YYYY-MM-DD preferred. DD/MM/YYYY is also accepted.' },
  { header: 'Notice period (days)', example: '90', required: false,
    help: 'How many days notice is required to exit the contract.' },
  { header: 'Annual spend', example: '250000', required: false,
    help: 'In the currency column. Currency symbols and separators are stripped.' },
  { header: 'Currency', example: 'SAR', required: false,
    help: 'Three-letter currency code. Defaults to SAR.' },
  { header: 'Owner', example: 'vendor.owner@company.me', required: false,
    help: 'Email of the relationship owner. Falls back to whoever runs the import.' },
  { header: 'Description', example: 'Cloud infrastructure provider for the platform.', required: false,
    help: 'Brief description of what this supplier provides.' },
];
