/**
 * Every call the browser makes has a route behind it, for that method.
 *
 * A screen that calls a path the API does not serve is broken by construction
 * and fails only when somebody presses the button. This compares the two sides
 * directly: every apiClient call in src/ against every route in the API.
 *
 * Found this way: Tool Review sends PATCH /api/marketplace/tools/:id while the
 * API serves /tools/:id/review, so approving a tool always 404s (QA-005).
 *
 *   node scripts/verify/qa-api-contract-test.js
 */
const path = require('path');
const q = require('./qa/lib');

const routes = q.routeTable();
const calls = q.frontendCalls();

/** A call path as a matcher: `${x}` stands for anything within one segment. */
function callSegments(raw) {
  return raw.split('?')[0].replace(/\/+$/, '').split('/').filter(Boolean).map((seg) => {
    if (!seg.includes('${')) return { literal: seg };
    const re = seg.split(/\$\{[^}]*\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
    return { re: new RegExp(`^${re}$`) };
  });
}
function matches(routePath, raw) {
  const r = routePath.split('/').filter(Boolean);
  const c = callSegments(raw);
  if (r.length !== c.length) return false;
  return r.every((s, i) => s.startsWith(':') || (c[i].literal ? c[i].literal === s : c[i].re.test(s)));
}

/**
 * `${base}/…` in the shared import panel: base is `/api/grc/${config.resource}`
 * and each screen that uses the panel names its resource. Expanded here rather
 * than skipped — an unmatched import route would break three registers at once.
 */
function expand(call) {
  if (!call.raw.startsWith('${base}')) return [call.raw];
  const src = q.read(path.join(q.WEB_SRC, call.file));
  const base = (src.match(/const base = `([^`]+)`/) || [])[1];
  if (!base || !base.includes('${config.resource}')) return [];
  const resources = new Set();
  const walk = require('fs').readdirSync;
  const scan = (dir) => {
    for (const e of walk(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (/\.tsx?$/.test(e.name)) for (const m of q.read(p).matchAll(/\bresource: '([a-z-]+)'/g)) resources.add(m[1]);
    }
  };
  scan(q.WEB_SRC);
  return [...resources].map((r) => call.raw.replace('${base}', base.replace('${config.resource}', r)));
}

const v = q.verdicts('qa-api-contract');
let checked = 0;
let unresolved = 0;
for (const call of calls) {
  if (!call.raw.startsWith('/api') && !call.raw.startsWith('${base}')) continue;
  const paths = expand(call);
  if (paths.length === 0) { unresolved += 1; continue; }
  for (const p of paths) {
    checked += 1;
    const hits = routes.filter((r) => matches(r.path, p));
    const ok = hits.some((r) => r.method === call.method);
    v.record(`contract:${call.method} ${call.raw}`, ok, ok ? '' : hits.length
      ? `route exists only for ${[...new Set(hits.map((h) => h.method))].join('/')} (${call.file}:${call.line})`
      : `no route serves this path (${call.file}:${call.line})`);
  }
}

v.finish(`${calls.length} calls, ${checked} resolved, ${unresolved} unresolvable, ${routes.length} routes`);
