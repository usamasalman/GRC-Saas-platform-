/**
 * The limits that decide how many people and how much data the platform can
 * take, read from the source.
 *
 * Measured first, pinned here second (docs/qa/monitoring-and-load.md):
 *
 *  - The request limit is keyed on the network address. A customer's staff
 *    share one office address, so 40 people working from one office had 29%
 *    of their requests refused on an idle server (QA-019).
 *  - Failed sign-ins are counted per address too: ten mistyped passwords
 *    anywhere in an office lock the whole office out for 15 minutes (QA-020).
 *  - Lists stop at a fixed number of rows and no list can page past it, so
 *    records beyond the cap vanish from the screen without a word — the risk
 *    register shows 500 and drops the rest (QA-021).
 *  - Verifying the audit trail loads every row of every organisation into
 *    memory: +225 MB for 200,000 rows, in one click (QA-022).
 *  - The background jobs start in every API process, so a second process —
 *    the first step to more capacity — would run every escalation twice
 *    (QA-023).
 *
 *   node scripts/verify/qa-capacity-test.js
 */
const fs = require('fs');
const path = require('path');
const q = require('./qa/lib');

const v = q.verdicts('qa-capacity');
const app = q.strip(q.read(path.join(q.API_SRC, 'app.ts')));

/** The options object of `const <name> = rateLimit({ ... })`. */
function limiter(name) {
  const at = app.indexOf(`const ${name} = rateLimit(`);
  if (at < 0) return null;
  const end = app.indexOf('});', at);
  return app.slice(at, end);
}

// ─── QA-019, QA-020: what the limits are counted against ───────────────────
{
  const api = limiter('apiLimiter');
  v.record('capacity:the request limit is counted per person, not per office address',
    Boolean(api) && /keyGenerator\s*:/.test(api),
    'apiLimiter has no keyGenerator, so it counts per network address and an office shares one budget of 300 a minute');

  const auth = limiter('authLimiter');
  v.record('capacity:failed sign-ins lock an account, not an office',
    Boolean(auth) && /keyGenerator\s*:/.test(auth) && /email/i.test(auth),
    'authLimiter counts failures per network address, so ten typos in one office lock everybody there out');
}

// ─── QA-021: no list silently drops records ────────────────────────────────
{
  const dir = path.join(q.API_SRC, 'controllers');
  const capped = [];
  for (const f of fs.readdirSync(dir)) {
    const src = q.strip(q.read(path.join(dir, f)));
    const starts = [...src.matchAll(/export\s+const\s+(\w+)\s*=\s*async/g)].map((m) => ({ name: m[1], at: m.index }));
    starts.forEach((s, i) => {
      const body = src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length);
      // A cap large enough to be a list, not a lookup of "the latest one".
      const caps = [...body.matchAll(/findMany\(\{[\s\S]*?take:\s*(\d+)/g)].map((m) => Number(m[1])).filter((n) => n >= 50);
      if (caps.length && !/\bskip\s*:|\bcursor\s*:/.test(body)) capped.push(`${f.replace(/\.ts$/, '')}.${s.name} (${Math.max(...caps)})`);
    });
  }
  v.record('capacity:lists that cap their rows can page past the cap', capped.length === 0,
    `${capped.length} list(s) stop at a fixed number of rows and cannot page: ${capped.slice(0, 6).join(', ')}${capped.length > 6 ? ', …' : ''}`);
}

// ─── QA-022: verifying the audit trail reads in batches ────────────────────
{
  const src = q.strip(q.read(path.join(q.API_SRC, 'controllers', 'dbAdminController.ts')));
  const at = src.indexOf('export const verifyAuditTrail');
  const body = at < 0 ? '' : src.slice(at, src.indexOf('\nexport ', at + 1) > 0 ? src.indexOf('\nexport ', at + 1) : src.length);
  const reads = [...body.matchAll(/auditLog\.findMany\(\{([\s\S]*?)\}\s*\)/g)].map((m) => m[1]);
  v.record('capacity:verifying the audit trail reads in batches',
    reads.length > 0 && reads.every((r) => /\btake\s*:/.test(r) && /\bcursor\s*:|\bskip\s*:|\bgt\s*:/.test(r)),
    'verifyAuditTrail loads every audit row of an organisation at once; memory grows with the whole history');
}

// ─── QA-023: background jobs run in one process only ───────────────────────
{
  const server = q.strip(q.read(path.join(q.API_SRC, 'server.ts')));
  const starts = [...server.matchAll(/start(EscalationScanner|RiskReviewScanner)\(/g)];
  // Started behind a condition a deployment controls (an environment flag),
  // so a second process can be run without a second copy of every job.
  const gated = starts.every((m) => /if\s*\([^)]*process\.env\.\w+[^)]*\)\s*\{?[^}]*$/.test(server.slice(Math.max(0, m.index - 300), m.index)));
  v.record('capacity:background jobs can be confined to one process', starts.length > 0 && gated,
    'the escalation and risk-review scanners start unconditionally in every API process, so two processes run every job twice');
}

v.finish();
