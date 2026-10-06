/**
 * Consulting engagement, sprint 13: the certification body and independence.
 *
 * First the MVP acceptance path, end to end, on Al Noor Holding Group with
 * GRC Consulting Partners:
 *
 *   - "ISO 27001 certification", consultant-led, both entities in scope up to
 *     Confidential; the M&A plan (Restricted) is outside it, and the firm's
 *     attempt to read it is refused on Al Noor's trail;
 *   - the AC-04 evidence loop: requested, returned as not current, answered
 *     again and accepted; Al Noor validates AC-04 to Verified;
 *   - the A.5.15 gap raised by the firm, answered by Al Noor and closed by
 *     someone independent of the corrective action;
 *   - the Statement of Applicability issued; approvals on Al Noor's trail.
 *
 * Then the certification body:
 *
 *   - an auditor organisation, onboarded by the platform, invited by the
 *     organisation read-only for at most 180 days; a body whose people share
 *     a company mail domain with the firm is a warning confirmed with a
 *     reason, kept on the record;
 *   - the audit pack frozen: SoA, traceability and readiness reports issued,
 *     stored and hashed; the body reads it, hash checked, and nothing else;
 *     every read outside its days is refused on the organisation's trail;
 *   - the body asks, asks for evidence and raises one nonconformity, which
 *     the organisation records as an Issue with source ExternalAudit;
 *   - internal audit by the firm that implemented the same framework is a
 *     warning confirmed with a reason, kept on the invitation.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s13-certification-test.js
 */
const crypto = require('crypto');
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const {
  checkWindow, bodyMayRead, relatedness, companyDomains, implementationOverlap, confirmationRefusal, MAX_ACCESS_DAYS,
} = require('../../dist/services/certificationAccess');

const v = q.verdicts('engagement-s13');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const b64 = (buf) => buf.toString('base64');
// A small, valid PDF whose text differs per call, so each upload has its own hash.
const pdf = (text) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n% ${text}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);

// ── The rules, without a database ───────────────────────────────────────────
{
  const now = new Date();
  const tooLong = checkWindow(day(0), day(MAX_ACCESS_DAYS + 5), now);
  const backwards = checkWindow(day(10), day(5), now);
  const past = checkWindow(day(-40), day(-10), now);
  const fine = checkWindow(day(0), day(30), now);
  const open = { status: 'Accepted', accessFrom: new Date(`${day(-1)}T00:00:00Z`), accessTo: new Date(`${day(1)}T00:00:00Z`) };
  v.record('engagement-s13:a body\'s access is dated, at most 180 days, and open only once accepted and inside its days',
    !tooLong.ok && tooLong.code === 'TOO_LONG' && !backwards.ok && !past.ok && past.code === 'IN_THE_PAST' && fine.ok
      && bodyMayRead(open, now) && !bodyMayRead({ ...open, status: 'Invited' }, now) && !bodyMayRead({ ...open, status: 'Revoked' }, now)
      && !bodyMayRead({ ...open, accessTo: new Date(`${day(-1)}T00:00:00Z`) }, now),
    `too long ${tooLong.code}; backwards ${backwards.code}; past ${past.code}; fine ${fine.ok}`);
  const related = relatedness({ bodyDomains: companyDomains(['a@grcconsulting.com', 'b@gmail.com']), firmDomains: companyDomains(['c@grcconsulting.com']), firmName: 'GCP' });
  const publicOnly = relatedness({ bodyDomains: companyDomains(['a@gmail.com']), firmDomains: companyDomains(['b@gmail.com']), firmName: 'GCP' });
  const overlap = implementationOverlap({ frameworksBefore: ['iso'], frameworksNow: ['iso'], deliveredTasks: 3 });
  v.record('engagement-s13:relatedness and implementation overlap are warnings the organisation confirms with a reason',
    related.length === 1 && /grcconsulting\.com/.test(related[0]) && publicOnly.length === 0
      && overlap && !implementationOverlap({ frameworksBefore: ['nist'], frameworksNow: ['iso'], deliveredTasks: 3 })
      && !implementationOverlap({ frameworksBefore: ['iso'], frameworksNow: ['iso'], deliveredTasks: 0 })
      && confirmationRefusal([overlap], undefined, '')?.code === 'INDEPENDENCE_WARNING'
      && confirmationRefusal([overlap], true, 'short')?.code === 'REASON_REQUIRED'
      && confirmationRefusal([overlap], true, 'The audit covers clauses 9 and 10 only, which the firm never touched.') === null
      && confirmationRefusal([], undefined, '') === null,
    `related ${JSON.stringify(related)}; overlap ${overlap}`);
}

// ── Every route has a caller; the guide quotes labels that are on screen ────
{
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const tab = src('pages', 'grc', 'project', 'EngagementCertification.tsx');
  const portal = src('pages', 'grc', 'CertificationAudits.tsx');
  const panel = src('pages', 'grc', 'project', 'EngagementPanel.tsx');
  const host = src('pages', 'grc', 'DeliveryProjects.tsx');
  const shell = src('pages', 'AppShell.tsx');
  const callers = {
    'organisation: access, invite, revoke': tab.includes('apiClient.get(base)') && tab.includes('apiClient.post(base, body)') && tab.includes('/revoke`'),
    'organisation: freeze, answer, record': tab.includes('`${base}/packs`') && tab.includes('/answer`') && tab.includes('/record`'),
    'body: mine, respond, view, file, ask': portal.includes("'/api/certification/mine'") && portal.includes('/respond`') && portal.includes('`/api/certification/${a.id}`')
      && portal.includes('/file`') && portal.includes('/questions`'),
    'internal audit: confirm with a reason': panel.includes('independenceReason'),
    'mounted': host.includes('<EngagementCertification') && shell.includes('<CertificationAudits') && shell.includes("'certification'"),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s13:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const guide = src('data', 'userGuideData.ts').replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '?${name}'?: \\{`))[1] || '').split(/\n  \},\n/)[0];
  const screens = [tab, panel, host].join('\n');
  const needed = ['Certification', 'Invite the certification body', 'Freeze the audit pack', 'Revoke access', 'Answer', 'Record as an issue', 'Confirm and invite'];
  const quoted = [...section('project-delivery').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const absent = needed.filter((l) => quoted.includes(l) && !screens.includes(l));
  const bodyNeeded = ['Accept', 'Decline', 'Open the audit pack', 'Download', 'Ask the organisation'];
  const bodyQuoted = [...section('certification').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const bodyAbsent = bodyQuoted.filter((l) => !portal.includes(l));
  v.record('engagement-s13:the guide describes the certification body with labels on screen',
    needed.every((l) => quoted.includes(l)) && absent.length === 0 && bodyNeeded.every((l) => bodyQuoted.includes(l)) && bodyAbsent.length === 0,
    `not quoted: ${[...needed.filter((l) => !quoted.includes(l)), ...bodyNeeded.filter((l) => !bodyQuoted.includes(l))].join(', ') || 'none'}; `
      + `on no screen: ${[...absent, ...bodyAbsent].join(', ') || 'none'}`);
}

(async () => {
  const platform = await q.login(q.adminCredentials().email, q.adminCredentials().password);
  const billing = await q.login('billing@grcwisdom.com');
  const ciso = await q.login('group.compliance@alnoor.com');
  const sponsor = await q.login('group.admin@alnoor.com');
  const controlOwner = await q.login('group.risk@alnoor.com'); // owns AC-04
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const second = await q.login('risk@grcconsulting.com');
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const raw = async (who, url) => {
    const r = await fetch(q.API + url, { headers: { Authorization: `Bearer ${who.token}` } });
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  };
  const c = as(ciso);
  const alnoor = await prisma.tenant.findFirst({ where: { name: 'Al Noor Holding Group' }, select: { id: true } });
  const ksa = await prisma.tenant.findFirst({ where: { name: 'Al Noor Holding — KSA Region' }, select: { id: true } });
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const iso = await prisma.standard.findFirst({ where: { code: 'ISO27001' }, select: { id: true } });
  const memberOf = (pid, who) => prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: who.user.id } } });
  const onTrail = (tenantId, action, where = {}) => prisma.auditLog.count({ where: { tenantId, action, ...where } });

  // Consulting switched on for Al Noor, as the platform does it.
  const flag = await prisma.featureFlag.findUnique({ where: { key: 'Consulting Engagements' }, select: { id: true } });
  await as(platform)('POST', `/api/marketplace/feature-flags/${flag.id}/override`, { tenantId: alnoor.id, enabled: true, note: 'Al Noor pilots consulting engagements' });

  // ── 1. Start: the engagement, the firm, two consultants, the scope ──────
  const p = (await c('POST', '/api/projects', {
    name: `ISO 27001 certification ${stamp}`, startDate: day(0), targetEndDate: day(180), ownerId: sponsor.user.id, managerId: ciso.user.id,
    projectType: 'Certification', standardIds: [iso.id],
  })).json?.project;
  const pid = p?.id;
  const ph = (await c('POST', `/api/projects/${pid}/phases`, { name: 'Implementation', startDate: day(0), targetEndDate: day(120), ownerId: ciso.user.id })).json?.phase;
  await c('POST', `/api/projects/phases/${ph?.id}/tasks`, { name: 'Recertify privileged access', startDate: day(1), dueDate: day(30), assigneeId: ciso.user.id });
  const activated = await c('POST', `/api/projects/${pid}/activate`, {});
  const inv = (await c('POST', '/api/engagements/invitations', { projectId: pid, firmTenantId: gcp.id, deliveryStyle: 'ConsultantLed' })).json?.invitation;
  await as(lead)('POST', `/api/engagements/invitations/${inv?.id}/accept`);
  await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, lead))?.id}/approve`, { engagementRole: 'Lead', accessFrom: day(0) });
  for (const who of [consultant, second]) {
    await as(lead)('POST', `/api/engagements/${pid}/nominations`, { userId: who.user.id, engagementRole: 'Consultant' });
    await c('POST', `/api/engagements/${pid}/members/${(await memberOf(pid, who))?.id}/approve`, { engagementRole: 'Consultant', accessFrom: day(0) });
  }
  await c('POST', `/api/engagements/${pid}/scope`, {
    entityIds: [alnoor.id, ksa.id], frameworkIds: [iso.id], services: ['Documents', 'Controls', 'Risks', 'Assets', 'Vendors'],
    classificationCeiling: 'Confidential', validFrom: day(-1), validTo: day(210),
  });
  const draftScope = await prisma.engagementScopeVersion.findFirst({ where: { projectId: pid, status: 'Draft' } });
  const scopeApproved = await as(sponsor)('POST', `/api/engagements/${pid}/scope/${draftScope?.id}/approve`);
  const mna = await prisma.document.create({
    data: { code: `S13-MNA-${stamp}`, title: 'Acquisition of a regional processor', category: 'Plan', classification: 'Restricted', status: 'PUBLISHED', version: '1.0', content: 'Deal terms.', tenantId: alnoor.id, ownerId: sponsor.user.id },
  });
  const mnaRead = await as(consultant)('GET', `/api/engagements/${pid}/documents/${mna.id}`);
  v.record('engagement-s13:MVP start: consultant-led, two consultants approved, both entities in scope; the M&A plan is outside it and the firm\'s read is refused on Al Noor\'s trail',
    Boolean(pid) && activated.status === 200 && scopeApproved.status === 200 && mnaRead.status === 404
      && (await onTrail(alnoor.id, 'ENGAGEMENT_READ_REFUSED', { subjectId: mna.id, actorId: consultant.user.id })) === 1
      && (await onTrail(alnoor.id, 'ENGAGEMENT_PERSON_APPROVED', { subjectId: pid })) === 3
      && (await onTrail(alnoor.id, 'ENGAGEMENT_SCOPE_APPROVED', { subjectId: pid })) === 1,
    `project ${p?.ref}; activated ${activated.status} ${activated.json?.message || ''}; scope ${scopeApproved.status} ${scopeApproved.json?.message || ''}; M&A read ${mnaRead.status}`);

  // ── 5. The AC-04 evidence loop, then validation ─────────────────────────
  const R = (who) => (method, rest = '', body) => as(who)(method, `/api/engagements/${pid}/requests${rest}`, body);
  const asked = await R(consultant)('POST', '', {
    kind: 'Evidence', title: 'Quarterly access recertification, Q2', criteria: 'Signed recertification of every in-scope system',
    targetType: 'Control', targetRef: 'AC-04', periodFrom: '2026-04-01', periodTo: '2026-06-30', dueDate: day(10), assigneeId: ciso.user.id,
  });
  const reqId = asked.json?.request?.id;
  const tests = { relevant: 'Pass', complete: 'Pass', coversPeriod: 'Pass', authentic: 'NotApplicable' };
  await R(ciso)('POST', `/${reqId}/answer`, { kind: 'Upload', fileName: 'recert-q1.pdf', fileData: b64(pdf(`Q1 ${stamp}`)), classification: 'Internal', title: 'Recertification, Q1' });
  const returned = await R(consultant)('POST', `/${reqId}/review`, { outcome: 'Returned', tests: { ...tests, coversPeriod: 'Fail' }, testNotes: { coversPeriod: 'This is Q1, not current' }, note: 'Send the Q2 recertification' });
  await R(ciso)('POST', `/${reqId}/answer`, { kind: 'Upload', fileName: 'recert-q2.pdf', fileData: b64(pdf(`Q2 ${stamp}`)), classification: 'Internal', title: 'Recertification, Q2' });
  const accepted = await R(consultant)('POST', `/${reqId}/review`, { outcome: 'Accepted', tests });
  const ac04 = await prisma.controlImplementation.findFirst({ where: { tenantId: alnoor.id, control: { code: 'AC-04' } }, select: { id: true, ownerId: true, operatorId: true } });
  // The seed hands controls to whichever users it lists first, so who owns AC-04 varies; fix it as the walkthrough has it.
  await prisma.controlImplementation.update({ where: { id: ac04.id }, data: { ownerId: controlOwner.user.id, operatorId: sponsor.user.id } });
  // The control's owner implements it and attaches the evidence; the CISO, who neither owns, operates nor updated it, validates.
  await as(controlOwner)('PATCH', `/api/grc/implementations/${ac04.id}`, { status: 'Implemented' });
  await as(controlOwner)('POST', `/api/grc/implementations/${ac04.id}/evidence`, { title: 'Signed recertification, Q2', classification: 'Internal' });
  const validated = await c('POST', `/api/grc/implementations/${ac04.id}/validate`, { effectiveness: 'Effective', note: 'Q2 recertification signed for every system.' });
  const ac04After = await prisma.controlImplementation.findUnique({ where: { id: ac04.id }, select: { status: true } });
  v.record('engagement-s13:MVP controls: the AC-04 request is returned as not current, answered again and accepted; Al Noor validates AC-04 to Verified',
    asked.status === 201 && returned.status === 200 && accepted.status === 200 && validated.status === 200 && ac04After?.status === 'Verified',
    `asked ${asked.status} ${asked.json?.message || ''}; returned ${returned.status} ${returned.json?.message || ''}; accepted ${accepted.status} ${accepted.json?.message || ''}; `
      + `validated ${validated.status} ${validated.json?.message || ''} → ${ac04After?.status}`);

  // ── The A.5.15 gap, closed independently; the SoA issued ────────────────
  const A = `/api/engagements/${pid}/assessment`;
  const a515 = await prisma.standardClause.findFirst({ where: { standardId: iso.id, ref: 'A.5.15' }, select: { id: true } });
  const missing = await as(consultant)('POST', A, { tenantId: alnoor.id, clauseId: a515.id, result: 'Partial', justification: 'Access rules exist but privileged access is not recertified.', gapType: 'Implementation' });
  const gapId = missing.json?.assessment?.gap?.id;
  const I = (who, step, body) => as(who)('POST', `/api/grc/issues/${gapId}/${step}`, body);
  const responded = await I(ciso, 'respond', { responseType: 'Agree', responseNarrative: 'Agreed: privileged access was never recertified.', managementActionPlan: 'Recertify privileged access quarterly.' });
  const capped = await I(ciso, 'cap', { capOwnerId: ciso.user.id, capDueDate: day(30), capDescription: 'Recertify privileged access every quarter.' });
  const submitted = await I(ciso, 'submit-closure', { evidenceNote: 'Q2 privileged access recertified and signed.' });
  const selfClose = await I(ciso, 'close', { note: 'Closing my own action.' });
  const closed = await I(sponsor, 'close', { note: 'Re-performed the Q2 recertification for five systems.' });
  await as(consultant)('POST', A, { tenantId: alnoor.id, clauseId: a515.id, result: 'Conformant', justification: 'Privileged access recertified quarterly and signed.' });
  const soa = await raw(ciso, `/api/projects/${pid}/reports/soa?format=pdf&issue=true`);
  v.record('engagement-s13:MVP gap and SoA: the A.5.15 gap is closed by someone independent of the action, and the SoA is issued',
    missing.status === 201 && Boolean(gapId) && responded.status === 200 && capped.status === 200 && submitted.status === 200
      && selfClose.status === 403 && closed.status === 200 && soa.status === 200
      && (await prisma.reportIssue.count({ where: { projectId: pid, reportKey: 'delivery-soa', issued: true } })) === 1,
    `gap ${missing.status} ${missing.json?.message || ''}; respond ${responded.status} ${responded.json?.message || ''}; cap ${capped.status} ${capped.json?.message || ''}; `
      + `submit ${submitted.status} ${submitted.json?.message || ''}; self ${selfClose.status}; close ${closed.status} ${closed.json?.message || ''}; soa ${soa.status}`);

  // ── 7. The certification body ───────────────────────────────────────────
  const roles = (await as(platform)('GET', '/api/iam/roles')).json?.roles || [];
  const auditorRole = roles.find((r) => r.name === 'External Auditor')?.id;
  const plans = (await as(billing)('GET', '/api/billing/plans')).json?.plans || [];
  const planId = (plans.find((x) => (x.maxUsers ?? 0) >= 2 && x.isActive !== false) || plans[0])?.id;
  const onboard = (name, email) => as(platform)('POST', '/api/tenants/onboard', { name, type: 'AUDITOR', planId, admin: { email, name: `${name} lead auditor`, roleId: auditorRole } });
  const bodyEmail = `lead.auditor.${stamp}@cb-${stamp}.example.com`;
  const madeBody = await onboard(`S13 Certification Body ${stamp}`, bodyEmail);
  const madeRelated = await onboard(`S13 Sister Certification ${stamp}`, `auditor.${stamp}@grcconsulting.com`);
  const body = madeBody.json?.tenant;
  const related = madeRelated.json?.tenant;
  const signIn = async (email, temp) => {
    const first = await q.call('POST', '/api/auth/login', { body: { email, password: temp } });
    const fresh = `S13-${stamp}-Rotated!`;
    await q.call('POST', '/api/auth/change-password', { token: first.json?.token, body: { currentPassword: temp, newPassword: fresh } });
    return q.login(email, fresh);
  };
  const auditor = await signIn(bodyEmail, madeBody.json?.temporaryPassword);
  const cb = as(auditor);
  const CB = `/api/engagements/${pid}/certification`;

  const firmInvites = await as(lead)('POST', CB, { bodyTenantId: body?.id, accessFrom: day(0), accessTo: day(30) });
  const tooLong = await c('POST', CB, { bodyTenantId: body?.id, accessFrom: day(0), accessTo: day(200) });
  const warned = await c('POST', CB, { bodyTenantId: related?.id, accessFrom: day(0), accessTo: day(30) });
  const shortWhy = await c('POST', CB, { bodyTenantId: related?.id, accessFrom: day(0), accessTo: day(30), confirmed: true, reason: 'fine' });
  const reason = 'The sister company audits under a separate accreditation and its auditors never worked on this engagement.';
  const confirmed = await c('POST', CB, { bodyTenantId: related?.id, accessFrom: day(0), accessTo: day(30), confirmed: true, reason });
  const relatedRow = await prisma.certificationAccess.findUnique({ where: { id: confirmed.json?.access?.id || '' }, select: { warnings: true, confirmationReason: true } });
  const revoked = await c('POST', `${CB}/${confirmed.json?.access?.id}/revoke`, { reason: 'We chose an unrelated certification body.' });
  const invited = await c('POST', CB, { bodyTenantId: body?.id, accessFrom: day(0), accessTo: day(30) });
  const accessId = invited.json?.access?.id;
  v.record('engagement-s13:the organisation invites an auditor organisation for at most 180 days; a body related to the firm is a warning confirmed with a reason, kept on the record',
    madeBody.status === 201 && madeRelated.status === 201 && firmInvites.status === 404 && tooLong.status === 400 && tooLong.json?.code === 'TOO_LONG'
      && warned.status === 409 && warned.json?.code === 'INDEPENDENCE_WARNING' && /grcconsulting\.com/.test((warned.json?.warnings || []).join(' '))
      && shortWhy.status === 400 && confirmed.status === 201 && relatedRow?.confirmationReason === reason && JSON.parse(relatedRow?.warnings || '[]').length === 1
      && (await onTrail(alnoor.id, 'CERTIFICATION_BODY_INVITED', { subjectId: pid })) === 2 && revoked.status === 200
      && invited.status === 201 && (invited.json?.warnings || []).length === 0,
    `onboard ${madeBody.status}/${madeRelated.status} ${madeBody.json?.message || ''}; firm ${firmInvites.status}; too long ${tooLong.status} ${tooLong.json?.code || ''}; `
      + `warned ${warned.status} ${warned.json?.code || ''}; short ${shortWhy.status}; confirmed ${confirmed.status} ${confirmed.json?.message || ''}; revoke ${revoked.status}; invited ${invited.status} ${invited.json?.message || ''}`);

  // Readiness opinion and sign-off, so the pack's readiness report has them.
  await as(lead)('POST', `/api/engagements/${pid}/readiness/opinion`, { verdict: 'ReadyWithConditions', opinion: 'Ready for Stage 1; Stage 2 needs three months of AC-04 records.', conditions: 'Q3 recertification signed.' });
  const signedOff = await as(sponsor)('POST', `/api/engagements/${pid}/readiness/sign-off`, { note: 'We go to the Stage 1 audit on these figures.' });

  const mine = (await cb('GET', '/api/certification/mine')).json?.access || [];
  const beforeAccept = await cb('GET', `/api/certification/${accessId}`);
  const refusedBefore = await onTrail(alnoor.id, 'CERTIFICATION_READ_REFUSED', { actorId: auditor.user.id });
  const firmFreezes = await as(lead)('POST', `${CB}/packs`, {});
  const frozen = await c('POST', `${CB}/packs`, {});
  const accept = await cb('POST', `/api/certification/${accessId}/respond`, { decision: 'Accepted' });
  const view = (await cb('GET', `/api/certification/${accessId}`)).json;
  const items = view?.packs?.[0]?.items || [];
  const soaItem = items.find((i) => i.kind === 'soa');
  const file = await raw(auditor, `/api/certification/${accessId}/items/${soaItem?.id}/file`);
  const elsewhere = [
    await cb('GET', `/api/engagements/${pid}`), await cb('GET', `/api/projects/${pid}`), await cb('GET', CB),
    await cb('GET', `/api/engagements/${pid}/documents`), await cb('POST', `${CB}/packs`, {}),
  ].map((r) => r.status);
  const risks = (await cb('GET', '/api/grc/risks')).json?.risks || [];
  v.record('engagement-s13:the audit pack is frozen by the organisation: SoA, traceability and readiness issued, stored and hashed',
    firmFreezes.status === 404 && frozen.status === 201 && signedOff.status === 201
      && items.length === 3 && ['soa', 'evidence', 'readiness'].every((k) => items.some((i) => i.kind === k && /^[0-9a-f]{64}$/.test(i.sha256)))
      && (await prisma.reportIssue.count({ where: { projectId: pid, issued: true, reportKey: { in: ['delivery-soa', 'delivery-evidence', 'delivery-readiness'] } } })) === 4
      && (await onTrail(alnoor.id, 'AUDIT_PACK_FROZEN', { subjectId: pid })) === 1,
    `firm ${firmFreezes.status}; frozen ${frozen.status} ${frozen.json?.message || ''}; sign-off ${signedOff.status}; items ${JSON.stringify(items.map((i) => i.kind))}`);
  v.record('engagement-s13:the body reads the frozen pack, hash checked, inside its days and nothing else; reads before acceptance are refused on the organisation\'s trail',
    mine.some((a) => a.id === accessId && a.status === 'Invited') && beforeAccept.status === 404 && refusedBefore === 1 && accept.status === 200
      && file.status === 200 && sha(file.buf) === soaItem?.sha256 && file.buf.subarray(0, 4).toString() === '%PDF'
      && (await onTrail(alnoor.id, 'AUDIT_PACK_READ', { actorId: auditor.user.id })) === 1
      && elsewhere.every((s) => s === 404 || s === 403) && !risks.some((r) => r.tenantId === alnoor.id),
    `mine ${mine.length}; before ${beforeAccept.status}; refused ${refusedBefore}; accept ${accept.status}; file ${file.status} ${sha(file.buf) === soaItem?.sha256}; elsewhere ${elsewhere.join(',')}; risks ${risks.length}`);

  // ── Questions, evidence requests and one nonconformity ───────────────────
  const Q = `/api/certification/${accessId}/questions`;
  const question = await cb('POST', Q, { kind: 'Question', text: 'Who approves privileged access requests at the KSA Region?' });
  const evidence = await cb('POST', Q, { kind: 'EvidenceRequest', text: 'The Q2 privileged access recertification for the KSA Region.', clauseRef: 'A.5.15' });
  const noClause = await cb('POST', Q, { kind: 'Nonconformity', text: 'Leavers keep VPN access for up to ten days.' });
  const nc = await cb('POST', Q, { kind: 'Nonconformity', clauseRef: 'A.5.18', text: 'Leavers keep VPN access for up to ten days after their last day.' });
  const ids = { question: question.json?.question?.id, nc: nc.json?.question?.id };
  const answered = await c('POST', `${CB}/questions/${ids.question}/answer`, { answer: 'The KSA Region IT manager, recorded in the ticket.' });
  const answerNc = await c('POST', `${CB}/questions/${ids.nc}/answer`, { answer: 'Noted.' });
  const firmRecords = await as(lead)('POST', `${CB}/questions/${ids.nc}/record`, { recommendation: 'Remove VPN access on the last day.' });
  const recorded = await c('POST', `${CB}/questions/${ids.nc}/record`, {
    title: 'Leavers keep VPN access', condition: 'Ten days of VPN access after leaving', recommendation: 'Remove VPN access on the last working day.', riskRating: 'High',
  });
  const again = await c('POST', `${CB}/questions/${ids.nc}/record`, { recommendation: 'Remove VPN access on the last day.' });
  const issue = await prisma.issue.findUnique({ where: { id: recorded.json?.issue?.id || '' }, select: { source: true, sourceReference: true, tenantId: true, projectId: true, ref: true, status: true } });
  const bodyView = (await cb('GET', `/api/certification/${accessId}`)).json?.questions || [];
  v.record('engagement-s13:the body asks, asks for evidence and raises a nonconformity; the organisation answers and records the nonconformity as an External audit issue',
    question.status === 201 && question.json.question.ref === 'AQ-0001' && evidence.status === 201 && noClause.status === 400 && nc.status === 201
      && answered.status === 200 && answerNc.status === 409 && firmRecords.status === 404 && recorded.status === 201 && again.status === 409
      && issue?.source === 'ExternalAudit' && /^EXT-\d{4}-/.test(issue.ref) && issue.tenantId === alnoor.id && issue.projectId === pid
      && issue.sourceReference.includes('AQ-0003') && issue.sourceReference.includes('S13 Certification Body')
      && bodyView.find((x) => x.id === ids.nc)?.status === 'Recorded' && !('issueId' in (bodyView.find((x) => x.id === ids.nc) || {}))
      && bodyView.find((x) => x.id === ids.question)?.answer?.includes('KSA Region IT manager')
      && (await onTrail(body.id, 'AUDITOR_QUESTION_ASKED')) === 3 && (await onTrail(alnoor.id, 'NONCONFORMITY_RECORDED', { subjectId: recorded.json?.issue?.id || '' })) === 1,
    `question ${question.status} ${question.json?.question?.ref || question.json?.message || ''}; evidence ${evidence.status}; no clause ${noClause.status}; nc ${nc.status}; `
      + `answer ${answered.status}; answer nc ${answerNc.status}; firm records ${firmRecords.status}; recorded ${recorded.status} ${recorded.json?.message || ''}; again ${again.status}; issue ${JSON.stringify(issue)}`);

  // ── Frozen means frozen; outside its days nothing is read ───────────────
  await as(consultant)('POST', A, { tenantId: alnoor.id, clauseId: a515.id, result: 'Partial', justification: 'Two new systems have no recertification.', gapType: 'Implementation' });
  const reread = await raw(auditor, `/api/certification/${accessId}/items/${soaItem?.id}/file`);
  await prisma.certificationAccess.update({ where: { id: accessId }, data: { accessTo: new Date(`${day(-1)}T00:00:00Z`), accessFrom: new Date(`${day(-20)}T00:00:00Z`) } });
  const afterDays = await cb('GET', `/api/certification/${accessId}`);
  const fileAfter = await raw(auditor, `/api/certification/${accessId}/items/${soaItem?.id}/file`);
  v.record('engagement-s13:a frozen pack does not change when the records do; after its last day the body reads nothing, and each attempt is on the organisation\'s trail',
    reread.status === 200 && sha(reread.buf) === soaItem?.sha256 && afterDays.status === 404 && fileAfter.status === 404
      && (await onTrail(alnoor.id, 'CERTIFICATION_READ_REFUSED', { actorId: auditor.user.id })) === 3,
    `reread ${reread.status} same ${sha(reread.buf) === soaItem?.sha256}; after ${afterDays.status}/${fileAfter.status}`);

  // ── Internal audit by the firm that implemented the same framework ──────
  const done = await prisma.projectTask.create({
    data: { projectId: pid, phaseId: ph.id, ref: `T-S13-${stamp}`.slice(0, 20), name: 'Implement access recertification', side: 'Provider', status: 'Done', startDate: new Date(), dueDate: new Date(), sequence: 99 },
  }).catch((err) => ({ error: err.message }));
  const ia = (await c('POST', '/api/projects', {
    name: `Internal audit 9.2 ${stamp}`, startDate: day(0), targetEndDate: day(60), ownerId: sponsor.user.id, managerId: ciso.user.id, projectType: 'InternalAudit', standardIds: [iso.id],
  })).json?.project;
  const iaPhase = (await c('POST', `/api/projects/${ia?.id}/phases`, { name: 'Audit', startDate: day(0), targetEndDate: day(50), ownerId: ciso.user.id })).json?.phase;
  await c('POST', `/api/projects/phases/${iaPhase?.id}/tasks`, { name: 'Audit clauses 9 and 10', startDate: day(1), dueDate: day(40), assigneeId: ciso.user.id });
  await c('POST', `/api/projects/${ia?.id}/activate`, {});
  const iaWarned = await c('POST', '/api/engagements/invitations', { projectId: ia?.id, firmTenantId: gcp.id });
  const iaReason = 'The firm audits clauses 9 and 10 only, and a different team from the one that implemented Annex A.';
  const iaConfirmed = await c('POST', '/api/engagements/invitations', { projectId: ia?.id, firmTenantId: gcp.id, confirmed: true, independenceReason: iaReason });
  const iaRow = await prisma.engagementInvitation.findUnique({ where: { id: iaConfirmed.json?.invitation?.id || '' }, select: { independenceWarnings: true, independenceReason: true } });
  v.record('engagement-s13:a firm that implemented the same framework is warned against as internal auditor; going ahead needs a reason, kept on the invitation',
    !done.error && Boolean(ia?.id) && iaWarned.status === 409 && iaWarned.json?.code === 'INDEPENDENCE_WARNING' && /implementation work/.test((iaWarned.json?.warnings || []).join(' '))
      && iaConfirmed.status === 201 && iaRow?.independenceReason === iaReason && JSON.parse(iaRow?.independenceWarnings || '[]').length === 1
      && (await prisma.auditLog.count({ where: { tenantId: alnoor.id, action: 'ENGAGEMENT_FIRM_INVITED', subjectId: ia.id } })) === 1,
    `task ${done.error || 'ok'}; ia ${ia?.ref}; warned ${iaWarned.status} ${iaWarned.json?.code || iaWarned.json?.message || ''}; confirmed ${iaConfirmed.status} ${iaConfirmed.json?.message || ''}`);

  await prisma.$disconnect();
  v.finish(`${p?.ref}: AC-04 Verified, A.5.15 closed independently, SoA issued; the body read ${items.length} frozen reports and raised one nonconformity, recorded as ${issue?.ref}`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
