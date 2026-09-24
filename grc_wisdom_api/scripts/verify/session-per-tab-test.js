/**
 * A tab keeps acting as the person it was opened as.
 *
 * Reported from the running product: duplicate a tab, sign in as somebody else
 * in the copy, and the original tab "automatically shifts to the new login".
 *
 * The session lives in localStorage, which every tab of the site shares, and
 * the request interceptor read the token afresh on every call. So the first
 * tab went on SHOWING the first person — their name, their data, their
 * buttons — while every click it sent went out under the second person's
 * token. An approval pressed on a screen that said one name was executed and
 * written into the WORM trail under another, and every separation-of-duties
 * check ran against the wrong person.
 *
 * This suite runs the real module. sessionIdentity.ts is compiled with the
 * project's own TypeScript and executed against a fake browser, and the
 * scenarios below are replayed through it. Asserting on the source alone
 * would have passed a module whose comparison was simply wrong.
 *
 *   node scripts/verify/session-per-tab-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const API = path.join(__dirname, '..', '..');
const WEB = path.join(API, '..');
const SRC = path.join(WEB, 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const ts = require(path.join(WEB, 'node_modules', 'typescript'));

const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

// ─── A fake browser, one tab at a time ──────────────────────────────────────

const moduleSource = read(SRC, 'api', 'sessionIdentity.ts');
const compiled = ts.transpileModule(moduleSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

/** A JWT-shaped token. Unsigned: the module reads claims, the server verifies. */
function token(claims) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(claims)}.signature`;
}

/**
 * Open a tab at a path, with a storage the test can change "from another tab".
 * Storage is shared, as it is in a browser; each tab gets its own copy of the
 * module and its own storage-event listeners.
 */
function openTab(storage, pathname) {
  const handlers = [];
  const sandbox = {
    exports: {},
    module: { exports: {} },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    window: {
      location: { pathname },
      addEventListener: (type, fn) => { if (type === 'storage') handlers.push(fn); },
    },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    TextDecoder,
    Uint8Array,
    JSON,
  };
  sandbox.module.exports = sandbox.exports;
  vm.runInNewContext(compiled, sandbox);
  const api = sandbox.module.exports;

  const seen = [];
  api.onIdentityChange((s) => seen.push(s));

  return {
    api,
    seen,
    /** What the browser does in THIS tab when ANOTHER tab writes. */
    otherTabWrote(key) { handlers.forEach((h) => h({ key })); },
    last() { return seen[seen.length - 1]; },
  };
}

const WASIF = { id: 'u-wasif', email: 'wasif@example.com', role: 'Platform Super Admin', tenantId: 't-saas' };
const MAHMOUD = { id: 'u-mahmoud', email: 'mahmoud@example.com', role: 'Organization GRC Manager', tenantId: 't-omni' };

function signedInAs(storage, user, name) {
  storage.set('grc_jwt_token', token(user));
  storage.set('grc_user_json', JSON.stringify({ id: user.id, name }));
}

// ─── 1. The reported bug ────────────────────────────────────────────────────
{
  const storage = new Map();
  signedInAs(storage, WASIF, 'Wasif Mehmood');
  const tabA = openTab(storage, '/app');

  eq(tabA.api.pinnedIdentity().key, 'u-wasif|', 'a tab opened inside the app is the person signed in');
  eq(tabA.api.blocksRequest(), false, 'and sends as them');
  eq(tabA.last(), null, 'with nothing to report');

  // The duplicated tab signs in as somebody else.
  signedInAs(storage, MAHMOUD, 'Mahmoud Abdulaziz');
  tabA.otherTabWrote('grc_jwt_token');

  const s = tabA.last();
  ok(s !== null, 'THE PACKET: the first tab is TOLD that another tab signed in as someone else');
  eq(s.was.label, 'Wasif Mehmood', 'it names who this tab was');
  eq(s.now.label, 'Mahmoud Abdulaziz', 'and who the browser is now');
  eq(
    tabA.api.blocksRequest(), true,
    'THE PACKET: and it refuses to send. Before this, its next click went out under the '
    + 'other person\'s token and was recorded as theirs',
  );
}

// ─── 1b. In the order a real sign-in writes ─────────────────────────────────
//
// Login.tsx stores the token, then the refresh token, then the user record —
// and the browser raises one storage event per write. A two-tab run in a real
// browser showed the notice naming the new person by EMAIL: the token event
// arrived while the user record still described the old person, and the later
// user-record event was ignored.
{
  const storage = new Map();
  signedInAs(storage, WASIF, 'Wasif Mehmood');
  const tabA = openTab(storage, '/app');

  storage.set('grc_jwt_token', token(MAHMOUD));
  tabA.otherTabWrote('grc_jwt_token');
  eq(tabA.last().now.label, 'mahmoud@example.com',
    'at the token write the only thing known about the new person is their email');

  storage.set('grc_refresh_token', 'r');
  tabA.otherTabWrote('grc_refresh_token');
  storage.set('grc_user_json', JSON.stringify({ id: MAHMOUD.id, name: 'Mahmoud Abdulaziz' }));
  tabA.otherTabWrote('grc_user_json');
  eq(tabA.last().now.label, 'Mahmoud Abdulaziz',
    'THE PACKET: and once the user record lands, the notice names them');
  eq(tabA.last().was.label, 'Wasif Mehmood', 'while still naming who this tab was');
}

// ─── 2. Things that must NOT trip it ────────────────────────────────────────
{
  const storage = new Map();
  signedInAs(storage, WASIF, 'Wasif Mehmood');
  const tabA = openTab(storage, '/app/risk');

  // Every fifteen minutes one tab renews the token — same person, new string.
  storage.set('grc_jwt_token', token({ ...WASIF, iat: 999 }));
  tabA.otherTabWrote('grc_jwt_token');
  eq(tabA.last(), null, 'a token renewed by another tab for the SAME person changes nothing');
  eq(tabA.api.blocksRequest(), false, 'and requests keep flowing');

  const before = tabA.seen.length;
  tabA.otherTabWrote('grc_theme');
  tabA.otherTabWrote('authPersonaId');
  eq(tabA.seen.length, before, 'a change to an unrelated key does not even re-evaluate');

  // This tab signs in again itself, as someone else.
  signedInAs(storage, MAHMOUD, 'Mahmoud Abdulaziz');
  tabA.api.pinCurrentIdentity();
  eq(tabA.api.blocksRequest(), false, 'this tab\'s OWN sign-in adopts the new person rather than stopping itself');
  eq(tabA.last(), null, 'and reports nothing');
}

// ─── 3. Signing out elsewhere ───────────────────────────────────────────────
{
  const storage = new Map();
  signedInAs(storage, WASIF, 'Wasif Mehmood');
  const tabA = openTab(storage, '/app');

  storage.delete('grc_jwt_token');
  tabA.otherTabWrote('grc_jwt_token');
  const s = tabA.last();
  ok(s !== null && s.now === null, 'a sign-out in another tab is reported as a sign-out');
  eq(
    tabA.api.blocksRequest(), false,
    'but a request with no token is not blocked — it is anonymous, cannot act as anybody, '
    + 'and the server refuses what needs a session',
  );

  // Signing straight back in as the same person clears the notice.
  signedInAs(storage, WASIF, 'Wasif Mehmood');
  tabA.otherTabWrote('grc_jwt_token');
  eq(tabA.last(), null, 'and signing back in as the same person clears it');
}

// ─── 4. Impersonation started in another tab ────────────────────────────────
{
  const storage = new Map();
  signedInAs(storage, WASIF, 'Wasif Mehmood');
  const tabA = openTab(storage, '/app');

  storage.set('grc_imp_token', token({ ...MAHMOUD, imp: { sessionId: 's-42', actorId: WASIF.id } }));
  tabA.otherTabWrote('grc_imp_token');
  const s = tabA.last();
  ok(s !== null, 'starting a customer view in one tab is noticed by the others');
  ok(/viewing as a customer/.test(s.now.label), 'and described as that');
  eq(tabA.api.blocksRequest(), true, 'the other tabs stop rather than quietly impersonating too');

  // Same customer, different session: the subject id alone cannot tell these
  // apart, and the second session has its own approval and its own expiry.
  const tabB = openTab(storage, '/app');
  eq(tabB.api.blocksRequest(), false, 'a tab opened inside a customer view is that view');
  storage.set('grc_imp_token', token({ ...MAHMOUD, imp: { sessionId: 's-43', actorId: WASIF.id } }));
  tabB.otherTabWrote('grc_imp_token');
  eq(tabB.api.blocksRequest(), true,
    'and a DIFFERENT session for the same customer is a different identity — each one was '
    + 'approved separately, and acting under the wrong one misattributes the access');
}

// ─── 5. Tabs that are nobody yet ────────────────────────────────────────────
{
  for (const p of ['/login', '/control-plane', '/setup', '/forgot-password', '/reset-password', '/login/dms']) {
    const storage = new Map();
    signedInAs(storage, WASIF, 'Wasif Mehmood');
    const tab = openTab(storage, p);
    eq(tab.api.pinnedIdentity(), null, `a tab opened on ${p} is not anybody yet`);
    signedInAs(storage, MAHMOUD, 'Mahmoud Abdulaziz');
    tab.otherTabWrote('grc_jwt_token');
    eq(tab.last(), null, `so another tab signing in does not interrupt ${p}`);
  }

  const storage = new Map();
  signedInAs(storage, WASIF, 'Wasif Mehmood');
  const tab = openTab(storage, '/app');
  tab.api.clearPinnedIdentity();
  signedInAs(storage, MAHMOUD, 'Mahmoud Abdulaziz');
  tab.otherTabWrote('grc_jwt_token');
  eq(tab.last(), null, 'a tab that signed itself out is nobody, and is not interrupted either');
  eq(tab.api.blocksRequest(), false, 'nor blocked');
}

// ─── 6. What the module must survive ────────────────────────────────────────
{
  const storage = new Map();
  storage.set('grc_jwt_token', token({ ...WASIF, role: 'مدير المنصة' }));
  storage.set('grc_user_json', JSON.stringify({ id: WASIF.id, name: 'وصيف محمود' }));
  const tab = openTab(storage, '/app');
  eq(tab.api.pinnedIdentity().label, 'وصيف محمود', 'an Arabic name on the user record is shown as written');

  // The one claim a person ever reads out of the token is the email fallback,
  // so that is where decoding has to be right. atob alone yields each UTF-8
  // byte as its own Latin-1 character — valid JSON, wrong text — which is why
  // the check above, reading the name from the user record, could not catch it.
  const idn = new Map([['grc_jwt_token', token({ ...WASIF, email: 'وصيف@مثال.com' })]]);
  eq(openTab(idn, '/app').api.pinnedIdentity().label, 'وصيف@مثال.com',
    'a non-ASCII claim in the token decodes as UTF-8, not as byte-by-byte Latin-1');

  const bad = new Map([['grc_jwt_token', 'not-a-token'], ['grc_user_json', '{broken']]);
  const tab2 = openTab(bad, '/app');
  eq(tab2.api.pinnedIdentity(), null, 'a malformed token is "nobody", not a crash');
  eq(tab2.api.blocksRequest(), false, 'and blocks nothing');

  const noUser = new Map([['grc_jwt_token', token(WASIF)]]);
  eq(openTab(noUser, '/app').api.pinnedIdentity().label, 'wasif@example.com',
    'with no user record the label falls back to the account email');
}

// ─── 7. The wiring around it ────────────────────────────────────────────────
{
  const client = code(read(SRC, 'api', 'apiClient.ts'));
  const interceptor = client.slice(client.indexOf('interceptors.request.use'));
  const blockAt = interceptor.indexOf('if (blocksRequest())');
  const shortcutAt = interceptor.indexOf('if (config.headers.Authorization) return config;');
  ok(blockAt >= 0, 'the request interceptor asks before sending');
  ok(
    blockAt < shortcutAt,
    'THE PACKET: BEFORE the explicit-Authorization shortcut. asOperator() and the '
    + 'post-refresh retry carry their own header read from the same shared storage, and '
    + 'a check after that return would let exactly those through as somebody else',
  );

  const response = client.slice(client.indexOf('interceptors.response.use'));
  ok(
    response.indexOf('if (blocksRequest()) return Promise.reject(error);') >= 0
    && response.indexOf('if (blocksRequest()) return Promise.reject(error);')
       < response.indexOf('const renewed = await renewAccessToken();'),
    'a switched tab does not renew — the refresh token is shared, and renewing would mint '
    + 'a token for the OTHER person and replay this tab\'s request under it',
  );

  const app = code(read(SRC, 'App.tsx'));
  ok(
    app.indexOf('<SessionSwitchedGuard />') >= 0
    && app.indexOf('<SessionSwitchedGuard />') < app.indexOf('<Routes>'),
    'the notice is mounted above every route, so it appears wherever the tab happens to be',
  );

  for (const [file, rel] of [
    ['Login.tsx', ['pages', 'Login.tsx']],
    ['PlatformLogin.tsx', ['pages', 'PlatformLogin.tsx']],
    ['Setup.tsx', ['pages', 'Setup.tsx']],
  ]) {
    const src = code(read(SRC, ...rel));
    const at = src.indexOf('pinCurrentIdentity();');
    ok(
      at > src.indexOf("localStorage.setItem('grc_jwt_token'") && at >= 0,
      `${file}: a sign-in in this tab adopts the new person after storing the token — `
      + 'without it, a tab would stop itself the moment it signed in',
    );
  }
  for (const [file, rel] of [
    ['AppShell.tsx (sign out)', ['pages', 'AppShell.tsx']],
    ['ChangePassword.tsx', ['pages', 'ChangePassword.tsx']],
  ]) {
    ok(/clearPinnedIdentity\(\);/.test(code(read(SRC, ...rel))), `${file}: a deliberate sign-out forgets who this tab was`);
  }

  const guard = code(read(SRC, 'components', 'SessionSwitchedGuard.tsx'));
  ok(/role="alertdialog"/.test(guard) && /aria-modal="true"/.test(guard),
    'the notice blocks the page — a dismissible banner would leave the stale screen usable');
  ok(/private \(incognito\) window/.test(guard),
    'and says how to work as two people at once, which is the thing the reporter was doing');

  const deploy = read(WEB, '.github', 'workflows', 'deploy.yml');
  ok(/session-per-tab-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next packet can delete');
}

console.log(`session-per-tab: ${checks} assertions passed`);
