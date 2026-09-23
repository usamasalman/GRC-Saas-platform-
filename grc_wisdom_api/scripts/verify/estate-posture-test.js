/**
 * Nothing assessed is never reported as nothing wrong.
 *
 * "How is the estate" had two answers before this, and both were useless.
 * getGrcSummary blends every tenant in scope into one set of figures, which for
 * a platform operator is every customer added together — a total from which
 * "which customer needs attention" cannot be recovered. And the screen that
 * promised the per-tenant view, Subsidiary Scorecards, had no component at all:
 * it fell through to the mock engine, which drew hardcoded percentages against
 * organisations that do not exist.
 *
 * Invented compliance posture is the worst thing this product can display. It
 * is the one figure a customer cannot check, and the one they act on.
 *
 * The arithmetic is pinned here because of one property that is easy to lose:
 * every count reads as good news when it is zero, and for an organisation
 * nobody has assessed every count IS zero. Without the assessed flag, the
 * estate's least compliant customers appear to be its best.
 *
 *   npm run build && node scripts/verify/estate-posture-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { estatePosture, attentionOrder } = require('../../dist/services/estatePosture');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const is = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

const NOW = new Date('2026-09-15T00:00:00Z');
const PAST = new Date('2026-01-01T00:00:00Z');
const FUTURE = new Date('2027-01-01T00:00:00Z');

const T = (id, name, type) => ({ id, name, type, suspendedAt: null });
const tenants = [T('t1', 'Assessed Co', 'MULTIBRANCH'), T('t2', 'Untouched Ltd', 'BRANCH')];

const base = {
  tenants,
  risks: [],
  appetites: [],
  issues: [],
  implementations: [],
  enablements: [],
  now: NOW,
};
const run = (over) => estatePosture({ ...base, ...over });
const forT = (rows, id) => rows.find((r) => r.tenantId === id);

// ── An organisation nobody has looked at is not a clean one ──────────────
// The assertion this whole file exists for.
{
  const rows = run({});
  const untouched = forT(rows, 't2');
  is(untouched.assessed, false, 'a tenant with no risks, controls or findings is not assessed');
  is(untouched.risks.beyondTolerance, 0, 'and its counts are all zero');
  ok(
    untouched.unknowns.some((u) => /absence of work, not an absence of exposure/.test(u)),
    'so it must say plainly that the zeroes mean nothing was done, not that nothing is wrong',
  );
}

// ── Assessed means something was actually recorded ───────────────────────
{
  const withRisk = run({
    risks: [{ tenantId: 't1', category: 'Operational', status: 'Open', residualScore: 9, nextReviewDate: null }],
  });
  is(forT(withRisk, 't1').assessed, true, 'a live risk counts as assessed');

  const withControl = run({
    implementations: [{ tenantId: 't1', status: 'Implemented', effectiveness: 'NotAssessed', nextDueDate: null }],
  });
  is(forT(withControl, 't1').assessed, true, 'a control implementation counts as assessed');

  const withIssue = run({
    issues: [{ tenantId: 't1', status: 'Open', capDueDate: null, targetCloseDate: null }],
  });
  is(forT(withIssue, 't1').assessed, true, 'a finding counts as assessed');

  // Closed risks alone still count: somebody assessed them.
  const closedOnly = run({
    risks: [{ tenantId: 't1', category: 'Operational', status: 'Closed', residualScore: 9, nextReviewDate: null }],
  });
  is(forT(closedOnly, 't1').risks.live, 0, 'closed risks are not live');
  is(forT(closedOnly, 't1').assessed, true, 'but the register was worked, so it is assessed');
}

// ── A risk with no appetite cannot be judged, and says so ────────────────
// Reporting it as within tolerance would be the same lie in a different shape.
{
  const rows = run({
    risks: [
      { tenantId: 't1', category: 'Operational', status: 'Open', residualScore: 20, nextReviewDate: null },
      { tenantId: 't1', category: 'Cyber', status: 'Open', residualScore: 20, nextReviewDate: null },
    ],
    appetites: [{ tenantId: 't1', category: 'Operational', appetiteThreshold: 5, toleranceThreshold: 10 }],
  });
  const p = forT(rows, 't1');
  is(p.risks.live, 2, 'both risks are live');
  is(p.risks.beyondTolerance, 1, 'the one with an appetite and a score over tolerance');
  is(p.risks.unjudgeable, 1, 'the one with no appetite for its category is not judged as fine');
  ok(
    p.unknowns.some((u) => /cannot be judged against appetite/.test(u)),
    'and the reason is stated, because it means nobody has decided that tolerance',
  );
}

// ── Appetite is per tenant ───────────────────────────────────────────────
// Two organisations may set different tolerances for the same category, and one
// must not be banded by the other's.
{
  const rows = run({
    risks: [
      { tenantId: 't1', category: 'Cyber', status: 'Open', residualScore: 12, nextReviewDate: null },
      { tenantId: 't2', category: 'Cyber', status: 'Open', residualScore: 12, nextReviewDate: null },
    ],
    appetites: [
      { tenantId: 't1', category: 'Cyber', appetiteThreshold: 5, toleranceThreshold: 10 },
      { tenantId: 't2', category: 'Cyber', appetiteThreshold: 15, toleranceThreshold: 20 },
    ],
  });
  is(forT(rows, 't1').risks.beyondTolerance, 1, 'over this tenant\'s tolerance');
  is(forT(rows, 't2').risks.beyondTolerance, 0, 'the same score is inside the other tenant\'s');
}

// ── Effectiveness carries its denominator, and is null when unknown ──────
{
  const rows = run({
    implementations: [
      { tenantId: 't1', status: 'Implemented', effectiveness: 'Effective', nextDueDate: null },
      { tenantId: 't1', status: 'Implemented', effectiveness: 'Ineffective', nextDueDate: null },
      { tenantId: 't1', status: 'Implemented', effectiveness: 'NotAssessed', nextDueDate: null },
    ],
  });
  const p = forT(rows, 't1');
  is(p.controls.implemented, 3, 'three implemented');
  is(p.controls.effectivenessBasis, 2, 'two of them assessed');
  is(p.controls.effectivenessRate, 50, 'one effective of two assessed');
  ok(
    p.controls.effectivenessRate !== null && p.controls.effectivenessBasis > 0,
    'the denominator must travel with the rate, or 50% reads as half of everything',
  );

  const none = run({
    implementations: [
      { tenantId: 't1', status: 'Implemented', effectiveness: 'NotAssessed', nextDueDate: null },
    ],
  });
  is(
    forT(none, 't1').controls.effectivenessRate, null,
    'nothing assessed is null, never 0 — zero per cent effective and not yet measured are '
    + 'opposite findings',
  );
  ok(
    forT(none, 't1').unknowns.some((u) => /never been\s+assessed/.test(u.replace(/\s+/g, ' '))),
    'and that is stated',
  );
}

// ── Overdue means past, not merely set ───────────────────────────────────
{
  const rows = run({
    risks: [
      { tenantId: 't1', category: 'Ops', status: 'Open', residualScore: 1, nextReviewDate: PAST },
      { tenantId: 't1', category: 'Ops', status: 'Open', residualScore: 1, nextReviewDate: FUTURE },
      { tenantId: 't1', category: 'Ops', status: 'Open', residualScore: 1, nextReviewDate: null },
    ],
    issues: [
      { tenantId: 't1', status: 'Open', capDueDate: PAST, targetCloseDate: null },
      { tenantId: 't1', status: 'Open', capDueDate: null, targetCloseDate: FUTURE },
      { tenantId: 't1', status: 'Closed', capDueDate: PAST, targetCloseDate: null },
    ],
  });
  const p = forT(rows, 't1');
  is(p.risks.overdueReview, 1, 'only the review date in the past');
  is(p.issues.open, 2, 'the closed finding is not open');
  is(p.issues.overdue, 1, 'and a closed finding cannot be overdue');
}

// ── Attention order leads with what nobody has looked at ─────────────────
{
  const rows = run({
    risks: [
      { tenantId: 't1', category: 'Ops', status: 'Open', residualScore: 20, nextReviewDate: null },
    ],
    appetites: [{ tenantId: 't1', category: 'Ops', appetiteThreshold: 5, toleranceThreshold: 10 }],
  });
  const ordered = attentionOrder(rows);
  is(
    ordered[0].tenantId, 't2',
    'an organisation nobody has assessed leads an organisation with a known, visible problem — '
    + 'the second is being worked, the first is not even known',
  );
}

// ── There is no grade anywhere ───────────────────────────────────────────
// A letter or an overall score would be a judgement about a customer that this
// product is not entitled to make, and is exactly what the mock screen showed.
{
  const rows = run({
    risks: [{ tenantId: 't1', category: 'Ops', status: 'Open', residualScore: 1, nextReviewDate: null }],
  });
  const keys = Object.keys(rows[0]).join(' ');
  for (const banned of ['grade', 'score', 'rating', 'health', 'compliancePercent']) {
    ok(!keys.includes(banned), `posture must not carry a ${banned} — it is not a judgement to make`);
  }
}

// ── The screen and the mock engine ───────────────────────────────────────
{
  const WEB = path.join(__dirname, '..', '..', '..', 'src');
  const shell = fs.readFileSync(path.join(WEB, 'pages', 'AppShell.tsx'), 'utf8');
  ok(
    /currentPage === 'subsidiaries'/.test(shell) && /EstatePosture/.test(shell),
    'the Subsidiary Scorecards key must reach a real component. It fell through to the mock '
    + 'engine, which drew invented percentages against organisations that do not exist.',
  );

  // The fabricated panel itself used to be read out of src/utils/appMockEngine.js
  // and checked for invented organisations and posture figures. That file has
  // since been deleted outright, which is the strongest version of what these
  // assertions were reaching for: there is no mock engine left to render an
  // invented percentage against an organisation that does not exist.
  //
  // no-mock-engine-test.js owns the "it stays deleted" rule now. Re-reading the
  // file here would only make this suite fail for a reason it is not about.
  ok(
    !fs.existsSync(path.join(WEB, 'utils', 'appMockEngine.js')),
    'the mock engine must stay deleted — if it returns, the invented posture figures this '
    + 'packet removed can return with it',
  );
}

console.log(`estate-posture: ${checks} assertions passed (pure, no database)`);
