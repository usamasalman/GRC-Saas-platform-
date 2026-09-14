/**
 * The uploads directory is never served statically.
 *
 * It was, once: mounted at `/uploads` with `Access-Control-Allow-Origin: *` and
 * `X-Frame-Options: ALLOWALL`, ahead of every authentication check. That
 * published every tenant's document library -- policies, pen test reports,
 * board minutes, HR records -- to anyone who could guess a URL. Guessing was
 * cheap, because uploaded files are named `${Date.now()}_${originalName}`, and
 * unthrottled, because the rate limiter is scoped to `/api`.
 *
 * Two comments already in this codebase describe that mount as the hazard they
 * were written to work around -- services/evidenceStore and
 * brandingController.uploadLogo both keep their files out of uploads/ for
 * exactly this reason. The mount outlived both warnings, which is why this is a
 * test rather than a third comment.
 *
 * Files are reachable only through documentController.downloadDocument, which
 * resolves the row and checks tenant scope first.
 *
 *   node scripts/verify/uploads-not-public-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

// ── No static mount anywhere in the app ─────────────────────────────────────
{
  const app = read('app.ts');
  const code = app
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  ok(
    !/express\.static/.test(code),
    'app.ts must not call express.static. Serving a directory bypasses every '
    + 'authentication and tenant-scope check in the product.',
  );
  ok(
    !/app\.use\(\s*['"]\/uploads['"]/.test(code),
    'nothing may be mounted at /uploads',
  );
}

// ── And not reintroduced elsewhere ──────────────────────────────────────────
{
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.ts$/.test(entry.name)) continue;
      const code = fs.readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      if (/express\.static/.test(code)) offenders.push(path.relative(SRC, full));
    }
  };
  walk(SRC);
  checks += 1;
  assert.deepStrictEqual(
    offenders, [],
    `express.static appears in:\n${offenders.map((o) => `  ${o}`).join('\n')}\n`
    + 'Serve files through a handler that resolves the record and checks access.',
  );
}

// ── The authenticated path still exists ─────────────────────────────────────
// Removing the mount is only safe because this is how files are actually served.
{
  const routes = read('routes/documentRoutes.ts');
  ok(
    /router\.get\('\/:id\/download'/.test(routes),
    'the authenticated download route must exist — it is the only way to a file now',
  );

  const ctrl = read('controllers/documentController.ts');
  const start = ctrl.indexOf('export const downloadDocument');
  ok(start >= 0, 'downloadDocument exists');
  const body = ctrl.slice(start, start + 2500);
  ok(
    /scope|tenantId/.test(body),
    'downloadDocument must check tenant scope before streaming a file',
  );
}

console.log(`uploads-not-public: ${checks} assertions passed`);
