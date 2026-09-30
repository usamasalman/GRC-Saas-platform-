/**
 * Consulting engagement, sprint 2: the Gantt with planned, actual and variance.
 *
 * The plan stored baseline and current dates and a completion, but no screen
 * drew them and nothing said why a task was late. Here, on the design's own
 * worked example (supply the asset list, review the A.5 policies, write the
 * gap report, which waits on the review):
 *
 *   - every task's variance is its actual or forecast finish against the plan
 *     first agreed, and its causes (on hold, client, provider, third party,
 *     rebaseline, unattributed) add up to it; a task late only because the
 *     work it waits on was late inherits that work's causes;
 *   - phases and the project roll up the same way and reconcile too, on this
 *     plan and on every other engagement in the database;
 *   - an unfinished task is a forecast, and says so;
 *   - a rebaseline re-agrees the dates but not the first plan;
 *   - the Engagement status and Phase delivery reports print the same figures;
 *   - the Gantt route has a caller on a screen, and another organisation's
 *     engagement answers 404.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s2-gantt-test.js
 */
const path = require('path');
const { PDFParse } = require('pdf-parse');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const {
  allocate, sumCauses, taskFinish, buildSchedule, CAUSES,
} = require('../../dist/services/projectVariance');

const v = q.verdicts('engagement-s2');
const DAY = 86_400_000;
// Whole UTC days from today, so the arithmetic is exact whatever the time.
const today = new Date(new Date().toISOString().slice(0, 10));
const at = (n) => new Date(today.getTime() + n * DAY);
const day = (n) => at(n).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);
const reconciles = (f) => sumCauses(f.causes) === Math.max(0, f.varianceDays ?? 0);
const causes = (c) => CAUSES.filter((k) => c[k] > 0).map((k) => `${k} ${c[k]}`).join(', ') || 'none';

// ── The arithmetic, without a database ──────────────────────────────────────
{
  let bad = 0;
  for (let i = 0; i < 2000; i += 1) {
    const r = () => Math.floor(Math.random() * 12);
    const variance = Math.floor(Math.random() * 30) - 8;
    const c = allocate(variance, { onHold: r(), client: r(), provider: r(), thirdParty: r(), rebaseline: r() });
    if (sumCauses(c) !== Math.max(0, variance) || CAUSES.some((k) => c[k] < 0)) bad += 1;
  }
  const shared = allocate(3, { onHold: 0, client: 7, provider: 1, thirdParty: 0, rebaseline: 0 });
  v.record('engagement-s2:causes always add up to the variance, in whole days',
    bad === 0 && sumCauses(shared) === 3 && shared.unattributed === 0,
    `${bad} of 2000 random splits did not add up; 7 client and 1 provider against 3 days gave ${causes(shared)}`);

  const hold = allocate(4, { onHold: 3, client: 5, provider: 0, thirdParty: 0, rebaseline: 2 });
  v.record('engagement-s2:days on hold are nobody\'s delay and are counted first',
    hold.onHold === 3 && hold.client === 1 && hold.rebaseline === 0,
    causes(hold));

  const overdue = taskFinish({ status: 'InProgress', completedAt: null, dueDate: at(-5) }, at(0));
  const done = taskFinish({ status: 'Done', completedAt: at(-2), dueDate: at(-5) }, at(0));
  v.record('engagement-s2:unfinished work is a forecast, and cannot finish in the past',
    overdue.forecast === true && overdue.finish.getTime() === at(0).getTime() && done.forecast === false,
    `overdue forecast ${overdue.finish?.toISOString()}, done forecast=${done.forecast}`);

  // A rebaseline that moved the finish, with nothing in the ledger to explain it.
  const s = buildSchedule({
    project: {
      startDate: at(0), targetEndDate: at(20), baselineStartDate: at(0), baselineTargetEndDate: at(24),
      baselineVersion: 2, firstBaselineStartDate: at(0), firstBaselineTargetEndDate: at(20),
    },
    phases: [{
      id: 'p', startDate: at(0), targetEndDate: at(24), baselineTargetEndDate: at(24), firstBaselineTargetEndDate: at(20),
      tasks: [{
        id: 't', status: 'Done', startDate: at(0), dueDate: at(24), completedAt: at(25), actualStartDate: at(0),
        baselineStartDate: at(0), baselineDueDate: at(24), firstBaselineStartDate: at(0), firstBaselineDueDate: at(20),
      }],
    }],
    ledger: [], holds: [], edges: [], now: at(30),
  });
  const t = s.tasks.get('t');
  v.record('engagement-s2:a rebaseline is a cause of its own, measured from the first agreed plan',
    t.varianceDays === 5 && t.causes.rebaseline === 4 && t.causes.unattributed === 1
      && s.project.causes.rebaseline === 4 && s.project.firstPlanKnown,
    `task +${t.varianceDays}: ${causes(t.causes)}; project: ${causes(s.project.causes)}`);
}

// ── Every route has a caller ────────────────────────────────────────────────
{
  const screen = q.read(path.join(q.WEB_SRC, 'pages', 'grc', 'project', 'ProjectGantt.tsx'));
  const host = q.read(path.join(q.WEB_SRC, 'pages', 'grc', 'DeliveryProjects.tsx'));
  v.record('engagement-s2:the Gantt route has a caller on a screen',
    /apiClient\.get\(`\/api\/projects\/\$\{projectId\}\/gantt`\)/.test(screen) && /<ProjectGantt\b/.test(host),
    'ProjectGantt must call GET /api/projects/:id/gantt and be mounted in DeliveryProjects');

  // The recorded slips the Gantt attributes are made on a screen too.
  const plan = q.read(path.join(q.WEB_SRC, 'pages', 'grc', 'project', 'ProjectPlan.tsx'));
  v.record('engagement-s2:moving a date later with a reason has a caller on a screen',
    /apiClient\.post\(`\/api\/projects\/tasks\/\$\{task\.id\}\/reschedule`/.test(plan) && /Move date/.test(plan),
    'ProjectPlan must offer "Move date" over POST /api/projects/tasks/:id/reschedule');

  const guide = q.read(path.join(q.WEB_SRC, 'data', 'userGuideData.ts'));
  const section = (guide.split(/\n  'project-delivery': \{/)[1] || '').split(/\n  \},\n/)[0];
  const quoted = [...section.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const labels = screen + host;
  v.record('engagement-s2:the guide describes the Gantt with labels that are on it',
    quoted.includes('Gantt') && /variance/i.test(section) && ['Planned', 'Actual', 'Forecast'].every((l) => labels.includes(l)),
    `quoted: ${quoted.join(', ')}`);
}

(async () => {
  const pm = await q.login('grc.manager@omniops.me');
  const as = (method, url, body) => q.call(method, url, { token: pm.token, body });
  const me = pm.user.id;

  // ── The worked example ────────────────────────────────────────────────────
  const created = await as('POST', '/api/projects', {
    name: `S2 Gantt ${stamp}`, startDate: day(10), targetEndDate: day(60), ownerId: me, managerId: me,
    projectType: 'Certification',
  });
  const project = created.json?.project;
  const phase = async (name, start, end) => (await as('POST', `/api/projects/${project.id}/phases`, {
    name, startDate: day(start), targetEndDate: day(end), ownerId: me,
  })).json?.phase;
  const task = async (phaseId, name, side, start, due) => (await as('POST', `/api/projects/phases/${phaseId}/tasks`, {
    name, side, startDate: day(start), dueDate: day(due), assigneeId: me,
  })).json?.task;

  const gap = project && await phase('Gap assessment', 10, 35);
  const fix = project && await phase('Remediation', 36, 60);
  const A = gap && await task(gap.id, 'Supply asset list', 'Client', 10, 14);
  const B = gap && await task(gap.id, 'Review A.5 policies', 'Provider', 10, 21);
  const C = gap && await task(gap.id, 'Gap report v1', 'Provider', 24, 35);
  const D = fix && await task(fix.id, 'Close the access gaps', 'Client', 40, 60);
  const linked = C && await as('POST', `/api/projects/${project.id}/dependencies`, {
    predecessorId: B.id, successorId: C.id, kind: 'FinishToStart', lagDays: 0,
  });
  const activated = D && await as('POST', `/api/projects/${project.id}/activate`, {});
  const moved = D && await as('POST', `/api/projects/tasks/${D.id}/reschedule`, {
    dueDate: day(63), category: 'ClientDependency', owingSide: 'Client',
    reason: 'Access owners not yet named by the client',
  });
  const linkedOk = linked?.status === 200 || linked?.status === 201;
  if (!A || !B || !C || !D || !linkedOk || activated?.status !== 200 || moved?.status !== 200) {
    v.record('engagement-s2:the worked example can be set up', false,
      `project ${created.status}, link ${linked?.status}, activate ${activated?.status} ${activated?.json?.message || ''}, `
        + `reschedule ${moved?.status} ${moved?.json?.message || ''}`);
    await prisma.$disconnect();
    v.finish();
    return;
  }

  // What happened, written where no route writes it: completions on given
  // days, blockers that cost a known number of days, and a day on hold.
  const done = (t, start, finish) => prisma.projectTask.update({
    where: { id: t.id }, data: { status: 'Done', actualStartDate: at(start), completedAt: at(finish), completionPercent: 100 },
  });
  await done(A, 10, 19);
  await done(B, 12, 24);
  await done(C, 27, 39);
  const ledger = (t, ref, kind, owingSide, days) => prisma.projectImpediment.create({
    data: {
      projectId: project.id, taskId: t.id, phaseId: gap.id, ref: `S2-${ref}`, kind, owingSide,
      category: owingSide === 'Client' ? 'ClientDependency' : 'ProviderCapacity',
      title: `${ref} for the Gantt test`, impactDays: days, raisedById: me,
      raisedAt: at(12), resolvedAt: at(12 + days), resolvedById: me,
    },
  });
  await ledger(A, 'A1', 'Blocker', 'Client', 5);
  await ledger(B, 'B1', 'Blocker', 'Client', 2);
  await ledger(B, 'B2', 'Delay', 'Provider', 1);
  await prisma.projectHold.create({
    data: { projectId: project.id, reason: 'Budget freeze for one day', startedAt: at(30), endedAt: at(31), startedById: me },
  });

  const gantt = async () => (await as('GET', `/api/projects/${project.id}/gantt`)).json;
  const g = await gantt();
  const tasks = new Map((g?.phases || []).flatMap((p) => p.tasks).map((t) => [t.id, t]));
  const exact = (f, variance, expected) => f && f.varianceDays === variance
    && CAUSES.every((k) => f.causes[k] === (expected[k] || 0));
  const say = (f) => (f ? `${f.varianceDays} days: ${causes(f.causes)}` : 'missing');

  const a = tasks.get(A.id); const b = tasks.get(B.id); const c = tasks.get(C.id); const d = tasks.get(D.id);
  v.record('engagement-s2:each task\'s variance and causes, from the plan first agreed',
    exact(a, 5, { client: 5 }) && exact(b, 3, { client: 2, provider: 1 }) && exact(d, 3, { client: 3 }),
    `asset list ${say(a)}; review ${say(b)}; access gaps ${say(d)}`);
  v.record('engagement-s2:a task late because the work it waits on was late inherits that work\'s causes',
    exact(c, 4, { onHold: 1, client: 2, provider: 1 }) && c.drivenBy.includes(B.ref),
    `gap report ${say(c)}, via ${c?.drivenBy?.join(', ') || 'nothing'}`);
  v.record('engagement-s2:phases and the project roll up, and their causes add up',
    exact(g.phases[0], 4, { onHold: 1, client: 2, provider: 1 }) && exact(g.phases[1], 3, { client: 3 })
      && exact(g.project, 3, { onHold: 1, client: 2 }),
    `gap assessment ${say(g.phases[0])}; remediation ${say(g.phases[1])}; project ${say(g.project)}`);
  v.record('engagement-s2:an unfinished task is labelled forecast, and a finished one is not',
    d?.actual.forecast === true && a?.actual.forecast === false && g.project.actual.forecast === true
      && g.phases[0].actual.forecast === false,
    `access gaps forecast=${d?.actual.forecast}, asset list forecast=${a?.actual.forecast}`);
  v.record('engagement-s2:the critical path is marked on the Gantt',
    [...tasks.values()].some((t) => t.onCriticalPath), 'no task is on the critical path');

  // ── The same figures on paper ─────────────────────────────────────────────
  const pdfText = async (url) => {
    const r = await fetch(q.API + url, { headers: { Authorization: `Bearer ${pm.token}` } });
    if (r.status !== 200) return `HTTP ${r.status}`;
    const buf = Buffer.from(await r.arrayBuffer());
    return ((await new PDFParse({ data: buf }).getText()).text || '').replace(/\s+/g, ' ');
  };
  const status = await pdfText(`/api/projects/${project.id}/reports/status?format=pdf`);
  const phaseReport = await pdfText(`/api/projects/${project.id}/reports/phase?format=pdf&phaseId=${gap.id}`);
  v.record('engagement-s2:the Engagement status report prints the Gantt\'s figures',
    status.includes('Planned, actual and variance') && status.includes('Variance by phase')
      && status.includes('+3 days (forecast)') && status.includes('1 on hold, 2 client')
      && status.includes('1 on hold, 2 client, 1 provider'),
    status.slice(0, 160));
  v.record('engagement-s2:the Phase delivery report prints each task\'s variance and why',
    phaseReport.includes('Variance by task') && phaseReport.includes('+5 days') && phaseReport.includes('5 client')
      && phaseReport.includes('2 client, 1 provider') && phaseReport.includes('+4 days'),
    phaseReport.slice(0, 160));

  // ── A rebaseline keeps the first plan ─────────────────────────────────────
  const rebased = await as('POST', `/api/projects/${project.id}/rebaseline`, { reason: 'Remediation dates agreed again' });
  const after = await gantt();
  const d2 = after?.phases?.[1]?.tasks?.find((t) => t.id === D.id);
  v.record('engagement-s2:a rebaseline re-agrees the dates but keeps the plan first agreed',
    rebased.status === 200 && d2?.planned.finish === d?.planned.finish && d2?.agreedFinish === at(63).toISOString()
      && exact(d2, 3, { client: 3 }),
    `rebaseline HTTP ${rebased.status}; planned ${d2?.planned.finish}, agreed ${d2?.agreedFinish}, ${say(d2)}`);

  // The slip carried the task past its phase's end and the engagement's; both
  // grew with it, and the rebaseline agreed them where the work now ends.
  const ends = await prisma.project.findUnique({
    where: { id: project.id },
    select: { targetEndDate: true, baselineTargetEndDate: true, phases: { where: { id: fix.id }, select: { targetEndDate: true, baselineTargetEndDate: true } } },
  });
  const day63 = at(63).getTime();
  v.record('engagement-s2:a phase and the engagement end no earlier than the work inside them',
    ends?.targetEndDate.getTime() === day63 && ends?.phases[0]?.targetEndDate.getTime() === day63
      && ends?.baselineTargetEndDate?.getTime() === day63 && ends?.phases[0]?.baselineTargetEndDate?.getTime() === day63
      && after?.phases?.[1]?.agreedFinish === at(63).toISOString(),
    `project ${ends?.targetEndDate.toISOString().slice(0, 10)} agreed ${ends?.baselineTargetEndDate?.toISOString().slice(0, 10)}, `
      + `phase ${ends?.phases[0]?.targetEndDate.toISOString().slice(0, 10)} agreed ${ends?.phases[0]?.baselineTargetEndDate?.toISOString().slice(0, 10)}`);

  // ── Every engagement reconciles ───────────────────────────────────────────
  const others = await prisma.project.findMany({ select: { id: true, ref: true } });
  const broken = [];
  for (const p of others) {
    const x = (await as('GET', `/api/projects/${p.id}/gantt`)).json;
    if (!x?.project) continue;
    const all = [x.project, ...x.phases, ...x.phases.flatMap((ph) => ph.tasks)];
    if (!all.every(reconciles)) broken.push(p.ref);
  }
  v.record('engagement-s2:task, phase and project causes reconcile on every engagement',
    broken.length === 0, `do not add up: ${broken.join(', ')}`);

  // ── Another organisation cannot read it ───────────────────────────────────
  const outsider = await q.login('eleanor.vance@globalbank.com');
  const foreign = await q.call('GET', `/api/projects/${project.id}/gantt`, { token: outsider.token });
  v.record('engagement-s2:another organisation\'s Gantt answers 404',
    foreign.status === 404, `HTTP ${foreign.status}`);

  await prisma.$disconnect();
  v.finish(`${project.ref}, ${others.length} engagement(s) reconciled`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
