/**
 * Consulting engagement, sprint 9: threads, document review and suggestions.
 *
 * Here, with the seeded pilot (OmniOps and GRC Consulting Partners):
 *
 *   - a firm-internal thread never reaches anyone at the organisation: not in
 *     its list, not by id, not as a notification, not on its audit trail;
 *     a client-internal one never reaches the firm; who reads a thread is
 *     chosen when it starts and nothing widens it;
 *   - posts are never edited; a retraction keeps the words; a Decision is
 *     recorded only in a thread both sides read, by the project manager or
 *     owner or the firm's Lead; only people who can read a thread are named;
 *   - a thread on a shared record needs the scope to share it; a thread
 *     becomes a task (or a request) through the usual route and is linked;
 *     it becomes a gap through the assessment, by whoever may assess, and
 *     only one of this engagement's gaps;
 *   - the firm's Lead and Reviewers review a shared document, with comments
 *     anchored to words really in it or to a page;
 *   - a suggestion on a published policy becomes its next draft: started
 *     from the suggestion, its wording taken into the draft with the firm's
 *     author recorded as an editor, a second one added to the open version,
 *     one declined with its reason, and on publish both "Accepted into
 *     v1.1"; one made on v1.0 still counts after v1.1, and says so;
 *   - on hold the firm reads its threads and writes nothing;
 *   - every route has a caller on a screen, and the guide quotes its labels.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s9-threads-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const {
  checkThreadStart, decisionRefusal, retractRefusal, checkMentions, visibilitiesFor,
} = require('../../dist/services/engagementDiscussions');
const {
  checkReview, checkSuggestion, applyWording, suggestionOutcome,
} = require('../../dist/services/engagementDocumentReviews');

const v = q.verdicts('engagement-s9');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);

// ── The rules, without a database ───────────────────────────────────────────
{
  const start = (side, visibility, kind = 'Comment') => checkThreadStart({ side, visibility, subjectType: 'Engagement', title: 'Scope of A.8', body: 'Is A.8.12 in?', kind });
  v.record('engagement-s9:each side starts threads only the readers it is allowed; a Decision only both sides read, by the PM, owner or Lead',
    start('Client', 'Engagement').ok && start('Client', 'ClientInternal').ok && start('Client', 'FirmInternal').code === 'NOT_YOUR_SIDE'
      && start('Provider', 'FirmInternal').ok && start('Provider', 'ClientInternal').code === 'NOT_YOUR_SIDE'
      && JSON.stringify(visibilitiesFor('Provider')) === '["Engagement","FirmInternal"]'
      && decisionRefusal({ visibility: 'FirmInternal', side: 'Provider', clientManager: false, firmRole: 'Lead' })?.code === 'DECISION_ENGAGEMENT_ONLY'
      && decisionRefusal({ visibility: 'Engagement', side: 'Provider', clientManager: false, firmRole: 'Consultant' })?.code === 'DECISION_BY_LEAD'
      && decisionRefusal({ visibility: 'Engagement', side: 'Client', clientManager: false, firmRole: null })?.code === 'DECISION_BY_MANAGER'
      && decisionRefusal({ visibility: 'Engagement', side: 'Client', clientManager: true, firmRole: null }) === null,
    'checkThreadStart / decisionRefusal');
  v.record('engagement-s9:a retraction is by the author, once, with a reason; only readers are named',
    retractRefusal({ authorId: 'a', retractedAt: null }, 'b', 'wrong thread')?.code === 'NOT_AUTHOR'
      && retractRefusal({ authorId: 'a', retractedAt: new Date() }, 'a', 'wrong thread')?.code === 'ALREADY_RETRACTED'
      && retractRefusal({ authorId: 'a', retractedAt: null }, 'a', '') ?.code === 'REASON_REQUIRED'
      && retractRefusal({ authorId: 'a', retractedAt: null }, 'a', 'wrong thread') === null
      && checkMentions(['x'], new Set(['y'])).code === 'CANNOT_SEE_THREAD' && checkMentions(['y', 'y'], new Set(['y'])).ids.length === 1,
    'retractRefusal / checkMentions');
  const text = 'Access is reviewed every quarter.\nLeavers lose access on their last day.';
  v.record('engagement-s9:a review comment quotes words really in the version or names a page; a suggestion\'s words to replace are really there',
    checkReview({ outcome: 'Accepted', note: '', comments: [], content: text }).ok
      && checkReview({ outcome: 'ChangesRequested', note: 'short', comments: [], content: text }).code === 'NOTE_REQUIRED'
      && checkReview({ outcome: 'Accepted', note: '', comments: [{ body: 'x' }], content: text }).code === 'ANCHOR_REQUIRED'
      && checkReview({ outcome: 'Accepted', note: '', comments: [{ quote: 'every month', body: 'x' }], content: text }).code === 'QUOTE_NOT_FOUND'
      && checkReview({ outcome: 'Accepted', note: '', comments: [{ page: 3, body: 'x' }], content: null }).ok
      && checkSuggestion({ section: 'Reviews', currentWording: 'every month', proposedWording: 'monthly', reason: 'Privileged access needs more', content: text }).code === 'WORDING_NOT_FOUND'
      && checkSuggestion({ section: 'Reviews', currentWording: 'every quarter', proposedWording: 'every quarter by the system owner', reason: 'Name who reviews', content: text }).ok,
    'checkReview / checkSuggestion');
  v.record('engagement-s9:wording goes into a draft only where the words it replaces appear exactly once; outcomes say what happened',
    applyWording(text, 'every quarter', 'every month').text.includes('every month')
      && applyWording(text, 'ccess', 'x').code === 'AMBIGUOUS' && applyWording(text, 'yearly', 'x').code === 'NOT_IN_DRAFT'
      && applyWording(text, null, 'x').code === 'NOTHING_TO_REPLACE'
      && suggestionOutcome({ status: 'Accepted', acceptedInto: '1.1', decisionReason: null, versionNumber: null }) === 'Accepted into v1.1'
      && suggestionOutcome({ status: 'Declined', acceptedInto: null, decisionReason: 'Out of scope', versionNumber: null }) === 'Declined: Out of scope',
    'applyWording / suggestionOutcome');
}

// ── Every route has a caller; the guide quotes labels that are on screen ────
{
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const threads = src('pages', 'grc', 'project', 'EngagementDiscussions.tsx');
  const panel = src('pages', 'grc', 'project', 'DocumentReviewPanel.tsx');
  const docs = src('pages', 'grc', 'project', 'EngagementDocuments.tsx');
  const host = src('pages', 'grc', 'DeliveryProjects.tsx');
  const callers = {
    'threads: list, subjects, start': /apiClient\.get\(base, \{ params/.test(threads) && threads.includes('`${base}/subjects`') && /apiClient\.post\(base, \{ \.\.\.v/.test(threads),
    'a thread: read, post, retract, status, convert': threads.includes('apiClient.get(url)') && ['posts`', 'retract`', 'status`', 'convert`'].every((x) => threads.includes(x)),
    'a thread becomes a gap: assess the clause, then convert': threads.includes('`/api/engagements/${projectId}/assessment`')
      && threads.includes("{ type: 'Gap', id: made.gap.id }"),
    'reviews and suggestions': panel.includes('/documents/${documentId}/reviews`') && panel.includes('/documents/${documentId}/suggestions`')
      && ['pull`', 'apply`', 'decide`'].every((x) => panel.includes(`/suggestions/\${s.id}/${x}`) || panel.includes(`/suggestions/\${deciding.s.id}/${x}`)),
    'mounted': host.includes('<EngagementDiscussions') && docs.includes('<DocumentReviewPanel'),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s9:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const ctrl = q.read(path.join(q.API_SRC, 'controllers', 'engagementDiscussionController.ts'));
  const routes = q.read(path.join(q.API_SRC, 'routes', 'engagementRoutes.ts'));
  v.record('engagement-s9:nothing edits a post or widens a thread: no such route, and no update writes a visibility',
    !/(patch|put)\('\/:projectId\/threads/.test(routes) && !/discussionPost\.update\(\{[^}]*body/.test(ctrl)
      && !/discussionThread\.update(?:Many)?\(\{[^;]*data:[^;]*visibility/.test(ctrl),
    'routes / controller');

  const guide = src('data', 'userGuideData.ts').replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '?${name}'?: \\{`))[1] || '').split(/\n  \},\n/)[0];
  const screens = [threads, panel, docs, host].join('\n');
  const needed = ['Discussions', 'Start a thread', 'Both sides', 'Organisation only', 'Firm only', 'Review note', 'Retract', 'Decision',
    'Convert to a task', 'Convert to a request', 'Convert to a gap', 'Review this version', 'Changes requested', 'Not fit for purpose', 'Add an anchored comment',
    'Suggest wording', 'Start next version from this suggestion', 'Add to the open next version', 'Take the wording into the draft',
    'Accepted into', 'Decline', 'Mark superseded', 'made on'];
  const quoted = [...section('project-delivery').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const absent = needed.filter((l) => quoted.includes(l) && !screens.includes(l));
  v.record('engagement-s9:the guide describes threads, reviews and suggestions with labels on screen',
    needed.every((l) => quoted.includes(l)) && absent.length === 0,
    `not quoted: ${needed.filter((l) => !quoted.includes(l)).join(', ') || 'none'}; on no screen: ${absent.join(', ') || 'none'}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me'); // PM and owner; owns the policy
  const admin = await q.login('company.admin@omniops.me');
  const teamMember = await q.login('risk.manager@omniops.me');
  const signer = await q.login('top.management@omniops.me'); // given a signing role below
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const reviewer = await q.login('risk@grcconsulting.com');
  const outsider = await q.login('presales@grcconsulting.com');
  const pw = q.demoPassword();
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const c = as(client);
  const me = client.user.id;
  const omni = await prisma.tenant.findFirst({ where: { name: 'OmniOps' }, select: { id: true } });
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const iso = await prisma.standard.findFirst({ where: { code: 'ISO27001' }, select: { id: true } });
  const memberOf = (pid, who) => prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: who.user.id } } });
  const trailOf = (tenantId, subjectId) => prisma.auditLog.count({ where: { tenantId, subjectId } });
  const told = (who, subjectId) => prisma.notification.count({ where: { recipientId: who.user.id, subjectId } });

  // ── An engagement, its firm (Lead, Consultant, Reviewer) and its scope ────
  const p = (await c('POST', '/api/projects', {
    name: `S9 ISO 27001 ${stamp}`, startDate: day(0), targetEndDate: day(90), ownerId: me, managerId: me, projectType: 'Certification', standardIds: [iso.id],
  })).json?.project;
  const pid = p.id;
  const ph = (await c('POST', `/api/projects/${pid}/phases`, { name: 'Access control', startDate: day(0), targetEndDate: day(40), ownerId: me })).json?.phase;
  const task = (await c('POST', `/api/projects/phases/${ph.id}/tasks`, { name: 'Recertify access', startDate: day(1), dueDate: day(20), assigneeId: me })).json?.task;
  await c('POST', `/api/projects/${pid}/activate`, {});
  await c('POST', `/api/projects/${pid}/members`, { userId: teamMember.user.id, side: 'Client', roleLabel: 'Risk lead', raci: 'R' });
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

  // A published access policy owned by the project manager, and a Confidential one the scope does not share.
  const policyText = 'Purpose\nAccess is granted on least privilege.\n\nReviews\nAccess is reviewed every quarter.\n\nLeavers\nLeavers lose access on their last day.';
  const publish = async (code, title, classification, content) => {
    const d = await prisma.document.create({
      data: {
        code, title, category: 'Policy', classification, status: 'PUBLISHED', version: '1.0', publishedVersion: '1.0', publishedAt: new Date(),
        audienceKind: 'Everyone', content, tenantId: omni.id, ownerId: me,
      },
    });
    await prisma.documentVersion.create({ data: { documentId: d.id, versionNumber: '1.0', changeType: 'Major', summary: 'Initial', content, createdById: me } });
    return d;
  };
  const policy = await publish(`S9-POL-${stamp}`, 'Access Control Policy', 'Internal', policyText);
  const secret = await publish(`S9-SEC-${stamp}`, 'Privileged Access Standard', 'Confidential', 'Break-glass accounts are sealed.');
  // OmniOps has nobody who signs documents: the executive sponsor gets a signing role for this run.
  const signing = await prisma.role.create({
    data: { tenantId: omni.id, key: `qa-signer-${stamp}`, name: 'QA document signer', portal: 'tenant', capabilityGrants: JSON.stringify(['review-approve-and-digitally-sign-a-document']) },
  });
  await prisma.user.update({ where: { id: signer.user.id }, data: { roleId: signing.id } });

  const T = (who) => (method, rest = '', body) => as(who)(method, `/api/engagements/${pid}/threads${rest}`, body);

  // ── A firm-internal thread never reaches the organisation ────────────────
  const firmOnlyNamed = await T(lead)('POST', '', { visibility: 'FirmInternal', title: 'Our view of A.8', kind: 'Comment', body: 'The client is weak on A.8.12.', mentions: [me] });
  const firmOnly = await T(lead)('POST', '', { visibility: 'FirmInternal', title: 'Our view of A.8', kind: 'Comment', body: 'The client is weak on A.8.12.', mentions: [consultant.user.id] });
  const fid = firmOnly.json?.thread?.id;
  const clientList = (await T(client)('GET')).json?.threads || [];
  const clientById = await T(client)('GET', `/${fid}`);
  const adminById = await T(admin)('GET', `/${fid}`);
  const firmList = (await T(consultant)('GET')).json?.threads || [];
  const orgTrail = await trailOf(omni.id, fid);
  const firmTrail = await trailOf(gcp.id, fid);
  const orgTold = await prisma.notification.count({ where: { subjectId: fid, recipient: { tenantId: omni.id } } });
  const consultantTold = await told(consultant, fid);
  v.record('engagement-s9:a firm-internal post never reaches the organisation: not listed, not by id, not notified, not on its trail; nobody of the organisation can be named in it',
    firmOnlyNamed.status === 400 && firmOnlyNamed.json?.code === 'CANNOT_SEE_THREAD' && firmOnly.status === 201
      && !clientList.some((t) => t.id === fid) && clientById.status === 404 && adminById.status === 404 && firmList.some((t) => t.id === fid)
      && orgTrail === 0 && firmTrail >= 1 && orgTold === 0 && consultantTold === 1,
    `named ${firmOnlyNamed.status} ${firmOnlyNamed.json?.code || ''}; start ${firmOnly.status}; client list ${clientList.some((t) => t.id === fid)}; by id ${clientById.status}/${adminById.status}; `
      + `trail org ${orgTrail} firm ${firmTrail}; told org ${orgTold} consultant ${consultantTold}`);

  const orgOnly = await T(client)('POST', '', { visibility: 'ClientInternal', title: 'Budget for the audit', kind: 'Comment', body: 'Hold the Stage 2 budget.' });
  const oid = orgOnly.json?.thread?.id;
  const firmSeesOrg = await T(lead)('GET', `/${oid}`);
  const firmStartsOrg = await T(lead)('POST', '', { visibility: 'ClientInternal', title: 'Peek', kind: 'Comment', body: 'Let us in' });
  v.record('engagement-s9:a client-internal thread never reaches the firm, and the firm cannot start one',
    orgOnly.status === 201 && firmSeesOrg.status === 404 && !((await T(lead)('GET')).json?.threads || []).some((t) => t.id === oid)
      && (await trailOf(gcp.id, oid)) === 0 && firmStartsOrg.status === 403,
    `start ${orgOnly.status}; firm by id ${firmSeesOrg.status}; firm starts ${firmStartsOrg.status}`);

  // ── An Engagement thread on a task: decisions, mentions, retraction ───────
  const shared = await T(client)('POST', '', {
    visibility: 'Engagement', subjectType: 'Task', subjectId: task.id, title: 'Is the contractor population in scope?', kind: 'Question',
    body: 'Do contractors count for the recertification?', mentions: [teamMember.user.id],
  });
  const sid = shared.json?.thread?.id;
  const P = (who, body) => T(who)('POST', `/${sid}/posts`, body);
  const consultantDecides = await P(consultant, { kind: 'Decision', body: 'Contractors are in scope.' });
  const leadDecides = await P(lead, { kind: 'Decision', body: 'Contractors are in scope from Q3.' });
  const namedOutsider = await P(consultant, { kind: 'Comment', body: 'Asking our presales team', mentions: [outsider.user.id] });
  const reviewerNote = await P(reviewer, { kind: 'ReviewNote', body: 'The Q3 evidence must show contractors.', mentions: [teamMember.user.id] });
  const pmDecides = await P(client, { kind: 'Decision', body: 'Agreed: contractors from Q3.' });
  const thread = (await T(consultant)('GET', `/${sid}`)).json;
  const mine = thread?.posts?.find((x) => x.body === 'The Q3 evidence must show contractors.');
  const othersRetract = await T(lead)('POST', `/${sid}/posts/${mine?.id}/retract`, { reason: 'Not my post to retract' });
  const retracted = await T(reviewer)('POST', `/${sid}/posts/${mine?.id}/retract`, { reason: 'Posted before checking the plan' });
  const twice = await T(reviewer)('POST', `/${sid}/posts/${mine?.id}/retract`, { reason: 'Posted before checking the plan' });
  const after = (await T(client)('GET', `/${sid}`)).json;
  const kept = after?.posts?.find((x) => x.id === mine?.id);
  v.record('engagement-s9:in a thread both sides read, the Lead and the project manager record decisions, others do not; outsiders are not named; a retraction keeps the words',
    shared.status === 201 && consultantDecides.status === 403 && consultantDecides.json?.code === 'DECISION_BY_LEAD' && leadDecides.status === 201
      && namedOutsider.status === 400 && reviewerNote.status === 201 && pmDecides.status === 201
      && thread?.thread?.subjectLabel?.includes('Recertify access') && (await told(teamMember, sid)) >= 2
      && othersRetract.status === 403 && retracted.status === 200 && twice.status === 409
      && kept?.body === 'The Q3 evidence must show contractors.' && kept?.retractedAt && kept?.retractReason === 'Posted before checking the plan'
      && (await prisma.auditLog.count({ where: { subjectId: sid, action: 'ENGAGEMENT_THREAD_DECISION' } })) === 4,
    `start ${shared.status}; consultant ${consultantDecides.status} ${consultantDecides.json?.code || ''}; lead ${leadDecides.status}; outsider ${namedOutsider.status}; reviewer ${reviewerNote.status}; `
      + `pm ${pmDecides.status}; retract other ${othersRetract.status}, own ${retracted.status}, twice ${twice.status}; kept ${JSON.stringify(kept && { b: kept.body, r: kept.retractReason })}`);

  // ── Shared records only; then a task through the usual route ─────────────
  const outsideDoc = await T(lead)('POST', '', { visibility: 'Engagement', subjectType: 'Document', subjectId: secret.id, title: 'The privileged standard', kind: 'Comment', body: 'Can we see it?' });
  const clientOutside = await T(client)('POST', '', { visibility: 'Engagement', subjectType: 'Document', subjectId: secret.id, title: 'The privileged standard', kind: 'Comment', body: 'Shall we share it?' });
  const clientInternalOutside = await T(client)('POST', '', { visibility: 'ClientInternal', subjectType: 'Document', subjectId: secret.id, title: 'Keep it in', kind: 'Comment', body: 'Not for the firm.' });
  const onPolicy = await T(lead)('POST', '', { visibility: 'Engagement', subjectType: 'Document', subjectId: policy.id, title: 'Who reviews access?', kind: 'Question', body: 'The policy does not say who.' });
  const madeTask = (await c('POST', `/api/projects/phases/${ph.id}/tasks`, { name: 'Name the access reviewer', startDate: day(1), dueDate: day(15), assigneeId: me })).json?.task;
  const converted = await T(client)('POST', `/${onPolicy.json?.thread?.id}/convert`, { type: 'Task', id: madeTask?.id });
  const afterConvert = await P(lead, { kind: 'Comment', body: 'unused' });
  const postConverted = await T(lead)('POST', `/${onPolicy.json?.thread?.id}/posts`, { kind: 'Comment', body: 'Still here?' });
  const convertedView = (await T(lead)('GET', `/${onPolicy.json?.thread?.id}`)).json?.thread;
  v.record('engagement-s9:a shared record is discussed with the firm only while the scope shares it; a thread becomes a task through the usual route and is linked to it',
    outsideDoc.status === 404 && clientOutside.status === 404 && clientInternalOutside.status === 201 && onPolicy.status === 201
      && converted.status === 200 && convertedView?.status === 'Converted' && convertedView?.convertedToLabel?.includes('Name the access reviewer')
      && postConverted.status === 409 && postConverted.json?.code === 'CONVERTED' && afterConvert.status === 201,
    `firm outside ${outsideDoc.status}; client shared outside ${clientOutside.status}; client internal ${clientInternalOutside.status}; on policy ${onPolicy.status}; convert ${converted.status} ${converted.json?.message || ''}; post after ${postConverted.status}`);

  // ── A thread becomes a gap through the assessment ────────────────────────
  const gapThread = await T(consultant)('POST', '', { visibility: 'Engagement', title: 'Access reviews leave no record', kind: 'Comment', body: 'Nothing shows the quarterly reviews happened.' });
  const gid = gapThread.json?.thread?.id;
  const offered = async (who) => (await T(who)('GET', `/${gid}`)).json?.can?.convertTo || [];
  const offers = { consultant: await offered(consultant), reviewer: await offered(reviewer), client: await offered(client) };
  const clause = await prisma.standardClause.findFirst({ where: { standardId: iso.id, ref: { startsWith: 'A.5' } }, orderBy: { ref: 'asc' }, select: { id: true } });
  const assessed = await as(consultant)('POST', `/api/engagements/${pid}/assessment`, {
    tenantId: omni.id, clauseId: clause?.id, result: 'Partial', justification: 'Quarterly access reviews are not evidenced.', gapType: 'Evidence',
  });
  const gap = assessed.json?.assessment?.gap;
  const elsewhere = await prisma.issue.findFirst({ where: { tenantId: omni.id, NOT: [{ source: 'ConsultingGap' }] }, select: { id: true } });
  const reviewerToGap = await T(reviewer)('POST', `/${gid}/convert`, { type: 'Gap', id: gap?.id });
  const otherIssue = await T(consultant)('POST', `/${gid}/convert`, { type: 'Gap', id: elsewhere?.id });
  const toGap = await T(consultant)('POST', `/${gid}/convert`, { type: 'Gap', id: gap?.id });
  const gapView = (await T(client)('GET', `/${gid}`)).json?.thread;
  const gapTrail = await prisma.auditLog.count({ where: { subjectId: gid, action: 'ENGAGEMENT_THREAD_CONVERTED' } });
  v.record('engagement-s9:a thread becomes a gap through the assessment and is linked to it; only those who may assess convert, and only to this engagement\'s gaps',
    gapThread.status === 201 && offers.consultant.includes('Gap') && offers.consultant.includes('Request') && !offers.reviewer.includes('Gap')
      && offers.client.includes('Gap') && offers.client.includes('Task')
      && assessed.status === 201 && Boolean(gap?.id) && reviewerToGap.status === 403 && reviewerToGap.json?.code === 'ENGAGEMENT_ROLE'
      && (!elsewhere || otherIssue.status === 404) && toGap.status === 200 && toGap.json?.convertedTo?.type === 'Gap'
      && gapView?.status === 'Converted' && gapView?.convertedToType === 'Gap' && gapView?.convertedToLabel?.startsWith(gap?.ref || '?') && gapTrail === 2,
    `start ${gapThread.status}; offers ${JSON.stringify(offers)}; assess ${assessed.status} gap ${gap?.ref}; reviewer ${reviewerToGap.status} ${reviewerToGap.json?.code || ''}; `
      + `other issue ${otherIssue.status}; convert ${toGap.status} ${toGap.json?.message || ''}; view ${gapView?.status} ${gapView?.convertedToLabel}; trail ${gapTrail}`);

  // ── Document review ──────────────────────────────────────────────────────
  const D = (who, rest, body) => as(who)(body === undefined ? 'GET' : 'POST', `/api/engagements/${pid}/documents/${policy.id}${rest}`, body);
  const review = { outcome: 'ChangesRequested', note: 'Say who reviews access and how often privileged access is reviewed.', comments: [{ quote: 'Access is reviewed every quarter.', body: 'By whom?' }, { page: 1, body: 'No owner named on the cover.' }] };
  const byConsultant = await D(consultant, '/reviews', review);
  const byClient = await D(client, '/reviews', review);
  const badQuote = await D(reviewer, '/reviews', { ...review, comments: [{ quote: 'reviewed monthly', body: 'x' }] });
  const reviewed = await D(reviewer, '/reviews', review);
  const outsideReview = await as(reviewer)('POST', `/api/engagements/${pid}/documents/${secret.id}/reviews`, { outcome: 'Accepted' });
  const seen = (await D(client, '/reviews')).json?.reviews || [];
  v.record('engagement-s9:the firm\'s Lead and Reviewers review a shared version with anchored comments; the organisation sees it and its owner is told',
    byConsultant.status === 403 && byConsultant.json?.code === 'ENGAGEMENT_ROLE' && byClient.status === 403 && badQuote.status === 400 && badQuote.json?.code === 'QUOTE_NOT_FOUND'
      && reviewed.status === 201 && outsideReview.status === 404 && seen.length === 1 && seen[0].outcome === 'ChangesRequested' && seen[0].documentVersion === '1.0'
      && seen[0].comments.length === 2 && (await told(client, policy.id)) >= 1,
    `consultant ${byConsultant.status}; client ${byClient.status}; bad quote ${badQuote.status}; reviewed ${reviewed.status}; outside ${outsideReview.status}; seen ${seen.length}`);

  // ── A suggestion on a published policy becomes its next draft ────────────
  const S = (who, body) => D(who, '/suggestions', body);
  const s1Body = { section: 'Reviews', currentWording: 'Access is reviewed every quarter.', proposedWording: 'Access is reviewed every quarter by the system owner.', reason: 'Name who reviews access.' };
  const reviewerSuggests = await S(reviewer, s1Body);
  const s1 = await S(consultant, s1Body);
  const s2 = await S(lead, { section: 'Reviews', proposedWording: 'Privileged access is reviewed monthly.', reason: 'Privileged access carries more risk.' });
  const s3 = await S(consultant, { section: 'Leavers', currentWording: 'Leavers lose access on their last day.', proposedWording: 'Leavers lose access within one hour of leaving.', reason: 'Tighter than the last day.' });
  const late = await S(consultant, { section: 'Purpose', currentWording: 'Access is granted on least privilege.', proposedWording: 'Access is granted on least privilege and need to know.', reason: 'Add need to know.' });
  const firmPull = await as(lead)('POST', `/api/engagements/${pid}/suggestions/${s1.json?.suggestion?.id}/pull`, {});
  const pulled = await as(client)('POST', `/api/engagements/${pid}/suggestions/${s1.json?.suggestion?.id}/pull`, {});
  const draft = await prisma.document.findUnique({ where: { id: policy.id }, select: { openVersionId: true, status: true, version: true, content: true } });
  const draftRow = draft.openVersionId ? await prisma.documentVersion.findUnique({ where: { id: draft.openVersionId }, select: { versionNumber: true, state: true, startReason: true } }) : null;
  v.record('engagement-s9:a suggestion on a published policy becomes its next draft, started by the organisation with the suggestion as its source',
    reviewerSuggests.status === 403 && s1.status === 201 && s1.json?.suggestion?.ref === 'SUG-0001' && s2.status === 201 && s3.status === 201 && late.status === 201
      && firmPull.status === 403 && pulled.status === 201 && draftRow?.versionNumber === '1.1' && draftRow?.state === 'Draft'
      && draftRow?.startReason?.includes('SUG-0001') && draft.status === 'PUBLISHED' && draft.version === '1.0' && draft.content === policyText,
    `reviewer ${reviewerSuggests.status}; s1 ${s1.status} ${s1.json?.suggestion?.ref}; firm pulls ${firmPull.status}; pulled ${pulled.status} ${pulled.json?.message || ''}; draft ${JSON.stringify(draftRow)}`);

  const applied = await as(client)('POST', `/api/engagements/${pid}/suggestions/${s1.json?.suggestion?.id}/apply`, {});
  const added = await as(client)('POST', `/api/engagements/${pid}/suggestions/${s2.json?.suggestion?.id}/pull`, {});
  const noWords = await as(client)('POST', `/api/engagements/${pid}/suggestions/${s2.json?.suggestion?.id}/apply`, {});
  const declined = await as(client)('POST', `/api/engagements/${pid}/suggestions/${s3.json?.suggestion?.id}/decide`, { outcome: 'Declined', reason: 'The HR system cannot do it within an hour yet.' });
  const vrow = await prisma.documentVersion.findUnique({ where: { id: draft.openVersionId }, select: { content: true, editors: { select: { userId: true, via: true } } } });
  const firmView = (await S(consultant)).json?.suggestions || [];
  v.record('engagement-s9:the wording is taken into the draft with the firm\'s author recorded as an editor; a second suggestion joins the open version; one is declined with its reason',
    applied.status === 200 && vrow.content.includes('Access is reviewed every quarter by the system owner.')
      && vrow.editors.some((e) => e.userId === consultant.user.id && e.via === 'SUGGESTION')
      && added.status === 200 && noWords.status === 409 && noWords.json?.code === 'NOTHING_TO_REPLACE' && declined.status === 200
      && firmView.find((x) => x.ref === 'SUG-0003')?.outcome === 'Declined: The HR system cannot do it within an hour yet.'
      && firmView.find((x) => x.ref === 'SUG-0002')?.outcome === 'In the next version (v1.1)',
    `apply ${applied.status} ${applied.json?.message || ''}; add ${added.status}; no words ${noWords.status}; decline ${declined.status}; editors ${JSON.stringify(vrow.editors)}`);

  // Approved by someone who signs and wrote none of it, then published.
  const N = `/api/documents/${policy.id}/next-version`;
  const submitted = await c('POST', `${N}/submit`, { summary: 'System owners review access; privileged access monthly', approverIds: [signer.user.id] });
  const signed = await as(signer)('POST', `/api/documents/${policy.id}/approve`, { password: pw });
  const published = await as(signer)('POST', `${N}/publish`, {});
  const outcomes = (await S(consultant)).json?.suggestions || [];
  const lateRow = outcomes.find((x) => x.ref === 'SUG-0004');
  v.record('engagement-s9:on publish the pulled suggestions read "Accepted into v1.1" and their authors are told; one made on v1.0 still counts and says so',
    submitted.status === 200 && signed.status === 200 && published.status === 200
      && outcomes.find((x) => x.ref === 'SUG-0001')?.outcome === 'Accepted into v1.1' && outcomes.find((x) => x.ref === 'SUG-0002')?.outcome === 'Accepted into v1.1'
      && (await prisma.notification.count({ where: { recipientId: consultant.user.id, event: 'ENGAGEMENT_SUGGESTION_ACCEPTED' } })) === 1
      && lateRow?.status === 'Open' && lateRow?.madeOnEarlier === true && lateRow?.documentVersion === '1.0',
    `submit ${submitted.status} ${submitted.json?.message || ''}; sign ${signed.status} ${signed.json?.message || ''}; publish ${published.status} ${published.json?.message || ''}; `
      + `outcomes ${JSON.stringify(outcomes.map((x) => [x.ref, x.outcome, x.madeOnEarlier]))}`);

  const latePull = await as(client)('POST', `/api/engagements/${pid}/suggestions/${late.json?.suggestion?.id}/pull`, {});
  const lateApply = await as(client)('POST', `/api/engagements/${pid}/suggestions/${late.json?.suggestion?.id}/apply`, {});
  const v12 = await prisma.document.findUnique({ where: { id: policy.id }, select: { openVersionId: true } });
  const v12row = v12.openVersionId ? await prisma.documentVersion.findUnique({ where: { id: v12.openVersionId }, select: { versionNumber: true, content: true } }) : null;
  const superseded = await as(client)('POST', `/api/engagements/${pid}/suggestions/${late.json?.suggestion?.id}/decide`, { outcome: 'Superseded', reason: 'Need to know is now in the Purpose section.' });
  v.record('engagement-s9:a late suggestion is pulled into the next draft after v1.1, and can be marked superseded with a reason',
    latePull.status === 201 && v12row?.versionNumber === '1.2' && lateApply.status === 200 && v12row?.content?.includes('least privilege and need to know')
      && superseded.status === 200 && ((await S(consultant)).json?.suggestions || []).find((x) => x.ref === 'SUG-0004')?.status === 'Superseded',
    `late pull ${latePull.status} ${latePull.json?.message || ''}; apply ${lateApply.status}; v1.2 ${v12row?.versionNumber}; superseded ${superseded.status}`);

  // ── On hold the firm reads and writes nothing ────────────────────────────
  const held = await c('PATCH', `/api/projects/${pid}`, { status: 'OnHold', reason: 'Budget review before Stage 2 planning', holdFirmAccess: 'View' });
  const reads = await T(lead)('GET', `/${sid}`);
  const writes = await P(lead, { kind: 'Comment', body: 'While on hold' });
  const suggestsOnHold = await S(consultant, { section: 'Purpose', proposedWording: 'x y z', reason: 'While the project is on hold' });
  v.record('engagement-s9:on hold the firm reads its threads and writes nothing',
    held.status === 200 && reads.status === 200 && writes.status === 403 && writes.json?.code === 'ON_HOLD_READ_ONLY' && suggestsOnHold.status === 403,
    `hold ${held.status} ${held.json?.message || ''}; read ${reads.status}; write ${writes.status} ${writes.json?.code || ''}; suggest ${suggestsOnHold.status}`);

  await prisma.$disconnect();
  v.finish(`${p.ref}: ${shared.json?.thread?.ref} decided, ${policy.code} v1.1 published from SUG-0001 and SUG-0002`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
