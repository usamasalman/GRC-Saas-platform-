/**
 * Documents: next versions of a published document.
 *
 * Here, with the seeded Global Bank tenant (a compliance manager who owns and
 * versions documents, two people who sign them, and staff who read them):
 *
 *   - a published policy gets a next version: started only on a published
 *     document with no open version and no legal hold, numbered at the start
 *     (1.0 → 1.1 Minor, 2.0 Major), one open at a time;
 *   - the draft is written on its own row with its own check-out; the live
 *     policy, its number and its readers are untouched until publish, and a
 *     reader sees that a draft exists but not what it says;
 *   - submitted with "what changed and why" to people who can sign and did
 *     not write it; returned and resubmitted; signed on the version's own
 *     text; the owner and its editors cannot sign it;
 *   - published in one go: the replaced version kept as Superseded with its
 *     hash, the proposals and link changes applied, open acknowledgement
 *     requests closed as superseded and reissued, a Minor version keeping
 *     acknowledgements of its major version and a Major one asking everyone;
 *   - a superseded version downloads labelled "not in force", is kept for its
 *     schedule from the day it was replaced, held by a legal hold, and
 *     disposed of on its own with its record kept;
 *   - a draft is as restricted as its policy: no read access, no next version;
 *   - a draft is discarded by its owner and kept; archive waits for it;
 *     going back starts a next version from an earlier text;
 *   - every route has a caller on a screen, and the guide quotes its labels.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/document-next-version-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const {
  nextNumber, sameMajor, planAcknowledgements, checkLinkChanges, supersededLabel, versionHash,
} = require('../../dist/services/documentVersions');
const { RETENTION_TRIGGERS, triggerMomentFor } = require('../../dist/services/retention');

const v = q.verdicts('document-next-version');
const stamp = Date.now().toString(36);

// ── The rules, without a database ───────────────────────────────────────────
{
  v.record('next-version:numbered at the start, 1.0 becomes 1.1 for Minor and 2.0 for Major',
    nextNumber('1.0', 'Minor') === '1.1' && nextNumber('1.4', 'Minor') === '1.5' && nextNumber('1.4', 'Major') === '2.0'
      && nextNumber('2.0', 'Major') === '3.0', 'nextNumber');
  const ask = (prev, next, signatures, openRequests = []) => planAcknowledgements({
    previousVersion: prev, newVersion: next, audienceIds: ['a', 'b', 'c'], openRequests, signatures,
  });
  const minor = ask('1.0', '1.1', [{ userId: 'a', version: '1.0' }], [{ userId: 'a', version: '1.0', signed: true }, { userId: 'b', version: '1.0', signed: false }]);
  const major = ask('1.1', '2.0', [{ userId: 'a', version: '1.0' }]);
  v.record('next-version:a Minor version keeps acknowledgements of its major version, a Major one asks everyone; unsigned requests are closed and reissued',
    sameMajor('1.0', '1.3') && !sameMajor('1.3', '2.0')
      && JSON.stringify(minor.ask) === '["b","c"]' && JSON.stringify(minor.supersede) === '[{"userId":"b","version":"1.0"}]'
      && JSON.stringify(major.ask) === '["a","b","c"]',
    `minor ${JSON.stringify(minor)}; major ${JSON.stringify(major)}`);
  const bad = checkLinkChanges({ add: [{ target: 'vendor', id: 'x' }] });
  v.record('next-version:link changes are proposals of controls, risks and clauses only, and labels say not in force',
    !bad.ok && checkLinkChanges({ add: [{ target: 'control', id: 'c1' }], remove: ['l1', 'l1'] }).ok
      && checkLinkChanges({ remove: ['l1', 'l1'] }).value.remove.length === 1
      && supersededLabel(new Date('2027-03-12T10:00:00Z'), '2.0') === 'Superseded on 12 Mar 2027 by v2.0 — not in force'
      && RETENTION_TRIGGERS.includes('Superseded') && triggerMomentFor('Superseded', { publishedAt: new Date(), createdAt: new Date() }) === null,
    'checkLinkChanges / supersededLabel / Superseded trigger');
}

// ── Every route has a caller; the guide quotes labels that are on screen ────
{
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const panel = src('pages', 'documents', 'NextVersionPanel.tsx');
  const detail = src('pages', 'documents', 'DocumentDetail.tsx');
  const queue = src('pages', 'documents', 'ApprovalQueue.tsx');
  const retention = src('pages', 'documents', 'RetentionSchedules.tsx');
  const request = src('pages', 'grc', 'project', 'RequestDetail.tsx');
  const callers = {
    'read the next version': /apiClient\.get\(`\/api\/documents\/\$\{documentId\}\/next-version`\)/.test(detail),
    'start, change': /apiClient\.post\(base, \{ changeType, reason, fromVersionId/.test(panel) && /apiClient\.patch\(base, \{/.test(panel),
    'check out, check in, submit, publish, discard': ['checkout', 'checkin', 'submit', 'publish', 'discard'].every((a) => panel.includes(`\`\${base}/${a}\``)),
    'download a version': /\/versions\/\$\{ver\.id\}\/download`/.test(detail),
    'dispose of a version': /`\/api\/retention\/versions\/\$\{disposing\.id\}\/dispose`/.test(retention),
    'the queue shows next versions': !/status: 'IN_REVIEW', pendingForMe/.test(queue) && queue.includes('myApproval?.versionNumber') && queue.includes("initialTab={reading.myApproval?.versionId ? 'next' : 'reader'}"),
    'an answer says which version was in force': request.includes('linked while v{ans.documentVersion} was in force'),
    'the panel mounted': detail.includes('<NextVersionPanel'),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('next-version:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const guide = src('data', 'userGuideData.ts').replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '?${name}'?: \\{`))[1] || '').split(/\n  \},\n/)[0];
  const screens = [panel, detail, queue, retention].join('\n');
  const needed = ['Next version', 'Start next version', 'Submit for approval', 'Publish version', 'Discard this version', 'Start next version from this text', 'Read'];
  const quoted = [...section('library').matchAll(/"([^"]+)"/g), ...section('tasks').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const ours = quoted.filter((l) => needed.includes(l) || l === 'next version');
  const absent = ours.filter((l) => !screens.includes(l));
  v.record('next-version:the guide describes next versions with labels on screen',
    needed.every((l) => quoted.includes(l)) && absent.length === 0,
    `not quoted: ${needed.filter((l) => !quoted.includes(l)).join(', ') || 'none'}; on no screen: ${absent.join(', ') || 'none'}`);
}

(async () => {
  const manager = await q.login('eleanor.vance@globalbank.com'); // owns, versions, signs, retention
  const approver = await q.login('sarah.jenkins@globalbank.com'); // signs
  const auditor = await q.login('marcus.thorne@auditco.com'); // signs
  const staff = await q.login('alex.rivera@globalbank.com'); // reads
  const other = await q.login('risk@globalbank.com'); // reads, never signs
  const pw = q.demoPassword();
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const m = as(manager);
  const trail = (subjectId, action) => prisma.auditLog.findMany({ where: { subjectId, action }, select: { payload: true } });
  const raw = async (who, url) => {
    const r = await fetch(q.API + url, { headers: { Authorization: `Bearer ${who.token}` } });
    return { status: r.status, text: await r.text(), header: r.headers.get('x-version-status') };
  };

  // ── A published policy, v1.0, read by staff and not yet by the other ─────
  const v1 = 'Access is granted on least privilege.\nAccess is reviewed every quarter.\nLeavers lose access on their last day.';
  const created = await m('POST', '/api/documents', { code: `NV-POL-${stamp}`, title: 'Access Control Policy', category: 'Policy', classification: 'Internal', content: v1 });
  const id = created.json?.document?.id;
  await m('POST', `/api/documents/${id}/submit`, { approverIds: [approver.user.id] });
  await as(approver)('POST', `/api/documents/${id}/approve`, { password: pw, decision: 'Approved' });
  const published = await m('POST', `/api/documents/${id}/publish`, { audienceKind: 'Everyone' });
  const acked = await as(staff)('POST', `/api/documents/${id}/acknowledge`);
  v.record('next-version:the policy is published at v1.0 and staff acknowledge it',
    created.status === 201 && published.status === 200 && acked.status === 200,
    `create ${created.status}; publish ${published.status} ${published.json?.message || ''}; ack ${acked.status}`);
  const N = `/api/documents/${id}/next-version`;

  // ── Starting ─────────────────────────────────────────────────────────────
  const draftDoc = (await m('POST', '/api/documents', { code: `NV-DRAFT-${stamp}`, title: 'Draft only', category: 'Policy', classification: 'Internal', content: 'Not yet' })).json?.document;
  const onDraft = await m('POST', `/api/documents/${draftDoc?.id}/next-version`, { changeType: 'Minor', reason: 'Trying on a draft document' });
  const byStaff = await as(staff)('POST', N, { changeType: 'Minor', reason: 'Staff should not start this' });
  const noReason = await m('POST', N, { changeType: 'Minor', reason: 'short' });
  await prisma.document.update({ where: { id }, data: { legalHoldAt: new Date(), legalHoldMatter: 'NV-TEST' } });
  const held = await m('POST', N, { changeType: 'Minor', reason: 'Annual review of the access policy' });
  await prisma.document.update({ where: { id }, data: { legalHoldAt: null, legalHoldMatter: null } });
  const started = await m('POST', N, { changeType: 'Minor', reason: 'Annual review of the access policy' });
  const twice = await m('POST', N, { changeType: 'Major', reason: 'A second draft at the same time' });
  const afterStart = await prisma.document.findUnique({ where: { id }, select: { status: true, version: true, content: true, openVersionId: true } });
  v.record('next-version:started only on a published document, by someone who versions it, with a reason, never under legal hold, one at a time',
    onDraft.status === 409 && onDraft.json?.code === 'NOT_PUBLISHED' && byStaff.status === 403 && noReason.status === 400
      && held.status === 423 && started.status === 201 && started.json?.version?.versionNumber === '1.1'
      && twice.status === 409 && twice.json?.code === 'VERSION_OPEN'
      && afterStart.status === 'PUBLISHED' && afterStart.version === '1.0' && afterStart.content === v1 && afterStart.openVersionId === started.json?.version?.id
      && (await trail(id, 'DOCUMENT_VERSION_STARTED')).length === 1,
    `draft ${onDraft.status}; staff ${byStaff.status}; reason ${noReason.status}; hold ${held.status}; start ${started.status} ${started.json?.version?.versionNumber}; twice ${twice.status}; ${JSON.stringify({ ...afterStart, content: undefined })}`);
  const versionId = started.json?.version?.id;

  // ── Readers see that a draft exists, not what it says ────────────────────
  const staffNext = await as(staff)('GET', N);
  const staffDoc = await as(staff)('GET', `/api/documents/${id}`);
  const staffDraft = staffDoc.json?.document?.versions?.find((x) => x.id === versionId);
  v.record('next-version:a reader sees "Version 1.1 in draft" but not its text, and cannot open the draft',
    staffNext.status === 404 && staffDoc.status === 200 && staffDoc.json?.openVersion?.versionNumber === '1.1' && staffDoc.json?.openVersion?.state === 'Draft'
      && staffDraft && staffDraft.content === null,
    `next ${staffNext.status}; banner ${JSON.stringify(staffDoc.json?.openVersion)}; draft content ${JSON.stringify(staffDraft?.content)}`);

  // ── Writing it ───────────────────────────────────────────────────────────
  const v11 = 'Access is granted on least privilege.\nAccess is reviewed every quarter by the system owner.\nLeavers lose access on their last day.\nPrivileged access is reviewed monthly.';
  const checkedOut = await m('POST', `${N}/checkout`);
  const outAgain = await m('POST', `${N}/checkout`);
  const liveCheckout = await m('POST', `/api/documents/${id}/checkout`);
  const checkedIn = await m('POST', `${N}/checkin`, { content: v11, summary: 'Owner reviews; privileged access monthly' });
  const afterEdit = await prisma.document.findUnique({ where: { id }, select: { content: true, version: true } });
  const row = await prisma.documentVersion.findUnique({ where: { id: versionId }, select: { content: true, versionNumber: true, editors: { select: { userId: true } } } });
  v.record('next-version:the draft has its own check-out and text; the live policy and its number do not move; the writer is an editor',
    checkedOut.status === 200 && outAgain.status === 409 && liveCheckout.status >= 400 && checkedIn.status === 200
      && afterEdit.content === v1 && afterEdit.version === '1.0' && row.content === v11 && row.versionNumber === '1.1'
      && row.editors.some((e) => e.userId === manager.user.id),
    `out ${checkedOut.status}/${outAgain.status}; live checkout ${liveCheckout.status}; in ${checkedIn.status}; live ${afterEdit.version}; draft ${row.versionNumber}`);

  // ── Proposals ────────────────────────────────────────────────────────────
  const control = await prisma.control.findFirst({ where: { tenantId: manager.user.tenantId }, select: { id: true } })
    || await prisma.control.findFirst({ where: { tenantId: null }, select: { id: true } });
  const toMajor = await m('PATCH', N, { changeType: 'Major' });
  const numberMajor = (await prisma.documentVersion.findUnique({ where: { id: versionId }, select: { versionNumber: true } })).versionNumber;
  const toMinor = await m('PATCH', N, { changeType: 'Minor' });
  const badClass = await m('PATCH', N, { proposedClassification: 'TopSecret' });
  const badRemove = await m('PATCH', N, { proposedLinks: { remove: ['not-a-link-of-this-document'] } });
  const proposed = await m('PATCH', N, {
    proposedTitle: 'Access Control Policy (2027)', proposedClassification: 'Confidential',
    proposedLinks: control ? { add: [{ target: 'control', id: control.id }] } : { add: [] },
  });
  const read = await m('GET', N);
  v.record('next-version:the change type moves the number until submit; title, classification and links are proposals checked like edits',
    toMajor.status === 200 && numberMajor === '2.0' && toMinor.status === 200 && badClass.status === 400 && badRemove.status === 400
      && proposed.status === 200 && read.json?.version?.versionNumber === '1.1' && read.json?.version?.proposedTitle === 'Access Control Policy (2027)'
      && (!control || read.json?.version?.proposedLinks?.add?.length === 1),
    `major ${toMajor.status} ${numberMajor}; class ${badClass.status}; remove ${badRemove.status}; proposed ${proposed.status} ${proposed.json?.message || ''}; links ${JSON.stringify(read.json?.version?.proposedLinks)}`);

  // ── Submit, return, resubmit ─────────────────────────────────────────────
  const shortSummary = await m('POST', `${N}/submit`, { summary: 'tweaks', approverIds: [approver.user.id] });
  const selfAsk = await m('POST', `${N}/submit`, { summary: 'Owner reviews access; privileged access monthly', approverIds: [manager.user.id] });
  const notSigner = await m('POST', `${N}/submit`, { summary: 'Owner reviews access; privileged access monthly', approverIds: [staff.user.id] });
  const submitted = await m('POST', `${N}/submit`, { summary: 'Owner reviews access; privileged access monthly', approverIds: [approver.user.id, auditor.user.id] });
  const listA = await q.call('GET', '/api/documents?pendingForMe=true', { token: approver.token });
  const listM = await q.call('GET', '/api/documents?pendingForMe=true', { token: auditor.token });
  const mineA = listA.json?.documents?.find((d) => d.id === id)?.myApproval;
  const mineM = listM.json?.documents?.find((d) => d.id === id)?.myApproval;
  const whileInReview = await m('POST', `${N}/checkout`);
  const docInReview = await prisma.document.findUnique({ where: { id }, select: { status: true } });
  v.record('next-version:submitted with what changed and why to people who can sign and did not write it; the queue shows it as v1.1 while v1.0 stays published',
    shortSummary.status === 400 && selfAsk.status === 403 && notSigner.status === 400 && submitted.status === 200
      && listA.status === 200 && mineA?.versionNumber === '1.1' && mineA?.canSignNow === true && mineM?.canSignNow === false
      && whileInReview.status === 409 && docInReview.status === 'PUBLISHED',
    `short ${shortSummary.status}; self ${selfAsk.status}; staff ${notSigner.status}; submit ${submitted.status} ${submitted.json?.message || ''}; `
      + `A ${JSON.stringify(mineA)}; M ${JSON.stringify(mineM)}; checkout ${whileInReview.status}; doc ${docInReview.status}`);

  const returned = await as(approver)('POST', `/api/documents/${id}/reject`, { reason: 'Say who the system owner is' });
  const afterReturn = await prisma.documentVersion.findUnique({ where: { id: versionId }, select: { state: true } });
  const liveAfterReturn = await prisma.document.findUnique({ where: { id }, select: { status: true, content: true } });
  const resubmitted = await m('POST', `${N}/submit`, { summary: 'Owner reviews access; privileged access monthly; system owner named', approverIds: [approver.user.id, auditor.user.id] });
  v.record('next-version:returned, the draft goes back to its author and the published policy is untouched; resubmitted fresh',
    returned.status === 200 && afterReturn.state === 'Returned' && liveAfterReturn.status === 'PUBLISHED' && liveAfterReturn.content === v1
      && resubmitted.status === 200,
    `return ${returned.status} ${returned.json?.message || ''}; state ${afterReturn.state}; resubmit ${resubmitted.status}`);

  // ── Signing ──────────────────────────────────────────────────────────────
  const ownerSigns = await m('POST', `/api/documents/${id}/approve`, { password: pw });
  const outOfTurn = await as(auditor)('POST', `/api/documents/${id}/approve`, { password: pw });
  const signedA = await as(approver)('POST', `/api/documents/${id}/approve`, { password: pw, decision: 'Approved' });
  const banner = (await as(staff)('GET', `/api/documents/${id}`)).json?.openVersion;
  const signedM = await as(auditor)('POST', `/api/documents/${id}/approve`, { password: pw, decision: 'Approved' });
  const signedRow = await prisma.documentVersion.findUnique({ where: { id: versionId }, select: { state: true, content: true, fileUrl: true } });
  const signTrail = (await trail(id, 'DOCUMENT_VERSION_APPROVED')).map((t) => JSON.parse(t.payload));
  const liveAfterSign = await prisma.document.findUnique({ where: { id }, select: { status: true, content: true } });
  v.record('next-version:each approver signs the version\'s own text in turn; the owner cannot; all signed it is Approved and the live policy unchanged',
    ownerSigns.status === 404 && outOfTurn.status === 409 && signedA.status === 200 && signedM.status === 200 && signedM.json?.allApproved === true
      && banner?.state === 'InReview' && banner?.approved === 1 && banner?.approvers === 2
      && signedRow.state === 'Approved' && signTrail.length === 2 && signTrail.every((p) => p.contentHash === versionHash(signedRow.content, signedRow.fileUrl))
      && liveAfterSign.status === 'PUBLISHED' && liveAfterSign.content === v1,
    `owner ${ownerSigns.status}; out of turn ${outOfTurn.status}; A ${signedA.status} ${signedA.json?.message || ''}; banner ${JSON.stringify(banner)}; M ${signedM.status}; state ${signedRow.state}`);

  // ── Publishing ───────────────────────────────────────────────────────────
  const archiveFirst = await m('POST', `/api/documents/${id}/archive`);
  const staffPublish = await as(staff)('POST', `${N}/publish`);
  const pub = await m('POST', `${N}/publish`);
  const doc11 = await prisma.document.findUnique({ where: { id }, select: { version: true, publishedVersion: true, content: true, title: true, classification: true, openVersionId: true, status: true } });
  const rows = await prisma.documentVersion.findMany({ where: { documentId: id }, select: { id: true, versionNumber: true, state: true, supersededBy: true, content: true } });
  const old = rows.find((r) => r.state === 'Superseded');
  const supTrail = (await trail(id, 'DOCUMENT_VERSION_SUPERSEDED')).map((t) => JSON.parse(t.payload));
  const pubTrail = await trail(id, 'DOCUMENT_PUBLISHED');
  const links = control ? await prisma.documentLink.count({ where: { documentId: id, controlId: control.id } }) : 1;
  v.record('next-version:publishing makes v1.1 the policy in force in one step and keeps v1.0 as superseded with its hash',
    archiveFirst.status === 409 && staffPublish.status === 403 && pub.status === 200
      && doc11.version === '1.1' && doc11.publishedVersion === '1.1' && doc11.content === v11 && doc11.title === 'Access Control Policy (2027)'
      && doc11.classification === 'Confidential' && doc11.openVersionId === null && doc11.status === 'PUBLISHED'
      && rows.find((r) => r.id === versionId)?.state === 'Published' && old?.versionNumber === '1.0' && old?.supersededBy === '1.1' && old?.content === v1
      && supTrail.length === 1 && supTrail[0].superseded.hash === versionHash(v1, null) && supTrail[0].by.hash === versionHash(v11, null)
      && pubTrail.length === 2 && links === 1,
    `archive ${archiveFirst.status}; staff ${staffPublish.status}; publish ${pub.status} ${pub.json?.message || ''}; ${JSON.stringify(doc11 && { ...doc11, content: undefined })}; `
      + `rows ${JSON.stringify(rows.map((r) => [r.versionNumber, r.state]))}; links ${links}`);

  const reqs = await prisma.acknowledgementRequest.findMany({ where: { documentId: id }, select: { userId: true, version: true, supersededAt: true } });
  const staffReq11 = reqs.find((r) => r.userId === staff.user.id && r.version === '1.1');
  const otherOld = reqs.find((r) => r.userId === other.user.id && r.version === '1.0');
  const otherNew = reqs.find((r) => r.userId === other.user.id && r.version === '1.1');
  const coverage = await m('GET', `/api/documents/${id}/acknowledgements`);
  const staffOwes = coverage.json?.outstanding?.some((o) => o.userId === staff.user.id);
  const otherMine = await as(other)('GET', '/api/documents/my-acknowledgements');
  const otherRows = (otherMine.json?.requests || []).filter((r) => r.documentId === id);
  v.record('next-version:a Minor version asks nobody who acknowledged v1.0 again; an unsigned v1.0 request is closed as superseded and reissued for v1.1',
    !staffReq11 && otherOld?.supersededAt && otherNew && !otherNew.supersededAt && coverage.status === 200 && staffOwes === false
      && otherRows.length === 1 && otherRows[0].version === '1.1' && pub.json?.requestsSuperseded >= 1,
    `staff 1.1 ${Boolean(staffReq11)}; other 1.0 superseded ${Boolean(otherOld?.supersededAt)}; other 1.1 ${Boolean(otherNew)}; staff owes ${staffOwes}; other sees ${JSON.stringify(otherRows.map((r) => r.version))}`);

  // ── The superseded version, as a record ──────────────────────────────────
  const dl = await raw(staff, `/api/documents/${id}/versions/${old?.id}/download`);
  v.record('next-version:the superseded version stays readable, printed "Superseded on … by v1.1 — not in force"',
    dl.status === 200 && /Superseded on \d{2} [A-Z][a-z]{2} \d{4} by v1\.1 — not in force/.test(dl.text) && dl.text.includes(v1) && /not in force/.test(dl.header || ''),
    `download ${dl.status}; header ${dl.header}`);

  const schedule = await m('POST', '/api/retention/schedules', { code: `NV-${stamp}`.toUpperCase().slice(0, 32), name: 'Replaced policy versions', retainMonths: 12, trigger: 'Superseded', reviewWindowDays: 30 });
  const assigned = await m('PUT', `/api/retention/documents/${id}/schedule`, { scheduleId: schedule.json?.schedule?.id });
  const dated = await prisma.documentVersion.findUnique({ where: { id: old?.id }, select: { disposalDueAt: true, supersededAt: true } });
  const docDue = await prisma.document.findUnique({ where: { id }, select: { disposalDueAt: true } });
  const expected = new Date(dated.supersededAt); expected.setUTCMonth(expected.getUTCMonth() + 12);
  v.record('next-version:a superseded version is kept for its schedule from the day it was replaced; the version in force is not dated by a Superseded schedule',
    schedule.status === 201 && assigned.status === 200 && dated.disposalDueAt && Math.abs(new Date(dated.disposalDueAt) - expected) < 3 * 86_400_000
      && docDue.disposalDueAt === null,
    `schedule ${schedule.status} ${schedule.json?.message || ''}; assign ${assigned.status}; due ${dated.disposalDueAt}; doc ${docDue.disposalDueAt}`);

  await prisma.documentVersion.update({ where: { id: old.id }, data: { disposalDueAt: new Date(Date.now() - 86_400_000) } });
  await prisma.document.update({ where: { id }, data: { legalHoldAt: new Date(), legalHoldMatter: 'NV-HOLD' } });
  const heldQueue = await m('GET', '/api/retention/queue');
  const heldRow = heldQueue.json?.versions?.find((x) => x.id === old.id);
  const heldDispose = await m('POST', `/api/retention/versions/${old.id}/dispose`, { reason: 'Retention period ended' });
  await prisma.document.update({ where: { id }, data: { legalHoldAt: null, legalHoldMatter: null } });
  const dueQueue = await m('GET', '/api/retention/queue');
  const dueRow = dueQueue.json?.versions?.find((x) => x.id === old.id);
  const liveDispose = await m('POST', `/api/retention/versions/${versionId}/dispose`, { reason: 'Retention period ended' });
  const disposed = await m('POST', `/api/retention/versions/${old.id}/dispose`, { reason: 'Retention period ended' });
  const kept = await prisma.documentVersion.findUnique({ where: { id: old.id }, select: { content: true, versionNumber: true, fileHash: true, disposedAt: true, supersededAt: true } });
  const keptApprovals = await prisma.approvalQueue.count({ where: { documentId: id, versionId: null, status: 'APPROVED' } });
  const disposalTrail = (await trail(id, 'DOCUMENT_VERSION_DISPOSED')).map((t) => JSON.parse(t.payload));
  const gone = await raw(staff, `/api/documents/${id}/versions/${old.id}/download`);
  const liveStill = await prisma.document.findUnique({ where: { id }, select: { content: true, status: true } });
  v.record('next-version:a legal hold holds every version; once due a superseded version is disposed of on its own, its record kept and the policy in force untouched',
    heldRow?.state === 'Held' && heldDispose.status === 423 && dueRow?.state === 'Due' && liveDispose.status === 409 && disposed.status === 200
      && kept.content === null && kept.versionNumber === '1.0' && kept.disposedAt && kept.supersededAt && keptApprovals >= 1
      && disposalTrail.length === 1 && disposalTrail[0].hash === versionHash(v1, null) && disposalTrail[0].version === '1.0'
      && gone.status === 410 && liveStill.content === v11 && liveStill.status === 'PUBLISHED',
    `held ${heldRow?.state} ${heldDispose.status}; due ${dueRow?.state}; live ${liveDispose.status}; dispose ${disposed.status} ${disposed.json?.message || ''}; download ${gone.status}`);

  // ── A Major version asks everyone again ──────────────────────────────────
  const v20 = `${v11}\nAll access is federated through the identity provider.`;
  const major = await m('POST', N, { changeType: 'Major', reason: 'Move all access to the identity provider' });
  await m('POST', `${N}/checkout`);
  await m('POST', `${N}/checkin`, { content: v20 });
  await m('POST', `${N}/submit`, { summary: 'All access federated through the identity provider', approverIds: [approver.user.id] });
  await as(approver)('POST', `/api/documents/${id}/approve`, { password: pw });
  const pub2 = await m('POST', `${N}/publish`);
  const staffReq20 = await prisma.acknowledgementRequest.findFirst({ where: { documentId: id, userId: staff.user.id, version: '2.0' } });
  const coverage2 = await m('GET', `/api/documents/${id}/acknowledgements`);
  v.record('next-version:a Major version asks the whole audience again, and an acknowledgement of v1.x no longer counts',
    major.json?.version?.versionNumber === '2.0' && pub2.status === 200 && staffReq20 && coverage2.json?.outstanding?.some((o) => o.userId === staff.user.id),
    `major ${major.json?.version?.versionNumber}; publish ${pub2.status} ${pub2.json?.message || ''}; staff asked ${Boolean(staffReq20)}`);

  // ── Discarding, and going back ───────────────────────────────────────────
  const v11row = await prisma.documentVersion.findFirst({ where: { documentId: id, versionNumber: '1.1', state: 'Superseded' }, select: { id: true } });
  const back = await m('POST', N, { changeType: 'Minor', reason: 'Federation is delayed; restore the v1.1 wording', fromVersionId: v11row?.id });
  const backRow = await prisma.documentVersion.findUnique({ where: { id: back.json?.version?.id || '' }, select: { content: true, versionNumber: true, baseVersion: true } });
  await m('POST', `${N}/submit`, { summary: 'Restore the v1.1 wording while federation is delayed', approverIds: [approver.user.id] });
  const signerDiscards = await as(approver)('POST', `${N}/discard`, { reason: 'Approvers do not discard drafts' });
  const discarded = await m('POST', `${N}/discard`, { reason: 'Federation went live after all' });
  const afterDiscard = await prisma.documentVersion.findUnique({ where: { id: back.json?.version?.id || '' }, select: { state: true, discardReason: true } });
  const withdrawn = await prisma.approvalQueue.count({ where: { versionId: back.json?.version?.id || '', status: 'WITHDRAWN' } });
  const lateSign = await as(approver)('POST', `/api/documents/${id}/approve`, { password: pw });
  const docEnd = await prisma.document.findUnique({ where: { id }, select: { openVersionId: true, version: true, content: true } });
  const archived = await m('POST', `/api/documents/${id}/archive`);
  v.record('next-version:going back starts a next version from an earlier text; the owner discards it, kept with its reason, its approvals withdrawn; then archive goes ahead',
    back.status === 201 && backRow?.content === v11 && backRow?.versionNumber === '2.1' && backRow?.baseVersion === '2.0'
      && signerDiscards.status === 403 && discarded.status === 200 && afterDiscard.state === 'Discarded' && afterDiscard.discardReason
      && withdrawn === 1 && lateSign.status === 404 && docEnd.openVersionId === null && docEnd.version === '2.0' && docEnd.content === v20
      && archived.status === 200,
    `back ${back.status} ${backRow?.versionNumber}/${backRow?.baseVersion}; signer ${signerDiscards.status}; discard ${discarded.status}; ${afterDiscard.state}; withdrawn ${withdrawn}; late ${lateSign.status}; archive ${archived.status}`);

  // ── A draft is as restricted as its policy ───────────────────────────────
  const role = (await prisma.user.findUnique({ where: { id: manager.user.id }, select: { role: true } })).role;
  const secret = (await m('POST', '/api/documents', { code: `NV-SEC-${stamp}`, title: 'Privileged Access Standard', category: 'Standard', classification: 'Confidential', content: 'Break-glass accounts are sealed.' })).json?.document;
  await m('POST', `/api/documents/${secret?.id}/submit`, { approverIds: [approver.user.id] });
  await as(approver)('POST', `/api/documents/${secret?.id}/approve`, { password: pw });
  const secretPub = await m('POST', `/api/documents/${secret?.id}/publish`, { audienceKind: 'Role', audienceValue: role });
  const secretStart = await m('POST', `/api/documents/${secret?.id}/next-version`, { changeType: 'Minor', reason: 'Add the quarterly seal check' });
  const outsiderRead = await as(auditor)('GET', `/api/documents/${secret?.id}/next-version`);
  const outsiderDoc = await as(auditor)('GET', `/api/documents/${secret?.id}`);
  const outsiderStart = await as(auditor)('POST', `/api/documents/${secret?.id}/next-version/publish`);
  v.record('next-version:someone who can sign but may not read a Confidential policy cannot see or act on its next version',
    secretPub.status === 200 && secretStart.status === 201 && outsiderDoc.status === 404 && outsiderRead.status === 404 && outsiderStart.status === 404,
    `publish ${secretPub.status} ${secretPub.json?.message || ''}; start ${secretStart.status}; doc ${outsiderDoc.status}; next ${outsiderRead.status}; publish ${outsiderStart.status}`);

  // ── Never-published documents keep the original flow ─────────────────────
  const plainSubmit = await m('POST', `/api/documents/${draftDoc?.id}/submit`, { approverIds: [approver.user.id] });
  const plainSign = await as(approver)('POST', `/api/documents/${draftDoc?.id}/approve`, { password: pw });
  const plain = await prisma.document.findUnique({ where: { id: draftDoc?.id }, select: { status: true, openVersionId: true } });
  v.record('next-version:a document never published is approved on the document itself, exactly as before',
    plainSubmit.status === 200 && plainSign.status === 200 && plain.status === 'APPROVED' && plain.openVersionId === null,
    `submit ${plainSubmit.status}; sign ${plainSign.status}; ${plain.status}`);

  await prisma.$disconnect();
  v.finish(`NV-POL-${stamp}: v1.0 → v1.1 (minor) → v2.0 (major); v1.0 disposed of on its own`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
