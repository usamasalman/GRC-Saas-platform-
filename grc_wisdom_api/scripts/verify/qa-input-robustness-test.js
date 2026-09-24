/**
 * No input makes the server fall over.
 *
 * Every write route, called with an empty body and — where the path has
 * parameters — an id that does not exist. The right answers are 400, 403, 404
 * or 409. A 500 is input the server did not validate before using it, which is
 * how a missing field becomes a stack trace and, sometimes, a half-written
 * record.
 *
 * Run as several roles, because a route refuses at its capability check for
 * any role that lacks it and never reaches the code that validates input. The
 * roles below between them hold every capability a write route asks for.
 *
 * Runs LAST among the HTTP suites: a few routes accept an empty body and create
 * a placeholder record, which is correct behaviour and leaves junk behind.
 *
 *   API=http://127.0.0.1:3000 node scripts/verify/qa-input-robustness-test.js
 */
const crypto = require('crypto');
const q = require('./qa/lib');

/** Routes with their own tests, their own limiter, or side effects on the session. */
const SKIP = [/^\/api\/auth\//, /^\/api\/password-reset\//, /\/impersonation\/:id\/start$/];

(async () => {
  const v = q.verdicts('qa-input-robustness');
  const routes = q.routeTable().filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method)
    && !SKIP.some((re) => re.test(r.path)));

  const admin = q.adminCredentials();
  const accounts = [
    [admin.email, admin.password],
    ['grc.manager@omniops.me'],
    ['eleanor.vance@globalbank.com'],
    ['billing@grcwisdom.com'],
  ];

  const crashed = new Map(); // "METHOD path" -> detail
  const reached = new Set(); // routes that got past the capability check for somebody
  let calls = 0;
  for (const [email, password] of accounts) {
    const { token } = await q.login(email, password);
    for (const r of routes) {
      const url = r.path.replace(/:\w+/g, () => crypto.randomUUID());
      const res = await q.call(r.method, url, { token, body: r.method === 'DELETE' ? undefined : {} });
      calls += 1;
      if (res.status !== 403) reached.add(`${r.method} ${r.path}`);
      if (res.status >= 500 && !crashed.has(`${r.method} ${r.path}`)) {
        crashed.set(`${r.method} ${r.path}`, `HTTP ${res.status} as ${email}: ${res.text.slice(0, 100)}`);
      }
      await q.pace();
    }
  }

  for (const [key, detail] of crashed) v.record(`robustness:${key}`, false, detail);
  v.record('robustness:no server errors', crashed.size === 0, `${crashed.size} route(s) returned 5xx`);
  v.finish(`${calls} calls, ${routes.length} write routes, ${reached.size} reached past their capability check`);
})().catch((e) => { console.error(e); process.exit(1); });
