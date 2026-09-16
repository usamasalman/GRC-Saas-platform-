/**
 * The delivery reports stop stating figures the data cannot support.
 *
 * Four separate defects, all the same shape: a number that reads as a finding
 * when it is really the absence of one. Each was confirmed by reading the code
 * and then adversarially re-checked before anything was changed.
 *
 *   1. "N% reported, all of it independently confirmed" printed whenever the
 *      reported and verified figures were equal. They are equal when every task
 *      needing a reviewer got one -- and equally when NOTHING needed one, which
 *      is the default: the policy is SelectedTasks and nobody marks a task, so
 *      requiresVerification is false everywhere and the verified percentage
 *      simply copies the reported one. A manager could tick every task Done and
 *      hand a steering committee a paper claiming independent confirmation with
 *      zero verification rows in the database. On a new engagement it read "0%
 *      reported, all of it independently confirmed".
 *
 *   2. "Requiring independent review" and "Tasks requiring review" were
 *      structurally zero in every report ever produced. taskCounts reads
 *      `needsVerification` off each row; it is not a column but a derived
 *      value, and the reports handed it raw Prisma rows where the property is
 *      simply absent. Because the parameter type declares it optional, that
 *      compiled. The controller imported requiresVerification for exactly this
 *      purpose and never called it.
 *
 *   3. An empty verification set rendered as a clean one: three adverse-finding
 *      rows each printing the word "None", under the heading "The basis of the
 *      confirmed figure", in the document an external auditor reads.
 *
 *   4. derivedStatus returned NotStarted for a Draft engagement before it ever
 *      tested the overdue flag. The portfolio showed a grey "Not started" pill,
 *      "184 days overdue" in red two columns to its left, and a Delayed count
 *      of zero -- three statements about one row. The steering report went
 *      further: NotStarted is neither AtRisk nor Delayed, so healthDisagrees
 *      compared it against a default-Green health flag, agreed, and told the
 *      committee "These two agree."
 *
 * Plus one regression of this project's own making: the reports printed
 * "Frameworks in scope" from the free-text column that stopped being written
 * when ProjectStandard landed, so every engagement created since would have
 * shown an em dash -- including on the readiness paper, whose whole subject is
 * the frameworks in scope.
 *
 *   node scripts/verify/report-honesty-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/** Comments are prose. Only what runs counts. */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const ctrl = read(API, 'controllers', 'deliveryReportController.ts');
const ctrlCode = code(ctrl);

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

const { derivedStatus, schedule } = require('../../dist/services/projectSchedule');
const {
  verificationIntegrity, verificationBasis,
} = require('../../dist/services/deliveryReportData');

// ── A draft cannot hide an overdue engagement ────────────────────────────
{
  const now = new Date('2026-09-15T00:00:00Z');
  const at = (start, end, status, reported = 0) => {
    const p = {
      startDate: new Date(start), targetEndDate: new Date(end),
      actualEndDate: null, status, reportedProgress: reported,
    };
    return derivedStatus(p, schedule(p, now));
  };

  checks += 1;
  assert.strictEqual(
    at('2025-09-15', '2026-03-15', 'Draft'), 'Delayed',
    'a draft six months past the date it set for itself must report as Delayed. It used to '
    + 'report "Not started", while the same portfolio row printed "184 days overdue" beside it '
    + 'and the Delayed count read zero.',
  );

  checks += 1;
  assert.strictEqual(
    at('2026-06-15', '2026-12-15', 'Draft'), 'AtRisk',
    'a draft burning its own window with nothing done is at risk. That is precisely the signal '
    + 'a manual status field never gives you, and the reason this function exists.',
  );

  // The cases that must NOT change.
  checks += 1;
  assert.strictEqual(
    at('2026-09-15', '2026-12-15', 'Draft'), 'NotStarted',
    'a draft whose window has not opened is still not started',
  );
  checks += 1;
  assert.strictEqual(
    at('2027-01-01', '2027-06-01', 'Draft'), 'NotStarted',
    'and so is one that has not begun at all',
  );
  checks += 1;
  assert.strictEqual(
    at('2025-09-15', '2026-03-15', 'Cancelled'), 'NotStarted',
    'cancelled work stopped deliberately and must not be reported as Delayed',
  );
  checks += 1;
  assert.strictEqual(
    at('2025-09-15', '2026-03-15', 'Active'), 'Delayed',
    'an active engagement past its date is unchanged',
  );
  checks += 1;
  assert.strictEqual(
    at('2026-06-15', '2026-12-15', 'Active', 60), 'OnTrack',
    'and one keeping pace is unchanged',
  );

  // The order is the fix. A Draft test above the schedule tests is the defect.
  const src = code(read(API, 'services', 'projectSchedule.ts'));
  const body = src.slice(src.indexOf('export function derivedStatus'));
  checks += 1;
  assert.ok(
    body.indexOf("p.status === 'Draft'") > body.indexOf('s.overdue'),
    'the Draft test must come AFTER the overdue test. Above it, a draft returns early and the '
    + 'schedule arithmetic never runs.',
  );
}

// ── An empty verification set is not a clean one ─────────────────────────
{
  const empty = verificationIntegrity([]);
  checks += 1;
  assert.strictEqual(
    empty.clean, false,
    'nothing tested is not everything passed. With no rows the three failure counts are each '
    + 'zero, and this used to report clean: true -- the vacuous truth that nothing failed '
    + 'because nothing was ever checked.',
  );
  ok(empty.assessed === 0, 'and the renderer must be able to tell that nothing was assessed');

  const good = verificationIntegrity([
    { independent: true, evidenceAddedLater: 0, rejections: 0 },
  ]);
  ok(good.clean === true, 'a genuinely clean single acceptance is still clean');
  ok(good.assessed === 1, 'and is counted');

  const bad = verificationIntegrity([
    { independent: false, evidenceAddedLater: 0, rejections: 0 },
  ]);
  ok(bad.clean === false, 'an acceptance by the doer is not clean');

  const untestable = verificationIntegrity([
    { independent: null, evidenceAddedLater: 0, rejections: 0 },
  ]);
  ok(
    untestable.clean === false,
    'an acceptance whose independence cannot be established is not a passed control',
  );
}

// ── What the report may claim about confirmation ─────────────────────────
{
  // Nothing required a reviewer: the gap is zero and means nothing.
  const none = verificationBasis({
    policy: 'SelectedTasks', needsVerification: 0, verifiedCount: 0,
    reported: 100, verified: 100, unverifiedGap: 0,
  });
  checks += 1;
  assert.ok(
    none.assured === false && /none of it independently confirmed/.test(none.headline),
    'with no task requiring review, 100% reported is 100% unconfirmed. The old line read '
    + '"100% reported, all of it independently confirmed" for exactly this engagement.',
  );
  ok(
    /reported about their own work/.test(none.caveat),
    'and the caveat must say whose word the figure is',
  );

  // The degenerate case that gave the defect away.
  const fresh = verificationBasis({
    policy: 'SelectedTasks', needsVerification: 0, verifiedCount: 0,
    reported: 0, verified: 0, unverifiedGap: 0,
  });
  checks += 1;
  assert.ok(
    !/all of it independently confirmed/.test(fresh.headline),
    'a brand-new engagement must not read "0% reported, all of it independently confirmed"',
  );

  // Policy None is a deliberate choice and the caveat should name it.
  const off = verificationBasis({
    policy: 'None', needsVerification: 0, verifiedCount: 0,
    reported: 80, verified: 80, unverifiedGap: 0,
  });
  ok(
    /set to require no independent review/.test(off.caveat),
    'under policy None the reader should be told it was switched off, not merely unused',
  );

  // Review required, none done.
  const pending = verificationBasis({
    policy: 'EveryTask', needsVerification: 4, verifiedCount: 0,
    reported: 50, verified: 0, unverifiedGap: 50,
  });
  ok(pending.assured === false, 'review required and none done is not assurance');
  ok(/none has been confirmed yet/.test(pending.caveat), 'and says so');

  // The good case, which must still be sayable.
  const full = verificationBasis({
    policy: 'EveryTask', needsVerification: 3, verifiedCount: 3,
    reported: 100, verified: 100, unverifiedGap: 0,
  });
  checks += 1;
  assert.ok(
    full.assured === true && /all of it independently confirmed across 3 task\(s\)/.test(full.headline),
    'where every task needing a reviewer got one, the report must still be able to say so -- '
    + 'and name how many, so the claim can be checked',
  );

  // A partial gap keeps both numbers fused in one string.
  const partial = verificationBasis({
    policy: 'EveryTask', needsVerification: 5, verifiedCount: 2,
    reported: 90, verified: 40, unverifiedGap: 50,
  });
  ok(
    /90% reported/.test(partial.headline) && /40% independently confirmed/.test(partial.headline),
    'the flattering number must not be able to travel without the other',
  );
}

// ── The reports actually resolve needsVerification ───────────────────────
{
  ok(
    /const countableTasks = /.test(ctrlCode),
    'the reports must decorate their tasks before counting them',
  );
  ok(
    /requiresVerification\(\s*policy,/.test(ctrlCode)
    && /countable\(e\.verificationPolicy/.test(ctrlCode),
    'and must use the policy rule the plan controller already uses, driven by the '
    + "engagement's own policy",
  );

  checks += 1;
  assert.deepStrictEqual(
    (ctrlCode.match(/taskCounts\(\s*(\w+)/g) || []).map((m) => m.replace(/\s+/g, '')),
    ['taskCounts(countableTasks', 'taskCounts(countable', 'taskCounts(countableTasks'],
    'EVERY taskCounts call in the reports must pass decorated rows, including the one whose '
    + 'report prints no review figure today. Passing raw Prisma rows compiles -- '
    + 'needsVerification is optional on the parameter type -- and silently pins the count to '
    + 'zero, which is how two reports came to print it as zero for every engagement.',
  );
}

// ── The headline goes through the rule ───────────────────────────────────
{
  ok(/verificationBasis\(\{/.test(ctrlCode), 'the status report must ask what it may claim');
  ok(
    /\{ label: 'Progress', value: basis\.headline \}/.test(ctrlCode),
    'and print what it is given',
  );
  checks += 1;
  assert.ok(
    !/all of it independently confirmed'/.test(ctrlCode),
    'the controller must not carry its own copy of that sentence. The whole defect was that it '
    + 'printed it on a condition that does not mean it.',
  );
}

// ── The audit report distinguishes untested from passed ──────────────────
{
  const at = ctrlCode.indexOf('function auditSections');
  ok(at > 0, 'the audit section builder was not found');
  const body = ctrlCode.slice(at, ctrlCode.indexOf('\nasync function ', at + 1) + 1 || undefined);

  checks += 1;
  assert.strictEqual(
    (body.match(/integrity\.assessed === 0/g) || []).length, 4,
    'all three adverse-finding rows must check whether anything was assessed, plus the line '
    + 'that says so outright. "None" three times down a column reads as three clean findings.',
  );
  ok(
    /NOT_ASSESSED/.test(body),
    'and must render an em dash rather than the word None',
  );
  ok(
    /This report supports no assurance conclusion/.test(ctrl),
    'an audit report over an empty verification set must refuse a conclusion in words',
  );
}

// ── The delay report cannot report unmeasured movement as zero ───────────
{
  const at = ctrlCode.indexOf('function delaySections');
  ok(at > 0, 'the delay section builder was not found');
  const body = ctrlCode.slice(at);

  checks += 1;
  assert.ok(
    /label: 'Net movement across tasks',[\s\S]{0,200}?e\.baselineSetAt/.test(body),
    'without a baseline every task slippage is zero because nothing was measured. This report '
    + 'goes to the other party to the contract, and it printed "0 day(s)" unqualified -- the '
    + 'status and phase reports already said "Not baselined" here and this one did not.',
  );
  ok(
    /This report states no schedule movement/.test(ctrl),
    'and must say so before any figure on the page',
  );
}

// ── Frameworks in scope come from the binding ────────────────────────────
{
  ok(
    /function frameworksInScope\(/.test(ctrlCode),
    'the reports must resolve the frameworks the engagement is bound to',
  );
  checks += 1;
  assert.deepStrictEqual(
    (ctrlCode.match(/value: parseFrameworks\(e\.frameworks\)/g) || []),
    [],
    'no report may print the legacy free-text column as its frameworks. Nothing has written '
    + 'that column since ProjectStandard landed, so every engagement created since would show '
    + 'an em dash -- including on the readiness paper, whose subject is the frameworks in scope.',
  );
  checks += 1;
  assert.strictEqual(
    (ctrlCode.match(/frameworksInScope\(e\)/g) || []).length, 2,
    'both the audit report and the readiness report must use it',
  );
  ok(
    /not bound to the framework library/.test(ctrl),
    'and legacy free text must be marked as unresolved rather than passed off as a binding',
  );
}

console.log(`report-honesty: ${checks} assertions passed`);
