/**
 * Delivery projects — slices 1 to 3: the engagement, the work inside it, and
 * the independent verification that turns one progress figure into two.
 *
 * The assertion that matters most is isolation. A delivery project is the first
 * record in this platform visible from two directions — the client tenant that
 * owns it and the consulting partner delivering it — so the ordinary
 * `tenantWhere(scope)` used everywhere else is not sufficient, and the widened
 * filter is exactly the kind of change that quietly leaks rows.
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/verify/project-delivery-test.js
 */
const API = process.env.API || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let pass = 0, fail = 0;
const ok = (l, d = '') => { pass++; console.log(`   PASS  ${l}${d ? ` — ${d}` : ''}`); };
const bad = (l, d = '') => { fail++; console.log(`   FAIL  ${l}${d ? ` — ${d}` : ''}`); };

async function api(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  return { status: r.status, json: j };
}

async function login(email, password) {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  return r.json?.token || null;
}

const iso = (daysFromNow) =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString();

async function main() {
  console.log(`\n─── Delivery projects · slices 1-3 · ${API} ───\n`);

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set.');
    process.exit(1);
  }

  const token = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!token) { console.error('Could not sign in.'); process.exit(1); }

  const me = await api('/api/auth/me', { token });
  const myTenantId = me.json?.user?.tenantId;
  const myUserId = me.json?.user?.id;

  // ── 1. The route exists and is authenticated ────────────────────────────
  console.log('1. Route and authorisation');

  const anon = await api('/api/projects');
  anon.status === 401
    ? ok('listing requires a token')
    : bad('listing requires a token', `got ${anon.status}`);

  const list = await api('/api/projects', { token });
  list.status === 200
    ? ok('authenticated listing responds', `scope ${list.json?.scope}`)
    : bad('authenticated listing responds', `${list.status} ${JSON.stringify(list.json)}`);

  Array.isArray(list.json?.projects) && list.json?.totals
    ? ok('response carries projects[] and dashboard totals')
    : bad('response carries projects[] and dashboard totals', JSON.stringify(list.json).slice(0, 120));

  // ── 2. Validation refuses malformed engagements ─────────────────────────
  console.log('\n2. Validation');

  const noName = await api('/api/projects', {
    token, method: 'POST',
    body: { startDate: iso(0), targetEndDate: iso(90), ownerId: myUserId, managerId: myUserId },
  });
  noName.status === 400
    ? ok('a project without a name is refused')
    : bad('a project without a name is refused', `got ${noName.status}`);

  const backwards = await api('/api/projects', {
    token, method: 'POST',
    body: {
      name: 'Backwards dates', startDate: iso(90), targetEndDate: iso(10),
      ownerId: myUserId, managerId: myUserId,
    },
  });
  backwards.status === 400
    ? ok('an end date before the start date is refused')
    : bad('an end date before the start date is refused', `got ${backwards.status}`);

  const badOwner = await api('/api/projects', {
    token, method: 'POST',
    body: {
      name: 'Phantom owner', startDate: iso(0), targetEndDate: iso(90),
      ownerId: '00000000-0000-0000-0000-000000000000', managerId: myUserId,
    },
  });
  badOwner.status === 400
    ? ok('an owner outside the organisation is refused')
    : bad('an owner outside the organisation is refused', `got ${badOwner.status}`);

  // ── 3. Creation ─────────────────────────────────────────────────────────
  console.log('\n3. Creation');

  const created = await api('/api/projects', {
    token, method: 'POST',
    body: {
      name: 'ISO 27001 readiness — verification suite',
      description: 'Created by the slice 1 verification run.',
      projectType: 'Readiness',
      priority: 'High',
      frameworks: ['ISO27001', 'SOC2'],
      startDate: iso(-30),
      targetEndDate: iso(60),
      ownerId: myUserId,
      managerId: myUserId,
    },
  });

  const project = created.json?.project;
  created.status === 201 && project?.id
    ? ok('project created', project.ref)
    : bad('project created', `${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);

  if (!project?.id) {
    console.log('\nCannot continue without a project.\n');
    process.exit(1);
  }

  /^PRJ-\d{4}$/.test(project.ref)
    ? ok('reference follows the PRJ-0000 convention', project.ref)
    : bad('reference follows the PRJ-0000 convention', project.ref);

  project.status === 'Draft'
    ? ok('a new project starts in Draft')
    : bad('a new project starts in Draft', project.status);

  Array.isArray(project.frameworks) && project.frameworks.length === 2
    ? ok('frameworks round-trip as an array')
    : bad('frameworks round-trip as an array', JSON.stringify(project.frameworks));

  // ── 4. Derived figures ──────────────────────────────────────────────────
  console.log('\n4. Derived schedule and status');

  const s = project.schedule || {};
  s.totalDays === 90
    ? ok('total duration derived from the dates', `${s.totalDays} days`)
    : bad('total duration derived from the dates', `got ${s.totalDays}, expected 90`);

  s.elapsedDays === 30 && s.remainingDays === 60
    ? ok('elapsed and remaining split correctly', `${s.elapsedDays} / ${s.remainingDays}`)
    : bad('elapsed and remaining split correctly', `${s.elapsedDays} / ${s.remainingDays}`);

  project.derivedStatus === 'NotStarted'
    ? ok('a Draft project reads as Not started')
    : bad('a Draft project reads as Not started', project.derivedStatus);

  const detail = await api(`/api/projects/${project.id}`, { token });
  const members = detail.json?.project?.members || [];
  members.length >= 1
    ? ok('owner and manager are seeded onto the team', `${members.length} member(s)`)
    : bad('owner and manager are seeded onto the team', `${members.length}`);

  // ── 5. Lifecycle ────────────────────────────────────────────────────────
  console.log('\n5. Lifecycle');

  const activated = await api(`/api/projects/${project.id}`, {
    token, method: 'PATCH', body: { status: 'Active' },
  });
  activated.json?.project?.status === 'Active'
    ? ok('Draft advances to Active')
    : bad('Draft advances to Active', `${activated.status} ${activated.json?.message || ''}`);

  // Now Active with 0% work and a third of the calendar gone, it should read
  // At risk rather than On track — that gap is the earliest honest signal.
  activated.json?.project?.derivedStatus === 'AtRisk'
    ? ok('calendar ahead of progress reads as At risk')
    : bad('calendar ahead of progress reads as At risk', activated.json?.project?.derivedStatus);

  const viaPatch = await api(`/api/projects/${project.id}`, {
    token, method: 'PATCH', body: { status: 'Closed' },
  });
  viaPatch.status === 400 && viaPatch.json?.code === 'USE_CLOSE_ENDPOINT'
    ? ok('closing through PATCH is refused, so a reason cannot be skipped')
    : bad('closing through PATCH is refused', `${viaPatch.status} ${viaPatch.json?.code}`);

  const noNote = await api(`/api/projects/${project.id}/close`, {
    token, method: 'POST', body: { outcome: 'Closed', closureNote: 'done' },
  });
  noNote.status === 400 && noNote.json?.code === 'CLOSURE_NOTE_REQUIRED'
    ? ok('a token closure note is refused')
    : bad('a token closure note is refused', `${noNote.status} ${noNote.json?.code}`);

  const closed = await api(`/api/projects/${project.id}/close`, {
    token, method: 'POST',
    body: { outcome: 'Closed', closureNote: 'Certification achieved; scope fully delivered.' },
  });
  closed.json?.project?.status === 'Closed'
    ? ok('project closes with a reason')
    : bad('project closes with a reason', `${closed.status} ${closed.json?.message || ''}`);

  closed.json?.project?.actualEndDate
    ? ok('closure stamps the actual end date')
    : bad('closure stamps the actual end date', 'null');

  const reopen = await api(`/api/projects/${project.id}`, {
    token, method: 'PATCH', body: { status: 'Active' },
  });
  reopen.status === 409 && reopen.json?.code === 'ILLEGAL_TRANSITION'
    ? ok('a closed project cannot be quietly reopened')
    : bad('a closed project cannot be quietly reopened', `${reopen.status} ${reopen.json?.code}`);

  // ── 6. Tenant isolation — the assertion that matters most ───────────────
  console.log('\n6. Isolation');

  const other = await api('/api/projects', {
    token, method: 'POST',
    body: {
      name: 'Foreign tenant project', startDate: iso(0), targetEndDate: iso(30),
      ownerId: myUserId, managerId: myUserId,
      tenantId: '00000000-0000-0000-0000-000000000000',
    },
  });
  // A platform operator legitimately spans tenants, so the refusal may come from
  // scope (403) or from the owner check (400). Either is a refusal; a 201 is not.
  other.status !== 201
    ? ok('a project cannot be created for an unrelated tenant', `refused with ${other.status}`)
    : bad('a project cannot be created for an unrelated tenant', 'it was created');

  const ghost = await api('/api/projects/00000000-0000-0000-0000-000000000000', { token });
  ghost.status === 404
    ? ok('an unknown project id returns 404, not 403')
    : bad('an unknown project id returns 404, not 403', `got ${ghost.status}`);

  // ── 7. The audit trail ──────────────────────────────────────────────────
  console.log('\n7. Audit trail');

  const logs = await api('/api/audit-logs?limit=50', { token });
  const entries = logs.json?.logs || logs.json?.auditLogs || [];
  const actions = entries.map((e) => e.action);

  actions.includes('PROJECT_CREATED')
    ? ok('creation is recorded in the audit log')
    : bad('creation is recorded in the audit log', `saw: ${actions.slice(0, 6).join(', ')}`);

  actions.includes('PROJECT_CLOSED')
    ? ok('closure is recorded in the audit log')
    : bad('closure is recorded in the audit log', `saw: ${actions.slice(0, 6).join(', ')}`);

  const chained = entries.filter((e) => e.currentHash && e.previousHash).length;
  chained > 0
    ? ok('audit entries carry the hash chain', `${chained} of ${entries.length} checked`)
    : bad('audit entries carry the hash chain', 'no hashes present');


  // ── 8. The plan: phases, tasks and rollup ───────────────────────────────
  console.log('\n8. Plan and rollup');

  const planProject = await api('/api/projects', {
    token, method: 'POST',
    body: {
      name: 'Rollup verification project',
      startDate: iso(-10), targetEndDate: iso(80),
      ownerId: myUserId, managerId: myUserId,
    },
  });
  const pid = planProject.json?.project?.id;
  pid ? ok('project for the plan created') : bad('project for the plan created', JSON.stringify(planProject.json).slice(0, 160));
  if (!pid) { console.log('\nCannot continue.\n'); process.exit(1); }

  await api(`/api/projects/${pid}`, { token, method: 'PATCH', body: { status: 'Active' } });

  const phaseRes = await api(`/api/projects/${pid}/phases`, {
    token, method: 'POST',
    body: {
      name: 'Gap assessment', startDate: iso(-10), targetEndDate: iso(30),
      ownerId: myUserId,
    },
  });
  const phaseId = phaseRes.json?.phase?.id;
  phaseRes.status === 201 && phaseId
    ? ok('phase created')
    : bad('phase created', `${phaseRes.status} ${JSON.stringify(phaseRes.json).slice(0, 160)}`);
  if (!phaseId) { console.log('\nCannot continue.\n'); process.exit(1); }

  phaseRes.json.phase.status === 'NotStarted'
    ? ok('an empty phase starts as Not started')
    : bad('an empty phase starts as Not started', phaseRes.json.phase.status);

  // Phase status is derived, so setting it directly must be refused rather than
  // silently accepted and then overwritten by the next rollup.
  const setStatus = await api(`/api/projects/phases/${phaseId}`, {
    token, method: 'PATCH', body: { status: 'Complete' },
  });
  setStatus.status === 400 && setStatus.json?.code === 'DERIVED_FIELD'
    ? ok('phase status cannot be set by hand')
    : bad('phase status cannot be set by hand', `${setStatus.status} ${setStatus.json?.code}`);

  // ── The slice's own acceptance criterion: 10 tasks, 7 done, 70% ─────────
  const taskIds = [];
  for (let i = 1; i <= 10; i++) {
    const t = await api(`/api/projects/phases/${phaseId}/tasks`, {
      token, method: 'POST',
      body: { name: `Control gap ${i}`, assigneeId: myUserId, dueDate: iso(20) },
    });
    if (t.json?.task?.id) taskIds.push(t.json.task.id);
  }
  taskIds.length === 10 ? ok('ten tasks created') : bad('ten tasks created', `${taskIds.length}`);

  let lastRollup = null;
  for (let i = 0; i < 7; i++) {
    await api(`/api/projects/tasks/${taskIds[i]}`, { token, method: 'PATCH', body: { status: 'InProgress' } });
    const r = await api(`/api/projects/tasks/${taskIds[i]}`, { token, method: 'PATCH', body: { status: 'Done' } });
    lastRollup = r.json?.rollup;
  }

  lastRollup?.reportedProgress === 70
    ? ok('10 tasks with 7 done rolls up to 70%', `${lastRollup.reportedProgress}%`)
    : bad('10 tasks with 7 done rolls up to 70%', `got ${lastRollup?.reportedProgress}`);

  lastRollup?.verifiedProgress === 0
    ? ok('verified stays 0 — nothing has been checked yet')
    : bad('verified stays 0', `got ${lastRollup?.verifiedProgress}`);

  const afterPlan = await api(`/api/projects/${pid}`, { token });
  afterPlan.json?.project?.reportedProgress === 70
    ? ok('the project row carries the rolled-up figure')
    : bad('the project row carries the rolled-up figure', `${afterPlan.json?.project?.reportedProgress}`);

  const plan = await api(`/api/projects/${pid}/plan`, { token });
  const ph = plan.json?.phases?.[0];
  ph?.reportedProgress === 70 && ph?.status === 'InProgress'
    ? ok('the phase reports 70% and reads In progress')
    : bad('the phase reports 70% and reads In progress', `${ph?.reportedProgress}% / ${ph?.status}`);

  plan.json?.totals?.done === 7
    ? ok('plan totals count the finished tasks')
    : bad('plan totals count the finished tasks', `${plan.json?.totals?.done}`);

  // ── 9. Task transitions over HTTP ───────────────────────────────────────
  console.log('\n9. Transitions');

  const jumpTask = taskIds[7];
  const jump = await api(`/api/projects/tasks/${jumpTask}`, {
    token, method: 'PATCH', body: { status: 'Done' },
  });
  jump.status === 409 && jump.json?.code === 'ILLEGAL_TRANSITION'
    ? ok('a task cannot jump from NotStarted to Done', jump.json.message)
    : bad('a task cannot jump from NotStarted to Done', `${jump.status} ${jump.json?.code}`);

  const invented = await api(`/api/projects/tasks/${jumpTask}`, {
    token, method: 'PATCH', body: { status: 'Finished' },
  });
  invented.status === 400 && invented.json?.code === 'UNKNOWN_STATUS'
    ? ok('an invented status is refused')
    : bad('an invented status is refused', `${invented.status} ${invented.json?.code}`);

  // Weighting: a heavy task should move the number more than a light one.
  const heavy = await api(`/api/projects/tasks/${taskIds[7]}`, {
    token, method: 'PATCH', body: { weight: 10 },
  });
  heavy.status === 200
    ? ok('a manager can reweight a task')
    : bad('a manager can reweight a task', `${heavy.status}`);
  heavy.json?.rollup?.reportedProgress === 37
    ? ok('reweighting moves the rollup', `70% → ${heavy.json.rollup.reportedProgress}%`)
    : bad('reweighting moves the rollup', `got ${heavy.json?.rollup?.reportedProgress}, expected 37`);

  // ── 10. Finishing and reopening ─────────────────────────────────────────
  console.log('\n10. Completion bookkeeping');

  await api(`/api/projects/tasks/${taskIds[8]}`, { token, method: 'PATCH', body: { status: 'InProgress' } });
  const done = await api(`/api/projects/tasks/${taskIds[8]}`, { token, method: 'PATCH', body: { status: 'Done' } });
  done.json?.task?.completionPercent === 100 && done.json?.task?.completedAt
    ? ok('finishing pins completion at 100 and stamps the time')
    : bad('finishing pins completion and stamps the time',
          `${done.json?.task?.completionPercent} / ${done.json?.task?.completedAt}`);

  const reopened = await api(`/api/projects/tasks/${taskIds[8]}`, {
    token, method: 'PATCH', body: { status: 'InProgress' },
  });
  reopened.json?.task?.completedAt === null
    ? ok('reopening clears the completion timestamp')
    : bad('reopening clears the completion timestamp', `${reopened.json?.task?.completedAt}`);

  // ── 11. A phase cannot be deleted with work inside it ───────────────────
  console.log('\n11. Deletion guards');

  const delPhase = await api(`/api/projects/phases/${phaseId}`, { token, method: 'DELETE' });
  delPhase.status === 409 && delPhase.json?.code === 'PHASE_NOT_EMPTY'
    ? ok('a phase holding tasks cannot be deleted')
    : bad('a phase holding tasks cannot be deleted', `${delPhase.status} ${delPhase.json?.code}`);

  // ── 12. A closed project is frozen ──────────────────────────────────────
  console.log('\n12. Frozen projects');

  await api(`/api/projects/${pid}/close`, {
    token, method: 'POST',
    body: { outcome: 'Closed', closureNote: 'Verification run complete; closing the fixture.' },
  });
  const afterClose = await api(`/api/projects/phases/${phaseId}/tasks`, {
    token, method: 'POST', body: { name: 'Late addition' },
  });
  afterClose.status === 409 && afterClose.json?.code === 'PROJECT_FROZEN'
    ? ok('a closed project will not accept new work')
    : bad('a closed project will not accept new work', `${afterClose.status} ${afterClose.json?.code}`);

  // ── 13. Verification policy ─────────────────────────────────────────────
  console.log('\n13. Verification policy');

  const badPolicy = await api('/api/projects', {
    token, method: 'POST',
    body: {
      name: 'Bad policy', startDate: iso(0), targetEndDate: iso(60),
      ownerId: myUserId, managerId: myUserId, verificationPolicy: 'Whenever',
    },
  });
  badPolicy.status === 400
    ? ok('an invented verification policy is refused')
    : bad('an invented verification policy is refused', `${badPolicy.status}`);

  const vProject = await api('/api/projects', {
    token, method: 'POST',
    body: {
      name: 'Verification workflow project',
      startDate: iso(-5), targetEndDate: iso(60),
      ownerId: myUserId, managerId: myUserId,
      verificationPolicy: 'EveryTask',
    },
  });
  const vid = vProject.json?.project?.id;
  vid && vProject.json.project.verificationPolicy === 'EveryTask'
    ? ok('a project can be created requiring verification of every task')
    : bad('a project requiring verification of every task',
          `${vProject.status} ${JSON.stringify(vProject.json).slice(0, 160)}`);
  if (!vid) { console.log('\nCannot continue.\n'); process.exit(1); }

  await api(`/api/projects/${vid}`, { token, method: 'PATCH', body: { status: 'Active' } });

  const vPhase = await api(`/api/projects/${vid}/phases`, {
    token, method: 'POST',
    body: { name: 'Deliverables', startDate: iso(-5), targetEndDate: iso(40), ownerId: myUserId },
  });
  const vPhaseId = vPhase.json?.phase?.id;
  vPhaseId ? ok('phase created for the verification run') : bad('phase created', `${vPhase.status}`);
  if (!vPhaseId) { console.log('\nCannot continue.\n'); process.exit(1); }

  const mkTask = async (name, extra = {}) => {
    const r = await api(`/api/projects/phases/${vPhaseId}/tasks`, {
      token, method: 'POST',
      body: { name, assigneeId: myUserId, dueDate: iso(15), ...extra },
    });
    return r.json?.task?.id;
  };

  const scopeTask = await mkTask('ISMS scope statement');
  const exemptTask = await mkTask('Book the kickoff call', { verificationOverride: false });
  const soaTask = await mkTask('Statement of Applicability');
  scopeTask && exemptTask && soaTask
    ? ok('three tasks created, one explicitly exempt')
    : bad('three tasks created', `${scopeTask} ${exemptTask} ${soaTask}`);

  const vPlan = await api(`/api/projects/${vid}/plan`, { token });
  const planTasks = vPlan.json?.phases?.[0]?.tasks || [];
  const byId = (id) => planTasks.find((t) => t.id === id);

  byId(scopeTask)?.needsVerification === true
    ? ok('a task under EveryTask needs verification')
    : bad('a task under EveryTask needs verification', `${byId(scopeTask)?.needsVerification}`);
  byId(exemptTask)?.needsVerification === false
    ? ok('an explicit exemption survives the project policy')
    : bad('an explicit exemption survives the project policy', `${byId(exemptTask)?.needsVerification}`);
  vPlan.json?.phases?.[0]?.counts?.needsVerification === 2
    ? ok('the plan counts what will need a reviewer', '2 of 3')
    : bad('the plan counts what will need a reviewer',
          `${vPlan.json?.phases?.[0]?.counts?.needsVerification}`);

  // ── 14. Verification cannot be reached through an ordinary update ────────
  console.log('\n14. The routing guard');

  await api(`/api/projects/tasks/${scopeTask}`, { token, method: 'PATCH', body: { status: 'InProgress' } });

  // The one that would defeat the module: marking work done to skip the reviewer.
  const dodge = await api(`/api/projects/tasks/${scopeTask}`, {
    token, method: 'PATCH', body: { status: 'Done' },
  });
  dodge.status === 409 && dodge.json?.code === 'VERIFICATION_REQUIRED'
    ? ok('work needing a reviewer cannot be marked Done', dodge.json.message.slice(0, 60))
    : bad('work needing a reviewer cannot be marked Done', `${dodge.status} ${dodge.json?.code}`);

  for (const s of ['Verified', 'Rejected', 'SubmittedForVerification']) {
    const r = await api(`/api/projects/tasks/${scopeTask}`, {
      token, method: 'PATCH', body: { status: s },
    });
    r.json?.code === 'USE_VERIFICATION_ENDPOINT'
      ? ok(`PATCH cannot set ${s}`)
      : bad(`PATCH cannot set ${s}`, `${r.status} ${r.json?.code}`);
  }

  // The exempt task takes the ordinary path, which is the other half of the rule.
  await api(`/api/projects/tasks/${exemptTask}`, { token, method: 'PATCH', body: { status: 'InProgress' } });
  const exemptDone = await api(`/api/projects/tasks/${exemptTask}`, {
    token, method: 'PATCH', body: { status: 'Done' },
  });
  exemptDone.json?.task?.status === 'Done'
    ? ok('exempt work is still finished the ordinary way')
    : bad('exempt work is still finished the ordinary way', `${exemptDone.status}`);

  const wrongSubmit = await api(`/api/projects/tasks/${exemptTask}/submit`, { token, method: 'POST' });
  wrongSubmit.status === 400 && wrongSubmit.json?.code === 'VERIFICATION_NOT_REQUIRED'
    ? ok('exempt work cannot be pushed into a reviewer queue')
    : bad('exempt work cannot be pushed into a reviewer queue',
          `${wrongSubmit.status} ${wrongSubmit.json?.code}`);

  // ── 15. Submission, and the gap between the two figures ──────────────────
  console.log('\n15. Submission');

  const submitted = await api(`/api/projects/tasks/${scopeTask}/submit`, {
    token, method: 'POST', body: { note: 'Scope statement drafted and circulated.' },
  });
  submitted.json?.task?.status === 'SubmittedForVerification'
    ? ok('work in progress can be submitted for verification')
    : bad('work can be submitted', `${submitted.status} ${JSON.stringify(submitted.json).slice(0, 140)}`);
  submitted.json?.task?.completionPercent === 100 && submitted.json?.task?.verificationRound === 1
    ? ok('submitting pins the claim at 100 and opens round 1')
    : bad('submitting pins the claim and opens round 1',
          `${submitted.json?.task?.completionPercent} / ${submitted.json?.task?.verificationRound}`);

  // Two of three tasks are finished as far as the doers are concerned, but only
  // the exempt one counts as confirmed. That gap is the product.
  const rollup15 = submitted.json?.rollup;
  rollup15?.reportedProgress === 67 && rollup15?.verifiedProgress === 33
    ? ok('reported and verified separate', `${rollup15.reportedProgress}% reported, ${rollup15.verifiedProgress}% verified`)
    : bad('reported and verified separate',
          `got ${rollup15?.reportedProgress}/${rollup15?.verifiedProgress}, expected 67/33`);

  const phase15 = await api(`/api/projects/${vid}/plan`, { token });
  phase15.json?.phases?.[0]?.status !== 'Complete'
    ? ok('a phase holding work still with a reviewer is not Complete',
         phase15.json?.phases?.[0]?.status)
    : bad('a phase holding submitted work is not Complete');

  // ── 16. Separation of duties over HTTP ───────────────────────────────────
  // The assertion this whole module rests on.
  console.log('\n16. Separation of duties');

  const selfVerify = await api(`/api/projects/tasks/${scopeTask}/verify`, {
    token, method: 'POST', body: { decision: 'Accept' },
  });
  selfVerify.status === 403 && selfVerify.json?.code === 'SELF_VERIFICATION'
    ? ok('the person who did the work cannot accept it', selfVerify.json.message.slice(0, 60))
    : bad('the person who did the work cannot accept it',
          `${selfVerify.status} ${selfVerify.json?.code}`);

  // A second identity, holding a role that carries the verification capability.
  //
  // Inviting is capped by what the inviter holds — you cannot issue privileges
  // you lack — so the role has to be one this account can actually grant. The
  // bootstrap operator deliberately holds a narrow set, so the usual answer is
  // its own role, which makes the point sharper anyway: two break-glass
  // administrators, and the one who did the work is still refused.
  const perms = await api('/api/iam/effective-permissions', { token });
  const granted = new Set(perms.json?.granted || []);

  granted.has('verify-project-delivery')
    ? ok('the verification capability is provisioned and held', perms.json?.roleKey)
    : bad('the verification capability is provisioned and held',
          `role ${perms.json?.roleKey} holds ${granted.size} capabilities`);

  const roles = await api('/api/iam/roles', { token });
  const verifierRole = (roles.json?.roles || []).find(
    (r) => Array.isArray(r.capabilities)
      && r.capabilities.includes('verify-project-delivery')
      && r.capabilities.includes('execute-project-work')
      && r.capabilities.every((c) => granted.has(c)),
  );
  verifierRole
    ? ok('a grantable role carries the verification capability', verifierRole.name)
    : bad('a grantable role carries the verification capability');

  let reviewerToken = null;
  let reviewerId = null;
  if (verifierRole) {
    const email = `reviewer.${Date.now()}@verify.local`;
    const invited = await api('/api/iam/users/invite', {
      token, method: 'POST',
      body: { email, name: 'Independent Reviewer', roleId: verifierRole.id },
    });
    const tempPassword = invited.json?.temporaryPassword;
    reviewerId = invited.json?.user?.id;

    if (tempPassword) {
      const firstToken = await login(email, tempPassword);
      const newPassword = `Rev-${Date.now()}-Aa1`;
      await api('/api/auth/change-password', {
        token: firstToken, method: 'POST',
        body: { currentPassword: tempPassword, newPassword },
      });
      reviewerToken = await login(email, newPassword);
    }
    reviewerToken
      ? ok('an independent reviewer can sign in')
      : bad('an independent reviewer can sign in', JSON.stringify(invited.json).slice(0, 140));
  }

  if (reviewerToken) {
    // A rejection with no reason comes straight back, so refuse it up front.
    const bareReject = await api(`/api/projects/tasks/${scopeTask}/verify`, {
      token: reviewerToken, method: 'POST', body: { decision: 'Reject', note: 'no' },
    });
    bareReject.status === 400 && bareReject.json?.code === 'REASON_REQUIRED'
      ? ok('a rejection must say why')
      : bad('a rejection must say why', `${bareReject.status} ${bareReject.json?.code}`);

    const badDecision = await api(`/api/projects/tasks/${scopeTask}/verify`, {
      token: reviewerToken, method: 'POST', body: { decision: 'Maybe' },
    });
    badDecision.status === 400
      ? ok('a decision must be Accept or Reject')
      : bad('a decision must be Accept or Reject', `${badDecision.status}`);

    const rejected = await api(`/api/projects/tasks/${scopeTask}/verify`, {
      token: reviewerToken, method: 'POST',
      body: { decision: 'Reject', note: 'Scope omits the third-party hosting boundary.' },
    });
    rejected.json?.task?.status === 'Rejected'
      ? ok('a reviewer can reject submitted work')
      : bad('a reviewer can reject submitted work',
            `${rejected.status} ${JSON.stringify(rejected.json).slice(0, 140)}`);
    rejected.json?.task?.verifiedById === null && rejected.json?.task?.completedAt === null
      ? ok('rejected work carries no verifier and no completion date')
      : bad('rejected work carries no verifier',
            `${rejected.json?.task?.verifiedById} / ${rejected.json?.task?.completedAt}`);
    rejected.json?.rollup?.verifiedProgress === 33
      ? ok('a rejection leaves the verified figure where it was')
      : bad('a rejection leaves the verified figure', `${rejected.json?.rollup?.verifiedProgress}`);

    // Rework: rejected work is ordinary work again.
    const rework = await api(`/api/projects/tasks/${scopeTask}`, {
      token, method: 'PATCH', body: { status: 'InProgress' },
    });
    rework.json?.task?.status === 'InProgress'
      ? ok('rejected work goes back to in progress through the ordinary update')
      : bad('rejected work goes back to in progress', `${rework.status} ${rework.json?.code}`);

    const resubmitted = await api(`/api/projects/tasks/${scopeTask}/submit`, { token, method: 'POST' });
    resubmitted.json?.task?.verificationRound === 2
      ? ok('resubmission opens a second round')
      : bad('resubmission opens a second round', `${resubmitted.json?.task?.verificationRound}`);

    const accepted = await api(`/api/projects/tasks/${scopeTask}/verify`, {
      token: reviewerToken, method: 'POST',
      body: { decision: 'Accept', note: 'Hosting boundary now in scope.' },
    });
    accepted.json?.task?.status === 'Verified'
      ? ok('a reviewer can accept resubmitted work')
      : bad('a reviewer can accept resubmitted work',
            `${accepted.status} ${JSON.stringify(accepted.json).slice(0, 140)}`);
    accepted.json?.task?.verifiedById === reviewerId
      ? ok('the accepted task records who confirmed it')
      : bad('the accepted task records who confirmed it', `${accepted.json?.task?.verifiedById}`);
    accepted.json?.rollup?.verifiedProgress === 67
      ? ok('acceptance moves the verified figure', `33% → ${accepted.json.rollup.verifiedProgress}%`)
      : bad('acceptance moves the verified figure', `${accepted.json?.rollup?.verifiedProgress}`);

    // ── 17. The record ─────────────────────────────────────────────────────
    console.log('\n17. The verification record');

    const history = await api(`/api/projects/tasks/${scopeTask}/verifications`, { token });
    const outcomes = (history.json?.history || []).map((h) => h.outcome);
    outcomes.join(',') === 'Submitted,Rejected,Submitted,Accepted'
      ? ok('every decision is kept, in order', outcomes.join(' → '))
      : bad('every decision is kept, in order', outcomes.join(','));
    (history.json?.history || []).filter((h) => h.round === 1).length === 2
      ? ok('a rejection stays grouped with the submission that caused it')
      : bad('a rejection stays grouped with its submission');
    (history.json?.history || []).some((h) => h.note && h.note.includes('hosting boundary'))
      ? ok('the reason a reviewer gave is part of the record')
      : bad('the reason a reviewer gave is part of the record');

    const queue = await api(`/api/projects/${vid}/verification`, { token });
    queue.json?.summary?.awaiting === 0 && queue.json?.summary?.decisions === 4
      ? ok('the queue is empty and four decisions are on file')
      : bad('the queue and decision count',
            `${queue.json?.summary?.awaiting} awaiting, ${queue.json?.summary?.decisions} decisions`);

    // ── 18. Reopening discards a confirmation, so it is a management act ────
    console.log('\n18. Reopening');

    const shortNote = await api(`/api/projects/tasks/${scopeTask}/return`, {
      token, method: 'POST', body: { note: 'nope' },
    });
    shortNote.status === 400 && shortNote.json?.code === 'REASON_REQUIRED'
      ? ok('reopening verified work needs a reason')
      : bad('reopening verified work needs a reason', `${shortNote.status} ${shortNote.json?.code}`);

    const reopened = await api(`/api/projects/tasks/${scopeTask}/return`, {
      token, method: 'POST', body: { note: 'Client disputes the boundary after all.' },
    });
    reopened.json?.task?.status === 'InProgress' && reopened.json?.task?.verifiedById === null
      ? ok('reopening returns the task and clears the verifier')
      : bad('reopening returns the task', `${reopened.status} ${reopened.json?.task?.status}`);
    reopened.json?.rollup?.verifiedProgress === 33
      ? ok('and the verified figure falls back', `67% → ${reopened.json.rollup.verifiedProgress}%`)
      : bad('the verified figure falls back', `${reopened.json?.rollup?.verifiedProgress}`);
  }

  console.log(`\n─── ${pass} passed, ${fail} failed ───\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nTest harness error:', e); process.exit(1); });
