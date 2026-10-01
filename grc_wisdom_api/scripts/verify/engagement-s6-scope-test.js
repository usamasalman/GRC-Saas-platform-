/**
 * Consulting engagement, sprint 6: scope and enforcement, the migration of
 * engagements set up the old way, the firm's portal and planning, the
 * organisation's external access, and documents view only or downloadable.
 *
 * Here, with the seeded pilot (OmniOps and GRC Consulting Partners):
 *
 *   - access runs from its start: before it a person sees only the
 *     engagement's card, the firm's Lead can still set up its team, and the
 *     organisation can bring the start forward (never before the approval);
 *   - scope is drafted, approved by a second person of the organisation and
 *     binding; Audit Programme and records outside the client's hierarchy
 *     cannot be put in it; the firm never sees a draft;
 *   - a consultant sees only shared records: the registers in scope, at or
 *     below the ceiling; an out-of-scope read is 404 and on the client's
 *     trail; a view-only consultant's download is refused, and every read is
 *     on the document's Access tab;
 *   - the delivery style holds: client-led, the firm plans only its own
 *     tasks; consultant-led, its Lead assigns the organisation's too; a
 *     Consultant re-plans only their own; weight stays the organisation's;
 *   - an engagement named the old way is migrated on one screen: the RACI
 *     Accountable proposed as Lead, access to the target end, scope version 1
 *     reproducing today's access; until enforcement the firm works as before
 *     and refusals are counted;
 *   - enforcement is a second flag, switched per organisation only after the
 *     checklist (every refusal explained, a quiet fortnight with firm
 *     activity, no migration waiting, the administrator's confirmation), at
 *     least seven days ahead with the firms told; it takes effect on its
 *     date and rolls back to shadow at once;
 *   - the organisation sees and confirms who from outside sees what, and its
 *     records carry "Shared with <firm>";
 *   - every route has a caller on a screen, and the guide quotes its labels.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s6-scope-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const { planRefusal, startAtApproval } = require('../../dist/services/engagementRules');
const { flagOnFor } = require('../../dist/services/featureFlags');
const { registerScope } = require('../../dist/services/engagementScope');

const v = q.verdicts('engagement-s6');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);
const CONSULTING = 'Consulting Engagements';
const ENFORCEMENT = 'Consulting enforcement';

// ── The rules, without a database ───────────────────────────────────────────
{
  const base = { callerId: 'me', assigneeId: null, assigneeIsClient: false };
  const r = (o) => planRefusal({ ...base, ...o })?.code ?? null;
  v.record('engagement-s6:client-led the firm plans its own tasks; consultant-led its Lead assigns the organisation\'s',
    r({ role: 'Lead', deliveryStyle: 'ClientLed', side: 'Provider' }) === null
      && r({ role: 'Lead', deliveryStyle: 'ClientLed', side: 'Client' }) === 'DELIVERY_STYLE'
      && r({ role: 'Lead', deliveryStyle: 'ClientLed', side: 'Provider', assigneeIsClient: true, assigneeId: 'c' }) === 'DELIVERY_STYLE'
      && r({ role: 'Lead', deliveryStyle: 'ConsultantLed', side: 'Client' }) === null
      && r({ role: 'Consultant', deliveryStyle: 'ConsultantLed', side: 'Client' }) === 'ENGAGEMENT_ROLE'
      && r({ role: 'Consultant', deliveryStyle: 'ClientLed', side: 'Provider', assigneeId: 'me', previousAssigneeId: 'me' }) === null
      && r({ role: 'Consultant', deliveryStyle: 'ClientLed', side: 'Provider', assigneeId: 'other' }) === 'ENGAGEMENT_ROLE'
      && r({ role: 'Reviewer', deliveryStyle: 'ConsultantLed', side: 'Provider' }) === 'ENGAGEMENT_ROLE'
      && r({ role: null, deliveryStyle: 'ConsultantLed', side: 'Provider' }) === 'ENGAGEMENT_ROLE',
    'planRefusal');
  const now = new Date('2026-10-10T12:00:00Z');
  const flag = { status: 'Disabled', expiryDate: null };
  v.record('engagement-s6:an override dated ahead counts from its date; off counts at once; a start never precedes its approval',
    flagOnFor(flag, { enabled: true, effectiveFrom: new Date('2026-10-17T00:00:00Z') }, now) === false
      && flagOnFor(flag, { enabled: true, effectiveFrom: new Date('2026-10-01T00:00:00Z') }, now) === true
      && flagOnFor({ status: 'Enabled', expiryDate: null }, { enabled: false, effectiveFrom: new Date('2026-10-17T00:00:00Z') }, now) === false
      && startAtApproval(new Date('2026-10-01T00:00:00Z'), now).getTime() === now.getTime()
      && startAtApproval(new Date('2026-10-20T00:00:00Z'), now).toISOString().startsWith('2026-10-20'),
    'flagOnFor / startAtApproval');
  const scope = { services: ['Documents'], entityIds: ['t1'], classificationCeiling: 'Internal', validFrom: null, validTo: new Date('2026-10-09T00:00:00Z') };
  const reg = registerScope({ ...scope, validTo: null }, 'Documents', now);
  v.record('engagement-s6:a scope shares only its registers, up to its ceiling, inside its dates',
    reg && reg.classifications.join() === 'Public,Internal' && reg.tenantIds.join() === 't1'
      && registerScope({ ...scope, validTo: null }, 'Risks', now) === null
      && registerScope(scope, 'Documents', now) === null,
    JSON.stringify(reg));
}

// ── Every route has a caller; the guide quotes labels that are on screen ────
{
  const dir = path.join(q.WEB_SRC, 'pages', 'grc', 'project');
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const scope = src('pages', 'grc', 'project', 'EngagementScope.tsx');
  const docs = src('pages', 'grc', 'project', 'EngagementDocuments.tsx');
  const registers = src('pages', 'grc', 'project', 'EngagementRisksAssets.tsx');
  const access = src('pages', 'grc', 'project', 'ExternalAccess.tsx');
  const cards = src('pages', 'grc', 'project', 'ClientEngagements.tsx') + src('pages', 'grc', 'project', 'PartnerHome.tsx');
  const panel = src('pages', 'grc', 'project', 'EngagementPanel.tsx');
  const readiness = src('pages', 'marketplace', 'EnforcementReadiness.tsx');
  const marker = src('components', 'SharedWith.tsx');
  const host = src('pages', 'grc', 'DeliveryProjects.tsx');
  const flags = src('pages', 'marketplace', 'FeatureFlagsManager.tsx');
  const registersUsingMarker = ['documents/DocumentLibrary.tsx', 'grc/RiskRegister.tsx', 'grc/AssetRegister.tsx']
    .every((f) => /<SharedWith firms=/.test(src('pages', ...f.split('/'))));
  const callers = {
    'GET /api/engagements/mine': /fetchAllPages<EngagementCard>\('\/api\/engagements\/mine', 'engagements'\)/.test(cards),
    'GET, POST .../scope, .../approve, .../discard': /apiClient\.get\(`\/api\/engagements\/\$\{projectId\}\/scope`\)/.test(scope)
      && /apiClient\.post\(`\/api\/engagements\/\$\{projectId\}\/scope`, \{/.test(scope)
      && /\/scope\/\$\{v\.id\}\/approve`/.test(scope) && /\/scope\/\$\{discarding\.id\}\/discard`/.test(scope),
    'documents, one document, its file, the document setting': /\/api\/engagements\/\$\{projectId\}\/documents`, \{ params/.test(docs)
      && /\/documents\/\$\{d\.id\}`\)/.test(docs) && /\/documents\/\$\{d\.id\}\/file`/.test(docs)
      && /apiClient\.patch\(`\/api\/engagements\/\$\{projectId\}\/document-access`/.test(docs),
    'risks and assets': /\/api\/engagements\/\$\{projectId\}\/\$\{kind\}`/.test(registers) && /useRegister\(projectId, 'risks'\)/.test(registers) && /useRegister\(projectId, 'assets'\)/.test(registers),
    'migration and migrate': /apiClient\.get\('\/api\/engagements\/migration'\)/.test(access) && /\/api\/engagements\/\$\{e\.id\}\/migrate`/.test(access),
    'external access, review, revoke': /'\/api\/engagements\/external-access'/.test(access) && /\/access-review`/.test(access) && /\/members\/\$\{revoking\.p\.memberId\}\/remove`/.test(access),
    'enforcement status and confirm': /'\/api\/engagements\/enforcement\/status'/.test(access) && /'\/api\/engagements\/enforcement\/confirm'/.test(access),
    'readiness, explain, schedule, rollback': /'\/api\/engagements\/enforcement\/readiness'/.test(readiness) && /\/api\/engagements\/shadow\/\$\{marking\.id\}\/disposition`/.test(readiness)
      && /'\/api\/engagements\/enforcement\/schedule'/.test(readiness) && /'\/api\/engagements\/enforcement\/rollback'/.test(readiness),
    'shared-with, on the three registers': /'\/api\/engagements\/shared-with'/.test(marker) && registersUsingMarker,
    'a start brought forward': /accessFrom: v\.from/.test(panel),
    'the tabs and screens mounted': ['<PartnerHome', '<ClientEngagements', '<ExternalAccess', '<EngagementOverview', '<EngagementScope', '<EngagementDocuments', '<EngagementRisksAssets']
      .every((t) => host.includes(t)) && /<EnforcementReadiness\b/.test(flags),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s6:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const guide = src('data', 'userGuideData.ts').replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '?${name}'?: \\{`))[1] || '').split(/\n  \},\n/)[0];
  const screens = require('fs').readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => q.read(path.join(dir, f))).join('\n') + host;
  const needed = ['Draft a new scope version', 'Approve scope', 'Change document access', 'Risks and assets', 'External access', 'Revoke',
    'Confirm access', 'Migrate engagement', 'Confirm we are ready', 'Client engagements', 'Access starts on', 'Set up your team', 'Open workspace', 'Access from'];
  const quoted = [...section('project-delivery').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const flagQuoted = [...section('feature-flags').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const flagNeeded = ['Consulting enforcement by organisation', 'Explain', 'Correct, keep refusing', 'Rule fixed', 'Schedule enforcement', 'Back to shadow mode'];
  const absent = [...quoted.filter((l) => !screens.includes(l)), ...flagNeeded.filter((l) => !readiness.includes(l))];
  v.record('engagement-s6:the guide describes scope, sharing, external access, the firm\'s portal and enforcement with labels on screen',
    needed.every((l) => quoted.includes(l)) && flagNeeded.every((l) => flagQuoted.includes(l)) && absent.length === 0
      && ['library', 'assets', 'risk'].every((s) => /Shared with and the firm/.test(section(s))),
    `not quoted: ${[...needed.filter((l) => !quoted.includes(l)), ...flagNeeded.filter((l) => !flagQuoted.includes(l))].join(', ') || 'none'}; on no screen: ${absent.join(', ') || 'none'}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me');
  const admin = await q.login('company.admin@omniops.me');
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const reviewer = await q.login('risk@grcconsulting.com');
  const outsider = await q.login('presales@grcconsulting.com');
  const platformCreds = q.adminCredentials();
  const platform = platformCreds.email ? await q.login(platformCreds.email, platformCreds.password) : null;
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const c = as(client);
  const me = client.user.id;
  const omni = await prisma.tenant.findFirst({ where: { name: 'OmniOps' }, select: { id: true } });
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const other = await prisma.tenant.findFirst({ where: { name: 'RetailCo Franchise Network' }, select: { id: true } });
  const reads = async (who, id) => (await as(who)('GET', `/api/projects/${id}`)).status;
  const listed = async (who, id) => ((await as(who)('GET', '/api/projects')).json?.projects || []).some((x) => x.id === id);
  const trail = async (subjectId, action) => (await prisma.auditLog.findMany({
    where: { subjectId, action }, select: { tenantId: true, actorId: true, payload: true },
  })).map((t) => ({ ...t, payload: JSON.parse(t.payload || '{}') }));
  const onBoth = (rows) => rows.some((t) => t.tenantId === omni.id) && rows.some((t) => t.tenantId === gcp.id);
  const memberOf = (pid, who) => prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: who.user.id } } });

  const activeEngagement = async (name, start) => {
    const p = (await c('POST', '/api/projects', {
      name: `${name} ${stamp}`, startDate: day(start), targetEndDate: day(90), ownerId: me, managerId: me, projectType: 'Certification',
    })).json?.project;
    const ph = (await c('POST', `/api/projects/${p.id}/phases`, { name: 'Scoping', startDate: day(start), targetEndDate: day(40), ownerId: me })).json?.phase;
    const t = (await c('POST', `/api/projects/phases/${ph.id}/tasks`, { name: 'Scope statement', startDate: day(start + 1), dueDate: day(start + 10), assigneeId: me })).json?.task;
    await c('POST', `/api/projects/${p.id}/activate`, {});
    return { p, phase: ph, task: t };
  };
  const invite = async (pid) => {
    const inv = (await c('POST', '/api/engagements/invitations', { projectId: pid, firmTenantId: gcp.id })).json?.invitation;
    await as(lead)('POST', `/api/engagements/invitations/${inv.id}/accept`);
    return (await memberOf(pid, lead)).id;
  };

  // ── Access runs from its start ───────────────────────────────────────────
  const later = await activeEngagement('S6 starts later', 10);
  const leadLater = await invite(later.p.id);
  const approvedLater = await c('POST', `/api/engagements/${later.p.id}/members/${leadLater}/approve`, { engagementRole: 'Lead' });
  const cardList = (await as(lead)('GET', '/api/engagements/mine')).json?.engagements || [];
  const card = cardList.find((x) => x.id === later.p.id);
  const before = { read: await reads(lead, later.p.id), listed: await listed(lead, later.p.id) };
  const teamBefore = await as(lead)('POST', `/api/engagements/${later.p.id}/nominations`, { userId: consultant.user.id, engagementRole: 'Consultant' });
  v.record('engagement-s6:before its start a person sees only the card, and the firm\'s Lead can still set up its team',
    approvedLater.status === 200 && card?.state === 'NotStarted' && card.canOpen === false && card.invitedBy && card.client
      && card.tasks === undefined && before.read === 404 && !before.listed && teamBefore.status === 201,
    `approve ${approvedLater.status}; card ${JSON.stringify(card && { state: card.state, canOpen: card.canOpen, invitedBy: card.invitedBy })}; `
      + `reads ${before.read}, listed ${before.listed}; nominate ${teamBefore.status}`);

  const forward = await c('PATCH', `/api/engagements/${later.p.id}/members/${leadLater}/window`, {
    accessFrom: day(-5), accessTo: day(100), reason: 'Kick-off moved to this week',
  });
  const after = await memberOf(later.p.id, lead);
  const moved = (await trail(later.p.id, 'ENGAGEMENT_ACCESS_WINDOW_CHANGED')).find((t) => t.payload?.to?.accessFrom);
  v.record('engagement-s6:the organisation brings the start forward, never before the approval, on both trails',
    forward.status === 200 && (await reads(lead, later.p.id)) === 200
      && after.accessFrom.getTime() >= after.decidedAt.getTime() - 1000 && Boolean(moved),
    `forward ${forward.status} ${forward.json?.message || ''}; start ${after.accessFrom?.toISOString()} vs approval ${after.decidedAt?.toISOString()}`);

  // ── Scope, versioned like risk appetite ──────────────────────────────────
  const main = await activeEngagement('S6 ISO 27001', 0);
  const pid = main.p.id;
  const leadId = await invite(pid);
  await c('POST', `/api/engagements/${pid}/members/${leadId}/approve`, { engagementRole: 'Lead', accessFrom: day(0) });
  for (const [who, role] of [[consultant, 'Consultant'], [reviewer, 'Reviewer']]) {
    await as(lead)('POST', `/api/engagements/${pid}/nominations`, { userId: who.user.id, engagementRole: role });
    await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, who)).id}/approve`, { engagementRole: role, accessFrom: day(0) });
  }
  const scopeBody = { entityIds: [omni.id], services: ['Documents', 'Risks', 'Assets'], classificationCeiling: 'Internal', validFrom: day(-1), validTo: day(120) };
  const auditProgramme = await c('POST', `/api/engagements/${pid}/scope`, { ...scopeBody, services: ['Documents', 'AuditProgramme'] });
  const outside = await c('POST', `/api/engagements/${pid}/scope`, { ...scopeBody, entityIds: [other.id] });
  const drafted = await c('POST', `/api/engagements/${pid}/scope`, scopeBody);
  const second = await c('POST', `/api/engagements/${pid}/scope`, scopeBody);
  const firmSeesDraft = ((await as(consultant)('GET', `/api/engagements/${pid}/scope`)).json?.versions || []).length;
  const firmDrafts = await as(lead)('POST', `/api/engagements/${pid}/scope`, scopeBody);
  const versionId = (await prisma.engagementScopeVersion.findFirst({ where: { projectId: pid, version: 1 } }))?.id;
  const selfApprove = await c('POST', `/api/engagements/${pid}/scope/${versionId}/approve`);
  const approved = await as(admin)('POST', `/api/engagements/${pid}/scope/${versionId}/approve`);
  const firmScope = (await as(consultant)('GET', `/api/engagements/${pid}/scope`)).json?.versions || [];
  v.record('engagement-s6:scope is drafted, approved by a second person and binding; Audit Programme and outside entities are refused',
    auditProgramme.status === 400 && auditProgramme.json?.code === 'NEVER_SHARED'
      && outside.status === 400 && outside.json?.code === 'OUTSIDE_HIERARCHY'
      && drafted.status === 201 && second.status === 409 && second.json?.code === 'DRAFT_OPEN'
      && firmSeesDraft === 0 && firmDrafts.status === 403 && firmDrafts.json?.code === 'CLIENT_DECIDES'
      && selfApprove.status === 403 && selfApprove.json?.code === 'SECOND_PERSON' && approved.status === 200
      && firmScope.length === 1 && firmScope[0].status === 'Binding'
      && onBoth(await trail(pid, 'ENGAGEMENT_SCOPE_DRAFTED')) && onBoth(await trail(pid, 'ENGAGEMENT_SCOPE_APPROVED')),
    `audit programme ${auditProgramme.status} ${auditProgramme.json?.code || ''}; outside ${outside.status} ${outside.json?.code || ''}; `
      + `draft ${drafted.status}, again ${second.status}; firm sees draft ${firmSeesDraft}; firm drafts ${firmDrafts.status}; `
      + `self-approve ${selfApprove.status} ${selfApprove.json?.code || ''}; approve ${approved.status}; firm sees ${firmScope.map((x) => x.status)}`);

  // ── Only shared records; 404 outside, on the client's trail ──────────────
  const doc = (title, classification, tenantId = omni.id) => prisma.document.create({
    data: {
      code: `S6-${classification.slice(0, 3)}-${stamp}`, tenantId, ownerId: tenantId === omni.id ? me : undefined,
      title, category: 'Policy', classification, status: 'PUBLISHED', content: `${title}: shared for review.`,
    },
  }).catch(() => null);
  const internalDoc = await doc('S6 Access control policy', 'Internal');
  const confidentialDoc = await doc('S6 M&A plan', 'Confidential');
  const asset = (name, classification) => prisma.asset.create({
    data: { tenantId: omni.id, ref: `S6-${classification.slice(0, 3)}-${stamp}`, name, classification, ownerId: me },
  });
  const internalAsset = await asset('S6 Ticketing system', 'Internal');
  const confidentialAsset = await asset('S6 Payroll database', 'Confidential');
  const docs = (await as(consultant)('GET', `/api/engagements/${pid}/documents?pageSize=50&search=S6-`)).json;
  const ids = (docs?.documents || []).map((d) => d.id);
  const outOfScope = await as(consultant)('GET', `/api/engagements/${pid}/documents/${confidentialDoc.id}`);
  const refusedOnTrail = (await prisma.auditLog.findMany({
    where: { tenantId: omni.id, action: 'ENGAGEMENT_READ_REFUSED', subjectId: confidentialDoc.id, actorId: consultant.user.id },
  })).length;
  const opened = await as(consultant)('GET', `/api/engagements/${pid}/documents/${internalDoc.id}`);
  const accessRow = await prisma.documentAccess.findFirst({ where: { documentId: internalDoc.id, userId: consultant.user.id } });
  const assets = (await as(consultant)('GET', `/api/engagements/${pid}/assets?pageSize=50`)).json?.assets || [];
  const risks = (await as(consultant)('GET', `/api/engagements/${pid}/risks?pageSize=5`)).json;
  const notMember = await as(outsider)('GET', `/api/engagements/${pid}/documents`);
  const noScope = (await as(lead)('GET', `/api/engagements/${later.p.id}/documents`)).json;
  v.record('engagement-s6:a consultant sees only shared records; an out-of-scope read is 404 and on the client\'s trail',
    Boolean(internalDoc && confidentialDoc) && ids.includes(internalDoc.id) && !ids.includes(confidentialDoc.id)
      && outOfScope.status === 404 && refusedOnTrail === 1 && opened.status === 200 && accessRow?.basis === 'engagement'
      && assets.some((a) => a.id === internalAsset.id) && !assets.some((a) => a.id === confidentialAsset.id)
      && risks?.shared === true && (risks.risks || []).every((r) => r.owner === null || typeof r.owner === 'string') && !('email' in ((risks.risks || [])[0] || {}))
      && notMember.status === 404 && noScope?.shared === false && (noScope.documents || []).length === 0,
    `docs ${ids.length} (internal ${ids.includes(internalDoc?.id)}, confidential ${ids.includes(confidentialDoc?.id)}); `
      + `out of scope ${outOfScope.status}, on trail ${refusedOnTrail}; open ${opened.status}, access ${accessRow?.basis}; `
      + `assets internal ${assets.some((a) => a.id === internalAsset.id)} confidential ${assets.some((a) => a.id === confidentialAsset.id)}; `
      + `risks shared ${risks?.shared}; non-member ${notMember.status}; unscoped ${noScope?.shared}`);

  const viewOnlyDownload = await as(consultant)('GET', `/api/engagements/${pid}/documents/${internalDoc.id}/file`);
  const viewOnlyPreview = await as(consultant)('GET', `/api/engagements/${pid}/documents/${internalDoc.id}/file?disposition=preview`);
  const firmSets = await as(lead)('PATCH', `/api/engagements/${pid}/document-access`, { documentAccess: 'Download', reason: 'We need copies offline' });
  const allow = await c('PATCH', `/api/engagements/${pid}/document-access`, { documentAccess: 'Download', reason: 'The firm works on the policies offline' });
  const download = await as(consultant)('GET', `/api/engagements/${pid}/documents/${internalDoc.id}/file`);
  const counted = await prisma.documentAccess.findFirst({ where: { documentId: internalDoc.id, userId: consultant.user.id } });
  v.record('engagement-s6:a view-only consultant\'s download is refused; allowed by the organisation, it is counted',
    viewOnlyDownload.status === 403 && viewOnlyDownload.json?.code === 'VIEW_ONLY' && viewOnlyPreview.status === 200
      && firmSets.status === 403 && allow.status === 200 && download.status === 200 && counted?.downloads >= 1
      && onBoth(await trail(pid, 'ENGAGEMENT_DOCUMENT_ACCESS_CHANGED')),
    `view-only download ${viewOnlyDownload.status} ${viewOnlyDownload.json?.code || ''}, preview ${viewOnlyPreview.status}; `
      + `firm sets ${firmSets.status}; allow ${allow.status}; download ${download.status}, downloads ${counted?.downloads}`);

  // ── The delivery style ───────────────────────────────────────────────────
  const task = (who, body) => as(who)('POST', `/api/projects/phases/${main.phase.id}/tasks`, { startDate: day(2), dueDate: day(12), ...body });
  const firmTask = await task(lead, { name: 'Review the access policy', assigneeId: consultant.user.id });
  const clientTaskLed = await task(lead, { name: 'Supply the asset list', side: 'Client', assigneeId: me });
  const reassignClient = await as(lead)('PATCH', `/api/projects/tasks/${main.task.id}`, { assigneeId: me });
  const weight = await task(lead, { name: 'Weighted', weight: 5 });
  const consultantOwn = await as(consultant)('PATCH', `/api/projects/tasks/${firmTask.json?.task?.id}`, { dueDate: day(11) });
  const leadsTask = await task(lead, { name: 'Lead\'s own task', assigneeId: lead.user.id });
  const consultantOther = await as(consultant)('PATCH', `/api/projects/tasks/${leadsTask.json?.task?.id}`, { dueDate: day(10) });
  const reviewerPlans = await as(reviewer)('PATCH', `/api/projects/tasks/${firmTask.json?.task?.id}`, { dueDate: day(10) });
  const toConsultantLed = await c('PATCH', `/api/engagements/${pid}/delivery-style`, { deliveryStyle: 'ConsultantLed', reason: 'The firm runs the remediation plan' });
  const clientTaskCl = await task(lead, { name: 'Supply the asset list', side: 'Client', assigneeId: me });
  const firmSummary = (await prisma.auditLog.findMany({ where: { tenantId: gcp.id, action: 'PROJECT_TASK_CREATED', subjectId: firmTask.json?.task?.id } })).length;
  v.record('engagement-s6:client-led the firm plans only its own tasks; consultant-led its Lead assigns the organisation\'s',
    firmTask.status === 201 && firmTask.json?.task?.side === 'Provider' && firmSummary === 1
      && clientTaskLed.status === 403 && clientTaskLed.json?.code === 'DELIVERY_STYLE'
      && reassignClient.status === 403 && reassignClient.json?.code === 'DELIVERY_STYLE'
      && weight.status === 403 && weight.json?.code === 'PLANNING_REQUIRES_MANAGER'
      && consultantOwn.status === 200 && consultantOther.status === 403 && consultantOther.json?.code === 'ENGAGEMENT_ROLE'
      && reviewerPlans.status === 403 && toConsultantLed.status === 200 && clientTaskCl.status === 201 && clientTaskCl.json?.task?.side === 'Client',
    `firm task ${firmTask.status} ${firmTask.json?.task?.side || firmTask.json?.message || ''}, firm trail ${firmSummary}; client task client-led ${clientTaskLed.status} ${clientTaskLed.json?.code || ''}; `
      + `reassign ${reassignClient.status} ${reassignClient.json?.code || ''}; weight ${weight.status} ${weight.json?.code || ''}; `
      + `consultant own ${consultantOwn.status}, other ${consultantOther.status} ${consultantOther.json?.code || ''}; reviewer ${reviewerPlans.status}; `
      + `consultant-led ${toConsultantLed.status}, client task ${clientTaskCl.status}`);

  // ── An engagement named the old way, migrated ────────────────────────────
  const flag = await prisma.featureFlag.findUnique({ where: { key: CONSULTING }, select: { id: true } });
  const off = { flagId_tenantId: { flagId: flag.id, tenantId: omni.id } };
  let old;
  try {
    await prisma.featureFlagOverride.update({ where: off, data: { enabled: false } });
    old = (await c('POST', '/api/projects', {
      name: `S6 named the old way ${stamp}`, startDate: day(0), targetEndDate: day(60), ownerId: me, managerId: me, providerTenantId: gcp.id,
    })).json?.project;
    // The firm's people as the old way left them: one on the team, marked
    // Accountable (no route lets the organisation name the firm's people, so
    // it is set up as data), and one only assigned a task.
    await prisma.projectMember.create({
      data: { projectId: old.id, userId: consultant.user.id, side: 'Provider', roleLabel: 'Engagement lead', raci: 'A' },
    });
    const oldPhase = (await c('POST', `/api/projects/${old.id}/phases`, { name: 'Scoping', startDate: day(0), targetEndDate: day(30), ownerId: me })).json?.phase;
    await c('POST', `/api/projects/phases/${oldPhase.id}/tasks`, { name: 'Draft the scope', startDate: day(1), dueDate: day(9), assigneeId: outsider.user.id });
  } finally {
    await prisma.featureFlagOverride.update({ where: off, data: { enabled: true } });
  }
  const shadowRead = await reads(lead, old.id);
  const proposals = (await c('GET', '/api/engagements/migration')).json?.engagements || [];
  const mine = proposals.find((x) => x.id === old.id);
  const proposedLead = mine?.proposal.find((x) => x.engagementRole === 'Lead');
  const assignedOnly = mine?.proposal.find((x) => x.userId === outsider.user.id);
  const migrated = await c('POST', `/api/engagements/${old.id}/migrate`, {
    deliveryStyle: 'ConsultantLed', members: [{ userId: proposedLead?.userId, engagementRole: 'Lead' }],
  });
  const again = await c('POST', `/api/engagements/${old.id}/migrate`, { members: [] });
  const keptRow = await memberOf(old.id, consultant);
  const droppedRow = await memberOf(old.id, outsider);
  const v1 = await prisma.engagementScopeVersion.findFirst({ where: { projectId: old.id, version: 1 } });
  const shadowAfter = await reads(lead, old.id);
  v.record('engagement-s6:migration proposes the RACI Accountable as Lead, approves to the target end, and binds a scope reproducing today\'s access',
    shadowRead === 200 && proposedLead?.userId === consultant.user.id && proposedLead.source === 'Team'
      && assignedOnly?.source === 'Assigned' && assignedOnly.engagementRole === 'Consultant'
      && migrated.status === 200 && again.status === 409
      && keptRow?.memberStatus === 'Approved' && keptRow.engagementRole === 'Lead' && keptRow.origin === 'Migration'
      && keptRow.accessTo?.toISOString().slice(0, 10) === day(60) && droppedRow === null
      && v1?.status === 'Binding' && v1.origin === 'Migration' && v1.services === '[]'
      && onBoth(await trail(old.id, 'ENGAGEMENT_MIGRATED')) && shadowAfter === 200,
    `before ${shadowRead}; proposal ${JSON.stringify(mine?.proposal?.map((x) => `${x.name}:${x.source}:${x.engagementRole}`))}; migrate ${migrated.status} ${migrated.json?.message || ''}, again ${again.status}; `
      + `kept ${keptRow?.memberStatus}/${keptRow?.engagementRole}/${keptRow?.accessTo?.toISOString().slice(0, 10)}; not kept ${droppedRow ? droppedRow.memberStatus : 'no place'}; v1 ${v1?.status} ${v1?.services}; lead before enforcement ${shadowAfter}`);

  // Every other engagement of OmniOps still set up the old way, migrated as proposed.
  for (const x of ((await c('GET', '/api/engagements/migration')).json?.engagements || [])) {
    const leadPick = x.proposal.find((m) => m.engagementRole === 'Lead') || x.proposal[0];
    await c('POST', `/api/engagements/${x.id}/migrate`, {
      members: leadPick ? [{ userId: leadPick.userId, engagementRole: 'Lead' }] : [],
    });
  }

  // ── Enforcement, per organisation, after the checklist ───────────────────
  const readiness = async () => (await as(platform)('GET', `/api/engagements/enforcement/readiness?clientTenantId=${omni.id}`)).json?.readiness;
  const early = platform ? await readiness() : null;
  const tooSoon = platform ? await as(platform)('POST', '/api/engagements/enforcement/schedule', {
    clientTenantId: omni.id, effectiveFrom: new Date(Date.now() + 8 * DAY).toISOString(), note: 'Pilot goes live after review',
  }) : null;
  for (const row of early?.shadow || []) {
    await as(platform)('PATCH', `/api/engagements/shadow/${row.id}/disposition`, { disposition: 'KeepRefusing', note: 'The firm read without approval; correct to refuse' });
  }
  const notAdmin = await c('POST', '/api/engagements/enforcement/confirm', { note: 'We are ready for enforcement' });
  const confirmed = await as(admin)('POST', '/api/engagements/enforcement/confirm', { note: 'We are ready for enforcement' });
  const ready = platform ? await readiness() : null;
  const sevenDays = platform ? await as(platform)('POST', '/api/engagements/enforcement/schedule', {
    clientTenantId: omni.id, effectiveFrom: new Date(Date.now() + 2 * DAY).toISOString(), note: 'Pilot goes live after review',
  }) : null;
  const scheduled = platform ? await as(platform)('POST', '/api/engagements/enforcement/schedule', {
    clientTenantId: omni.id, effectiveFrom: new Date(Date.now() + 8 * DAY).toISOString(), note: 'Pilot goes live after review',
  }) : null;
  const leadTold = await prisma.notification.count({ where: { recipientId: lead.user.id, event: 'ENGAGEMENT_ENFORCEMENT_SCHEDULED' } });
  const beforeDate = await reads(lead, old.id);
  const enforcementFlag = await prisma.featureFlag.findUnique({ where: { key: ENFORCEMENT }, select: { id: true } });
  const generic = platform ? await as(platform)('POST', `/api/marketplace/feature-flags/${enforcementFlag?.id}/override`, { tenantId: omni.id, enabled: true }) : null;
  v.record('engagement-s6:enforcement waits for the checklist and the administrator, starts at least seven days ahead, and the firms are told',
    Boolean(platform) && early?.checks?.noMigrationWaiting === true && early.checks.firmActivity === true
      && tooSoon?.status === 409 && tooSoon.json?.code === 'NOT_READY'
      && notAdmin.status === 403 && confirmed.status === 201 && ready?.ready === true
      && sevenDays?.status === 400 && sevenDays.json?.code === 'NOTICE_REQUIRED' && scheduled?.status === 200
      && leadTold >= 1 && beforeDate === 200 && generic?.status === 409 && generic.json?.code === 'USE_ENFORCEMENT_CHECKLIST',
    `early ${JSON.stringify(early?.checks)}; too soon ${tooSoon?.status} ${tooSoon?.json?.code || ''}; confirm by PM ${notAdmin.status}, by admin ${confirmed.status}; `
      + `ready ${JSON.stringify(ready?.checks)}; two days ${sevenDays?.status} ${sevenDays?.json?.code || ''}; scheduled ${scheduled?.status} ${scheduled?.json?.message || ''}; `
      + `lead told ${leadTold}; lead reads before the date ${beforeDate}; generic override ${generic?.status} ${generic?.json?.code || ''}`);

  // The date arrives.
  await prisma.featureFlagOverride.update({
    where: { flagId_tenantId: { flagId: enforcementFlag.id, tenantId: omni.id } }, data: { effectiveFrom: new Date(Date.now() - 60_000) },
  });
  const enforced = { nonMember: await reads(lead, old.id), listed: await listed(lead, old.id), member: await reads(consultant, old.id) };
  const rolledBack = platform ? await as(platform)('POST', '/api/engagements/enforcement/rollback', { clientTenantId: omni.id, note: 'Paused while a firm user is re-approved' }) : null;
  const shadowAgain = await reads(lead, old.id);
  v.record('engagement-s6:once enforced only approved people get in; switching it off returns to shadow at once',
    enforced.nonMember === 404 && !enforced.listed && enforced.member === 200 && rolledBack?.status === 200 && shadowAgain === 200
      && (await trail(enforcementFlag.id, 'ENGAGEMENT_ENFORCEMENT_OFF')).some((t) => t.tenantId === omni.id),
    `enforced: non-member ${enforced.nonMember}, listed ${enforced.listed}, member ${enforced.member}; rollback ${rolledBack?.status}; after ${shadowAgain}`);

  // ── External access and "Shared with" ────────────────────────────────────
  const access = (await c('GET', '/api/engagements/external-access?pageSize=50')).json?.engagements || [];
  const row = access.find((x) => x.id === pid);
  const reviewed = await c('POST', `/api/engagements/${pid}/access-review`, { note: 'Three people, documents to Internal' });
  const shared = (await c('GET', `/api/engagements/shared-with?subjectType=Document&ids=${internalDoc.id},${confidentialDoc.id}`)).json?.sharedWith || {};
  const portal = (await as(consultant)('GET', '/api/engagements/mine')).json?.engagements || [];
  v.record('engagement-s6:the organisation sees and confirms who from outside sees what; its records say who they are shared with',
    row?.people?.length === 3 && row.scope?.version === 1 && row.documentAccess === 'Download'
      && reviewed.status === 201 && onBoth(await trail(pid, 'ENGAGEMENT_ACCESS_REVIEWED'))
      && (shared[internalDoc.id] || []).includes('GRC Consulting Partners') && !shared[confidentialDoc.id]
      && portal.some((x) => x.id === pid && x.canOpen && x.state === 'Open'),
    `row ${JSON.stringify(row && { people: row.people.length, scope: row.scope?.version, doc: row.documentAccess })}; review ${reviewed.status}; `
      + `shared ${JSON.stringify(shared)}; portal ${portal.map((x) => `${x.ref}:${x.state}`).join(', ')}`);

  await prisma.$disconnect();
  v.finish(`${main.p.ref} scoped and delivered by GRC Consulting Partners`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
