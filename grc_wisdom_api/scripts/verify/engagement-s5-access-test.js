/**
 * Consulting engagement, sprint 5: access windows, the firm on hold, the
 * resume proposal, access notices and the engagement guard in shadow.
 *
 * Here, with the seeded pilot (OmniOps and GRC Consulting Partners):
 *
 *   - put on hold, the organisation chooses "Firm has no access" (the firm
 *     reads nothing, not even in its lists) or "Firm can view (read-only)";
 *     only it changes that during the hold, on both trails; the firm changes
 *     nothing while held; on resume the firm gets back exactly what it had;
 *   - after a resume, each person's current and proposed end date, the hold's
 *     days later; confirmed once with exceptions, one audit entry per person on
 *     each trail, and the target end left where it was;
 *   - a person's end date is enforced on every request; extending restores
 *     access that had ended, never access that was removed; the firm asks for
 *     more time and only the organisation grants or declines it;
 *   - notices go once at seven days and once at the end, to the person, the
 *     firm's Lead and the project manager, and none while on hold;
 *   - on an engagement named the old way, what the guard would refuse is
 *     counted per engagement, rule and route with first and last seen, IDs
 *     only, shown to the platform alone, and deleted after 90 days;
 *   - every route has a caller on a screen, and the guide quotes its labels.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s5-access-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const { accessOpen, noticeDue } = require('../../dist/services/engagementRules');
const { routeOf } = require('../../dist/services/requestContext');
const { runEngagementAccessScan } = require('../../dist/services/engagementAccessJob');
const { pruneShadow } = require('../../dist/services/engagementShadow');
const { JOB_DEFINITIONS } = require('../../dist/services/jobReporting');
const { bringFirm } = require('./engagement-firm');

const v = q.verdicts('engagement-s5');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);
const FLAG = 'Consulting Engagements';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The rules, without a database ───────────────────────────────────────────
{
  const now = new Date('2026-10-10T15:00:00Z');
  const d = (s) => new Date(`${s}T00:00:00Z`);
  v.record('engagement-s5:an end date counts in full, and a start in the future keeps access shut',
    accessOpen({ accessFrom: null, accessTo: d('2026-10-10') }, now) === true
      && accessOpen({ accessFrom: null, accessTo: d('2026-10-09') }, now) === false
      && accessOpen({ accessFrom: d('2026-10-11'), accessTo: d('2026-12-31') }, now) === false
      && accessOpen({ accessFrom: null, accessTo: null }, now) === true,
    'accessOpen');
  const none = { accessWarnedAt: null, accessEndNoticeAt: null };
  v.record('engagement-s5:one notice seven days out and one at the end, each once',
    noticeDue({ accessTo: d('2026-10-15'), ...none }, now) === 'soon'
      && noticeDue({ accessTo: d('2026-10-15'), accessWarnedAt: now, accessEndNoticeAt: null }, now) === null
      && noticeDue({ accessTo: d('2026-10-30'), ...none }, now) === null
      && noticeDue({ accessTo: d('2026-10-09'), accessWarnedAt: now, accessEndNoticeAt: null }, now) === 'ended'
      && noticeDue({ accessTo: d('2026-10-09'), accessWarnedAt: now, accessEndNoticeAt: now }, now) === null,
    'noticeDue');
  v.record('engagement-s5:a shadow row names the route, never a record or what was asked',
    routeOf('get', '/api/projects/5f0c2c1e-8a3b-4c1d-9e2f-0a1b2c3d4e5f/tasks?search=secret') === 'GET /api/projects/:id/tasks',
    routeOf('get', '/api/projects/5f0c2c1e-8a3b-4c1d-9e2f-0a1b2c3d4e5f/tasks?search=secret'));
}

// ── Every route has a caller; the job is registered; the guide is true ──────
{
  const dir = path.join(q.WEB_SRC, 'pages', 'grc', 'project');
  const lifecycle = q.read(path.join(dir, 'ProjectLifecycle.tsx'));
  const proposal = q.read(path.join(dir, 'ResumeProposal.tsx'));
  const team = q.read(path.join(dir, 'ProjectTeam.tsx'));
  const panel = q.read(path.join(dir, 'EngagementPanel.tsx'));
  const shadow = q.read(path.join(q.WEB_SRC, 'pages', 'marketplace', 'EngagementShadow.tsx'));
  const flags = q.read(path.join(q.WEB_SRC, 'pages', 'marketplace', 'FeatureFlagsManager.tsx'));
  // The enforcement checklist sits on the same screen since sprint 6.
  const readiness = q.read(path.join(q.WEB_SRC, 'pages', 'marketplace', 'EnforcementReadiness.tsx'));
  const callers = {
    'PATCH /api/projects/:id with holdFirmAccess': /\{ status: 'OnHold', reason, holdFirmAccess \}/.test(lifecycle),
    'PATCH /api/projects/:id/hold-access': /apiClient\.patch\(`\/api\/projects\/\$\{projectId\}\/hold-access`/.test(team),
    'GET and POST .../resume-proposal': /apiClient\.get\(`\/api\/engagements\/\$\{projectId\}\/resume-proposal`\)/.test(proposal)
      && /apiClient\.post\(`\/api\/engagements\/\$\{projectId\}\/resume-proposal`, \{ changes \}\)/.test(proposal),
    'the proposal in the project header': /<ResumeProposal\b/.test(lifecycle),
    'PATCH .../members/:memberId/window': /\/members\/\$\{dialog\.m\.id\}\/window`/.test(panel),
    'POST .../extension-request': /\/members\/\$\{dialog\.m\.id\}\/extension-request`/.test(panel),
    'POST .../extension-request/decline': /\/members\/\$\{dialog\.m\.id\}\/extension-request\/decline`/.test(panel),
    'GET /api/engagements/shadow/summary': /apiClient\.get\('\/api\/engagements\/shadow\/summary'/.test(shadow),
    'the shadow view on Feature Flags': /<EngagementShadow\b/.test(flags),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s5:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const server = q.strip(q.read(path.join(q.API_SRC, 'server.ts')));
  const system = q.read(path.join(q.API_SRC, 'controllers', 'systemController.ts'));
  const gated = server.slice(server.indexOf("if (process.env.RUN_BACKGROUND_JOBS !== 'false')"), server.indexOf('} else {'));
  v.record('engagement-s5:the notice job is registered, runnable and started in the one jobs process',
    JOB_DEFINITIONS.some((j) => j.id === 'JOB-ENGAGEMENT-ACCESS') && /startEngagementAccessScanner\(\)/.test(gated)
      && /\[ENGAGEMENT_ACCESS_JOB\]: /.test(system),
    'JOB-ENGAGEMENT-ACCESS in the register, the gated start-up and Run now');

  // The guide quotes the screens' labels; each has to be on a screen.
  const guide = q.read(path.join(q.WEB_SRC, 'data', 'userGuideData.ts')).replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '${name}': \\{`))[1] || '').split(/\n  \},\n/)[0];
  // With the workspace page itself, whose tab names the guide quotes too (sprint 6).
  const screens = require('fs').readdirSync(dir).filter((f) => f.endsWith('.tsx'))
    .map((f) => q.read(path.join(dir, f))).join('\n') + q.read(path.join(q.WEB_SRC, 'pages', 'grc', 'DeliveryProjects.tsx'));
  const needed = ['Firm can view (read-only)', 'Firm has no access', 'Change hold access', 'Access after the hold',
    'Leave end dates as they are', 'Rebaseline the plan', 'Change access', 'Grant more time', 'Decline request', 'Request more time'];
  const project = section('project-delivery');
  const quoted = [...project.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const absent = quoted.filter((l) => !screens.includes(l));
  const flagSection = section('feature-flags');
  const flagQuoted = [...flagSection.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    .filter((l) => !['Consulting Engagements', 'would have refused N times'].includes(l));
  const flagAbsent = flagQuoted.filter((l) => !(shadow + flags + readiness).includes(l));
  v.record('engagement-s5:the guide describes holds, windows and the shadow with labels that are on screen',
    needed.every((l) => quoted.includes(l)) && absent.length === 0
      && flagQuoted.includes('Engagement guard in shadow') && flagAbsent.length === 0,
    `not quoted: ${needed.filter((l) => !quoted.includes(l)).join(', ') || 'none'}; quoted but not on screen: ${[...absent, ...flagAbsent].join(', ') || 'none'}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me');
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const reviewer = await q.login('risk@grcconsulting.com');
  const outsider = await q.login('presales@grcconsulting.com');
  const admin = q.adminCredentials();
  const platform = admin.email ? await q.login(admin.email, admin.password) : null;
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const c = as(client);
  const me = client.user.id;
  const omni = await prisma.tenant.findFirst({ where: { name: 'OmniOps' }, select: { id: true } });
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const reads = async (who, id) => (await as(who)('GET', `/api/projects/${id}`)).status;
  const listed = async (who, id) => ((await as(who)('GET', '/api/projects')).json?.projects || []).some((x) => x.id === id);
  // The trail keeps each payload as the JSON string it hashed.
  const trailOn = async (id, action, where = {}) => (await prisma.auditLog.findMany({
    where: { subjectId: id, action, ...where }, select: { tenantId: true, actorId: true, payload: true },
  })).map((t) => ({ ...t, payload: JSON.parse(t.payload || '{}') }));

  // An active engagement delivered by the firm, with a Lead, a Consultant and a Reviewer.
  const created = (await c('POST', '/api/projects', {
    name: `S5 access ${stamp}`, startDate: day(0), targetEndDate: day(60), ownerId: me, managerId: me, projectType: 'Certification',
  })).json?.project;
  const phase = (await c('POST', `/api/projects/${created.id}/phases`, { name: 'Scoping', startDate: day(0), targetEndDate: day(30), ownerId: me })).json?.phase;
  const task = (await c('POST', `/api/projects/phases/${phase.id}/tasks`, { name: 'Scope statement', startDate: day(1), dueDate: day(10), assigneeId: me })).json?.task;
  const activated = await c('POST', `/api/projects/${created.id}/activate`, {});
  await bringFirm({ clientToken: client.token, leadLogin: lead, projectId: created.id, prisma });
  const pid = created.id;
  for (const [who, role] of [[consultant, 'Consultant'], [reviewer, 'Reviewer']]) {
    await as(lead)('POST', `/api/engagements/${pid}/nominations`, { userId: who.user.id, engagementRole: role });
  }
  const memberOf = async (who) => prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: who.user.id } } });
  for (const [who, role] of [[consultant, 'Consultant'], [reviewer, 'Reviewer']]) {
    await c('POST', `/api/engagements/${pid}/members/${(await memberOf(who)).id}/approve`, { engagementRole: role, accessFrom: day(-30), accessTo: day(60) });
  }
  // Approved a month ago, as people on a running engagement are: a start
  // before the approval is the approval itself, so the approval moves too.
  await prisma.projectMember.updateMany({
    where: { projectId: pid, side: 'Provider', memberStatus: 'Approved' },
    data: { accessFrom: new Date(Date.now() - 30 * DAY), decidedAt: new Date(Date.now() - 30 * DAY) },
  });
  const ready = activated.status === 200 && task && (await memberOf(consultant))?.memberStatus === 'Approved'
    && (await memberOf(reviewer))?.memberStatus === 'Approved';
  v.record('engagement-s5:an engagement can be set up with a Lead, a Consultant and a Reviewer', Boolean(ready),
    `activate ${activated.status}, task ${Boolean(task)}`);
  if (!ready) { await prisma.$disconnect(); v.finish(); return; }
  const targetBefore = (await prisma.project.findUnique({ where: { id: pid }, select: { targetEndDate: true } })).targetEndDate;

  // ── On hold with no access, then view, then none; resumed as before ─────
  const HOLD = 'Budget freeze until the next quarter';
  const held = await c('PATCH', `/api/projects/${pid}`, { status: 'OnHold', reason: HOLD, holdFirmAccess: 'None' });
  const hold = await prisma.projectHold.findFirst({ where: { projectId: pid, endedAt: null } });
  const shut = { consultant: await reads(consultant, pid), lead: await reads(lead, pid), inList: await listed(consultant, pid) };
  const firmChanges = await as(lead)('PATCH', `/api/projects/${pid}/hold-access`, { firmAccess: 'View', reason: 'We need to see the plan' });
  v.record('engagement-s5:"Firm has no access" is chosen at hold time, recorded with who chose it, and shuts the firm out',
    held.status === 200 && hold?.firmAccess === 'None' && hold.firmAccessSetById === me && hold.firmAccessSetAt
      && shut.consultant === 404 && shut.lead === 404 && !shut.inList && firmChanges.status === 404,
    `hold ${held.status}, stored ${hold?.firmAccess} by ${hold?.firmAccessSetById === me ? 'the PM' : hold?.firmAccessSetById}; `
      + `firm reads ${JSON.stringify(shut)}; firm changes it: ${firmChanges.status}`);

  const toView = await c('PATCH', `/api/projects/${pid}/hold-access`, { firmAccess: 'View', reason: 'The firm should prepare the next phase' });
  const viewing = { consultant: await reads(consultant, pid), inList: await listed(consultant, pid) };
  const firmTries = await as(lead)('PATCH', `/api/projects/${pid}/hold-access`, { firmAccess: 'None', reason: 'We would rather not be seen' });
  const blockOnHold = await as(consultant)('POST', `/api/projects/${pid}/impediments`, { title: 'Waiting on the asset owners', kind: 'Blocker', category: 'ClientDependency', owingSide: 'Client', taskId: task.id });
  const nominateOnHold = await as(lead)('POST', `/api/engagements/${pid}/nominations`, { userId: outsider.user.id, engagementRole: 'Consultant' });
  const askOnHold = await as(consultant)('POST', `/api/engagements/${pid}/members/${(await memberOf(consultant)).id}/extension-request`, { accessTo: day(90), note: 'The audit moved to next quarter' });
  v.record('engagement-s5:with "Firm can view (read-only)" the firm reads and changes nothing, and only the organisation switches it',
    toView.status === 200 && viewing.consultant === 200 && viewing.inList
      && firmTries.status === 403 && firmTries.json?.code === 'CLIENT_DECIDES'
      && [blockOnHold, nominateOnHold, askOnHold].every((r) => r.status === 403 && r.json?.code === 'ON_HOLD_READ_ONLY'),
    `to view ${toView.status}; firm reads ${JSON.stringify(viewing)}; firm switches ${firmTries.status} ${firmTries.json?.code || ''}; `
      + `firm writes ${[blockOnHold, nominateOnHold, askOnHold].map((r) => `${r.status} ${r.json?.code || ''}`).join(', ')}`);

  const toNone = await c('PATCH', `/api/projects/${pid}/hold-access`, { firmAccess: 'None', reason: 'Legal review of the contract started' });
  const changed = await trailOn(pid, 'PROJECT_HOLD_FIRM_ACCESS_CHANGED');
  const onBoth = (rows, n) => rows.filter((t) => t.tenantId === omni.id).length === n && rows.filter((t) => t.tenantId === gcp.id).length === n;
  // Ten days on hold, so the proposal has something to offer.
  await prisma.projectHold.update({ where: { id: hold.id }, data: { startedAt: new Date(Date.now() - 10 * DAY) } });
  const resumed = await c('PATCH', `/api/projects/${pid}`, { status: 'Active', reason: 'Budget approved by the steering committee' });
  const back = { consultant: await reads(consultant, pid), reviewer: await reads(reviewer, pid), lead: await reads(lead, pid) };
  v.record('engagement-s5:every change of the firm\'s access is on both trails, and resuming gives back exactly what it had',
    toNone.status === 200 && onBoth(changed, 2) && changed.every((t) => t.actorId === me && t.payload?.reason)
      && resumed.status === 200 && Object.values(back).every((s) => s === 200),
    `to none ${toNone.status}; changes on the organisation's trail ${changed.filter((t) => t.tenantId === omni.id).length}, `
      + `the firm's ${changed.filter((t) => t.tenantId === gcp.id).length}; resume ${resumed.status}; after: ${JSON.stringify(back)}`);

  // ── The resume proposal ──────────────────────────────────────────────────
  const endsBefore = {
    lead: (await memberOf(lead)).accessTo, consultant: (await memberOf(consultant)).accessTo, reviewer: (await memberOf(reviewer)).accessTo,
  };
  const offered = (await c('GET', `/api/engagements/${pid}/resume-proposal`)).json?.proposal;
  const byFirm = await as(lead)('GET', `/api/engagements/${pid}/resume-proposal`);
  const row = (who) => offered?.people?.find((x) => x.memberId === who);
  const ids = { lead: (await memberOf(lead)).id, consultant: (await memberOf(consultant)).id, reviewer: (await memberOf(reviewer)).id };
  const plus = (dt, n) => new Date(new Date(dt).getTime() + n * DAY).toISOString().slice(0, 10);
  v.record('engagement-s5:after a resume each person\'s end date is proposed the hold\'s days later, to the organisation only',
    offered?.days === 10 && ['lead', 'consultant', 'reviewer'].every((k) => row(ids[k])
      && row(ids[k]).proposedEnd.slice(0, 10) === plus(endsBefore[k], 10) && row(ids[k]).currentEnd.slice(0, 10) === plus(endsBefore[k], 0))
      && byFirm.status === 404,
    `days ${offered?.days}, people ${offered?.people?.length}; firm reads it ${byFirm.status}`);

  // Confirmed once: the Consultant as proposed, the Reviewer edited, the Lead unticked.
  const settled = await c('POST', `/api/engagements/${pid}/resume-proposal`, { changes: [
    { memberId: ids.consultant, accessTo: plus(endsBefore.consultant, 10) },
    { memberId: ids.reviewer, accessTo: plus(endsBefore.reviewer, 3) },
  ] });
  const twice = await c('POST', `/api/engagements/${pid}/resume-proposal`, { changes: [] });
  const endsAfter = {
    lead: (await memberOf(lead)).accessTo, consultant: (await memberOf(consultant)).accessTo, reviewer: (await memberOf(reviewer)).accessTo,
  };
  const perPerson = (await trailOn(pid, 'ENGAGEMENT_ACCESS_WINDOW_CHANGED')).filter((t) => t.payload?.cause === 'resume');
  const targetAfter = (await prisma.project.findUnique({ where: { id: pid }, select: { targetEndDate: true } })).targetEndDate;
  const after = (await c('GET', `/api/engagements/${pid}/resume-proposal`)).json;
  v.record('engagement-s5:confirmed once with exceptions, one audit entry per person on each trail, and the target end unchanged',
    settled.status === 200 && settled.json?.applied === 2 && twice.status === 409
      && plus(endsAfter.consultant, 0) === plus(endsBefore.consultant, 10) && plus(endsAfter.reviewer, 0) === plus(endsBefore.reviewer, 3)
      && plus(endsAfter.lead, 0) === plus(endsBefore.lead, 0) && onBoth(perPerson, 2)
      && targetAfter.getTime() === targetBefore.getTime() && after?.proposal === null,
    `confirm ${settled.status} applied ${settled.json?.applied}, again ${twice.status}; ends ${JSON.stringify(Object.fromEntries(Object.entries(endsAfter).map(([k, d]) => [k, plus(d, 0)])))}; `
      + `resume entries ${perPerson.length}; target moved ${targetAfter.getTime() !== targetBefore.getTime()}`);

  // ── Access windows ───────────────────────────────────────────────────────
  const windowOf = (id, body, who = client) => as(who)('PATCH', `/api/engagements/${pid}/members/${id}/window`, body);
  const shortened = await windowOf(ids.consultant, { accessTo: day(-2), reason: 'The consultant moved to another client' });
  const ended = { reads: await reads(consultant, pid), listed: await listed(consultant, pid) };
  const byLead = await windowOf(ids.consultant, { accessTo: day(30), reason: 'Please give our consultant more time' }, lead);
  const extended = await windowOf(ids.consultant, { accessTo: day(30), reason: 'Back for the internal audit phase' });
  const restored = await reads(consultant, pid);
  const told = await prisma.notification.count({ where: { recipientId: consultant.user.id, subjectId: pid, event: 'ENGAGEMENT_ACCESS_CHANGED' } });
  await c('POST', `/api/engagements/${pid}/members/${ids.reviewer}/remove`, { reason: 'Reviewer left the firm this month' });
  const removedExtend = await windowOf(ids.reviewer, { accessTo: day(90), reason: 'Trying to bring them back' });
  const changes = (await trailOn(pid, 'ENGAGEMENT_ACCESS_WINDOW_CHANGED')).filter((t) => t.payload?.cause === 'change');
  v.record('engagement-s5:an end date is enforced on every request; extending restores ended access, never removed access',
    shortened.status === 200 && ended.reads === 404 && !ended.listed && byLead.status === 404
      && extended.status === 200 && extended.json?.restored === true && restored === 200 && told >= 3
      && removedExtend.status === 409 && removedExtend.json?.code === 'NOT_APPROVED' && (await reads(reviewer, pid)) === 404
      && onBoth(changes, 2),
    `shorten ${shortened.status} → reads ${ended.reads}, listed ${ended.listed}; firm changes it ${byLead.status}; `
      + `extend ${extended.status} restored ${extended.json?.restored} → reads ${restored}; told ${told}; removed ${removedExtend.status} ${removedExtend.json?.code || ''}; `
      + `changes on each trail ${changes.filter((t) => t.tenantId === omni.id).length}/${changes.filter((t) => t.tenantId === gcp.id).length}`);

  const ask = (who, id, body) => as(who)('POST', `/api/engagements/${pid}/members/${id}/extension-request`, body);
  const forLead = await ask(consultant, ids.lead, { accessTo: day(120), note: 'The Lead needs longer as well' });
  const asked = await ask(consultant, ids.consultant, { accessTo: day(45), note: 'The audit moved by two weeks' });
  const seen = ((await c('GET', `/api/engagements/${pid}`)).json?.members || []).find((m) => m.id === ids.consultant);
  const pmTold = await prisma.notification.count({ where: { recipientId: me, subjectId: pid, event: 'ENGAGEMENT_ACCESS_EXTENSION_REQUESTED' } });
  const declined = await c('POST', `/api/engagements/${pid}/members/${ids.consultant}/extension-request/decline`, { reason: 'The audit date is not confirmed yet' });
  const askerTold = await prisma.notification.count({ where: { recipientId: consultant.user.id, subjectId: pid, event: 'ENGAGEMENT_ACCESS_EXTENSION_DECLINED' } });
  const cleared = (await memberOf(consultant)).extensionRequestedTo;
  const leadAsks = await ask(lead, ids.consultant, { accessTo: day(50), note: 'Audit date now confirmed by the CB' });
  const granted = await windowOf(ids.consultant, { accessTo: day(50), reason: 'Audit date confirmed by the CB' });
  const afterGrant = await memberOf(consultant);
  v.record('engagement-s5:the firm asks for more time for itself or, as Lead, its team; only the organisation grants or declines',
    forLead.status === 403 && asked.status === 201 && seen?.extensionRequestedTo?.slice(0, 10) === day(45) && pmTold >= 1
      && declined.status === 200 && askerTold === 1 && cleared === null
      && leadAsks.status === 201 && granted.status === 200 && afterGrant.extensionRequestedTo === null
      && afterGrant.accessTo.toISOString().slice(0, 10) === day(50),
    `consultant for the Lead ${forLead.status}; ask ${asked.status}, shown ${seen?.extensionRequestedTo}, PM told ${pmTold}; `
      + `decline ${declined.status}, asker told ${askerTold}; Lead asks ${leadAsks.status}; grant ${granted.status}, request left ${afterGrant.extensionRequestedTo}`);

  // ── Notices ──────────────────────────────────────────────────────────────
  const notices = async (recipientId, event) => prisma.notification.findMany({
    where: { recipientId, subjectId: pid, event }, select: { title: true },
  });
  const SOON = 'ENGAGEMENT_ACCESS_ENDING_NOTICE';
  await windowOf(ids.consultant, { accessTo: day(3), reason: 'Final week of fieldwork only' });
  await runEngagementAccessScan();
  await runEngagementAccessScan();
  const soon = {
    consultant: (await notices(consultant.user.id, SOON)).length,
    lead: (await notices(lead.user.id, SOON)).length,
    pm: (await notices(me, SOON)).length,
  };
  const warnedAt = (await memberOf(consultant)).accessWarnedAt;
  v.record('engagement-s5:seven days out the person, the firm\'s Lead and the project manager are told once',
    soon.consultant === 1 && soon.lead === 1 && soon.pm === 1 && warnedAt !== null,
    JSON.stringify(soon));

  // The Lead's own end, while held: nothing; resumed: them and the PM only.
  await c('PATCH', `/api/projects/${pid}`, { status: 'OnHold', reason: 'Waiting for the new budget line', holdFirmAccess: 'View' });
  await prisma.projectMember.update({ where: { id: ids.lead }, data: { accessTo: new Date(`${day(2)}T00:00:00Z`), accessWarnedAt: null, accessEndNoticeAt: null } });
  await runEngagementAccessScan();
  const pausedAt = (await memberOf(lead)).accessWarnedAt;
  await c('PATCH', `/api/projects/${pid}`, { status: 'Active', reason: 'New budget line approved today' });
  const leftAsIs = await c('POST', `/api/engagements/${pid}/resume-proposal`, { changes: [] });
  await runEngagementAccessScan();
  const leadOwn = (await notices(lead.user.id, SOON)).filter((n) => n.title.startsWith('Access to')).length;
  const pmAboutLead = (await notices(me, SOON)).filter((n) => n.title.startsWith(lead.user.name)).length;
  const consultantAboutLead = (await notices(consultant.user.id, SOON)).filter((n) => n.title.startsWith(lead.user.name)).length;
  v.record('engagement-s5:no notice while on hold; a Lead is told with the project manager, nobody else',
    pausedAt === null && leftAsIs.status === 200 && leftAsIs.json?.applied === 0
      && leadOwn === 1 && pmAboutLead === 1 && consultantAboutLead === 0,
    `on hold warned ${pausedAt}; left as is ${leftAsIs.status}; Lead ${leadOwn}, PM about the Lead ${pmAboutLead}, consultant about the Lead ${consultantAboutLead}`);

  const ENDED = 'ENGAGEMENT_ACCESS_ENDED';
  await prisma.projectMember.update({ where: { id: ids.consultant }, data: { accessTo: new Date(`${day(-1)}T00:00:00Z`) } });
  await runEngagementAccessScan();
  await runEngagementAccessScan();
  const endNotices = {
    consultant: (await notices(consultant.user.id, ENDED)).length,
    lead: (await notices(lead.user.id, ENDED)).length,
    pm: (await notices(me, ENDED)).length,
  };
  const endedTrail = await trailOn(pid, ENDED);
  v.record('engagement-s5:when access ends the same three are told once, and both trails record it',
    endNotices.consultant === 1 && endNotices.lead === 1 && endNotices.pm === 1
      && onBoth(endedTrail, 1) && endedTrail.every((t) => t.actorId === null) && (await reads(consultant, pid)) === 404,
    `${JSON.stringify(endNotices)}; on the trails ${endedTrail.length}`);

  // ── The guard in shadow, on an engagement named the old way ──────────────
  const flag = await prisma.featureFlag.findUnique({ where: { key: FLAG }, select: { id: true } });
  const override = { flagId_tenantId: { flagId: flag.id, tenantId: omni.id } };
  let legacy;
  try {
    await prisma.featureFlagOverride.update({ where: override, data: { enabled: false } });
    legacy = (await c('POST', '/api/projects', {
      name: `S5 named the old way ${stamp}`, startDate: day(0), targetEndDate: day(60), ownerId: me, managerId: me, providerTenantId: gcp.id,
    })).json?.project;
  } finally {
    await prisma.featureFlagOverride.update({ where: override, data: { enabled: true } });
  }
  const legacyTask = legacy && (await c('POST', `/api/projects/phases/${(await c('POST', `/api/projects/${legacy.id}/phases`, {
    name: 'Scoping', startDate: day(0), targetEndDate: day(30), ownerId: me,
  })).json?.phase?.id}/tasks`, { name: 'Scope statement', startDate: day(1), dueDate: day(10), assigneeId: me })).json?.task;
  const r1 = legacy ? await reads(outsider, legacy.id) : 0;
  await sleep(400);
  const first = legacy && await prisma.engagementShadowRefusal.findFirst({ where: { projectId: legacy.id, rule: 'member-required' } });
  await sleep(50);
  const r2 = legacy ? await reads(outsider, legacy.id) : 0;
  const write = legacy && await as(outsider)('POST', `/api/projects/${legacy.id}/impediments`, {
    title: 'Waiting on the asset owners', kind: 'Blocker', category: 'ClientDependency', owingSide: 'Client', taskId: legacyTask?.id,
  });
  await sleep(400);
  const rows = legacy ? await prisma.engagementShadowRefusal.findMany({ where: { projectId: legacy.id } }) : [];
  const member = rows.find((r) => r.rule === 'member-required' && r.route === 'GET /api/projects/:id');
  const role = rows.find((r) => r.rule === 'role-required');
  // IDs, counts and times, plus how the platform explained it (sprint 6); never request content.
  const ALLOWED = ['clientTenantId', 'count', 'firmTenantId', 'firstSeenAt', 'id', 'lastSeenAt', 'projectId', 'route', 'rule',
    'disposition', 'dispositionNote', 'dispositionAt', 'dispositionById'];
  const idsOnly = rows.every((r) => Object.keys(r).every((k) => ALLOWED.includes(k)));
  v.record('engagement-s5:named the old way, the firm still gets in, and each would-be refusal is counted with first and last seen',
    Boolean(legacy) && legacy.deliveryStyle === null && r1 === 200 && r2 === 200 && write?.status !== 404 && write?.status !== 403
      && member?.count >= 2 && first && member.firstSeenAt.getTime() === first.firstSeenAt.getTime()
      && member.lastSeenAt > first.lastSeenAt && member.clientTenantId === omni.id && member.firmTenantId === gcp.id
      && role?.route === 'POST /api/projects/:id/impediments' && idsOnly,
    `legacy ${Boolean(legacy)}; reads ${r1}/${r2}, write ${write?.status}; member-required ${member?.count} ${member?.route}; `
      + `role-required ${role?.route}; columns ${rows[0] ? Object.keys(rows[0]).join(',') : 'none'}`);

  const summary = platform ? await as(platform)('GET', '/api/engagements/shadow/summary') : null;
  const detail = platform ? await as(platform)('GET', `/api/engagements/shadow/summary?clientTenantId=${omni.id}`) : null;
  const byClient = await c('GET', '/api/engagements/shadow/summary');
  const byFirmPerson = await as(lead)('GET', '/api/engagements/shadow/summary');
  const line = summary?.json?.summary?.find((r) => r.clientTenantId === omni.id && r.rule === 'member-required');
  v.record('engagement-s5:the platform alone reads "would have refused N times" per organisation and rule',
    summary?.status === 200 && line?.count >= 2 && line.engagements >= 1 && line.consultingOn === true && summary.json.retentionDays === 90
      && (detail?.json?.rows || []).some((r) => r.projectId === legacy?.id && r.route === 'GET /api/projects/:id')
      && byClient.status === 403 && byFirmPerson.status === 403,
    `platform ${summary?.status ?? 'no admin credentials'} (${line ? `${line.count} times on ${line.engagements}` : 'no line'}); `
      + `organisation ${byClient.status}; firm ${byFirmPerson.status}`);

  if (member) await prisma.engagementShadowRefusal.update({ where: { id: member.id }, data: { lastSeenAt: new Date(Date.now() - 91 * DAY) } });
  const pruned = await pruneShadow();
  const gone = member ? await prisma.engagementShadowRefusal.findUnique({ where: { id: member.id } }) : 'kept';
  const kept = role ? await prisma.engagementShadowRefusal.findUnique({ where: { id: role.id } }) : null;
  v.record('engagement-s5:a shadow row not seen for 90 days is deleted, and a recent one kept',
    pruned >= 1 && gone === null && kept !== null, `pruned ${pruned}, old row ${gone ? 'kept' : 'gone'}, recent ${kept ? 'kept' : 'gone'}`);

  await prisma.$disconnect();
  v.finish(`${created.ref} with a Lead, a Consultant and a Reviewer`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
