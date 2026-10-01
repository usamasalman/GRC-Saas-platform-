/**
 * Consulting engagement, sprint 7: after close. The window in which the firm
 * may still read a closed engagement, the firm's own record and its copies of
 * issued reports, the follow-on engagement, and the firm's team.
 *
 * Here, with the seeded pilot (OmniOps and GRC Consulting Partners):
 *
 *   - the organisation sets the window ahead (0 to 365 days, 90 unless it says
 *     otherwise) and the Close dialog confirms it; after close only the
 *     organisation extends it, never past 365 days after the close, or
 *     revokes it, with a reason, on both trails, and the firm's Lead is told;
 *   - whoever still had access at close keeps it, read-only, until the window
 *     ends; someone removed before close does not; after the window the firm
 *     gets 404 on the client's records and still reads its own record and
 *     report copies, and nobody else reads those;
 *   - report copies: No unless the organisation says Yes, changeable until
 *     close; a copy is the bytes as issued, kept for good, and switching off
 *     stops only the copies still to come;
 *   - the firm's record is frozen at close: the team, the plan with planned,
 *     actual and variance, the figures and the delay ledger, nothing else;
 *   - the firm's people are told seven days before the window ends and when it
 *     has ended, once each;
 *   - a follow-on keeps the relationship, copies the plan without progress,
 *     carries the open tasks and blockers marked as such, nominates the firm's
 *     people again and offers the scope as a draft; with the engagement before
 *     in scope, its approved people read it, read-only;
 *   - an engagement closed the old way is counted in shadow until the client's
 *     rules are enforced; enforcement gives it a window from the later of its
 *     close and the enforcement date;
 *   - Firm team adds up each person's allocation across open engagements and
 *     by client, counts "not stated" apart and flags over 100%; the firm's
 *     Lead sets it;
 *   - every route has a caller on a screen, and the guide quotes its labels.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s7-after-close-test.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const {
  validWindowDays, closeWindowEnd, latestWindowEnd, windowDaysOf,
} = require('../../dist/services/engagementAfterClose');
const { runEngagementAccessScan } = require('../../dist/services/engagementAccessJob');
const { resolveEvidencePath } = require('../../dist/services/evidenceStore');

const v = q.verdicts('engagement-s7');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const near = (a, b, ms = 120_000) => Boolean(a && b) && Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= ms;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The rules, without a database ───────────────────────────────────────────
{
  const closed = new Date('2026-10-10T12:00:00Z');
  const until = new Date('2026-11-01T00:00:00Z');
  v.record('engagement-s7:the window is 0 to 365 days, 90 unless set, and runs from the close or to the date set',
    validWindowDays(0) === 0 && validWindowDays(365) === 365 && validWindowDays(366) === null && validWindowDays(-1) === null
      && validWindowDays(1.5) === null && validWindowDays('abc') === null && windowDaysOf({ closeWindowDays: null }) === 90
      && closeWindowEnd({ actualEndDate: closed, closeAccessUntil: null, closeWindowDays: null }).getTime() === closed.getTime() + 90 * DAY
      && closeWindowEnd({ actualEndDate: closed, closeAccessUntil: until, closeWindowDays: 30 }).getTime() === until.getTime()
      && closeWindowEnd({ actualEndDate: null, closeAccessUntil: null, closeWindowDays: 30 }) === null
      && latestWindowEnd(closed).getTime() === closed.getTime() + 365 * DAY,
    'validWindowDays / closeWindowEnd / latestWindowEnd');
}

// ── Every route has a caller; the guide quotes labels that are on screen ────
{
  const dir = path.join(q.WEB_SRC, 'pages', 'grc', 'project');
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const after = src('pages', 'grc', 'project', 'EngagementAfterClose.tsx');
  const panel = src('pages', 'grc', 'project', 'EngagementPanel.tsx');
  const life = src('pages', 'grc', 'project', 'ProjectLifecycle.tsx');
  const done = src('pages', 'grc', 'project', 'CompletedEngagements.tsx');
  const team = src('pages', 'grc', 'project', 'FirmTeam.tsx');
  const plan = src('pages', 'grc', 'project', 'ProjectPlan.tsx');
  const delays = src('pages', 'grc', 'project', 'ProjectImpediments.tsx');
  const host = src('pages', 'grc', 'DeliveryProjects.tsx');
  const callers = {
    'the window set ahead, changed and revoked': /\/api\/engagements\/\$\{projectId\}\/close-window`, \{ days:/.test(after)
      && /\/close-window`, \{ until:/.test(after) && /\/close-window`, \{ revoke: true/.test(after),
    'the Close dialog confirms the days': /closureNote: reason, afterCloseDays \}/.test(life) && /'Firm can read it for \(days\)'/.test(life),
    'report copies, at invitation and after': /\/report-copies`, \{ allowed:/.test(after) && /reportCopies: v\.copies === 'Yes'/.test(panel),
    'follow-on and the engagement before': /\/api\/engagements\/\$\{projectId\}\/follow-on`, \{/.test(after) && /\/previous-in-scope`, \{ inScope:/.test(after),
    'records, one record, a copy': /'\/api\/engagements\/records'/.test(done) && /\/api\/engagements\/records\/\$\{id\}`/.test(done)
      && /\/api\/engagements\/report-copies\/\$\{c\.id\}\/file`/.test(done),
    'firm team and allocation': /'\/api\/engagements\/firm-team'/.test(team) && /\/members\/\$\{editing\.r\.memberId\}\/allocation`/.test(team)
      && /\/members\/\$\{dialog\.m\.id\}\/allocation`/.test(panel),
    'carried over, on the plan and the delays': /t\.carriedFromTaskId &&/.test(plan) && /i\.carriedFromId &&/.test(delays),
    'the screens mounted': host.includes('<CompletedEngagements') && host.includes('<FirmTeam') && panel.includes('<EngagementAfterClose'),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s7:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const guide = src('data', 'userGuideData.ts').replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '?${name}'?: \\{`))[1] || '').split(/\n  \},\n/)[0];
  const screens = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => q.read(path.join(dir, f))).join('\n') + host;
  const needed = ['Firm can read it for (days)', 'Window after close', 'Extend or shorten', 'Revoke now', 'Report copies',
    'Firm keeps copies of issued reports', 'Start a follow-on', 'Carried over', 'Change what the firm reads before',
    'Completed engagements', 'Open record', 'Download copy', 'Open engagement (read-only)', 'Firm team', 'Over 100%', 'Set allocation'];
  const quoted = [...section('project-delivery').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const absent = quoted.filter((l) => !screens.includes(l));
  v.record('engagement-s7:the guide describes after close, follow-ons and the firm\'s records and team with labels on screen',
    needed.every((l) => quoted.includes(l)) && absent.length === 0,
    `not quoted: ${needed.filter((l) => !quoted.includes(l)).join(', ') || 'none'}; on no screen: ${absent.join(', ') || 'none'}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me');
  const admin = await q.login('company.admin@omniops.me');
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const reviewer = await q.login('risk@grcconsulting.com');
  const platformCreds = q.adminCredentials();
  const platform = platformCreds.email ? await q.login(platformCreds.email, platformCreds.password) : null;
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const raw = async (who, url) => {
    const r = await fetch(q.API + url, { headers: { Authorization: `Bearer ${who.token}` } });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  };
  const c = as(client);
  const me = client.user.id;
  const omni = await prisma.tenant.findFirst({ where: { name: 'OmniOps' }, select: { id: true } });
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const reads = async (who, id) => (await as(who)('GET', `/api/projects/${id}`)).status;
  const listed = async (who, id) => ((await as(who)('GET', '/api/projects?pageSize=200')).json?.projects || []).some((x) => x.id === id);
  const trail = async (subjectId, action) => (await prisma.auditLog.findMany({
    where: { subjectId, action }, select: { tenantId: true, actorId: true, payload: true },
  })).map((t) => ({ ...t, payload: JSON.parse(t.payload || '{}') }));
  const onBoth = (rows) => rows.some((t) => t.tenantId === omni.id) && rows.some((t) => t.tenantId === gcp.id);
  const memberOf = (pid, who) => prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: who.user.id } } });
  const told = (who, event, subjectId) => prisma.notification.count({ where: { recipientId: who.user.id, event, subjectId } });

  const activeEngagement = async (name) => {
    const p = (await c('POST', '/api/projects', {
      name: `${name} ${stamp}`, startDate: day(0), targetEndDate: day(90), ownerId: me, managerId: me, projectType: 'Certification',
    })).json?.project;
    const ph = (await c('POST', `/api/projects/${p.id}/phases`, { name: 'Scoping', startDate: day(0), targetEndDate: day(40), ownerId: me })).json?.phase;
    const open = (await c('POST', `/api/projects/phases/${ph.id}/tasks`, { name: 'Scope statement', startDate: day(1), dueDate: day(10), assigneeId: me })).json?.task;
    const finished = (await c('POST', `/api/projects/phases/${ph.id}/tasks`, { name: 'Kick-off', startDate: day(0), dueDate: day(3), assigneeId: me })).json?.task;
    await c('POST', `/api/projects/${p.id}/activate`, {});
    return { p, phase: ph, open, finished };
  };
  const bring = async (pid, body = {}) => {
    const inv = (await c('POST', '/api/engagements/invitations', { projectId: pid, firmTenantId: gcp.id, ...body })).json?.invitation;
    await as(lead)('POST', `/api/engagements/invitations/${inv.id}/accept`);
    await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, lead)).id}/approve`, { engagementRole: 'Lead', accessFrom: day(0) });
  };
  const add = async (pid, who, role) => {
    await as(lead)('POST', `/api/engagements/${pid}/nominations`, { userId: who.user.id, engagementRole: role });
    return c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, who)).id}/approve`, { engagementRole: role, accessFrom: day(0) });
  };

  // ── An engagement, its firm, and the window set ahead ────────────────────
  const main = await activeEngagement('S7 ISO 27001');
  const pid = main.p.id;
  await bring(pid);
  await add(pid, consultant, 'Consultant');
  await add(pid, reviewer, 'Reviewer');
  const copiesDefault = (await prisma.project.findUnique({ where: { id: pid }, select: { reportCopiesAllowed: true } }))?.reportCopiesAllowed;
  const firmSetsDays = await as(lead)('PATCH', `/api/engagements/${pid}/close-window`, { days: 30, reason: 'We would like thirty days' });
  const tooLong = await c('PATCH', `/api/engagements/${pid}/close-window`, { days: 400, reason: 'More than a year to hand over' });
  const setDays = await c('PATCH', `/api/engagements/${pid}/close-window`, { days: 30, reason: 'Thirty days to hand over the files' });
  const seen = (await c('GET', `/api/engagements/${pid}`)).json;
  v.record('engagement-s7:the organisation sets the window ahead, 0 to 365 days, on both trails; the firm cannot',
    firmSetsDays.status === 403 && firmSetsDays.json?.code === 'CLIENT_DECIDES' && tooLong.status === 400 && tooLong.json?.code === 'BAD_WINDOW'
      && setDays.status === 200 && seen?.engagement?.afterClose?.days === 30 && seen.can?.changeCloseWindow === true
      && onBoth(await trail(pid, 'ENGAGEMENT_CLOSE_WINDOW_SET')),
    `firm ${firmSetsDays.status} ${firmSetsDays.json?.code || ''}; 400 days ${tooLong.status} ${tooLong.json?.code || ''}; set ${setDays.status}; shown ${seen?.engagement?.afterClose?.days}`);

  // ── Report copies: No unless the organisation says Yes ───────────────────
  const issue = (who = client) => raw(who, `/api/projects/${pid}/reports/status?format=pdf&issue=true`);
  const copies = () => prisma.engagementReportCopy.findMany({ where: { projectId: pid }, orderBy: { issuedAt: 'asc' } });
  const offIssue = await issue();
  const afterOff = (await copies()).length;
  const firmAllows = await as(lead)('PATCH', `/api/engagements/${pid}/report-copies`, { allowed: true, reason: 'We keep our deliverables' });
  const allow = await c('PATCH', `/api/engagements/${pid}/report-copies`, { allowed: true, reason: 'The firm keeps the status reports' });
  const onIssue = await issue();
  const kept = await copies();
  const keptTrail = (await prisma.auditLog.count({ where: { tenantId: gcp.id, action: 'ENGAGEMENT_REPORT_COPY_KEPT', subjectId: kept[0]?.id } }));
  const stop = await c('PATCH', `/api/engagements/${pid}/report-copies`, { allowed: false, reason: 'No more copies from here on' });
  const stoppedIssue = await issue();
  const afterStop = await copies();
  v.record('engagement-s7:report copies are off unless allowed; a copy is the bytes as issued; switching off stops only those to come',
    copiesDefault === false && offIssue.status === 200 && afterOff === 0
      && firmAllows.status === 403 && allow.status === 200 && onIssue.status === 200
      && kept.length === 1 && kept[0].firmTenantId === gcp.id && kept[0].clientTenantId === omni.id && kept[0].sha256 === sha(onIssue.buf)
      && keptTrail === 1 && onBoth(await trail(pid, 'ENGAGEMENT_REPORT_COPIES_SET'))
      && stop.status === 200 && stoppedIssue.status === 200 && afterStop.length === 1 && afterStop[0].id === kept[0].id,
    `default ${copiesDefault}; issued off ${offIssue.status} → ${afterOff}; firm allows ${firmAllows.status}; allow ${allow.status}; issued on ${onIssue.status} → ${kept.length} `
      + `(hash ${kept[0]?.sha256 === sha(onIssue.buf)}), firm trail ${keptTrail}; off ${stop.status}; issued again → ${afterStop.length}`);

  // The work as it stands at close: one task finished, one open with a blocker,
  // a binding scope, and the Reviewer removed before the close.
  await prisma.projectTask.update({
    where: { id: main.finished.id }, data: { status: 'Done', actualStartDate: new Date(), completedAt: new Date(), completionPercent: 100 },
  });
  const blocker = await as(consultant)('POST', `/api/projects/${pid}/impediments`, {
    title: 'Waiting on the asset owners', kind: 'Blocker', category: 'ClientDependency', owingSide: 'Client', taskId: main.open.id,
  });
  await c('POST', `/api/engagements/${pid}/scope`, { entityIds: [omni.id], services: ['Documents'], classificationCeiling: 'Internal', validFrom: day(-1), validTo: day(120) });
  const draft = await prisma.engagementScopeVersion.findFirst({ where: { projectId: pid, status: 'Draft' } });
  await as(admin)('POST', `/api/engagements/${pid}/scope/${draft?.id}/approve`);
  await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, reviewer)).id}/remove`, { reason: 'Review finished before the close' });

  // ── Close: the Close dialog's days, the people who keep access, the record ──
  const closeBody = { outcome: 'Closed', closureNote: 'Delivered and accepted by the board' };
  const badClose = await c('POST', `/api/projects/${pid}/close`, { ...closeBody, afterCloseDays: 400 });
  const closed = await c('POST', `/api/projects/${pid}/close`, { ...closeBody, afterCloseDays: 30 });
  const shut = await prisma.project.findUnique({ where: { id: pid }, select: { closeAccessUntil: true, closeWindowDays: true, actualEndDate: true } });
  const keeps = { lead: (await memberOf(pid, lead))?.afterCloseAccess, consultant: (await memberOf(pid, consultant))?.afterCloseAccess };
  const record = await prisma.engagementRecord.findFirst({ where: { projectId: pid, firmTenantId: gcp.id } });
  const recPlan = JSON.parse(record?.plan || '[]');
  const recTasks = recPlan.flatMap((ph) => ph.tasks);
  const recLedger = JSON.parse(record?.delayLedger || '[]');
  const recTeam = JSON.parse(record?.team || '[]');
  const taskKeys = recTasks[0] ? Object.keys(recTasks[0]).sort().join() : '';
  const within = {
    consultant: await reads(consultant, pid), reviewer: await reads(reviewer, pid),
    documents: (await as(consultant)('GET', `/api/engagements/${pid}/documents`)).status,
  };
  const writes = await as(consultant)('PATCH', `/api/projects/tasks/${main.open.id}`, { dueDate: day(20) });
  v.record('engagement-s7:at close the window is fixed from the dialog\'s days, the firm\'s record is kept, and only those with access then keep it',
    badClose.status === 400 && badClose.json?.code === 'BAD_WINDOW' && closed.status === 200
      && shut?.closeWindowDays === 30 && near(shut.closeAccessUntil, new Date(shut.actualEndDate.getTime() + 30 * DAY))
      && keeps.lead === true && keeps.consultant === true
      && Boolean(record) && record.clientName === 'OmniOps' && record.outcome === 'Closed'
      && recTasks.length === 2 && taskKeys === 'actual,name,planned,ref,side,status,varianceDays'
      && recLedger.some((l) => l.title === 'Waiting on the asset owners' && l.owingSide === 'Client')
      && recTeam.some((m) => m.name === lead.user.name && m.engagementRole === 'Lead') && JSON.parse(record.figures).planned
      && (await prisma.auditLog.count({ where: { tenantId: gcp.id, action: 'ENGAGEMENT_RECORD_KEPT', subjectId: record.id } })) === 1
      && within.consultant === 200 && within.reviewer === 404 && within.documents === 200 && writes.status >= 400,
    `bad days ${badClose.status} ${badClose.json?.code || ''}; close ${closed.status} ${closed.json?.message || ''}; window ${shut?.closeWindowDays} to ${shut?.closeAccessUntil?.toISOString()}; `
      + `keeps ${JSON.stringify(keeps)}; record ${Boolean(record)} tasks ${recTasks.length} [${taskKeys}] ledger ${recLedger.length} team ${recTeam.length}; `
      + `blocker ${blocker.status}; consultant reads ${within.consultant} (documents ${within.documents}), removed reviewer ${within.reviewer}; consultant writes ${writes.status}`);

  // ── After close: only the organisation extends or revokes ────────────────
  const firmExtends = await as(lead)('PATCH', `/api/engagements/${pid}/close-window`, { until: day(60), reason: 'We need two more months' });
  const pastYear = await c('PATCH', `/api/engagements/${pid}/close-window`, { until: day(400), reason: 'Keep it open for good' });
  const extended = await c('PATCH', `/api/engagements/${pid}/close-window`, { until: day(60), reason: 'The audit is in two months' });
  const until = (await prisma.project.findUnique({ where: { id: pid }, select: { closeAccessUntil: true } }))?.closeAccessUntil;
  const frozenCopies = await c('PATCH', `/api/engagements/${pid}/report-copies`, { allowed: true, reason: 'Copies after the close please' });
  v.record('engagement-s7:after close the organisation extends the window, never past 365 days, with the Lead told; the firm cannot',
    firmExtends.status === 403 && pastYear.status === 400 && pastYear.json?.code === 'BEYOND_365'
      && extended.status === 200 && until?.toISOString().slice(0, 10) === day(61)
      && (await told(lead, 'ENGAGEMENT_CLOSE_WINDOW_CHANGED', pid)) >= 1 && onBoth(await trail(pid, 'ENGAGEMENT_CLOSE_WINDOW_CHANGED'))
      && frozenCopies.status === 409,
    `firm ${firmExtends.status}; past a year ${pastYear.status} ${pastYear.json?.code || ''}; extend ${extended.status} to ${until?.toISOString()}; copies after close ${frozenCopies.status}`);

  // ── Notices: seven days before, and when it has ended, once each ─────────
  await prisma.project.update({ where: { id: pid }, data: { closeAccessUntil: new Date(Date.now() + 3 * DAY), closeWarnedAt: null, closeEndNoticeAt: null } });
  const first = await runEngagementAccessScan(new Date());
  const again = await runEngagementAccessScan(new Date());
  const warnedLead = await told(lead, 'ENGAGEMENT_CLOSE_WINDOW_ENDING', pid);
  const warnedReviewer = await told(reviewer, 'ENGAGEMENT_CLOSE_WINDOW_ENDING', pid);
  await prisma.project.update({ where: { id: pid }, data: { closeAccessUntil: new Date(Date.now() - 3_600_000) } });
  const ended = await runEngagementAccessScan(new Date());
  v.record('engagement-s7:the firm\'s people who keep access are told seven days before the window ends and when it has, once each',
    first.closeWarned >= 1 && warnedLead === 1 && (await told(consultant, 'ENGAGEMENT_CLOSE_WINDOW_ENDING', pid)) === 1 && warnedReviewer === 0
      && again.closeWarned === 0 && ended.closeEnded >= 1 && (await told(lead, 'ENGAGEMENT_CLOSE_WINDOW_ENDED', pid)) === 1
      && (await told(client, 'ENGAGEMENT_CLOSE_WINDOW_ENDED', pid)) === 1,
    `first ${JSON.stringify(first)}; again ${JSON.stringify(again)}; lead warned ${warnedLead}, removed reviewer ${warnedReviewer}; ended ${JSON.stringify(ended)}`);

  // ── After the window: 404 on the client's records, the firm's own stay ───
  const revoked = await c('PATCH', `/api/engagements/${pid}/close-window`, { revoke: true, reason: 'The hand-over is complete' });
  const gone = {
    project: await reads(consultant, pid), lead: await reads(lead, pid), plan: (await as(consultant)('GET', `/api/projects/${pid}/plan`)).status,
    delays: (await as(consultant)('GET', `/api/projects/${pid}/impediments`)).status,
    report: (await as(lead)('GET', `/api/projects/${pid}/reports/status?format=pdf`)).status,
    documents: (await as(consultant)('GET', `/api/engagements/${pid}/documents`)).status,
    listed: await listed(consultant, pid),
  };
  const records = (await as(lead)('GET', '/api/engagements/records?pageSize=50')).json?.records || [];
  const own = await as(lead)('GET', `/api/engagements/records/${record?.id}`);
  const file = await raw(lead, `/api/engagements/report-copies/${kept[0]?.id}/file`);
  const consultantRecords = await as(consultant)('GET', '/api/engagements/records');
  const clientRecord = await c('GET', `/api/engagements/records/${record?.id}`);
  const clientFile = await raw(client, `/api/engagements/report-copies/${kept[0]?.id}/file`);
  v.record('engagement-s7:after the window the firm gets 404 on the client\'s records and still reads its own record and report copies',
    revoked.status === 200 && onBoth(await trail(pid, 'ENGAGEMENT_CLOSE_WINDOW_REVOKED'))
      && gone.project === 404 && gone.lead === 404 && gone.plan === 404 && gone.delays === 404 && gone.report === 404 && gone.documents === 404 && !gone.listed
      && records.some((r) => r.id === record?.id && r.reportCopies === 1)
      && own.status === 200 && own.json?.record?.windowOpen === false && own.json.record.plan?.length === 1 && (own.json.reportCopies || []).length === 1
      && file.status === 200 && sha(file.buf) === kept[0]?.sha256
      && consultantRecords.status === 403 && clientRecord.status === 404 && clientFile.status === 404,
    `revoke ${revoked.status}; after: ${JSON.stringify(gone)}; records ${records.length}; own ${own.status} window ${own.json?.record?.windowOpen}; `
      + `copy ${file.status} hash ${sha(file.buf) === kept[0]?.sha256}; consultant ${consultantRecords.status}; client record ${clientRecord.status}, file ${clientFile.status}`);

  // A copy whose bytes changed is not served.
  const stored = kept[0] ? resolveEvidencePath(kept[0].storageKey) : null;
  let altered = null;
  if (stored) {
    const original = fs.readFileSync(stored);
    try {
      fs.writeFileSync(stored, Buffer.concat([original, Buffer.from('x')]));
      altered = await as(lead)('GET', `/api/engagements/report-copies/${kept[0].id}/file`);
    } finally {
      fs.writeFileSync(stored, original);
    }
  }
  v.record('engagement-s7:a report copy that no longer matches the issued bytes is refused',
    altered?.status === 409 && altered.json?.code === 'COPY_ALTERED', `altered ${altered?.status} ${altered?.json?.code || ''}`);

  // ── A follow-on with the same firm ───────────────────────────────────────
  const fname = `S7 follow-on ${stamp}`;
  const firmStarts = await as(lead)('POST', `/api/engagements/${pid}/follow-on`, { name: fname, startDate: day(0) });
  const followOn = await c('POST', `/api/engagements/${pid}/follow-on`, { name: fname, startDate: day(0), previousInScope: true });
  const twice = await c('POST', `/api/engagements/${pid}/follow-on`, { name: fname, startDate: day(0), previousInScope: true });
  const fid = followOn.json?.project?.id;
  const next = fid ? await prisma.project.findUnique({
    where: { id: fid },
    select: {
      status: true, providerTenantId: true, deliveryStyle: true, previousProjectId: true, previousInScope: true,
      tasks: { select: { name: true, status: true, carriedFromTaskId: true, completionPercent: true } },
      impediments: { select: { title: true, carriedFromId: true, resolvedAt: true } },
      members: { where: { side: 'Provider' }, select: { userId: true, memberStatus: true, origin: true, engagementRole: true } },
      scopeVersions: { select: { version: true, status: true, origin: true } },
    },
  }) : null;
  const carriedTask = next?.tasks.find((t) => t.name === 'Scope statement');
  const doneTask = next?.tasks.find((t) => t.name === 'Kick-off');
  const nominated = (next?.members || []).filter((m) => m.memberStatus === 'Nominated' && m.origin === 'FollowOn');
  const beforeApproval = { follow: await reads(lead, fid), previous: await reads(lead, pid) };
  const leadRow = await memberOf(fid, lead);
  await c('POST', `/api/engagements/${fid}/members/${leadRow?.id}/approve`, { engagementRole: 'Lead', accessFrom: day(0) });
  const throughFollowOn = { lead: await reads(lead, pid), consultant: await reads(consultant, pid), follow: await reads(lead, fid) };
  const outOfScope = await c('PATCH', `/api/engagements/${fid}/previous-in-scope`, { inScope: false, reason: 'The new work does not need it' });
  const afterOut = await reads(lead, pid);
  const previousSeen = (await c('GET', `/api/engagements/${pid}`)).json?.engagement;
  v.record('engagement-s7:a follow-on keeps the firm, copies the plan without progress, carries the open work and nominates its people again',
    firmStarts.status === 404 && followOn.status === 201 && twice.status === 409 && twice.json?.code === 'FOLLOW_ON_EXISTS'
      && next?.status === 'Draft' && next.providerTenantId === gcp.id && next.deliveryStyle === 'ClientLed' && next.previousProjectId === pid
      && next.tasks.length === 2 && next.tasks.every((t) => t.status === 'NotStarted' && t.completionPercent === 0)
      && carriedTask?.carriedFromTaskId === main.open.id && doneTask?.carriedFromTaskId === null
      && next.impediments.length === 1 && next.impediments[0].carriedFromId === blocker.json?.impediment?.id && !next.impediments[0].resolvedAt
      && nominated.length === 2 && nominated.some((m) => m.userId === lead.user.id && m.engagementRole === 'Lead')
      && !next.members.some((m) => m.userId === reviewer.user.id)
      && next.scopeVersions.length === 1 && next.scopeVersions[0].status === 'Draft' && next.scopeVersions[0].origin === 'FollowOn'
      && onBoth(await trail(fid, 'ENGAGEMENT_FOLLOW_ON_CREATED'))
      && previousSeen?.followOns?.some((f) => f.id === fid),
    `firm ${firmStarts.status}; create ${followOn.status} ${followOn.json?.message || ''}; again ${twice.status} ${twice.json?.code || ''}; `
      + `${JSON.stringify(next && { status: next.status, tasks: next.tasks.map((t) => `${t.name}:${t.carriedFromTaskId ? 'carried' : '-'}`), blockers: next.impediments.length, nominated: nominated.length, scope: next.scopeVersions })}`);
  v.record('engagement-s7:with the engagement before in scope, the follow-on\'s approved people read it; out of scope, they do not',
    beforeApproval.follow === 404 && beforeApproval.previous === 404
      && throughFollowOn.lead === 200 && throughFollowOn.follow === 200 && throughFollowOn.consultant === 404
      && outOfScope.status === 200 && afterOut === 404 && onBoth(await trail(fid, 'ENGAGEMENT_PREVIOUS_SCOPE_SET')),
    `before approval ${JSON.stringify(beforeApproval)}; approved ${JSON.stringify(throughFollowOn)}; out of scope ${outOfScope.status} → ${afterOut}`);

  // ── Firm team: allocation across open engagements ────────────────────────
  const second = await activeEngagement('S7 second engagement');
  await bring(second.p.id);
  await add(second.p.id, consultant, 'Consultant');
  const cOn = async (projectId) => (await memberOf(projectId, consultant))?.id;
  const sixty = await as(lead)('PATCH', `/api/engagements/${fid}/members/${await cOn(fid)}/allocation`, { allocation: 60 });
  const fifty = await as(lead)('PATCH', `/api/engagements/${second.p.id}/members/${await cOn(second.p.id)}/allocation`, { allocation: 50 });
  const tooMuch = await as(lead)('PATCH', `/api/engagements/${second.p.id}/members/${await cOn(second.p.id)}/allocation`, { allocation: 150 });
  const notLead = await as(consultant)('PATCH', `/api/engagements/${second.p.id}/members/${await cOn(second.p.id)}/allocation`, { allocation: 10 });
  const clientSets = await c('PATCH', `/api/engagements/${second.p.id}/members/${await cOn(second.p.id)}/allocation`, { allocation: 10 });
  const teamView = (await as(lead)('GET', '/api/engagements/firm-team?pageSize=50')).json?.people || [];
  const cRow = teamView.find((p) => p.id === consultant.user.id);
  const lRow = teamView.find((p) => p.id === lead.user.id);
  const consultantView = await as(consultant)('GET', '/api/engagements/firm-team');
  v.record('engagement-s7:Firm team totals each person\'s allocation by client, counts not stated apart and flags over 100%; the Lead sets it',
    sixty.status === 200 && fifty.status === 200 && tooMuch.status === 400 && tooMuch.json?.code === 'BAD_ALLOCATION'
      && notLead.status === 403 && notLead.json?.code === 'LEAD_ONLY' && clientSets.status === 404
      && cRow?.allocation?.total === 110 && cRow.allocation.over === true
      && cRow.allocation.byClient.some((x) => x.clientTenantId === omni.id && x.percent === 110)
      && cRow.engagements.some((e) => e.projectId === fid && e.allocation === 60 && e.canSetAllocation === true)
      && !cRow.engagements.some((e) => e.projectId === pid)
      && (lRow?.allocation?.notStated ?? 0) >= 2 && consultantView.status === 403
      && onBoth(await trail(second.p.id, 'ENGAGEMENT_ALLOCATION_SET')),
    `60 ${sixty.status}, 50 ${fifty.status}, 150 ${tooMuch.status}; consultant ${notLead.status} ${notLead.json?.code || ''}; client ${clientSets.status}; `
      + `consultant ${JSON.stringify(cRow?.allocation)}; lead not stated ${lRow?.allocation?.notStated}; consultant reads ${consultantView.status}`);

  // ── Closed the old way: shadow until enforced, then a window ─────────────
  const flag = await prisma.featureFlag.findUnique({ where: { key: 'Consulting Engagements' }, select: { id: true } });
  const off = { flagId_tenantId: { flagId: flag.id, tenantId: omni.id } };
  let old;
  try {
    await prisma.featureFlagOverride.update({ where: off, data: { enabled: false } });
    old = (await c('POST', '/api/projects', {
      name: `S7 closed the old way ${stamp}`, startDate: day(0), targetEndDate: day(60), ownerId: me, managerId: me, providerTenantId: gcp.id,
    })).json?.project;
  } finally {
    await prisma.featureFlagOverride.update({ where: off, data: { enabled: true } });
  }
  await prisma.projectMember.create({ data: { projectId: old.id, userId: consultant.user.id, side: 'Provider', roleLabel: 'Consultant', raci: 'R' } });
  const oldPhase = (await c('POST', `/api/projects/${old.id}/phases`, { name: 'Scoping', startDate: day(0), targetEndDate: day(30), ownerId: me })).json?.phase;
  await c('POST', `/api/projects/phases/${oldPhase.id}/tasks`, { name: 'Draft the scope', startDate: day(1), dueDate: day(9), assigneeId: me });
  await c('POST', `/api/projects/${old.id}/activate`, {});
  const oldClosed = await c('POST', `/api/projects/${old.id}/close`, closeBody);
  await prisma.project.update({ where: { id: old.id }, data: { closeAccessUntil: new Date(Date.now() - DAY) } });
  const shadowRead = await reads(consultant, old.id);
  await wait(500);
  const counted = await prisma.engagementShadowRefusal.count({ where: { projectId: old.id, rule: 'after-close-window' } });
  const oldRecord = await prisma.engagementRecord.findFirst({ where: { projectId: old.id, firmTenantId: gcp.id }, select: { team: true } });
  v.record('engagement-s7:an engagement closed the old way is counted in shadow after its window until the client is enforced, and the firm keeps its record',
    oldClosed.status === 200 && shadowRead === 200 && counted === 1
      && JSON.parse(oldRecord?.team || '[]').some((m) => m.name === consultant.user.name && m.side === 'Firm'),
    `close ${oldClosed.status}; read after its window ${shadowRead}; counted ${counted}; record team ${oldRecord?.team}`);

  // Enforcement, after the S6 checklist, gives it a window from the later of
  // its close and the enforcement date.
  for (const x of ((await c('GET', '/api/engagements/migration')).json?.engagements || [])) {
    const leadPick = x.proposal.find((m) => m.engagementRole === 'Lead') || x.proposal[0];
    await c('POST', `/api/engagements/${x.id}/migrate`, { members: leadPick ? [{ userId: leadPick.userId, engagementRole: 'Lead' }] : [] });
  }
  const early = platform ? (await as(platform)('GET', `/api/engagements/enforcement/readiness?clientTenantId=${omni.id}`)).json?.readiness : null;
  for (const row of early?.shadow || []) {
    await as(platform)('PATCH', `/api/engagements/shadow/${row.id}/disposition`, { disposition: 'KeepRefusing', note: 'Correct to refuse once enforced' });
  }
  await as(admin)('POST', '/api/engagements/enforcement/confirm', { note: 'We are ready for enforcement' });
  const from = new Date(Date.now() + 8 * DAY);
  const scheduled = platform ? await as(platform)('POST', '/api/engagements/enforcement/schedule', {
    clientTenantId: omni.id, effectiveFrom: from.toISOString(), note: 'Pilot goes live after review',
  }) : null;
  const oldWindow = (await prisma.project.findUnique({ where: { id: old.id }, select: { closeAccessUntil: true } }))?.closeAccessUntil;
  const enforcementFlag = await prisma.featureFlag.findUnique({ where: { key: 'Consulting enforcement' }, select: { id: true } });
  await prisma.featureFlagOverride.update({
    where: { flagId_tenantId: { flagId: enforcementFlag.id, tenantId: omni.id } }, data: { effectiveFrom: new Date(Date.now() - 60_000) },
  });
  const enforcedOpen = await reads(consultant, old.id);
  await prisma.project.update({ where: { id: old.id }, data: { closeAccessUntil: new Date(Date.now() - 60_000) } });
  const enforcedShut = { read: await reads(consultant, old.id), listed: await listed(consultant, old.id) };
  v.record('engagement-s7:once the client is enforced an engagement closed the old way has 90 days from the enforcement date, then 404',
    Boolean(platform) && scheduled?.status === 200 && near(oldWindow, new Date(from.getTime() + 90 * DAY), 5 * 60_000)
      && (await prisma.auditLog.count({ where: { tenantId: omni.id, action: 'ENGAGEMENT_CLOSE_WINDOWS_SET' } })) >= 1
      && enforcedOpen === 200 && enforcedShut.read === 404 && !enforcedShut.listed,
    `schedule ${scheduled?.status} ${scheduled?.json?.message || ''}; window ${oldWindow?.toISOString()} vs ${new Date(from.getTime() + 90 * DAY).toISOString()}; `
      + `enforced in window ${enforcedOpen}; after ${JSON.stringify(enforcedShut)}`);

  await prisma.$disconnect();
  v.finish(`${main.p.ref} closed, kept by GRC Consulting Partners, followed by ${followOn.json?.project?.ref || '—'}`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
