/**
 * Consulting engagement, sprint 12: readiness and management review.
 *
 * Here, with the seeded pilot (OmniOps and GRC Consulting Partners):
 *
 *   - readiness per clause is computed from what is held: documented,
 *     implemented, evidenced (accepted, not stale), gaps closed, risks
 *     treated, records period; nobody can type it in;
 *   - a control with five weeks of operating evidence is not ready for
 *     Stage 2 under the default three-month records period; four months is;
 *     the organisation sets the period, with a reason;
 *   - the firm's Lead gives an opinion beside the figures and the
 *     engagement's owner signs off; both keep the figures as they stood;
 *   - a management review prepared by the firm is recorded by the
 *     organisation only when every 9.3.2 input is considered and decisions
 *     are written; once recorded it satisfies 9.3 and does not change;
 *   - every route has a caller on a screen, and the guide quotes its labels.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s12-readiness-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const { spansPeriod, verdictOf, reviewGaps, satisfies93, checkRecordsPeriod, REVIEW_INPUTS } = require('../../dist/services/readiness');

const v = q.verdicts('engagement-s12');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const ago = (days) => new Date(Date.now() - days * DAY);
const stamp = Date.now().toString(36);
const allInputs = Object.fromEntries(REVIEW_INPUTS.map(([k]) => [k, `Considered: ${k}`]));

// ── The rules, without a database ───────────────────────────────────────────
{
  const now = new Date();
  const all = { documented: true, implemented: true, evidenced: true, gapsClosed: true, risksTreated: true, records: true };
  v.record('engagement-s12:five weeks of evidence does not span three months, four months does; six checks make Ready, four or five Nearly ready',
    !spansPeriod([ago(35), now], 3, now) && spansPeriod([ago(122), ago(10)], 3, now) && !spansPeriod([ago(122), ago(60)], 3, now) && !spansPeriod([], 3, now)
      && verdictOf(all) === 'Ready' && verdictOf({ ...all, records: false }) === 'Nearly ready'
      && verdictOf({ ...all, records: false, evidenced: false, documented: false }) === 'Not ready' && verdictOf(all, true) === 'Not applicable'
      && !checkRecordsPeriod(0).ok && checkRecordsPeriod(6).ok,
    'spansPeriod / verdictOf / checkRecordsPeriod');
  const complete = { heldOn: now, attendees: ['CEO'], inputs: allInputs, decisions: 'Approve the risk treatment plan', status: 'Recorded' };
  v.record('engagement-s12:a management review satisfies 9.3 only when recorded, recent and complete',
    reviewGaps(complete).length === 0 && reviewGaps({ ...complete, inputs: {} }).length === REVIEW_INPUTS.length
      && satisfies93([complete], now) && !satisfies93([{ ...complete, status: 'Draft' }], now)
      && !satisfies93([{ ...complete, heldOn: ago(400) }], now) && !satisfies93([{ ...complete, decisions: '' }], now),
    'reviewGaps / satisfies93');
}

// ── Every route has a caller; the guide quotes labels that are on screen ────
{
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const screen = src('pages', 'grc', 'project', 'EngagementReadiness.tsx');
  const reports = src('pages', 'grc', 'project', 'ProjectReports.tsx');
  const host = src('pages', 'grc', 'DeliveryProjects.tsx');
  const callers = {
    'readiness, period, opinion, sign-off': screen.includes('`${base}/readiness`, { params') && screen.includes('`${base}/records-period`')
      && screen.includes('`${base}/readiness/opinion`') && screen.includes('`${base}/readiness/sign-off`'),
    'reviews: list, prepare, edit, record, actions': screen.includes('`${base}/management-reviews`') && screen.includes('/record`') && screen.includes('/actions`')
      && screen.includes('apiClient.patch(`${base}/management-reviews/${dialog.review.id}`'),
    'the readiness report': reports.includes("kind: 'readiness'"),
    'mounted': host.includes('<EngagementReadiness'),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s12:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const guide = src('data', 'userGuideData.ts').replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '?${name}'?: \\{`))[1] || '').split(/\n  \},\n/)[0];
  const screens = [screen, reports, host].join('\n');
  const needed = ['Readiness', 'Ready', 'Nearly ready', 'Not ready', 'Records period', 'Set the records period', 'Give readiness opinion',
    'Sign off readiness', 'Prepare a management review', 'Start a management review', 'Record the review', 'Add an action', 'Management review (9.3)'];
  const quoted = [...section('project-delivery').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const absent = needed.filter((l) => quoted.includes(l) && !screens.includes(l));
  v.record('engagement-s12:the guide describes readiness and management review with labels on screen',
    needed.every((l) => quoted.includes(l)) && absent.length === 0,
    `not quoted: ${needed.filter((l) => !quoted.includes(l)).join(', ') || 'none'}; on no screen: ${absent.join(', ') || 'none'}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me'); // PM and owner: the sponsor
  const admin = await q.login('company.admin@omniops.me');
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const c = as(client);
  const me = client.user.id;
  const omni = await prisma.tenant.findFirst({ where: { name: 'OmniOps' }, select: { id: true } });
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const iso = await prisma.standard.findFirst({ where: { code: 'ISO27001' }, select: { id: true } });
  const memberOf = (pid, who) => prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: who.user.id } } });

  const p = (await c('POST', '/api/projects', {
    name: `S12 ISO 27001 ${stamp}`, startDate: day(0), targetEndDate: day(90), ownerId: me, managerId: me, projectType: 'Certification', standardIds: [iso.id],
  })).json?.project;
  const pid = p.id;
  await c('POST', `/api/projects/${pid}/phases`, { name: 'Readiness', startDate: day(0), targetEndDate: day(40), ownerId: me });
  await c('POST', `/api/projects/${pid}/activate`, {});
  const inv = (await c('POST', '/api/engagements/invitations', { projectId: pid, firmTenantId: gcp.id })).json?.invitation;
  await as(lead)('POST', `/api/engagements/invitations/${inv.id}/accept`);
  await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, lead)).id}/approve`, { engagementRole: 'Lead', accessFrom: day(0) });
  await as(lead)('POST', `/api/engagements/${pid}/nominations`, { userId: consultant.user.id, engagementRole: 'Consultant' });
  await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, consultant)).id}/approve`, { engagementRole: 'Consultant', accessFrom: day(0) });
  await c('POST', `/api/engagements/${pid}/scope`, {
    entityIds: [omni.id], frameworkIds: [iso.id], services: ['Documents', 'Controls', 'Risks', 'Assets'], classificationCeiling: 'Internal', validFrom: day(-1), validTo: day(120),
  });
  const draftScope = await prisma.engagementScopeVersion.findFirst({ where: { projectId: pid, status: 'Draft' } });
  await as(admin)('POST', `/api/engagements/${pid}/scope/${draftScope.id}/approve`);
  const R = `/api/engagements/${pid}/readiness`;

  // A.5.16 (identity management, AC-02 implemented): documented, evidenced, no gap, no risk beyond tolerance.
  const clause = await prisma.standardClause.findFirst({ where: { standardId: iso.id, ref: 'A.5.16' }, select: { id: true } });
  const impl = await prisma.controlImplementation.findFirst({ where: { tenantId: omni.id, control: { code: 'AC-02' } }, select: { id: true, status: true } });
  const doc = await prisma.document.create({
    data: { code: `S12-POL-${stamp}`, title: 'Identity Management Procedure', category: 'Procedure', classification: 'Internal', status: 'PUBLISHED', version: '1.0', publishedVersion: '1.0', publishedAt: new Date(), audienceKind: 'Everyone', content: 'Joiners, movers and leavers.', tenantId: omni.id, ownerId: me },
  });
  await prisma.documentLink.create({ data: { documentId: doc.id, clauseId: clause.id, linkedById: me } });
  await prisma.informationRequest.create({
    data: { projectId: pid, ref: 'REQ-0901', kind: 'Evidence', title: 'Joiner and leaver records', targetType: 'Clause', targetId: clause.id, dueDate: new Date(), status: 'Accepted', raisedById: consultant.user.id, assigneeId: me, closedAt: new Date(), closedById: consultant.user.id },
  });
  await prisma.evidence.deleteMany({ where: { implementationId: impl.id } });
  for (const when of [ago(35), ago(3)]) {
    await prisma.evidence.create({ data: { tenantId: omni.id, implementationId: impl.id, title: 'Access review record', uploadedById: me, createdAt: when } });
  }
  const row = async () => ((await c('GET', `${R}?tenantId=${omni.id}&standardId=${iso.id}`)).json?.clauses || []).find((x) => x.ref === 'A.5.16');
  const fiveWeeks = await row();
  const typed = await c('PATCH', `${R}`, { verdict: 'Ready' });
  v.record('engagement-s12:readiness is computed per clause; a control with five weeks of evidence is not ready for Stage 2',
    fiveWeeks && fiveWeeks.checks.documented && fiveWeeks.checks.implemented && fiveWeeks.checks.evidenced && fiveWeeks.checks.gapsClosed
      && fiveWeeks.checks.risksTreated && fiveWeeks.checks.records === false && fiveWeeks.verdict === 'Nearly ready'
      && fiveWeeks.why.controls.some((x) => x.code === 'AC-02' && x.evidenceDays >= 30 && x.evidenceDays <= 33)
      && typed.status === 404,
    `row ${JSON.stringify(fiveWeeks && { checks: fiveWeeks.checks, verdict: fiveWeeks.verdict, why: fiveWeeks.why.controls })}; typed ${typed.status}`);

  await prisma.evidence.create({ data: { tenantId: omni.id, implementationId: impl.id, title: 'Access review record, June', uploadedById: me, createdAt: ago(125) } });
  const fourMonths = await row();
  const firmSets = await as(lead)('PATCH', `/api/engagements/${pid}/records-period`, { months: 6, reason: 'The auditor samples six months' });
  const noWhy = await c('PATCH', `/api/engagements/${pid}/records-period`, { months: 6 });
  const longer = await c('PATCH', `/api/engagements/${pid}/records-period`, { months: 6, reason: 'The certification body samples six months.' });
  const sixMonths = await row();
  v.record('engagement-s12:four months of evidence spans the default three; the organisation sets a longer period, with a reason, and the clause is not ready again',
    fourMonths?.checks.records === true && fourMonths?.verdict === 'Ready' && firmSets.status === 403 && noWhy.status === 400 && longer.status === 200
      && sixMonths?.checks.records === false && sixMonths?.verdict === 'Nearly ready',
    `four months ${JSON.stringify(fourMonths && fourMonths.verdict)}; firm ${firmSets.status}; no why ${noWhy.status}; longer ${longer.status}; six ${sixMonths?.verdict}`);
  await c('PATCH', `/api/engagements/${pid}/records-period`, { months: 3, reason: 'Back to the default three months.' });

  // ── Opinion and sign-off ─────────────────────────────────────────────────
  const consultantOpines = await as(consultant)('POST', `${R}/opinion`, { verdict: 'Ready', opinion: 'Everything looks in order for Stage 2.' });
  const opinion = await as(lead)('POST', `${R}/opinion`, { verdict: 'ReadyWithConditions', opinion: 'Ready for Stage 2 once the remaining clauses close.', conditions: 'Close the open gaps first.' });
  const firmSigns = await as(lead)('POST', `${R}/sign-off`, { note: 'Signing for the client' });
  const signed = await c('POST', `${R}/sign-off`, { note: 'We go to Stage 2 on these figures and this opinion.' });
  const kept = await prisma.readinessOpinion.findUnique({ where: { id: opinion.json?.opinion?.id || '' }, select: { figures: true } });
  const so = await prisma.readinessSignOff.findUnique({ where: { id: signed.json?.signOff?.id || '' }, select: { opinionId: true, figures: true } });
  v.record('engagement-s12:the firm\'s Lead gives the opinion and the owner signs off; both keep the figures as they stood',
    consultantOpines.status === 403 && opinion.status === 201 && firmSigns.status === 403 && signed.status === 201
      && JSON.parse(kept?.figures || '[]')[0]?.summary?.Ready >= 1 && so?.opinionId === opinion.json?.opinion?.id && JSON.parse(so?.figures || '[]').length === 1,
    `consultant ${consultantOpines.status}; opinion ${opinion.status} ${opinion.json?.message || ''}; firm signs ${firmSigns.status}; signed ${signed.status} ${signed.json?.message || ''}`);

  // ── Management review ────────────────────────────────────────────────────
  const M = `/api/engagements/${pid}/management-reviews`;
  const prepared = await as(consultant)('POST', M, { tenantId: omni.id, heldOn: day(-2), attendees: ['CEO', 'CISO', 'Head of HR'], inputs: { previousActions: 'None open', contextChanges: 'Cloud move' } });
  const rid = prepared.json?.review?.id;
  const firmRecords = await as(lead)('POST', `${M}/${rid}/record`, {});
  const incomplete = await c('POST', `${M}/${rid}/record`, {});
  const completed = await as(consultant)('PATCH', `${M}/${rid}`, { heldOn: day(-2), attendees: ['CEO', 'CISO', 'Head of HR'], inputs: allInputs, decisions: 'Approve the risk treatment plan; fund the SIEM.' });
  const before93 = (await c('GET', `${R}?tenantId=${omni.id}&standardId=${iso.id}`)).json?.managementReview93;
  const recorded = await c('POST', `${M}/${rid}/record`, {});
  const after93 = (await c('GET', `${R}?tenantId=${omni.id}&standardId=${iso.id}`)).json?.managementReview93;
  const changeRecorded = await c('PATCH', `${M}/${rid}`, { decisions: 'Rewritten afterwards' });
  const task = await prisma.projectTask.findFirst({ where: { projectId: pid }, select: { id: true, ref: true } })
    || (await c('POST', `/api/projects/phases/${(await prisma.projectPhase.findFirst({ where: { projectId: pid } })).id}/tasks`, { name: 'Fund the SIEM', startDate: day(1), dueDate: day(30), assigneeId: me })).json?.task;
  const action = await c('POST', `${M}/${rid}/actions`, { description: 'Fund the SIEM by Q1', linkRef: task?.ref });
  const unknownRef = await c('POST', `${M}/${rid}/actions`, { description: 'Something else', linkRef: 'GAP-1999-999' });
  const linked = await prisma.managementReviewAction.findFirst({ where: { reviewId: rid }, select: { taskId: true, linkLabel: true } });
  const firmView = (await as(lead)('GET', M)).json;
  v.record('engagement-s12:a review the firm prepares is recorded by the organisation only when complete; recorded, it satisfies 9.3 and does not change',
    prepared.status === 201 && firmRecords.status === 403 && incomplete.status === 400 && incomplete.json?.code === 'INCOMPLETE'
      && completed.status === 200 && before93 === false && recorded.status === 200 && after93 === true && changeRecorded.status === 409
      && action.status === 201 && linked?.taskId === task?.id && linked?.linkLabel?.startsWith(task?.ref) && unknownRef.status === 404 && firmView?.reviews?.some((r) => r.id === rid && r.status === 'Recorded'),
    `prepared ${prepared.status}; firm records ${firmRecords.status}; incomplete ${incomplete.status}; completed ${completed.status}; 9.3 ${before93} → ${after93}; recorded ${recorded.status}; change ${changeRecorded.status}; action ${action.status}`);

  // ── The readiness report, issued ─────────────────────────────────────────
  const report = await fetch(`${q.API}/api/projects/${pid}/reports/readiness?format=pdf&issue=true`, { headers: { Authorization: `Bearer ${client.token}` } });
  const issued = await prisma.reportIssue.count({ where: { projectId: pid, reportKey: 'delivery-readiness', issued: true } });
  v.record('engagement-s12:the readiness report is issued with a number', report.status === 200 && issued === 1, `report ${report.status}; issued ${issued}`);

  await prisma.$disconnect();
  v.finish(`${p.ref}: A.5.16 not ready on five weeks, ready on four months; review recorded and 9.3 satisfied`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
