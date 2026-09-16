/**
 * Agreeing a plan, and closing what it delivered.
 *
 * An engagement stays Draft forever until it is activated. Activating sets the
 * baseline dates against which every slippage figure is measured.
 *
 * Stamping an empty plan is refused: an empty baseline causes every subsequent
 * task to be baselined at its own due date the moment it is created, making
 * delivery slip permanently impossible to report.
 *
 *   node scripts/verify/project-activation-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// The pure rules run directly without a database.
const {
  planActivation, closureConcerns, noteIsEnough, MIN_NOTE,
} = require('../../dist/services/projectActivation');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const is = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

const now = new Date('2026-09-15T12:00:00Z');
const futureDate = new Date('2026-10-15T12:00:00Z');
const pastDate = new Date('2026-08-15T12:00:00Z');

// ── 1. Refusals for terminal and non-draft states ────────────────────────────
{
  const closed = planActivation({
    status: 'Closed',
    startDate: pastDate,
    targetEndDate: futureDate,
    baselineSetAt: pastDate,
    phaseCount: 2,
    taskCount: 5,
    tasksWithoutDueDate: 0,
  }, now);
  is(closed.ok, false, 'closed engagement cannot be activated');
  is(closed.code, 'PROJECT_FROZEN', 'closed engagement refuses with PROJECT_FROZEN');

  const cancelled = planActivation({
    status: 'Cancelled',
    startDate: pastDate,
    targetEndDate: futureDate,
    baselineSetAt: null,
    phaseCount: 2,
    taskCount: 5,
    tasksWithoutDueDate: 0,
  }, now);
  is(cancelled.ok, false, 'cancelled engagement cannot be activated');
  is(cancelled.code, 'PROJECT_FROZEN', 'cancelled engagement refuses with PROJECT_FROZEN');

  const active = planActivation({
    status: 'Active',
    startDate: pastDate,
    targetEndDate: futureDate,
    baselineSetAt: pastDate,
    phaseCount: 2,
    taskCount: 5,
    tasksWithoutDueDate: 0,
  }, now);
  is(active.ok, false, 'active engagement cannot be activated again');
  is(active.code, 'ALREADY_ACTIVE', 'active engagement refuses with ALREADY_ACTIVE');

  const onHold = planActivation({
    status: 'OnHold',
    startDate: pastDate,
    targetEndDate: futureDate,
    baselineSetAt: pastDate,
    phaseCount: 2,
    taskCount: 5,
    tasksWithoutDueDate: 0,
  }, now);
  is(onHold.ok, false, 'resuming on-hold does not rebaseline');
  is(onHold.code, 'RESUME_DOES_NOT_REBASELINE', 'on hold refuses with RESUME_DOES_NOT_REBASELINE');
}

// ── 2. The empty plan refusal (NO_PLAN_TO_AGREE) ─────────────────────────────
{
  const noPhases = planActivation({
    status: 'Draft',
    startDate: now,
    targetEndDate: futureDate,
    baselineSetAt: null,
    phaseCount: 0,
    taskCount: 0,
    tasksWithoutDueDate: 0,
  }, now);
  is(noPhases.ok, false, 'an engagement with 0 phases cannot be activated');
  is(noPhases.code, 'NO_PLAN_TO_AGREE', 'refusal is NO_PLAN_TO_AGREE');

  const noTasks = planActivation({
    status: 'Draft',
    startDate: now,
    targetEndDate: futureDate,
    baselineSetAt: null,
    phaseCount: 3,
    taskCount: 0,
    tasksWithoutDueDate: 0,
  }, now);
  is(noTasks.ok, false, 'an engagement with phases but 0 tasks cannot be activated');
  is(noTasks.code, 'NO_PLAN_TO_AGREE', 'refusal is NO_PLAN_TO_AGREE');
}

// ── 3. Clean activation and warnings ─────────────────────────────────────────
{
  const clean = planActivation({
    status: 'Draft',
    startDate: now,
    targetEndDate: futureDate,
    baselineSetAt: null,
    phaseCount: 2,
    taskCount: 6,
    tasksWithoutDueDate: 0,
  }, now);
  is(clean.ok, true, 'well-formed draft plan activates cleanly');
  is(clean.warnings.length, 0, 'clean plan has zero warnings');

  const lateEnd = planActivation({
    status: 'Draft',
    startDate: pastDate,
    targetEndDate: pastDate,
    baselineSetAt: null,
    phaseCount: 1,
    taskCount: 4,
    tasksWithoutDueDate: 0,
  }, now);
  is(lateEnd.ok, true, 'past target end date does not refuse activation');
  ok(lateEnd.warnings.some((w) => w.includes('target end date has already passed')), 'warns about past end date');

  const missingDates = planActivation({
    status: 'Draft',
    startDate: now,
    targetEndDate: futureDate,
    baselineSetAt: null,
    phaseCount: 1,
    taskCount: 5,
    tasksWithoutDueDate: 2,
  }, now);
  is(missingDates.ok, true, 'tasks without due date activate with warning');
  ok(missingDates.warnings.some((w) => w.includes('2 of 5 task(s) have no due date')), 'warns about undated tasks');

  const rebaselineWarn = planActivation({
    status: 'Draft',
    startDate: now,
    targetEndDate: futureDate,
    baselineSetAt: pastDate,
    phaseCount: 1,
    taskCount: 3,
    tasksWithoutDueDate: 0,
  }, now);
  is(rebaselineWarn.ok, true, 'draft with baseline replaces it with warning');
  ok(rebaselineWarn.warnings.some((w) => w.includes('already carries a baseline')), 'warns that baseline will be replaced');
}

// ── 4. Closure note and concerns ─────────────────────────────────────────────
{
  is(noteIsEnough(''), false, 'empty string is not enough note');
  is(noteIsEnough('Short'), false, 'under 10 chars is not enough');
  is(noteIsEnough('123456789'), false, '9 chars is not enough');
  is(noteIsEnough('1234567890'), true, '10 chars is enough');
  is(noteIsEnough('Engagement delivered in full to steering committee acceptance.'), true, 'a sentence is enough');

  const concerns = closureConcerns({
    outcome: 'Closed',
    reportedProgress: 90,
    verifiedProgress: 60,
    openTasks: 2,
    awaitingVerification: 1,
    needsVerification: 1,
    openBlockers: 1,
    baselineSetAt: null,
  });
  ok(concerns.some((c) => c.includes('2 task(s) are not finished')), 'notes unfinished tasks');
  ok(concerns.some((c) => c.includes('1 task(s) are with a reviewer')), 'notes tasks in review');
  ok(concerns.some((c) => c.includes('1 blocker(s) are still open')), 'notes open blockers');
  ok(concerns.some((c) => c.includes('30-point gap')), 'notes gap between reported and verified');
  ok(concerns.some((c) => c.includes('never activated')), 'notes closing an unbaselined project');
}

// ── 5. Route and frontend wiring ─────────────────────────────────────────────
{
  const routeSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'routes', 'projectRoutes.ts'), 'utf8',
  );
  ok(
    routeSrc.includes("router.post('/:id/activate', requireCapability(CAP.MANAGE_PROJECT), activateProject);"),
    'projectRoutes registers POST /:id/activate with requireCapability(CAP.MANAGE_PROJECT)',
  );

  const controllerSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'controllers', 'projectController.ts'), 'utf8',
  );
  ok(controllerSrc.includes('export const activateProject ='), 'projectController exports activateProject');
  ok(controllerSrc.includes('PROJECT_ACTIVATED'), 'projectController writes PROJECT_ACTIVATED audit');

  const planSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'pages', 'grc', 'project', 'ProjectPlan.tsx'), 'utf8',
  );
  ok(planSrc.includes('/api/projects/${projectId}/activate'), 'ProjectPlan calls activate endpoint');
  ok(planSrc.includes('Activate plan'), 'ProjectPlan renders Activate plan button');
}

console.log(`project-activation: ${checks} assertions passed (pure rules + route wiring)`);
