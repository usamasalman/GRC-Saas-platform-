/**
 * A plan the product can actually build.
 *
 * createPhase, updatePhase, deletePhase, createTask and deleteTask were all
 * routed, capability-guarded and written, and no screen in the product called
 * any of them. So a project opened on an empty plan, and the only way to put
 * anything in it was to call the API by hand or to seed the database.
 *
 * The empty state made it worse by instructing the reader to do the impossible:
 * "Break the engagement into phases ... then add the tasks each one needs",
 * printed on a screen with no control that could do either. That is the owner's
 * complaint in one sentence — "it create projects but can how a organization
 * start and plan and furthur update".
 *
 * This is the same defect as onboardTenant having no caller, and as
 * ProjectMember being written once and read nowhere: work finished and then not
 * connected. What is pinned here is the connection.
 *
 *   node scripts/verify/plan-builder-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(__dirname, '..', '..', '..', 'src');

const routes = fs.readFileSync(path.join(API, 'routes', 'projectRoutes.ts'), 'utf8');
const planCtrl = fs.readFileSync(path.join(API, 'controllers', 'projectPlanController.ts'), 'utf8');
const screenRaw = fs.readFileSync(path.join(WEB, 'pages', 'grc', 'project', 'ProjectPlan.tsx'), 'utf8');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

/** Comments are prose. Only what runs counts. */
const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const screen = code(screenRaw);

// ── Every plan-shaped write has a caller ─────────────────────────────────
// Expressed as route → the call the screen must make, so a route that loses its
// caller fails here rather than being discovered by a user with an empty plan.
{
  const MUST_BE_REACHABLE = [
    ["router.post('/:id/phases'", '/phases`', 'creating a phase'],
    ["router.patch('/phases/:phaseId'", '/api/projects/phases/', 'editing a phase'],
    ["router.delete('/phases/:phaseId'", '/api/projects/phases/', 'deleting a phase'],
    ["router.post('/phases/:phaseId/tasks'", '/tasks`', 'creating a task'],
    ["router.delete('/tasks/:taskId'", '/api/projects/tasks/', 'deleting a task'],
  ];

  for (const [route, call, what] of MUST_BE_REACHABLE) {
    ok(routes.includes(route), `${route} must still be routed`);
    ok(
      screen.includes(call),
      `Nothing in ProjectPlan calls the endpoint for ${what}. A routed, guarded write with no `
      + 'caller is work that was finished and then not connected — the defect this suite exists '
      + 'for, and the reason a project used to open on a plan nobody could fill.',
    );
  }

  // And the verbs, so a read-only screen cannot satisfy the check above.
  for (const verb of ['apiClient.post', 'apiClient.patch', 'apiClient.delete']) {
    ok(screen.includes(verb), `ProjectPlan must ${verb.split('.')[1]} — it builds the plan now`);
  }
}

// ── The empty state offers what it instructs ─────────────────────────────
{
  const at = screenRaw.indexOf('No phases yet');
  ok(at > 0, 'the empty state was not found');
  const block = screenRaw.slice(at, at + 1800);
  ok(
    /Break the engagement into phases/.test(block),
    'the empty state should still explain what a plan is for',
  );
  checks += 1;
  assert.ok(
    /openNewPhase/.test(code(block)),
    'the empty state tells the reader to break the engagement into phases, so it must offer a '
    + 'control that does it. An instruction with nothing beneath it is worse than no instruction.',
  );
}

// ── The vocabulary comes from the server ─────────────────────────────────
// createTask answers 400 for a priority or side outside its own lists, and a
// copy in the browser is how a screen comes to offer a value the API refuses —
// which has happened three times in this codebase with status strings.
{
  ok(
    /task-statuses/.test(screen),
    'the screen must fetch the vocabulary rather than hardcode priorities and sides',
  );
  const vocab = planCtrl.slice(planCtrl.indexOf('export const taskStatuses'));
  ok(/priorities: PRIORITIES/.test(vocab), 'the endpoint must serve the priority list');
  ok(/sides: SIDES/.test(vocab), 'and the side list');

  // No second copy of either list in the screen.
  checks += 1;
  assert.ok(
    !/const PRIORITIES\s*=/.test(screen) && !/'Critical'/.test(screen),
    'ProjectPlan must not carry its own copy of the priority list',
  );
}

// ── The dialog refuses what the server refuses ───────────────────────────
// createPhase answers 400 without a name, an owner, a start and a target end.
// Marking them required here turns a rejection the user could not have
// predicted into a disabled button and a reason, before anything is sent.
{
  const from = screen.indexOf('{phaseForm && (');
  const to = screen.indexOf('{taskForPhase && (');
  ok(from > 0 && to > from, 'the phase dialog was not found');
  const phaseDialog = screen.slice(from, to);

  for (const field of ['name', 'owner', 'startDate', 'targetEndDate']) {
    const at = phaseDialog.indexOf(`name: '${field}'`);
    ok(at > 0, `the phase dialog must have a ${field} field`);
    // To the end of that field's object literal, so a neighbour's `required`
    // cannot stand in for a missing one.
    const end = phaseDialog.indexOf("\n            {", at);
    checks += 1;
    assert.ok(
      /required: true/.test(phaseDialog.slice(at, end > 0 ? end : phaseDialog.length)),
      `${field} must be marked required in the phase dialog — the server refuses a phase without `
      + 'it, and a form that submits into a 400 teaches the user nothing about which field was '
      + 'wrong.',
    );
  }

  // The prefill, which is what makes editing an edit rather than a retype.
  ok(
    /initial: phaseForm === 'new' \? undefined : phaseForm\.name/.test(phaseDialog),
    'the edit dialog must open on the phase being edited, not on a blank form',
  );

  // The task dialog says only the name is required, so only the name is.
  const taskDialog = screen.slice(to, screen.indexOf('{deletingPhase && ('));
  checks += 1;
  assert.strictEqual(
    (taskDialog.match(/required: true/g) || []).length, 1,
    'the task dialog tells the reader "Only the name is required" — exactly one field may be '
    + 'marked required, or the sentence is false.',
  );
}

// ── FormDialog's own types are doing the checking ────────────────────────
// `value` is not one of its props; `initial` is. The first version of this
// screen used `value` behind an `as any` cast, which compiled and opened every
// edit dialog blank. See no-native-dialogs-test for the repo-wide rule.
{
  checks += 1;
  assert.ok(
    !/\bvalue: /.test(screen.slice(screen.indexOf('{phaseForm && ('))),
    'nothing in a FormDialog fields array should set `value` — the prop that prefills a field is '
    + '`initial`, and a `value` key is silently ignored.',
  );
}

// ── A date the user typed is shown back as the date they typed ───────────
// new Date('2026-10-01') is UTC midnight, and toLocaleDateString renders that
// instant locally — so a phase started on 1 October printed "Sep 30" for every
// reader west of Greenwich. Reachable only since this screen could accept a
// date at all, which is what this packet added.
{
  ok(
    /calendarDate/.test(screen),
    'phase and task dates must go through the calendar-date helper',
  );
  checks += 1;
  assert.ok(
    !/new Date\([^)]*\)\.toLocaleDateString/.test(screen),
    'a calendar date must not be formatted as an instant — that is the off-by-one that showed a '
    + 'phase starting the day before the one the project manager chose.',
  );
}

// ── Deleting cannot be used to improve a percentage ──────────────────────
// The rollup divides by planned weight, so removing a task raises the phase
// figure. Offering delete on work that was done, submitted or verified would
// make "finish it" and "delete it" look equally effective on a steering report.
{
  const at = screen.indexOf('openDeleteTask(ph, t)');
  ok(at > 0, 'the task delete control was not found');
  // From the enclosing element rather than a byte window: a style block between
  // the condition and the handler pushes the guard out of any fixed window, and
  // widening it until the assertion passes weakens what it checks.
  const around = screen.slice(screen.lastIndexOf('<Can', at), at);
  checks += 1;
  assert.ok(
    /t\.status === 'NotStarted'/.test(around) && /completionPercent === 0/.test(around),
    'task deletion must be offered only on work nobody has started. A task that has been done, '
    + 'submitted or verified is a record of what happened, and deleting it raises the phase '
    + 'percentage by removing the denominator rather than by finishing anything.',
  );

  const phaseAt = screen.indexOf('openDeletePhase(ph)');
  ok(phaseAt > 0, 'the phase delete control was not found');
  const phaseAround = screen.slice(screen.lastIndexOf('<Can', phaseAt), phaseAt);
  checks += 1;
  assert.ok(
    /ph\.tasks\.length === 0/.test(phaseAround),
    'phase deletion must be offered only where it can succeed — the server refuses a phase that '
    + 'still holds tasks, and a button whose only outcome is a refusal is worse than no button.',
  );
}

// ── The browser still never computes a percentage ────────────────────────
// The screen's own docstring promises this, and the builder is the change most
// likely to break it: it would be easy to adjust a phase figure locally after
// adding a task rather than reloading.
{
  const offenders = [];
  for (const m of screen.matchAll(/set(?:Phases|Totals)\([^)]*\)/g)) {
    if (/reportedProgress:\s*[^r]/.test(m[0]) && !/rolled\./.test(m[0])) offenders.push(m[0].slice(0, 60));
  }
  checks += 1;
  assert.deepStrictEqual(
    offenders, [],
    `These set a progress figure from something other than the server's rollup:\n${
      offenders.map((o) => `  ${o}`).join('\n')}\n`
    + 'A browser that computes its own percentage will eventually disagree with the server, and '
    + 'the user believes whichever one they are looking at.',
  );

  ok(
    /await load\(\)/.test(screen),
    'a structural change must reload rather than patch the tree locally — adding or removing a '
    + 'task moves the rollup everywhere above it',
  );
}

// ── The server still decides ─────────────────────────────────────────────
{
  for (const [handler, what] of [
    ['createPhase', 'name, startDate, targetEndDate and ownerId'],
    ['createTask', 'a name'],
  ]) {
    const at = planCtrl.indexOf(`export const ${handler}`);
    ok(at > 0, `${handler} not found`);
    const end = planCtrl.indexOf('\nexport const ', at + 1);
    const body = planCtrl.slice(at, end > 0 ? end : planCtrl.length);
    ok(/status\(400\)/.test(body), `${handler} must still refuse without ${what}`);
    ok(
      /isFrozen\(project\.status\)/.test(body),
      `${handler} must refuse on a frozen project — the screen offering a control is a courtesy, `
      + 'this is the guarantee',
    );
  }

  // The phase owner has to belong to the organisation that owns the work.
  const cp = planCtrl.slice(planCtrl.indexOf('export const createPhase'));
  ok(
    /tenantId: project\.tenantId/.test(cp.slice(0, 2000)),
    'the phase owner must be checked against the owning organisation',
  );
}

console.log(`plan-builder: ${checks} assertions passed`);
