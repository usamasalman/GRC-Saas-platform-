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

console.log(
  `standards-enablement: ${checks} assertions passed `
  + `(applicability: ${server.join(' | ')})`,
);
