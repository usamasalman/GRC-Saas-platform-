/**
 * No screen invents data.
 *
 * Fifteen screens carried hardcoded datasets used as initial state and as a
 * fallback whenever the API returned nothing or failed. The effect was not
 * cosmetic:
 *
 *   - A branch user at one organisation was shown invoices, payments, quotas
 *     and import jobs belonging to "Al-Rajhi Holding Group".
 *   - The platform overview reported ARR of "SAR 6.42M" and churn of "1.2%",
 *     both string literals, beside figures that were real.
 *   - System health reported nine services Healthy at 99.95-100% uptime
 *     precisely when the API could not be reached.
 *   - Platform security returned a grade of A+ on failure, and the WORM chain
 *     verifier reported `isChainValid: true, tamperingDetected: false` when the
 *     verification request itself had failed.
 *
 * A compliance product that fabricates evidence of its own compliance is worse
 * than one that shows nothing. An empty list is an answer; an invented one is a
 * lie the reader cannot detect.
 *
 *   node scripts/verify/no-invented-data-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PAGES = path.join(__dirname, '..', '..', '..', 'src', 'pages');

/** Comments and string literals are prose. Only live code counts. */
function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
})(PAGES);

let checks = 0;
const rel = (f) => path.relative(PAGES, f).replace(/\\/g, '/');

// ── No module-level seed datasets ───────────────────────────────────────────
// The shape was always the same: `const DEFAULT_X = [ ... ]` at module scope,
// passed to useState and restored in a catch block.
{
  const offenders = [];
  for (const f of files) {
    const code = stripCommentsAndStrings(fs.readFileSync(f, 'utf8'));
    if (/^const DEFAULT_[A-Z_]+\s*(?::[^=]+)?=\s*[[{]/m.test(code)) offenders.push(rel(f));
  }
  checks += 1;
  assert.deepStrictEqual(
    offenders, [],
    `Module-level DEFAULT_ datasets in:\n${offenders.map((o) => `  ${o}`).join('\n')}\n`
    + 'Start from an empty list and show an empty state. Never substitute rows the server did not return.',
  );
}

// ── No customer names as literals ───────────────────────────────────────────
// These are the organisations the fabricated rows were attributed to. A real
// tenant name belongs in the database, never in the bundle.
{
  const NAMES = ['Al-Rajhi', 'Al Noor', 'Hayat National', 'Hayat Madinah', 'Eteqan', 'NourNet', 'Saudi Real Estate'];
  const offenders = [];
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    // Strip only comments; a name inside a string literal is exactly the problem.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const hit = NAMES.find((n) => code.includes(n));
    if (hit) offenders.push(`${rel(f)} — ${hit}`);
  }
  checks += 1;
  assert.deepStrictEqual(
    offenders, [],
    `Customer organisation names hardcoded in:\n${offenders.map((o) => `  ${o}`).join('\n')}`,
  );
}

// ── No invented commercial figures ──────────────────────────────────────────
{
  const FIGURES = [/SAR\s*6\.42M/, /\b1\.2%/, /99\.98/, /\b6\.42\b/];
  const offenders = [];
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    if (FIGURES.some((re) => re.test(code))) offenders.push(rel(f));
  }
  checks += 1;
  assert.deepStrictEqual(
    offenders, [],
    `Invented commercial or uptime figures in:\n${offenders.map((o) => `  ${o}`).join('\n')}\n`
    + 'The platform computes no ARR or churn. Render an em dash rather than a number it cannot derive.',
  );
}

// ── The WORM verifier must never assert a chain it did not check ────────────
// The single most damaging fabrication found: on a failed verification request
// the catch block returned isChainValid true with tamperingDetected false.
{
  const f = path.join(PAGES, 'system', 'PlatformSecurity.tsx');
  const code = stripCommentsAndStrings(fs.readFileSync(f, 'utf8'));
  const start = code.indexOf('handleVerifyWorm');
  checks += 1;
  assert.ok(start >= 0, 'handleVerifyWorm exists in PlatformSecurity.tsx');

  const body = code.slice(start, start + 2000);
  const cat = body.indexOf('catch');
  checks += 1;
  assert.ok(cat >= 0, 'handleVerifyWorm handles failure');

  const onFailure = body.slice(cat, cat + 700);
  checks += 1;
  assert.ok(
    !/isChainValid\s*:\s*true/.test(onFailure) && !/tamperingDetected\s*:\s*false/.test(onFailure),
    'On a failed verification, handleVerifyWorm must not claim the chain is valid or untampered. '
    + 'An unverified audit chain is unverified — say so.',
  );
}

console.log(`no-invented-data: ${checks} assertions passed, ${files.length} page files scanned`);
