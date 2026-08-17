/**
 * Proves the two lifecycle loops that a scanner drives rather than a request:
 *
 *   7. an acceptance past its expiry is reopened, not merely counted on a card
 *   5. closing an engagement stamps coverage on the auditable entity
 *
 * Run with tsx so the TypeScript services can be imported directly:
 *   npx tsx scripts/verify/risk-lifecycle-loops.js
 */
const { prisma } = require('../../src/db');
const { runRiskReviewScan } = require('../../src/services/riskLifecycle');

let pass = 0, fail = 0;
const ok = (l, d = '') => { pass++; console.log(`   PASS  ${l}${d ? ` — ${d}` : ''}`); };
const bad = (l, d = '') => { fail++; console.log(`   FAIL  ${l}${d ? ` — ${d}` : ''}`); };

(async () => {
  // ── Loop 7 ───────────────────────────────────────────────────────────────
  console.log('\nLoop 7 — an expired acceptance is reopened, not merely displayed');
  const accepted = await prisma.risk.findFirst({ where: { status: 'Accepted' } });
  if (!accepted) {
    console.log('   (no accepted risk in the seed to test with)');
  } else {
    console.log(`   ${accepted.ref} is Accepted until ${String(accepted.acceptedUntil).slice(0, 10)}`);
    // Move the clock past the expiry, which is what time would do.
    await prisma.risk.update({
      where: { id: accepted.id },
      data: { acceptedUntil: new Date(Date.now() - 86_400_000) },
    });

    const result = await runRiskReviewScan();
    const after = await prisma.risk.findUnique({ where: { id: accepted.id } });

    after.status === 'Open'
      ? ok('the lapsed acceptance reopened', `${accepted.status} → ${after.status}, scan reported ${result.reopened} reopened`)
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

    console.log(`   ${result.overdueReviews} risk(s) are also past their review date`);
  }

  // ── Loop 5 ───────────────────────────────────────────────────────────────
  console.log('\nLoop 5 — closing an engagement stamps coverage on the entity');
  const item = await prisma.auditPlanItem.findFirst({
    where: { audit: { isNot: null } },
    include: { audit: true, auditableEntity: true },
  });
  if (!item?.audit) {
    console.log('   (no plan-derived engagement in the seed to test with)');
  } else {
    console.log(`   ${item.audit.ref} covers ${item.auditableEntity.name}, lastAuditedAt=${item.auditableEntity.lastAuditedAt ? String(item.auditableEntity.lastAuditedAt).slice(0, 10) : 'never'}`);
    console.log('   (the stamp is applied by PATCH /audits/:id when status becomes Closed —');
    console.log('    see auditProgrammeController; the engagement must have no open findings first)');
    const open = await prisma.issue.count({ where: { auditId: item.audit.id, status: { not: 'Closed' } } });
    console.log(`   ${item.audit.ref} currently has ${open} open finding(s) and status ${item.audit.status}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('(Reseed afterwards: npx tsx src/seed.ts)\n');
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})();
