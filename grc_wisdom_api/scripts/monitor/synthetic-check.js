#!/usr/bin/env node
/**
 * Synthetic check: is the live site up, and is it the site we shipped?
 *
 * Run it on a schedule from a machine OTHER than the server (a server cannot
 * report that it has fallen off the internet). One file, Node 18+ built-ins
 * only, nothing to install:
 *
 *   SITE=https://app.example.com node synthetic-check.js
 *
 * Optional, to prove sign-in works end to end — use a dedicated account with
 * the least privileged role you have and no MFA, never a real person's:
 *
 *   MONITOR_EMAIL=monitor@example.com MONITOR_PASSWORD=... node synthetic-check.js
 *
 * Exit codes, for cron or any scheduler:
 *   0  healthy (warnings, if any, are printed)
 *   1  something a user would notice is broken — alert someone
 *   2  the check itself was misconfigured
 * MONITOR_STRICT=1 turns warnings into failures.
 *
 * It reads; it never writes. The one POST is the optional sign-in.
 */
'use strict';

const tls = require('node:tls');

const SITE = (process.env.SITE || '').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.MONITOR_TIMEOUT_MS || 10_000);
const SLOW_MS = Number(process.env.MONITOR_SLOW_MS || 2_000);
const STRICT = process.env.MONITOR_STRICT === '1';
const JSON_OUT = process.env.MONITOR_JSON === '1';

if (!/^https?:\/\/[^/]+$/.test(SITE)) {
  console.error('SITE must be the site origin, e.g. SITE=https://app.example.com');
  process.exit(2);
}
const url = new URL(SITE);
const LOCAL = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);

const results = [];
const pass = (name, detail = '') => results.push({ name, level: 'ok', detail });
const warn = (name, detail) => results.push({ name, level: 'warn', detail });
const fail = (name, detail) => results.push({ name, level: 'fail', detail });

async function probe(path, init = {}) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(SITE + path, { redirect: 'manual', signal: ctrl.signal, ...init });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, headers: r.headers, text, json, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, headers: new Headers(), text: '', json: null, ms: Date.now() - t0, error: e.name === 'AbortError' ? `no answer in ${TIMEOUT_MS} ms` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

const timing = (name, r) => {
  if (r.status && r.ms > SLOW_MS) warn(`${name} is slow`, `${r.ms} ms (limit ${SLOW_MS} ms)`);
};

/** Days until the certificate the site presents expires. */
function certificateDaysLeft() {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port) || 443, servername: url.hostname, timeout: TIMEOUT_MS }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? Math.floor((new Date(cert.valid_to) - Date.now()) / 86_400_000) : null);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

async function main() {
  // 1. The API process answers.
  const health = await probe('/health');
  if (health.status === 200 && health.json?.status === 'success') pass('API answers /health', `${health.ms} ms`);
  else fail('API answers /health', health.error || `HTTP ${health.status}`);
  timing('/health', health);

  // 2. The API can reach its database. bootstrap-status counts users; it
  //    answers 503 when the database is unreachable.
  const boot = await probe('/api/auth/bootstrap-status');
  if (boot.status === 200 && boot.json?.initialised === true) pass('API reaches its database', `${boot.ms} ms`);
  else if (boot.status === 200 && boot.json?.initialised === false) {
    // An empty user table on a live site means the first-admin form is open
    // to anyone who finds it. Nothing about this is a warning.
    fail('database has users', 'the user table is EMPTY: /register-admin is open to anyone until someone claims it');
  } else fail('API reaches its database', boot.error || `HTTP ${boot.status}`);
  timing('/api/auth/bootstrap-status', boot);

  // 3. The app itself: the page, and the script it points at. A deploy that
  //    ships index.html without its hashed bundle is a white page with a 200.
  const home = await probe('/');
  const bundle = home.text.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  if (home.status !== 200) fail('app page loads', home.error || `HTTP ${home.status}`);
  else if (!/<div id="root">/.test(home.text) || !bundle) fail('app page loads', 'HTTP 200, but it is not the app (no root element or script)');
  else {
    const js = await probe(bundle.startsWith('/') ? bundle : `/${bundle}`);
    if (js.status === 200 && js.text.length > 1000) pass('app page and its script load', `${home.ms} + ${js.ms} ms`);
    else fail('app script loads', `${bundle}: ${js.error || `HTTP ${js.status}, ${js.text.length} bytes`}`);
  }
  timing('/', home);

  // 4. A deep link is served the app, not a 404 — people bookmark /login.
  const login = await probe('/login');
  if (login.status === 200 && /<div id="root">/.test(login.text)) pass('sign-in address serves the app');
  else fail('sign-in address serves the app', login.error || `HTTP ${login.status}`);

  // 5. Transport. Passwords are typed into this site.
  if (url.protocol === 'https:') {
    const days = await certificateDaysLeft();
    if (days === null) fail('TLS certificate', 'could not read the certificate');
    else if (days < 3) fail('TLS certificate', `expires in ${days} day(s)`);
    else if (days < 14) warn('TLS certificate', `expires in ${days} days; Caddy renews at 30, so renewal is failing`);
    else pass('TLS certificate', `${days} days left`);

    const plain = await fetch(`http://${url.host}/login`, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
    if (plain && plain.status >= 300 && plain.status < 400 && /^https:/.test(plain.headers.get('location') || '')) pass('plain HTTP redirects to HTTPS');
    else if (plain) warn('plain HTTP redirects to HTTPS', `http:// answered ${plain.status} without redirecting`);
  } else if (!LOCAL) {
    fail('HTTPS', 'the site is served over plain HTTP: passwords and session tokens cross the network readable. Set SITE_ADDRESS to a domain name so Caddy issues a certificate');
  }

  // 6. Headers the app relies on being there — judged only on a page that
  //    loaded; a site that is down has already failed above.
  if (home.status === 200) checkHeaders(home);

  // 7. Optional: a real sign-in, then a signed-in read.
  await checkSignIn();

  report();
}

function checkHeaders(home) {
  const want = [
    ['x-content-type-options', /nosniff/i, 'fail'],
    ['referrer-policy', /./, 'warn'],
  ];
  if (url.protocol === 'https:') want.push(['strict-transport-security', /max-age=\d+/, 'warn']);
  for (const [h, re, level] of want) {
    const v = home.headers.get(h);
    if (v && re.test(v)) pass(`header ${h}`);
    else (level === 'fail' ? fail : warn)(`header ${h}`, v ? `unexpected value "${v}"` : 'missing');
  }
  const framing = home.headers.get('x-frame-options') || (home.headers.get('content-security-policy') || '').match(/frame-ancestors[^;]*/)?.[0];
  if (framing) pass('page refuses to be framed by other sites', framing);
  else warn('page refuses to be framed by other sites', 'no X-Frame-Options or frame-ancestors on the app page (QA-009)');
  if (home.headers.get('server')) warn('server banner hidden', `Server: ${home.headers.get('server')}`);
}

async function checkSignIn() {
  const email = process.env.MONITOR_EMAIL;
  const password = process.env.MONITOR_PASSWORD;
  if (email && password) {
    const r = await probe('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (r.status === 200 && r.json?.status === 'mfa_required') {
      warn('sign-in', 'the monitor account has MFA on, so only the password step was checked');
    } else if (r.status === 200 && r.json?.token) {
      const me = await probe('/api/auth/me', { headers: { Authorization: `Bearer ${r.json.token}` } });
      if (me.status === 200) pass('sign-in and a signed-in read', `${r.ms} + ${me.ms} ms`);
      else fail('signed-in read', `/api/auth/me answered HTTP ${me.status}`);
      await probe('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${r.json.token}` } });
    } else {
      // Failed attempts count against the sign-in limit (10 per 15 minutes), so
      // a wrong monitor password on a 5-minute schedule locks itself out — say
      // which it is rather than just "failed".
      fail('sign-in', r.status === 429 ? 'rate-limited: check MONITOR_PASSWORD, failed attempts are counted'
        : r.error || `HTTP ${r.status} ${r.json?.message || ''}`.trim());
    }
    timing('sign-in', r);
  }
}

function report() {
  const failures = results.filter((x) => x.level === 'fail');
  const warnings = results.filter((x) => x.level === 'warn');
  if (JSON_OUT) {
    console.log(JSON.stringify({ site: SITE, at: new Date().toISOString(), ok: failures.length === 0, results }));
  } else {
    const mark = { ok: 'PASS', warn: 'WARN', fail: 'FAIL' };
    console.log(`${new Date().toISOString()} ${SITE}`);
    for (const x of results) console.log(`  ${mark[x.level]}  ${x.name}${x.detail ? ` — ${x.detail}` : ''}`);
    console.log(`  ${failures.length} failed, ${warnings.length} warning(s), ${results.length - failures.length - warnings.length} passed`);
  }
  // exitCode, not exit(): exiting while fetch's sockets are still closing
  // crashes Node on Windows, and a crash is not the exit code cron was promised.
  process.exitCode = failures.length || (STRICT && warnings.length) ? 1 : 0;
}

main().catch((e) => {
  console.error(`synthetic check crashed: ${e.stack || e}`);
  process.exitCode = 1;
});
