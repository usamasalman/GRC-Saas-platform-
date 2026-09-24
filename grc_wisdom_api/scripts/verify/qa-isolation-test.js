/**
 * One organisation cannot reach another's records, and people inside one
 * reach only what their role allows.
 *
 * Three kinds of check:
 *
 *   isolation        every route that fetches one record by id, called with
 *                    the id of a record from ANOTHER organisation. The right
 *                    answer is 403 or 404; anything else is a leak. The route
 *                    list is read from the API, so a new record route is
 *                    probed without anybody remembering to add it — and one
 *                    this file cannot map to a record type fails until it is.
 *   confidentiality  inside one organisation, a staff member asking for
 *                    things that belong to a narrower role.
 *   wrong-target     a write aimed at one organisation landing on another.
 *
 * Records the demo seed does not create — a legal matter, a draft article, a
 * running approval, a project with a task — are created here first, so those
 * routes are genuinely probed rather than skipped for want of data.
 *
 *   API=http://127.0.0.1:3000 node scripts/verify/qa-isolation-test.js
 */
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');

const iso = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

/** route pattern -> how to find a record of that kind outside a set of tenants. */
const RECORD_OF = [
  [/^\/api\/(documents|legal\/documents)\/:id/, (out) => prisma.document.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/legal\/matters\/:id/, (out) => prisma.legalMatter.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/tenants\/:id/, (out) => prisma.tenant.findFirst({ where: { id: out.tenantId, type: { notIn: ['SAAS', 'SAAS_UNIT'] } }, select: { id: true } })],
  [/^\/api\/iam\/roles\/:id/, (out) => prisma.role.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/iam\/users\/:id/, (out) => prisma.user.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/itsm\/workflows\/runs\/:id/, (out) => prisma.workflowRun.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/itsm\/tickets\/:id/, (out) => prisma.ticket.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/itsm\/knowledge\/:id/, (out) => prisma.knowledgeArticle.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/grc\/(\w+\/)?imports\/:id/, (out) => prisma.frameworkImport.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/grc\/audits\/:id/, (out) => prisma.audit.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/grc\/plans\/:id/, (out) => prisma.auditPlan.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/grc\/implementations\/:id/, (out) => prisma.controlImplementation.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/grc\/rcsa\/:id/, (out) => prisma.rcsaCampaign.findFirst({ where: out, select: { id: true } })],
  [/^\/api\/projects\/tasks\/:taskId/, (out) => prisma.projectTask.findFirst({ where: { project: out }, select: { id: true } })],
  [/^\/api\/projects\/evidence\/:evidenceId/, (out) => prisma.projectEvidence.findFirst({ where: { project: out }, select: { id: true } })],
  [/^\/api\/projects\/:id/, (out) => prisma.project.findFirst({ where: out, select: { id: true } })],
];
/** Routes that take a parameter but not a record id. */
const NOT_A_RECORD = {
  '/api/admin/db/table/:model': 'A table name, not a record; the router is platform-only (requirePlatformTenant).',
};

(async () => {
  const v = q.verdicts('qa-isolation');

  // ── Records the seed does not provide ────────────────────────────────────
  const omniGrc = await q.login('grc.manager@omniops.me');
  const omniSupport = await q.login('support.coordinator@omniops.me');
  const omniRisk = await q.login('risk.manager@omniops.me');
  const omniAsset = await q.login('asset.owner@omniops.me');
  const gbManager = await q.login('eleanor.vance@globalbank.com');
  const gbStaff = await q.login('alex.rivera@globalbank.com');
  const alnoorAdmin = await q.login('group.admin@alnoor.com');

  const seedCall = async (who, method, url, body, what) => {
    const r = await q.call(method, url, { token: who.token, body });
    await q.pace();
    if (r.status >= 300) throw new Error(`could not create ${what}: HTTP ${r.status} ${r.json?.message || r.text}`);
    return r.json;
  };

  const legalMatter = await seedCall(gbManager, 'POST', '/api/legal/matters', {
    reference: `QA-LIT-${Date.now()}`, title: 'Regulator inquiry — privileged',
    description: 'Privileged. Counsel: external. Do not discuss with staff.',
  }, 'a legal matter');
  const article = await seedCall(omniSupport, 'POST', '/api/itsm/knowledge', {
    title: 'OmniOps internal: incident bridge contacts', body: 'Internal only.', category: 'Security', status: 'DRAFT',
  }, 'a draft knowledge article');
  const catalog = await prisma.serviceCatalogItem.findFirst({ where: { workflowDefinitionId: { not: null } }, select: { id: true } });
  const ticket = await seedCall(omniRisk, 'POST', '/api/itsm/tickets', {
    subject: 'Production read access for the risk review', description: 'Two weeks, read-only.',
    type: 'ServiceRequest', impact: 'Low', urgency: 'Low', catalogItemId: catalog?.id,
  }, 'a ticket that starts an approval workflow');
  const project = await seedCall(omniGrc, 'POST', '/api/projects', {
    name: 'QA isolation probe', startDate: iso(-5), targetEndDate: iso(60),
    ownerId: omniGrc.user.id, managerId: omniGrc.user.id,
  }, 'a project');
  const phase = await seedCall(omniGrc, 'POST', `/api/projects/${project.project.id}/phases`, {
    name: 'Probe', startDate: iso(-5), targetEndDate: iso(30), ownerId: omniGrc.user.id,
  }, 'a project phase');
  await seedCall(omniGrc, 'POST', `/api/projects/phases/${phase.phase.id}/tasks`, {
    name: 'Probe task', assigneeId: omniGrc.user.id, dueDate: iso(7),
  }, 'a project task');

  // ── Isolation ────────────────────────────────────────────────────────────
  const routes = q.routeTable().filter((r) => r.method === 'GET' && (r.path.match(/:\w+/g) || []).length === 1);
  const outcome = new Map(); // key -> { ok, details[] }
  const note = (key, ok, detail) => {
    const o = outcome.get(key) || { ok: true, details: [], probes: 0 };
    o.probes += 1;
    if (!ok) { o.ok = false; o.details.push(detail); }
    outcome.set(key, o);
  };

  let probes = 0;
  let unprobed = 0;
  for (const attacker of [omniGrc, gbStaff, alnoorAdmin]) {
    const scopeRes = await q.call('GET', '/api/tenants', { token: attacker.token });
    await q.pace();
    const inScope = (scopeRes.json?.tenants || []).map((t) => t.id);
    const outside = { tenantId: { notIn: inScope.length ? inScope : ['-'] } };

    for (const r of routes) {
      if (NOT_A_RECORD[r.path]) continue;
      const rule = RECORD_OF.find(([re]) => re.test(r.path));
      const key = `isolation:GET ${r.path}`;
      if (!rule) { v.record(key, false, 'record route with no mapping in RECORD_OF — add one so it is probed'); continue; }
      const rec = await rule[1](outside);
      if (!rec) { unprobed += 1; continue; }
      const res = await q.call('GET', r.path.replace(/:\w+/, rec.id), { token: attacker.token });
      probes += 1;
      note(key, [403, 404].includes(res.status),
        `HTTP ${res.status} as ${attacker.user.role} @ ${attacker.user.tenantName}: ${res.text.slice(0, 90)}`);
      await q.pace();
    }
  }
  for (const [key, o] of outcome) v.record(key, o.ok, o.details.slice(0, 2).join(' | '));

  // ── Wrong-target writes ──────────────────────────────────────────────────
  // Cancelling somebody else's approval, by somebody with no part in it.
  const runId = ticket.workflow?.runId;
  if (runId) {
    const c = await q.call('POST', `/api/itsm/workflows/runs/${runId}/cancel`, {
      token: omniAsset.token, body: { reason: 'Not mine to cancel' },
    });
    await q.pace();
    v.record('isolation:cancel-others-workflow', c.status === 403,
      `the Asset Owner cancelled the Risk Manager's approval: HTTP ${c.status}`);
  } else {
    v.record('isolation:cancel-others-workflow setup', false, 'the ticket did not start a workflow run');
  }

  // Editing a child organisation's branding.
  const alScope = (await q.call('GET', '/api/tenants', { token: alnoorAdmin.token })).json?.tenants || [];
  await q.pace();
  const child = alScope.find((t) => t.id !== alnoorAdmin.user.tenantId);
  if (child) {
    const marker = `QA-${Date.now()}`;
    await q.call('PATCH', `/api/tenants/${child.id}/branding`, { token: alnoorAdmin.token, body: { displayName: marker } });
    await q.pace();
    const landed = await prisma.tenantBranding.findFirst({ where: { displayName: marker }, select: { tenantId: true } });
    v.record('isolation:branding-write-lands-on-target', landed?.tenantId === child.id,
      landed ? `the write landed on ${landed.tenantId === alnoorAdmin.user.tenantId ? 'the caller\'s own organisation' : landed.tenantId}` : 'nothing was written');
  }

  // ── Confidentiality inside one organisation ──────────────────────────────
  const staffGet = async (url) => {
    const r = await q.call('GET', url, { token: gbStaff.token });
    await q.pace();
    return r;
  };
  const matters = await staffGet('/api/legal/matters');
  v.record('confidentiality:staff-reads-legal-matters', matters.status === 403,
    `a Staff Employee listed ${(matters.json?.matters || []).length} legal matter(s): HTTP ${matters.status}`);
  // The matter created above, by id: taking it from the staff member's own
  // list would stop checking the moment the list is refused.
  const d = await staffGet(`/api/legal/matters/${legalMatter.matter.id}`);
  v.record('confidentiality:staff-reads-legal-matter-detail', d.status === 403,
    `a Staff Employee read the matter's description: HTTP ${d.status}`);
  for (const url of ['/api/system/health', '/api/system/security', '/api/system/brd']) {
    const r = await staffGet(url);
    v.record(`confidentiality:customer-reads-${url}`, r.status === 403,
      `a customer's Staff Employee received platform data: HTTP ${r.status}`);
  }

  // The draft article, from the organisation that wrote it, is not in anybody
  // else's list either way — the list was always scoped. Recorded so a change
  // to the list's scoping is caught too.
  const gbList = await staffGet('/api/itsm/knowledge');
  v.record('isolation:knowledge-list-scoped',
    !(gbList.json?.articles || []).some((a) => a.id === article.article?.id),
    'another organisation\'s draft appears in the article list');

  // ── Cross-organisation writes ────────────────────────────────────────────
  //
  // The read probes above could not have found this, so it is a separate
  // sweep: every write route that names one record, called with the id of a
  // record from ANOTHER organisation and an empty body. A 2xx means the write
  // reached a record the caller had no business touching. Found this way:
  // OmniOps's Finance Manager marked RetailCo's SAR 238,050 invoice PAID and
  // "reconciled against tax records" (QA-012).
  //
  // Destructive by design, on a throwaway database the next suite reseeds.
  // Last in this file because a leaking write can change what other checks see.
  const omniFinance = await q.login('finance.manager@omniops.me');
  const WRITE_OF = [
    ...RECORD_OF,
    [/^\/api\/billing\/invoices\/:id/, (out) => prisma.invoice.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/billing\/subscriptions\/:id/, (out) => prisma.subscription.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/grc\/risks\/:id/, (out) => prisma.risk.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/grc\/assets\/:id/, (out) => prisma.asset.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/grc\/vendors\/:id/, (out) => prisma.vendor.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/grc\/issues\/:id/, (out) => prisma.issue.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/grc\/kris\/:(id|kriId)/, (out) => prisma.kri.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/grc\/loss-events\/:id/, (out) => prisma.lossEvent.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/grc\/universe\/:id/, (out) => prisma.auditableEntity.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/iam\/users\/:(id|userId)/, (out) => prisma.user.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/iam\/departments\/:id/, (out) => prisma.department.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/retention\/schedules\/:id/, (out) => prisma.retentionSchedule.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/retention\/documents\/:id/, (out) => prisma.document.findFirst({ where: out, select: { id: true } })],
    [/^\/api\/projects\/phases\/:phaseId/, (out) => prisma.projectPhase.findFirst({ where: { project: out }, select: { id: true } })],
    [/^\/api\/usage\/quotas\/:id/, (out) => prisma.resourceQuota.findFirst({ where: out, select: { id: true } })],
  ];
  const writeRoutes = q.routeTable().filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method)
    && (r.path.match(/:\w+/g) || []).length === 1 && !NOT_A_RECORD[r.path]);
  const writeOutcome = new Map();
  let writeProbes = 0;
  let reachedPastGuard = 0;
  const unmappedWrites = new Set();
  for (const attacker of [omniGrc, omniFinance, gbManager, alnoorAdmin]) {
    const scopeRes = await q.call('GET', '/api/tenants', { token: attacker.token });
    await q.pace();
    const inScope = (scopeRes.json?.tenants || []).map((t) => t.id);
    const outside = { tenantId: { notIn: inScope.length ? inScope : ['-'] } };
    for (const r of writeRoutes) {
      const rule = WRITE_OF.find(([re]) => re.test(r.path));
      if (!rule) { unmappedWrites.add(`${r.method} ${r.path}`); continue; }
      const rec = await rule[1](outside);
      if (!rec) continue;
      const res = await q.call(r.method, r.path.replace(/:\w+/, rec.id), {
        token: attacker.token, body: r.method === 'DELETE' ? undefined : {},
      });
      writeProbes += 1;
      if (res.status !== 403) reachedPastGuard += 1;
      const key = `isolation-write:${r.method} ${r.path}`;
      const o = writeOutcome.get(key) || { ok: true, details: [] };
      if (res.status < 300 || res.status >= 500) {
        o.ok = false;
        o.details.push(`HTTP ${res.status} as ${attacker.user.role} @ ${attacker.user.tenantName}: ${res.text.slice(0, 80)}`);
      }
      writeOutcome.set(key, o);
      await q.pace();
    }
  }
  for (const [key, o] of writeOutcome) v.record(key, o.ok, o.details.slice(0, 2).join(' | '));

  await prisma.$disconnect();
  v.finish(`${probes} read probes over ${routes.length} record routes (${unprobed} with no foreign record); `
    + `${writeProbes} write probes, ${reachedPastGuard} past the capability check, ${unmappedWrites.size} write routes not yet mapped`);
})().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
