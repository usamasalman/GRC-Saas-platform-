/**
 * Runs the GRC summary aggregation against fabricated rows.
 *
 * No database. The controller's two impure edges -- the Prisma client and the
 * tenant scope resolver -- are replaced in the module cache, and everything
 * else (the appetite banding, the SLA arithmetic, the bucket construction)
 * executes exactly as it does in production.
 *
 * The point is not coverage. It is that the figures on a compliance dashboard
 * are the sort that get read once, believed, and acted on. A banding bug does
 * not announce itself: it just reports a smaller number than the truth.
 *
 *   node scripts/verify/grc-summary-test.js
 */
const path = require('path');
const assert = require('assert');

const DIST = path.join(__dirname, '..', '..', 'dist');
const day = 86400000;
const now = Date.now();
const ago = (d) => new Date(now - d * day);
const ahead = (d) => new Date(now + d * day);

let checks = 0;
const is = (actual, expected, what) => {
  checks += 1;
  assert.deepStrictEqual(
    actual, expected,
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};

// -- Stub the two impure edges ---------------------------------------------
let ROWS = {};
const stub = (rel, exports) => {
  const full = require.resolve(path.join(DIST, rel));
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
};

stub('db.js', {
  prisma: {
    risk: { findMany: async () => ROWS.risks },
    riskAppetite: {
      // Mirror the where-clause the controller passes. If the controller ever
      // stops filtering to the in-force version, this test has to notice.
      findMany: async (q) => ROWS.appetites.filter(
        (a) => a.status === q.where.status && a.effectiveTo === q.where.effectiveTo,
      ),
    },
    audit: { findMany: async () => ROWS.audits },
    issue: { findMany: async () => ROWS.issues },
    controlImplementation: { findMany: async () => ROWS.impls },
  },
});
stub('services/scopeResolver.js', {
  resolveTenantScope: async () => ({ kind: 'SUBTREE', tenantIds: ['t1', 't2'] }),
});

const { getGrcSummary } = require(path.join(DIST, 'controllers/grcSummaryController.js'));

async function run(rows) {
  ROWS = rows;
  let body = null;
  let code = 200;
  const res = {
    json: (b) => { body = b; return res; },
    status: (c) => { code = c; return res; },
  };
  await getGrcSummary({ user: { tenantId: 't1', id: 'u1' } }, res);
  assert.strictEqual(code, 200, `handler returned ${code}, not 200`);
  return body;
}

const risk = (o) => ({
  id: o.id, ref: o.id, title: o.id, tenantId: o.tenantId || 't1',
  category: o.category || 'Technology', status: o.status || 'Open',
  treatmentType: o.treatmentType || 'Mitigate',
  inherentScore: o.inherent === undefined ? 20 : o.inherent,
  residualScore: o.residual === undefined ? 10 : o.residual,
  nextReviewDate: o.nextReviewDate === undefined ? null : o.nextReviewDate,
  createdAt: ago(90),
  owner: o.owner === undefined ? { id: 'u1', name: 'A Owner' } : o.owner,
});
const appetite = (o) => ({
  tenantId: o.tenantId || 't1', category: o.category || 'Technology',
  appetiteThreshold: o.appetite, toleranceThreshold: o.tolerance,
  status: o.status || 'Approved',
  effectiveTo: o.effectiveTo === undefined ? null : o.effectiveTo,
});
const issue = (o) => ({
  id: o.id, ref: o.id, title: o.id, status: o.status || 'Open',
  riskRating: o.rating || 'Medium',
  capDueDate: o.cap === undefined ? null : o.cap,
  targetCloseDate: o.target === undefined ? null : o.target,
  closedAt: o.closedAt === undefined ? null : o.closedAt,
});

const EMPTY = { risks: [], appetites: [], audits: [], issues: [], impls: [] };

(async () => {
  // -- Nothing at all -------------------------------------------------------
  {
    const r = await run({ ...EMPTY });
    is(r.risk.total, 0, 'empty: no risks');
    is(r.risk.appetite.configured, 0, 'empty: nothing configured');
    is(r.risk.appetite.beyondTolerance, null,
      'empty: beyondTolerance is null, not zero -- no appetite set is not the same as nothing breaching it');
    is(r.risk.exposure.reducedPercent, 0, 'empty: no divide by zero');
    is(r.issues.open, 0, 'empty: no issues');
  }

  // -- Closed risks stay out of every live figure ---------------------------
  {
    const r = await run({ ...EMPTY, risks: [
      risk({ id: 'R1', inherent: 20, residual: 10 }),
      risk({ id: 'R2', status: 'Closed', inherent: 25, residual: 1 }),
    ] });
    is(r.risk.total, 1, 'closed risk excluded from total');
    is(r.risk.closed, 1, 'closed risk counted separately');
    is(r.risk.exposure.inherentTotal, 20, 'closed risk excluded from inherent exposure');
    is(r.risk.exposure.residualTotal, 10, 'closed risk excluded from residual exposure');
    is(r.risk.exposure.reducedPercent, 50, 'treatment removed half the exposure');
  }

  // -- Banding against appetite ---------------------------------------------
  {
    const r = await run({ ...EMPTY,
      appetites: [appetite({ appetite: 6, tolerance: 12 })],
      risks: [
        risk({ id: 'IN', residual: 5 }),        // <= 6  -> WithinAppetite
        risk({ id: 'EDGE_A', residual: 6 }),    // == 6  -> WithinAppetite
        risk({ id: 'TOL', residual: 9 }),       // <= 12 -> WithinTolerance
        risk({ id: 'EDGE_T', residual: 12 }),   // == 12 -> WithinTolerance
        risk({ id: 'BEYOND', residual: 13 }),   // >  12 -> BeyondTolerance
      ] });
    is(r.risk.appetite.withinAppetite, 2, 'at the appetite threshold is still within appetite');
    is(r.risk.appetite.withinTolerance, 2, 'at the tolerance threshold is still within tolerance');
    is(r.risk.appetite.beyondTolerance, 1, 'one point over tolerance is beyond it');
    is(r.risk.appetite.unjudgeable, 0, 'every risk had an appetite for its category');
    is(r.risk.appetite.worst.map((w) => w.id), ['BEYOND'], 'the breach is named');
  }

  // -- A superseded or draft version must never band a live register --------
  {
    const r = await run({ ...EMPTY,
      appetites: [
        appetite({ appetite: 20, tolerance: 24, status: 'Superseded', effectiveTo: ago(30) }),
        appetite({ appetite: 15, tolerance: 18, status: 'Draft' }),
        appetite({ appetite: 6, tolerance: 12 }),
      ],
      risks: [risk({ id: 'R1', residual: 16 })] });
    is(r.risk.appetite.configured, 1, 'one category configured, not three versions of it');
    is(r.risk.appetite.beyondTolerance, 1,
      'banded against the approved in-force version (6/12), not the superseded 20/24 that would have called it safe');
  }

  // -- Appetite belongs to a tenant, not to the platform --------------------
  {
    const r = await run({ ...EMPTY,
      appetites: [
        appetite({ tenantId: 't1', appetite: 4, tolerance: 8 }),
        appetite({ tenantId: 't2', appetite: 15, tolerance: 20 }),
      ],
      risks: [
        risk({ id: 'T1R', tenantId: 't1', residual: 12 }),
        risk({ id: 'T2R', tenantId: 't2', residual: 12 }),
      ] });
    is(r.risk.appetite.beyondTolerance, 1,
      'the same score breaches in the strict subsidiary and not in the tolerant one');
    is(r.risk.appetite.worst.map((w) => w.id), ['T1R'], 'the named breach is the strict tenant risk');
  }

  // -- A category nobody set an appetite for --------------------------------
  {
    const r = await run({ ...EMPTY,
      appetites: [appetite({ category: 'Technology', appetite: 6, tolerance: 12 })],
      risks: [
        risk({ id: 'KNOWN', category: 'Technology', residual: 20 }),
        risk({ id: 'ORPHAN', category: 'Fraud', residual: 25 }),
      ] });
    is(r.risk.appetite.unjudgeable, 1,
      'the risk in an un-appetised category is reported, not silently dropped');
    is(r.risk.appetite.beyondTolerance, 1,
      'and it is not counted as a breach it was never measured against');
    is(r.risk.appetite.withinAppetite, 0,
      'nor quietly folded into within-appetite, which is the failure that flatters the number');
  }

  // -- Buckets cover the whole register -------------------------------------
  {
    const r = await run({ ...EMPTY, risks: [
      risk({ id: 'A', status: 'Open', treatmentType: 'Mitigate' }),
      risk({ id: 'B', status: 'UnderTreatment', treatmentType: 'Transfer' }),
      risk({ id: 'C', status: 'Accepted', treatmentType: 'Accept' }),
      risk({ id: 'D', status: 'Open', treatmentType: 'Exploit' }),
      risk({ id: 'E', status: 'Open', treatmentType: 'Enhance' }),
    ] });
    const statusSum = Object.values(r.risk.byStatus).reduce((a, b) => a + b, 0);
    is(statusSum, 5, 'every live risk appears in exactly one status bucket');
    const treatSum = Object.values(r.risk.byTreatment).reduce((a, b) => a + b, 0);
    is(treatSum, 5,
      'opportunity treatments are counted too -- a breakdown that omits them does not add up to the total');
    is(r.risk.byTreatment.Exploit, 1, 'Exploit has a bucket');
    is(Object.keys(r.risk.byStatus).includes('Closed'), false, 'no Closed bucket among live statuses');
  }

  // -- Review dates ---------------------------------------------------------
  {
    const r = await run({ ...EMPTY, risks: [
      risk({ id: 'LATE', nextReviewDate: ago(1) }),
      risk({ id: 'SOON', nextReviewDate: ahead(1) }),
      risk({ id: 'NONE', nextReviewDate: null }),
    ] });
    is(r.risk.overdueReview, 1, 'only the past-dated review is overdue');
  }

  // -- SLA breach on findings -----------------------------------------------
  {
    const r = await run({ ...EMPTY, issues: [
      issue({ id: 'I_LATE', cap: ago(10) }),
      issue({ id: 'I_LATER', cap: ago(40) }),
      issue({ id: 'I_SOON', cap: ahead(5) }),
      issue({ id: 'I_FAR', cap: ahead(60) }),
      issue({ id: 'I_UNDATED' }),
      issue({ id: 'I_FALLBACK', target: ago(3) }),
      issue({ id: 'I_CLOSED', cap: ago(90), status: 'Closed', closedAt: ago(80) }),
      issue({ id: 'I_CLOSED_2', cap: ago(90), closedAt: ago(80) }),
    ] });
    is(r.issues.open, 6, 'closed findings are out, whether by status or by closedAt');
    is(r.issues.slaBreached, 3, 'three open findings are past their date');
    is(r.issues.dueWithin14Days, 1, 'only the one inside the window');
    is(r.issues.undated, 1,
      'the undated finding is reported separately -- it cannot breach, and counting it as on time is how a register stops meaning anything');
    is(r.issues.worst[0].id, 'I_LATER', 'the longest overdue leads');
    is(r.issues.worst[0].daysOverdue, 40, 'days late measured from the promised date');
    is(r.issues.worst.map((w) => w.id), ['I_LATER', 'I_LATE', 'I_FALLBACK'], 'ordered by how late');
  }

  // -- The CAP date wins over the close target ------------------------------
  {
    const r = await run({ ...EMPTY, issues: [
      issue({ id: 'BOTH', cap: ahead(5), target: ago(30) }),
    ] });
    is(r.issues.slaBreached, 0,
      'a re-planned corrective action governs; the older close target does not resurrect a breach');
    is(r.issues.dueWithin14Days, 1, 'and the CAP date is what places it in the window');
  }

  // -- Ratings --------------------------------------------------------------
  {
    const r = await run({ ...EMPTY, issues: [
      issue({ id: 'H', rating: 'High' }),
      issue({ id: 'M', rating: 'Medium' }),
      issue({ id: 'L', rating: 'Low' }),
    ] });
    is(Object.keys(r.issues.byRating), ['High', 'Medium', 'Low'],
      'no Critical bucket -- issueController rejects the value, so it could only ever read zero next to the word Critical');
    is(Object.values(r.issues.byRating).reduce((a, b) => a + b, 0), 3, 'every open finding is rated');
  }

  // -- Audit and controls ---------------------------------------------------
  {
    const r = await run({ ...EMPTY,
      audits: [
        { id: 'A1', ref: 'A1', title: 'A1', status: 'Fieldwork', createdAt: ago(10) },
        { id: 'A2', ref: 'A2', title: 'A2', status: 'Closed', createdAt: ago(200) },
        { id: 'A3', ref: 'A3', title: 'A3', status: 'Cancelled', createdAt: ago(200) },
        { id: 'A4', ref: 'A4', title: 'A4', status: 'Planned', createdAt: ago(2) },
      ],
      impls: [
        { id: 'C1', status: 'Verified', effectiveness: 'Effective', nextDueDate: ahead(30) },
        { id: 'C2', status: 'Implemented', effectiveness: 'PartiallyEffective', nextDueDate: ago(5) },
        { id: 'C3', status: 'NotStarted', effectiveness: 'Ineffective', nextDueDate: null },
      ] });
    is(r.audit.total, 4, 'all engagements counted');
    is(r.audit.inFlight, 2, 'closed and cancelled engagements are not in flight');
    is(r.controls.total, 3, 'all implementations counted');
    is(r.controls.verified, 1, 'only the independently verified one');
    is(r.controls.notEffective, 2,
      'partially effective counts as not fully effective -- rounding it up to working is the whole failure mode');
    is(r.controls.overdueTesting, 1, 'only the past-dated test is overdue');
  }

  console.log(`grc-summary: ${checks} assertions passed`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
