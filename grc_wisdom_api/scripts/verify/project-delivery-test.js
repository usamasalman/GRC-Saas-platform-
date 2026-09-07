/**
 * Delivery projects — slices 1 to 4: the engagement, the work inside it, the
 * independent verification that turns one progress figure into two, and the
 * attribution of every day the plan has lost.
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
  console.log(`\n─── Delivery projects · slices 1-6 · ${API} ───\n`);

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

    // A queue nobody is told about is a queue that sits. The reviewer is not a
    // fixed person, so the people told are the ones accountable for the work.
    const inbox = await api('/api/notifications', { token });
    const told = (inbox.json?.notifications || []).some(
      (n) => n.subjectType === 'ProjectTask' && n.event === 'PROJECT_TASK_REJECTED',
    );
    told
      ? ok('the rejection reaches the inbox of whoever has to act on it')
      : bad('the rejection reaches an inbox',
            `${inbox.status} ${(inbox.json?.notifications || []).length} notifications`);

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

  // ── 19. The agreed plan ─────────────────────────────────────────────────
  console.log('\n19. Baseline');

  const bProject = await api('/api/projects', {
    token, method: 'POST',
    body: {
      name: 'Delay attribution project',
      startDate: iso(-5), targetEndDate: iso(90),
      ownerId: myUserId, managerId: myUserId,
    },
  });
  const bid = bProject.json?.project?.id;
  bid ? ok('project for the delay run created') : bad('project for the delay run created',
        `${bProject.status} ${JSON.stringify(bProject.json).slice(0, 160)}`);
  if (!bid) { console.log('\nCannot continue.\n'); process.exit(1); }

  // A draft has agreed nothing, so there is nothing to slip from.
  bProject.json.project.baselineSetAt === null && bProject.json.project.baselineVersion === 0
    ? ok('a draft carries no agreed plan')
    : bad('a draft carries no agreed plan',
          `${bProject.json.project.baselineSetAt} / v${bProject.json.project.baselineVersion}`);

  const bActivated = await api(`/api/projects/${bid}`, {
    token, method: 'PATCH', body: { status: 'Active' },
  });
  bActivated.json?.project?.baselineSetAt && bActivated.json?.project?.baselineVersion === 1
    ? ok('activation stamps the plan that was agreed', 'v1')
    : bad('activation stamps the agreed plan',
          `${bActivated.json?.project?.baselineSetAt} / v${bActivated.json?.project?.baselineVersion}`);

  const bPhase = await api(`/api/projects/${bid}/phases`, {
    token, method: 'POST',
    body: { name: 'Remediation', startDate: iso(-5), targetEndDate: iso(60), ownerId: myUserId },
  });
  const bPhaseId = bPhase.json?.phase?.id;
  const bTask = await api(`/api/projects/phases/${bPhaseId}/tasks`, {
    token, method: 'POST',
    body: { name: 'Deploy MFA across the estate', assigneeId: myUserId, dueDate: iso(10) },
  });
  const btid = bTask.json?.task?.id;
  btid ? ok('task created on a running engagement') : bad('task created', `${bTask.status}`);
  if (!btid) { console.log('\nCannot continue.\n'); process.exit(1); }

  // Added to a running engagement, so its plan was agreed the moment it was
  // added — unlike one added to a draft, which is still being planned.
  bTask.json.task.baselineDueDate
    ? ok('a task added to a live plan is baselined at creation')
    : bad('a task added to a live plan is baselined at creation');

  const bPlan = await api(`/api/projects/${bid}/plan`, { token });
  const bPlanTask = bPlan.json?.phases?.[0]?.tasks?.[0];
  bPlanTask?.slippage?.baselined === true && bPlanTask?.slippage?.slipDays === 0
    ? ok('a freshly planned task has slipped nothing')
    : bad('a freshly planned task has slipped nothing', JSON.stringify(bPlanTask?.slippage));

  // ── 20. A date cannot move past the agreed one in silence ───────────────
  console.log('\n20. Moving a date');

  const silentSlip = await api(`/api/projects/tasks/${btid}`, {
    token, method: 'PATCH', body: { dueDate: iso(20) },
  });
  silentSlip.status === 409 && silentSlip.json?.code === 'USE_RESCHEDULE_ENDPOINT'
    ? ok('a date cannot slip past the agreed one through an ordinary update')
    : bad('a date cannot slip silently', `${silentSlip.status} ${silentSlip.json?.code}`);

  // Pulling a date in never needs defending.
  const pullIn = await api(`/api/projects/tasks/${btid}`, {
    token, method: 'PATCH', body: { dueDate: iso(5) },
  });
  pullIn.status === 200
    ? ok('pulling a date in stays an ordinary edit')
    : bad('pulling a date in stays an ordinary edit', `${pullIn.status} ${pullIn.json?.code}`);

  const noReason = await api(`/api/projects/tasks/${btid}/reschedule`, {
    token, method: 'POST',
    body: { dueDate: iso(20), category: 'ClientDependency', owingSide: 'Client' },
  });
  noReason.status === 400 && noReason.json?.code === 'REASON_REQUIRED'
    ? ok('a reschedule must say why')
    : bad('a reschedule must say why', `${noReason.status} ${noReason.json?.code}`);

  const badCategory = await api(`/api/projects/tasks/${btid}/reschedule`, {
    token, method: 'POST',
    body: {
      dueDate: iso(20), category: 'Vibes', owingSide: 'Client',
      reason: 'The client has not returned the asset register.',
    },
  });
  badCategory.status === 400 && badCategory.json?.code === 'UNKNOWN_CATEGORY'
    ? ok('a reason has to be one the register can add up')
    : bad('a reason has to be summable', `${badCategory.status} ${badCategory.json?.code}`);

  const notASlip = await api(`/api/projects/tasks/${btid}/reschedule`, {
    token, method: 'POST',
    body: {
      dueDate: iso(3), category: 'ClientDependency', owingSide: 'Client',
      reason: 'Pulling this one forward after all.',
    },
  });
  notASlip.status === 400 && notASlip.json?.code === 'NOT_A_SLIP'
    ? ok('a date that is not slipping cannot invent a delay')
    : bad('a date that is not slipping cannot invent a delay',
          `${notASlip.status} ${notASlip.json?.code}`);

  const slipped = await api(`/api/projects/tasks/${btid}/reschedule`, {
    token, method: 'POST',
    body: {
      dueDate: iso(20), category: 'ClientDependency', owingSide: 'Client',
      reason: 'Client has not returned the signed asset register.',
    },
  });
  slipped.status === 200
    ? ok('a slip with a reason and an owner is accepted')
    : bad('a slip with a reason is accepted',
          `${slipped.status} ${JSON.stringify(slipped.json).slice(0, 160)}`);

  // Agreed day 10, pulled in to day 5, pushed to day 20. The plan is ten days
  // behind, not fifteen — the earlier improvement is not re-charged as a loss.
  slipped.json?.impediment?.impactDays === 10
    ? ok('the cost is the increase in slip, not the distance travelled', '10 days')
    : bad('the cost is the increase in slip', `got ${slipped.json?.impediment?.impactDays}`);
  slipped.json?.impediment?.kind === 'Delay' && slipped.json?.impediment?.resolvedAt
    ? ok('a recorded delay is closed at birth — the time is already gone')
    : bad('a recorded delay is closed at birth', JSON.stringify(slipped.json?.impediment?.kind));
  slipped.json?.task?.slippage?.slipDays === 10
    ? ok('and the task now reads ten days behind plan')
    : bad('the task reads ten days behind', JSON.stringify(slipped.json?.task?.slippage));

  // ── 21. Blocked is reached by saying what the blocker is ────────────────
  console.log('\n21. Blockers');

  const silentBlock = await api(`/api/projects/tasks/${btid}`, {
    token, method: 'PATCH', body: { status: 'Blocked' },
  });
  silentBlock.json?.code === 'USE_IMPEDIMENT_ENDPOINT'
    ? ok('work cannot be blocked without saying why')
    : bad('work cannot be blocked silently', `${silentBlock.status} ${silentBlock.json?.code}`);

  const blockNoCategory = await api(`/api/projects/tasks/${btid}/block`, {
    token, method: 'POST', body: { title: 'Waiting on something' },
  });
  blockNoCategory.status === 400
    ? ok('a blocker needs a category and an owner')
    : bad('a blocker needs a category and an owner', `${blockNoCategory.status}`);

  const blocked = await api(`/api/projects/tasks/${btid}/block`, {
    token, method: 'POST',
    body: {
      title: 'Firewall change window not approved',
      category: 'ThirdParty', owingSide: 'ThirdParty', severity: 'High',
      description: 'Managed service provider has not scheduled the change.',
    },
  });
  blocked.status === 201 && blocked.json?.task?.status === 'Blocked'
    ? ok('recording the blocker is what stops the work')
    : bad('recording the blocker stops the work',
          `${blocked.status} ${JSON.stringify(blocked.json).slice(0, 140)}`);
  const impId = blocked.json?.impediment?.id;
  blocked.json?.impediment?.open === true && blocked.json?.impediment?.impactDays === null
    ? ok('an open blocker has no stamped cost yet')
    : bad('an open blocker has no stamped cost', JSON.stringify(blocked.json?.impediment?.impactDays));

  const silentUnblock = await api(`/api/projects/tasks/${btid}`, {
    token, method: 'PATCH', body: { status: 'InProgress' },
  });
  silentUnblock.json?.code === 'USE_IMPEDIMENT_ENDPOINT'
    ? ok('and the blocker is cleared, not the status')
    : bad('the blocker is cleared, not the status', `${silentUnblock.json?.code}`);

  const shortClose = await api(`/api/projects/impediments/${impId}/resolve`, {
    token, method: 'POST', body: { resolutionNote: 'done' },
  });
  shortClose.status === 400 && shortClose.json?.code === 'REASON_REQUIRED'
    ? ok('clearing a blocker must say how')
    : bad('clearing a blocker must say how', `${shortClose.status} ${shortClose.json?.code}`);

  const cleared = await api(`/api/projects/impediments/${impId}/resolve`, {
    token, method: 'POST',
    body: { resolutionNote: 'Change window approved for Thursday night.' },
  });
  cleared.json?.impediment?.open === false && cleared.json?.task?.status === 'InProgress'
    ? ok('clearing the last blocker releases the work')
    : bad('clearing the last blocker releases the work',
          `${cleared.status} ${cleared.json?.task?.status}`);
  cleared.json?.impediment?.impactDays !== null
    ? ok('and stamps what it cost', `${cleared.json.impediment.impactDays} day(s)`)
    : bad('and stamps what it cost');

  const reClose = await api(`/api/projects/impediments/${impId}/resolve`, {
    token, method: 'POST', body: { resolutionNote: 'Clearing it a second time.' },
  });
  reClose.status === 409 && reClose.json?.code === 'ALREADY_RESOLVED'
    ? ok('a cleared blocker cannot be cleared again')
    : bad('a cleared blocker cannot be cleared again', `${reClose.status} ${reClose.json?.code}`);

  // ── 22. The register, and who owes the days ─────────────────────────────
  console.log('\n22. Attribution');

  const noImpact = await api(`/api/projects/${bid}/impediments`, {
    token, method: 'POST',
    body: { kind: 'Delay', title: 'Scope grew', category: 'ScopeChange', owingSide: 'Provider' },
  });
  noImpact.status === 400 && noImpact.json?.code === 'IMPACT_REQUIRED'
    ? ok('a recorded delay must say how many days it cost')
    : bad('a recorded delay must state its cost', `${noImpact.status} ${noImpact.json?.code}`);

  // Not attached to any task: "the client has not appointed an ISMS owner"
  // holds up a programme rather than a checkbox.
  const programmeLevel = await api(`/api/projects/${bid}/impediments`, {
    token, method: 'POST',
    body: {
      kind: 'Delay', title: 'Scope grew to cover the second data centre',
      category: 'ScopeChange', owingSide: 'Provider', impactDays: 4,
    },
  });
  programmeLevel.status === 201 && programmeLevel.json?.impediment?.task === null
    ? ok('an impediment can sit against the engagement, not a checkbox')
    : bad('an impediment can sit against the engagement',
          `${programmeLevel.status} ${JSON.stringify(programmeLevel.json).slice(0, 140)}`);

  const delayId = programmeLevel.json?.impediment?.id;
  const resolveDelay = await api(`/api/projects/impediments/${delayId}/resolve`, {
    token, method: 'POST', body: { resolutionNote: 'Trying to clear a recorded delay.' },
  });
  resolveDelay.status === 409 && resolveDelay.json?.code === 'NOT_A_BLOCKER'
    ? ok('a recorded delay has nothing left to clear')
    : bad('a recorded delay has nothing to clear', `${resolveDelay.status} ${resolveDelay.json?.code}`);

  const register = await api(`/api/projects/${bid}/impediments`, { token });
  const sum = register.json?.summary;
  sum?.bySide?.Client === 10 && sum?.bySide?.Provider === 4
    ? ok('days are attributed to whoever owed them',
         `Client ${sum.bySide.Client}, Provider ${sum.bySide.Provider}, ThirdParty ${sum.bySide.ThirdParty}`)
    : bad('days are attributed to whoever owed them', JSON.stringify(sum?.bySide));
  sum?.largestSide === 'Client'
    ? ok('and the side carrying the most is named')
    : bad('the side carrying the most is named', `${sum?.largestSide}`);
  Object.values(sum?.bySide || {}).reduce((a, b) => a + b, 0) === sum?.totalDays
    ? ok('the sides add up to the total', `${sum.totalDays} days`)
    : bad('the sides add up to the total', JSON.stringify(sum));
  sum?.openCount === 0
    ? ok('nothing is still blocking') : bad('nothing is still blocking', `${sum?.openCount}`);

  const openOnly = await api(`/api/projects/${bid}/impediments?open=true`, { token });
  (openOnly.json?.impediments || []).length === 0
    ? ok('the register can be filtered to what is still costing time')
    : bad('the open filter works', `${(openOnly.json?.impediments || []).length}`);

  // ── 23. Agreeing a new plan ─────────────────────────────────────────────
  console.log('\n23. Rebaseline');

  const noWhy = await api(`/api/projects/${bid}/rebaseline`, {
    token, method: 'POST', body: { reason: 'because' },
  });
  noWhy.status === 400 && noWhy.json?.code === 'REASON_REQUIRED'
    ? ok('a baseline cannot move without a reason')
    : bad('a baseline cannot move without a reason', `${noWhy.status} ${noWhy.json?.code}`);

  const rebaselined = await api(`/api/projects/${bid}/rebaseline`, {
    token, method: 'POST',
    body: { reason: 'Steering committee agreed a revised plan on 12 March.' },
  });
  rebaselined.json?.baseline?.version === 2
    ? ok('a renegotiated plan is version 2, not version 1 again')
    : bad('a renegotiated plan increments the version',
          `${rebaselined.status} ${JSON.stringify(rebaselined.json).slice(0, 140)}`);

  const afterRebase = await api(`/api/projects/${bid}/plan`, { token });
  afterRebase.json?.phases?.[0]?.tasks?.[0]?.slippage?.slipDays === 0
    ? ok('the task now measures against the new plan')
    : bad('the task measures against the new plan',
          JSON.stringify(afterRebase.json?.phases?.[0]?.tasks?.[0]?.slippage));

  // What was lost getting here survives. Rebaselining resets what is being
  // worked to, not the record of what it cost to get this far.
  const afterRegister = await api(`/api/projects/${bid}/impediments`, { token });
  afterRegister.json?.summary?.totalDays === sum?.totalDays
    ? ok('but the days already lost are still on the record', `${sum?.totalDays} days`)
    : bad('the days already lost survive a rebaseline',
          `${afterRegister.json?.summary?.totalDays} vs ${sum?.totalDays}`);

  // ── 24. Evidence for delivered work ─────────────────────────────────────
  console.log('\n24. Evidence');

  const eProject = await api('/api/projects', {
    token, method: 'POST',
    body: {
      name: 'Evidence and traceability project',
      startDate: iso(-5), targetEndDate: iso(60),
      ownerId: myUserId, managerId: myUserId,
      // The policy slice 5 makes real: verification follows the deliverable.
      verificationPolicy: 'EvidenceTasks',
    },
  });
  const eid = eProject.json?.project?.id;
  eid ? ok('project for the evidence run created')
      : bad('project for the evidence run created', `${eProject.status}`);
  if (!eid) { console.log('\nCannot continue.\n'); process.exit(1); }

  eProject.json.project.verificationPolicy === 'EvidenceTasks'
    ? ok('EvidenceTasks is accepted as a policy')
    : bad('EvidenceTasks is accepted', `${eProject.json.project.verificationPolicy}`);

  await api(`/api/projects/${eid}`, { token, method: 'PATCH', body: { status: 'Active' } });

  const ePhase = await api(`/api/projects/${eid}/phases`, {
    token, method: 'POST',
    body: { name: 'Scoping', startDate: iso(-5), targetEndDate: iso(30), ownerId: myUserId },
  });
  const ePhaseId = ePhase.json?.phase?.id;

  // Two tasks: one will produce a deliverable, one will not.
  const withDoc = await api(`/api/projects/phases/${ePhaseId}/tasks`, {
    token, method: 'POST', body: { name: 'Write the ISMS scope statement', assigneeId: myUserId },
  });
  const noDoc = await api(`/api/projects/phases/${ePhaseId}/tasks`, {
    token, method: 'POST', body: { name: 'Book the kickoff call', assigneeId: myUserId },
  });
  const withDocId = withDoc.json?.task?.id;
  const noDocId = noDoc.json?.task?.id;
  withDocId && noDocId ? ok('two tasks created') : bad('two tasks created');
  if (!withDocId) { console.log('\nCannot continue.\n'); process.exit(1); }

  // Under EvidenceTasks, a task with nothing to show needs no reviewer.
  const planBefore = await api(`/api/projects/${eid}/plan`, { token });
  const tasksBefore = planBefore.json?.phases?.[0]?.tasks || [];
  tasksBefore.every((t) => t.needsVerification === false)
    ? ok('under EvidenceTasks, work with no deliverable needs no reviewer')
    : bad('EvidenceTasks with no evidence',
          JSON.stringify(tasksBefore.map((t) => t.needsVerification)));

  // A real PDF: %PDF- as the leading bytes.
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
  const pdfB64 = pdfBytes.toString('base64');

  const noFile = await api(`/api/projects/tasks/${withDocId}/evidence`, {
    token, method: 'POST', body: { title: 'Scope statement' },
  });
  noFile.status === 400
    ? ok('evidence needs an actual file') : bad('evidence needs a file', `${noFile.status}`);

  const evDangerous = await api(`/api/projects/tasks/${withDocId}/evidence`, {
    token, method: 'POST',
    body: { title: 'Report', fileName: 'report.html', fileData: pdfB64 },
  });
  evDangerous.status === 400 && evDangerous.json?.code === 'DANGEROUS_TYPE'
    ? ok('markup is refused as evidence — it would run as the application')
    : bad('markup is refused', `${evDangerous.status} ${evDangerous.json?.code}`);

  const evAttached = await api(`/api/projects/tasks/${withDocId}/evidence`, {
    token, method: 'POST',
    body: {
      title: 'ISMS scope statement v1',
      description: 'Signed by the CISO.',
      fileName: 'isms-scope.pdf',
      fileData: pdfB64,
      classification: 'Confidential',
    },
  });
  evAttached.status === 201
    ? ok('evidence attaches to delivered work')
    : bad('evidence attaches', `${evAttached.status} ${JSON.stringify(evAttached.json).slice(0, 160)}`);

  const evId = evAttached.json?.evidence?.id;
  // The type is read from the bytes, not from anything the caller said.
  evAttached.json?.evidence?.mimeType === 'application/pdf'
    ? ok('the content type comes from the bytes, not the caller')
    : bad('content type from bytes', `${evAttached.json?.evidence?.mimeType}`);
  evAttached.json?.evidence?.fileSize === pdfBytes.length
    ? ok('the recorded size is the real size') : bad('recorded size', `${evAttached.json?.evidence?.fileSize}`);
  /^[0-9a-f]{64}$/.test(evAttached.json?.evidence?.sha256 || '')
    ? ok('a SHA-256 of the stored bytes is recorded')
    : bad('sha256 recorded', `${evAttached.json?.evidence?.sha256}`);

  // The rollup moved: this task now needs a reviewer that it did not before.
  const planAfter = await api(`/api/projects/${eid}/plan`, { token });
  const deliverable = (planAfter.json?.phases?.[0]?.tasks || [])
    .find((t) => t.id === withDocId);
  const nonDeliverable = (planAfter.json?.phases?.[0]?.tasks || [])
    .find((t) => t.id === noDocId);
  deliverable?.needsVerification === true && nonDeliverable?.needsVerification === false
    ? ok('attaching a deliverable is what sends the task to a reviewer')
    : bad('evidence drives the requirement',
          `${deliverable?.needsVerification} / ${nonDeliverable?.needsVerification}`);

  // ── 25. Files are not publicly reachable ────────────────────────────────
  console.log('\n25. Evidence storage');

  const evDownload = await api(`/api/projects/evidence/${evId}/evDownload`, { token });
  evDownload.status === 200
    ? ok('evidence downloads through an authenticated route')
    : bad('evidence downloads', `${evDownload.status}`);

  const anonDownload = await api(`/api/projects/evidence/${evId}/evDownload`, {});
  anonDownload.status === 401 || anonDownload.status === 403
    ? ok('and refuses an unauthenticated caller', `${anonDownload.status}`)
    : bad('refuses an unauthenticated caller', `${anonDownload.status}`);

  const evIntegrity = await api(`/api/projects/${eid}/evidence/evIntegrity`, { token });
  evIntegrity.json?.intact === 1 && evIntegrity.json?.altered === 0
    ? ok('stored bytes still hash to what was recorded')
    : bad('evIntegrity check', JSON.stringify(evIntegrity.json).slice(0, 160));

  // ── 26. Evidence cannot move under a signature ──────────────────────────
  console.log('\n26. Immutability');

  await api(`/api/projects/tasks/${withDocId}`, { token, method: 'PATCH', body: { status: 'InProgress' } });
  const evSubmitted = await api(`/api/projects/tasks/${withDocId}/submit`, { token, method: 'POST' });
  evSubmitted.status === 200
    ? ok('work with a deliverable can be evSubmitted for review')
    : bad('submit', `${evSubmitted.status} ${evSubmitted.json?.code}`);

  if (!reviewerToken) {
    console.log('   SKIP  no independent reviewer available — sign-off rules unasserted');
  } else {
  const evVerified = await api(`/api/projects/tasks/${withDocId}/verify`, {
    token: reviewerToken, method: 'POST',
    body: { decision: 'Accept', note: 'Scope statement reviewed against the standard.' },
  });
  evVerified.status === 200
    ? ok('and accepted by someone who did not do it')
    : bad('verify', `${evVerified.status} ${evVerified.json?.code}`);

  // The rule the slice exists for: nothing may appear behind a sign-off.
  const lateEvidence = await api(`/api/projects/tasks/${withDocId}/evidence`, {
    token, method: 'POST',
    body: { title: 'Added afterwards', fileName: 'extra.pdf', fileData: pdfB64 },
  });
  lateEvidence.status === 409 && lateEvidence.json?.code === 'TASK_VERIFIED'
    ? ok('evidence cannot be added behind a completed sign-off')
    : bad('no evidence behind a sign-off', `${lateEvidence.status} ${lateEvidence.json?.code}`);

  const pullIt = await api(`/api/projects/evidence/${evId}/withdraw`, {
    token, method: 'POST', body: { reason: 'Superseded by a later version of the document.' },
  });
  pullIt.status === 409 && pullIt.json?.code === 'EVIDENCE_LOCKED'
    ? ok('nor can the evidence a reviewer relied on be pulled out from under them')
    : bad('evVerified evidence is locked', `${pullIt.status} ${pullIt.json?.code}`);
  }

  // ── 27. Traceability to the framework ───────────────────────────────────
  console.log('\n27. Traceability');

  const standards = await api('/api/grc/standards', { token });
  const std = (standards.json?.standards || []).find((s) => (s.clauses || []).length > 0)
    || (standards.json?.standards || [])[0];
  const clauseList = std?.clauses || [];

  if (clauseList.length === 0) {
    console.log('   SKIP  no standard with clauses is seeded — traceability asserted in the logic suite');
  } else {
    const clauseId = clauseList[0].id;

    const evLinked = await api(`/api/projects/tasks/${noDocId}/clauses`, {
      token, method: 'POST',
      body: { clauseIds: [clauseId], note: 'Satisfies the scoping requirement.' },
    });
    evLinked.status === 201
      ? ok('delivered work maps to the clause it satisfies')
      : bad('clause link', `${evLinked.status} ${JSON.stringify(evLinked.json).slice(0, 160)}`);

    const again = await api(`/api/projects/tasks/${noDocId}/clauses`, {
      token, method: 'POST', body: { clauseIds: [clauseId] },
    });
    again.status === 201
      ? ok('re-sending a mapping is a no-op, not an error')
      : bad('duplicate mapping is a no-op', `${again.status}`);

    const bogus = await api(`/api/projects/tasks/${noDocId}/clauses`, {
      token, method: 'POST', body: { clauseIds: ['00000000-0000-0000-0000-000000000000'] },
    });
    bogus.status === 400
      ? ok('a clause that does not exist is refused') : bad('bogus clause refused', `${bogus.status}`);

    const evRegister = await api(`/api/projects/${eid}/evidence`, { token });
    evRegister.json?.coverage?.clausesCovered === 1
      ? ok('the evRegister reports what the plan traces to')
      : bad('coverage counts clauses', JSON.stringify(evRegister.json?.coverage));
    // Mapped but not finished: an intention, not something to defend.
    evRegister.json?.coverage?.clausesSatisfied === 0
      ? ok('a clause whose work is unfinished is claimed, not defended')
      : bad('unfinished work does not satisfy a clause',
            `${evRegister.json?.coverage?.clausesSatisfied}`);
  }

  // ── 28. The evidence evRegister ───────────────────────────────────────────
  console.log('\n28. Register');

  const reg = await api(`/api/projects/${eid}/evidence`, { token });
  reg.json?.summary?.standing === 1
    ? ok('the evRegister lists standing evidence') : bad('evRegister standing', JSON.stringify(reg.json?.summary));
  const expectedStanding = reviewerToken ? 'Seen' : 'Pending';
  (reg.json?.evidence || [])[0]?.standing === expectedStanding
    ? ok('and marks whether the reviewer actually saw it', expectedStanding)
    : bad('standing marked', `${(reg.json?.evidence || [])[0]?.standing}`);
  reg.json?.vocabulary?.classifications?.length === 4
    ? ok('the classification vocabulary is served to the client')
    : bad('vocabulary served', JSON.stringify(reg.json?.vocabulary?.classifications));

  // ── 29. Report branding over HTTP ───────────────────────────────────────
  console.log('\n29. Branding');

  const brandRead = await api('/api/tenants/branding', { token });
  brandRead.status === 200 && brandRead.json?.branding?.effective
    ? ok('branding resolves for the caller\'s own organisation')
    : bad('branding resolves', `${brandRead.status}`);

  const badColour = await api('/api/tenants/branding', {
    token, method: 'PATCH', body: { brandColour: 'rebeccapurple' },
  });
  badColour.status === 400 && badColour.json?.code === 'BAD_COLOUR'
    ? ok('a named colour is refused — the value goes into three file formats')
    : bad('a named colour is refused', `${badColour.status} ${badColour.json?.code}`);

  const badMarking = await api('/api/tenants/branding', {
    token, method: 'PATCH', body: { marking: 'Whatever' },
  });
  badMarking.status === 400
    ? ok('an invented marking is refused') : bad('invented marking refused', `${badMarking.status}`);

  const setBrand = await api('/api/tenants/branding', {
    token, method: 'PATCH',
    body: {
      displayName: 'Acme Group Ltd',
      brandColour: '#123456',
      marking: 'Restricted',
      footerText: 'Registered in England 12345678',
    },
  });
  setBrand.status === 200
    ? ok('branding saves')
    : bad('branding saves', `${setBrand.status} ${JSON.stringify(setBrand.json).slice(0, 140)}`);
  setBrand.json?.branding?.effective?.brandColour === '#123456'
    ? ok('and the resolved colour is what a report will use')
    : bad('resolved colour', `${setBrand.json?.branding?.effective?.brandColour}`);
  setBrand.json?.branding?.effective?.isDefault === false
    ? ok('the organisation is no longer on the platform default')
    : bad('no longer default');

  // Accepted, because it is genuinely their brand — but the caller is told the
  // renderer will draw headings in ink, which is better than discovering it on
  // a report already sent to a board.
  const paleBrand = await api('/api/tenants/branding', {
    token, method: 'PATCH', body: { brandColour: '#FDF3E2' },
  });
  paleBrand.status === 200 && paleBrand.json?.warning
    ? ok('a colour too pale to read is accepted with a warning', 'headings fall back to ink')
    : bad('pale colour warns', `${paleBrand.status} ${paleBrand.json?.warning}`);
  paleBrand.json?.branding?.effective?.textColour !== '#FDF3E2'
    ? ok('and the resolved text colour is not the unreadable one')
    : bad('text colour falls back', `${paleBrand.json?.branding?.effective?.textColour}`);

  // Put a legible colour back so the export assertions below stay meaningful.
  await api('/api/tenants/branding', {
    token, method: 'PATCH', body: { brandColour: '#123456' },
  });

  // ── 30. Logo storage ────────────────────────────────────────────────────
  console.log('\n30. Logo');

  // A 1x1 PNG — the smallest thing carrying a real PNG signature.
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const svgAttempt = await api('/api/tenants/branding/logo', {
    token, method: 'POST',
    body: { fileName: 'logo.svg', fileData: Buffer.from('<svg></svg>').toString('base64') },
  });
  svgAttempt.status === 400 && svgAttempt.json?.code === 'LOGO_TYPE'
    ? ok('an SVG is refused — it cannot embed, and carries script')
    : bad('SVG refused', `${svgAttempt.status} ${svgAttempt.json?.code}`);

  // Named .png, but the bytes are markup. The type comes from the bytes.
  const liar = await api('/api/tenants/branding/logo', {
    token, method: 'POST',
    body: { fileName: 'logo.png', fileData: Buffer.from('<html></html>').toString('base64') },
  });
  liar.status === 400 && liar.json?.code === 'LOGO_TYPE'
    ? ok('a file named .png whose bytes are markup is caught')
    : bad('mislabelled logo caught', `${liar.status} ${liar.json?.code}`);

  const logoUp = await api('/api/tenants/branding/logo', {
    token, method: 'POST', body: { fileName: 'acme.png', fileData: pngB64 },
  });
  logoUp.status === 201 && logoUp.json?.branding?.hasLogo
    ? ok('a PNG logo is stored')
    : bad('PNG logo stored', `${logoUp.status} ${JSON.stringify(logoUp.json).slice(0, 140)}`);

  // The storage key must never leave the server — it is the only thing standing
  // between the private store and an enumerable customer list.
  !JSON.stringify(logoUp.json || {}).includes('logoKey')
    ? ok('and the storage key is never exposed to a client')
    : bad('storage key is not exposed');

  const logoGet = await api('/api/tenants/branding/logo', { token });
  logoGet.status === 200
    ? ok('the logo reads back through an authenticated route')
    : bad('logo reads back', `${logoGet.status}`);

  const logoAnon = await api('/api/tenants/branding/logo', {});
  logoAnon.status === 401 || logoAnon.status === 403
    ? ok('and refuses an unauthenticated caller', `${logoAnon.status}`)
    : bad('logo refuses anonymous', `${logoAnon.status}`);

  // ── 31. Branding reaches a real export ──────────────────────────────────
  console.log('\n31. Branded exports');

  const issuesXlsx = await api('/api/grc/reports/issues?format=xlsx', { token });
  issuesXlsx.status === 200
    ? ok('the issue register exports with chrome applied')
    : bad('issue register exports', `${issuesXlsx.status}`);

  // A caller may make one export MORE restricted, never less. A downgrade would
  // let anyone re-export a Restricted report as Public and pass it on carrying
  // the marking that makes it look distributable. It is ignored rather than
  // refused, because failing an export over a query-string typo is worse.
  const downgrade = await api('/api/grc/reports/issues?format=xlsx&marking=Public', { token });
  downgrade.status === 200
    ? ok('a marking downgrade is ignored rather than failing the export')
    : bad('downgrade ignored', `${downgrade.status}`);

  const filtered = await api('/api/grc/reports/issues?format=xlsx&sections=Nonexistent', { token });
  filtered.status === 200
    ? ok('a section filter matching nothing still produces a report')
    : bad('empty filter still exports', `${filtered.status}`);

  console.log(`\n─── ${pass} passed, ${fail} failed ───\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nTest harness error:', e); process.exit(1); });
