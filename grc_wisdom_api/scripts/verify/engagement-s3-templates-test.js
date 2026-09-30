/**
 * Consulting engagement, sprint 3: the plan template library and the wizard.
 *
 * Phases and tasks were typed one by one. Here:
 *
 *   - the platform's ISO 27001 certification template (7 phases) is there for
 *     every organisation, and only the platform may change it;
 *   - a new ISO 27001 engagement gets a dated draft plan from it: phases one
 *     after another, a task that waits on another starting when that one is
 *     due, one Annex A task per theme, clauses mapped, a phase and a task left
 *     out and one of the organisation's own added;
 *   - editing a template makes its next version and leaves the plans already
 *     made from it exactly as they were; retiring one hides it from the wizard;
 *   - "Save as template" keeps the method and drops the client: no people, no
 *     organisation or entity names, no dates;
 *   - a firm's template is invisible to another firm and to its clients (404);
 *   - every route has a caller on a screen.
 *
 *   npm run build && API=http://127.0.0.1:3000 node scripts/verify/engagement-s3-templates-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const T = require('../../dist/services/planTemplates');
const { PLATFORM_PLAN_TEMPLATES } = require('../../dist/utils/planTemplateCatalogue');

const v = q.verdicts('engagement-s3');
const DAY = 86_400_000;
const today = new Date(new Date().toISOString().slice(0, 10));
const at = (n) => new Date(today.getTime() + n * DAY);
const day = (n) => at(n).toISOString().slice(0, 10);
const stamp = Date.now().toString(36);

// ── The rules, without a database ───────────────────────────────────────────
const iso = PLATFORM_PLAN_TEMPLATES.find((t) => t.familyId === 'platform-iso27001-certification');
{
  const checked = T.checkTemplateBody(iso);
  const backwards = T.checkTemplateBody({
    name: 'Backwards', phases: [{ name: 'One', durationDays: 5, tasks: [
      { key: 'a', name: 'First', side: 'Client', durationDays: 2, dependsOnKey: 'b' },
      { key: 'b', name: 'Second', side: 'Client', durationDays: 2 },
    ] }],
  });
  const twice = T.checkTemplateBody({
    name: 'Twice', phases: [{ name: 'One', durationDays: 5, tasks: [
      { key: 'a', name: 'First', side: 'Client', durationDays: 2 },
      { key: 'a', name: 'Again', side: 'Client', durationDays: 2 },
    ] }],
  });
  v.record('engagement-s3:the ISO 27001 template has 7 phases and every template is checked before it is kept',
    checked.ok && checked.body.phases.length === 7 && !backwards.ok && !twice.ok,
    checked.ok ? `${backwards.message || ''} / ${twice.message || ''}` : checked.message);

  const clauses = [
    { id: 'c1', ref: 'A.5.15', title: 'Access control' }, { id: 'c2', ref: 'A.5.16', title: 'Identity management' },
    { id: 'c3', ref: 'A.8.7', title: 'Protection against malware' }, { id: 'c4', ref: 'A.50.1', title: 'Not A.5' },
  ];
  const tmpl = { phases: checked.body.phases.map((p, i) => ({ ...p, id: `p${i}`, description: null })) };
  const plan = T.planFromTemplate({
    template: tmpl, startDate: at(0), clauses,
    excludePhaseIds: ['p3'], excludeTaskKeys: ['s3'],
    customTasks: [{ phaseId: 'p0', name: 'Migrate evidence from SharePoint', side: 'Client', durationDays: 3 }],
  });
  const names = plan.phases.flatMap((p) => p.tasks.map((t) => t.name));
  const annex = plan.phases[1].tasks.filter((t) => t.name.startsWith('Review Annex A controls'));
  const chained = plan.phases.every((p, i) => i === 0 || p.startDate.getTime() === plan.phases[i - 1].targetEndDate.getTime());
  const s4 = plan.phases[0].tasks.find((t) => t.key === 's4');
  const s2 = plan.phases[0].tasks.find((t) => t.key === 's2');
  v.record('engagement-s3:a tailored template lays out a dated plan',
    plan.phases.length === 6 && !names.includes('Interested parties and their requirements')
      && names.includes('Migrate evidence from SharePoint') && chained
      && s4.startDate.getTime() === s2.dueDate.getTime()
      && annex.length === 2 && annex[0].name.endsWith('A.5') && annex[0].clauseIds.length === 2 && !annex[0].clauseIds.includes('c4'),
    `${plan.phases.length} phases; annex tasks ${annex.map((t) => t.name).join(' | ')}; chained ${chained}`);

  // Every copy of a split task keeps its link, every phase hands over to the
  // next, so the critical path runs the whole plan; and a phase ends with its
  // last task, so a new plan shows nothing early.
  const full = T.planFromTemplate({ template: tmpl, startDate: at(0), clauses });
  const fullTasks = full.phases.flatMap((p) => p.tasks);
  const intoReport = full.dependencies.filter((d) => d.successorKey === 'g4').map((d) => d.predecessorKey).sort();
  const phaseOf = (k) => full.phases.findIndex((p) => p.tasks.some((t) => t.key === k));
  const crossings = full.dependencies.filter((d) => phaseOf(d.predecessorKey) !== phaseOf(d.successorKey)).length;
  const { criticalPath } = require('../../dist/services/projectDependency');
  const cp = criticalPath(
    fullTasks.map((t) => ({ id: t.key, startDate: t.startDate, dueDate: t.dueDate, status: 'NotStarted' })),
    full.dependencies.map((d) => ({ predecessorId: d.predecessorKey, successorId: d.successorKey, kind: 'FinishToStart', lagDays: d.lagDays })),
  );
  const planDays = Math.round((full.endDate - at(0)) / DAY);
  const flush = full.phases.every((p) => p.targetEndDate.getTime() === Math.max(...p.tasks.map((t) => t.dueDate.getTime())));
  v.record('engagement-s3:split tasks keep every link, phases hand over, and nothing starts early',
    intoReport.join(',') === 'g3#1,g3#2' && crossings >= full.phases.length - 1
      && cp.lengthDays === planDays && new Set(cp.path.map(phaseOf)).size === full.phases.length && flush,
    `gap report waits on ${intoReport.join(', ')}; ${crossings} handovers; critical path ${cp.lengthDays} of ${planDays} days `
      + `across ${new Set(cp.path.map(phaseOf)).size} phases; phases end with their last task: ${flush}`);

  const body = T.templateFromPlan({
    name: 'From a plan', description: 'Built for Acme Holdings by Jane Roe on 2026-01-05, jane@acme.test',
    engagementType: 'Certification', standardCode: 'ISO27001',
    phases: [{ name: 'Acme Holdings scoping', description: null, startDate: at(0), targetEndDate: at(10), tasks: [
      { id: 'x', name: 'Interview Jane Roe', description: null, side: 'Client', weight: 1, verificationOverride: null,
        startDate: at(0), dueDate: at(4), clauseRefs: ['4.3'] },
    ] }],
    edges: [], strip: ['Acme Holdings', 'Jane Roe'],
  });
  const text = JSON.stringify(body);
  v.record('engagement-s3:saving a plan as a template drops people, names, emails and dates',
    !/Acme|Jane|2026-01-05|jane@/i.test(text) && body.phases[0].tasks[0].durationDays === 4
      && body.phases[0].durationDays === 10,
    text.slice(0, 200));

  v.record('engagement-s3:a firm\'s template is visible to that firm only',
    T.canSeeTemplate({ tenantIds: ['firmA'] }, { level: 'Firm', tenantId: 'firmA' })
      && !T.canSeeTemplate({ tenantIds: ['firmB'] }, { level: 'Firm', tenantId: 'firmA' })
      && !T.canSeeTemplate({ tenantIds: ['client'] }, { level: 'Firm', tenantId: 'firmA' })
      && T.canSeeTemplate({ tenantIds: [] }, { level: 'Platform', tenantId: null }),
    'canSeeTemplate');
}

// ── Every route has a caller ────────────────────────────────────────────────
{
  const dir = path.join(q.WEB_SRC, 'pages', 'grc', 'project');
  const wizard = q.read(path.join(dir, 'PlanWizard.tsx'));
  const library = q.read(path.join(dir, 'TemplateLibrary.tsx'));
  const plan = q.read(path.join(dir, 'ProjectPlan.tsx'));
  const host = q.read(path.join(q.WEB_SRC, 'pages', 'grc', 'DeliveryProjects.tsx'));
  const callers = {
    'GET /api/plan-templates': /apiClient\.get\('\/api\/plan-templates'\)/.test(wizard),
    'GET /api/plan-templates?all=1': /apiClient\.get\('\/api\/plan-templates', \{ params: \{ all: '1' \} \}\)/.test(library),
    'GET /api/plan-templates/:id': /apiClient\.get\(`\/api\/plan-templates\/\$\{id\}`\)/.test(wizard + library),
    'GET /api/plan-templates/similar-tasks': /apiClient\.get\('\/api\/plan-templates\/similar-tasks'/.test(wizard),
    'POST /api/plan-templates/:id/versions': /\/api\/plan-templates\/\$\{draft\.id\}\/versions/.test(library),
    'POST /api/plan-templates/:id/retire': /\/api\/plan-templates\/\$\{retiring\.id\}\/retire/.test(library),
    'POST /api/plan-templates/from-project/:projectId': /\/api\/plan-templates\/from-project\/\$\{projectId\}/.test(plan),
    'POST /api/projects/:id/plan-from-template': /\/api\/projects\/\$\{projectId\}\/plan-from-template`/.test(wizard)
      && /plan-from-template\?preview=1/.test(wizard),
    'the wizard in the Plan tab': /<PlanWizard\b/.test(plan),
    'the library in the project screen': /<TemplateLibrary\b/.test(host),
  };
  const missing = Object.entries(callers).filter(([, ok]) => !ok).map(([k]) => k);
  v.record('engagement-s3:every template route has a caller on a screen',
    missing.length === 0, `no caller for ${missing.join(', ')}`);
}

(async () => {
  const client = await q.login('grc.manager@omniops.me');
  const firmA = await q.login('engagement.manager@grcconsulting.com');
  const firmB = await q.login('franchisor.admin@retailco.com');
  const call = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const as = call(client);
  const me = client.user.id;

  // ── The platform template ────────────────────────────────────────────────
  const list = (await as('GET', '/api/plan-templates')).json?.templates || [];
  const platform = list.find((t) => t.level === 'Platform' && t.name === 'ISO 27001 certification');
  const edit = platform && await as('POST', `/api/plan-templates/${platform.id}/versions`, { name: 'Hijacked', phases: [] });
  v.record('engagement-s3:the platform template is there for every organisation, and only the platform changes it',
    platform?.phaseCount === 7 && edit?.status === 403 && edit.json?.code === 'TEMPLATE_READ_ONLY',
    `platform template ${platform ? `${platform.phaseCount} phases` : 'missing'}; edit HTTP ${edit?.status}`);
  if (!platform) { await prisma.$disconnect(); v.finish(); return; }

  // ── A new ISO 27001 engagement, planned from it ──────────────────────────
  const firms = (await as('GET', '/api/projects/engageable-providers')).json?.providers || [];
  const gcp = firms.find((f) => /GRC Consulting/i.test(f.name));
  const created = await as('POST', '/api/projects', {
    name: `S3 ISO 27001 ${stamp}`, startDate: day(7), targetEndDate: day(60), ownerId: me, managerId: me,
    projectType: 'Certification', providerTenantId: gcp?.id,
  });
  const project = created.json?.project;
  const detail = (await as('GET', `/api/plan-templates/${platform.id}`)).json?.template;
  const policies = detail?.phases?.find((p) => p.name === 'Policies');
  const body = {
    templateId: platform.id,
    excludePhaseIds: policies ? [policies.id] : [],
    excludeTaskKeys: ['s3'],
    customTasks: [{ phaseId: detail?.phases?.[0]?.id, name: 'Migrate evidence from SharePoint', side: 'Client', durationDays: 3 }],
  };
  const preview = await as('POST', `/api/projects/${project?.id}/plan-from-template?preview=1`, body);
  const applied = await as('POST', `/api/projects/${project?.id}/plan-from-template`, body);
  const again = await as('POST', `/api/projects/${project?.id}/plan-from-template`, body);
  const plan = (await as('GET', `/api/projects/${project?.id}/plan`)).json;
  const tasks = (plan?.phases || []).flatMap((p) => p.tasks || []);
  const annex = tasks.filter((t) => t.name.startsWith('Review Annex A controls'));
  const links = await prisma.projectTaskClause.count({ where: { task: { projectId: project?.id } } });
  const edges = await prisma.projectDependency.count({ where: { projectId: project?.id } });
  const firstStart = plan?.phases?.[0]?.startDate?.slice(0, 10);
  v.record('engagement-s3:a new ISO 27001 engagement gets a dated draft plan from the template',
    preview.status === 200 && applied.status === 201 && plan?.phases?.length === 6
      && tasks.some((t) => t.name === 'Migrate evidence from SharePoint')
      && !tasks.some((t) => t.name === 'Interested parties and their requirements')
      && annex.length === 2 && links > 0 && edges > 0 && firstStart === day(7)
      && tasks.every((t) => t.startDate && t.dueDate),
    `preview ${preview.status} ${preview.json?.message || ''}, apply ${applied.status} ${applied.json?.message || ''}, `
      + `${plan?.phases?.length} phases, ${tasks.length} tasks, annex ${annex.length}, ${links} clause links, ${edges} links, starts ${firstStart}`);

  // The Timeline's critical path runs the whole plan, not one phase of it.
  const timeline = (await as('GET', `/api/projects/${project?.id}/timeline`)).json;
  const span = plan?.phases?.length
    ? Math.round((new Date(plan.phases[plan.phases.length - 1].targetEndDate) - new Date(plan.phases[0].startDate)) / DAY) : 0;
  const pathPhases = new Set((timeline?.phases || []).filter((p) => p.tasks.some((t) => t.onCriticalPath)).map((p) => p.id)).size;
  v.record('engagement-s3:the critical path of a plan from a template runs from its first phase to its last',
    span > 0 && timeline?.criticalPath?.lengthDays === span && pathPhases === plan.phases.length,
    `critical path ${timeline?.criticalPath?.lengthDays} of ${span} days, across ${pathPhases} of ${plan?.phases?.length} phases`);
  const similar =(await as('GET', '/api/plan-templates/similar-tasks?q=asset%20list')).json?.tasks || [];
  v.record('engagement-s3:typing a custom task offers similar library tasks first',
    similar.some((t) => t.name === 'Supply the asset list'), similar.map((t) => t.name).join(', ') || 'none');
  v.record('engagement-s3:a template only starts an empty draft plan',
    again.status === 409 && again.json?.code === 'PLAN_NOT_EMPTY', `second apply HTTP ${again.status}`);

  const trail = await prisma.auditLog.findMany({
    where: { subjectId: project?.id, action: 'PROJECT_PLAN_FROM_TEMPLATE' }, select: { tenantId: true },
  });
  v.record('engagement-s3:the plan from a template is on the organisation\'s trail',
    trail.length === 1 && trail[0].tenantId === project?.tenantId, `${trail.length} entries`);

  // ── Edit a template: the plans made from it do not move ──────────────────
  const snapshot = (rows) => rows.map((t) => `${t.name}|${t.startDate}|${t.dueDate}`).join('\n');
  const saved = await as('POST', `/api/plan-templates/from-project/${project?.id}`, { name: `Our ISO method ${stamp}` });
  const mine = saved.json?.template;
  const clientProject = await as('POST', '/api/projects', {
    name: `S3 from our own ${stamp}`, startDate: day(7), targetEndDate: day(90), ownerId: me, managerId: me, projectType: 'Certification',
  });
  const cp = clientProject.json?.project;
  await as('POST', `/api/projects/${cp?.id}/plan-from-template`, { templateId: mine?.id });
  const before = snapshot(((await as('GET', `/api/projects/${cp?.id}/plan`)).json?.phases || []).flatMap((p) => p.tasks));
  const changed = mine && {
    name: mine.name,
    phases: mine.phases.map((p, i) => ({
      name: i === 0 ? 'Scoping, renamed' : p.name, durationDays: p.durationDays + 5,
      tasks: p.tasks.map((t) => ({ ...t, name: `${t.name} (v2)`, durationDays: t.durationDays + 2 })),
    })),
  };
  const v2 = mine && await as('POST', `/api/plan-templates/${mine.id}/versions`, changed);
  const after = snapshot(((await as('GET', `/api/projects/${cp?.id}/plan`)).json?.phases || []).flatMap((p) => p.tasks));
  v.record('engagement-s3:editing a template makes its next version and leaves existing plans unchanged',
    saved.status === 201 && mine?.level === 'Client' && v2?.status === 201 && v2.json?.template?.version === 2
      && before.length > 0 && before === after && !after.includes('(v2)'),
    `save ${saved.status} ${saved.json?.message || ''}, v2 ${v2?.status} ${v2?.json?.message || ''}, unchanged ${before === after}`);

  const stripped = JSON.stringify(mine || {});
  const org = await prisma.tenant.findUnique({ where: { id: project?.tenantId }, select: { name: true } });
  v.record('engagement-s3:the saved template carries no client names, people or dates',
    Boolean(mine) && !stripped.includes(org?.name || '§') && !stripped.includes(client.user.name || '§')
      && !/\d{4}-\d{2}-\d{2}T/.test(JSON.stringify(mine.phases)),
    `${org?.name} / ${client.user.name}`);

  // ── Retire: gone from the wizard, plans untouched ────────────────────────
  const latestId = v2?.json?.template?.id;
  const retired = latestId && await as('POST', `/api/plan-templates/${latestId}/retire`);
  const wizardList = (await as('GET', '/api/plan-templates')).json?.templates || [];
  const libraryList = (await as('GET', '/api/plan-templates?all=1')).json?.templates || [];
  const useRetired = await as('POST', `/api/projects/${cp?.id}/plan-from-template?preview=1`, { templateId: latestId });
  const stillThere = snapshot(((await as('GET', `/api/projects/${cp?.id}/plan`)).json?.phases || []).flatMap((p) => p.tasks));
  v.record('engagement-s3:a retired template leaves the wizard and changes no plan',
    retired?.status === 200 && !wizardList.some((t) => t.id === latestId) && libraryList.some((t) => t.id === latestId && t.status === 'Retired')
      && useRetired.status === 409 && stillThere === before,
    `retire ${retired?.status}, in wizard ${wizardList.some((t) => t.id === latestId)}, apply ${useRetired.status}`);

  // ── A firm's own library ─────────────────────────────────────────────────
  const firmSaved = await call(firmA)('POST', `/api/plan-templates/from-project/${project?.id}`, { name: `GRC Consulting method ${stamp}` });
  const firmT = firmSaved.json?.template;
  const byOtherFirm = firmT && await call(firmB)('GET', `/api/plan-templates/${firmT.id}`);
  const byClient = firmT && await as('GET', `/api/plan-templates/${firmT.id}`);
  const otherList = (await call(firmB)('GET', '/api/plan-templates?all=1')).json?.templates || [];
  const clientList = (await as('GET', '/api/plan-templates?all=1')).json?.templates || [];
  const byFirm = firmT && await call(firmA)('GET', `/api/plan-templates/${firmT.id}`);
  v.record('engagement-s3:a firm template is invisible to other firms and to its clients',
    firmSaved.status === 201 && firmT?.level === 'Firm' && byFirm?.status === 200
      && byOtherFirm?.status === 404 && byClient?.status === 404
      && !otherList.some((t) => t.id === firmT.id) && !clientList.some((t) => t.id === firmT.id),
    `save ${firmSaved.status} ${firmSaved.json?.message || ''} (${firmT?.level}); firm ${byFirm?.status}, other firm ${byOtherFirm?.status}, client ${byClient?.status}`);

  const clientTrail = await prisma.auditLog.count({
    where: { subjectId: project?.id, action: 'PROJECT_SAVED_AS_TEMPLATE', tenantId: project?.tenantId },
  });
  const firmTrail = firmT && await prisma.auditLog.count({
    where: { subjectId: firmT.id, action: 'PLAN_TEMPLATE_SAVED', tenantId: { not: project?.tenantId } },
  });
  v.record('engagement-s3:a firm saving a client\'s plan is on both trails',
    clientTrail === 1 && firmTrail === 1, `client ${clientTrail}, firm ${firmTrail}`);

  await prisma.$disconnect();
  v.finish(`${project?.ref}: ${tasks.length} tasks from the platform template`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
