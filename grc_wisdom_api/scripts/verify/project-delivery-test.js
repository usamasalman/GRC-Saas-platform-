/**
 * Delivery projects — slice 1: the engagement itself.
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
  console.log(`\n─── Delivery projects · slice 1 · ${API} ───\n`);

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

  console.log(`\n─── ${pass} passed, ${fail} failed ───\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nTest harness error:', e); process.exit(1); });
