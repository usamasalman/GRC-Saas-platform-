/**
 * The risk loop that time closes, not a request.
 *
 * Every other rule in the register is reachable by pressing something. This
 * one is not: an acceptance expires because a date passes. Nobody clicks it,
 * no endpoint is called, and if the scanner does not run then a risk somebody
 * accepted "until December" stays accepted forever while the dashboard counts
 * it as a live decision.
 *
 * So this suite calls runRiskReviewScan() directly rather than over HTTP. That
 * is the whole point — a request-driven test would prove a different thing.
 *
 * Two things were wrong with this file before, and both are the defect class
 * the rest of the suites exist to catch:
 *
 *   - It carried a second section, "Loop 5 — closing an engagement stamps
 *     coverage", which asserted nothing at all. The branch printed four
 *     console lines describing where in the controller the stamp is applied
 *     and moved on, so the suite reported "3 passed" while proving one of the
 *     two loops its own docstring claimed. On a fresh seed it did not even
 *     reach those lines: the fixture it looked for does not exist until some
 *     other suite has built one. That loop is request-driven and is now
 *     asserted, properly, at the end of audit-tabs-test.js where the fixture
 *     already stands at the right state.
 *
 *   - A missing fixture printed "(no accepted risk in the seed to test with)"
 *     and exited 0. A suite that passes because it found nothing to check is
 *     worse than one that does not run.
 *
 * It also required ../../src, which meant it needed tsx and could not join the
 * others. It reads dist/ now and runs on plain node.
 *
 *   node scripts/verify/risk-lifecycle-loops.js
 */
const { prisma } = require('../../dist/db');
const { runRiskReviewScan } = require('../../dist/services/riskLifecycle');

let pass = 0, fail = 0;
const ok = (l, d = '') => { pass++; console.log(`   PASS  ${l}${d ? ` — ${d}` : ''}`); };
const bad = (l, d = '') => { fail++; console.log(`   FAIL  ${l}${d ? ` — ${d}` : ''}`); };

(async () => {
  console.log('\nAn expired acceptance is reopened, not merely displayed');

  const accepted = await prisma.risk.findFirst({ where: { status: 'Accepted' } });
  if (!accepted) {
    // Not a skip. The seed is meant to carry an accepted risk, and a run that
    // finds none has not verified the loop — it has lost its fixture.
    bad(
      'the seed carries an accepted risk to expire',
      'no risk with status Accepted; this suite verified nothing',
    );
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`   ${accepted.ref} is Accepted until ${String(accepted.acceptedUntil).slice(0, 10)}`);

  // A control run first: the scan must not reopen an acceptance that has not
  // expired. Asserting only that the expired one reopens would pass a scan
  // that reopened everything it touched.
  const beforeExpiry = await runRiskReviewScan();
  const untouched = await prisma.risk.findUnique({ where: { id: accepted.id } });
  untouched.status === 'Accepted'
    ? ok('an acceptance still inside its date is left alone', `scan reopened ${beforeExpiry.reopened}`)
    : bad('a live acceptance was reopened', `${accepted.status} → ${untouched.status}`);

  // Move the clock past the expiry, which is what time would do.
  await prisma.risk.update({
    where: { id: accepted.id },
    data: { acceptedUntil: new Date(Date.now() - 86_400_000) },
  });

  const result = await runRiskReviewScan();
  const after = await prisma.risk.findUnique({ where: { id: accepted.id } });

  after.status === 'Open'
    ? ok('the lapsed acceptance reopened', `Accepted → ${after.status}, scan reported ${result.reopened} reopened`)
    : bad('the lapsed acceptance did not reopen', `still ${after.status}`);

  after.acceptedById === null && after.acceptedUntil === null
    ? ok('the stale approval was cleared', 'acceptedById and acceptedUntil are null')
    : bad('the stale approval survived', `acceptedById=${after.acceptedById}`);

  const trail = await prisma.auditLog.findFirst({
    where: { subjectId: accepted.id, action: 'RISK_ACCEPTANCE_EXPIRED' },
    // AuditLog orders by timestamp, not createdAt.
    orderBy: { timestamp: 'desc' },
  });
  trail
    ? ok('the reopening is in the WORM trail', 'RISK_ACCEPTANCE_EXPIRED recorded')
    : bad('nothing was written to the audit trail');

  // The scanner runs on a timer, so it will meet this risk again in fifteen
  // minutes. Reopening it a second time would write a second expiry entry for
  // one expiry and move the register's figures without anything happening.
  const again = await runRiskReviewScan();
  const trailCount = await prisma.auditLog.count({
    where: { subjectId: accepted.id, action: 'RISK_ACCEPTANCE_EXPIRED' },
  });
  trailCount === 1
    ? ok('a second scan does not expire it twice', `${again.reopened} reopened, 1 trail entry`)
    : bad('the expiry was recorded more than once', `${trailCount} entries`);

  console.log(`   ${result.overdueReviews} risk(s) are also past their review date`);

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('(This suite expires an acceptance; the data is rebuilt before the next one.)\n');
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error(err.message || err);
  try { await prisma.$disconnect(); } catch { /* already closed */ }
  process.exit(1);
});
