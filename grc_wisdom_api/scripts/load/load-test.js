#!/usr/bin/env node
/**
 * Load test: many people using the platform at once, doing what they do.
 *
 * Each virtual user is signed in as a real seeded account and behaves like a
 * person: open a screen from their own menu (which fires the requests that
 * screen makes when it opens, together, the way the browser does), read it,
 * open another. Screens a role cannot open are left out during warm-up, so the
 * run measures work the server does rather than refusals.
 *
 * Two stages:
 *   1. sign-in burst — LOGIN_BURST people sign in at the same moment (password
 *      hashing is the most expensive thing the API does on purpose)
 *   2. steady use — USERS people for DURATION seconds
 *
 * Against a THROWAWAY server with the demo seed loaded, never production:
 *
 *   API=http://127.0.0.1:3100 node scripts/load/load-test.js
 *   API=... USERS=50 DURATION=120 THINK_MS=1500 node scripts/load/load-test.js
 *
 * Each virtual user sends its own X-Forwarded-For so the per-address limit
 * (300/min) applies per person, as it does for real people behind Caddy. That
 * only works when talking to the API directly; Caddy replaces the header, so
 * the trick cannot be used against a deployed site.
 *
 * OFFICES=n puts the people behind n shared addresses instead, the way a
 * customer's staff reach the internet through one office connection. The
 * limit is per address, so this shows how many people one office can have
 * working before they start being refused:
 *
 *   API=... USERS=40 OFFICES=1 THINK_MS=5000 node scripts/load/load-test.js
 *
 * Pass/fail thresholds (exit 1 when crossed):
 *   P95_MS (1000)  P99_MS (2500)  MAX_ERROR_RATE (0.01, server errors + dropped
 *   connections)  LOGIN_P95_MS (3000)
 * OUT=file.json writes the full result for comparison between runs.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API = (process.env.API || 'http://127.0.0.1:3100').replace(/\/+$/, '');
const USERS = Number(process.env.USERS || 25);
const DURATION = Number(process.env.DURATION || 60);
const THINK_MS = Number(process.env.THINK_MS || 1000);
const LOGIN_BURST = Number(process.env.LOGIN_BURST || 10);
const P95_MS = Number(process.env.P95_MS || 1000);
const P99_MS = Number(process.env.P99_MS || 2500);
const MAX_ERROR_RATE = Number(process.env.MAX_ERROR_RATE || 0.01);
const LOGIN_P95_MS = Number(process.env.LOGIN_P95_MS || 3000);
const OFFICES = Number(process.env.OFFICES || 0); // 0: every person has their own address

// A load test is a denial of service with a reason. Refuse anything that is
// not obviously a machine of ours.
const host = new URL(API).hostname;
const local = /^(localhost|127\.\d+\.\d+\.\d+|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host);
if (!local && !process.argv.includes('--not-local-and-i-own-it')) {
  console.error(`Refusing to load-test ${host}: not a local or private address.`);
  console.error('Point API at a throwaway server. If you really own this one and it is not production, pass --not-local-and-i-own-it.');
  process.exit(2);
}

// The seed's password and the menu model come from the QA library, so this
// file publishes neither.
process.env.API = API;
const { demoPassword, menuModel } = require('../verify/qa/lib');

/**
 * People from different portals, so the mix touches different screens and
 * tables. All seeded; see seed.ts.
 */
const ACCOUNTS = [
  'grc.manager@omniops.me',
  'risk.manager@omniops.me',
  'internal.audit@omniops.me',
  'eleanor.vance@globalbank.com',
  'sarah.jenkins@globalbank.com',
  'alex.rivera@globalbank.com',
  'billing@grcwisdom.com',
];

// ─── measurement ────────────────────────────────────────────────────────────

const samples = []; // { key, ms, status }
const q = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : 0);
const stats = (list) => {
  const ms = list.map((s) => s.ms).sort((a, b) => a - b);
  return { n: ms.length, p50: q(ms, 0.5), p95: q(ms, 0.95), p99: q(ms, 0.99), max: ms[ms.length - 1] || 0 };
};

let addressSeq = 0;
const nextAddress = () => { addressSeq += 1; return `10.77.${(addressSeq >> 8) & 255}.${addressSeq & 255}`; };

async function send(method, url, { token, body, address, key, record = true }) {
  const t0 = performance.now();
  let status = 0;
  let json = null;
  try {
    const r = await fetch(API + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': address,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    status = r.status;
    const text = await r.text();
    try { json = JSON.parse(text); } catch { /* not JSON */ }
  } catch { status = 0; }
  const ms = performance.now() - t0;
  if (record) samples.push({ key: key || `${method} ${url}`, ms, status });
  return { status, json, ms };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (0.5 + Math.random());

// ─── stage 0: sessions and the screens each person can open ────────────────

async function prepare() {
  const password = demoPassword();
  const menu = menuModel();
  const people = [];
  for (const email of ACCOUNTS) {
    const address = nextAddress();
    const r = await send('POST', '/api/auth/login', { body: { email, password }, address, record: false });
    if (r.status !== 200 || !r.json?.token) {
      console.warn(`  skipped ${email}: sign-in answered HTTP ${r.status}`);
      continue;
    }
    const { token, user } = r.json;
    // The screens on this person's menu, and what each fires on open. Kept
    // only when everything it fires answers 200 — a screen the role cannot
    // open measures the refusal path, which the QA suites already cover.
    const screens = [];
    for (const key of menu.visibleKeys(user.portal, user.capabilities || [])) {
      const calls = menu.endpointsFor(menu.screenFor(user.portal, key));
      if (!calls.length) continue;
      const answers = [];
      for (const url of calls) answers.push((await send('GET', url, { token, address, record: false })).status);
      if (answers.every((s) => s === 200)) screens.push({ key, calls });
    }
    if (screens.length) people.push({ email, token, portal: user.portal, screens });
    console.log(`  ${email.padEnd(32)} ${user.portal.padEnd(12)} ${screens.length} screens`);
  }
  if (!people.length) throw new Error('no account could sign in and open a screen; is the demo seed loaded?');
  return people;
}

// ─── stage 1: the sign-in burst ─────────────────────────────────────────────

async function loginBurst() {
  const password = demoPassword();
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: LOGIN_BURST }, (_, i) =>
    send('POST', '/api/auth/login', {
      body: { email: ACCOUNTS[i % ACCOUNTS.length], password },
      address: nextAddress(),
      key: 'POST /api/auth/login (burst)',
    })));
  return { wallMs: performance.now() - t0, ok: results.filter((r) => r.status === 200).length };
}

// ─── stage 2: steady use ────────────────────────────────────────────────────

async function virtualUser(person, until, address) {
  let screens = 0;
  await sleep(Math.random() * THINK_MS); // don't all start on the same tick
  while (Date.now() < until) {
    const screen = person.screens[Math.floor(Math.random() * person.screens.length)];
    await Promise.all(screen.calls.map((url) => send('GET', url, { token: person.token, address, key: `GET ${url}` })));
    screens += 1;
    await sleep(jitter(THINK_MS));
  }
  return screens;
}

async function main() {
  console.log(`Load test against ${API}`);
  console.log(`Preparing ${ACCOUNTS.length} seeded accounts and their screens...`);
  const people = await prepare();

  console.log(`\nStage 1: ${LOGIN_BURST} people sign in at once`);
  const burst = await loginBurst();
  const login = stats(samples.filter((s) => s.key === 'POST /api/auth/login (burst)'));
  console.log(`  ${burst.ok}/${LOGIN_BURST} signed in; p50 ${login.p50.toFixed(0)} ms, p95 ${login.p95.toFixed(0)} ms, all done in ${burst.wallMs.toFixed(0)} ms`);

  console.log(`\nStage 2: ${USERS} people for ${DURATION}s, ~${THINK_MS} ms between screens`
    + (OFFICES ? `, behind ${OFFICES} shared office address(es)` : ''));
  const offices = Array.from({ length: OFFICES }, nextAddress);
  const addressOf = (i) => (OFFICES ? offices[i % OFFICES] : nextAddress());
  const steadyFrom = samples.length;
  const t0 = Date.now();
  const until = t0 + DURATION * 1000;
  const ticker = setInterval(() => {
    const done = samples.length - steadyFrom;
    process.stdout.write(`\r  ${Math.round((Date.now() - t0) / 1000)}s  ${done} requests`);
  }, 2000);
  const screensOpened = await Promise.all(Array.from({ length: USERS }, (_, i) => virtualUser(people[i % people.length], until, addressOf(i))));
  clearInterval(ticker);
  const wall = (Date.now() - t0) / 1000;

  const steady = samples.slice(steadyFrom);
  const all = stats(steady);
  const serverErrors = steady.filter((s) => s.status >= 500).length;
  const dropped = steady.filter((s) => s.status === 0).length;
  const limited = steady.filter((s) => s.status === 429).length;
  const otherNon200 = steady.filter((s) => s.status && s.status !== 200 && s.status !== 429 && s.status < 500).length;
  const errorRate = steady.length ? (serverErrors + dropped) / steady.length : 1;

  const byKey = {};
  for (const s of steady) (byKey[s.key] ||= []).push(s);
  const slowest = Object.entries(byKey)
    .map(([key, list]) => ({ key, ...stats(list) }))
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, 10);

  console.log(`\r  ${wall.toFixed(0)}s done${' '.repeat(20)}`);
  console.log(`\n  requests        ${steady.length} (${(steady.length / wall).toFixed(1)}/s), ${screensOpened.reduce((a, b) => a + b, 0)} screens opened`);
  console.log(`  latency         p50 ${all.p50.toFixed(0)} ms   p95 ${all.p95.toFixed(0)} ms   p99 ${all.p99.toFixed(0)} ms   max ${all.max.toFixed(0)} ms`);
  console.log(`  server errors   ${serverErrors}   dropped ${dropped}   rate-limited ${limited}   other non-200 ${otherNon200}`);
  console.log('\n  Slowest endpoints by p95:');
  for (const s of slowest) console.log(`    ${s.p95.toFixed(0).padStart(6)} ms  p50 ${s.p50.toFixed(0).padStart(5)}  n=${String(s.n).padStart(4)}  ${s.key}`);

  const breaches = [];
  if (all.p95 > P95_MS) breaches.push(`p95 ${all.p95.toFixed(0)} ms > ${P95_MS} ms`);
  if (all.p99 > P99_MS) breaches.push(`p99 ${all.p99.toFixed(0)} ms > ${P99_MS} ms`);
  if (errorRate > MAX_ERROR_RATE) breaches.push(`error rate ${(errorRate * 100).toFixed(2)}% > ${(MAX_ERROR_RATE * 100).toFixed(2)}%`);
  if (login.p95 > LOGIN_P95_MS) breaches.push(`sign-in p95 ${login.p95.toFixed(0)} ms > ${LOGIN_P95_MS} ms`);
  if (burst.ok < LOGIN_BURST) breaches.push(`${LOGIN_BURST - burst.ok} of ${LOGIN_BURST} burst sign-ins failed`);
  // Each virtual user stays far below the per-address limit, so a 429 here
  // means the limiter is keying on something other than the caller.
  if (limited) {
    breaches.push(OFFICES
      ? `${limited} requests (${((limited / steady.length) * 100).toFixed(1)}%) refused by the per-address limit: ${Math.round(USERS / OFFICES)} people per office address is too many at this pace`
      : `${limited} requests rate-limited although every virtual user is under the limit`);
  }

  if (process.env.OUT) {
    fs.writeFileSync(path.resolve(process.env.OUT), JSON.stringify({
      api: API, at: new Date().toISOString(),
      settings: { USERS, DURATION, THINK_MS, LOGIN_BURST },
      thresholds: { P95_MS, P99_MS, MAX_ERROR_RATE, LOGIN_P95_MS },
      login, burst, steady: { ...all, requests: steady.length, perSecond: steady.length / wall, serverErrors, dropped, limited, otherNon200, errorRate },
      slowest, breaches,
    }, null, 2));
  }

  console.log(breaches.length ? `\nFAIL\n  ${breaches.join('\n  ')}` : '\nPASS: every threshold held.');
  // exitCode, not exit(): exiting while fetch's sockets close crashes Node on Windows.
  process.exitCode = breaches.length ? 1 : 0;
}

main().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
