/**
 * The deletion guard, and the status names it is written against.
 *
 * Two things are checked here, and the second is the reason this file exists.
 *
 * The first is judgeDeletion itself -- pure, so it runs with no database.
 *
 * The second is that every status string the delete controllers refuse on is a
 * status that actually exists. Those are plain String columns, so a typo
 * typechecks perfectly and simply never matches: the guard silently stops
 * guarding and a vendor with a signed contract becomes deletable. Writing this
 * file caught exactly that -- deleteVendor refused on 'Offboarded', which is
 * not one of the five vendor statuses, and deleteIssue refused on 'CapAssigned'
 * and 'AwaitingClosure' against real values of 'CAPAssigned' and
 * 'PendingClosure'.
 *
 *   node scripts/verify/record-deletion-test.js
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');

const { judgeDeletion, describeDependants } = require(path.join(DIST, 'services/recordDeletion.js'));

let checks = 0;
const is = (actual, expected, what) => {
  checks += 1;
  assert.deepStrictEqual(actual, expected, `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};
const ok = (cond, what) => {
  checks += 1;
  assert.ok(cond, what);
};

// ── The guard ───────────────────────────────────────────────────────────────

{
  const v = judgeDeletion({
    recordLabel: 'risk',
    dependants: [{ label: 'treatments', count: 0 }, { label: 'links', count: 0 }],
    alternative: 'Close it instead.',
  });
  is(v.allowed, true, 'a record with nothing attached may be deleted');
}

{
  const v = judgeDeletion({
    recordLabel: 'risk',
    dependants: [{ label: 'treatment actions', count: 3 }, { label: 'linked controls', count: 0 }],
    alternative: 'Close it instead.',
  });
  is(v.allowed, false, 'one dependant is enough to refuse');
  is(v.code, 'RECORD_HAS_HISTORY', 'refusal is machine-readable');
  is(v.dependants, [{ label: 'treatment actions', count: 3 }],
    'only the non-empty dependants are reported — "0 linked controls" is noise in a refusal');
  ok(v.message.includes('3 treatment actions'), 'the refusal names what is attached');
  ok(v.message.includes('Close it instead.'), 'and what to do instead');
  ok(v.alternative.length > 0, 'the alternative is always populated on a refusal');
}

{
  const v = judgeDeletion({
    recordLabel: 'risk',
    status: 'Accepted',
    forbiddenStatuses: ['Accepted', 'Closed'],
    dependants: [],
    alternative: 'Close it instead.',
  });
  is(v.allowed, false, 'a formally accepted record is refused even with nothing attached');
  is(v.code, 'RECORD_STATUS_FORBIDS_DELETE', 'and says the status is why, not the history');
}

{
  const v = judgeDeletion({
    recordLabel: 'risk',
    status: 'Open',
    forbiddenStatuses: ['Accepted', 'Closed'],
    dependants: [],
    alternative: 'Close it instead.',
  });
  is(v.allowed, true, 'a permitted status with no dependants passes');
}

is(describeDependants([{ label: 'treatments', count: 2 }]), '2 treatments', 'one dependant reads plainly');
is(describeDependants([{ label: 'treatments', count: 2 }, { label: 'links', count: 1 }]),
  '2 treatments and 1 links', 'two are joined with "and"');
is(describeDependants([
  { label: 'treatments', count: 2 }, { label: 'links', count: 1 }, { label: 'assets', count: 4 },
]), '2 treatments, 1 links and 4 assets', 'three use commas then "and"');
is(describeDependants([{ label: 'treatments', count: 0 }]), '', 'nothing attached renders empty');

// ── Every refused status must be a real status ──────────────────────────────
//
// Read the forbiddenStatuses literal out of each controller and check each
// value against the constant list that defines that domain's statuses.

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Pull the string literals out of `forbiddenStatuses: [ ... ]`. */
function forbiddenIn(source, controllerFn) {
  const start = source.indexOf(`export const ${controllerFn}`);
  assert.ok(start >= 0, `${controllerFn} not found`);
  const body = source.slice(start);
  const m = body.match(/forbiddenStatuses:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return (m[1].match(/'([^']+)'/g) || []).map((q) => q.slice(1, -1));
}

/** Pull the string literals out of `export const NAME = [ ... ]`. */
function constList(source, name) {
  const m = source.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  assert.ok(m, `${name} not found`);
  return (m[1].match(/'([^']+)'/g) || []).map((q) => q.slice(1, -1));
}

const CASES = [
  {
    what: 'deleteRisk',
    forbidden: forbiddenIn(read('controllers/riskController.ts'), 'deleteRisk'),
    allowed: constList(read('services/riskLifecycle.ts'), 'RISK_STATUSES'),
  },
  {
    what: 'deleteAsset',
    forbidden: forbiddenIn(read('controllers/assetController.ts'), 'deleteAsset'),
    allowed: constList(read('services/assetRiskScoring.ts'), 'ASSET_STATUSES'),
  },
  {
    what: 'deleteVendor',
    forbidden: forbiddenIn(read('controllers/vendorController.ts'), 'deleteVendor'),
    allowed: constList(read('services/vendorRisk.ts'), 'VENDOR_STATUSES'),
  },
  {
    what: 'deleteSharedService',
    forbidden: forbiddenIn(read('controllers/sharedServiceController.ts'), 'deleteSharedService'),
    allowed: constList(read('controllers/sharedServiceController.ts'), 'SERVICE_STATUSES'),
  },
];

for (const c of CASES) {
  ok(c.forbidden.length > 0, `${c.what} declares at least one forbidden status`);
  for (const st of c.forbidden) {
    checks += 1;
    assert.ok(
      c.allowed.includes(st),
      `${c.what} refuses on status "${st}", which is not one of [${c.allowed.join(', ')}]. `
      + 'A status that cannot occur is a guard that never fires.',
    );
  }
}

// deleteLossEvent's statuses are not in a shared constant; pin them against the
// values the controller itself writes.
{
  const src = read('controllers/lossEventController.ts');
  const forbidden = forbiddenIn(src, 'deleteLossEvent');
  const written = (src.match(/status: '([A-Za-z]+)'/g) || []).map((q) => q.split("'")[1]);
  for (const st of forbidden) {
    checks += 1;
    assert.ok(
      written.includes(st) || st === 'Closed',
      `deleteLossEvent refuses on "${st}", which the controller never sets`,
    );
  }
}

// deleteIssue guards with the AWAITING_RESPONSE allow-list instead of a
// forbidden list. Confirm that is still what it does — swapping it back to an
// enumerated forbid-list is the regression this catches.
{
  const src = read('controllers/issueController.ts');
  const start = src.indexOf('export const deleteIssue');
  ok(start >= 0, 'deleteIssue exists');
  const body = src.slice(start);
  ok(
    body.includes('AWAITING_RESPONSE.includes(issue.status)'),
    'deleteIssue guards on the AWAITING_RESPONSE allow-list, so a status added later is refused by default',
  );
  is(forbiddenIn(src, 'deleteIssue'), [],
    'and does not also carry an enumerated forbidden list that could drift from the real statuses');
}

console.log(`record-deletion: ${checks} assertions passed`);
