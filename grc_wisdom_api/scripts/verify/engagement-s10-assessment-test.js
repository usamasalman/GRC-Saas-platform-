/**
 * Consulting engagement, sprint 10: gap assessment, the Statement of
 * Applicability, and the context register.
 *
 * Here, with the seeded pilot (OmniOps and GRC Consulting Partners):
 *
 *   - the clauses of the framework the scope names are assessed for the
 *     entity it names, by the firm's Lead or a Consultant or by the
 *     organisation, always with the reason; nothing outside the scope;
 *   - a Partial or Missing clause raises a gap in the organisation's issue
 *     register (source ConsultingGap, its clause and type); reassessing
 *     keeps the history and never closes the gap; the organisation answers
 *     and closes it under the register's rule, and only after that does a
 *     new gap get raised for the same clause;
 *   - the Statement of Applicability is issued on demo data, with a number,
 *     from the current assessments: applicable or not, why, how far;
 *   - a context entry the firm proposes counts only once the organisation
 *     accepts it; the firm sees only its own proposals;
 *   - every route has a caller on a screen, and the guide quotes its labels.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s10-assessment-test.js
 */
const path = require('path');
const ExcelJS = require('exceljs');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const { checkAssessment, raisesGap, soaLine, soaClauses, byClauseRef, summarise } = require('../../dist/services/gapAssessment');
const { checkEntry, registerCounts } = require('../../dist/services/contextRegister');

const v = q.verdicts('engagement-s10');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);

// ── The rules, without a database ───────────────────────────────────────────
{
  v.record('engagement-s10:every result has its reason, a gap says what is missing, and an open gap carries on',
    checkAssessment({ result: 'Conformant', justification: 'Recertified every quarter', gapType: null }).ok
      && checkAssessment({ result: 'NotApplicable', justification: 'short', gapType: null }).code === 'JUSTIFICATION_REQUIRED'
      && checkAssessment({ result: 'Missing', justification: 'No access reviews at all', gapType: null }).code === 'GAP_TYPE_REQUIRED'
      && checkAssessment({ result: 'Partial', justification: 'Only July was reviewed', gapType: 'Evidence' }).gapType === 'Evidence'
      && checkAssessment({ result: 'Done', justification: 'xxxxxxxxxxxx', gapType: null }).code === 'BAD_RESULT'
      && raisesGap('Missing', null) && !raisesGap('Missing', 'issue-1') && !raisesGap('Conformant', null),
    'checkAssessment / raisesGap');
  const refs = ['A.5.10', '4.1', 'A.5.2', 'A.8.1'].map((ref) => ({ ref }));
  v.record('engagement-s10:the SoA lists Annex A in clause order and states each line without guessing',
    JSON.stringify(soaClauses(refs).sort(byClauseRef).map((c) => c.ref)) === '["A.5.2","A.5.10","A.8.1"]'
      && soaClauses([{ ref: '4.1' }]).length === 1
      && soaLine(null).applicable === 'Not assessed' && soaLine({ result: 'NotApplicable', justification: 'No cloud' }).applicable === 'No'
      && soaLine({ result: 'Partial', justification: 'x' }).status === 'Partially implemented'
      && summarise([{ result: 'Missing' }, { result: null }]).NotAssessed === 1,
    'soaClauses / soaLine / summarise');
  v.record('engagement-s10:an interested party says what it requires, and only accepted entries count',
    checkEntry({ kind: 'InterestedParty', origin: 'External', title: 'The regulator', source: 'Licence', relevance: 'High' }).code === 'REQUIREMENTS_REQUIRED'
      && checkEntry({ kind: 'Issue', origin: 'Internal', title: 'Cloud migration', source: 'Strategy', relevance: 'High' }).ok
      && JSON.stringify(registerCounts([{ kind: 'Issue', status: 'Accepted' }, { kind: 'InterestedParty', status: 'Proposed' }, { kind: 'InterestedParty', status: 'Rejected' }]))
        === '{"issues":1,"interestedParties":0,"proposed":1}',
    'checkEntry / registerCounts');
}

// ── Every route has a caller; the guide quotes labels that are on screen ────
{
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const assessment = src('pages', 'grc', 'project', 'EngagementAssessment.tsx');
  const context = src('pages', 'grc', 'project', 'EngagementContext.tsx');
  const reports = src('pages', 'grc', 'project', 'ProjectReports.tsx');
  const host = src('pages', 'grc', 'DeliveryProjects.tsx');
  const callers = {
    'assessment: read, assess': assessment.includes('apiClient.get(base, { params') && assessment.includes('apiClient.post(base, { tenantId, clauseId'),
    'context: read, add, decide': context.includes('apiClient.get(base)') && context.includes('apiClient.post(base, { ...v') && context.includes('`${base}/${entry.id}/decide`'),
    'the SoA on the Reports tab': reports.includes("kind: 'soa'"),
    'mounted': host.includes('<EngagementAssessment') && host.includes('<EngagementContext'),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s10:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const guide = src('data', 'userGuideData.ts').replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '?${name}'?: \\{`))[1] || '').split(/\n  \},\n/)[0];
  const screens = [assessment, context, reports, host].join('\n');
  const needed = ['Assessment', 'Assess', 'Conformant', 'Partial', 'Missing', 'Not applicable', 'Statement of Applicability', 'Issue',
    'Context', 'Record an entry', 'Issue (4.1)', 'Interested party (4.2)', 'Propose an entry', 'Accept', 'Reject', 'Proposed, not counted'];
  const quoted = [...section('project-delivery').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const absent = needed.filter((l) => quoted.includes(l) && !screens.includes(l));
  v.record('engagement-s10:the guide describes the assessment, the SoA and the context register with labels on screen',
    needed.every((l) => quoted.includes(l)) && absent.length === 0,
    `not quoted: ${needed.filter((l) => !quoted.includes(l)).join(', ') || 'none'}; on no screen: ${absent.join(', ') || 'none'}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me'); // PM and owner
  const admin = await q.login('company.admin@omniops.me');
  const riskManager = await q.login('risk.manager@omniops.me');
  const auditor = await q.login('internal.audit@omniops.me');
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const reviewer = await q.login('risk@grcconsulting.com');
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const c = as(client);
  const me = client.user.id;
  const omni = await prisma.tenant.findFirst({ where: { name: 'OmniOps' }, select: { id: true } });
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const iso = await prisma.standard.findFirst({ where: { code: 'ISO27001' }, select: { id: true } });
  const other = await prisma.standard.findFirst({ where: { code: { not: 'ISO27001' } }, select: { id: true } });
  const memberOf = (pid, who) => prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: who.user.id } } });
  const clause = (ref) => prisma.standardClause.findFirst({ where: { standardId: iso.id, ref }, select: { id: true, ref: true } });

  const p = (await c('POST', '/api/projects', {
    name: `S10 ISO 27001 ${stamp}`, startDate: day(0), targetEndDate: day(90), ownerId: me, managerId: me, projectType: 'Certification', standardIds: [iso.id],
  })).json?.project;
  const pid = p.id;
  await c('POST', `/api/projects/${pid}/phases`, { name: 'Gap assessment', startDate: day(0), targetEndDate: day(40), ownerId: me });
  await c('POST', `/api/projects/${pid}/activate`, {});
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
  const draftScope = await prisma.engagementScopeVersion.findFirst({ where: { projectId: pid, status: 'Draft' } });
  await as(admin)('POST', `/api/engagements/${pid}/scope/${draftScope.id}/approve`);
  const A = `/api/engagements/${pid}/assessment`;

  // ── Assessing the clauses the scope names ────────────────────────────────
  const a515 = await clause('A.5.15'); // access control: the gap
  const a516 = await clause('A.5.16'); // identity management: conformant
  const a523 = await clause('A.5.23'); // cloud services: not applicable
  const view = (await as(consultant)('GET', A)).json;
  const byReviewer = await as(reviewer)('POST', A, { tenantId: omni.id, clauseId: a515.id, result: 'Conformant', justification: 'Looks fine to us' });
  const otherEntity = await as(consultant)('POST', A, { tenantId: gcp.id, clauseId: a515.id, result: 'Conformant', justification: 'Our own firm is fine' });
  const otherClause = other ? await prisma.standardClause.findFirst({ where: { standardId: other.id }, select: { id: true } }) : null;
  const otherFramework = otherClause ? await as(consultant)('POST', A, { tenantId: omni.id, clauseId: otherClause.id, result: 'Conformant', justification: 'Outside the scope' }) : { status: 404 };
  const noWhy = await as(consultant)('POST', A, { tenantId: omni.id, clauseId: a523.id, result: 'NotApplicable', justification: 'n/a' });
  const missing = await as(consultant)('POST', A, { tenantId: omni.id, clauseId: a515.id, result: 'Missing', justification: 'No access control policy and no access rules exist.', gapType: 'Implementation' });
  const na = await as(consultant)('POST', A, { tenantId: omni.id, clauseId: a523.id, result: 'NotApplicable', justification: 'OmniOps uses no cloud services; every system is hosted on premises.' });
  const ok = await as(client)('POST', A, { tenantId: omni.id, clauseId: a516.id, result: 'Conformant', justification: 'Identities are managed in one directory with a joiner and leaver process.' });
  const gapId = missing.json?.assessment?.gap?.id;
  const gap = gapId ? await prisma.issue.findUnique({ where: { id: gapId }, select: { ref: true, source: true, tenantId: true, projectId: true, clauseId: true, gapType: true, status: true, raisedById: true } }) : null;
  v.record('engagement-s10:the firm\'s Lead and Consultants, or the organisation, assess the scope\'s clauses for its entities, with a reason; a gap is raised in the organisation\'s register',
    view?.clauses?.length > 0 && view.can?.assess === true && byReviewer.status === 403 && byReviewer.json?.code === 'ENGAGEMENT_ROLE'
      && otherEntity.status === 404 && otherFramework.status === 404 && noWhy.status === 400
      && missing.status === 201 && na.status === 201 && ok.status === 201
      && gap?.source === 'ConsultingGap' && /^GAP-\d{4}-/.test(gap.ref) && gap.tenantId === omni.id && gap.projectId === pid && gap.clauseId === a515.id
      && gap.gapType === 'Implementation' && gap.raisedById === consultant.user.id
      && (await prisma.notification.count({ where: { recipientId: me, subjectId: gapId, event: 'ENGAGEMENT_GAP_RAISED' } })) === 1
      && (await prisma.auditLog.count({ where: { action: 'ENGAGEMENT_CLAUSE_ASSESSED', tenantId: { in: [omni.id, gcp.id] } } })) >= 6,
    `view ${view?.clauses?.length}; reviewer ${byReviewer.status}; other entity ${otherEntity.status}; other framework ${otherFramework.status}; no why ${noWhy.status}; `
      + `missing ${missing.status} ${missing.json?.message || ''}; gap ${JSON.stringify(gap)}`);

  // ── Reassessing keeps history and never closes the gap ───────────────────
  const partial = await as(consultant)('POST', A, { tenantId: omni.id, clauseId: a515.id, result: 'Partial', justification: 'A policy is drafted; rules are not yet applied.', gapType: 'Implementation' });
  const conformant = await as(consultant)('POST', A, { tenantId: omni.id, clauseId: a515.id, result: 'Conformant', justification: 'Access rules applied and reviewed for every system.' });
  const history = await prisma.clauseAssessment.findMany({ where: { projectId: pid, tenantId: omni.id, clauseId: a515.id }, select: { result: true, supersededAt: true, issueId: true } });
  const stillOpen = await prisma.issue.findUnique({ where: { id: gapId }, select: { status: true } });
  const row515 = ((await as(client)('GET', A)).json?.clauses || []).find((x) => x.ref === 'A.5.15');
  v.record('engagement-s10:reassessing keeps the history and the same gap; it never closes it',
    partial.status === 201 && partial.json?.assessment?.gap?.id === gapId && partial.json?.assessment?.gap?.raised === false
      && conformant.status === 201 && history.length === 3 && history.filter((h) => !h.supersededAt).length === 1
      && stillOpen.status === 'Open' && row515?.result === 'Conformant' && row515?.gap?.id === gapId && row515?.times === 3
      && (await prisma.issue.count({ where: { projectId: pid, source: 'ConsultingGap' } })) === 1,
    `partial ${partial.status} ${JSON.stringify(partial.json?.assessment?.gap)}; history ${history.length}; gap ${stillOpen?.status}; row ${JSON.stringify(row515 && { r: row515.result, t: row515.times })}`);

  // ── The organisation answers and closes the gap under its own rule ───────
  const I = (who, step, body) => as(who)('POST', `/api/grc/issues/${gapId}/${step}`, body);
  const firmResponds = await I(consultant, 'respond', { responseType: 'Agree', responseNarrative: 'We raised it.' });
  const responded = await I(riskManager, 'respond', { responseType: 'Agree', responseNarrative: 'Agreed: access rules were never written down.', managementActionPlan: 'Write and apply access rules.' });
  const capped = await I(client, 'cap', { capOwnerId: me, capDueDate: day(30), capDescription: 'Write and apply the access rules.' });
  const submitted = await I(client, 'submit-closure', { evidenceNote: 'Access rules approved; applied to all systems; review records attached.' });
  const ownerCloses = await I(client, 'close', { note: 'Closing my own corrective action.' });
  const closed = await I(auditor, 'close', { note: 'Re-tested five systems; access rules are applied.' });
  // A new failure after the gap is closed is a new gap.
  await as(consultant)('POST', A, { tenantId: omni.id, clauseId: a515.id, result: 'Conformant', justification: 'Access rules applied and reviewed for every system.' });
  const reopenedGap = await as(consultant)('POST', A, { tenantId: omni.id, clauseId: a515.id, result: 'Partial', justification: 'Two new systems have no access rules.', gapType: 'Implementation' });
  v.record('engagement-s10:the organisation answers the gap and someone independent closes it; only then is a new gap raised for the clause',
    firmResponds.status >= 400 && responded.status === 200 && capped.status === 200 && submitted.status === 200
      && ownerCloses.status === 403 && closed.status === 200
      && reopenedGap.status === 201 && reopenedGap.json?.assessment?.gap?.raised === true && reopenedGap.json?.assessment?.gap?.id !== gapId,
    `firm responds ${firmResponds.status}; respond ${responded.status} ${responded.json?.message || ''}; cap ${capped.status} ${capped.json?.message || ''}; `
      + `submit ${submitted.status} ${submitted.json?.message || ''}; owner closes ${ownerCloses.status}; close ${closed.status} ${closed.json?.message || ''}; new gap ${JSON.stringify(reopenedGap.json?.assessment?.gap)}`);

  // ── The Statement of Applicability, issued ───────────────────────────────
  const soa = await fetch(`${q.API}/api/projects/${pid}/reports/soa?format=xlsx&issue=true`, { headers: { Authorization: `Bearer ${client.token}` } });
  const buf = Buffer.from(await soa.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  let cells = [];
  try {
    await wb.xlsx.load(buf);
    wb.eachSheet((ws) => ws.eachRow((r) => { cells.push(r.values.slice(1).map((x) => String(x ?? '')).join(' | ')); }));
  } catch { cells = []; }
  const line = (ref) => cells.find((x) => x.startsWith(`${ref} |`)) || '';
  const register = await prisma.reportIssue.findMany({ where: { projectId: pid, reportKey: 'delivery-soa', issued: true }, select: { issueNumber: true, documentRef: true } });
  const again = await fetch(`${q.API}/api/projects/${pid}/reports/soa?format=pdf&issue=true`, { headers: { Authorization: `Bearer ${client.token}` } });
  const numbers = (await prisma.reportIssue.findMany({ where: { projectId: pid, reportKey: 'delivery-soa', issued: true }, select: { issueNumber: true } })).map((r) => r.issueNumber).sort();
  v.record('engagement-s10:the Statement of Applicability is issued on demo data with a number, read off the current assessments',
    soa.status === 200 && register.length === 1 && register[0].issueNumber === 1
      && line('A.5.15').includes('Partially implemented') && line('A.5.15').includes('GAP-')
      && line('A.5.23').includes('| No |') && line('A.5.23').includes('uses no cloud services')
      && line('A.5.16').includes('| Yes | Implemented |') && cells.some((x) => x.includes('Not assessed'))
      && again.status === 200 && JSON.stringify(numbers) === '[1,2]',
    `soa ${soa.status}; register ${JSON.stringify(register)}; A.5.15 "${line('A.5.15').slice(0, 140)}"; A.5.23 "${line('A.5.23').slice(0, 140)}"; numbers ${JSON.stringify(numbers)}`);

  // ── The context register ─────────────────────────────────────────────────
  const X = `/api/engagements/${pid}/context`;
  const noRequirements = await as(consultant)('POST', X, { tenantId: omni.id, kind: 'InterestedParty', origin: 'External', title: 'Saudi Central Bank', source: 'Licence conditions', relevance: 'High' });
  const proposed = await as(consultant)('POST', X, {
    tenantId: omni.id, kind: 'InterestedParty', origin: 'External', title: 'Saudi Central Bank', source: 'Licence conditions', relevance: 'High',
    requirements: 'Report material incidents within 24 hours; keep data in the Kingdom.',
  });
  const toReject = await as(lead)('POST', X, { tenantId: omni.id, kind: 'Issue', origin: 'Internal', title: 'Staff turnover in IT', source: 'HR figures', relevance: 'Low' });
  const recorded = await as(client)('POST', X, { tenantId: omni.id, kind: 'Issue', origin: 'External', title: 'Move to cloud hosting', source: 'Board strategy 2027', relevance: 'High' });
  const before = (await as(client)('GET', X)).json;
  const firmView = (await as(consultant)('GET', X)).json;
  const firmDecides = await as(lead)('POST', `${X}/${proposed.json?.entry?.id}/decide`, { decision: 'Accepted' });
  const accepted = await as(client)('POST', `${X}/${proposed.json?.entry?.id}/decide`, { decision: 'Accepted' });
  const rejectNoWhy = await as(client)('POST', `${X}/${toReject.json?.entry?.id}/decide`, { decision: 'Rejected' });
  const rejected = await as(client)('POST', `${X}/${toReject.json?.entry?.id}/decide`, { decision: 'Rejected', note: 'Turnover is tracked by HR, not the ISMS.' });
  const after = (await as(client)('GET', X)).json;
  const firmAfter = (await as(consultant)('GET', X)).json;
  v.record('engagement-s10:a context entry the firm proposes counts only once the organisation accepts it; the firm sees only its own proposals',
    noRequirements.status === 400 && proposed.status === 201 && proposed.json?.entry?.status === 'Proposed' && recorded.json?.entry?.status === 'Accepted'
      && before.counts.interestedParties === 0 && before.counts.issues === 1 && before.counts.proposed === 2
      && firmView.entries.length === 2 && !firmView.entries.some((x) => x.id === recorded.json?.entry?.id)
      && firmDecides.status === 403 && accepted.status === 200 && rejectNoWhy.status === 400 && rejected.status === 200
      && after.counts.interestedParties === 1 && after.counts.issues === 1 && after.counts.proposed === 0
      && firmAfter.entries.find((x) => x.id === toReject.json?.entry?.id)?.decisionNote === 'Turnover is tracked by HR, not the ISMS.'
      && (await prisma.notification.count({ where: { recipientId: lead.user.id, event: 'ENGAGEMENT_CONTEXT_DECIDED' } })) === 1,
    `no req ${noRequirements.status}; proposed ${proposed.status}; before ${JSON.stringify(before?.counts)}; firm sees ${firmView?.entries?.length}; firm decides ${firmDecides.status}; `
      + `accepted ${accepted.status}; reject ${rejectNoWhy.status}/${rejected.status}; after ${JSON.stringify(after?.counts)}`);

  await prisma.$disconnect();
  v.finish(`${p.ref}: ${gap?.ref} closed independently, SoA issued twice, one proposal accepted and one rejected`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
