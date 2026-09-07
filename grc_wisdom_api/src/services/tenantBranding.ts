/**
 * How a tenant's identity reaches a rendered report.
 *
 * Pure: no Prisma, no request, no filesystem. The parts that can be quietly
 * wrong are colour handling and inheritance — a brand colour nobody can read,
 * or a branch silently rendering under the wrong organisation's name — and
 * both are arithmetic over strings, so neither needs Postgres to prove.
 *
 * Today src/services/renderPdf.ts and renderDocx.ts each hardcode the vendor's
 * own green, so every customer's report is issued in GRC Wisdom's livery. A
 * compliance report goes to a board and to an external auditor; carrying the
 * software supplier's branding instead of the organisation's makes it look like
 * a tool's output rather than the organisation's own record.
 */

// ─── Colour ─────────────────────────────────────────────────────────────────

/** The vendor's own, used when a tenant has expressed no preference. */
export const DEFAULT_BRAND = '#0F7A5A';

const HEX = /^#?([0-9a-fA-F]{6})$/;

/**
 * Normalise to `#RRGGBB`, or null if it is not a colour.
 *
 * Deliberately strict: three-digit shorthand, named colours and rgb() are all
 * refused rather than guessed at. This value is written into a PDF, a DOCX
 * theme and an XLSX fill, and each wants it in a different shape — one
 * canonical form parsed once is what keeps the three renderers from each
 * growing their own parser.
 */
export function normaliseHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = HEX.exec(String(input).trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

/** DOCX and XLSX both want the bare six digits, without the hash. */
export const bareHex = (hex: string): string => hex.replace('#', '');

/** XLSX wants ARGB — eight digits, alpha first. */
export const argbHex = (hex: string): string => `FF${bareHex(hex)}`;

/**
 * Relative luminance, per WCAG 2.1.
 *
 * Needed because a brand colour is used for headings on a white page, and some
 * real corporate palettes are pale enough to be unreadable there. Rejecting
 * those outright would be wrong — it is genuinely their colour — so instead the
 * renderer is told when to substitute ink for text while keeping the brand on
 * rules and fills, where contrast does not matter.
 */
export function luminance(hex: string): number {
  const n = parseInt(bareHex(hex), 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Below this, body text in the brand colour is not reliably readable on paper. */
export const MIN_TEXT_CONTRAST = 4.5;

export const PAPER = '#FFFFFF';
export const INK = '#0B1524';

/**
 * The colour to actually write text in.
 *
 * A pale corporate yellow is a legitimate brand and an illegitimate heading on
 * white. Rather than refusing the colour or rendering something nobody can
 * read, text falls back to ink and the brand keeps the rules and fills where
 * legibility is not at stake.
 */
export function readableOn(brand: string, background: string = PAPER): string {
  return contrastRatio(brand, background) >= MIN_TEXT_CONTRAST ? brand : INK;
}

/** Whether white or ink reads better ON the brand colour — for filled headers. */
export function inkOn(brand: string): string {
  return contrastRatio(PAPER, brand) >= contrastRatio(INK, brand) ? PAPER : INK;
}

// ─── Confidentiality marking ────────────────────────────────────────────────

/**
 * The marking stamped on every page.
 *
 * Matches the classification vocabulary the document and evidence modules
 * already use, so one word means one thing across the platform. A GRC report
 * routinely contains an organisation's unremediated weaknesses, and issuing one
 * with no marking at all is the omission that ends up quoted in a breach
 * post-mortem.
 */
export const REPORT_MARKINGS = [
  'Public', 'Internal', 'Confidential', 'Restricted',
] as const;
export type ReportMarking = (typeof REPORT_MARKINGS)[number];

export const DEFAULT_MARKING: ReportMarking = 'Confidential';

export function normaliseMarking(input: string | null | undefined): ReportMarking {
  return (REPORT_MARKINGS as readonly string[]).includes(String(input))
    ? (input as ReportMarking)
    : DEFAULT_MARKING;
}

// ─── Logo ───────────────────────────────────────────────────────────────────

/**
 * 512 KB. A logo is a small mark, not an illustration, and this is generous for
 * one. The cap matters because the bytes are read on every report render.
 */
export const MAX_LOGO_BYTES = 512 * 1024;

/**
 * Only raster formats pdfkit can actually embed.
 *
 * SVG is deliberately absent and it is the one people ask for. pdfkit cannot
 * embed it without a rasterising dependency, and an SVG is a document that can
 * carry script — the same reason evidence refuses it. A refusal naming the
 * accepted formats is better than a logo that silently fails to appear on the
 * cover of an issued report.
 */
export const LOGO_TYPES = ['image/png', 'image/jpeg'] as const;

export interface BrandingRefusal {
  code: 'LOGO_TOO_LARGE' | 'LOGO_TYPE' | 'BAD_COLOUR' | 'EMPTY_LOGO';
  message: string;
}

/** PNG and JPEG signatures — read from the bytes, never from the caller. */
export function logoType(head: readonly number[]): string | null {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  return null;
}

export function checkLogo(head: readonly number[], byteLength: number): BrandingRefusal | null {
  if (byteLength <= 0) return { code: 'EMPTY_LOGO', message: 'That file is empty.' };
  if (byteLength > MAX_LOGO_BYTES) {
    return {
      code: 'LOGO_TOO_LARGE',
      message: `A logo must be under ${Math.floor(MAX_LOGO_BYTES / 1024)} KB. `
        + 'It is read on every report render.',
    };
  }
  if (!logoType(head)) {
    return {
      code: 'LOGO_TYPE',
      message: 'A logo must be a PNG or JPEG. SVG cannot be embedded in a PDF here, '
        + 'and would carry script into an issued document.',
    };
  }
  return null;
}

// ─── What branding may and may not colour ───────────────────────────────────

/**
 * Colours a tenant can never override, and the reason the list exists.
 *
 * A report's warnings are not decoration. `reportDocument.draftNotice()` forces
 * a DRAFT banner onto every report for an engagement that is not Closed,
 * precisely so a working copy cannot circulate looking like an issued opinion.
 * If the brand colour reached that banner's fill, a tenant setting a pale
 * cream as their livery would render the warning invisible — and that is not
 * theming, it is falsifying a report.
 *
 * So branding colours chrome — headings, rules, the cover — and nothing that
 * carries a warning. The renderers keep their own constants for those, and this
 * list is what a test asserts against.
 */
export const UNBRANDABLE = ['draftNotice', 'warning', 'overdue', 'danger'] as const;

/** True when a colour is safe to use as the brand for chrome. Never for warnings. */
export function isBrandable(element: string): boolean {
  return !(UNBRANDABLE as readonly string[]).includes(element);
}

// ─── Resolution ─────────────────────────────────────────────────────────────

/** What a renderer needs to dress a report. Always fully populated. */
export interface ResolvedBranding {
  /** The organisation the report is issued in the name of. */
  displayName: string;
  brandColour: string;
  /** Brand colour where it is legible, ink where it is not. */
  textColour: string;
  marking: ReportMarking;
  footerText: string | null;
  /**
   * The logo to embed, resolved by the SAME walk as everything else.
   *
   * Returned here rather than looked up separately because a second walk is a
   * second chance to disagree — and a report carrying one organisation's name
   * above another's mark is worse than one carrying no mark at all.
   */
  logoKey: string | null;
  /** Tenant whose branding was used — not always the one being reported on. */
  sourceTenantId: string | null;
  /** True when nothing was configured and the vendor default is in use. */
  isDefault: boolean;
}

export interface BrandingRow {
  tenantId: string;
  displayName: string | null;
  brandColour: string | null;
  marking: string | null;
  footerText: string | null;
  logoKey: string | null;
  /**
   * False stops the walk at this tenant: its own row is the complete answer and
   * anything it left unset falls to the platform default rather than to its
   * parent's livery.
   *
   * Default true, because inheriting is what a branch of a group wants. False
   * exists for the acquired subsidiary that must not carry the acquirer's mark
   * before the deal is announced — a real situation, and one where inheriting
   * by default would leak a corporate transaction onto a report cover.
   */
  inheritsFromParent: boolean;
}

/**
 * Which tenant's branding applies to `tenantId`.
 *
 * A branch usually has none of its own and should render under its parent
 * organisation's identity rather than under the vendor's. Resolution walks UP
 * the materialized path and takes the nearest ancestor that has configured
 * something — so a group sets its livery once and every entity beneath inherits
 * it, while any entity may still override.
 *
 * The path is used rather than a recursive query on purpose: `Tenant.path` holds
 * the ancestry as slash-separated tenant IDs — verified against
 * utils/treeUtils.generateMaterializedPath, since the schema's own example
 * comment shows names and would send a reader looking for the wrong key — so the
 * whole chain is known without touching the database again. A walk issuing one
 * query per level would run on every report render, at the depth of the tree.
 *
 * `rows` may therefore be fetched in a single `where: { tenantId: { in: ids } }`.
 */
export function resolveBranding(
  tenantId: string,
  ancestryNearestFirst: readonly string[],
  rows: readonly BrandingRow[],
  fallbackName: string,
): ResolvedBranding {
  const byTenant = new Map(rows.map((r) => [r.tenantId, r]));

  // Nearest first: the tenant itself, then its parent, then upward. The first
  // row that actually configured something wins, field by field — a branch that
  // set only a footer still inherits its group's colour rather than dropping to
  // the vendor default for everything else.
  const walked: BrandingRow[] = [];
  for (const id of [tenantId, ...ancestryNearestFirst]) {
    const row = byTenant.get(id);
    if (row) {
      walked.push(row);
      // Stop climbing past a tenant that has opted out of inheritance. Checked
      // after pushing, so its own settings still apply — it is "my row is the
      // whole answer", not "I have no branding".
      if (!row.inheritsFromParent) break;
    }
  }
  const chain = walked;

  const pick = <K extends keyof BrandingRow>(field: K): BrandingRow[K] | null => {
    for (const row of chain) {
      const v = row[field];
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  };

  const colour = normaliseHex(pick('brandColour')) || DEFAULT_BRAND;
  const source = chain.find((r) => r.brandColour || r.displayName || r.logoKey);

  return {
    displayName: (pick('displayName') as string) || fallbackName,
    brandColour: colour,
    textColour: readableOn(colour),
    marking: normaliseMarking(pick('marking')),
    footerText: pick('footerText') as string | null,
    logoKey: pick('logoKey') as string | null,
    sourceTenantId: source ? source.tenantId : null,
    isDefault: chain.length === 0 || !source,
  };
}

/**
 * Ancestor ids from a materialized path, NEAREST FIRST.
 *
 * `Tenant.path` is `/<rootId>/<orgId>/<branchId>/` — IDs, not names. The last
 * segment is the tenant itself, so it is dropped: including it would make a
 * tenant its own ancestor and mask the case where it has none of its own.
 */
export function ancestorsOf(path: string | null | undefined): string[] {
  if (!path) return [];
  const segments = String(path).split('/').filter(Boolean);
  // Drop self, then reverse so the nearest ancestor is consulted first.
  return segments.slice(0, -1).reverse();
}

// ─── Generation options ─────────────────────────────────────────────────────

/**
 * Choices a caller may make about one export.
 *
 * Deliberately NOT passed to a renderer. A renderer that could decide to omit a
 * section is a renderer every report has to be tested against separately; these
 * are applied to the ReportDocument before it is handed over, so slice 7's
 * reports need no renderer change to gain them.
 */
export interface ReportOptions {
  /** Section titles to include. Empty or absent means all of them. */
  sections?: string[];
  /** Raise the marking for this export only. Never lowers it — see below. */
  marking?: string;
}

/**
 * The marking for one export, given the tenant's standing choice.
 *
 * A caller may make a single export MORE restricted — a copy going to a
 * regulator, say — but never less. Allowing a downgrade would let anyone
 * re-export a Restricted report as Public and hand it on with the marking that
 * makes it look distributable, which is precisely the control the marking
 * exists to be.
 *
 * An unrecognised value is ignored rather than refused: this arrives as a query
 * parameter, and failing an export because of a typo in a URL is worse than
 * quietly using the organisation's own setting.
 */
export function effectiveMarking(
  tenantMarking: string,
  requested: string | null | undefined,
): ReportMarking {
  const base = normaliseMarking(tenantMarking);
  if (!requested) return base;

  const order = REPORT_MARKINGS as readonly string[];
  const want = order.indexOf(String(requested));
  if (want === -1) return base;

  return want > order.indexOf(base) ? (order[want] as ReportMarking) : base;
}

/**
 * Keep only the sections a caller asked for.
 *
 * Matching is case-insensitive on the title, because these arrive from a query
 * string typed by a person. An empty request means everything: a report with no
 * sections at all is a cover page pretending to be a document, and is never
 * what "include nothing" was meant to say.
 */
export function selectSections<T extends { title: string }>(
  sections: readonly T[],
  wanted: readonly string[] | undefined,
): T[] {
  if (!wanted || wanted.length === 0) return [...sections];
  const want = new Set(wanted.map((w) => w.trim().toLowerCase()).filter(Boolean));
  if (want.size === 0) return [...sections];

  const kept = sections.filter((s) => want.has(s.title.toLowerCase()));
  // A filter that matched nothing is a filter nobody meant. Returning an empty
  // report would look like the data was empty rather than the request wrong.
  return kept.length > 0 ? kept : [...sections];
}
