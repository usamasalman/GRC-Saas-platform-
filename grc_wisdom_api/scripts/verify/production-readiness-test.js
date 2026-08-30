/**
 * Production readiness — the security properties that must hold before this
 * platform faces the internet.
 *
 * Every assertion here corresponds to something that was actually wrong in the
 * codebase, not a hypothetical. If one of these fails, a specific real defect
 * has come back.
 *
 * Expects: a running server against a database that has been migrated and
 * provisioned, with a known admin account.
 *
 *   DATABASE_URL=postgresql://...  \
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... \
 *   node scripts/verify/production-readiness-test.js
 */
const API = process.env.API || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let pass = 0, fail = 0;
const ok = (l, d = '') => { pass++; console.log(`   PASS  ${l}${d ? ` — ${d}` : ''}`); };
const bad = (l, d = '') => { fail++; console.log(`   FAIL  ${l}${d ? ` — ${d}` : ''}`); };

async function api(path, { token, method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  return { status: r.status, json: j, text: t, headers: r.headers };
}

/** Recursively hunt for any key that should never cross the wire. */
const FORBIDDEN = ['passwordhash', 'mfasecret', 'refreshtokenhash', 'backupcodes', 'resetcodehash'];
function findSecrets(value, path = '$', hits = []) {
  if (value === null || typeof value !== 'object') return hits;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findSecrets(v, `${path}[${i}]`, hits));
    return hits;
  }
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN.includes(k.toLowerCase())) {
      // A redacted placeholder is the intended behaviour; a real value is not.
      const redacted = v === null || (typeof v === 'string' && v.includes('hidden'));
      if (!redacted) hits.push(`${path}.${k}`);
    }
    findSecrets(v, `${path}.${k}`, hits);
  }
  return hits;
}

async function main() {
  console.log(`\n─── Production readiness · ${API} ───\n`);

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set.');
    process.exit(1);
  }

  // ── 1. The service is up ────────────────────────────────────────────────
  console.log('1. Service');
  const health = await api('/health');
  health.status === 200
    ? ok('health endpoint responds')
    : bad('health endpoint responds', `got ${health.status}`);

  // ── 2. Removed endpoints stay removed ───────────────────────────────────
  console.log('\n2. Endpoints that leaked data are gone');

  const demo = await api('/api/auth/demo-identities');
  demo.status === 404
    ? ok('/api/auth/demo-identities is gone')
    : bad('/api/auth/demo-identities is gone',
        `returned ${demo.status} — this endpoint listed every user in every tenant, unauthenticated`);

  // ── 3. Bootstrap self-closes ────────────────────────────────────────────
  console.log('\n3. First-run bootstrap');

  const status = await api('/api/auth/bootstrap-status');
  status.json?.initialised === true
    ? ok('bootstrap-status reports initialised')
    : bad('bootstrap-status reports initialised', JSON.stringify(status.json));

  const hijack = await api('/api/auth/register-admin', {
    method: 'POST',
    body: { email: 'attacker@example.com', name: 'Attacker', password: 'a-very-long-password' },
  });
  hijack.status === 403
    ? ok('register-admin refuses once a user exists')
    : bad('register-admin refuses once a user exists',
        `returned ${hijack.status} — anyone could attach an admin account to the first tenant`);

  // ── 4. Real authentication works ────────────────────────────────────────
  console.log('\n4. Authentication');

  const badPw = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: 'definitely-not-the-password' },
  });
  badPw.status === 401
    ? ok('wrong password is rejected')
    : bad('wrong password is rejected', `got ${badPw.status}`);

  const unknown = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'nobody-here@example.com', password: 'definitely-not-the-password' },
  });
  unknown.json?.message === badPw.json?.message
    ? ok('unknown address and wrong password are indistinguishable')
    : bad('unknown address and wrong password are indistinguishable',
        'the difference lets an attacker enumerate valid accounts');

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const token = login.json?.token;
  token
    ? ok('provisioned admin can sign in')
    : bad('provisioned admin can sign in',
        `${login.status} ${JSON.stringify(login.json)} — the old CLI stored the password in plaintext, so bcrypt.compare always failed`);

  if (!token) {
    console.log('\nCannot continue without a session.\n');
    process.exit(1);
  }

  findSecrets(login.json).length === 0
    ? ok('login response carries no credential fields')
    : bad('login response carries no credential fields', findSecrets(login.json).join(', '));

  // ── 5. The admin actually has capabilities ──────────────────────────────
  console.log('\n5. The admin can do something');

  const me = await api('/api/auth/me', { token });
  me.status === 200 ? ok('/api/auth/me returns the profile') : bad('/api/auth/me', `got ${me.status}`);

  const users = await api('/api/iam/users', { token });
  users.status === 200
    ? ok('admin can read the user directory')
    : bad('admin can read the user directory',
        `got ${users.status} — an admin with roleId null resolves to zero capabilities`);

  findSecrets(users.json).length === 0
    ? ok('user directory carries no credential fields')
    : bad('user directory carries no credential fields', findSecrets(users.json).join(', '));

  const caps = await api('/api/iam/capabilities', { token });
  const capCount = caps.json?.capabilities?.length ?? caps.json?.count ?? 0;
  capCount >= 34
    ? ok('capability catalogue is provisioned', `${capCount} capabilities`)
    : bad('capability catalogue is provisioned',
        `found ${capCount}, expected at least 34 — provision did not run`);

  const roles = await api('/api/iam/roles', { token });
  const roleCount = roles.json?.roles?.length ?? roles.json?.count ?? 0;
  roleCount >= 42
    ? ok('system roles are provisioned', `${roleCount} roles`)
    : bad('system roles are provisioned', `found ${roleCount}, expected at least 42`);

  // ── 6. Unauthenticated access is refused ────────────────────────────────
  console.log('\n6. Authorisation');

  const noAuth = await api('/api/iam/users');
  noAuth.status === 401
    ? ok('user directory requires a token')
    : bad('user directory requires a token', `got ${noAuth.status}`);

  const forged = await api('/api/iam/users', { token: 'not.a.real.token' });
  forged.status === 401
    ? ok('a forged token is rejected')
    : bad('a forged token is rejected', `got ${forged.status}`);

  const reset = await api('/api/admin/db/reset', { token, method: 'POST' });
  [403, 401, 404].includes(reset.status)
    ? ok('database reset is not reachable', `${reset.status}`)
    : bad('database reset is not reachable',
        `returned ${reset.status} — this re-runs a seed that opens with 58 deleteMany() calls`);

  // ── 7. CORS refuses strangers ───────────────────────────────────────────
  console.log('\n7. CORS');

  const evil = await api('/health', { headers: { Origin: 'https://evil.example.com' } });
  const allowed = evil.headers.get('access-control-allow-origin');
  !allowed || allowed === 'null'
    ? ok('an unlisted origin gets no allow-origin header')
    : bad('an unlisted origin gets no allow-origin header',
        `got "${allowed}" — with credentials enabled, any site could call this API as a signed-in user`);

  // ── 8. Login is rate limited ────────────────────────────────────────────
  console.log('\n8. Rate limiting');

  let limited = false;
  for (let i = 0; i < 15; i++) {
    const r = await api('/api/auth/login', {
      method: 'POST',
      body: { email: `probe${i}@example.com`, password: 'wrong-password-here' },
    });
    if (r.status === 429) { limited = true; break; }
  }
  limited
    ? ok('repeated failed logins are throttled')
    : bad('repeated failed logins are throttled',
        '15 failures went through — the rate limiter is not mounted');

  // ── Result ──────────────────────────────────────────────────────────────
  console.log(`\n─── ${pass} passed, ${fail} failed ───\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('\nTest harness error:', e); process.exit(1); });
