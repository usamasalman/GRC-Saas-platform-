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
// Deliberately few. The gate covers administration — of tenants, users, roles
// and flags, and of the commercial relationship — not the operational
// registers, whose data every signed-in user in scope can already read through
// an unguarded GET. The first attempt gated 34 entries and hid half the product
// from the people who run it; the ceiling is here so that cannot creep back.
ok(gatedKeys.length >= 5 && gatedKeys.length <= 20,
  `expected a short gate list; found ${gatedKeys.length}`);

const unknown = gatedKeys.filter((k) => !navKeys.has(k));
checks += 1;
assert.deepStrictEqual(
  unknown, [],
  `These keys are gated in NAV_CAPABILITY but appear in no portal's menu:\n${
    unknown.map((u) => `  ${u}`).join('\n')}\nA rule on a key nothing renders governs nothing.`,
);

// ── A gated entry must survive for someone in the portal that renders it ───
// Gating a menu entry on a capability no role in that portal holds deletes the
// entry for everybody, which looks like the feature was removed. That is not
// hypothetical: the franchise menu offers a full billing group and no franchise
// role holds a single billing capability.
{
  const rbac = JSON.parse(fs.readFileSync(path.join(API_SRC, 'utils', 'rbacData.json'), 'utf8'));
  const allRoles = Array.isArray(rbac) ? rbac : rbac.roles;

  // The capabilities each gated key accepts, read from NAV_CAPABILITY itself so
  // this cannot drift from what the app does.
  const required = {};
  for (const m of mapBlock[1].matchAll(/^\s*'?([a-z0-9-]+)'?:\s*\[([^\]]*)\]/gm)) {
    required[m[1]] = [...m[2].matchAll(/CAP\.(\w+)/g)].map((c) => webCaps[c[1]]);
  }

  // Which menus render which keys, and which roles sit in each menu.
  const menus = {};
  for (const m of navBlock[1].matchAll(/^  ([a-z]+):\s*\[([\s\S]*?)\n  \]/gm)) {
    menus[m[1]] = [...m[2].matchAll(/\['([a-z0-9-]+)',\s*'/g)].map((k) => k[1]);
  }
  const rolesOfMenu = {};
  for (const r of allRoles) {
    const menu = String(r.portal || '').trim().toLowerCase();
    if (menus[menu]) (rolesOfMenu[menu] = rolesOfMenu[menu] || []).push(r);
  }

  /**
   * Entries no role in that portal can reach, left in place on purpose.
   *
   * Each is a hole in the role matrix, not in the gate: the menu offers work
   * that no role in the portal is authorised to do. Closing one means adding
   * the finance role the portal is missing, or removing the group from the
   * menu. Listed so the number cannot grow unnoticed.
   */
  const NO_ROLE_HOLDS = {
    'franchise/subscriptions': 'no franchise finance role exists in the matrix',
    'franchise/plans': 'no franchise finance role exists in the matrix',
    'franchise/invoices': 'no franchise finance role exists in the matrix',
    'franchise/payments': 'no franchise finance role exists in the matrix',
    'franchise/payment-gateway': 'no franchise finance role exists in the matrix',
    'partner/payments': 'no partner role reconciles payments — partner-owner manages subscriptions only',
    // Pre-existing, found by this check rather than introduced by it: the
    // franchise menu offers Roles & Permissions and neither franchisor-admin,
    // franchisee-admin nor franchise-support-manager holds
    // maintain-roles-and-permissions.
    'franchise/role-matrix': 'no franchise role maintains roles — franchisor-admin holds tenant, user and flag duties only',
  };

  const stranded = [];
  for (const [menu, keys] of Object.entries(menus)) {
    for (const key of keys) {
      const caps = required[key];
      if (!caps || caps.length === 0) continue;
      const holders = (rolesOfMenu[menu] || []).filter(
        (r) => caps.some((c) => (r.capabilities || []).includes(c)),
      );
      if (holders.length === 0) stranded.push(`${menu}/${key}`);
    }
  }

  const unexpected = stranded.filter((s2) => !(s2 in NO_ROLE_HOLDS));
  checks += 1;
  assert.deepStrictEqual(
    unexpected, [],
    'These menu entries are gated on a capability no role in that portal holds, so they '
    + `vanish for everyone:\n${unexpected.map((u) => `  ${u}`).join('\n')}\n`
    + 'Grant the capability to a role in that portal, remove the entry from the menu, or '
    + 'add it to NO_ROLE_HOLDS with the reason.',
  );

  const closed = Object.keys(NO_ROLE_HOLDS).filter((k) => !stranded.includes(k));
  checks += 1;
  assert.deepStrictEqual(
    closed, [],
    `A role now reaches these — remove them from NO_ROLE_HOLDS:\n${
      closed.map((c) => `  ${c}`).join('\n')}`,
  );
}

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
