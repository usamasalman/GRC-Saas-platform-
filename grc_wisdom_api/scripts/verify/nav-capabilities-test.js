/**
 * The sidebar's capability strings match the server's.
 *
 * src/pages/navCapabilities.ts decides which menu entries a role is shown. It
 * holds its own copy of the capability names because the frontend does not
 * import from the API package, and a copy is a thing that drifts. These are
 * plain strings on both sides, so a typo typechecks perfectly and then hides a
 * menu entry from everybody, including the people who hold the grant -- the
 * failure is silent and looks like a permissions problem in the data.
 *
 * The same mistake in the delete guards -- refusing on a status that did not
 * exist -- is what prompted writing this one up front rather than after.
 *
 * Also checks the nav keys are real, since a key that matches no menu entry is
 * a rule that silently governs nothing.
 *
 *   node scripts/verify/nav-capabilities-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API_SRC = path.join(__dirname, '..', '..', 'src');
const WEB_SRC = path.join(__dirname, '..', '..', '..', 'src');

/** Pull `NAME: 'value',` pairs out of an `export const CAP = { ... } as const;` */
function capsFrom(file) {
  const src = fs.readFileSync(file, 'utf8');
  const block = src.match(/export const CAP = \{([\s\S]*?)\} as const;/);
  assert.ok(block, `no CAP block in ${file}`);
  const out = {};
  for (const m of block[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)) out[m[1]] = m[2];
  return out;
}

const serverCaps = capsFrom(path.join(API_SRC, 'services', 'capabilityEngine.ts'));
const navFile = path.join(WEB_SRC, 'pages', 'navCapabilities.ts');
const webCaps = capsFrom(navFile);

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

ok(Object.keys(serverCaps).length >= 25, `expected the server capability list; found ${Object.keys(serverCaps).length}`);

// ── Every value the sidebar uses is a capability the server grants ───────────
for (const [name, value] of Object.entries(webCaps)) {
  checks += 1;
  assert.strictEqual(
    serverCaps[name], value,
    `navCapabilities CAP.${name} is '${value}', but capabilityEngine has `
    + `'${serverCaps[name] ?? "no such capability"}'. A menu entry gated on a string the `
    + 'server never grants is hidden from everyone, including the roles that hold it.',
  );
}

// ── And the reverse: a capability the server added should not be silently
//    absent from the copy, or new admin screens get gated on nothing.
const missing = Object.keys(serverCaps).filter((k) => !(k in webCaps));
checks += 1;
assert.deepStrictEqual(
  missing, [],
  `These capabilities exist on the server but not in navCapabilities.ts:\n${
    missing.map((m) => `  ${m}`).join('\n')}`,
);

// ── Every gated nav key is a key the menu actually renders ──────────────────
const shell = fs.readFileSync(path.join(WEB_SRC, 'pages', 'AppShell.tsx'), 'utf8');
const navBlock = shell.match(/const NAV: Record<string, any\[\]> = \{([\s\S]*?)\n\};/);
assert.ok(navBlock, 'NAV map not found in AppShell');
const navKeys = new Set([...navBlock[1].matchAll(/\['([a-z0-9-]+)',\s*'/g)].map((m) => m[1]));
ok(navKeys.size > 30, `expected the nav keys; found ${navKeys.size}`);

const navSrc = fs.readFileSync(navFile, 'utf8');
const mapBlock = navSrc.match(/export const NAV_CAPABILITY[\s\S]*?= \{([\s\S]*?)\n\};/);
assert.ok(mapBlock, 'NAV_CAPABILITY map not found');
const gatedKeys = [...mapBlock[1].matchAll(/^\s*'?([a-z0-9-]+)'?:\s*\[/gm)].map((m) => m[1]);
ok(gatedKeys.length > 20, `expected gated keys; found ${gatedKeys.length}`);

const unknown = gatedKeys.filter((k) => !navKeys.has(k));
checks += 1;
assert.deepStrictEqual(
  unknown, [],
  `These keys are gated in NAV_CAPABILITY but appear in no portal's menu:\n${
    unknown.map((u) => `  ${u}`).join('\n')}\nA rule on a key nothing renders governs nothing.`,
);

// ── The dashboard must never be gated ───────────────────────────────────────
// Every portal opens on it, and a filtered-out landing page is a blank shell.
checks += 1;
assert.ok(
  !gatedKeys.includes('dashboard'),
  'dashboard must stay ungated — every portal lands there, and hiding it leaves an empty screen',
);

console.log(
  `nav-capabilities: ${checks} assertions passed `
  + `(${Object.keys(webCaps).length} capabilities, ${gatedKeys.length} gated nav keys)`,
);
