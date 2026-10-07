/**
 * Consulting engagement, sprint 8: information requests.
 *
 * Here, with the seeded pilot (OmniOps and GRC Consulting Partners):
 *
 *   - the firm's Lead and Consultants raise requests, its Reviewers only see
 *     them; a request asks only for what the scope shares, of someone on the
 *     engagement's team, due inside the raiser's own dates, and not twice;
 *   - the AC-04 evidence request runs end to end: answered with a file
 *     (hashed at upload, checked like any evidence, at or below the ceiling),
 *     returned on "Covers the period" with what is missing, answered again
 *     (the first answer and its hash kept), accepted; acceptance counts
 *     toward readiness and verifies nothing;
 *   - the firm sees answers only through the request, only while its access
 *     is open, and downloads only where the organisation allows;
 *   - a file already held is offered to link, not stored twice; one file is
 *     linked to tasks and controls with who and when, and unlinking keeps it;
 *   - the assignee hands a request to a colleague who can do project work and
 *     the project manager is told; the project manager moves due dates;
 *   - reminders three days before and on the due date, once each, paused on
 *     hold; overdue is shown, never a delay until the firm's Lead or the
 *     project manager records it as a blocker owed by the organisation;
 *   - an import goes in whole or not at all, every row checked, formulas
 *     refused, one trail entry; an export writes formulas as inert text;
 *   - a vendor-register request becomes a scope change: approved by the
 *     organisation, drafted, approved by a second person, then raised;
 *     rejected changes and discarded drafts stay in the history;
 *   - every route has a caller on a screen, and the guide quotes its labels.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s8-requests-test.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const { checkReview, overdueDays, neutralise, cellText } = require('../../dist/services/engagementRequests');
const { runEngagementAccessScan } = require('../../dist/services/engagementAccessJob');

const v = q.verdicts('engagement-s8');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const midnight = (n) => new Date(`${day(n)}T00:00:00.000Z`);
const stamp = Date.now().toString(36);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const pdf = (text) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);
const b64 = (buf) => buf.toString('base64');

// ── The rules, without a database ───────────────────────────────────────────
{
  const all = { relevant: 'Pass', complete: 'Pass', coversPeriod: 'Pass', authentic: 'NotApplicable' };
  const failed = { ...all, coversPeriod: 'Fail' };
  const ok = (b) => checkReview('Evidence', b).ok;
  const code = (b, kind = 'Evidence') => { const r = checkReview(kind, b); return r.ok ? null : r.code; };
  v.record('engagement-s8:evidence is judged on four tests, a Fail needs a note, a failing answer is returned with what is missing',
    ok({ outcome: 'Accepted', tests: all })
      && code({ outcome: 'Accepted', tests: { ...all, complete: undefined } }) === 'TEST_REQUIRED'
      && code({ outcome: 'Returned', tests: failed, note: 'Q3 is missing entirely' }) === 'FAIL_NOTE_REQUIRED'
      && code({ outcome: 'Accepted', tests: failed, testNotes: { coversPeriod: 'Only July' } }) === 'FAILED_TEST'
      && code({ outcome: 'Returned', tests: failed, testNotes: { coversPeriod: 'Only July' } }) === 'SAY_WHAT_IS_MISSING'
      && ok({ outcome: 'Returned', tests: failed, testNotes: { coversPeriod: 'Only July' }, note: 'August and September are missing' })
      && checkReview('Clarification', { outcome: 'Accepted' }).ok,
    'checkReview');
  const due = new Date('2026-10-01T00:00:00Z');
  const at = (s) => new Date(s);
  v.record('engagement-s8:overdue days start after the due day and stop while on hold',
    overdueDays(due, [], at('2026-10-01T18:00:00Z')) === 0
      && overdueDays(due, [], at('2026-10-05T12:00:00Z')) === 4
      && overdueDays(due, [{ startedAt: at('2026-10-02T12:00:00Z'), endedAt: at('2026-10-04T12:00:00Z') }], at('2026-10-05T12:00:00Z')) === 2
      && overdueDays(due, [{ startedAt: at('2026-10-03T00:00:00Z'), endedAt: null }], at('2026-10-09T00:00:00Z')) === 1,
    'overdueDays');
  v.record('engagement-s8:a cell is read as text, a formula is refused, and anything that could run is written inert',
    neutralise('=HYPERLINK("x")') === '\'=HYPERLINK("x")' && neutralise('+1') === '\'+1' && neutralise('@cmd') === '\'@cmd'
      && neutralise('-2') === '\'-2' && neutralise('Plain') === 'Plain'
      && 'formula' in cellText({ formula: 'SUM(A1)', result: 3 }) && cellText('=1+1').text === '=1+1',
    'neutralise / cellText');
}

// ── Every route has a caller; the guide quotes labels that are on screen ────
{
  const dir = path.join(q.WEB_SRC, 'pages', 'grc', 'project');
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const tab = src('pages', 'grc', 'project', 'EngagementRequests.tsx');
  const detail = src('pages', 'grc', 'project', 'RequestDetail.tsx');
  const overdue = src('pages', 'grc', 'project', 'OverdueRequests.tsx');
  const asked = src('pages', 'grc', 'project', 'AskedOfYou.tsx');
  const host = src('pages', 'grc', 'DeliveryProjects.tsx');
  const callers = {
    'list, scope changes, raise': /\/api\/engagements\/\$\{projectId\}\/requests`, \{ params/.test(tab) && /\/scope-changes`, \{ params/.test(tab)
      && /apiClient\.post\(`\/api\/engagements\/\$\{projectId\}\/requests`, body\)/.test(tab),
    'import: template, preview, import; export': /\$\{base\}\/template`/.test(tab) && /\$\{base\}\/preview`/.test(tab) && /apiClient\.post\(base,/.test(tab)
      && /\/requests\/export`/.test(tab),
    'scope change: ask, approve, reject': /\/scope-changes`, \{\n\s*services/.test(tab) && /\/scope-changes\/\$\{dialog\.approve\.id\}\/approve`/.test(tab)
      && /\/scope-changes\/\$\{dialog\.reject\.id\}\/reject`/.test(tab),
    'one request and its actions': /\/requests\/\$\{requestId\}`\)/.test(detail) && /\/requests\/\$\{request\.id\}\/answer`/.test(detail)
      && ['decline', 'withdraw', 'review', 'blocker'].every((a) => new RegExp(`/requests/\\$\\{requestId\\}/${a}\``).test(detail))
      && /\/requests\/\$\{requestId\}\/assignee`/.test(detail) && /\/requests\/\$\{requestId\}\/due`/.test(detail)
      && /\/requests\/\$\{requestId\}\/files\/\$\{f\.linkId\}`/.test(detail),
    'evidence: choices, link, remove': /\/evidence-choices`/.test(detail) && /\/evidence-links`, \{/.test(detail) && /\/evidence-links\/\$\{l\.id\}\/remove`/.test(detail),
    'overdue on the Delays tab, a blocker': /params: \{ overdue: 1 \}/.test(overdue) && /\/requests\/\$\{recording\.id\}\/blocker`/.test(overdue),
    'asked of you': /'\/api\/engagements\/requests\/mine'/.test(asked),
    'the screens mounted': host.includes('<EngagementRequests') && src('pages', 'grc', 'project', 'ProjectImpediments.tsx').includes('<OverdueRequests')
      && src('pages', 'grc', 'project', 'MyWork.tsx').includes('<AskedOfYou'),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s8:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const guide = src('data', 'userGuideData.ts').replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '?${name}'?: \\{`))[1] || '').split(/\n  \},\n/)[0];
  const screens = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => q.read(path.join(dir, f))).join('\n') + host;
  const needed = ['Requests', 'Raise a request', 'Import requests', 'Download the template', 'Check the file', 'Import all', 'Ask for a scope change',
    'Approve change', 'Answer', 'Upload a file', 'Link evidence you hold', 'Link a published document', 'Link a record', 'Answer in words',
    'Link the existing file', 'Decline', 'Hand to a colleague', 'Move due date', 'Review', 'Not applicable', 'Returned', 'Accepted',
    'Record as blocker', 'Overdue requests', 'Link to a task or control', 'Remove link', 'Asked of you', 'Due during the hold', 'Export',
    'Clauses with evidence the firm accepted'];
  const quoted = [...section('project-delivery').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const absent = quoted.filter((l) => !screens.includes(l));
  v.record('engagement-s8:the guide describes requests, answers, reviews, scope changes and overdue requests with labels on screen',
    needed.every((l) => quoted.includes(l)) && absent.length === 0,
    `not quoted: ${needed.filter((l) => !quoted.includes(l)).join(', ') || 'none'}; on no screen: ${absent.join(', ') || 'none'}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me');
  const admin = await q.login('company.admin@omniops.me');
  const assignee = await q.login('risk.manager@omniops.me');
  const colleague = await q.login('internal.audit@omniops.me');
  const noWork = await q.login('asset.owner@omniops.me');
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const reviewer = await q.login('risk@grcconsulting.com');
  const outsider = await q.login('presales@grcconsulting.com');
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const raw = async (who, url) => {
    const r = await fetch(q.API + url, { headers: { Authorization: `Bearer ${who.token}` } });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  };
  const c = as(client);
  const me = client.user.id;
  const omni = await prisma.tenant.findFirst({ where: { name: 'OmniOps' }, select: { id: true } });
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const iso = await prisma.standard.findFirst({ where: { code: 'ISO27001' }, select: { id: true } });
  const ac04 = await prisma.controlImplementation.findFirst({ where: { tenantId: omni.id, control: { code: 'AC-04' } }, select: { id: true, status: true } });
  const trail = async (subjectId, action) => (await prisma.auditLog.findMany({ where: { subjectId, action }, select: { tenantId: true } }));
  const onBoth = (rows) => rows.some((t) => t.tenantId === omni.id) && rows.some((t) => t.tenantId === gcp.id);
  const memberOf = (pid, who) => prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: who.user.id } } });
  const told = (who, event) => prisma.notification.count({ where: { recipientId: who.user.id, event } });

  // ── An engagement bound to ISO 27001, its firm, its team and its scope ───
  const p = (await c('POST', '/api/projects', {
    name: `S8 ISO 27001 ${stamp}`, startDate: day(0), targetEndDate: day(90), ownerId: me, managerId: me, projectType: 'Certification', standardIds: [iso.id],
  })).json?.project;
  const pid = p.id;
  const ph = (await c('POST', `/api/projects/${pid}/phases`, { name: 'Access control', startDate: day(0), targetEndDate: day(40), ownerId: me })).json?.phase;
  const task = (await c('POST', `/api/projects/phases/${ph.id}/tasks`, { name: 'Recertify access', startDate: day(1), dueDate: day(20), assigneeId: me })).json?.task;
  await c('POST', `/api/projects/${pid}/activate`, {});
  await c('POST', `/api/projects/${pid}/members`, { userId: assignee.user.id, side: 'Client', roleLabel: 'Risk lead', raci: 'R' });
  const inv = (await c('POST', '/api/engagements/invitations', { projectId: pid, firmTenantId: gcp.id })).json?.invitation;
  await as(lead)('POST', `/api/engagements/invitations/${inv.id}/accept`);
  await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, lead)).id}/approve`, { engagementRole: 'Lead', accessFrom: day(0) });
  for (const [who, role] of [[consultant, 'Consultant'], [reviewer, 'Reviewer']]) {
    await as(lead)('POST', `/api/engagements/${pid}/nominations`, { userId: who.user.id, engagementRole: role });
    await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, who)).id}/approve`, { engagementRole: role, accessFrom: day(0) });
  }
  await c('POST', `/api/engagements/${pid}/scope`, {
    entityIds: [omni.id], frameworkIds: [iso.id], services: ['Documents', 'Controls', 'Risks', 'Assets'], classificationCeiling: 'Internal', validFrom: day(-1), validTo: day(120),
  });
  const v1 = await prisma.engagementScopeVersion.findFirst({ where: { projectId: pid, status: 'Draft' } });
  await as(admin)('POST', `/api/engagements/${pid}/scope/${v1.id}/approve`);
  const R = (who) => (method, rest = '', body) => as(who)(method, `/api/engagements/${pid}/requests${rest}`, body);

  // ── Who asks, for what, of whom, by when ─────────────────────────────────
  const ac04Ask = {
    kind: 'Evidence', title: 'Quarterly access recertification, Q3', criteria: 'Signed recertification of every in-scope system',
    targetType: 'Control', targetRef: 'AC-04', periodFrom: '2026-07-01', periodTo: '2026-09-30', dueDate: day(10), assigneeId: assignee.user.id,
  };
  const byReviewer = await R(reviewer)('POST', '', ac04Ask);
  const offTeam = await R(consultant)('POST', '', { ...ac04Ask, assigneeId: colleague.user.id });
  const pastAccess = await R(consultant)('POST', '', { ...ac04Ask, dueDate: day(300) });
  const raised = await R(consultant)('POST', '', ac04Ask);
  const again = await R(consultant)('POST', '', ac04Ask);
  const vendors = await R(consultant)('POST', '', { kind: 'Dataset', title: 'Supplier register extract', targetType: 'Register', targetRef: 'Vendors', dueDate: day(15) });
  const reqId = raised.json?.request?.id;
  const reviewerSees = ((await R(reviewer)('GET')).json?.requests || []).some((r) => r.id === reqId);
  const outsiderSees = (await R(outsider)('GET')).status;
  v.record('engagement-s8:the Lead and Consultants raise, Reviewers only see; within scope, of the team, inside the raiser\'s dates, never twice',
    byReviewer.status === 403 && byReviewer.json?.code === 'ENGAGEMENT_ROLE'
      && offTeam.status === 400 && offTeam.json?.code === 'NOT_ON_TEAM'
      && pastAccess.status === 400 && pastAccess.json?.code === 'DUE_OUTSIDE_ACCESS'
      && raised.status === 201 && raised.json?.request?.ref === 'REQ-0001' && again.status === 409 && again.json?.code === 'DUPLICATE_REQUEST'
      && vendors.status === 409 && vendors.json?.code === 'OUT_OF_SCOPE' && vendors.json.scopeChange?.services?.includes('Vendors')
      && reviewerSees && outsiderSees === 404 && onBoth(await trail(reqId, 'ENGAGEMENT_REQUEST_RAISED'))
      && (await told(assignee, 'ENGAGEMENT_REQUEST_RAISED')) >= 1,
    `reviewer ${byReviewer.status} ${byReviewer.json?.code || ''}; off team ${offTeam.status} ${offTeam.json?.code || ''}; past access ${pastAccess.status} ${pastAccess.json?.code || ''}; `
      + `raised ${raised.status} ${raised.json?.request?.ref || raised.json?.message || ''}; again ${again.status}; vendors ${vendors.status} ${JSON.stringify(vendors.json?.scopeChange)}; `
      + `reviewer sees ${reviewerSees}; outsider ${outsiderSees}`);

  // ── The AC-04 request, end to end ────────────────────────────────────────
  const A = (who) => (body) => R(who)('POST', `/${reqId}/answer`, body);
  const first = pdf(`AC-04 recertification July ${stamp}`);
  const second = pdf(`AC-04 recertification July to September ${stamp}`);
  const noRole = await A(noWork)({ kind: 'Text', text: 'Done' });
  const firmAnswers = await A(consultant)({ kind: 'Text', text: 'We have it' });
  const dangerous = await A(assignee)({ kind: 'Upload', fileName: 'recert.exe', fileData: b64(first) });
  const tooHigh = await A(assignee)({ kind: 'Upload', fileName: 'recert.pdf', fileData: b64(first), classification: 'Confidential' });
  const answered = await A(assignee)({ kind: 'Upload', fileName: 'recert-july.pdf', fileData: b64(first), classification: 'Internal', title: 'Recertification, July' });
  const afterAnswer = (await R(consultant)('GET', `/${reqId}`)).json;
  const file1 = afterAnswer?.answers?.[0]?.files?.[0];
  const viewOnly = await raw(consultant, `/api/engagements/${pid}/requests/${reqId}/files/${file1?.linkId}`);
  const preview = await raw(consultant, `/api/engagements/${pid}/requests/${reqId}/files/${file1?.linkId}?disposition=preview`);
  v.record('engagement-s8:the organisation answers with a checked, hashed file; the firm sees it only through the request and downloads only where allowed',
    noRole.status === 403 && firmAnswers.status === 403 && firmAnswers.json?.code === 'CLIENT_ANSWERS'
      && dangerous.status === 400 && dangerous.json?.code === 'DANGEROUS_TYPE' && tooHigh.status === 409 && tooHigh.json?.code === 'ABOVE_CEILING'
      && answered.status === 201 && afterAnswer?.request?.status === 'Answered' && file1?.sha256 === sha(first)
      && viewOnly.status === 403 && preview.status === 200 && sha(preview.buf) === sha(first)
      && onBoth(await trail(reqId, 'ENGAGEMENT_REQUEST_ANSWERED')) && (await told(consultant, 'ENGAGEMENT_REQUEST_ANSWERED')) >= 1,
    `no role ${noRole.status}; firm ${firmAnswers.status} ${firmAnswers.json?.code || ''}; exe ${dangerous.status} ${dangerous.json?.code || ''}; confidential ${tooHigh.status} ${tooHigh.json?.code || ''}; `
      + `answer ${answered.status} ${answered.json?.message || ''} → ${afterAnswer?.request?.status}; hash ${file1?.sha256 === sha(first)}; download ${viewOnly.status}, preview ${preview.status}`);

  const fullTests = { relevant: 'Pass', complete: 'Pass', coversPeriod: 'Pass', authentic: 'NotApplicable' };
  const noNote = await R(consultant)('POST', `/${reqId}/review`, { outcome: 'Returned', tests: { ...fullTests, coversPeriod: 'Fail' }, note: 'August and September are missing' });
  const acceptFail = await R(consultant)('POST', `/${reqId}/review`, { outcome: 'Accepted', tests: { ...fullTests, coversPeriod: 'Fail' }, testNotes: { coversPeriod: 'Only July' } });
  const returned = await R(consultant)('POST', `/${reqId}/review`, {
    outcome: 'Returned', tests: { ...fullTests, coversPeriod: 'Fail' }, testNotes: { coversPeriod: 'Only July is covered' }, note: 'August and September are missing',
  });
  const sameFile = await A(assignee)({ kind: 'Upload', fileName: 'recert-again.pdf', fileData: b64(first) });
  const resubmitted = await A(assignee)({ kind: 'Upload', fileName: 'recert-q3.pdf', fileData: b64(second), title: 'Recertification, Q3' });
  const history = (await R(client)('GET', `/${reqId}`)).json;
  const accepted = await R(consultant)('POST', `/${reqId}/review`, { outcome: 'Accepted', tests: fullTests });
  const summary = (await R(client)('GET')).json?.summary;
  const ac04After = await prisma.controlImplementation.findUnique({ where: { id: ac04.id }, select: { status: true } });
  const taskAfter = await prisma.projectTask.findUnique({ where: { id: task.id }, select: { status: true } });
  v.record('engagement-s8:returned on Covers the period with what is missing, answered again with the first hash kept, then accepted',
    noNote.status === 400 && noNote.json?.code === 'FAIL_NOTE_REQUIRED' && acceptFail.status === 400 && acceptFail.json?.code === 'FAILED_TEST'
      && returned.status === 200 && (await told(assignee, 'ENGAGEMENT_REQUEST_RETURNED')) >= 1
      && sameFile.status === 409 && sameFile.json?.code === 'SAME_FILE' && sameFile.json.existing?.itemId === file1?.itemId
      && resubmitted.status === 201 && history?.answers?.length === 2 && history.answers[1].replacedAt && history.answers[1].files[0].sha256 === sha(first)
      && history.answers[0].files[0].sha256 === sha(second) && history.reviews?.[0]?.coversPeriod === 'Fail'
      && accepted.status === 200 && onBoth(await trail(reqId, 'ENGAGEMENT_REQUEST_ACCEPTED')),
    `no note ${noNote.status} ${noNote.json?.code || ''}; accept with fail ${acceptFail.status} ${acceptFail.json?.code || ''}; returned ${returned.status}; `
      + `same file ${sameFile.status} ${sameFile.json?.code || ''}; again ${resubmitted.status}; answers ${history?.answers?.length}; accepted ${accepted.status} ${accepted.json?.message || ''}`);
  v.record('engagement-s8:acceptance counts toward readiness and verifies nothing',
    summary?.Accepted === 1 && summary.acceptedClauses >= 1 && ac04After?.status === ac04.status && taskAfter?.status === 'NotStarted',
    `summary ${JSON.stringify(summary)}; AC-04 ${ac04.status} → ${ac04After?.status}; task ${taskAfter?.status}`);

  // ── One file, used again ─────────────────────────────────────────────────
  const latest = history.answers[0].files[0];
  const L = (who, body) => as(who)('POST', `/api/engagements/${pid}/evidence-links`, body);
  const toTask = await L(client, { itemKind: latest.itemKind, itemId: latest.itemId, targetType: 'Task', targetRef: task.ref });
  const toControl = await L(client, { itemKind: latest.itemKind, itemId: latest.itemId, targetType: 'Control', targetRef: 'AC-04' });
  const twice = await L(client, { itemKind: latest.itemKind, itemId: latest.itemId, targetType: 'Task', targetRef: task.ref });
  const byFirm = await L(lead, { itemKind: latest.itemKind, itemId: latest.itemId, targetType: 'Task', targetRef: task.ref });
  const linked = (await R(client)('GET', `/${reqId}`)).json?.answers?.[0]?.files?.[0]?.alsoLinkedTo || [];
  const firmView = (await R(consultant)('GET', `/${reqId}`)).json?.answers?.[0]?.files?.[0];
  const removed = await as(client)('POST', `/api/engagements/${pid}/evidence-links/${toTask.json?.link?.id}/remove`);
  const answerLink = await as(client)('POST', `/api/engagements/${pid}/evidence-links/${latest.linkId}/remove`);
  const stillThere = await raw(client, `/api/engagements/${pid}/requests/${reqId}/files/${latest.linkId}`);
  v.record('engagement-s8:one file is linked to a task and a control with who and when; unlinking never removes the file',
    toTask.status === 201 && toControl.status === 201 && twice.status === 409 && byFirm.status === 403
      && linked.length === 2 && linked.every((l) => l.linkedBy && l.linkedAt) && firmView && !('alsoLinkedTo' in firmView)
      && removed.status === 200 && answerLink.status === 409 && answerLink.json?.code === 'ANSWER_LINK'
      && stillThere.status === 200 && sha(stillThere.buf) === sha(second)
      && (await prisma.evidenceItem.count({ where: { id: latest.itemId } })) === 1,
    `task ${toTask.status} ${toTask.json?.message || ''}, control ${toControl.status} ${toControl.json?.message || ''}, twice ${twice.status}, firm ${byFirm.status}; `
      + `linked ${linked.length}; remove ${removed.status}; answer link ${answerLink.status}; file ${stillThere.status}`);

  // ── Who answers, and by when ─────────────────────────────────────────────
  const second2 = (await R(consultant)('POST', '', { kind: 'Document', title: 'Access control policy, current version', dueDate: day(12), assigneeId: assignee.user.id })).json?.request;
  const pmToldBefore = await told(client, 'ENGAGEMENT_REQUEST_REASSIGNED');
  const handed = await R(assignee)('PATCH', `/${second2?.id}/assignee`, { assigneeId: colleague.user.id, note: 'Internal audit holds the policy set' });
  const pmTold = (await told(client, 'ENGAGEMENT_REQUEST_REASSIGNED')) - pmToldBefore;
  const cannot = await R(client)('PATCH', `/${second2?.id}/assignee`, { assigneeId: noWork.user.id });
  const firmMoves = await R(lead)('PATCH', `/${second2?.id}/due`, { dueDate: day(20), reason: 'We need it later after all' });
  const moved = await R(client)('PATCH', `/${second2?.id}/due`, { dueDate: day(14), reason: 'The policy owner is away this week' });
  const now2 = await prisma.informationRequest.findUnique({ where: { id: second2?.id }, select: { assigneeId: true, dueDate: true } });
  v.record('engagement-s8:the assignee hands a request to a colleague who can do project work and the project manager is told; the project manager moves due dates',
    handed.status === 200 && pmTold === 1 && now2?.assigneeId === colleague.user.id
      && cannot.status === 400 && cannot.json?.code === 'CANNOT_ANSWER' && firmMoves.status === 403 && moved.status === 200
      && now2.dueDate.toISOString().slice(0, 10) === day(14) && onBoth(await trail(second2?.id, 'ENGAGEMENT_REQUEST_DUE_MOVED')),
    `handed ${handed.status} ${handed.json?.message || ''}, pm told ${pmTold}; no project work ${cannot.status} ${cannot.json?.code || ''}; firm moves ${firmMoves.status}; moved ${moved.status}`);

  // ── Reminders, holds and overdue requests ────────────────────────────────
  const soon = (await R(consultant)('POST', '', { kind: 'Clarification', title: 'Who approves access for contractors?', dueDate: day(2), assigneeId: assignee.user.id })).json?.request;
  const remindedBefore = await told(assignee, 'ENGAGEMENT_REQUEST_REMINDED');
  const s1 = await runEngagementAccessScan(new Date());
  const reminded = (await told(assignee, 'ENGAGEMENT_REQUEST_REMINDED')) - remindedBefore;
  await prisma.informationRequest.update({ where: { id: soon.id }, data: { dueDate: midnight(0) } });
  const dueBefore = { a: await told(assignee, 'ENGAGEMENT_REQUEST_DUE'), pm: await told(client, 'ENGAGEMENT_REQUEST_DUE') };
  await runEngagementAccessScan(new Date());
  await runEngagementAccessScan(new Date());
  const dueTold = { a: (await told(assignee, 'ENGAGEMENT_REQUEST_DUE')) - dueBefore.a, pm: (await told(client, 'ENGAGEMENT_REQUEST_DUE')) - dueBefore.pm };
  // On hold: nothing is sent and nothing new is asked.
  const paused = (await R(consultant)('POST', '', { kind: 'Clarification', title: 'Is the joiner process documented?', dueDate: day(20), assigneeId: assignee.user.id })).json?.request;
  await c('PATCH', `/api/projects/${pid}`, { status: 'OnHold', reason: 'Waiting for the board to agree the budget', holdFirmAccess: 'View' });
  await prisma.informationRequest.update({ where: { id: paused.id }, data: { dueDate: midnight(1), reminderSentAt: null } });
  const onHoldScan = await runEngagementAccessScan(new Date());
  const pausedRow = await prisma.informationRequest.findUnique({ where: { id: paused.id }, select: { reminderSentAt: true } });
  const raiseOnHold = await R(consultant)('POST', '', { kind: 'Clarification', title: 'Anything new while held', dueDate: day(20) });
  await c('PATCH', `/api/projects/${pid}`, { status: 'Active', reason: 'The budget was agreed by the board' });
  await runEngagementAccessScan(new Date());
  const resumedRow = await prisma.informationRequest.findUnique({ where: { id: paused.id }, select: { reminderSentAt: true } });
  v.record('engagement-s8:reminders three days before and on the due date, once each, and none while on hold, when nothing new is asked either',
    s1.requestReminders >= 1 && reminded === 1 && dueTold.a === 1 && dueTold.pm === 1
      && onHoldScan.requestReminders === 0 && pausedRow?.reminderSentAt === null
      && raiseOnHold.status === 403 && raiseOnHold.json?.code === 'ON_HOLD_READ_ONLY' && resumedRow?.reminderSentAt !== null,
    `first scan ${JSON.stringify(s1)}, reminded ${reminded}; due: assignee ${dueTold.a}, pm ${dueTold.pm}; on hold ${JSON.stringify(onHoldScan)}, `
      + `raise ${raiseOnHold.status} ${raiseOnHold.json?.code || ''}; after resume ${resumedRow?.reminderSentAt ? 'reminded' : 'not reminded'}`);

  await prisma.informationRequest.update({ where: { id: soon.id }, data: { dueDate: midnight(-10) } });
  const overdueList = (await R(lead)('GET', '?overdue=1')).json;
  const row = overdueList?.requests?.find((r) => r.id === soon.id);
  const automatic = await prisma.projectImpediment.count({ where: { informationRequestId: soon.id } });
  const byConsultant = await R(consultant)('POST', `/${soon.id}/blocker`);
  const notOverdue = await R(lead)('POST', `/${second2?.id}/blocker`);
  const recorded = await R(lead)('POST', `/${soon.id}/blocker`);
  const twiceRecorded = await R(client)('POST', `/${soon.id}/blocker`);
  const imp = await prisma.projectImpediment.findFirst({ where: { informationRequestId: soon.id }, select: { owingSide: true, category: true, kind: true } });
  v.record('engagement-s8:overdue is shown and never a delay by itself; the firm\'s Lead or the project manager records it as a blocker owed by the organisation',
    row?.overdueDays >= 9 && automatic === 0 && overdueList.can?.recordBlocker === true
      && byConsultant.status === 403 && byConsultant.json?.code === 'LEAD_OR_PM' && notOverdue.status === 409 && notOverdue.json?.code === 'NOT_OVERDUE'
      && recorded.status === 201 && twiceRecorded.status === 409 && twiceRecorded.json?.code === 'ALREADY_RECORDED'
      && imp?.owingSide === 'Client' && imp.category === 'ClientDependency' && imp.kind === 'Blocker',
    `overdue ${row?.overdueDays}; automatic ${automatic}; consultant ${byConsultant.status} ${byConsultant.json?.code || ''}; not overdue ${notOverdue.status}; `
      + `recorded ${recorded.status} ${recorded.json?.message || ''}; twice ${twiceRecorded.status}; ${JSON.stringify(imp)}`);

  // ── Import: whole or nothing; export: inert ──────────────────────────────
  const template = await raw(lead, `/api/engagements/${pid}/requests/import/template`);
  const sheetOf = async (rows) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Requests');
    ws.addRow(['Kind', 'Title', 'What would satisfy it', 'About', 'Reference', 'Period from', 'Period to', 'Due date', 'Assignee email']);
    for (const r of rows) ws.addRow(r);
    return b64(Buffer.from(await wb.xlsx.writeBuffer()));
  };
  const goodRows = [
    ['Evidence', `Joiner access approvals ${stamp}`, 'Approvals for every joiner', 'Control', 'AC-04', '2026-07-01', '2026-09-30', day(20), 'risk.manager@omniops.me'],
    ['Clarification', `=SUM(1,2) ${stamp}`, '', 'Engagement', '', '', '', day(21), ''],
  ];
  const badFile = await sheetOf([
    ...goodRows,
    ['Evidence', `Leaver records ${stamp}`, '', 'Task', task.ref, '', '', day(22), 'internal.audit@omniops.me'],
    ['Document', 'Access control policy, current version', '', 'Engagement', '', '', '', day(23), ''],
    ['Dataset', `Supplier list ${stamp}`, '', 'Register', 'Vendors', '', '', day(24), ''],
    ['Evidence', `Leaver records late ${stamp}`, '', 'Engagement', '', '', '', day(300), ''],
  ]);
  const withFormula = await (async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Requests');
    ws.addRow(['Kind', 'Title', 'What would satisfy it', 'About', 'Reference', 'Period from', 'Period to', 'Due date', 'Assignee email']);
    ws.addRow(['Evidence', 'x', '', 'Engagement', '', '', '', day(20), '']);
    ws.getCell('B2').value = { formula: 'HYPERLINK("http://example.invalid","click")', result: 'click' };
    return b64(Buffer.from(await wb.xlsx.writeBuffer()));
  })();
  const before = await prisma.informationRequest.count({ where: { projectId: pid } });
  const previewBad = (await R(lead)('POST', '/import/preview', { fileName: 'requests.xlsx', fileData: badFile })).json;
  const importBad = await R(lead)('POST', '/import', { fileName: 'requests.xlsx', fileData: badFile });
  const formula = (await R(lead)('POST', '/import/preview', { fileName: 'formula.xlsx', fileData: withFormula })).json;
  const afterBad = await prisma.informationRequest.count({ where: { projectId: pid } });
  const importGood = await R(lead)('POST', '/import', { fileName: 'requests.xlsx', fileData: await sheetOf(goodRows) });
  const importTrail = await prisma.auditLog.findMany({ where: { tenantId: omni.id, action: 'ENGAGEMENT_REQUESTS_IMPORTED', subjectId: pid }, select: { payload: true } });
  const exported = await raw(client, `/api/engagements/${pid}/requests/export`);
  const wbOut = new ExcelJS.Workbook();
  await wbOut.xlsx.load(exported.buf);
  const titles = [];
  wbOut.worksheets[0].eachRow((r, n) => { if (n > 1) titles.push(String(r.getCell(3).value)); });
  const problems = (previewBad?.rows || []).map((r) => r.problems.join(' '));
  v.record('engagement-s8:an import goes in whole or not at all, every row checked and formulas refused, with one trail entry; the export writes formulas as text',
    template.status === 200 && template.buf.slice(0, 2).toString() === 'PK'
      && previewBad?.ok === false && previewBad.problems === 4
      && /not on this engagement's team/.test(problems[2]) && /already asks for this/.test(problems[3])
      && /not in this engagement's scope/.test(problems[4]) && /after your access ends/.test(problems[5])
      && importBad.status === 400 && importBad.json?.code === 'IMPORT_HAS_PROBLEMS' && afterBad === before
      && formula?.ok === false && /formula/.test(formula.rows?.[0]?.problems?.join(' ') || '')
      && importGood.status === 201 && importGood.json?.count === 2 && importTrail.length === 1
      && JSON.parse(importTrail[0].payload).requests?.length === 2
      && titles.some((t) => t.startsWith(`'=SUM(1,2) ${stamp}`)),
    `template ${template.status}; preview ok ${previewBad?.ok} problems ${previewBad?.problems} ${JSON.stringify(problems)}; import bad ${importBad.status} (${before}→${afterBad}); `
      + `formula ${JSON.stringify(formula?.rows?.[0]?.problems)}; import good ${importGood.status} ${importGood.json?.count ?? importGood.json?.message}; trail ${importTrail.length}; `
      + `export ${titles.find((t) => t.includes('SUM'))}`);

  // ── A vendor-register request becomes an approved scope change ───────────
  const pending = { kind: 'Dataset', title: `Supplier register extract ${stamp}`, targetType: 'Register', targetRef: 'Vendors', dueDate: day(15) };
  const reviewerAsks = await as(reviewer)('POST', `/api/engagements/${pid}/scope-changes`, { services: ['Vendors'], reason: 'The supplier review needs the register', pendingRequest: pending });
  const asked = await as(consultant)('POST', `/api/engagements/${pid}/scope-changes`, { services: ['Vendors'], reason: 'The supplier review needs the register', pendingRequest: pending });
  const scId = asked.json?.scopeChange?.id;
  const firmApproves = await as(lead)('POST', `/api/engagements/${pid}/scope-changes/${scId}/approve`);
  const approvedByA = await c('POST', `/api/engagements/${pid}/scope-changes/${scId}/approve`, { note: 'Vendors agreed for the supplier review' });
  const draft = await prisma.engagementScopeVersion.findFirst({ where: { projectId: pid, status: 'Draft' } });
  const stillNarrow = await R(consultant)('POST', '', { ...pending, title: `${pending.title} early` });
  const selfApprove = await c('POST', `/api/engagements/${pid}/scope/${draft?.id}/approve`);
  const byB = await as(admin)('POST', `/api/engagements/${pid}/scope/${draft?.id}/approve`);
  const sc = await prisma.scopeChangeRequest.findUnique({ where: { id: scId } });
  const carried = sc?.raisedRequestId ? await prisma.informationRequest.findUnique({ where: { id: sc.raisedRequestId }, select: { targetType: true, targetId: true, raisedById: true, scopeChangeId: true } }) : null;
  const binding = await prisma.engagementScopeVersion.findFirst({ where: { projectId: pid, status: 'Binding' } });
  v.record('engagement-s8:a vendor-register request becomes a scope change: the organisation approves, a second person approves the version, then it is raised',
    reviewerAsks.status === 403 && asked.status === 201 && firmApproves.status === 403
      && approvedByA.status === 200 && draft?.origin === 'ScopeChange' && draft.draftedById === me
      && stillNarrow.status === 409 && stillNarrow.json?.code === 'OUT_OF_SCOPE'
      && selfApprove.status === 403 && selfApprove.json?.code === 'SECOND_PERSON' && byB.status === 200
      && JSON.parse(binding?.services || '[]').includes('Vendors') && sc?.status === 'Approved'
      && carried?.targetType === 'Register' && carried.targetId === 'Vendors' && carried.raisedById === consultant.user.id && carried.scopeChangeId === scId
      && onBoth(await trail(pid, 'ENGAGEMENT_SCOPE_CHANGE_BOUND')),
    `reviewer ${reviewerAsks.status}; ask ${asked.status} ${asked.json?.message || ''}; firm approves ${firmApproves.status}; A ${approvedByA.status} ${approvedByA.json?.message || ''} → draft ${draft?.version}/${draft?.origin}; `
      + `early request ${stillNarrow.status}; A on the version ${selfApprove.status} ${selfApprove.json?.code || ''}; B ${byB.status}; change ${sc?.status}; carried ${JSON.stringify(carried)}`);

  const toReject = (await as(consultant)('POST', `/api/engagements/${pid}/scope-changes`, { classificationCeiling: 'Confidential', reason: 'Some evidence is Confidential' })).json?.scopeChange;
  const rejected = await c('POST', `/api/engagements/${pid}/scope-changes/${toReject?.id}/reject`, { reason: 'Confidential stays inside for now' });
  const toDiscard = (await as(consultant)('POST', `/api/engagements/${pid}/scope-changes`, { services: [], classificationCeiling: 'Restricted', reason: 'One Restricted record is needed' })).json?.scopeChange;
  await c('POST', `/api/engagements/${pid}/scope-changes/${toDiscard?.id}/approve`);
  const draft2 = await prisma.engagementScopeVersion.findFirst({ where: { projectId: pid, status: 'Draft' } });
  const discarded = await as(admin)('POST', `/api/engagements/${pid}/scope/${draft2?.id}/discard`, { reason: 'Restricted is never shared on this engagement' });
  const states = await prisma.scopeChangeRequest.findMany({ where: { id: { in: [toReject?.id, toDiscard?.id].filter(Boolean) } }, select: { id: true, status: true } });
  const kept = await prisma.engagementScopeVersion.findUnique({ where: { id: draft2?.id }, select: { status: true } });
  v.record('engagement-s8:a rejected scope change and a discarded draft stay in the history',
    rejected.status === 200 && discarded.status === 200 && states.length === 2 && states.every((s) => s.status === 'Rejected') && kept?.status === 'Discarded',
    `reject ${rejected.status}; discard ${discarded.status}; ${JSON.stringify(states)}; draft ${kept?.status}`);

  // ── Answers only while the firm's access is open ─────────────────────────
  await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, consultant)).id}/remove`, { reason: 'Moved to another client engagement' });
  const goneList = await R(consultant)('GET');
  const goneFile = await raw(consultant, `/api/engagements/${pid}/requests/${reqId}/files/${latest.linkId}?disposition=preview`);
  v.record('engagement-s8:once a firm person\'s access ends the requests and their answers answer 404',
    goneList.status === 404 && goneFile.status === 404, `list ${goneList.status}; file ${goneFile.status}`);

  await prisma.$disconnect();
  v.finish(`${p.ref}: REQ-0001 on AC-04 accepted, the vendor register added by a scope change`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
