/**
 * A workflow can be defined, and an SLA target can be set.
 *
 * Both halves were read-only. A run could be decided, cancelled and listed,
 * but a definition arrived only through the seed -- and
 * `create-an-approval-or-automation-workflow` was granted to five roles while
 * guarding no route at all. It WAS enforced, but only as a step's
 * requiredCapability inside workflowEngine, which decides who may ACT on a
 * step and never who may author the thing the step belongs to. So the one
 * grant named after creating a workflow could not create one, and
 * capabilities-mean-something-test carried it on an allow-list reading
 * "workflow definitions cannot be created -- plan packet 6.4".
 *
 * SLA was the same shape. GET /sla reported how tickets were doing against
 * their targets and POST /sla/scan re-ran the sweep, while the response and
 * resolve minutes every one of those figures is measured against could not be
 * set by anybody.
 *
 *   node scripts/verify/workflow-authoring-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(API, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const svcSrc = read(API, 'services', 'workflowAuthoring.ts');
const ctrl = code(read(API, 'controllers', 'workflowAuthoringController.ts'));
const routes = read(API, 'routes', 'itsmRoutes.ts');
const engine = read(API, 'services', 'capabilityEngine.ts');
const nav = read(WEB, 'pages', 'navCapabilities.ts');
const rbac = JSON.parse(read(API, 'utils', 'rbacData.json'));
const allowList = read(__dirname, 'capabilities-mean-something-test.js');
const wfScreen = code(read(WEB, 'pages', 'itsm', 'WorkflowDefinitions.tsx'));
const slaScreen = code(read(WEB, 'pages', 'itsm', 'SlaEscalations.tsx'));
const shell = code(read(WEB, 'pages', 'AppShell.tsx'));
const deploy = read(WEB, '..', '.github', 'workflows', 'deploy.yml');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

const {
  planDefinition, parseSteps, planSlaPolicy, prioritiesWithoutPolicy,
  STEP_TYPES, SUBJECT_TYPES, PRIORITIES, MAX_STEPS, MAX_TARGET_MINS,
} = require('../../dist/services/workflowAuthoring');

const CAPS = ['manage-and-resolve-support-tickets', 'create-an-approval-or-automation-workflow'];
const STEP = (over) => Object.assign({ key: 'approve', type: 'approve', name: 'Sign it off', requiredCapability: CAPS[0] }, over);
const DEF = (over) => Object.assign({
  key: 'access-request',
  name: 'Access request approval',
  subjectType: 'Ticket',
  steps: [STEP({})],
  knownCapabilities: CAPS,
  takenKeys: [],
}, over);

// ─── The rules run without a database ───────────────────────────────────────
{
  ok(
    !/from ['"]@prisma\/client['"]|require\(['"]@prisma/.test(svcSrc)
    && !/from ['"]\.\.\/db['"]/.test(svcSrc),
    'every refusal must be provable without Postgres',
  );
}

// ─── Steps are checked, not just stored ─────────────────────────────────────
{
  ok(parseSteps([STEP({})], CAPS).ok, 'a well-formed step is accepted');
  ok(parseSteps(JSON.stringify([STEP({})]), CAPS).ok, 'and so is the JSON string the column holds');

  eq(parseSteps('{not json', CAPS).code, 'STEPS_NOT_JSON', 'malformed JSON is refused');
  eq(parseSteps([], CAPS).code, 'NO_STEPS', 'a workflow with no steps would start a run that is already finished');
  eq(
    parseSteps(Array.from({ length: MAX_STEPS + 1 }, (_, i) => STEP({ key: `s${i}` })), CAPS).code,
    'TOO_MANY_STEPS',
    'and there is a ceiling',
  );

  eq(
    parseSteps([STEP({}), STEP({})], CAPS).code, 'STEP_KEY_REPEATED',
    'two steps cannot share a key — a run records its progress against the key and could '
    + 'not tell them apart',
  );
  eq(parseSteps([STEP({ type: 'ponder' })], CAPS).code, 'BAD_STEP_TYPE', 'a step type is one of the known kinds');
  eq(parseSteps([STEP({ name: '' })], CAPS).code, 'STEP_NAME_REQUIRED', 'and a step needs a name people see in their inbox');

  eq(
    parseSteps([STEP({ requiredCapability: 'invent-a-capability' })], CAPS).code,
    'UNKNOWN_CAPABILITY',
    'a step cannot require a capability the platform does not define. Nobody could hold it, '
    + 'so the run would stop there for good',
  );

  for (const type of ['review', 'approve', 'task']) {
    eq(
      parseSteps([{ key: 'k', type, name: 'n' }], CAPS).code, 'STEP_HAS_NO_ACTOR',
      `a ${type} step with no capability and no assignee lands in nobody's inbox`,
    );
  }
  ok(
    parseSteps([{ key: 'k', type: 'notify', name: 'Tell them' }], CAPS).ok,
    'while a notify step needs nobody to act on it',
  );

  eq(
    parseSteps([{ key: 'w', type: 'wait', name: 'Cool off' }], CAPS).code, 'WAIT_NEEDS_HOURS',
    'a wait step with no hours would hold the run for ever',
  );
  eq(
    parseSteps([STEP({ dueInHours: 99999 })], CAPS).code, 'BAD_STEP_HOURS',
    'and hours are bounded',
  );

  const kept = parseSteps([STEP({ dueInHours: '48' })], CAPS);
  eq(kept.steps[0].dueInHours, 48, 'a numeric string is stored as a number');
}

// ─── The definition ─────────────────────────────────────────────────────────
{
  const good = planDefinition(DEF({}));
  ok(good.ok, 'a well-formed definition is accepted');
  eq(good.key, 'access-request', 'the key is kept');

  eq(planDefinition(DEF({ key: 'Access Request' })).key, 'access-request', 'a key is normalised');
  eq(planDefinition(DEF({ key: '' })).code, 'KEY_REQUIRED', 'a workflow needs a key');
  eq(planDefinition(DEF({ key: 'A!' })).code, 'BAD_KEY', 'and the key is constrained');
  eq(
    planDefinition(DEF({ takenKeys: ['access-request'] })).code, 'KEY_TAKEN',
    'two workflows cannot share a key — runs point at it',
  );
  eq(planDefinition(DEF({ name: 'no' })).code, 'NAME_REQUIRED', 'a workflow needs a name');
  eq(planDefinition(DEF({ subjectType: 'Sandwich' })).code, 'BAD_SUBJECT_TYPE', 'and is about a known kind of thing');

  eq(
    planDefinition(DEF({ isSystem: true })).code, 'SYSTEM_DEFINITION',
    'a platform workflow is copied, not edited, so an upgrade cannot quietly undo the change',
  );

  // A bad step refuses the whole definition rather than being dropped.
  eq(
    planDefinition(DEF({ steps: [STEP({ requiredCapability: 'nope' })] })).code,
    'UNKNOWN_CAPABILITY',
    'and a definition is only as valid as its steps',
  );
}

// ─── SLA targets ────────────────────────────────────────────────────────────
{
  const base = { priority: 'P1', responseMins: 15, resolveMins: 240 };
  ok(planSlaPolicy(base).ok, 'a sensible target is accepted');
  eq(planSlaPolicy({ ...base, priority: 'p1' }).priority, 'P1', 'and the priority is normalised');

  eq(planSlaPolicy({ ...base, priority: 'P9' }).code, 'BAD_PRIORITY', 'a policy applies to a known priority');
  eq(planSlaPolicy({ ...base, responseMins: 0 }).code, 'TARGET_TOO_SHORT', 'a zero-minute target is breached the moment a ticket is raised');
  eq(planSlaPolicy({ ...base, resolveMins: MAX_TARGET_MINS + 1 }).code, 'TARGET_TOO_LONG', 'and there is a ceiling');
  eq(planSlaPolicy({ ...base, responseMins: 1.5 }).code, 'BAD_TARGET', 'minutes are whole');
  eq(
    planSlaPolicy({ ...base, responseMins: 240, resolveMins: 15 }).code, 'RESOLVE_BEFORE_RESPONSE',
    'a ticket cannot be resolved before it has been answered',
  );

  assert.deepStrictEqual(
    prioritiesWithoutPolicy([{ priority: 'P1' }, { priority: 'p2' }]), ['P3', 'P4'],
    'a priority with no target is named. Every SLA figure is measured against these, so one '
    + 'without a policy is measured against nothing while still appearing to be tracked',
  );
  checks += 1;
  assert.deepStrictEqual(
    prioritiesWithoutPolicy(PRIORITIES.map((p) => ({ priority: p }))), [],
    'and a complete set reports none',
  );
  checks += 1;
}

// ─── The capability finally guards something ────────────────────────────────
{
  const KEY = 'create-an-approval-or-automation-workflow';

  ok(new RegExp(`AUTHOR_WORKFLOW: '${KEY}'`).test(engine), 'the capability is in the server CAP table');
  ok(new RegExp(`AUTHOR_WORKFLOW: '${KEY}'`).test(nav), 'and mirrored on the frontend, which nav-capabilities requires in both directions');
  ok(
    rbac.capabilities.some((c) => c.key === KEY),
    'it is declared in the role matrix',
  );
  ok(
    rbac.roles.filter((r) => (r.capabilities || []).includes(KEY)).length > 0,
    'and granted to somebody',
  );

  ok(
    /router\.post\('\/workflows', requireCapability\(CAP\.AUTHOR_WORKFLOW\)/.test(routes),
    'THE PACKET: creating a workflow carries the capability named after creating a workflow',
  );
  ok(
    /router\.put\('\/workflows\/:id', requireCapability\(CAP\.AUTHOR_WORKFLOW\)/.test(routes),
    'and so does changing one',
  );
  ok(
    /router\.put\('\/sla-policies', requireCapability\(CAP\.AUTHOR_WORKFLOW\)/.test(routes),
    'and setting the targets every SLA figure is measured against',
  );
  ok(
    /router\.get\('\/sla-policies', listSlaPolicies\)/.test(routes),
    'while READING the targets stays open — somebody whose ticket is breaching should be '
    + 'able to see what it breached',
  );

  ok(
    !new RegExp(`'${KEY}':`).test(allowList),
    'and the allow-list entry must be gone. It read "workflow definitions cannot be created '
    + '— plan packet 6.4", and that is no longer true',
  );

  // Literal before wildcard, or '/workflows/options' is read as an id.
  ok(
    routes.indexOf("'/workflows/options'") < routes.indexOf("'/workflows/:id'"),
    "'/workflows/options' must be registered before '/workflows/:id'",
  );
}

// ─── The controller ─────────────────────────────────────────────────────────
{
  ok(
    /knownCapabilities: KNOWN_CAPABILITIES/.test(ctrl),
    'the step validator is given the real capability list, not a guess',
  );
  ok(
    /rbacData as any\)\.capabilities/.test(ctrl),
    'and that list comes from the role matrix rather than CAP, because a step may require '
    + 'any granted capability and CAP carries only the ones a route guards',
  );
  ok(
    /action: 'WORKFLOW_DEFINITION_CREATED'/.test(ctrl) && /requiredCapability: s\.requiredCapability/.test(ctrl),
    'the audit entry names who may act at each step — that is the substance of the workflow',
  );
  ok(
    /was: before \?/.test(ctrl),
    'and changing an SLA records the OLD targets, because tickets already open are measured '
    + 'against the new ones and the breach figure moves without any ticket changing',
  );
  ok(
    /runsInFlightUnchanged/.test(ctrl),
    'editing a definition must record that runs already started keep their own steps, so '
    + 'nobody reads a changed definition as a changed history',
  );
  ok(
    /tenantId_priority/.test(ctrl),
    'setting a target is an upsert on (tenant, priority) — "set the P2 target" is one '
    + 'operation, not a create the caller has to know is a create',
  );
}

// ─── The screens ────────────────────────────────────────────────────────────
{
  ok(
    /currentPage === 'workflow-admin'\)[\s\S]{0,120}?<WorkflowDefinitions/.test(shell),
    'the workflow screen is reachable',
  );
  ok(
    /\['workflow-admin', '⇉', 'Approval Workflows'\]/.test(shell),
    'and offered in the menu',
  );
  ok(
    /No workflow has been defined/.test(wfScreen),
    'a tenant with no workflow is told what that means, not shown an empty list',
  );
  ok(
    /<Can do=\{MAY\.AUTHOR_WORKFLOW\}>/.test(wfScreen) && /<Can do=\{MAY\.AUTHOR_WORKFLOW\}>/.test(slaScreen),
    'and authoring is gated on both screens as well as on the routes',
  );
  ok(
    /disabled=\{busy \|\| d\.isSystem\}/.test(wfScreen),
    'a platform workflow cannot be edited from the screen either, rather than being offered '
    + 'and refused',
  );
  ok(
    /withoutPolicy\.length > 0/.test(slaScreen),
    'and a priority with no target must say so on the board where its figures appear',
  );
  ok(
    !/\{ value: [a-z], label: [a-z] \}/.test(wfScreen) && !/\{ value: [a-z], label: [a-z] \}/.test(slaScreen),
    'select options are plain strings. FormDialog renders `options.map((o) => <option '
    + 'value={o}>{o}</option>)`, so an object renders as [object Object] — and it typechecks '
    + 'whenever the array came from an `any`',
  );

  ok(
    /workflow-authoring-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next packet can delete',
  );
}

console.log(
  `workflow-authoring: ${checks} assertions passed `
  + `(${STEP_TYPES.length} step types, ${SUBJECT_TYPES.length} subjects, `
  + `${PRIORITIES.length} priorities)`,
);
