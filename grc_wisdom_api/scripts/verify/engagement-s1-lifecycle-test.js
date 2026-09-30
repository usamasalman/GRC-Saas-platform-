/**
 * Consulting engagement, sprint 1: the project lifecycle on screen.
 *
 * The API could put a project on hold, resume, rebaseline and close it, and no
 * screen offered any of them. Holding recorded neither when nor why, and a
 * task never recorded when work on it began. Here:
 *
 *   - every lifecycle route has a caller on a screen;
 *   - hold and resume each need a reason of at least 10 characters, and hold
 *     then resume leaves exactly one closed interval, with both reasons;
 *   - hold, resume, rebaseline and close are on the client's trail with their
 *     reason, and the named delivery firm's trail gets a summary of each;
 *   - a task's actual start is stamped the first time it moves to InProgress
 *     and is not overwritten when it is stopped and restarted;
 *   - rebaseline and close keep their reason rule, and close ends it;
 *   - cancelling a held project ends its hold interval.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s1-lifecycle-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const { bringFirm } = require('./engagement-firm');

const v = q.verdicts('engagement-s1');
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);
const HOLD = 'Budget freeze until the next quarter';
const RESUME = 'Budget approved by the steering committee';

// ── Every lifecycle route has a caller on a screen ─────────────────────────
{
  const screen = q.read(path.join(q.WEB_SRC, 'pages', 'grc', 'project', 'ProjectLifecycle.tsx'));
  const callers = {
    'PATCH /api/projects/:id to OnHold': /apiClient\.patch\(`\/api\/projects\/\$\{projectId\}`, \{ status: 'OnHold', reason \}\)/,
    'PATCH /api/projects/:id to Active (resume)': /apiClient\.patch\(`\/api\/projects\/\$\{projectId\}`, \{ status: 'Active', reason \}\)/,
    'POST /api/projects/:id/rebaseline': /apiClient\.post\(`\/api\/projects\/\$\{projectId\}\/rebaseline`, \{ reason \}\)/,
    'POST /api/projects/:id/close': /apiClient\.post\(`\/api\/projects\/\$\{projectId\}\/close`, \{ outcome: 'Closed', closureNote: reason \}\)/,
  };
  const missing = Object.entries(callers).filter(([, re]) => !re.test(screen)).map(([name]) => name);
  const host = q.read(path.join(q.WEB_SRC, 'pages', 'grc', 'DeliveryProjects.tsx'));
  const mounted = /<ProjectLifecycle\b/.test(host);
  v.record('engagement-s1:every lifecycle route has a caller on a screen',
    missing.length === 0 && mounted,
    missing.length ? `no caller for ${missing.join(', ')}` : 'ProjectLifecycle is not mounted in the project header');

  // The guide quotes the screen's labels; each one has to be on the screen.
  // Line endings normalised: a Windows checkout has CRLF, and the section split is on LF.
  const guide = q.read(path.join(q.WEB_SRC, 'data', 'userGuideData.ts')).replace(/\r\n/g, '\n');
  const section = (guide.split(/\n  'project-delivery': \{/)[1] || '').split(/\n  \},\n/)[0];
  const projectDir = path.join(q.WEB_SRC, 'pages', 'grc', 'project');
  const screens = require('fs').readdirSync(projectDir).filter((f) => f.endsWith('.tsx'))
    .map((f) => q.read(path.join(projectDir, f))).join('\n') + host;
  const quoted = [...section.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const absent = quoted.filter((label) => !screens.includes(label));
  v.record('engagement-s1:the guide covers the lifecycle and every label it quotes is on the screen',
    section.length > 0 && ['Put on hold', 'Resume', 'Rebaseline', 'Close'].every((l) => quoted.includes(l)) && absent.length === 0,
    section ? `quoted but not on screen: ${absent.join(', ') || 'none'}; quoted: ${quoted.join(', ')}` : 'no project-delivery section in userGuideData.ts');
}

(async () => {
  const pm = await q.login('grc.manager@omniops.me');
  const as = (method, url, body) => q.call(method, url, { token: pm.token, body });
  const me = pm.user.id;

  // Projects of our own, so nothing depends on the demo data's state.
  const activeProject = async (name, extra = {}) => {
    const created = await as('POST', '/api/projects', {
      name: `${name} ${stamp}`, startDate: day(0), targetEndDate: day(60), ownerId: me, managerId: me,
      projectType: 'Implementation', ...extra,
    });
    const project = created.json?.project;
    const phase = project && await as('POST', `/api/projects/${project.id}/phases`, {
      name: 'Phase one', startDate: day(0), targetEndDate: day(30), ownerId: me,
    });
    const task = phase?.json?.phase && await as('POST', `/api/projects/phases/${phase.json.phase.id}/tasks`, {
      name: 'First task', startDate: day(1), dueDate: day(10), assigneeId: me,
    });
    const activated = task?.json?.task && await as('POST', `/api/projects/${project.id}/activate`, {});
    const ok = activated?.status === 200;
    if (!ok) {
      v.record(`engagement-s1:${name} can be set up and activated`, false,
        `project HTTP ${created.status} ${created.json?.message || ''}, phase ${phase?.status}, task ${task?.status}, `
          + `activate ${activated?.status} ${activated?.json?.message || ''}`);
    }
    return ok ? { project, taskId: task.json.task.id } : null;
  };

  const main = await activeProject('S1 lifecycle');
  const held = await activeProject('S1 cancelled on hold');
  if (!main || !held) {
    await prisma.$disconnect();
    v.finish();
    return;
  }
  // A delivery firm on the engagement, so its trail can be read too. It joins
  // the way the product requires once consulting is on (sprint 4).
  const firm = await bringFirm({
    clientToken: pm.token, leadLogin: await q.login('engagement.manager@grcconsulting.com'),
    projectId: main.project.id, prisma,
  });
  const { project, taskId } = main;
  const projectId = project.id;
  const holds = async (id) => (await as('GET', `/api/projects/${id}`)).json?.project?.holds || [];

  // ── Hold and resume ──────────────────────────────────────────────────────
  const bare = await as('PATCH', `/api/projects/${projectId}`, { status: 'OnHold' });
  const short = await as('PATCH', `/api/projects/${projectId}`, { status: 'OnHold', reason: 'budget' });
  v.record('engagement-s1:putting a project on hold needs a reason of at least 10 characters',
    bare.status === 400 && short.status === 400 && short.json?.code === 'REASON_REQUIRED' && (await holds(projectId)).length === 0,
    `no reason HTTP ${bare.status}, short reason HTTP ${short.status}`);

  const onHold = await as('PATCH', `/api/projects/${projectId}`, { status: 'OnHold', reason: HOLD });
  const again = await as('PATCH', `/api/projects/${projectId}`, { status: 'OnHold', reason: HOLD });
  const whileHeld = await holds(projectId);
  v.record('engagement-s1:a hold opens one interval, with its reason and who put it on hold',
    onHold.status === 200 && again.status === 200 && whileHeld.length === 1 && whileHeld[0].endedAt === null
      && whileHeld[0].reason === HOLD && Boolean(whileHeld[0].startedBy?.name),
    `HTTP ${onHold.status}/${again.status}, ${whileHeld.length} interval(s)`);

  // Work stops while it is held; planning does not.
  const work = await as('PATCH', `/api/projects/tasks/${taskId}`, { status: 'InProgress' });
  const blocked = await as('POST', `/api/projects/tasks/${taskId}/block`, { title: 'Waiting on access', owingSide: 'Client', category: 'Other' });
  const replanned = await as('PATCH', `/api/projects/tasks/${taskId}`, { name: 'First task, renamed on hold' });
  v.record('engagement-s1:while on hold work is paused, and the plan can still be adjusted',
    work.status === 409 && work.json?.code === 'PROJECT_ON_HOLD' && blocked.status === 409 && replanned.status === 200,
    `status change HTTP ${work.status} ${work.json?.code || ''}, block HTTP ${blocked.status}, rename HTTP ${replanned.status}`);

  const shortResume = await as('PATCH', `/api/projects/${projectId}`, { status: 'Active', reason: 'ok' });
  const resumed = await as('PATCH', `/api/projects/${projectId}`, { status: 'Active', reason: RESUME });
  const after = await holds(projectId);
  v.record('engagement-s1:hold then resume leaves one closed interval, with both reasons',
    shortResume.status === 400 && resumed.status === 200 && after.length === 1 && after[0].endedAt !== null
      && after[0].resumeReason === RESUME && Boolean(after[0].endedBy?.name),
    `short resume HTTP ${shortResume.status}, resume HTTP ${resumed.status}, ${after.length} interval(s), ended ${after[0]?.endedAt}`);

  // ── The actual start ─────────────────────────────────────────────────────
  const planTask = async () => {
    const plan = (await as('GET', `/api/projects/${projectId}/plan`)).json;
    return (plan?.phases || []).flatMap((p) => p.tasks || []).find((t) => t.id === taskId);
  };
  const before = await planTask();
  const started = await as('PATCH', `/api/projects/tasks/${taskId}`, { status: 'InProgress' });
  const first = (await planTask())?.actualStartDate;
  const stopped = await as('PATCH', `/api/projects/tasks/${taskId}`, { status: 'NotStarted' });
  await new Promise((r) => setTimeout(r, 1100));
  const restarted = await as('PATCH', `/api/projects/tasks/${taskId}`, { status: 'InProgress' });
  const second = (await planTask())?.actualStartDate;
  v.record('engagement-s1:a task\'s actual start is stamped the first time it moves to InProgress',
    before && before.actualStartDate === null && started.status === 200 && Boolean(first),
    `before ${before?.actualStartDate}, HTTP ${started.status} ${started.json?.message || ''}, after ${first}`);
  v.record('engagement-s1:and is not overwritten when the task is restarted',
    stopped.status === 200 && restarted.status === 200 && Boolean(first) && first === second,
    `stop HTTP ${stopped.status}, restart HTTP ${restarted.status}, first ${first}, after restart ${second}`);

  // ── Rebaseline and close keep their reason rule ──────────────────────────
  const shortRebase = await as('POST', `/api/projects/${projectId}/rebaseline`, { reason: 'moved' });
  const rebased = await as('POST', `/api/projects/${projectId}/rebaseline`, { reason: 'Scope grew after the gap assessment' });
  const shortClose = await as('POST', `/api/projects/${projectId}/close`, { outcome: 'Closed', closureNote: 'done' });
  const closed = await as('POST', `/api/projects/${projectId}/close`, { outcome: 'Closed', closureNote: 'Delivered and accepted by the sponsor' });
  const closedAgain = await as('POST', `/api/projects/${projectId}/close`, { outcome: 'Closed', closureNote: 'Delivered and accepted by the sponsor' });
  const final = (await as('GET', `/api/projects/${projectId}`)).json?.project;
  v.record('engagement-s1:rebaseline and close need a reason, and close ends the project once',
    shortRebase.status === 400 && rebased.status === 200 && shortClose.status === 400 && closed.status === 200
      && closedAgain.status === 409 && final?.status === 'Closed',
    `rebaseline ${shortRebase.status}/${rebased.status}, close ${shortClose.status}/${closed.status}/${closedAgain.status}, status ${final?.status}`);

  // ── Both trails ──────────────────────────────────────────────────────────
  const LIFECYCLE = ['PROJECT_PUT_ON_HOLD', 'PROJECT_RESUMED', 'PROJECT_REBASELINED', 'PROJECT_CLOSED'];
  const trail = await prisma.auditLog.findMany({
    where: { subjectId: projectId, action: { in: LIFECYCLE } },
    select: { action: true, payload: true, tenantId: true },
  });
  const reasonOf = (t) => { try { return JSON.parse(t.payload).reason; } catch { return undefined; } };
  const on = (tenantId, action, reason) => trail.some((t) => t.tenantId === tenantId && t.action === action
    && (reason === undefined || reasonOf(t) === reason));
  v.record('engagement-s1:hold, resume, rebaseline and close are on the client\'s trail, with their reasons',
    on(project.tenantId, 'PROJECT_PUT_ON_HOLD', HOLD) && on(project.tenantId, 'PROJECT_RESUMED', RESUME)
      && on(project.tenantId, 'PROJECT_REBASELINED', 'Scope grew after the gap assessment') && on(project.tenantId, 'PROJECT_CLOSED'),
    trail.filter((t) => t.tenantId === project.tenantId).map((t) => t.action).join(', ') || 'no entries');
  {
    v.record('engagement-s1:the delivery firm\'s trail gets a summary of each',
      LIFECYCLE.every((a) => on(firm.id, a)),
      trail.filter((t) => t.tenantId === firm.id).map((t) => t.action).join(', ') || 'no entries');
  }

  // ── Cancelling a held project ends its hold ──────────────────────────────
  const hid = held.project.id;
  await as('PATCH', `/api/projects/${hid}`, { status: 'OnHold', reason: HOLD });
  const cancelled = await as('POST', `/api/projects/${hid}/close`, { outcome: 'Cancelled', closureNote: 'Programme withdrawn by the board' });
  const ended = await holds(hid);
  v.record('engagement-s1:cancelling a held project ends its hold interval',
    cancelled.status === 200 && ended.length === 1 && ended[0].endedAt !== null && ended[0].resumeReason === null,
    `cancel HTTP ${cancelled.status} ${cancelled.json?.message || ''}, ${ended.length} interval(s), ended ${ended[0]?.endedAt}`);

  await prisma.$disconnect();
  v.finish(`${project.ref} delivered by ${firm.name}`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
