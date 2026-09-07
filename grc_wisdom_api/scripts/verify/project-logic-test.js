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
const {
  weightedProgress, progressPair, rollUpPhases, totalWeight,
} = require('../../dist/services/projectRollup');
const {
  checkTaskTransition, derivePhaseStatus, taskTiming, isComplete, isDelivered,
  requiresVerification, checkVerificationRule, checkVerificationRouting,
  checkSeparationOfDuties, checkTaskUpdate, taskCounts,
  TASK_STATUSES, DUE_SOON_DAYS, VERIFICATION_POLICIES, VERIFICATION_SLA_DAYS,
  VERIFICATION_STATES,
} = require('../../dist/services/projectLifecycle');
const {
  slippage, signedDays, requiresDelayReason, impedimentCost, isOpen, attribute,
  checkBlockRouting, checkImpedimentInput, checkResolvable, slipCost,
  OWING_SIDES, IMPEDIMENT_CATEGORIES, IMPEDIMENT_KINDS,
} = require('../../dist/services/projectDelay');
const {
  evidenceStanding, hasStandingEvidence, checkEvidenceAttachable,
  checkEvidenceWithdrawable, checkEvidenceFile, sniffMime, clauseCoverage,
  extensionOf, MAX_EVIDENCE_BYTES,
} = require('../../dist/services/projectEvidence');
const {
  normaliseHex, bareHex, argbHex, contrastRatio, readableOn, inkOn,
  normaliseMarking, logoType, checkLogo, resolveBranding, ancestorsOf, isBrandable,
  DEFAULT_BRAND, DEFAULT_MARKING, REPORT_MARKINGS, MAX_LOGO_BYTES,
  MIN_TEXT_CONTRAST, INK, PAPER, effectiveMarking, selectSections,
} = require('../../dist/services/tenantBranding');

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

// ── 6. Task transitions ─────────────────────────────────────────────────────
console.log('\n6. Task transitions');

checkTaskTransition('NotStarted', 'InProgress') === null
  ? ok('work can start') : bad('work can start');
checkTaskTransition('InProgress', 'Done') === null
  ? ok('work in progress can finish') : bad('work in progress can finish');
checkTaskTransition('Done', 'InProgress') === null
  ? ok('finished work can be reopened') : bad('finished work can be reopened');
checkTaskTransition('Blocked', 'InProgress') === null
  ? ok('blocked work can resume') : bad('blocked work can resume');
checkTaskTransition('InProgress', 'InProgress') === null
  ? ok('a no-op transition is allowed') : bad('a no-op transition is allowed');

// The one that matters: work cannot jump straight to done without being started,
// which is how a plan gets marked complete in a single pass at the end.
const jump = checkTaskTransition('NotStarted', 'Done');
jump && jump.code === 'ILLEGAL_TRANSITION'
  ? ok('work cannot jump from NotStarted to Done')
  : bad('work cannot jump from NotStarted to Done', JSON.stringify(jump));

const unknownStatus = checkTaskTransition('InProgress', 'Finished');
unknownStatus && unknownStatus.code === 'UNKNOWN_STATUS'
  ? ok('an invented status is refused by name')
  : bad('an invented status is refused by name', JSON.stringify(unknownStatus));

TASK_STATUSES.includes('Delayed') === false
  ? ok('Delayed is not a stored status — it is derived from the due date')
  : bad('Delayed is not a stored status');

// ── 7. Phase status derivation ──────────────────────────────────────────────
console.log('\n7. Phase status');

const T = (status) => ({ status });
eq('an empty phase is Not started', derivePhaseStatus([]), 'NotStarted');
eq('all tasks untouched is Not started',
   derivePhaseStatus([T('NotStarted'), T('NotStarted')]), 'NotStarted');
eq('all tasks done is Complete',
   derivePhaseStatus([T('Done'), T('Done')]), 'Complete');
eq('any movement is In progress',
   derivePhaseStatus([T('NotStarted'), T('InProgress')]), 'InProgress');
// Blocked outranks in-progress: a phase with four moving and one stuck is a
// phase that needs attention, and reporting it In progress hides that.
eq('one blocked task surfaces over four moving ones',
   derivePhaseStatus([T('InProgress'), T('InProgress'), T('InProgress'), T('InProgress'), T('Blocked')]),
   'Blocked');
eq('a blocked task does not hide completion of the rest',
   derivePhaseStatus([T('Done'), T('Done')]), 'Complete');

// ── 8. Rollup arithmetic ────────────────────────────────────────────────────
console.log('\n8. Rollup');

const task = (status, pct, weight, needsVerification) => ({
  status,
  completionPercent: pct === undefined ? 0 : pct,
  weight: weight === undefined ? 1 : weight,
  needsVerification: needsVerification === true,
});

eq('no tasks is zero, not a division by zero', weightedProgress([], () => 100), 0);

// The slice's own acceptance criterion: 10 tasks, 7 done, reports 70%.
const seven = [];
for (let i = 0; i < 7; i++) seven.push(task('Done'));
for (let i = 0; i < 3; i++) seven.push(task('NotStarted'));
eq('10 tasks with 7 done reports 70%', progressPair(seven).reported, 70);

eq('partial completion counts toward the total',
   progressPair([task('InProgress', 50), task('InProgress', 50)]).reported, 50);

// Weight is the whole point: one heavy task should not be outvoted by three
// trivial ones.
eq('a heavy task outweighs three light ones',
   progressPair([
     task('Done', 100, 7), task('NotStarted', 0, 1),
     task('NotStarted', 0, 1), task('NotStarted', 0, 1),
   ]).reported, 70);

eq('a zero weight is treated as one rather than vanishing',
   progressPair([task('Done', 100, 0), task('NotStarted', 0, 0)]).reported, 50);

eq('a reported percentage above 100 is clamped',
   progressPair([task('InProgress', 250)]).reported, 100);

eq('a negative percentage floors at zero',
   progressPair([task('InProgress', -40)]).reported, 0);

// Work that needs no reviewer is verified by being finished — otherwise an
// engagement that verifies only its deliverables could never reach 100%.
eq('work needing no reviewer is verified by being finished',
   progressPair([task('Done'), task('Done')]).verified, 100);
// Work that does need one is not, however finished it looks.
eq('finished work still awaiting a reviewer counts for nothing',
   progressPair([task('Done', 100, 1, true), task('Done', 100, 1, true)]).verified, 0);

eq('total weight sums the tasks', totalWeight([task('Done', 100, 3), task('Done', 100, 2)]), 5);

// ── 9. Hierarchy consistency ────────────────────────────────────────────────
// The project figure must equal a flat weighted average over every task. If the
// levels disagree, nobody can explain the number to a steering committee.
console.log('\n9. Hierarchy consistency');

const phaseA = [task('Done', 100, 2), task('NotStarted', 0, 2)];
const phaseB = [task('Done', 100, 1), task('Done', 100, 1), task('InProgress', 50, 4)];

const pairA = progressPair(phaseA);
const pairB = progressPair(phaseB);
const viaPhases = rollUpPhases([
  { totalWeight: totalWeight(phaseA), reported: pairA.reported, verified: pairA.verified },
  { totalWeight: totalWeight(phaseB), reported: pairB.reported, verified: pairB.verified },
]);
const viaFlat = progressPair(phaseA.concat(phaseB));

viaPhases.reported === viaFlat.reported
  ? ok('rolling up by phase equals averaging every task flat', viaPhases.reported + '%')
  : bad('rolling up by phase equals averaging every task flat',
        'hierarchical ' + viaPhases.reported + '% vs flat ' + viaFlat.reported + '%');

eq('phases holding no tasks contribute nothing rather than dragging the average',
   rollUpPhases([{ totalWeight: 0, reported: 0, verified: 0 }]).reported, 0);

// ── 10. Task timing ─────────────────────────────────────────────────────────
console.log('\n10. Task timing');

const lateTask = taskTiming({ status: 'InProgress', dueDate: D('2026-01-01') }, D('2026-01-11'));
lateTask.overdue && lateTask.daysOverdue === 10
  ? ok('an unfinished task past its date is overdue', lateTask.daysOverdue + ' days')
  : bad('an unfinished task past its date is overdue', JSON.stringify(lateTask));

const finished = taskTiming({ status: 'Done', dueDate: D('2026-01-01') }, D('2026-01-11'));
!finished.overdue
  ? ok('a finished task is never overdue, however late it was')
  : bad('a finished task is never overdue');

// Absence of a date is not a missed one. Treating it as late fills the dashboard
// with noise nobody can clear.
const undated = taskTiming({ status: 'InProgress', dueDate: null }, D('2026-06-01'));
!undated.overdue && undated.daysUntilDue === null
  ? ok('a task with no due date is never overdue')
  : bad('a task with no due date is never overdue', JSON.stringify(undated));

const soon = taskTiming({ status: 'InProgress', dueDate: D('2026-01-05') }, D('2026-01-01'));
soon.dueSoon && !soon.overdue
  ? ok('due within ' + DUE_SOON_DAYS + ' days is flagged as due soon')
  : bad('due soon flagging', JSON.stringify(soon));

const distant = taskTiming({ status: 'InProgress', dueDate: D('2026-03-01') }, D('2026-01-01'));
!distant.dueSoon && !distant.overdue
  ? ok('a distant date is neither due soon nor overdue')
  : bad('a distant date is neither', JSON.stringify(distant));

isComplete('Done') && !isComplete('InProgress')
  ? ok('completion is decided in one place') : bad('completion is decided in one place');

// ── 11. Verification policy ─────────────────────────────────────────────────
// The override truth table. Slice 5 added EvidenceTasks and its own cases live
// in section 24; these still hold unchanged, which is the point of asserting
// them here — a new policy value must not disturb the existing three.
console.log('\n11. Verification policy');

eq('EveryTask + no override  → required', requiresVerification('EveryTask', null), true);
eq('EveryTask + exempted     → not required', requiresVerification('EveryTask', false), false);
eq('EveryTask + confirmed    → required', requiresVerification('EveryTask', true), true);

eq('SelectedTasks + no override → not required', requiresVerification('SelectedTasks', null), false);
eq('SelectedTasks + selected    → required', requiresVerification('SelectedTasks', true), true);
eq('SelectedTasks + exempted    → not required', requiresVerification('SelectedTasks', false), false);

// None is absolute. A policy stating the engagement does no independent
// verification should not be reintroduced by a flag left on a single task.
eq('None + no override → not required', requiresVerification('None', null), false);
eq('None + selected    → still not required', requiresVerification('None', true), false);
eq('None + exempted    → not required', requiresVerification('None', false), false);

// undefined is what Prisma hands back for a null column read through a partial
// select, and it must mean the same thing as null rather than crashing.
eq('an undefined override behaves as no override',
   requiresVerification('EveryTask', undefined), true);

VERIFICATION_POLICIES.length === 4
  ? ok('four policies, no hidden fifth', VERIFICATION_POLICIES.join(' / '))
  : bad('four policies', VERIFICATION_POLICIES.join(','));

// ── 12. Verification states and routing ─────────────────────────────────────
console.log('\n12. Verification states');

['SubmittedForVerification', 'Verified', 'Rejected'].forEach((s) => {
  TASK_STATUSES.includes(s)
    ? ok('"' + s + '" is a real status') : bad('"' + s + '" is a real status');
});

// Both terminal states are complete; only one of them was checked by anybody.
isComplete('Verified') && isComplete('Done')
  ? ok('Done and Verified both count as complete')
  : bad('Done and Verified both count as complete');
!isComplete('SubmittedForVerification')
  ? ok('work sitting with a reviewer is not complete')
  : bad('work sitting with a reviewer is not complete');
// ...but the assignee has finished with it, which is a different question.
isDelivered('SubmittedForVerification') && !isDelivered('Rejected')
  ? ok('submitted work is delivered; rejected work is not')
  : bad('submitted work is delivered; rejected work is not');

// The submission path itself.
checkTaskTransition('InProgress', 'SubmittedForVerification') === null
  ? ok('work in progress can be submitted') : bad('work in progress can be submitted');
checkTaskTransition('SubmittedForVerification', 'Verified') === null
  ? ok('a submission can be accepted') : bad('a submission can be accepted');
checkTaskTransition('SubmittedForVerification', 'Rejected') === null
  ? ok('a submission can be rejected') : bad('a submission can be rejected');
checkTaskTransition('Rejected', 'InProgress') === null
  ? ok('rejected work goes back to in progress') : bad('rejected work goes back');

// The one that would defeat the whole module: skipping the reviewer entirely.
const skipReview = checkTaskTransition('InProgress', 'Verified');
skipReview && skipReview.code === 'ILLEGAL_TRANSITION'
  ? ok('work cannot become Verified without being submitted')
  : bad('work cannot become Verified without being submitted', JSON.stringify(skipReview));

const backToStart = checkTaskTransition('Verified', 'NotStarted');
backToStart && backToStart.code === 'ILLEGAL_TRANSITION'
  ? ok('verified work cannot be rewound to Not started')
  : bad('verified work cannot be rewound to Not started', JSON.stringify(backToStart));

// ── 13. The two symmetrical requirement rules ───────────────────────────────
console.log('\n13. Requirement rules');

// A task needing a reviewer must not have a second terminal state available,
// or the reviewer is optional in practice however loudly the policy says so.
const dodge = checkVerificationRule('Done', true);
dodge && dodge.code === 'VERIFICATION_REQUIRED'
  ? ok('work needing a reviewer cannot simply be marked Done')
  : bad('work needing a reviewer cannot be marked Done', JSON.stringify(dodge));

const noise = checkVerificationRule('SubmittedForVerification', false);
noise && noise.code === 'VERIFICATION_NOT_REQUIRED'
  ? ok('work needing no reviewer cannot be pushed into their queue')
  : bad('work needing no reviewer cannot be pushed into their queue', JSON.stringify(noise));

checkVerificationRule('Done', false) === null
  ? ok('ordinary work can still be marked Done') : bad('ordinary work can be marked Done');
checkVerificationRule('SubmittedForVerification', true) === null
  ? ok('work needing a reviewer can be submitted') : bad('work needing a reviewer can be submitted');
checkVerificationRule('Blocked', true) === null
  ? ok('the rule says nothing about unrelated moves') : bad('the rule says nothing about unrelated moves');

// Routing: an ordinary task update must not be able to carry a verification.
console.log('\n   routing away from the ordinary update path');
VERIFICATION_STATES.forEach((s) => {
  const r = checkVerificationRouting('InProgress', s);
  r && r.code === 'USE_VERIFICATION_ENDPOINT'
    ? ok('PATCH cannot set ' + s)
    : bad('PATCH cannot set ' + s, JSON.stringify(r));
});
['SubmittedForVerification', 'Verified'].forEach((s) => {
  const r = checkVerificationRouting(s, 'InProgress');
  r && r.code === 'USE_VERIFICATION_ENDPOINT'
    ? ok('PATCH cannot move work out of ' + s)
    : bad('PATCH cannot move work out of ' + s, JSON.stringify(r));
});
// Rejected is ordinary work again — forcing rework through a verification
// endpoint would be ceremony with no control behind it.
checkVerificationRouting('Rejected', 'InProgress') === null
  ? ok('picking rejected work back up is an ordinary update')
  : bad('picking rejected work back up is an ordinary update');
checkVerificationRouting('InProgress', 'Done') === null
  ? ok('ordinary moves are left alone') : bad('ordinary moves are left alone');

// ── 13b. The composed verdict, and the order it applies the three rules ─────
// This ordering was wrong when first written: checking the table first answers
// a PATCH of status "Verified" with "a task cannot go from InProgress to
// Verified", which is true and useless — it sends the reader off to submit the
// task and be refused a second time. Asserted here so it cannot drift back.
console.log('\n13b. The composed verdict');

const verdict = (from, to, needs) => {
  const r = checkTaskUpdate(from, to, needs);
  return r ? r.code : null;
};

eq('needing a reviewer beats pointing at another endpoint',
   verdict('InProgress', 'Done', true), 'VERIFICATION_REQUIRED');
eq('needing no reviewer is said plainly, not routed elsewhere',
   verdict('InProgress', 'SubmittedForVerification', false), 'VERIFICATION_NOT_REQUIRED');
eq('setting Verified points at the endpoint, not at the table',
   verdict('InProgress', 'Verified', true), 'USE_VERIFICATION_ENDPOINT');
eq('so does setting Rejected',
   verdict('InProgress', 'Rejected', true), 'USE_VERIFICATION_ENDPOINT');
eq('and so does submitting work that genuinely needs it',
   verdict('InProgress', 'SubmittedForVerification', true), 'USE_VERIFICATION_ENDPOINT');
eq('withdrawing is routed too',
   verdict('SubmittedForVerification', 'InProgress', true), 'USE_VERIFICATION_ENDPOINT');
eq('an invented status is still named as such',
   verdict('InProgress', 'Finished', false), 'UNKNOWN_STATUS');
eq('an impossible ordinary move is still impossible',
   verdict('NotStarted', 'Done', false), 'ILLEGAL_TRANSITION');
eq('an ordinary move is allowed', verdict('InProgress', 'Done', false), null);
eq('picking rejected work back up is allowed',
   verdict('Rejected', 'InProgress', true), null);

// ── 14. Separation of duties ────────────────────────────────────────────────
// The load-bearing control. If any of these four pass, the second progress
// figure means nothing and the module is a task tracker with extra columns.
console.log('\n14. Separation of duties');

const sodSelf = checkSeparationOfDuties({
  actorId: 'u1', assigneeId: 'u1', submittedById: 'u2',
});
sodSelf && sodSelf.code === 'SELF_VERIFICATION'
  ? ok('the assignee cannot verify their own task')
  : bad('the assignee cannot verify their own task', JSON.stringify(sodSelf));

const sodSubmitter = checkSeparationOfDuties({
  actorId: 'u2', assigneeId: 'u1', submittedById: 'u2',
});
sodSubmitter && sodSubmitter.code === 'SELF_VERIFICATION'
  ? ok('whoever submitted it cannot verify it either')
  : bad('whoever submitted it cannot verify it', JSON.stringify(sodSubmitter));

// The manager who submitted on someone else's behalf is still the submitter.
const sodProxy = checkSeparationOfDuties({
  actorId: 'mgr', assigneeId: 'u1', submittedById: 'mgr',
});
sodProxy
  ? ok('submitting on behalf of someone else still disqualifies you')
  : bad('submitting on behalf of someone else still disqualifies you');

checkSeparationOfDuties({ actorId: 'u3', assigneeId: 'u1', submittedById: 'u2' }) === null
  ? ok('a third party may verify') : bad('a third party may verify');

// An unassigned task submitted by someone else is verifiable — there is no
// assignee to collide with, and refusing would strand the work.
checkSeparationOfDuties({ actorId: 'u3', assigneeId: null, submittedById: 'u2' }) === null
  ? ok('an unassigned task is verifiable by anyone who did not submit it')
  : bad('an unassigned task is verifiable by anyone who did not submit it');

// ── 15. Verified progress ───────────────────────────────────────────────────
console.log('\n15. Verified progress');

const needing = (status, pct, weight) => task(status, pct, weight, true);

eq('a verified task counts fully', progressPair([needing('Verified', 100)]).verified, 100);
eq('a submitted task counts for nothing yet',
   progressPair([needing('SubmittedForVerification', 100)]).verified, 0);
eq('a rejected task counts for nothing',
   progressPair([needing('Rejected', 90)]).verified, 0);

// Submitted work still reports 100 — the claim was made, it just has not been
// accepted. This gap between the two numbers is the entire point.
eq('a submitted task still reports what was claimed',
   progressPair([needing('SubmittedForVerification', 100)]).reported, 100);

// A mixed engagement: five tasks, three verified, one waiting, one exempt-and-done.
const mixed = [
  needing('Verified', 100), needing('Verified', 100), needing('Verified', 100),
  needing('SubmittedForVerification', 100),
  task('Done', 100),
];
eq('a mixed phase reports everything claimed', progressPair(mixed).reported, 100);
eq('and verifies only what was accepted or needed no acceptance',
   progressPair(mixed).verified, 80);

// The invariant that must hold for any set of tasks whatsoever: every task
// counting toward verified also counts fully toward reported, so a project can
// never show more confirmed than claimed.
console.log('\n   the invariant, over every state and both requirements');
let invariantHeld = true;
let worst = null;
TASK_STATUSES.forEach((status) => {
  [true, false].forEach((needs) => {
    [0, 37, 100].forEach((pct) => {
      [1, 5].forEach((w) => {
        const pair = progressPair([{
          status, completionPercent: pct, weight: w, needsVerification: needs,
        }]);
        if (pair.verified > pair.reported) {
          invariantHeld = false;
          worst = status + '/' + needs + '/' + pct + ' → ' + pair.verified + ' > ' + pair.reported;
        }
      });
    });
  });
});
invariantHeld
  ? ok('verified never exceeds reported', TASK_STATUSES.length * 12 + ' combinations')
  : bad('verified never exceeds reported', worst);

// Hierarchy consistency has to survive the second dimension too, or the two
// numbers agree at task level and diverge at project level.
const vPhaseA = [needing('Verified', 100, 2), needing('SubmittedForVerification', 100, 2)];
const vPhaseB = [task('Done', 100, 1), needing('Rejected', 50, 3)];
const vPairA = progressPair(vPhaseA);
const vPairB = progressPair(vPhaseB);
const vHier = rollUpPhases([
  { totalWeight: totalWeight(vPhaseA), reported: vPairA.reported, verified: vPairA.verified },
  { totalWeight: totalWeight(vPhaseB), reported: vPairB.reported, verified: vPairB.verified },
]);
const vFlat = progressPair(vPhaseA.concat(vPhaseB));
vHier.verified === vFlat.verified
  ? ok('verified rolls up consistently too', vHier.verified + '%')
  : bad('verified rolls up consistently', 'hierarchical ' + vHier.verified + ' vs flat ' + vFlat.verified);

// ── 16. Counts and review latency ───────────────────────────────────────────
console.log('\n16. Counts and review latency');

const now16 = D('2026-03-01');
const counted = taskCounts([
  { status: 'Verified', dueDate: null, needsVerification: true },
  { status: 'Done', dueDate: null },
  { status: 'SubmittedForVerification', dueDate: D('2026-02-01'), submittedAt: D('2026-02-27'), needsVerification: true },
  { status: 'Rejected', dueDate: D('2026-02-01'), needsVerification: true },
  { status: 'Blocked', dueDate: D('2026-03-04') },
  { status: 'InProgress', dueDate: D('2026-06-01') },
  { status: 'NotStarted', dueDate: null },
], now16);

eq('total counts every task', counted.total, 7);
eq('done counts Done and Verified together', counted.done, 2);
eq('verified is counted separately', counted.verified, 1);
eq('one task is awaiting a reviewer', counted.awaitingVerification, 1);
eq('one task came back rejected', counted.rejected, 1);
eq('three tasks will need a reviewer', counted.needsVerification, 3);
eq('one task is blocked', counted.blocked, 1);
// The submitted task is a month past its date but the assignee handed it over;
// only the rejected one is still owed by somebody.
eq('submitted work is not counted against the person who delivered it', counted.overdue, 1);
eq('the blocked task is due this week', counted.dueSoon, 1);

// Reviewer latency is its own measurement, on its own clock.
const waiting = taskTiming(
  { status: 'SubmittedForVerification', dueDate: null, submittedAt: D('2026-02-20') },
  D('2026-03-01'),
);
waiting.awaitingVerificationDays === 9 && waiting.verificationOverdue
  ? ok('a submission sitting ' + waiting.awaitingVerificationDays + ' days is flagged',
       'window is ' + VERIFICATION_SLA_DAYS + ' days')
  : bad('a long-waiting submission is flagged', JSON.stringify(waiting));

const fresh = taskTiming(
  { status: 'SubmittedForVerification', dueDate: null, submittedAt: D('2026-02-28') },
  D('2026-03-01'),
);
!fresh.verificationOverdue && fresh.awaitingVerificationDays === 1
  ? ok('a fresh submission is not the reviewer being late')
  : bad('a fresh submission is not late', JSON.stringify(fresh));

const notWaiting = taskTiming({ status: 'InProgress', dueDate: null }, D('2026-03-01'));
notWaiting.awaitingVerificationDays === null && !notWaiting.verificationOverdue
  ? ok('work nobody submitted is not waiting on anybody')
  : bad('work nobody submitted is not waiting', JSON.stringify(notWaiting));

// ── 17. Slippage against the agreed plan ────────────────────────────────────
console.log('\n17. Slippage');

eq('a date moved five days later has slipped five days',
   slippage({ baselineDueDate: D('2026-01-10'), dueDate: D('2026-01-15') }).slipDays, 5);
eq('a date pulled in reports negative, not zero',
   slippage({ baselineDueDate: D('2026-01-10'), dueDate: D('2026-01-07') }).slipDays, -3);
eq('a date still on plan has slipped nothing',
   slippage({ baselineDueDate: D('2026-01-10'), dueDate: D('2026-01-10') }).slipDays, 0);

// Not baselined is not the same as not slipped. A task with no agreed date must
// never be reported as being on plan — there is no plan for it to be on.
const unplanned = slippage({ baselineDueDate: null, dueDate: D('2026-01-10') });
!unplanned.baselined && !unplanned.slipped
  ? ok('a task with no agreed date is unbaselined, not on time')
  : bad('a task with no agreed date is unbaselined', JSON.stringify(unplanned));

slippage({ baselineDueDate: D('2026-01-10'), dueDate: D('2026-01-15') }).slipped
  ? ok('pushing a date out counts as slipped') : bad('pushing a date out counts as slipped');
!slippage({ baselineDueDate: D('2026-01-10'), dueDate: D('2026-01-07') }).slipped
  ? ok('pulling one in does not') : bad('pulling one in does not');

signedDays(D('2026-01-01'), D('2026-01-01')) === 0 && signedDays(D('2026-02-01'), D('2026-01-01')) === -31
  ? ok('day arithmetic is signed here, unlike the schedule helper')
  : bad('day arithmetic is signed', String(signedDays(D('2026-02-01'), D('2026-01-01'))));

// ── 18. When a date change has to be explained ──────────────────────────────
// The test is against the BASELINE, not against today. A rule that waits for a
// date to pass only ever catches slips after they have cost something.
console.log('\n18. The delay-reason rule');

const needsReason = (base, cur, next) =>
  requiresDelayReason(base ? D(base) : null, cur ? D(cur) : null, next ? D(next) : null);

needsReason('2026-01-10', '2026-01-10', '2026-01-20')
  ? ok('pushing a date past the agreed one must be explained')
  : bad('pushing a date past the agreed one must be explained');
!needsReason(null, '2026-01-10', '2026-01-20')
  ? ok('an unbaselined task is still being planned, so it moves freely')
  : bad('an unbaselined task moves freely');
!needsReason('2026-01-20', '2026-01-10', '2026-01-15')
  ? ok('a date landing inside the agreed one costs nobody anything')
  : bad('a date inside the agreed one is free');
!needsReason('2026-01-10', '2026-01-30', '2026-01-20')
  ? ok('pulling a slipped date back in needs no defending')
  : bad('pulling a slipped date back in needs no defending');
needsReason('2026-01-10', '2026-01-30', '2026-02-05')
  ? ok('a second slip is explained again, not waved through')
  : bad('a second slip is explained again');
!needsReason('2026-01-10', '2026-01-30', '2026-01-30')
  ? ok('re-sending the same date is not a slip')
  : bad('re-sending the same date is not a slip');
!needsReason('2026-01-10', '2026-01-10', null)
  ? ok('clearing a date entirely is not a slip')
  : bad('clearing a date is not a slip');

// ── 19. What an impediment costs ────────────────────────────────────────────
console.log('\n19. Impediment cost');

const imp = (o) => Object.assign({
  kind: 'Blocker', category: 'Other', owingSide: 'Client',
  impactDays: null, raisedAt: D('2026-01-01'), resolvedAt: null,
}, o);

eq('an open blocker costs the time it has been open',
   impedimentCost(imp({}), D('2026-01-09')), 8);
// Stamped on resolution, because a blocker stops accruing when it clears — a
// column that keeps counting would be wrong from the moment it mattered.
eq('a cleared blocker costs what was stamped on it',
   impedimentCost(imp({ impactDays: 4, resolvedAt: D('2026-01-20') }), D('2026-06-01')), 4);
eq('a blocker cleared without a stamp falls back to its duration',
   impedimentCost(imp({ resolvedAt: D('2026-01-06') }), D('2026-06-01')), 5);
eq('a recorded delay costs the days it stated',
   impedimentCost(imp({ kind: 'Delay', impactDays: 12, resolvedAt: D('2026-01-01') }), D('2026-02-01')), 12);
eq('nothing costs a negative number of days',
   impedimentCost(imp({ impactDays: -5 }), D('2026-01-09')), 0);
eq('a blocker raised today has cost nothing yet',
   impedimentCost(imp({}), D('2026-01-01')), 0);

isOpen(imp({})) && !isOpen(imp({ resolvedAt: D('2026-01-05') }))
  ? ok('open means an uncleared blocker') : bad('open means an uncleared blocker');
!isOpen(imp({ kind: 'Delay' }))
  ? ok('a delay is never open — the time is already gone')
  : bad('a delay is never open');

// ── 20. Attribution — the question the register exists to answer ────────────
console.log('\n20. Attribution');

const register = [
  imp({ owingSide: 'Client', category: 'ClientDependency', impactDays: 14, resolvedAt: D('2026-01-15') }),
  imp({ owingSide: 'Client', category: 'ClientDependency', impactDays: 6, resolvedAt: D('2026-01-20'), kind: 'Delay' }),
  imp({ owingSide: 'Provider', category: 'ProviderCapacity', impactDays: 3, resolvedAt: D('2026-01-04') }),
  imp({ owingSide: 'ThirdParty', category: 'ThirdParty' }), // still open
];
const att = attribute(register, D('2026-01-06'));

eq('every day lost is counted once', att.totalDays, 14 + 6 + 3 + 5);
eq('the client carries its own days', att.bySide.Client, 20);
eq('the provider carries its own', att.bySide.Provider, 3);
eq('and the open third-party blocker keeps accruing', att.bySide.ThirdParty, 5);
eq('one blocker is still open', att.openCount, 1);
eq('the rest are closed', att.resolvedCount, 3);
eq('categories sum alongside sides', att.byCategory.ClientDependency, 20);
eq('the side carrying the most days is named', att.largestSide, 'Client');

// Zero-day sides are present on purpose. A report reading "Client 0,
// Provider 12" says something that silently omitting the client does not —
// and the omission reads as an accusation rather than a measurement.
const oneSided = attribute([imp({ owingSide: 'Provider', impactDays: 12, resolvedAt: D('2026-01-05') })], D('2026-02-01'));
oneSided.bySide.Client === 0 && oneSided.bySide.ThirdParty === 0
  ? ok('sides that lost nothing are still reported, at zero')
  : bad('sides that lost nothing are reported at zero', JSON.stringify(oneSided.bySide));

const empty = attribute([], D('2026-01-01'));
empty.totalDays === 0 && empty.largestSide === null
  ? ok('a clean engagement blames nobody')
  : bad('a clean engagement blames nobody', JSON.stringify(empty));

// The sum has to survive being split. If the sides do not add to the total,
// the register is producing two different answers to the same question.
Object.values(att.bySide).reduce((a, b) => a + b, 0) === att.totalDays
  ? ok('the sides add up to the total', att.totalDays + ' days')
  : bad('the sides add up to the total');
Object.values(att.byCategory).reduce((a, b) => a + b, 0) === att.totalDays
  ? ok('so do the categories') : bad('the categories add up to the total');

// ── 21. Blocked is reached by recording what the blocker is ─────────────────
console.log('\n21. Block routing');

const blockIn = checkBlockRouting('InProgress', 'Blocked');
blockIn && blockIn.code === 'USE_IMPEDIMENT_ENDPOINT'
  ? ok('an ordinary update cannot set Blocked')
  : bad('an ordinary update cannot set Blocked', JSON.stringify(blockIn));
const blockOut = checkBlockRouting('Blocked', 'InProgress');
blockOut && blockOut.code === 'USE_IMPEDIMENT_ENDPOINT'
  ? ok('nor clear it — the blocker is cleared, not the status')
  : bad('nor clear it', JSON.stringify(blockOut));
checkBlockRouting('InProgress', 'Done') === null
  ? ok('unrelated moves are left alone') : bad('unrelated moves are left alone');

// And it is part of the one composed verdict, so the ordering is settled in
// the same place as everything else rather than in a controller.
eq('the composed verdict routes Blocked too',
   (checkTaskUpdate('InProgress', 'Blocked', false) || {}).code, 'USE_IMPEDIMENT_ENDPOINT');
eq('and routes the way out of it',
   (checkTaskUpdate('Blocked', 'NotStarted', false) || {}).code, 'USE_IMPEDIMENT_ENDPOINT');
// Verification still wins where both could apply, because "this needs a
// reviewer" is the more useful sentence than "use the blocker endpoint".
eq('verification is still answered first',
   (checkTaskUpdate('InProgress', 'Done', true) || {}).code, 'VERIFICATION_REQUIRED');

// ── 22. The impediment vocabulary ───────────────────────────────────────────
console.log('\n22. Vocabulary');

checkImpedimentInput({ kind: 'Blocker', category: 'ClientDependency', owingSide: 'Client' }) === null
  ? ok('a well-formed impediment is accepted') : bad('a well-formed impediment is accepted');
eq('an invented category is refused',
   (checkImpedimentInput({ category: 'Vibes', owingSide: 'Client' }) || {}).code, 'UNKNOWN_CATEGORY');
eq('a missing category is refused too',
   (checkImpedimentInput({ owingSide: 'Client' }) || {}).code, 'UNKNOWN_CATEGORY');
eq('an invented side is refused',
   (checkImpedimentInput({ category: 'Other', owingSide: 'Them' }) || {}).code, 'UNKNOWN_SIDE');
eq('an invented kind is refused',
   (checkImpedimentInput({ kind: 'Grumble', category: 'Other', owingSide: 'Client' }) || {}).code,
   'UNKNOWN_KIND');

OWING_SIDES.includes('ThirdParty')
  ? ok('a third party can owe the time, not just the two signatories')
  : bad('a third party can owe the time');
IMPEDIMENT_CATEGORIES.includes('Other')
  ? ok('there is an escape hatch, so nobody picks the nearest wrong answer')
  : bad('there is an escape hatch');

eq('a delay cannot be resolved — the time is already lost',
   (checkResolvable({ kind: 'Delay', resolvedAt: null }) || {}).code, 'NOT_A_BLOCKER');
eq('nor can an already-cleared blocker',
   (checkResolvable({ kind: 'Blocker', resolvedAt: D('2026-01-01') }) || {}).code, 'ALREADY_RESOLVED');
checkResolvable({ kind: 'Blocker', resolvedAt: null }) === null
  ? ok('an open blocker can be cleared') : bad('an open blocker can be cleared');

// ── 23. What a reschedule costs ─────────────────────────────────────────────
// Measured as the increase in slip against the agreed date, not the distance
// the date travelled. Charging the distance would count an earlier improvement
// as a fresh loss and let the register report more days lost than the task has
// actually slipped.
console.log('\n23. Reschedule cost');

const cost = (base, cur, next) => slipCost(D(base), cur ? D(cur) : null, D(next));

eq('a first slip costs the days it slipped', cost('2026-01-10', '2026-01-10', '2026-01-20'), 10);
eq('a second slip costs only the new days', cost('2026-01-10', '2026-01-30', '2026-02-04'), 5);
// The case that made the naive version wrong: a date pulled in, then pushed out.
eq('an earlier improvement is not re-charged as a loss',
   cost('2026-01-10', '2026-01-05', '2026-01-20'), 10);
eq('moving back inside the agreed date costs nothing',
   cost('2026-01-20', '2026-01-30', '2026-01-15'), 0);
eq('a task with no current date slips from the agreed one',
   cost('2026-01-10', null, '2026-01-18'), 8);

// Charges are gross: a date pulled back in is never refunded, because the
// recovery was somebody's work and netting it off would let effort by one side
// silently cancel days attributed to the other.
const baseline = D('2026-01-10');
const runCharges = (moves) => {
  let standing = D('2026-01-10');
  let charged = 0;
  moves.forEach((next) => {
    charged += slipCost(baseline, standing, D(next));
    standing = D(next);
  });
  return { charged, slip: slippage({ baselineDueDate: baseline, dueDate: standing }).slipDays };
};

// Nothing pulled in: the episodes sum to exactly the slip, so the register and
// the schedule tell the same story.
const monotonic = runCharges(['2026-01-20', '2026-01-25', '2026-02-10']);
monotonic.charged === monotonic.slip
  ? ok('with no recoveries, the days charged equal the slip', monotonic.charged + ' days')
  : bad('the days charged equal the slip',
        'charged ' + monotonic.charged + ' vs slip ' + monotonic.slip);

// With a recovery in the middle, the gross total is higher — and that gap is
// the recovered time, which belongs to whoever did the recovering.
const churned = runCharges(['2026-01-05', '2026-01-25', '2026-01-22', '2026-02-10']);
churned.charged > churned.slip
  ? ok('a recovery is not refunded to whoever caused the slip',
       churned.charged + ' days charged against a ' + churned.slip + '-day net position')
  : bad('a recovery is not refunded',
        'charged ' + churned.charged + ' vs slip ' + churned.slip);

// ── 24. The EvidenceTasks policy ────────────────────────────────────────────
// Nine cases, because the precedence between a policy and a task-level override
// is the kind of thing that looks obviously right and is quietly wrong.
console.log('\n24. Verification policy');

const needs = (policy, override, hasEvidence) =>
  requiresVerification(policy, override, hasEvidence);

needs('EveryTask', null, false) ? ok('EveryTask needs a reviewer by default') : bad('EveryTask default');
!needs('SelectedTasks', null, false) ? ok('SelectedTasks does not, until marked') : bad('SelectedTasks default');
needs('SelectedTasks', true, false) ? ok('a marked task under SelectedTasks does') : bad('SelectedTasks marked');
!needs('EveryTask', false, false) ? ok('an exempted task under EveryTask does not') : bad('EveryTask exempt');

// The new branch: verification follows the deliverable.
needs('EvidenceTasks', null, true)
  ? ok('EvidenceTasks sends work that produced something to a reviewer')
  : bad('EvidenceTasks with evidence');
!needs('EvidenceTasks', null, false)
  ? ok('and does not send work that produced nothing to review')
  : bad('EvidenceTasks without evidence');
needs('EvidenceTasks', true, false)
  ? ok('an explicit mark still wins under EvidenceTasks')
  : bad('EvidenceTasks explicit true');
!needs('EvidenceTasks', false, true)
  ? ok('and an explicit exemption still wins over a file')
  : bad('EvidenceTasks explicit false');

// None is a statement about the whole engagement. Neither a task-level flag nor
// a file somebody attached may switch a workflow back on that was turned off.
!needs('None', true, true)
  ? ok('None outranks both a mark and a deliverable')
  : bad('None outranks everything');
VERIFICATION_POLICIES.includes('EvidenceTasks')
  ? ok('EvidenceTasks is a real policy value now') : bad('EvidenceTasks is offered');

// ── 25. What the reviewer actually saw ──────────────────────────────────────
console.log('\n25. Evidence standing');

const ev = (round, withdrawn) => ({ uploadedInRound: round, withdrawnAt: withdrawn || null });
const tk = (status, round) => ({ status, verificationRound: round });

eq('evidence on unverified work is still pending',
   evidenceStanding(ev(1), tk('InProgress', 0)), 'Pending');
eq('evidence offered in the accepted round was seen',
   evidenceStanding(ev(1), tk('Verified', 1)), 'Seen');
eq('evidence from an earlier round was seen too',
   evidenceStanding(ev(1), tk('Verified', 3)), 'Seen');
eq('retracted evidence reads as withdrawn, whatever else is true',
   evidenceStanding(ev(1, D('2026-02-01')), tk('Verified', 3)), 'Withdrawn');

// The reading that matters: a file that appeared after the sign-off it seems to
// support. The upload path refuses this, but a rule enforced in a controller
// and a fact derivable from the data are different guarantees, and reports are
// built on the second.
eq('evidence from a later round was NOT in front of the person who signed',
   evidenceStanding(ev(4), tk('Verified', 2)), 'AddedLater');

hasStandingEvidence([ev(1)]) ? ok('standing evidence counts') : bad('standing evidence counts');
!hasStandingEvidence([ev(1, D('2026-01-01'))])
  ? ok('withdrawn evidence does not — or withdrawing keeps the credit and drops the substance')
  : bad('withdrawn evidence does not count');
!hasStandingEvidence([]) ? ok('no evidence is no evidence') : bad('no evidence is no evidence');

// ── 26. Evidence cannot move under a signature ──────────────────────────────
console.log('\n26. Immutability rules');

eq('evidence cannot be attached to verified work',
   (checkEvidenceAttachable({ status: 'Verified' }) || {}).code, 'TASK_VERIFIED');
checkEvidenceAttachable({ status: 'InProgress' }) === null
  ? ok('but attaches freely to work in flight') : bad('attaches to work in flight');
checkEvidenceAttachable({ status: 'Rejected' }) === null
  ? ok('and to work sent back for rework') : bad('attaches to rejected work');

eq('evidence a verifier relied on cannot be withdrawn',
   (checkEvidenceWithdrawable(ev(1), tk('Verified', 1)) || {}).code, 'EVIDENCE_LOCKED');
checkEvidenceWithdrawable(ev(1), tk('InProgress', 0)) === null
  ? ok('unverified evidence can be withdrawn') : bad('unverified evidence can be withdrawn');
eq('and nothing is withdrawn twice',
   (checkEvidenceWithdrawable(ev(1, D('2026-01-01')), tk('InProgress', 0)) || {}).code,
   'ALREADY_WITHDRAWN');

// ── 27. What may be stored ──────────────────────────────────────────────────
console.log('\n27. File rules');

checkEvidenceFile('scope-statement.pdf', 1024) === null
  ? ok('a PDF is evidence') : bad('a PDF is evidence');
eq('an empty file is not', (checkEvidenceFile('x.pdf', 0) || {}).code, 'EMPTY_FILE');
eq('nor is a disk image',
   (checkEvidenceFile('backup.pdf', MAX_EVIDENCE_BYTES + 1) || {}).code, 'FILE_TOO_LARGE');

// Markup stored and later handed back from the API's own origin is a script
// running as the application, so it is refused outright.
['report.html', 'diagram.svg', 'thing.js', 'setup.exe'].forEach((name) => {
  const r = checkEvidenceFile(name, 500);
  r && r.code === 'DANGEROUS_TYPE'
    ? ok('refused as evidence: ' + name)
    : bad('refused as evidence: ' + name, JSON.stringify(r));
});
checkEvidenceFile('EVIDENCE.PDF', 500) === null
  ? ok('the extension check is case-insensitive') : bad('extension check is case-insensitive');
eq('a file with no extension has none', extensionOf('READ_ME'), '');

// ── 28. The type comes from the bytes, not the caller ───────────────────────
// A declared content type is a chosen one, and it decides how a browser later
// treats the download.
console.log('\n28. Type sniffing');

eq('a PDF is recognised by its signature',
   sniffMime([0x25, 0x50, 0x44, 0x46, 0x2d], 'anything.txt'), 'application/pdf');
eq('so is a PNG', sniffMime([0x89, 0x50, 0x4e, 0x47], 'x.png'), 'image/png');
eq('and a JPEG', sniffMime([0xff, 0xd8, 0xff, 0xe0], 'x.jpg'), 'image/jpeg');
// A .docx IS a zip; only the extension separates them, and trusting it here is
// safe because the bytes already agreed it is a zip container.
eq('a docx is a zip that the extension disambiguates',
   sniffMime([0x50, 0x4b, 0x03, 0x04], 'minutes.docx'),
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
eq('a bare zip stays a zip',
   sniffMime([0x50, 0x4b, 0x03, 0x04], 'bundle.zip'), 'application/zip');
// The lie that matters: a file NAMED .pdf whose bytes are not a PDF.
eq('a mislabelled file is not taken at its word',
   sniffMime([0x00, 0x01, 0x02, 0x03], 'definitely-a.pdf'), 'application/octet-stream');

// ── 29. Traceability coverage ───────────────────────────────────────────────
// Two figures, deliberately separate: clauses a plan MENTIONS are an intention,
// clauses whose every task is finished are something you can defend in an audit.
console.log('\n29. Coverage');

const T5 = (status, ...clauses) => ({
  id: 't' + status + clauses.join(''),
  status,
  clauseLinks: clauses.map((c) => ({ clauseId: c, standardCode: c.split('-')[0] })),
});

const plan = [
  T5('Verified', 'ISO27001-A5'),
  T5('Done', 'ISO27001-A5'),
  T5('InProgress', 'ISO27001-A8'),
  T5('Done', 'SOC2-CC1'),
  T5('NotStarted'),
];
const cov = clauseCoverage(plan, isComplete);

eq('every distinct clause the plan touches is counted', cov.clausesCovered, 3);
eq('tasks carrying a clause link', cov.tasksMapped, 4);
eq('out of the whole plan', cov.tasksTotal, 5);
eq('mapped percentage', cov.mappedPercent, 80);
// A.5 has two tasks and both are complete; CC1 has one and it is complete.
// A.8's only task is still in flight, so the clause is claimed but not defensible.
eq('only clauses whose every task is finished are satisfied', cov.clausesSatisfied, 2);
eq('per-standard: ISO covers two clauses', cov.byStandard['ISO27001'].covered, 2);
eq('and defends one of them', cov.byStandard['ISO27001'].satisfied, 1);
eq('SOC2 defends its only one', cov.byStandard['SOC2'].satisfied, 1);

// Verified counts as complete for coverage, exactly as it does for progress —
// one definition of finished across the module.
clauseCoverage([T5('Verified', 'ISO27001-A5')], isComplete).clausesSatisfied === 1
  ? ok('verified work satisfies a clause, same as done work')
  : bad('verified work satisfies a clause');

const emptyPlan = clauseCoverage([], isComplete);
emptyPlan.mappedPercent === 0 && emptyPlan.clausesCovered === 0
  ? ok('an empty plan traces nowhere, without dividing by zero')
  : bad('an empty plan traces nowhere', JSON.stringify(emptyPlan));

// A plan with tasks but no links traces nothing — which must read as 0%, not as
// full coverage of an empty clause set.
const unmapped = clauseCoverage([T5('Done'), T5('Done')], isComplete);
unmapped.mappedPercent === 0 && unmapped.clausesSatisfied === 0
  ? ok('finished work with no clause links proves nothing about a framework')
  : bad('unmapped work proves nothing', JSON.stringify(unmapped));

// ── 30. Colour handling ─────────────────────────────────────────────────────
console.log('\n30. Brand colour');

eq('a hex colour normalises', normaliseHex('#0f7a5a'), '#0F7A5A');
eq('the hash is optional on input', normaliseHex('0f7a5a'), '#0F7A5A');
eq('surrounding space is tolerated', normaliseHex('  #0F7A5A '), '#0F7A5A');
// Strict on purpose: this value is written into a PDF, a DOCX theme and an XLSX
// fill, and guessing at shorthand would put a different colour in each.
normaliseHex('#fff') === null ? ok('three-digit shorthand is refused') : bad('shorthand refused');
normaliseHex('rebeccapurple') === null ? ok('a named colour is refused') : bad('named colour refused');
normaliseHex('rgb(0,0,0)') === null ? ok('rgb() is refused') : bad('rgb refused');
normaliseHex('') === null ? ok('empty is not a colour') : bad('empty is not a colour');
normaliseHex(null) === null ? ok('null is not a colour') : bad('null is not a colour');

eq('docx and xlsx want the bare digits', bareHex('#0F7A5A'), '0F7A5A');
eq('xlsx wants ARGB', argbHex('#0F7A5A'), 'FF0F7A5A');

// ── 31. Contrast ────────────────────────────────────────────────────────────
// A pale corporate colour is a legitimate brand and an illegitimate heading.
console.log('\n31. Contrast');

eq('black on white is the maximum ratio', contrastRatio('#000000', '#FFFFFF'), 21);
eq('a colour against itself has no contrast', contrastRatio('#0F7A5A', '#0F7A5A'), 1);
contrastRatio('#0F7A5A', '#FFFFFF') >= MIN_TEXT_CONTRAST
  ? ok('the default brand is readable on paper', String(contrastRatio('#0F7A5A', '#FFFFFF')))
  : bad('default brand is readable');

// The case that drove this: a real corporate cream, legitimate as a brand and
// unreadable as a heading.
const cream = '#FDF3E2';
contrastRatio(cream, '#FFFFFF') < MIN_TEXT_CONTRAST
  ? ok('a pale cream fails as text on white', String(contrastRatio(cream, '#FFFFFF')))
  : bad('pale cream fails as text');
eq('so text falls back to ink rather than vanishing', readableOn(cream), INK);
eq('while a legible brand is kept for text', readableOn('#0F7A5A'), '#0F7A5A');
// Contrast is symmetric — the ratio does not depend on which is foreground.
eq('the ratio is symmetric',
   contrastRatio('#0F7A5A', '#FFFFFF'), contrastRatio('#FFFFFF', '#0F7A5A'));

eq('white reads on a dark brand', inkOn('#0B1524'), PAPER);
eq('and ink reads on a pale one', inkOn(cream), INK);

// ── 32. What branding may never colour ──────────────────────────────────────
// draftNotice() forces a DRAFT banner onto every report for an engagement that
// is not Closed. If a tenant's livery reached that banner they could set the
// cream above and make the warning invisible — which is not theming, it is
// falsifying a report.
console.log('\n32. Unbrandable elements');

!isBrandable('draftNotice') ? ok('the draft banner cannot be branded') : bad('draft banner unbrandable');
!isBrandable('warning') ? ok('nor can a warning') : bad('warning unbrandable');
!isBrandable('overdue') ? ok('nor an overdue marker') : bad('overdue unbrandable');
isBrandable('heading') ? ok('but headings can be') : bad('headings brandable');
isBrandable('rule') ? ok('and rules') : bad('rules brandable');

// ── 33. Markings ────────────────────────────────────────────────────────────
console.log('\n33. Confidentiality marking');

eq('a valid marking survives', normaliseMarking('Restricted'), 'Restricted');
// A GRC report lists an organisation's unremediated weaknesses. Defaulting to
// the safest marking is the only defensible behaviour for an unknown value.
eq('an unknown marking falls to the safest default', normaliseMarking('Whatever'), DEFAULT_MARKING);
eq('so does nothing at all', normaliseMarking(null), DEFAULT_MARKING);
DEFAULT_MARKING === 'Confidential'
  ? ok('and that default is Confidential, not Public') : bad('default is Confidential');
REPORT_MARKINGS.length === 4
  ? ok('four markings, matching the document and evidence vocabulary')
  : bad('four markings', REPORT_MARKINGS.join(','));

// ── 34. Logo rules ──────────────────────────────────────────────────────────
console.log('\n34. Logo');

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];

eq('a PNG is recognised by its signature', logoType(PNG), 'image/png');
eq('so is a JPEG', logoType(JPEG), 'image/jpeg');
logoType([0x3c, 0x73, 0x76, 0x67]) === null
  ? ok('an SVG is not a logo here — it cannot embed, and carries script')
  : bad('SVG refused');

checkLogo(PNG, 4096) === null ? ok('a small PNG is accepted') : bad('small PNG accepted');
eq('an empty file is refused', (checkLogo(PNG, 0) || {}).code, 'EMPTY_LOGO');
eq('so is an oversized one',
   (checkLogo(PNG, MAX_LOGO_BYTES + 1) || {}).code, 'LOGO_TOO_LARGE');
// The type comes from the bytes: a file NAMED .png whose content is markup.
eq('a mislabelled file is caught by its bytes',
   (checkLogo([0x3c, 0x68, 0x74, 0x6d], 500) || {}).code, 'LOGO_TYPE');

// ── 35. Inheritance up the tenant tree ──────────────────────────────────────
// Tenant.path holds slash-separated tenant IDs — verified against
// treeUtils.generateMaterializedPath, since the schema's own example comment
// shows names and would send a reader looking for the wrong key.
console.log('\n35. Branding inheritance');

const row = (tenantId, o = {}) => Object.assign({
  tenantId, displayName: null, brandColour: null, marking: null,
  footerText: null, logoKey: null, inheritsFromParent: true,
}, o);

eq('ancestors come out nearest-first, self excluded',
   JSON.stringify(ancestorsOf('/group/org/branch/')), JSON.stringify(['org', 'group']));
eq('a root tenant has no ancestors', JSON.stringify(ancestorsOf('/group/')), JSON.stringify([]));
eq('an absent path is not a crash', JSON.stringify(ancestorsOf(null)), JSON.stringify([]));

// Nothing configured anywhere: the vendor default, and it says so.
const bare = resolveBranding('branch', ['org', 'group'], [], 'Branch Ltd');
bare.brandColour === DEFAULT_BRAND && bare.isDefault && bare.displayName === 'Branch Ltd'
  ? ok('an unbranded tenant falls to the vendor default, and is marked as such')
  : bad('unbranded falls to default', JSON.stringify(bare));

// A group sets its livery once and the branch inherits it.
const inherited = resolveBranding('branch', ['org', 'group'],
  [row('group', { brandColour: '#123456', displayName: 'Acme Group Ltd' })], 'Branch Ltd');
eq('a branch inherits its group colour', inherited.brandColour, '#123456');
eq('and its group name', inherited.displayName, 'Acme Group Ltd');
eq('the source is reported', inherited.sourceTenantId, 'group');
!inherited.isDefault ? ok('and it is not the vendor default') : bad('not default');

// The load-bearing case: per-field, not whole-row. A branch that is a separate
// legal entity overrides ONLY its name and must keep the group's colour —
// whole-row inheritance would drop it to the vendor green the moment it set one
// field, which is the single most common branding edit in a group.
const perField = resolveBranding('branch', ['org', 'group'], [
  row('group', { brandColour: '#123456', displayName: 'Acme Group Ltd', footerText: 'Registered in England' }),
  row('branch', { displayName: 'Acme GmbH' }),
], 'Branch Ltd');
eq('a branch may override just its name', perField.displayName, 'Acme GmbH');
eq('while keeping the group colour', perField.brandColour, '#123456');
eq('and the group footer', perField.footerText, 'Registered in England');

// Nearest ancestor wins over a more distant one.
const nearest = resolveBranding('branch', ['org', 'group'], [
  row('group', { brandColour: '#111111' }),
  row('org', { brandColour: '#222222' }),
], 'Branch Ltd');
eq('the nearest ancestor wins', nearest.brandColour, '#222222');

// The opt-out: an acquired subsidiary that must not carry the acquirer's mark
// before the deal is announced. Its own row is the whole answer.
const opted = resolveBranding('branch', ['org', 'group'], [
  row('group', { brandColour: '#111111', displayName: 'Acquirer PLC' }),
  row('branch', { displayName: 'Standalone Ltd', inheritsFromParent: false }),
], 'Branch Ltd');
eq('opting out keeps the tenant its own name', opted.displayName, 'Standalone Ltd');
eq('and refuses the parent colour rather than inheriting it',
   opted.brandColour, DEFAULT_BRAND);

// Opting out still applies the tenant's OWN settings — it means "my row is the
// whole answer", not "I have no branding".
const optedWithColour = resolveBranding('branch', ['group'], [
  row('group', { brandColour: '#111111' }),
  row('branch', { brandColour: '#999999', inheritsFromParent: false }),
], 'Branch Ltd');
eq('an opted-out tenant still uses its own colour', optedWithColour.brandColour, '#999999');

// An unreadable inherited colour is still resolved, with text falling to ink.
const pale = resolveBranding('branch', ['group'], [row('group', { brandColour: cream })], 'B');
pale.brandColour === cream.toUpperCase() && pale.textColour === INK
  ? ok('a pale inherited brand is kept for chrome and ink is used for text')
  : bad('pale inherited brand', JSON.stringify(pale));

// ── 36. The logo follows the same walk as everything else ───────────────────
// Resolved here rather than by a second lookup: two walks are two chances to
// disagree, and a report carrying one organisation's name above another's mark
// is worse than one carrying no mark at all.
console.log('\n36. Logo inheritance');

eq('a logo is inherited from the group like any other field',
   resolveBranding('branch', ['org', 'group'],
     [row('group', { logoKey: 'aa/bb/group-logo' })], 'B').logoKey,
   'aa/bb/group-logo');
eq('a branch logo beats its group one',
   resolveBranding('branch', ['group'], [
     row('group', { logoKey: 'group-logo' }),
     row('branch', { logoKey: 'branch-logo' }),
   ], 'B').logoKey, 'branch-logo');
resolveBranding('branch', ['group'], [], 'B').logoKey === null
  ? ok('and no logo anywhere resolves to none, not to a default mark')
  : bad('no logo resolves to none');
// Opting out of inheritance drops the parent's mark too, which is the whole
// point for an entity that must not carry it.
resolveBranding('branch', ['group'], [
  row('group', { logoKey: 'acquirer-logo' }),
  row('branch', { displayName: 'Standalone Ltd', inheritsFromParent: false }),
], 'B').logoKey === null
  ? ok('opting out refuses the parent mark as well as its name')
  : bad('opting out refuses the parent mark');

// ── 37. A marking may be raised for one export, never lowered ───────────────
// Allowing a downgrade would let anyone re-export a Restricted report as Public
// and pass it on carrying the marking that makes it look distributable.
console.log('\n37. Marking escalation');

eq('no request keeps the organisation setting',
   effectiveMarking('Internal', null), 'Internal');
eq('a stricter marking is honoured',
   effectiveMarking('Internal', 'Restricted'), 'Restricted');
eq('one step up is honoured too',
   effectiveMarking('Internal', 'Confidential'), 'Confidential');
eq('a LOWER marking is refused and the setting stands',
   effectiveMarking('Restricted', 'Public'), 'Restricted');
eq('so is a request one step down',
   effectiveMarking('Confidential', 'Internal'), 'Confidential');
eq('the same marking is a no-op',
   effectiveMarking('Confidential', 'Confidential'), 'Confidential');
// This arrives as a query parameter. Failing an export because of a typo in a
// URL is worse than quietly using the organisation's own setting.
eq('a nonsense value is ignored rather than failing the export',
   effectiveMarking('Internal', 'Squirrel'), 'Internal');
eq('an unset organisation marking still defaults safely',
   effectiveMarking('nonsense', null), DEFAULT_MARKING);

// ── 38. Choosing which sections to export ───────────────────────────────────
console.log('\n38. Section selection');

const sec = (title) => ({ title, kind: 'table' });
const all = [sec('Summary'), sec('Findings'), sec('Evidence')];

eq('no filter means everything', selectSections(all, undefined).length, 3);
eq('an empty filter means everything too', selectSections(all, []).length, 3);
eq('a filter keeps only what was asked for', selectSections(all, ['Findings']).length, 1);
eq('and keeps the right one', selectSections(all, ['Findings'])[0].title, 'Findings');
eq('two names keep two sections', selectSections(all, ['Summary', 'Evidence']).length, 2);
// These arrive from a query string typed by a person.
eq('matching ignores case', selectSections(all, ['findings'])[0].title, 'Findings');
eq('and surrounding space', selectSections(all, ['  Findings  '])[0].title, 'Findings');
// A filter that matched nothing is a filter nobody meant. An empty report would
// look like the data was empty rather than the request wrong.
eq('a filter matching nothing falls back to everything',
   selectSections(all, ['Nonexistent']).length, 3);
eq('blank entries are dropped rather than matching nothing',
   selectSections(all, ['', '  ']).length, 3);
// The source list must not be mutated — the same sections array is reused
// across formats when a caller exports the same report twice.
const source = [sec('A'), sec('B')];
selectSections(source, ['A']);
source.length === 2 ? ok('filtering does not mutate the source') : bad('filtering mutates the source');

console.log('\n─── ' + pass + ' passed, ' + fail + ' failed ───\n');
process.exit(fail === 0 ? 0 : 1);
