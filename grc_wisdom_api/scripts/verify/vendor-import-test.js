/**
 * A supplier list can be imported, the way an asset list already could.
 *
 * Assets, risks and frameworks each had the whole staged pipeline -- a
 * template that downloads, a file that stages with per-row problems shown, and
 * clean rows that commit. Suppliers had none of it, so the only way onto the
 * third-party register was one form at a time, while every organisation that
 * manages third-party risk already keeps the list in a spreadsheet.
 *
 * The one thing that had to be said differently: a supplier's tier drives the
 * assessment cadence and the exit-planning date. A column asserting "Tier 3"
 * would let the spreadsheet decide how often its own supplier gets reviewed,
 * so the tier is computed on commit from the same computeTier the manual form
 * uses and is never read from the file.
 *
 *   node scripts/verify/vendor-import-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(API, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const extractorSrc = read(API, 'services', 'vendorImportExtractor.ts');
const ctrl = code(read(API, 'controllers', 'vendorImportController.ts'));
const routes = read(API, 'routes', 'grcRoutes.ts');
const schema = read(API, '..', 'prisma', 'schema.prisma');
const screen = code(read(WEB, 'pages', 'grc', 'vendor', 'VendorImport.tsx'));
const register = code(read(WEB, 'pages', 'grc', 'VendorRegister.tsx'));
const panel = read(WEB, 'pages', 'grc', 'shared', 'BulkImportPanel.tsx');
const deploy = read(WEB, '..', '.github', 'workflows', 'deploy.yml');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

const {
  VENDOR_CATEGORIES, DATA_ACCESS_LEVELS, VENDOR_TEMPLATE_COLUMNS,
} = require('../../dist/services/vendorImportExtractor');

// ─── The extractor ──────────────────────────────────────────────────────────
{
  ok(
    !/from ['"]@prisma\/client['"]|require\(['"]@prisma/.test(extractorSrc)
    && !/from ['"]\.\.\/db['"]/.test(extractorSrc),
    'reading a spreadsheet must not need a database',
  );
  ok(VENDOR_CATEGORIES.length > 1 && DATA_ACCESS_LEVELS.length > 1, 'the vocabularies are defined');
  ok(
    VENDOR_TEMPLATE_COLUMNS.every((c) => c.header && c.help),
    'every template column explains itself. A filled-in template beats documentation nobody reads',
  );
  ok(
    VENDOR_TEMPLATE_COLUMNS.filter((c) => c.required).length >= 1,
    'and at least one column is required, so an empty file is refused rather than staged',
  );
}

// ─── The staged pipeline, reusing what already existed ──────────────────────
{
  ok(
    /kind: KIND/.test(ctrl) && /const KIND = 'Vendor'/.test(ctrl),
    'the import reuses FrameworkImport with a kind discriminator rather than adding a table. '
    + 'That reuse is why this packet needed no migration',
  );
  ok(
    !/model VendorImport/.test(schema),
    'and no vendor-specific staging model was added',
  );

  for (const [fn, why] of [
    ['downloadVendorTemplate', 'a template downloads'],
    ['uploadVendorImport', 'a file stages'],
    ['listVendorImports', 'staged imports are listed'],
    ['getVendorImport', 'one can be opened with its rows'],
    ['reviewVendorCandidate', 'a row can be corrected'],
    ['acceptCleanVendorRows', 'clean rows can be accepted together'],
    ['commitVendorImport', 'accepted rows commit'],
    ['discardVendorImport', 'and a staged import can be thrown away'],
  ]) {
    ok(new RegExp(`export const ${fn}\\b`).test(ctrl), `${why} (${fn})`);
  }
}

// ─── Nothing is committed without review ────────────────────────────────────
{
  const commit = ctrl.slice(ctrl.indexOf('export const commitVendorImport'));
  ok(
    /candidates: \{ where: \{ status: 'Accepted' \} \}/.test(commit),
    'THE PACKET: commit takes only rows somebody accepted, never everything staged',
  );
  ok(
    /code: 'NOTHING_ACCEPTED'/.test(commit),
    'and committing with nothing accepted is refused with something a person can act on',
  );

  const acceptClean = ctrl.slice(ctrl.indexOf('export const acceptCleanVendorRows'));
  ok(
    /status: 'Pending', issue: null/.test(acceptClean),
    'accept-clean takes only rows with no issue. A blocked row stays blocked — accepting '
    + 'everything at once is the habit the staging step exists to break',
  );

  ok(
    /status: 'Extracted'/.test(ctrl),
    'and a committed or discarded import cannot be edited again',
  );
}

// ─── The tier is computed, not read ─────────────────────────────────────────
{
  const commit = ctrl.slice(ctrl.indexOf('export const commitVendorImport'));
  ok(
    /computeTier\(\{/.test(commit),
    'THE PACKET: the tier is derived on commit from the same function the manual form uses',
  );
  ok(
    /tier: tiering\.tier,/.test(commit) && /tierScore: tiering\.tierScore,/.test(commit),
    'and the stored tier IS the computed one. Asserting only that the file is not read lets '
    + 'any other source of a tier through — a spreadsheet column saying "Tier 3" would decide '
    + 'how often its own supplier gets reviewed',
  );
  ok(
    !/\(row as any\)\.tier|row\.tier/.test(commit),
    'and the row is not consulted for one',
  );
  ok(
    /cadenceForTier\(tiering\.tier\)/.test(commit) && /nextAssessmentFrom\(cadence\)/.test(commit),
    'the assessment cadence and the next due date follow from the tier, as they do everywhere else',
  );
}

// ─── A supplier cannot exist without an owner ───────────────────────────────
{
  const vendor = schema.slice(schema.indexOf('model Vendor {'));
  ok(
    /relationshipOwnerId String\b(?!\?)/.test(vendor.slice(0, vendor.indexOf('\n}'))),
    'Vendor.relationshipOwnerId is required — somebody is accountable for every supplier',
  );

  const commit = ctrl.slice(ctrl.indexOf('export const commitVendorImport'));
  ok(
    /ownerByEmail/.test(commit) && /status: 'Active'/.test(commit),
    'so the importer resolves owner emails against ACTIVE users',
  );
  ok(
    /a supplier cannot exist without somebody accountable for it/.test(commit),
    'a row naming no owner at all says WHY one is needed, rather than just "skipped"',
  );
  ok(
    /no active user with the email/.test(commit),
    'and a row naming nobody the register recognises is skipped BY NAME rather than quietly '
    + 'handed to whoever ran the import',
  );
  const auditPayload = commit.slice(commit.indexOf("action: 'VENDOR_IMPORT_COMMITTED'"));
  ok(
    /skipped,/.test(auditPayload.slice(0, auditPayload.indexOf('});'))) && /refs: created/.test(commit),
    'the audit entry names what was created and what was skipped. A row that did not become '
    + 'a supplier is the thing somebody comes looking for',
  );
  ok(
    /if \(taken\.has\(name\.toLowerCase\(\)\)\) \{/.test(commit),
    'and importing the same list twice does not double the register. Pinned to the CHECK, '
    + 'not the message beside it — the message survives the guard being removed',
  );
}

// ─── Routes ─────────────────────────────────────────────────────────────────
{
  ok(
    /router\.get\('\/vendors\/import\/template', downloadVendorTemplate\)/.test(routes),
    'the template is downloadable',
  );
  ok(
    /router\.get\('\/vendors\/imports', listVendorImports\)/.test(routes),
    'and staged imports are listable — the handler existing is not the same as it being routed',
  );
  ok(
    /router\.get\('\/vendors\/imports\/:id', getVendorImport\)/.test(routes),
    'as is opening one',
  );
  for (const [path_, fn] of [
    ["'/vendors/import'", 'uploadVendorImport'],
    ["'/vendors/imports/:id/accept-clean'", 'acceptCleanVendorRows'],
    ["'/vendors/imports/:id/commit'", 'commitVendorImport'],
    ["'/vendors/imports/:id/discard'", 'discardVendorImport'],
  ]) {
    ok(
      new RegExp(`router\\.post\\(${path_.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, MAY_MANAGE_VENDORS, ${fn}\\)`).test(routes),
      `${fn} carries the vendor capability — importing a supplier list is creating suppliers`,
    );
  }
  ok(
    /router\.patch\('\/vendor-candidates\/:candidateId', MAY_MANAGE_VENDORS, reviewVendorCandidate\)/.test(routes),
    'and the candidate route matches the shape the shared panel builds: '
    + '/api/grc/{candidateResource}/{id}, as assets and risks already do',
  );

  // Literals before the wildcard, or '/vendors/imports' is read as a vendor id.
  //
  // Compared on comment-stripped source: the comment explaining the rule names
  // '/vendors/:id' above the routes it is about, so the raw text would put the
  // wildcard first and fail a correctly ordered file.
  const routeCode = code(routes);
  ok(
    routeCode.indexOf("'/vendors/imports'") < routeCode.indexOf("'/vendors/:id'"),
    "'/vendors/imports' must be registered before '/vendors/:id'",
  );
  ok(
    routeCode.indexOf("'/vendors/import/template'") < routeCode.indexOf("'/vendors/:id'"),
    "and so must '/vendors/import/template'",
  );
}

// ─── The screen ─────────────────────────────────────────────────────────────
{
  ok(
    /resource: 'vendors'/.test(screen) && /candidateResource: 'vendor-candidates'/.test(screen),
    'the screen is configured for the shared panel rather than reimplementing it',
  );
  ok(
    /templateFileName: 'Supplier_import_template\.xlsx'/.test(screen),
    'and asks for the file the server actually sends',
  );
  ok(
    /Content-Disposition', 'attachment; filename="Supplier_import_template\.xlsx"'/.test(ctrl),
    'which the controller names the same way — a mismatch here saves a file nobody can find again',
  );
  ok(
    /<VendorImport onCommitted=\{load\}/.test(register),
    'the panel is mounted on the register and refreshes it on commit, as the asset one is',
  );
  ok(
    /tab === 'import'/.test(register),
    'and reachable from a tab',
  );
  ok(
    /none — will be skipped/.test(screen),
    'the owner COLUMN warns on the row itself, not only in the signal beneath it — that is '
    + 'the cell somebody scans before deciding to commit',
  );
  ok(
    /this row will be skipped on commit/.test(screen),
    'and the signal repeats it where the parser verdict is read',
  );
  ok(
    /Tier 3/.test(screen),
    'and the caveat says plainly that the file cannot assert a tier',
  );

  // The panel's own contract, so a config change cannot drift from it.
  ok(
    /candidateResource: string;/.test(panel) && /renderSignal\?:/.test(panel),
    'the shared panel still takes the fields this config supplies',
  );

  ok(
    /vendor-import-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next packet can delete',
  );
}

console.log(
  `vendor-import: ${checks} assertions passed `
  + `(${VENDOR_TEMPLATE_COLUMNS.length} template columns, `
  + `${VENDOR_CATEGORIES.length} categories, ${DATA_ACCESS_LEVELS.length} access levels)`,
);
