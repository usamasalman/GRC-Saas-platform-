/**
 * Enabling a standard means what the screens say it means.
 *
 * Three separate bugs in this repository came from a string list on the server
 * drifting from the list on the screen that feeds it -- Offboarded for
 * Terminated, CapAssigned for CAPAssigned, Open/InProgress for an RCSA that
 * only ever had Draft/Launched/Closed. Each typechecked perfectly and failed at
 * runtime as a 400 the user could not act on.
 *
 * The applicability list is the same shape of risk: a select with three options
 * on one side, a validator on the other, no database constraint underneath, and
 * a column default of 'Full' that hides a wrong value rather than rejecting it.
 *
 * Also pinned here: the visibility filter on enable and disable. Without it,
 * naming another organisation's private framework planted a real enablement row
 * against it, invisible from both ends and blocking the owner from ever
 * deleting their own standard.
 *
 *   node scripts/verify/standards-enablement-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(__dirname, '..', '..', '..', 'src');

const grc = fs.readFileSync(path.join(API, 'controllers', 'grcController.ts'), 'utf8');
const authoring = fs.readFileSync(path.join(API, 'controllers', 'standardsAuthoringController.ts'), 'utf8');
const library = fs.readFileSync(path.join(WEB, 'pages', 'grc', 'StandardsLibrary.tsx'), 'utf8');
const routes = fs.readFileSync(path.join(API, 'routes', 'grcRoutes.ts'), 'utf8');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

// ── The server's list and the dialog's list are the same list ─────────────
const serverList = grc.match(/const APPLICABILITY = \[([^\]]*)\]/);
assert.ok(
  serverList,
  'APPLICABILITY not found in grcController. The server accepted any string for applicability, '
  + 'so a typo or an older client stored a value nothing can interpret.',
);
const server = [...serverList[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
ok(server.length >= 2, `expected the applicability values; found ${server.length}`);

const uiList = library.match(/options: \[([^\]]*)\]/);
assert.ok(uiList, 'the applicability select was not found in StandardsLibrary.tsx');
const ui = [...uiList[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

checks += 1;
assert.deepStrictEqual(
  ui, server,
  `The applicability options on the screen and the values the server accepts have drifted.\n`
  + `  screen: ${ui.join(', ')}\n  server: ${server.join(', ')}\n`
  + 'Every option the dialog offers must be one the server takes, or choosing it returns a 400 '
  + 'the user cannot act on.',
);

// ── The validator is actually applied ─────────────────────────────────────
ok(
  /APPLICABILITY\.includes\(/.test(grc),
  'APPLICABILITY is declared but never checked — declaring the list is not validating against it',
);

// ── The screen must not claim applicability changes anything ──────────────
// It does not: the value is stored on the enablement row and echoed back, and
// nothing in the API reads it. Saying the coverage report honours it is a claim
// users act on.
{
  const at = library.indexOf("name: 'applicability'");
  ok(at > 0, 'the applicability field was not found in StandardsLibrary.tsx');
  const field = library.slice(at, at + 900);
  const readers = [...grc.matchAll(/applicability/g)].length;
  ok(readers > 0, 'applicability vanished from grcController');
  checks += 1;
  assert.ok(
    !/coverage report reads this/.test(field),
    'The applicability help text says the coverage report reads this value. Nothing reads it: '
    + 'exportFrameworkCoverage spans every standard in scope regardless of enablement. Either make '
    + 'it true, or do not claim it.',
  );
}

// ── Enable and disable only act on a standard you can see ────────────────
for (const handler of ['enableStandard', 'disableStandard']) {
  const at = grc.indexOf(`export const ${handler} =`);
  ok(at > 0, `${handler} not found`);
  const body = grc.slice(at, at + 3000);

  const lookup = body.indexOf('prisma.standard.find');
  ok(lookup > 0, `${handler} does not look the standard up`);

  const call = body.slice(lookup, lookup + 400);
  checks += 1;
  assert.ok(
    /tenantId: null/.test(call) && /tenantId: \{ in: scope\.tenantIds \}/.test(call),
    `${handler} looks the standard up without a visibility filter. Naming another organisation's `
    + 'private framework must not be possible: filter on '
    + 'OR: [{ tenantId: null }, { tenantId: { in: scope.tenantIds } }], as listStandards does.',
  );

  // The scope must be resolved before the lookup uses it.
  checks += 1;
  assert.ok(
    body.indexOf('resolveTenantScope') < lookup,
    `${handler} uses scope.tenantIds before resolving the scope`,
  );
}

// ── The cross-tenant read is recorded ────────────────────────────────────
{
  const at = grc.indexOf('export const listStandards =');
  ok(at > 0, 'listStandards not found');
  const body = grc.slice(at, at + 1500);
  checks += 1;
  assert.ok(
    /auditCrossTenantRead\(/.test(body),
    'listStandards returns an enablement row for every tenant in scope, so on the control plane it '
    + 'discloses which frameworks every customer is assessed against. That read must be recorded.',
  );
}

// ── Refusing a deletion must name what is blocking it ────────────────────
{
  const at = authoring.indexOf('export const deleteStandard =');
  ok(at > 0, 'deleteStandard not found');
  const body = authoring.slice(at, at + 4000);
  const blk = body.indexOf('STANDARD_IN_USE');
  ok(blk > 0, 'the enablement refusal was not found in deleteStandard');
  checks += 1;
  assert.ok(
    /tenantStandardEnablement\.findMany/.test(body),
    'The deletion refusal gives a count without naming the entities. "Disable it everywhere" is a '
    + 'dead end when the reader cannot see what to clear — judgeDeletion exists because of exactly '
    + 'this failure.',
  );
}

// ── Refusals carry a code the caller can branch on ───────────────────────
// enable and disable are a symmetric pair used by the same screen, and they
// disagreed: disable's out-of-scope refusal carried code OUT_OF_SCOPE and
// enable's carried none, so a client that handled one silently fell through on
// the other.
for (const handler of ['enableStandard', 'disableStandard']) {
  const at = grc.indexOf(`export const ${handler} =`);
  const end = grc.indexOf('\nexport const ', at + 1);
  const body = grc.slice(at, end > 0 ? end : grc.length);

  const refusals = [...body.matchAll(/res\.status\((4\d\d)\)\.json\(\{([\s\S]{0,220}?)\}\)/g)];
  checks += 1;
  assert.ok(refusals.length >= 2, `${handler} has almost no refusal paths — did the body move?`);

  const codeless = refusals
    .filter((m) => !/code:/.test(m[2]))
    .map((m) => `${handler} ${m[1]}: ${m[2].replace(/\s+/g, ' ').trim().slice(0, 70)}`);
  checks += 1;
  assert.deepStrictEqual(
    codeless, [],
    'These refusals carry no machine-readable code, so a caller cannot tell them apart from each '
    + `other or from a real failure:\n${codeless.map((c) => `  ${c}`).join('\n')}`,
  );
}

// ── A lost race is not a server fault ────────────────────────────────────
// The duplicate check is a read followed by a write; @@unique([tenantId,
// standardId]) is what actually holds the line. Without this, a double-click or
// a fan-out running beside another operator answered "Failed to enable
// standard" for a pairing that does exist.
{
  const at = grc.indexOf('export const enableStandard =');
  const end = grc.indexOf('\nexport const ', at + 1);
  const body = grc.slice(at, end);
  const cat = body.indexOf('} catch');
  ok(cat > 0, 'enableStandard has no catch block');
  const onFailure = body.slice(cat);
  checks += 1;
  assert.ok(
    /P2002/.test(onFailure),
    'enableStandard must map the unique-constraint violation to 409, not 500. Losing a race to '
    + 'another writer produced the row the caller wanted; saying "failed" is wrong and unactionable.',
  );
  checks += 1;
  assert.ok(
    /StaleTenantError/.test(onFailure),
    'enableStandard must answer 401 when the caller\'s tenant is gone. resolveTenantScope throws '
    + 'StaleTenantError precisely so the user is told to sign in again rather than shown a 500.',
  );
}

// ── The screens must not claim enablement does more than it does ─────────
// Enablement is recorded, displayed, and read by nothing else. The claims that
// were on this screen — that enabling brings clauses into scope, that they then
// appear in the coverage report, that they become mappable — are all three
// false: listClauses filters on who OWNS the standard, exportFrameworkCoverage
// spans every standard in scope, and clause mapping checks ownership too.
//
// If enablement is ever made load-bearing, delete the offending phrase from
// this list in the same change that makes it true. Until then a claim here is
// the same defect as an invented row, and is acted on the same way.
{
  const clauseFiltersOnEnablement = /tenantStandardEnablement|enablements:/.test(
    fs.readFileSync(path.join(API, 'controllers', 'controlAuthoringController.ts'), 'utf8'),
  );
  const coverageFiltersOnEnablement = /tenantStandardEnablement/.test(
    fs.readFileSync(path.join(API, 'controllers', 'reportController.ts'), 'utf8'),
  );

  const FALSE_CLAIMS = [
    "brings the standard's clauses into this entity's scope",
    'bring its clauses into scope',
    'coverage report reads this',
    'appear in the coverage report',
  ];

  // Comments are prose, not claims. The comment recording what the copy used
  // to say quotes the phrases verbatim, and quoting a defect is how it stays
  // understood. Only what renders counts.
  const rendered = library
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const found = FALSE_CLAIMS.filter((c) => rendered.includes(c));
  checks += 1;
  if (clauseFiltersOnEnablement && coverageFiltersOnEnablement) {
    // The behaviour arrived. The claims are now allowed — and this branch is
    // the reminder to prune the list above.
    assert.ok(true);
  } else {
    assert.deepStrictEqual(
      found, [],
      'StandardsLibrary claims enablement changes what an entity can see. It does not: '
      + `listClauses filters on standard ownership${clauseFiltersOnEnablement ? '' : ' (still)'} and `
      + `exportFrameworkCoverage spans every standard in scope${coverageFiltersOnEnablement ? '' : ' (still)'}.\n`
      + `${found.map((f) => `  "${f}"`).join('\n')}\n`
      + 'Make it true, or do not say it.',
    );
  }
}

// ── The estate routes must be declared before /standards/:id ─────────────
// Express matches in declaration order. Declared after the parameterised path,
// 'enablement-matrix' and 'bulk-enable' are read as standard ids and reach
// updateStandard and deleteStandard instead — which for bulk-disable means a
// DELETE handler running against a standard named "bulk-disable". The control
// routes carry a comment about this exact trap; it is cheap to make it a test.
{
  const literal = [
    "router.get('/standards/enablement-matrix',",
    "router.post('/standards/bulk-enable',",
    "router.post('/standards/bulk-disable',",
  ];
  const param = [
    "router.patch('/standards/:id',",
    "router.delete('/standards/:id',",
  ];

  const shadowed = [];
  for (const lit of literal) {
    const at = routes.indexOf(lit);
    checks += 1;
    assert.ok(at >= 0, `${lit} not found in grcRoutes.ts`);
    for (const par of param) {
      const pat = routes.indexOf(par);
      if (pat >= 0 && pat < at) shadowed.push(`${lit} is declared after ${par}`);
    }
  }
  checks += 1;
  assert.deepStrictEqual(
    shadowed, [],
    `These literal routes are shadowed by a parameterised one declared above them:\n${
      shadowed.map((x) => `  ${x}`).join('\n')}\n`
    + 'Move them above it, or Express will read the literal segment as an id.',
  );
}

// ── The bulk writes are guarded like the single ones ─────────────────────
{
  const ungated = ["router.post('/standards/bulk-enable',", "router.post('/standards/bulk-disable',"]
    .filter((r) => {
      const at = routes.indexOf(r);
      if (at < 0) return true;
      const line = routes.slice(at, routes.indexOf('\n', at));
      return !/requireCapability\(CAP\.ENABLE_STANDARD\)/.test(line);
    });
  checks += 1;
  assert.deepStrictEqual(
    ungated, [],
    'A bulk write must carry the same capability as the single write it multiplies:\n'
    + `${ungated.map((u) => `  ${u}`).join('\n')}`,
  );
}

// ── The admission decision is not in the controller ──────────────────────
// It is planEnablement, which is pure and exercised case by case in
// enablement-plan-test.js. A controller that decides for itself cannot be
// tested without Postgres, and this repository's CI has none.
{
  const ctrl = fs.readFileSync(
    path.join(API, 'controllers', 'standardEnablementController.ts'), 'utf8',
  );
  checks += 1;
  assert.ok(
    /planEnablement\(/.test(ctrl),
    'standardEnablementController must delegate the decision to planEnablement',
  );

  const svc = fs.readFileSync(path.join(API, 'services', 'standardEnablement.ts'), 'utf8');
  checks += 1;
  assert.ok(
    !/from '\.\.\/db'/.test(svc) && !/prisma\./.test(svc),
    'standardEnablement must stay pure — importing prisma makes it untestable without a database',
  );

  // Per-tenant transactions, because the audit chain is per tenant. One
  // transaction over the whole batch would let one entity's failure roll back
  // another entity's committed and audited change.
  checks += 1;
  assert.ok(
    /writeAudit\(tx, \{[\s\S]{0,120}tenantId,/.test(ctrl),
    'the bulk audit rows must be keyed to the target tenant, inside the transaction. Stamping the '
    + "operator's tenant makes the trail unreadable from the side that needs it.",
  );
  const batched = /\$transaction\(async \(tx\) => \{[\s\S]{0,400}for \(const \[tenantId/.test(ctrl);
  checks += 1;
  assert.ok(
    !batched,
    'the loop over tenants must be OUTSIDE the transaction, not inside one covering the whole batch',
  );
}

console.log(
  `standards-enablement: ${checks} assertions passed `
  + `(applicability: ${server.join(' | ')})`,
);
