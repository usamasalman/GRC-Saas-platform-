/**
 * No document file is ever shown as a page that runs.
 *
 * The reader pane fetches /api/documents/:id/download?disposition=preview as a
 * blob, makes a blob: URL of it and puts that in an <iframe>. A blob URL made
 * by the page belongs to the page's own origin, so whatever the frame runs, it
 * runs as the application, with the reader's session token. The pane typed the
 * blob from the response's Content-Type and listed text/html and image/svg+xml
 * as displayable; the File tab framed the same blob with no check at all.
 *
 * New uploads can no longer be markup (checkEvidenceFile refuses .html, .svg
 * and the rest). Files uploaded before that still sit in uploads/ under
 * `/uploads/<ts>_<name>`, and downloadDocument let res.download type them by
 * extension — so an old .html or .svg arrived as text/html or image/svg+xml
 * and ran when opened. Stored XSS, against whoever opened it: an approver,
 * typically. Stored rows and files are not rewritten; the fix is in how they
 * are served and shown.
 *
 * Two layers, each checked here:
 *
 *   the server   never types a file by its extension. A file from uploads/ is
 *                typed from its bytes by the same sniffMime a new upload is,
 *                which names no markup type, so markup goes out as
 *                application/octet-stream — with nosniff and a sandbox CSP.
 *
 *   the client   frames only PDFs, raster images and plain text, gives the
 *                blob a type from its own table rather than the server's, and
 *                sandboxes every frame but the PDF one (the browser's PDF
 *                viewer does not load in a sandboxed frame).
 *
 * The frame-type decision is compiled from the component's source with the
 * project's own TypeScript and run, so a comparison that is simply wrong fails
 * here and not only a renamed constant.
 *
 *   node scripts/verify/document-preview-markup-test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const API = path.join(__dirname, '..', '..');
const WEB = path.join(API, '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

/** Types a frame shows without running anything. Nothing else may be framed. */
const INERT = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'text/plain',
]);
/** What runs, or can, when a browser renders it as a document. */
const ACTIVE = /html|svg|javascript|ecmascript|(^|[/+])xml\b/i;

const detailSource = read(WEB, 'src', 'pages', 'documents', 'DocumentDetail.tsx');
const detail = code(detailSource);

// ── The frame's table lists inert types only ────────────────────────────────
{
  for (const name of ['FRAME_TYPES', 'FRAME_TYPES_BY_EXT']) {
    const m = new RegExp(`const ${name}\\s*:[^=]*=\\s*\\{([\\s\\S]*?)\\};`).exec(detail);
    ok(m, `DocumentDetail must declare ${name} — the table the frame's blob is typed from`);
    const entries = [...m[1].matchAll(/['"]?([\w./+-]+)['"]?\s*:\s*'([^']+)'/g)];
    ok(entries.length > 0, `${name} has entries`);
    for (const [, key, type] of entries) {
      ok(INERT.has(type),
        `${name} gives ${key} the type ${type}. The frame shows a blob in the app's own origin; `
        + `only ${[...INERT].join(', ')} run nothing there.`);
      ok(!ACTIVE.test(key), `${name} lists ${key}, which is markup or script`);
    }
  }
  ok(!/RENDERABLE_(MIME|EXT)|browserCanRender/.test(detail),
    'the old renderability check, which listed text/html and SVG, must not come back');
}

// ── And the decision built on it, run ───────────────────────────────────────
{
  const ts = require(path.join(WEB, 'node_modules', 'typescript'));
  const start = detailSource.indexOf('const FRAME_TYPES:');
  const end = detailSource.indexOf('/** The format in the words');
  ok(start >= 0 && end > start,
    'the frame-type helpers sit together at the top of DocumentDetail.tsx, ahead of describeFormat');
  const compiled = ts.transpileModule(
    `${detailSource.slice(start, end)}\nmodule.exports = { frameType, frameSandbox };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(compiled, sandbox);
  const { frameType, frameSandbox } = sandbox.module.exports;

  // What an old file arrives as, under every name it might carry.
  const never = [
    ['text/html; charset=UTF-8', 'policy.html'],
    ['text/html', 'policy.pdf'],
    ['image/svg+xml', 'logo.svg'],
    ['image/svg+xml', 'logo.png'],
    ['application/xhtml+xml', 'page.xhtml'],
    ['application/xml', 'feed.xml'],
    ['text/xml', 'feed.xml'],
    ['application/javascript', 'x.js'],
    ['application/octet-stream', 'policy.html'],
    ['application/octet-stream', 'policy.HTM'],
    ['application/octet-stream', 'logo.svg'],
    ['application/octet-stream', 'page.xhtml'],
    ['application/octet-stream', 'noextension'],
    ['', 'policy.html'],
    [null, 'logo.svg'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'register.xlsx'],
  ];
  for (const [served, name] of never) {
    eq(frameType(served, name), null,
      `served as ${JSON.stringify(served)} and named ${name}, the file must not be framed`);
  }

  const shown = [
    ['application/pdf', 'report.pdf', 'application/pdf'],
    ['image/png', 'shot.png', 'image/png'],
    ['image/jpeg', 'photo.jpg', 'image/jpeg'],
    ['text/plain; charset=utf-8', 'DOC_v1.txt', 'text/plain; charset=utf-8'],
    ['text/csv', 'data.csv', 'text/plain'],
    // Bytes the server has no signature for: the table, keyed by extension.
    ['application/octet-stream', 'notes.txt', 'text/plain'],
    ['application/octet-stream', 'data.csv', 'text/plain'],
    ['application/octet-stream', 'scan.webp', 'image/webp'],
    ['application/octet-stream', 'scan.BMP', 'image/bmp'],
  ];
  for (const [served, name, want] of shown) {
    eq(frameType(served, name), want, `${name} served as ${served} is shown, as ${want}`);
  }

  eq(frameSandbox('application/pdf'), undefined,
    'the PDF frame is not sandboxed: the browser PDF viewer does not load in one');
  for (const type of ['image/png', 'text/plain', 'text/plain; charset=utf-8']) {
    eq(frameSandbox(type), '', `a ${type} frame is sandboxed with nothing allowed`);
  }
}

// ── The blob is never given the server's type ───────────────────────────────
{
  const start = detail.indexOf('const loadPdfBlob');
  ok(start >= 0, 'loadPdfBlob exists');
  const body = detail.slice(start, detail.indexOf('catch', start));
  const blobs = [...body.matchAll(/new Blob\(\s*\[[^\]]*\]\s*,\s*\{\s*type:\s*([^}]+)\}/g)];
  eq(blobs.length, 1, 'loadPdfBlob makes exactly one blob');
  const type = blobs[0][1].trim();
  ok(/^framed\s*\?\?\s*'application\/octet-stream'$/.test(type),
    `the preview blob must be typed from the frame table or as bare bytes, not \`${type}\`. `
    + 'A blob typed text/html or image/svg+xml is a page that runs in the app\'s origin.');
}

// ── Every frame is gated, and declares its sandbox ──────────────────────────
{
  const frames = [...detail.matchAll(/<iframe\b[\s\S]*?\/>/g)];
  ok(frames.length >= 1, 'the reader frame exists');
  for (const f of frames) {
    ok(/sandbox=\{frameSandbox\(frameAs\)\}/.test(f[0]),
      'every document frame takes its sandbox from frameSandbox(frameAs)');
    const before = detail.slice(Math.max(0, f.index - 1600), f.index);
    ok(/frameAs\s*\?/.test(before),
      'every document frame is rendered only when frameAs names a type the frame may show '
      + '(the File tab framed the blob with no check at all)');
  }

  // Anywhere else in the web app, too.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
      for (const f of code(fs.readFileSync(full, 'utf8')).matchAll(/<iframe\b[\s\S]*?>/g)) {
        if (!/\bsandbox=/.test(f[0])) offenders.push(path.relative(WEB, full));
      }
    }
  };
  walk(path.join(WEB, 'src'));
  checks += 1;
  assert.deepStrictEqual(
    offenders, [],
    `an <iframe> without a sandbox attribute in:\n${offenders.map((o) => `  ${o}`).join('\n')}\n`
    + 'A frame of a blob the page made runs in the page\'s origin. Declare what it may do.',
  );
}

// ── The server never types a file by its extension ──────────────────────────
{
  const ctrl = code(read(API, 'src', 'controllers', 'documentController.ts'));
  const start = ctrl.indexOf('export const downloadDocument');
  ok(start >= 0, 'downloadDocument exists');
  const handler = ctrl.slice(start, ctrl.indexOf('\nexport const', start + 1));
  const from = handler.indexOf('resolveDocumentFile(');
  const to = handler.indexOf('res.download(');
  ok(from >= 0 && to > from, 'downloadDocument resolves the file, then downloads it');
  const branch = handler.slice(from, to);

  ok(/res\.setHeader\(\s*'Content-Type'\s*,\s*servedTypeOf\(/.test(branch),
    'downloadDocument must set Content-Type from servedTypeOf before res.download. Left unset, '
    + 'res.download types the file by its extension, and an old .html goes out as text/html');
  ok(!/\bif\s*\([^)]*isStoredDocumentFile/.test(branch),
    'the type is set for every file, not only for stored ones — the old uploads/ files are the '
    + 'ones that can be markup');
  ok(/res\.setHeader\(\s*'X-Content-Type-Options'\s*,\s*'nosniff'\s*\)/.test(branch),
    'downloadDocument sends nosniff, so octet-stream is never sniffed into a page');
  ok(/res\.setHeader\(\s*'Content-Security-Policy'\s*,\s*"[^"]*\bsandbox\b[^"]*"\s*\)/.test(branch),
    'downloadDocument sends a sandbox CSP, so a file opened directly runs nothing');

  const files = code(read(API, 'src', 'services', 'documentFiles.ts'));
  const s = files.indexOf('export function servedTypeOf');
  ok(s >= 0, 'documentFiles exports servedTypeOf');
  const fn = files.slice(s, files.indexOf('\nexport ', s + 1));
  ok(/return\s+sniffMime\(/.test(fn),
    'a file from uploads/ is typed from its bytes by sniffMime, as a new upload is');
  ok(!/extname|mime-types|\.lookup\(|contentType\(/.test(fn),
    'servedTypeOf must not type a file by its extension');
}

// ── And the bytes can only ever be called something inert ───────────────────
{
  const ev = code(read(API, 'src', 'services', 'projectEvidence.ts'));
  const sig = /const SIGNATURES[\s\S]*?=\s*\[([\s\S]*?)\];/.exec(ev);
  const zip = /const ZIP_BY_EXTENSION[\s\S]*?=\s*\{([\s\S]*?)\};/.exec(ev);
  ok(sig && zip, 'projectEvidence declares SIGNATURES and ZIP_BY_EXTENSION');
  const named = [
    ...[...sig[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
    ...[...zip[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
  ];
  ok(named.length >= 6, 'sniffMime names the types it recognises');
  for (const type of named) {
    ok(!ACTIVE.test(type.replace(/openxmlformats/g, '')),
      `sniffMime can answer ${type}, which a browser would run. Every file the library serves `
      + 'is typed by it.');
  }
  const sniff = ev.slice(ev.indexOf('export function sniffMime'));
  ok(/return 'application\/octet-stream';\s*\}/.test(sniff),
    'anything sniffMime does not recognise — markup included — is application/octet-stream');
}

// ── CI runs this ────────────────────────────────────────────────────────────
{
  const deploy = read(WEB, '.github', 'workflows', 'deploy.yml');
  ok(/document-preview-markup-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next change can delete');
}

console.log(`document-preview-markup: ${checks} assertions passed`);
