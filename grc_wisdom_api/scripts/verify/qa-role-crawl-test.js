/**
 * Every screen on every role's menu loads for that role.
 *
 * For each distinct combination of portal and capabilities among the seeded
 * accounts, this signs in, builds the menu the way AppShell does, and calls
 * every endpoint each screen fetches when it opens. A server error, a missing
 * route, a refusal the screen does not handle, or a response over three
 * seconds is a finding.
 *
 * The first run of this, before it was a suite, made 1,649 calls across 44
 * roles and found one refusal on a screen that does not handle it (QA-008).
 *
 *   API=http://127.0.0.1:3000 node scripts/verify/qa-role-crawl-test.js
 */
const q = require('./qa/lib');
const { prisma } = require('../../dist/db');

/**
 * Refusals a screen expects and handles, so they are not failures. Each one
 * names where the handling is, so a reader can check it is still there.
 */
const HANDLED_403 = {
  '/api/retention/queue': 'RetentionSchedules hides the disposition queue for roles without retention (queueReadable=false)',
};
const SLOW_MS = 3000;

(async () => {
  const menu = q.menuModel();
  const v = q.verdicts('qa-role-crawl');
  const admin = q.adminCredentials();

  const users = await prisma.user.findMany({
    where: { status: 'Active' },
    select: { email: true, role: true },
    orderBy: { email: 'asc' },
  });

  // One account per role name, then one per distinct portal + capabilities.
  const byRole = new Map();
  for (const u of users) if (!byRole.has(u.role)) byRole.set(u.role, u);

  const seen = new Set();
  const outcomes = new Map(); // "403 /api/x" -> { roles, screens }
  let calls = 0;
  let accounts = 0;
  for (const [, u] of byRole) {
    const password = u.email === admin.email ? admin.password : undefined;
    let session;
    try { session = await q.login(u.email, password); } catch (e) {
      v.record(`crawl:sign-in ${u.role}`, false, e.message);
      continue;
    }
    const { token, user } = session;
    const shape = `${user.portal}|${[...user.capabilities].sort().join(',')}`;
    if (seen.has(shape)) continue;
    seen.add(shape);
    accounts += 1;

    const called = new Set();
    for (const key of menu.visibleKeys(user.portal, user.capabilities)) {
      const screen = menu.screenFor(user.portal, key);
      for (const url of menu.endpointsFor(screen)) {
        if (called.has(url)) continue;
        called.add(url);
        const r = await q.call('GET', url, { token });
        calls += 1;
        let outcome = null;
        if (r.status >= 500) outcome = `${r.status} ${url}`;
        else if (r.status === 404) outcome = `404 ${url}`;
        else if (r.status === 403 && !HANDLED_403[url]) outcome = `403 ${url}`;
        else if (r.ms > SLOW_MS) outcome = `slow ${url}`;
        if (outcome) {
          const o = outcomes.get(outcome) || { roles: new Set(), screens: new Set(), msg: r.json?.message || r.text };
          o.roles.add(user.role);
          o.screens.add(`${user.portal}/${key}`);
          outcomes.set(outcome, o);
        }
        await q.pace();
      }
    }
  }

  v.record('crawl:covered some accounts', accounts > 0, 'no account could sign in');
  for (const [outcome, o] of outcomes) {
    v.record(`crawl:${outcome}`, false,
      `${o.roles.size} role(s), screens ${[...o.screens].slice(0, 4).join(', ')} — ${String(o.msg).slice(0, 90)}`);
  }
  // Everything that did not produce an outcome passed; say how much that was.
  v.record('crawl:every other screen loaded', true);
  await prisma.$disconnect();
  v.finish(`${accounts} distinct role shapes, ${calls} screen loads`);
})().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch { /* closed */ }
  process.exit(1);
});
