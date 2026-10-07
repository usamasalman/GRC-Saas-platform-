/**
 * Consulting engagement, sprint 11: risk and asset challenges, proposed
 * risks and assets, and the firm's drafts of risk appetite.
 *
 * Here, with the seeded pilot (OmniOps and GRC Consulting Partners):
 *
 *   - the firm's Lead or a Consultant challenges a shared risk's scores with
 *     its reason; the register, its tolerance count and the dashboard ignore
 *     the challenge while it is open;
 *   - the owner adopts it: RSK-008 (Operational, no verified controls) at
 *     4 x 5 = 20 goes beyond the Operational tolerance of 16, the
 *     beyond-tolerance count rises by one, and the history keeps both scores;
 *   - the residual follows the risk's verified controls: challenged to 4 x 5,
 *     the phishing risk would sit at a residual of 5, and the comparison says
 *     so before anyone decides;
 *   - Keep needs the reason, Adjust takes the owner's scores, several are
 *     decided at once, only the owner decides, and a withdrawn challenge
 *     stays in the history;
 *   - an asset challenge moves C, I, A and criticality only when adopted;
 *   - a proposed risk counts nowhere until accepted, then is an ordinary risk;
 *   - the firm drafts risk appetite, which its drafter cannot approve;
 *   - every route has a caller on a screen, and the guide quotes its labels.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s11-challenges-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const { checkChallenge, checkDecision, scoresAfter, checkProposal } = require('../../dist/services/registerChallenges');

const v = q.verdicts('engagement-s11');
const DAY = 86_400_000;
const day = (n) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);

// ── The rules, without a database ───────────────────────────────────────────
{
  const cur = { likelihood: 2, impact: 4 };
  v.record('engagement-s11:a challenge gives new scores and why; Keep needs a reason, Adjust the owner\'s scores',
    checkChallenge('Risk', { likelihood: 4, impact: 5, reason: 'Restore tests have never been run' }, cur).ok
      && checkChallenge('Risk', { likelihood: 2, impact: 4, reason: 'Restore tests have never been run' }, cur).code === 'NO_CHANGE'
      && checkChallenge('Risk', { likelihood: 6, impact: 5, reason: 'Restore tests have never been run' }, cur).code === 'BAD_SCORES'
      && checkChallenge('Risk', { likelihood: 4, impact: 5, reason: 'no' }, cur).code === 'REASON_REQUIRED'
      && checkDecision('Risk', { decision: 'Keep' }).code === 'REASON_REQUIRED'
      && checkDecision('Risk', { decision: 'Adjust', likelihood: 3 }).code === 'BAD_SCORES'
      && JSON.stringify(scoresAfter('Adopt', { likelihood: 4, impact: 5 }, null)) === '{"likelihood":4,"impact":5}'
      && scoresAfter('Keep', { likelihood: 4, impact: 5 }, null) === null
      && checkProposal('Asset', { title: 'Backup vault', reason: 'Holds every restore point', confidentiality: 4, integrity: 5, availability: 5 }).ok,
    'checkChallenge / checkDecision / scoresAfter / checkProposal');
}

// ── Every route has a caller; the guide quotes labels that are on screen ────
{
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const screen = src('pages', 'grc', 'project', 'EngagementChallenges.tsx');
  const mine = src('pages', 'grc', 'project', 'ChallengesToDecide.tsx');
  const host = src('pages', 'grc', 'DeliveryProjects.tsx');
  const myWork = src('pages', 'grc', 'project', 'MyWork.tsx');
  const callers = {
    'comparison, raise, decide, withdraw': screen.includes('`${base}/challenges`, { params: { kind } }') && screen.includes('apiClient.post(`${base}/challenges`, { kind, targetId')
      && screen.includes('`${base}/challenges/decide`') && screen.includes('/withdraw`'),
    'proposals: list, propose, decide': screen.includes('apiClient.get(`${base}/proposals`)') && screen.includes('apiClient.post(`${base}/proposals`, { kind')
      && screen.includes('/decide`, { decision: \'Accepted\' }'),
    'appetite drafts': screen.includes('`${base}/appetite-drafts`'),
    'My Work': mine.includes("'/api/engagements/challenges/mine'") && myWork.includes('<ChallengesToDecide'),
    'mounted': host.includes('<EngagementChallenges'),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s11:every new route has a caller on a screen', missing.length === 0, `no caller for ${missing.join(', ')}`);

  const guide = src('data', 'userGuideData.ts').replace(/\r\n/g, '\n');
  const section = (name) => (guide.split(new RegExp(`\\n  '?${name}'?: \\{`))[1] || '').split(/\n  \},\n/)[0];
  const screens = [screen, mine, host].join('\n');
  const needed = ['Challenges', 'Challenge', 'Adopt', 'Keep', 'Adjust', 'Adopt selected', 'Keep selected', 'Withdraw', 'Challenges to decide',
    'Propose a risk', 'Accept into the register', 'Draft risk appetite'];
  const quoted = [...section('project-delivery').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const absent = needed.filter((l) => quoted.includes(l) && !screens.includes(l));
  v.record('engagement-s11:the guide describes challenges, proposals and appetite drafts with labels on screen',
    needed.every((l) => quoted.includes(l)) && absent.length === 0,
    `not quoted: ${needed.filter((l) => !quoted.includes(l)).join(', ') || 'none'}; on no screen: ${absent.join(', ') || 'none'}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me'); // PM; owns RSK-008
  const admin = await q.login('company.admin@omniops.me');
  const riskManager = await q.login('risk.manager@omniops.me');
  const lead = await q.login('engagement.manager@grcconsulting.com');
  const consultant = await q.login('consultant@grcconsulting.com');
  const reviewer = await q.login('risk@grcconsulting.com');
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const c = as(client);
  const me = client.user.id;
  const omni = await prisma.tenant.findFirst({ where: { name: 'OmniOps' }, select: { id: true } });
  const gcp = await prisma.tenant.findFirst({ where: { name: 'GRC Consulting Partners' }, select: { id: true } });
  const iso = await prisma.standard.findFirst({ where: { code: 'ISO27001' }, select: { id: true } });
  const memberOf = (pid, who) => prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: pid, userId: who.user.id } } });

  const p = (await c('POST', '/api/projects', {
    name: `S11 ISO 27001 ${stamp}`, startDate: day(0), targetEndDate: day(90), ownerId: me, managerId: me, projectType: 'Certification', standardIds: [iso.id],
  })).json?.project;
  const pid = p.id;
  await c('POST', `/api/projects/${pid}/phases`, { name: 'Risk assessment', startDate: day(0), targetEndDate: day(40), ownerId: me });
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
  const C = `/api/engagements/${pid}/challenges`;

  const backup = await prisma.risk.findFirst({ where: { tenantId: omni.id, title: { contains: 'backup restoration' } }, select: { id: true, ref: true, ownerId: true, inherentLikelihood: true, inherentImpact: true, residualScore: true } });
  const phishing = await prisma.risk.findFirst({ where: { tenantId: omni.id, title: { contains: 'Phishing' } }, select: { id: true, ref: true, residualScore: true } });
  const figures = async () => {
    const reg = (await c('GET', '/api/grc/risks')).json;
    const summary = (await c('GET', '/api/grc/summary')).json;
    const find = (o) => (o && typeof o === 'object' ? (o.appetite && 'beyondTolerance' in o.appetite ? o.appetite.beyondTolerance : Object.values(o).map(find).find((x) => x !== undefined)) : undefined);
    return { register: reg?.totals?.beyondTolerance, summary: find(summary) };
  };
  if (backup.ownerId !== me) await prisma.risk.update({ where: { id: backup.id }, data: { ownerId: me } });
  const before = await figures();

  // ── Raised, and ignored by every figure while open ───────────────────────
  const byReviewer = await as(reviewer)('POST', C, { kind: 'Risk', targetId: backup.id, likelihood: 4, impact: 5, reason: 'Restore tests have never been run' });
  const raised = await as(consultant)('POST', C, { kind: 'Risk', targetId: backup.id, likelihood: 4, impact: 5, reason: 'Restore tests have never been run; a failed restore would stop service.' });
  const twice = await as(lead)('POST', C, { kind: 'Risk', targetId: backup.id, likelihood: 5, impact: 5, reason: 'Even worse than the consultant says' });
  const onPhishing = await as(consultant)('POST', C, { kind: 'Risk', targetId: phishing.id, likelihood: 4, impact: 5, reason: 'Credential phishing succeeds in every exercise.' });
  const comparison = (await c('GET', `${C}?kind=Risk`)).json;
  const rowBackup = comparison?.rows?.find((r) => r.id === backup.id);
  const rowPhishing = comparison?.rows?.find((r) => r.id === phishing.id);
  const whileOpen = await figures();
  const unchanged = await prisma.risk.findUnique({ where: { id: backup.id }, select: { residualScore: true } });
  v.record('engagement-s11:the firm challenges a shared risk with its reason; while open no figure moves, and the comparison shows what adopting would do',
    byReviewer.status === 403 && raised.status === 201 && raised.json?.challenge?.ref === 'CHL-0001' && twice.status === 409 && onPhishing.status === 201
      && rowBackup?.open?.wouldBe?.residualScore === 20 && rowBackup?.open?.wouldBe?.band === 'BeyondTolerance' && rowBackup?.band !== 'BeyondTolerance'
      && rowPhishing?.open?.wouldBe?.residualScore < 16
      && unchanged.residualScore === backup.residualScore && whileOpen.register === before.register && whileOpen.summary === before.summary
      && (await prisma.notification.count({ where: { recipientId: me, event: 'ENGAGEMENT_CHALLENGE_RAISED' } })) >= 1,
    `reviewer ${byReviewer.status}; raised ${raised.status} ${raised.json?.challenge?.ref || raised.json?.message || ''}; twice ${twice.status}; phishing ${onPhishing.status}; `
      + `would ${JSON.stringify(rowBackup?.open?.wouldBe)}; phishing would ${JSON.stringify(rowPhishing?.open?.wouldBe)}; figures ${JSON.stringify(before)} → ${JSON.stringify(whileOpen)}`);

  // ── Adopted by its owner ─────────────────────────────────────────────────
  const firmDecides = await as(lead)('POST', `${C}/decide`, { ids: [raised.json?.challenge?.id], decision: 'Adopt' });
  const notOwner = await as(riskManager)('POST', `${C}/decide`, { ids: [raised.json?.challenge?.id], decision: 'Adopt' });
  const adopted = await c('POST', `${C}/decide`, { ids: [raised.json?.challenge?.id], decision: 'Adopt' });
  const after = await figures();
  const risk = await prisma.risk.findUnique({ where: { id: backup.id }, select: { inherentLikelihood: true, inherentImpact: true, residualScore: true } });
  const snap = await prisma.riskScoreSnapshot.findFirst({ where: { riskId: backup.id }, orderBy: { recordedAt: 'desc' }, select: { reason: true, residualScore: true } });
  const chl = await prisma.registerChallenge.findUnique({ where: { id: raised.json?.challenge?.id }, select: { status: true, scoresBefore: true, scoresAfter: true } });
  v.record('engagement-s11:adopted by its owner, RSK-008 is 20 and beyond the Operational tolerance of 16; the count rises by one and the history keeps both scores',
    firmDecides.status === 403 && notOwner.status === 403 && adopted.status === 200
      && risk.inherentLikelihood === 4 && risk.inherentImpact === 5 && risk.residualScore === 20
      && after.register === before.register + 1 && after.summary === before.summary + 1
      && snap?.reason?.includes('CHL-0001') && snap.residualScore === 20 && chl.status === 'Adopted'
      && JSON.parse(chl.scoresBefore).likelihood === backup.inherentLikelihood && JSON.parse(chl.scoresAfter).likelihood === 4
      && (await prisma.auditLog.count({ where: { action: 'ENGAGEMENT_CHALLENGE_DECIDED', subjectId: backup.id } })) === 2,
    `firm ${firmDecides.status}; not owner ${notOwner.status}; adopted ${adopted.status} ${adopted.json?.message || ''}; risk ${JSON.stringify(risk)}; figures ${JSON.stringify(before)} → ${JSON.stringify(after)}; snap ${JSON.stringify(snap)}`);

  // ── Keep, Adjust, several at once, withdraw ──────────────────────────────
  // Two more of the project manager's risks, to decide together.
  const pair = await prisma.risk.findMany({ where: { tenantId: omni.id, id: { notIn: [backup.id, phishing.id] } }, select: { id: true }, orderBy: { ref: 'asc' }, take: 2 });
  await prisma.risk.updateMany({ where: { id: { in: pair.map((x) => x.id) } }, data: { ownerId: me } });
  const mineRisks = await prisma.risk.findMany({ where: { id: { in: pair.map((x) => x.id) } }, select: { id: true, ref: true, inherentLikelihood: true, inherentImpact: true } });
  const others = [];
  for (const r of mineRisks) {
    const l = r.inherentLikelihood === 5 ? 4 : r.inherentLikelihood + 1;
    others.push((await as(consultant)('POST', C, { kind: 'Risk', targetId: r.id, likelihood: l, impact: r.inherentImpact, reason: 'Recent incidents show it is more likely.' })).json?.challenge?.id);
  }
  const keepNoWhy = await c('POST', `${C}/decide`, { ids: others, decision: 'Keep' });
  const kept = await c('POST', `${C}/decide`, { ids: others, decision: 'Keep', reason: 'The incidents were in a system now retired.' });
  const keptRows = await prisma.registerChallenge.findMany({ where: { id: { in: others } }, select: { status: true, scoresAfter: true } });
  const unmoved = await prisma.risk.findMany({ where: { id: { in: mineRisks.map((r) => r.id) } }, select: { id: true, inherentLikelihood: true } });
  const again = await as(consultant)('POST', C, { kind: 'Risk', targetId: backup.id, likelihood: 5, impact: 5, reason: 'Backups also fail integrity checks.' });
  const adjustTwo = await c('POST', `${C}/decide`, { ids: [again.json?.challenge?.id, others[0]], decision: 'Adjust', likelihood: 3, impact: 5 });
  const adjusted = await c('POST', `${C}/decide`, { ids: [again.json?.challenge?.id], decision: 'Adjust', likelihood: 3, impact: 5, reason: 'Integrity checks fail only on the test vault.' });
  const afterAdjust = await prisma.risk.findUnique({ where: { id: backup.id }, select: { inherentLikelihood: true, residualScore: true } });
  const withdrawn = await as(consultant)('POST', `${C}/${onPhishing.json?.challenge?.id}/withdraw`, { reason: 'The exercise results were from the old mail system.' });
  const history = (await c('GET', `${C}?kind=Risk`)).json?.rows?.find((r) => r.id === phishing.id);
  v.record('engagement-s11:Keep needs a reason and moves nothing, several are decided at once, Adjust takes the owner\'s scores one at a time, a withdrawn challenge stays in the history',
    mineRisks.length === 2 && keepNoWhy.status === 400 && kept.status === 200 && kept.json?.decided === 2 && keptRows.every((k) => k.status === 'Kept' && k.scoresAfter === null)
      && unmoved.every((u) => u.inherentLikelihood === mineRisks.find((m) => m.id === u.id).inherentLikelihood)
      && adjustTwo.status === 400 && adjusted.status === 200 && afterAdjust.inherentLikelihood === 3 && afterAdjust.residualScore === 15
      && withdrawn.status === 200 && !history?.open && history?.decided?.some((d) => d.status === 'Withdrawn'),
    `mine ${mineRisks.length}; keep ${keepNoWhy.status}/${kept.status}; adjust two ${adjustTwo.status}; adjusted ${adjusted.status} ${JSON.stringify(afterAdjust)}; withdrawn ${withdrawn.status}`);

  // ── An asset challenge ───────────────────────────────────────────────────
  const asset = await prisma.asset.findFirst({ where: { tenantId: omni.id, classification: { in: ['Public', 'Internal'] } }, select: { id: true, ref: true, ownerId: true, confidentiality: true, integrity: true, availability: true, criticality: true } });
  if (asset.ownerId !== me) await prisma.asset.update({ where: { id: asset.id }, data: { ownerId: me } });
  const cia = { confidentiality: asset.confidentiality === 5 ? 4 : 5, integrity: 5, availability: 5 };
  const assetChallenge = await as(consultant)('POST', C, { kind: 'Asset', targetId: asset.id, ...cia, reason: 'It holds customer records and runs the payment service.' });
  const assetOpen = await prisma.asset.findUnique({ where: { id: asset.id }, select: { criticality: true } });
  const assetAdopted = await c('POST', `${C}/decide`, { ids: [assetChallenge.json?.challenge?.id], decision: 'Adopt' });
  const assetAfter = await prisma.asset.findUnique({ where: { id: asset.id }, select: { confidentiality: true, integrity: true, availability: true, criticality: true } });
  v.record('engagement-s11:an asset challenge moves C, I, A and criticality only when adopted',
    assetChallenge.status === 201 && assetOpen.criticality === asset.criticality && assetAdopted.status === 200
      && assetAfter.integrity === 5 && assetAfter.availability === 5 && assetAfter.criticality === 5,
    `challenge ${assetChallenge.status} ${assetChallenge.json?.message || ''}; adopted ${assetAdopted.status}; after ${JSON.stringify(assetAfter)}`);

  // ── A proposed risk counts nowhere until accepted ────────────────────────
  const P = `/api/engagements/${pid}/proposals`;
  const countBefore = await prisma.risk.count({ where: { tenantId: omni.id } });
  const proposed = await as(consultant)('POST', P, { kind: 'Risk', tenantId: omni.id, title: 'Ransomware encrypts the backup vault', category: 'Technology', likelihood: 3, impact: 5, reason: 'Backups are on the same domain as production.' });
  const listedWhileProposed = ((await c('GET', '/api/grc/risks')).json?.risks || []).some((r) => r.title === 'Ransomware encrypts the backup vault');
  const firmAccepts = await as(lead)('POST', `${P}/${proposed.json?.proposal?.id}/decide`, { decision: 'Accepted' });
  const accepted = await c('POST', `${P}/${proposed.json?.proposal?.id}/decide`, { decision: 'Accepted', ownerId: riskManager.user.id });
  const made = accepted.json?.became ? await prisma.risk.findUnique({ where: { id: accepted.json.became.id }, select: { ref: true, ownerId: true, inherentScore: true, identifiedSource: true } }) : null;
  const toReject = await as(consultant)('POST', P, { kind: 'Asset', tenantId: omni.id, title: 'Shadow file share', type: 'Service', confidentiality: 3, integrity: 3, availability: 2, reason: 'Teams share files outside the DMS.' });
  const rejected = await c('POST', `${P}/${toReject.json?.proposal?.id}/decide`, { decision: 'Rejected', note: 'Already retired last quarter by IT.' });
  v.record('engagement-s11:a proposed risk is in no figure until the organisation accepts it, then it is an ordinary risk with its own reference',
    proposed.status === 201 && !listedWhileProposed && (await prisma.risk.count({ where: { tenantId: omni.id } })) === countBefore + 1
      && firmAccepts.status === 403 && accepted.status === 200 && /^RSK-\d{3}$/.test(made?.ref || '') && made.ownerId === riskManager.user.id && made.inherentScore === 15
      && made.identifiedSource?.includes(proposed.json?.proposal?.ref) && rejected.status === 200,
    `proposed ${proposed.status}; listed ${listedWhileProposed}; firm accepts ${firmAccepts.status}; accepted ${accepted.status} ${JSON.stringify(made)}; rejected ${rejected.status}`);

  // ── The firm drafts appetite; its drafter cannot approve it ──────────────
  const drafted = await as(consultant)('POST', `/api/engagements/${pid}/appetite-drafts`, { tenantId: omni.id, category: 'Technology', statement: 'Accepts technology risk up to medium where a recovery plan exists.', appetiteThreshold: 8, toleranceThreshold: 15 });
  const draftRow = drafted.json?.appetite?.id ? await prisma.riskAppetite.findUnique({ where: { id: drafted.json.appetite.id }, select: { status: true, setById: true } }) : null;
  const secondDraft = await as(lead)('POST', `/api/engagements/${pid}/appetite-drafts`, { tenantId: omni.id, category: 'Technology', statement: 'A second draft at the same time', appetiteThreshold: 8, toleranceThreshold: 15 });
  const approved = await as(admin)('POST', `/api/grc/appetite/${drafted.json?.appetite?.id}/approve`, {});
  v.record('engagement-s11:the firm drafts risk appetite as a draft of the organisation\'s, approved by someone else on its own screen',
    drafted.status === 201 && draftRow?.status !== undefined && draftRow.setById === consultant.user.id && secondDraft.status === 409
      && [200, 201].includes(approved.status),
    `drafted ${drafted.status} ${drafted.json?.message || ''}; draft ${JSON.stringify(draftRow)}; second ${secondDraft.status}; approved ${approved.status} ${approved.json?.message || ''}`);

  await prisma.$disconnect();
  v.finish(`${p.ref}: ${backup.ref} adopted at 20 beyond tolerance, ${made?.ref} accepted from a proposal`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
