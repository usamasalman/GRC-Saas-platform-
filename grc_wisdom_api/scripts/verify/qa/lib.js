/**
 * Shared machinery for the QA suites.
 *
 * The suites answer questions no single feature suite asks: does every screen
 * load for every role, can one organisation reach another's records, does any
 * input make the server fall over, does every call the browser makes have a
 * route behind it. They read the same source the app is built from — the
 * route files, AppShell's menu, navCapabilities — so they follow the product
 * as it changes instead of a list somebody has to remember to update.
 */
const fs = require('fs');
const path = require('path');
const KNOWN = require('./known-defects');

const API_DIR = path.join(__dirname, '..', '..', '..');
const ROOT = path.join(API_DIR, '..');
const API_SRC = path.join(API_DIR, 'src');
const WEB_SRC = path.join(ROOT, 'src');

const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ─── Backend routes ─────────────────────────────────────────────────────────

/** Every route the API registers: method, full path, the guard text, the handler. */
function routeTable() {
  const app = strip(read(path.join(API_SRC, 'app.ts')));
  const importOf = {};
  for (const m of app.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/(\w+)'/g)) importOf[m[1]] = m[2];

  const routes = [];
  for (const m of app.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,([^\n]*)/g)) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], guards: m[3], routerGuard: '', file: 'app.ts' });
  }
  for (const m of app.matchAll(/app\.use\(\s*'([^']+)'\s*,([^;]*?)\b(\w+Routes)\b/g)) {
    const file = importOf[m[3]];
    if (!file) continue;
    const mountGuard = /requireCapability|requireAnyCapability|requirePlatformTenant/.test(m[2]) ? 'mount' : '';
    const src = strip(read(path.join(API_SRC, 'routes', `${file}.ts`)));
    // Whole statements, not lines: a guard written on the line after the path
    // is still a guard. The first version read line by line and reported two
    // guarded project routes as unguarded.
    const uses = [...src.matchAll(/router\.use\(([\s\S]*?)\);/g)]
      .filter((u) => /requireCapability|requireAnyCapability|requirePlatformTenant/.test(u[1]))
      .map((u) => u.index);
    for (const r of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'\s*,([\s\S]*?)\);/g)) {
      const routerGuard = mountGuard || (uses.some((at) => at < r.index) ? 'router.use' : '');
      routes.push({
        method: r[1].toUpperCase(),
        path: (m[1] + (r[2] === '/' ? '' : r[2])).replace(/\/+$/, '') || '/',
        guards: r[3],
        routerGuard,
        file: `${file}.ts`,
      });
    }
  }
  return routes;
}

const isGuarded = (r) => Boolean(r.routerGuard)
  || /requireCapability|requireAnyCapability|requirePlatformTenant|MAY_[A-Z_]+/.test(r.guards);

// ─── Frontend calls ─────────────────────────────────────────────────────────

function walk(dir, test, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}

/** Every apiClient call in the browser code: method, the literal path, where. */
function frontendCalls() {
  const calls = [];
  for (const file of walk(WEB_SRC, (n) => /\.(tsx?|jsx?)$/.test(n))) {
    const src = strip(read(file));
    const re = /apiClient\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\(\s*(['`])([^'`]*)\2/g;
    for (const m of src.matchAll(re)) {
      calls.push({
        method: m[1].toUpperCase(),
        raw: m[3],
        file: path.relative(WEB_SRC, file).replace(/\\/g, '/'),
        line: src.slice(0, m.index).split('\n').length,
      });
    }
  }
  return calls;
}

// ─── The menu, as the app builds it ─────────────────────────────────────────

function menuModel() {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  const shell = read(path.join(WEB_SRC, 'pages', 'AppShell.tsx'));
  const navStart = shell.indexOf('const NAV: Record<string, any[]> = {');
  const navEnd = shell.indexOf('\n};', navStart);
  // eslint-disable-next-line no-new-func
  const NAV = new Function(`return ${shell.slice(shell.indexOf('{', navStart), navEnd + 2)}`)();

  const js = ts.transpileModule(read(path.join(WEB_SRC, 'pages', 'navCapabilities.ts')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', js)(mod, mod.exports);

  const imports = {};
  for (const m of shell.matchAll(/import\s+(?:\{\s*)?(\w+)(?:\s*\})?\s+from\s+'(\.[^']+)'/g)) imports[m[1]] = m[2];
  const keyToComp = {};
  for (const m of strip(shell).matchAll(/if\s*\(([^)]*currentPage[^)]*)\)\s*\{\s*return\s*<(\w+)/g)) {
    for (const k of m[1].matchAll(/currentPage === '([^']+)'/g)) keyToComp[k[1]] = m[2];
  }
  // The dashboard is chosen by portal, not by the render switch.
  const grcDash = new Set(['holding', 'multibranch', 'branch', 'franchise', 'partner', 'auditor']);

  const resolve = (fromDir, rel) => {
    for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
      const p = path.resolve(fromDir, rel + ext);
      if (fs.existsSync(p)) return p;
    }
    return null;
  };
  const cache = {};
  /**
   * The GETs a screen makes when it OPENS. Calls inside click handlers are
   * left out — the first version of this counted a button-triggered call and
   * reported a 403 on a button the role never sees.
   */
  const onOpen = (file, depth = 0, seen = new Set()) => {
    if (!file || seen.has(file)) return [];
    seen.add(file);
    const src = strip(read(file));
    const found = [];
    const handlerSpans = [...src.matchAll(/const (handle\w+|on[A-Z]\w+)\s*=\s*async/g)].map((h) => {
      const end = src.indexOf('\n  };', h.index);
      return [h.index, end > 0 ? end : h.index];
    });
    for (const m of src.matchAll(/apiClient\.get\s*(?:<[^>]*>)?\(\s*(['`])([^'`]*)\1/g)) {
      if (m[2].includes('${')) continue;
      if (handlerSpans.some(([a, b]) => m.index > a && m.index < b)) continue;
      found.push(m[2]);
    }
    if (depth < 2) {
      for (const m of src.matchAll(/import\s+\w+\s+from\s+'(\.[^']+)'/g)) {
        const f = resolve(path.dirname(file), m[1]);
        if (f && /[\\/](pages|components)[\\/]/.test(f)) found.push(...onOpen(f, depth + 1, seen));
      }
    }
    return found;
  };
  const screenFor = (portal, key) => (key === 'dashboard'
    ? (grcDash.has(portal) ? 'GrcSummaryDashboard' : 'RealtimeDashboardPage')
    : keyToComp[key]);
  const endpointsFor = (comp) => {
    if (!comp || !imports[comp]) return [];
    if (!cache[comp]) cache[comp] = [...new Set(onOpen(resolve(path.join(WEB_SRC, 'pages'), imports[comp])))];
    return cache[comp];
  };
  const visibleKeys = (portal, caps) => (NAV[portal] || [])
    .flatMap((g) => g[1].map((i) => i[0]))
    .filter((k) => mod.exports.navVisible(k, caps));

  return { NAV, NAV_CAPABILITY: mod.exports.NAV_CAPABILITY, visibleKeys, screenFor, endpointsFor };
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

const API = process.env.API || 'http://127.0.0.1:3000';

/**
 * The limiter allows 300 requests a minute per address. The suites stay under
 * it rather than around it — a QA run that needs the limiter switched off is
 * testing a different server from the one that ships.
 */
const PACE_MS = Number(process.env.QA_PACE_MS || 210);
const pace = () => new Promise((r) => setTimeout(r, PACE_MS));

async function call(method, url, { token, body } = {}) {
  const t0 = Date.now();
  const r = await fetch(API + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, ms: Date.now() - t0, json, text: text.slice(0, 240) };
}

/** Read out of seed.ts rather than written here, so this file publishes nothing. */
function demoPassword() {
  return read(path.join(API_SRC, 'seed.ts')).match(/const DEMO_PASSWORD = '([^']+)'/)[1];
}

async function login(email, password = demoPassword()) {
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200 || !r.json?.token) {
    throw new Error(`sign-in failed for ${email}: HTTP ${r.status} ${r.json?.message || r.text}`);
  }
  await pace();
  return { token: r.json.token, user: r.json.user };
}

/** The platform administrator: CI's bootstrap admin, or a local override. */
function adminCredentials() {
  return {
    email: process.env.ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD,
  };
}

// ─── Verdicts ───────────────────────────────────────────────────────────────

/**
 * Collects checks and decides the build against the known-defect register.
 *
 * record(key, ok, detail): key is "<suite>:<check>"; the same string appears
 * in known-defects.js for any check that reproduces an open defect.
 */
function verdicts(suite) {
  const checks = [];
  const knownFor = (key) => Object.entries(KNOWN).find(([, d]) => d.checks.includes(key));

  return {
    record(key, ok, detail = '') {
      checks.push({ key, ok, detail });
    },
    finish(extraSummary = '') {
      const fresh = [];
      const known = [];
      const fixed = [];
      for (const c of checks) {
        const k = knownFor(c.key);
        if (!c.ok && k) known.push({ ...c, id: k[0] });
        else if (!c.ok) fresh.push(c);
        else if (k) fixed.push({ ...c, id: k[0] });
      }
      // A defect whose checks never ran here is not evidence of anything.
      const passed = checks.length - fresh.length - known.length - fixed.length;
      console.log(`${suite}: ${checks.length} checks — ${passed} passed, ${known.length} known defect(s), `
        + `${fresh.length} NEW, ${fixed.length} now passing${extraSummary ? ` · ${extraSummary}` : ''}`);
      for (const k of known) console.log(`   known  ${k.id}  ${k.key}${k.detail ? ` — ${k.detail}` : ''}`);
      for (const f of fresh) console.log(`   NEW    ${f.key}${f.detail ? ` — ${f.detail}` : ''}`);
      for (const f of fixed) {
        console.log(`   FIXED? ${f.id}  ${f.key} now passes. Remove it from qa/known-defects.js and mark it `
          + 'Fixed in docs/qa/defect-register.md.');
      }
      if (fresh.length || fixed.length) process.exit(1);
    },
  };
}

module.exports = {
  ROOT, API_DIR, API_SRC, WEB_SRC, API, read, strip,
  routeTable, isGuarded, frontendCalls, menuModel,
  call, pace, login, demoPassword, adminCredentials, verdicts,
};
