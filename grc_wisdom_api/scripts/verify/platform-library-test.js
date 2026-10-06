/**
 * The platform's library, as its customers see it (QA-033, QA-034, QA-035).
 *
 * Here, against a real API:
 *
 *   - a framework and a control filed under the platform's own organisation,
 *     the way the platform wrote them before QA-031, are invisible to the
 *     customer the framework is enabled for; publishPlatformLibrary (run by
 *     provision on every deploy) moves them into the shared library, where the
 *     customer sees them, enabled; a code the library already holds is left
 *     where it is and reported; a second run publishes nothing; each move is on
 *     the platform's trail (QA-033);
 *   - a control the platform writes, or copies, goes to the library, and the
 *     platform still edits it; a customer's goes to its own set, and the
 *     customer cannot edit the library's (QA-034);
 *   - a template written for ISO27001 maps its tasks to a framework coded
 *     ISO-27001 (QA-035);
 *   - the enablement grid and the package panel say what a package has left.
 *
 *   npm run build && API=http://127.0.0.1:3000 ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/verify/platform-library-test.js
 */
const path = require('path');
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');
const { publishPlatformLibrary } = require('../../dist/services/platformLibrary');
const { frameworkKey, pickFramework } = require('../../dist/services/planTemplates');

const v = q.verdicts('platform-library');
const stamp = Date.now().toString(36).toUpperCase();
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

// ── The rules, without a database ───────────────────────────────────────────
{
  const rows = [{ id: 'a', code: 'ISO-27001' }, { id: 'b', code: 'ISO27001' }, { id: 'c', code: 'ISO 27002' }];
  v.record('platform-library:a framework code is matched as a person means it, an exact code first',
    frameworkKey('iso-27001') === 'ISO27001' && frameworkKey('ISO 27001') === 'ISO27001'
      && pickFramework(rows, 'ISO27001')?.id === 'b' && pickFramework([rows[0], rows[2]], 'ISO27001')?.id === 'a'
      && pickFramework([rows[2]], 'ISO27001') === null,
    'frameworkKey / pickFramework');
}

// ── What the screens say ────────────────────────────────────────────────────
{
  const src = (...p) => q.read(path.join(q.WEB_SRC, ...p));
  const grid = src('pages', 'grc', 'TenantStandardEnablement.tsx');
  const panel = src('components', 'PackagePanel.tsx');
  const repo = src('pages', 'grc', 'FrameworkAuthoring.tsx');
  v.record('platform-library:the enablement grid says what each package has left and offers enable only where it fits',
    /const roomFor = \(t: Tenant, standardId: string\)/.test(grid) && grid.includes("'package full'")
      && grid.includes('left` }') && /roomFor\(t, standard\.id\)\.fits/.test(grid),
    'TenantStandardEnablement: roomFor, "N left", "package full", the picker filtered');
  v.record('platform-library:the package panel says what is left, not only what is used',
    panel.includes('`${r.show(r.limit - r.used)} left`'), 'PackagePanel');
  v.record('platform-library:the platform keeps editing the library it writes',
    /isOwnedHere: boolean;/.test(repo) && /\{!c\.isOwnedHere\s*\n\s*\? <button onClick=\{\(\) => cloneControl\(c\)\}/.test(repo),
    'FrameworkAuthoring: edit, remap and delete follow isOwnedHere');
}

(async () => {
  const { email, password } = q.adminCredentials();
  if (!email || !password) {
    console.log('platform-library: skipped — no ADMIN_EMAIL/ADMIN_PASSWORD for the platform administrator');
    await prisma.$disconnect();
    v.finish();
    return;
  }
  const admin = await q.login(email, password);
  const customer = await q.login('grc.manager@omniops.me');
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const platform = as(admin);
  const client = as(customer);
  const omni = (await prisma.user.findUnique({ where: { id: customer.user.id }, select: { tenantId: true } })).tenantId;
  const controlPlane = await prisma.tenant.findFirst({ where: { type: 'SAAS' }, select: { id: true } });
  const standardsSeen = async () => ((await client('GET', '/api/grc/standards')).json?.standards || []);
  // The control list is not paged; it is searched, by code here.
  const controlsSeen = async (who, code) => ((await as(who)('GET', `/api/grc/controls?search=${encodeURIComponent(code)}`)).json?.controls || []);

  // ── QA-033: content the platform filed under itself, before QA-031 ───────
  const legacy = await prisma.standard.create({
    data: {
      tenantId: controlPlane.id, code: `QA033-STD-${stamp}`, title: 'QA-033 framework written before QA-031',
      authority: 'QA', version: '1', isSystem: false,
      clauses: { create: [{ ref: '1', title: 'First clause' }, { ref: '2', title: 'Second clause' }] },
    },
    include: { clauses: true },
  });
  const legacyControl = await prisma.control.create({
    data: {
      tenantId: controlPlane.id, code: `QA033-CTL-${stamp}`, title: 'QA-033 control', objective: 'Proves the library is shared', domain: 'Organizational',
      clauseLinks: { create: [{ clauseId: legacy.clauses[0].id }] },
    },
  });
  // A code the library already holds stays where it is.
  const dupCode = `QA033-DUP-${stamp}`;
  await prisma.standard.create({ data: { tenantId: null, code: dupCode, title: 'Already in the library', authority: 'QA', version: '1', isSystem: false } });
  const dup = await prisma.standard.create({ data: { tenantId: controlPlane.id, code: dupCode, title: 'Same code, the platform\'s own', authority: 'QA', version: '1', isSystem: false } });
  // Enabled for the customer, as the platform could before.
  await prisma.tenantStandardEnablement.create({ data: { tenantId: omni, standardId: legacy.id, applicability: 'Full' } });

  const before = {
    standard: (await standardsSeen()).some((s) => s.id === legacy.id),
    control: (await controlsSeen(customer, legacyControl.code)).some((c) => c.id === legacyControl.id),
  };
  const first = await publishPlatformLibrary(prisma);
  const again = await publishPlatformLibrary(prisma);
  const seen = (await standardsSeen()).find((s) => s.id === legacy.id);
  const seenControl = (await controlsSeen(customer, legacyControl.code)).find((c) => c.id === legacyControl.id);
  const dupNow = await prisma.standard.findUnique({ where: { id: dup.id }, select: { tenantId: true } });
  const trail = await prisma.auditLog.count({
    where: { tenantId: controlPlane.id, action: { in: ['STANDARD_PUBLISHED_TO_LIBRARY', 'CONTROL_PUBLISHED_TO_LIBRARY'] }, subjectId: { in: [legacy.id, legacyControl.id] } },
  });
  v.record('platform-library:a framework and a control the platform filed under itself are published, and the customer sees them, enabled',
    before.standard === false && before.control === false
      && first.standards.includes(legacy.code) && first.controls.includes(legacyControl.code)
      && seen?.isEnabledHere === true && seen.publishedPlatformWide === true && seen.clauseCount === 2
      && seenControl?.isLibrary === true && (seenControl.mappedTo || []).some((m) => m.standardCode === legacy.code)
      && trail === 2,
    `before: framework ${before.standard}, control ${before.control}; published ${JSON.stringify({ s: first.standards.length, c: first.controls.length })}; `
      + `customer sees ${seen ? `${seen.code} enabled ${seen.isEnabledHere}` : 'nothing'}, control ${Boolean(seenControl)}; trail ${trail}`);
  v.record('platform-library:a code the library already holds is left where it is and reported; a second run publishes nothing',
    first.skipped.some((x) => x.kind === 'Standard' && x.code === dupCode) && dupNow?.tenantId === controlPlane.id
      && again.standards.length === 0 && again.controls.length === 0,
    `skipped ${JSON.stringify(first.skipped)}; duplicate owner ${dupNow?.tenantId === controlPlane.id ? 'the platform' : dupNow?.tenantId}; second run ${JSON.stringify(again)}`);

  // ── QA-034: a control the platform writes or copies is library content ───
  const written = await platform('POST', '/api/grc/controls', {
    code: `QA034-${stamp}`, title: 'QA-034 platform control', objective: 'Written by the platform', domain: 'Organizational',
  });
  const copied = await platform('POST', `/api/grc/controls/${legacyControl.id}/clone`, { code: `QA034-COPY-${stamp}` });
  const edited = await platform('PATCH', `/api/grc/controls/${written.json?.control?.id}`, { title: 'QA-034 platform control, edited' });
  const customerEdits = await client('PATCH', `/api/grc/controls/${written.json?.control?.id}`, { title: 'Not mine to edit' });
  const own = await client('POST', '/api/grc/controls', {
    code: `QA034-OWN-${stamp}`, title: 'QA-034 customer control', objective: 'Written by the customer', domain: 'Organizational',
  });
  const platformView = (await controlsSeen(admin, `QA034-${stamp}`)).find((c) => c.id === written.json?.control?.id);
  const customerView = (await controlsSeen(customer, `QA034-${stamp}`)).find((c) => c.id === written.json?.control?.id);
  v.record('platform-library:a control the platform writes or copies goes to the library and the platform still edits it; a customer\'s stays its own',
    written.status === 201 && written.json?.control?.tenantId === null
      && copied.status === 201 && copied.json?.control?.tenantId === null
      && edited.status === 200 && customerEdits.status === 403
      && own.status === 201 && own.json?.control?.tenantId === omni
      && platformView?.isOwnedHere === true && customerView?.isOwnedHere === false && customerView?.isLibrary === true,
    `write ${written.status} owner ${written.json?.control?.tenantId}; copy ${copied.status} owner ${copied.json?.control?.tenantId}; `
      + `platform edits ${edited.status}, customer edits ${customerEdits.status}; customer's own ${own.status} owner ${own.json?.control?.tenantId === omni ? 'customer' : own.json?.control?.tenantId}; `
      + `owned here: platform ${platformView?.isOwnedHere}, customer ${customerView?.isOwnedHere}`);

  // ── QA-035: a template for ISO27001 maps to ISO-27001 ─────────────────────
  const hyphen = await platform('POST', '/api/grc/standards', {
    code: `ISO-27001-${stamp}`, title: 'QA-035 hyphenated', authority: 'QA', version: '2022',
    clauses: ['4.1', '4.2', '4.3', '6.1.2', '6.1.3', 'A.5.1', 'A.8.1'].map((ref) => ({ ref, title: `Clause ${ref}` })),
  });
  // Written with a unique code, then given exactly ISO-27001: the code a
  // library written by hand holds, and the one the template must find.
  const hyphenId = hyphen.json?.standard?.id;
  if (hyphenId) await prisma.standard.update({ where: { id: hyphenId }, data: { code: 'ISO-27001' } }).catch(() => null);
  if (hyphenId) await prisma.tenantStandardEnablement.create({ data: { tenantId: omni, standardId: hyphenId, applicability: 'Full' } }).catch(() => null);
  const me = customer.user.id;
  const project = (await client('POST', '/api/projects', {
    name: `QA-035 ${stamp}`, startDate: day(0), targetEndDate: day(120), ownerId: me, managerId: me, projectType: 'Certification', standardIds: [hyphenId],
  })).json?.project;
  const template = ((await client('GET', '/api/plan-templates')).json?.templates || []).find((t) => t.standardCode === 'ISO27001' && t.status === 'Active');
  const preview = project && template
    ? await client('POST', `/api/projects/${project.id}/plan-from-template?preview=1`, { templateId: template.id })
    : null;
  const mapped = (preview?.json?.phases || []).flatMap((p) => p.tasks).filter((t) => (t.clauseIds || []).length > 0).length;
  v.record('platform-library:a template written for ISO27001 maps its tasks to a framework coded ISO-27001',
    Boolean(project) && Boolean(template) && preview?.status === 200 && preview.json?.summary?.frameworkNote === null && mapped > 0,
    `project ${Boolean(project)}, template ${template?.name || 'none'}; preview ${preview?.status} note ${preview?.json?.summary?.frameworkNote ?? 'none'}; tasks mapped ${mapped}`);

  await prisma.$disconnect();
  v.finish(`QA-033 published ${first.standards.length} framework(s) and ${first.controls.length} control(s)`);
})().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
