/**
 * Delivery projects — the pure logic, with no database.
 *
 * Schedule arithmetic and the access boundary are the two parts of slice 1 that
 * can be wrong in a way nobody notices: a percentage that looks plausible, or a
 * `where` clause that returns one row too many. Both are pure functions, so
 * neither needs Postgres to prove.
 *
 * The HTTP round-trip is covered separately by project-delivery-test.js, which
 * does need a database.
 *
 *   npm run build && node scripts/verify/project-logic-test.js
 */
const {
  daysBetween, schedule, derivedStatus, parseFrameworks, AT_RISK_DRIFT_POINTS,
} = require('../../dist/services/projectSchedule');
const {
  projectWhere, canWriteProject, canReadProject, sideOf,
} = require('../../dist/services/projectAccess');

let pass = 0, fail = 0;
const ok = (l, d = '') => { pass++; console.log(`   PASS  ${l}${d ? ` — ${d}` : ''}`); };
const bad = (l, d = '') => { fail++; console.log(`   FAIL  ${l}${d ? ` — ${d}` : ''}`); };
const eq = (label, actual, expected) =>
  actual === expected ? ok(label, String(actual)) : bad(label, `got ${actual}, expected ${expected}`);

const D = (s) => new Date(s);
const scope = (kind, ids) => ({ kind, tenantIds: ids, isCrossTenant: false, ownTenantId: ids[0] });

console.log('\n─── Delivery projects · pure logic ───\n');

// ── 1. Day arithmetic ───────────────────────────────────────────────────────
console.log('1. Day arithmetic');

eq('a 90-day span measures 90 days', daysBetween(D('2026-01-01'), D('2026-04-01')), 90);
eq('the same instant is zero days', daysBetween(D('2026-01-01'), D('2026-01-01')), 0);
// Never negative: a backwards pair is a data problem, not a negative duration.
eq('a backwards span clamps to zero', daysBetween(D('2026-04-01'), D('2026-01-01')), 0);

// ── 2. Schedule figures ─────────────────────────────────────────────────────
console.log('\n2. Schedule');

const mid = schedule(
  { startDate: D('2026-01-01'), targetEndDate: D('2026-04-01'), actualEndDate: null, status: 'Active' },
  D('2026-01-31'),
);
eq('total duration', mid.totalDays, 90);
eq('elapsed at day 30', mid.elapsedDays, 30);
eq('remaining at day 30', mid.remainingDays, 60);
eq('elapsed percent at day 30', mid.elapsedPercent, 33);
mid.overdue === false ? ok('not overdue before the target date') : bad('not overdue before the target date');

const late = schedule(
  { startDate: D('2026-01-01'), targetEndDate: D('2026-04-01'), actualEndDate: null, status: 'Active' },
  D('2026-04-15'),
);
late.overdue === true ? ok('overdue past the target date') : bad('overdue past the target date');
eq('days overdue counted from the target', late.daysOverdue, 14);
// Elapsed is capped at the planned duration; otherwise a late project reports
// more than 100% of its own calendar consumed, which reads as nonsense.
eq('elapsed caps at the total', late.elapsedDays, 90);
eq('remaining floors at zero', late.remainingDays, 0);

const closed = schedule(
  { startDate: D('2026-01-01'), targetEndDate: D('2026-04-01'), actualEndDate: D('2026-03-01'), status: 'Closed' },
  D('2026-12-31'),
);
// A finished project stops ageing. Without this it keeps accruing elapsed days
// for as long as it sits in the list.
eq('a closed project stops at its actual end', closed.elapsedDays, 59);
closed.overdue === false ? ok('a closed project is never overdue') : bad('a closed project is never overdue');

const cancelled = schedule(
  { startDate: D('2026-01-01'), targetEndDate: D('2026-04-01'), actualEndDate: null, status: 'Cancelled' },
  D('2026-06-01'),
);
cancelled.overdue === false
  ? ok('a cancelled project is not reported overdue')
  : bad('a cancelled project is not reported overdue');

const zero = schedule(
  { startDate: D('2026-01-01'), targetEndDate: D('2026-01-01'), actualEndDate: null, status: 'Active' },
  D('2026-01-01'),
);
eq('a zero-length project is 100% elapsed, not a division by zero', zero.elapsedPercent, 100);

// ── 3. Derived delivery status ──────────────────────────────────────────────
console.log('\n3. Derived status');

const at = (elapsedPercent, overdue = false) => ({
  totalDays: 100, elapsedDays: elapsedPercent, remainingDays: 100 - elapsedPercent,
  elapsedPercent, overdue, daysOverdue: overdue ? 5 : 0,
});

eq('a draft project is Not started',
   derivedStatus({ status: 'Draft', reportedProgress: 0 }, at(10)), 'NotStarted');
eq('a closed project is Completed',
   derivedStatus({ status: 'Closed', reportedProgress: 100 }, at(100)), 'Completed');
eq('a cancelled project is not counted as delivered',
   derivedStatus({ status: 'Cancelled', reportedProgress: 40 }, at(80)), 'NotStarted');
eq('an overdue project is Delayed regardless of progress',
   derivedStatus({ status: 'Active', reportedProgress: 95 }, at(100, true)), 'Delayed');
eq('work keeping pace with the calendar is On track',
   derivedStatus({ status: 'Active', reportedProgress: 50 }, at(50)), 'OnTrack');
eq('work ahead of the calendar is On track',
   derivedStatus({ status: 'Active', reportedProgress: 80 }, at(50)), 'OnTrack');

// The threshold itself, tested at its two edges rather than somewhere safe in
// the middle — off-by-one here silently changes what the dashboard flags.
eq(`drift of exactly ${AT_RISK_DRIFT_POINTS} points is At risk`,
   derivedStatus({ status: 'Active', reportedProgress: 30 }, at(50)), 'AtRisk');
eq(`drift of ${AT_RISK_DRIFT_POINTS - 1} points is still On track`,
   derivedStatus({ status: 'Active', reportedProgress: 31 }, at(50)), 'OnTrack');

// ── 4. Frameworks column ────────────────────────────────────────────────────
console.log('\n4. Frameworks parsing');

JSON.stringify(parseFrameworks('["ISO27001","SOC2"]')) === '["ISO27001","SOC2"]'
  ? ok('a valid array round-trips') : bad('a valid array round-trips');
JSON.stringify(parseFrameworks('')) === '[]' ? ok('empty reads as []') : bad('empty reads as []');
JSON.stringify(parseFrameworks(null)) === '[]' ? ok('null reads as []') : bad('null reads as []');
JSON.stringify(parseFrameworks('not json')) === '[]'
  ? ok('malformed JSON reads as [] rather than throwing')
  : bad('malformed JSON reads as [] rather than throwing');
JSON.stringify(parseFrameworks('{"a":1}')) === '[]'
  ? ok('a JSON object reads as [] rather than leaking an object')
  : bad('a JSON object reads as []');

// ── 5. The access boundary ──────────────────────────────────────────────────
// This is the part that leaks data if it is wrong, so it gets the most cases.
console.log('\n5. Access boundary');

const CLIENT = 'tenant-client';
const PARTNER = 'tenant-partner';
const STRANGER = 'tenant-stranger';

const clientScope = scope('SELF', [CLIENT]);
const partnerScope = scope('SUBTREE', [PARTNER]);
const strangerScope = scope('SELF', [STRANGER]);

const engagement = { tenantId: CLIENT, providerTenantId: PARTNER };
const internal = { tenantId: CLIENT, providerTenantId: null };

const w = projectWhere(clientScope);
Array.isArray(w.OR) && w.OR.length === 2
  ? ok('the where clause covers both directions')
  : bad('the where clause covers both directions', JSON.stringify(w));

canReadProject(clientScope, engagement) ? ok('the client can read its engagement') : bad('the client can read its engagement');
canReadProject(partnerScope, engagement) ? ok('the delivering partner can read it') : bad('the delivering partner can read it');
!canReadProject(strangerScope, engagement)
  ? ok('an unrelated tenant cannot read it')
  : bad('an unrelated tenant cannot read it', 'LEAK');
!canReadProject(partnerScope, internal)
  ? ok('a partner cannot read a project it does not deliver')
  : bad('a partner cannot read a project it does not deliver', 'LEAK');

// Write is deliberately narrower than read: a partner works an engagement but
// cannot open new projects inside a customer's estate.
canWriteProject(clientScope, CLIENT) ? ok('the client can write its own project') : bad('the client can write its own project');
!canWriteProject(partnerScope, CLIENT)
  ? ok('the partner cannot write to the client tenant')
  : bad('the partner cannot write to the client tenant', 'PRIVILEGE ESCALATION');
!canWriteProject(strangerScope, CLIENT)
  ? ok('a stranger cannot write to the client tenant')
  : bad('a stranger cannot write to the client tenant', 'PRIVILEGE ESCALATION');

eq('the client sees itself as the Client side', sideOf(clientScope, engagement), 'Client');
eq('the partner sees itself as the Provider side', sideOf(partnerScope, engagement), 'Provider');
eq('a stranger has no side', sideOf(strangerScope, engagement), null);

// A platform operator spans everything; owning the data is the stronger claim.
const platform = scope('PLATFORM', [CLIENT, PARTNER, STRANGER]);
eq('a platform operator reads as the Client side', sideOf(platform, engagement), 'Client');
canReadProject(platform, engagement) ? ok('a platform operator can read across') : bad('a platform operator can read across');

console.log(`\n─── ${pass} passed, ${fail} failed ───\n`);
process.exit(fail === 0 ? 0 : 1);
