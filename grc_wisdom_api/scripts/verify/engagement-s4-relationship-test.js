/**
 * Consulting engagement, sprint 4: relationship, invitation, the firm's people
 * and the delivery style, behind the "Consulting Engagements" flag.
 *
 * Here, with the seeded pilot (OmniOps and GRC Consulting Partners switched on,
 * RetailCo's firm not):
 *
 *   - the flag is read on the server: an organisation's override, else the
 *     platform status; a firm without it cannot be invited, and switching it
 *     off stops invitations without taking back a relationship or access;
 *   - a firm is invited to its organisation, once, for 14 days; before it
 *     accepts it sees the invitation only, never the engagement; an expired
 *     invitation cannot be accepted and stays on record, and re-inviting makes
 *     a new one; the relationship is made at the first acceptance, once;
 *   - the firm's Lead nominates two people; the organisation approves one and
 *     turns down the other; an unapproved nominee has no access;
 *   - roles hold: a Reviewer changes nothing, only the Lead submits, and
 *     verifying stays with the organisation's own people;
 *   - only the organisation changes the delivery style, and acceptance,
 *     approvals and the style change are on both organisations' trails;
 *   - naming a firm directly is refused when both run consulting, and the
 *     New engagement dropdown lists only firms with a relationship;
 *   - every route has a caller on a screen.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s4-relationship-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const { flagOnFor } = require('../../dist/services/featureFlags');
const { invitationState, roleMay } = require('../../dist/services/engagementRules');

const v = q.verdicts('engagement-s4');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);
const FLAG = 'Consulting Engagements';

// ── The rules, without a database ───────────────────────────────────────────
{
  const past = new Date(Date.now() - DAY);
  v.record('engagement-s4:a flag is the organisation\'s override, else the platform status',
    flagOnFor({ status: 'Disabled', expiryDate: null }, { enabled: true }) === true
      && flagOnFor({ status: 'Enabled', expiryDate: null }, { enabled: false }) === false
      && flagOnFor({ status: 'Enabled', expiryDate: null }, null) === true
      && flagOnFor({ status: 'Enabled', expiryDate: past }, null) === false
      && flagOnFor({ status: 'Pilot', expiryDate: null }, null) === false
      && flagOnFor(null, { enabled: true }) === false,
    'flagOnFor');
  v.record('engagement-s4:roles: the Lead does all, a Consultant works, a Reviewer only reads',
    ['read', 'work', 'submit', 'sequence', 'nominate'].every((a) => roleMay('Lead', a))
      && roleMay('Consultant', 'work') && !roleMay('Consultant', 'submit') && !roleMay('Consultant', 'nominate')
      && roleMay('Reviewer', 'read') && !roleMay('Reviewer', 'work') && !roleMay(null, 'read')
      && invitationState({ status: 'Pending', expiresAt: past }) === 'Expired',
    'roleMay / invitationState');
}

// ── Every route has a caller ────────────────────────────────────────────────
{
  const dir = path.join(q.WEB_SRC, 'pages', 'grc', 'project');
  const panel = q.read(path.join(dir, 'EngagementPanel.tsx'));
  const inbox = q.read(path.join(dir, 'InvitationsInbox.tsx'));
  const team = q.read(path.join(dir, 'ProjectTeam.tsx'));
  const host = q.read(path.join(q.WEB_SRC, 'pages', 'grc', 'DeliveryProjects.tsx'));
  const newProject = q.read(path.join(dir, 'NewProject.tsx'));
  const callers = {
    'GET /api/engagements/feature': /apiClient\.get\('\/api\/engagements\/feature'\)/.test(panel + host + team + newProject),
    'GET /api/engagements/invitations': /fetchAllPages<Row>\('\/api\/engagements\/invitations', 'invitations', \{ box: 'received' \}\)/.test(inbox),
    'POST /api/engagements/invitations': /apiClient\.post\('\/api\/engagements\/invitations', \{/.test(panel) && /\/api\/engagements\/invitations', \{/.test(newProject),
    'POST .../revoke': /\/api\/engagements\/invitations\/\$\{dialog\.inv\.id\}\/revoke/.test(panel),
    'POST .../accept and .../decline': /\/api\/engagements\/invitations\/\$\{row\.id\}\/\$\{kind\}/.test(inbox),
    'GET /api/engagements/:projectId': /apiClient\.get\(`\/api\/engagements\/\$\{projectId\}`\)/.test(panel),
    'POST .../nominations': /\/api\/engagements\/\$\{projectId\}\/nominations/.test(panel),
    'POST .../approve, reject, remove': ['approve', 'reject', 'remove'].every((a) => panel.includes(`/members/\${dialog.m.id}/${a}`)),
    'PATCH .../delivery-style': /apiClient\.patch\(`\/api\/engagements\/\$\{projectId\}\/delivery-style`/.test(panel),
    'the panel on the Team tab': /<EngagementPanel\b/.test(team),
    'the Invitations tab': /<InvitationsInbox\b/.test(host),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s4:every consulting route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me');
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const reviewer = await q.login('risk@grcconsulting.com');
  const turnedDown = await q.login('presales@grcconsulting.com');
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const c = as(client);
  const me = client.user.id;
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const retail = await prisma.tenant.findFirst({ where: { name: 'RetailCo Franchise Network' }, select: { id: true } });
  const omni = await prisma.tenant.findFirst({ where: { name: 'OmniOps' }, select: { id: true } });

  const engagement = async (name) => (await c('POST', '/api/projects', {
    name: `${name} ${stamp}`, startDate: day(5), targetEndDate: day(90), ownerId: me, managerId: me, projectType: 'Certification',
  })).json?.project;

  // ── The flag decides who can be invited ──────────────────────────────────
  const p = await engagement('S4 ISO 27001');
  const toRetail = await c('POST', '/api/engagements/invitations', { projectId: p.id, firmTenantId: retail.id });
  const direct = await c('POST', '/api/projects', {
    name: `S4 named directly ${stamp}`, startDate: day(5), targetEndDate: day(90), ownerId: me, managerId: me, providerTenantId: gcp.id,
  });
  const invitable = (await c('GET', '/api/projects/engageable-providers?purpose=invite')).json?.providers || [];
  const dropdownBefore = (await c('GET', '/api/projects/engageable-providers')).json?.providers || [];
  v.record('engagement-s4:only a firm with consulting switched on can be invited, and never named directly',
    toRetail.status === 403 && toRetail.json?.code === 'FEATURE_OFF' && direct.status === 409 && direct.json?.code === 'USE_INVITATION'
      && invitable.some((f) => f.id === gcp.id) && !invitable.some((f) => f.id === retail.id)
      && !dropdownBefore.some((f) => f.id === gcp.id),
    `RetailCo invite HTTP ${toRetail.status} ${toRetail.json?.code || ''}; direct naming HTTP ${direct.status} ${direct.json?.code || ''}; `
      + `invitable ${invitable.map((f) => f.name).join(', ')}; dropdown before ${dropdownBefore.length}`);

  // ── Invited: the firm sees the summary only ──────────────────────────────
  const sent = await c('POST', '/api/engagements/invitations', { projectId: p.id, firmTenantId: gcp.id });
  const twice = await c('POST', '/api/engagements/invitations', { projectId: p.id, firmTenantId: gcp.id });
  const inv = sent.json?.invitation;
  const peek = await as(lead)('GET', `/api/projects/${p.id}`);
  const inbox = (await as(lead)('GET', '/api/engagements/invitations?box=received')).json?.invitations || [];
  const row = inbox.find((i) => i.id === inv?.id);
  v.record('engagement-s4:an invitation goes to the firm for 14 days, one at a time, and shows only its summary',
    sent.status === 201 && inv?.deliveryStyle === 'ClientLed' && twice.status === 409 && twice.json?.code === 'INVITATION_PENDING'
      && Math.round((new Date(inv.expiresAt) - new Date(inv.invitedAt)) / DAY) === 14
      && peek.status === 404 && row?.state === 'Pending' && row?.project?.ref === p.ref && row.project.tasks === undefined,
    `sent ${sent.status}, second ${twice.status}, firm reads project HTTP ${peek.status}, inbox ${row ? row.state : 'missing'}`);

  // ── Accepted: the relationship, once; the Lead awaits approval ───────────
  const accepted = await as(lead)('POST', `/api/engagements/invitations/${inv.id}/accept`);
  const again = await as(lead)('POST', `/api/engagements/invitations/${inv.id}/accept`);
  const leadBefore = await as(lead)('GET', `/api/projects/${p.id}`);
  const adminView = await as(lead)('GET', `/api/engagements/${p.id}`);
  const named = await prisma.project.findUnique({ where: { id: p.id }, select: { providerTenantId: true, deliveryStyle: true } });
  v.record('engagement-s4:accepting names the firm and makes the relationship, and the invitation is single use',
    accepted.status === 200 && accepted.json?.relationshipCreated === true && again.status === 409
      && named?.providerTenantId === gcp.id && named?.deliveryStyle === 'ClientLed',
    `accept ${accepted.status} ${accepted.json?.message || ''}, again ${again.status}, provider ${named?.providerTenantId === gcp.id}`);

  // ── Nominated, approved, turned down ─────────────────────────────────────
  const nominate = (who, role) => as(lead)('POST', `/api/engagements/${p.id}/nominations`, { userId: who.user.id, engagementRole: role });
  const n1 = await nominate(consultant, 'Consultant');
  const n2 = await nominate(reviewer, 'Reviewer');
  const n3 = await nominate(turnedDown, 'Consultant');
  const byConsultantBefore = await as(consultant)('GET', `/api/projects/${p.id}`);
  const members = (await c('GET', `/api/engagements/${p.id}`)).json?.members || [];
  const idOf = (who) => members.find((m) => m.user.id === who.user.id)?.id;
  const approve = (who, role) => c('POST', `/api/engagements/${p.id}/members/${idOf(who)}/approve`, { engagementRole: role });
  const a0 = await approve(lead, 'Lead');
  const a1 = await approve(consultant, 'Consultant');
  const a2 = await approve(reviewer, 'Reviewer');
  const r3 = await c('POST', `/api/engagements/${p.id}/members/${idOf(turnedDown)}/reject`, { reason: 'Not cleared for this client' });
  const seen = {
    lead: (await as(lead)('GET', `/api/projects/${p.id}`)).status,
    consultant: (await as(consultant)('GET', `/api/projects/${p.id}`)).status,
    turnedDown: (await as(turnedDown)('GET', `/api/projects/${p.id}`)).status,
  };
  const listed = ((await as(turnedDown)('GET', '/api/projects')).json?.projects || []).some((x) => x.id === p.id);
  v.record('engagement-s4:an unapproved nominee has no access; an approved one has',
    leadBefore.status === 404 && adminView.status === 200 && byConsultantBefore.status === 404
      && [n1, n2, n3].every((x) => x.status === 201) && [a0, a1, a2, r3].every((x) => x.status === 200)
      && seen.lead === 200 && seen.consultant === 200 && seen.turnedDown === 404 && !listed,
    `before approval: lead ${leadBefore.status}, consultant ${byConsultantBefore.status}; nominations ${[n1, n2, n3].map((x) => x.status)}; `
      + `decisions ${[a0, a1, a2, r3].map((x) => x.status)}; after: ${JSON.stringify(seen)}, turned-down lists it ${listed}`);

  // ── Roles hold ───────────────────────────────────────────────────────────
  const phase = (await c('POST', `/api/projects/${p.id}/phases`, { name: 'Scoping', startDate: day(5), targetEndDate: day(30), ownerId: me })).json?.phase;
  const task = (await c('POST', `/api/projects/phases/${phase?.id}/tasks`, { name: 'Scope statement', startDate: day(5), dueDate: day(15), assigneeId: me })).json?.task;
  const blocker = { title: 'Waiting on the asset owners', kind: 'Blocker', category: 'ClientDependency', owingSide: 'Client', taskId: task?.id };
  const byReviewer = await as(reviewer)('POST', `/api/projects/${p.id}/impediments`, blocker);
  const byConsultant = await as(consultant)('POST', `/api/projects/${p.id}/impediments`, blocker);
  const submitByConsultant = await as(consultant)('POST', `/api/projects/tasks/${task?.id}/submit`, {});
  const verifyByLead = await as(lead)('POST', `/api/projects/tasks/${task?.id}/verify`, { outcome: 'Verified' });
  v.record('engagement-s4:a Reviewer changes nothing, only the Lead submits, and verifying stays with the organisation',
    byReviewer.status === 403 && byReviewer.json?.code === 'ENGAGEMENT_ROLE'
      && byConsultant.json?.code !== 'ENGAGEMENT_ROLE' && byConsultant.status !== 404
      && submitByConsultant.status === 403 && submitByConsultant.json?.code === 'ENGAGEMENT_ROLE'
      && verifyByLead.status === 403 && verifyByLead.json?.code === 'CLIENT_DECIDES',
    `reviewer blocker ${byReviewer.status} ${byReviewer.json?.code || ''}; consultant blocker ${byConsultant.status} ${byConsultant.json?.code || ''}; `
      + `consultant submit ${submitByConsultant.status} ${submitByConsultant.json?.code || ''}; lead verify ${verifyByLead.status} ${verifyByLead.json?.code || ''}`);

  // ── The style is the organisation's ──────────────────────────────────────
  const byFirm = await as(lead)('PATCH', `/api/engagements/${p.id}/delivery-style`, { deliveryStyle: 'ConsultantLed', reason: 'We would like to draft the policies' });
  const byClient = await c('PATCH', `/api/engagements/${p.id}/delivery-style`, { deliveryStyle: 'ConsultantLed', reason: 'The firm drafts the policy set' });
  const style = (await prisma.project.findUnique({ where: { id: p.id }, select: { deliveryStyle: true } }))?.deliveryStyle;
  const trail = await prisma.auditLog.findMany({
    where: { subjectId: p.id, action: { in: ['ENGAGEMENT_INVITATION_ACCEPTED', 'ENGAGEMENT_PERSON_APPROVED', 'ENGAGEMENT_PERSON_REJECTED', 'ENGAGEMENT_STYLE_CHANGED'] } },
    select: { action: true, tenantId: true },
  });
  const onBoth = (action) => trail.some((t) => t.action === action && t.tenantId === omni.id) && trail.some((t) => t.action === action && t.tenantId === gcp.id);
  v.record('engagement-s4:only the organisation changes the style, and every step is on both trails',
    byFirm.status === 403 && byFirm.json?.code === 'CLIENT_DECIDES' && byClient.status === 200 && style === 'ConsultantLed'
      && ['ENGAGEMENT_INVITATION_ACCEPTED', 'ENGAGEMENT_PERSON_APPROVED', 'ENGAGEMENT_PERSON_REJECTED', 'ENGAGEMENT_STYLE_CHANGED'].every(onBoth),
    `firm ${byFirm.status}, client ${byClient.status}, style ${style}; on both trails: `
      + ['ENGAGEMENT_INVITATION_ACCEPTED', 'ENGAGEMENT_PERSON_APPROVED', 'ENGAGEMENT_PERSON_REJECTED', 'ENGAGEMENT_STYLE_CHANGED'].map((a) => `${a} ${onBoth(a)}`).join(', '));

  // ── Expired, re-invited, withdrawn ───────────────────────────────────────
  const p2 = await engagement('S4 surveillance');
  const first = (await c('POST', '/api/engagements/invitations', { projectId: p2.id, firmTenantId: gcp.id })).json?.invitation;
  await prisma.engagementInvitation.update({ where: { id: first.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  const late = await as(lead)('POST', `/api/engagements/invitations/${first.id}/accept`);
  const second = (await c('POST', '/api/engagements/invitations', { projectId: p2.id, firmTenantId: gcp.id })).json?.invitation;
  const withdrawn = await c('POST', `/api/engagements/invitations/${second?.id}/revoke`, { reason: 'Scope still being agreed internally' });
  const third = await c('POST', '/api/engagements/invitations', { projectId: p2.id, firmTenantId: gcp.id });
  const acceptThird = await as(lead)('POST', `/api/engagements/invitations/${third.json?.invitation?.id}/accept`);
  const kept = await prisma.engagementInvitation.findMany({ where: { projectId: p2.id }, select: { status: true, expiresAt: true } });
  const relationships = await prisma.providerRelationship.count({ where: { clientTenantId: omni.id, firmTenantId: gcp.id } });
  v.record('engagement-s4:an expired invitation cannot be accepted, and every invitation stays on record',
    late.status === 409 && late.json?.code === 'INVITATION_EXPIRED' && withdrawn.status === 200 && third.status === 201
      && kept.length === 3 && kept.filter((k) => k.status === 'Revoked').length === 1
      && acceptThird.status === 200 && acceptThird.json?.relationshipCreated === false && relationships === 1,
    `late accept ${late.status} ${late.json?.code || ''}, withdraw ${withdrawn.status}, re-invite ${third.status}, `
      + `${kept.length} on record, second acceptance made a relationship: ${acceptThird.json?.relationshipCreated}, relationships ${relationships}`);

  const dropdownAfter = (await c('GET', '/api/projects/engageable-providers')).json?.providers || [];
  v.record('engagement-s4:the New engagement dropdown lists firms with an accepted relationship',
    dropdownAfter.some((f) => f.id === gcp.id) && !dropdownAfter.some((f) => f.id === retail.id),
    dropdownAfter.map((f) => f.name).join(', ') || 'empty');

  // ── Switched off: no new invitations, nothing taken back ─────────────────
  const flag = await prisma.featureFlag.findUnique({ where: { key: FLAG }, select: { id: true } });
  await prisma.featureFlagOverride.update({ where: { flagId_tenantId: { flagId: flag.id, tenantId: omni.id } }, data: { enabled: false } });
  const p3 = await engagement('S4 after switching off');
  const offInvite = await c('POST', '/api/engagements/invitations', { projectId: p3.id, firmTenantId: gcp.id });
  const stillReads = await as(consultant)('GET', `/api/projects/${p.id}`);
  const stillRelated = await prisma.providerRelationship.count({ where: { clientTenantId: omni.id, firmTenantId: gcp.id } });
  const featureOff = (await c('GET', '/api/engagements/feature')).json?.enabled;
  await prisma.featureFlagOverride.update({ where: { flagId_tenantId: { flagId: flag.id, tenantId: omni.id } }, data: { enabled: true } });
  v.record('engagement-s4:switching the flag off stops invitations and takes back nothing already granted',
    offInvite.status === 403 && offInvite.json?.code === 'FEATURE_OFF' && stillReads.status === 200 && stillRelated === 1 && featureOff === false,
    `invite ${offInvite.status} ${offInvite.json?.code || ''}, approved consultant reads ${stillReads.status}, relationships ${stillRelated}, feature ${featureOff}`);

  await prisma.$disconnect();
  v.finish(`${p.ref} delivered by GRC Consulting Partners`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
