/**
 * Every role lands in a workspace that exists, and it is the role's own.
 *
 * Tracker issues 11 through 17 are one fault asked seven times: a Branch
 * Compliance Officer whose user record lives in the SaaS tenant was shown
 * Subscriptions, Plans & Commercial Catalogue, Invoice Management, Payments,
 * Payment Gateway & Tax, and Resource Usage & Quotas. "Why is the Saas Branch
 * Compliance Officer getting a view of the Finance related modules as he has
 * nothing to do with this."
 *
 * resolvePortal read tenant.type and nothing else, so every user in the
 * platform tenant got the platform control plane whatever their job was. The
 * role already carried the answer -- branch-compliance-officer declares
 * "Branch" -- and now the role is asked first.
 *
 * Three ways that can silently break, all checked here:
 *
 *   1. A role declares a portal spelled differently from the map, and falls
 *      back to the tenant. The symptom is exactly the bug above returning.
 *   2. A portal in the map names no menu in AppShell, so the shell renders an
 *      empty sidebar.
 *   3. The role's portal stops being selected from the database, so
 *      roleRef.portal is undefined for everyone and every user falls back.
 *
 *   node scripts/verify/portal-follows-role-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API_SRC = path.join(__dirname, '..', '..', 'src');
const WEB_SRC = path.join(__dirname, '..', '..', '..', 'src');

const auth = fs.readFileSync(path.join(API_SRC, 'controllers', 'authController.ts'), 'utf8');
const shell = fs.readFileSync(path.join(WEB_SRC, 'pages', 'AppShell.tsx'), 'utf8');
const rbac = JSON.parse(fs.readFileSync(path.join(API_SRC, 'utils', 'rbacData.json'), 'utf8'));
const roles = Array.isArray(rbac) ? rbac : rbac.roles;

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

ok(Array.isArray(roles) && roles.length >= 40, `expected the role matrix; found ${roles && roles.length}`);

// ── The menus AppShell can actually render ─────────────────────────────────
const navBlock = shell.match(/const NAV: Record<string, any\[\]> = \{([\s\S]*?)\n\};/);
assert.ok(navBlock, 'NAV map not found in AppShell');
const menus = new Set([...navBlock[1].matchAll(/^  ([a-z]+):\s*\[/gm)].map((m) => m[1]));
ok(menus.size >= 8, `expected the portal menus; found ${[...menus].join(', ')}`);

// ── The role -> portal map ─────────────────────────────────────────────────
const mapBlock = auth.match(/const PORTAL_BY_ROLE_PORTAL: Record<string, string> = \{([\s\S]*?)\n\};/);
assert.ok(
  mapBlock,
  'PORTAL_BY_ROLE_PORTAL not found in authController. The role must be asked before the tenant, '
  + 'or tracker 11-17 come back.',
);
const byRolePortal = {};
for (const m of mapBlock[1].matchAll(/^\s*'?([\w-]+)'?:\s*'([\w-]+)'/gm)) byRolePortal[m[1]] = m[2];

const unrenderable = Object.entries(byRolePortal).filter(([, menu]) => !menus.has(menu));
checks += 1;
assert.deepStrictEqual(
  unrenderable.map(([k, v]) => `${k} -> ${v}`), [],
  'These declared portals map to a menu AppShell does not render, which shows an empty sidebar.',
);

// ── The role is asked before the tenant ────────────────────────────────────
const fn = auth.slice(auth.indexOf('function resolvePortal'), auth.indexOf('function resolvePortal') + 900);
ok(fn.length > 100, 'resolvePortal not found');
ok(
  fn.indexOf('roleRef') >= 0 && fn.indexOf('roleRef') < fn.indexOf('tenant?.type'),
  'resolvePortal must consult the role before the tenant. Reading tenant.type first is tracker 11-17.',
);

// ── roleRef.portal is actually selected ────────────────────────────────────
// A Prisma select that omits it leaves roleRef.portal undefined for every user,
// so the fallback fires for everybody and nothing in the product says why.
{
  const selects = [...auth.matchAll(/roleRef: \{ select: \{([^}]*)\} \}/g)].map((m) => m[1]);
  ok(selects.length >= 5, `expected the roleRef selects; found ${selects.length}`);
  const without = selects.filter((sel) => !/\bportal:\s*true/.test(sel));
  checks += 1;
  assert.deepStrictEqual(
    without, [],
    'These roleRef selects do not fetch portal, so resolvePortal cannot see it:\n'
    + without.map((w) => `  { ${w.trim()} }`).join('\n'),
  );
}

// ── Every role resolves to a menu ──────────────────────────────────────────
/**
 * Roles whose declared portal is a description of scope inside a tenant rather
 * than a navigation set. These fall through to the tenant's type on purpose:
 * they are tenant-side roles, and the tenant is the right source for them.
 */
const SCOPE_NOT_PORTAL = {
  'Tenant Assurance': 'internal auditor, inside a client tenant',
  'Tenant GRC Operations': 'control owner, inside a client tenant',
  'Tenant Asset Management': 'asset owner, inside a client tenant',
  'Tenant Third-Party Risk': 'vendor owner, inside a client tenant',
  'Consulting Partner / MSP': 'consultant — the partner menu comes from the partner tenant',
  'Client Workspace': 'client-side roles in a partner engagement',
};

const stranded = [];
for (const r of roles) {
  const declared = String(r.portal || '').trim();
  if (byRolePortal[declared.toLowerCase()]) continue;
  if (declared in SCOPE_NOT_PORTAL) continue;
  stranded.push(`${r.key} declares '${declared}'`);
}
checks += 1;
assert.deepStrictEqual(
  stranded, [],
  'These roles declare a portal that is neither a menu nor a known tenant-scope description, '
  + 'so they silently fall back to whatever tenant they happen to sit in:\n'
  + stranded.map((s) => `  ${s}`).join('\n'),
);

// A stale exemption claims a gap is known when it has been closed.
const staleExemptions = Object.keys(SCOPE_NOT_PORTAL)
  .filter((d) => !roles.some((r) => String(r.portal || '').trim() === d));
checks += 1;
assert.deepStrictEqual(
  staleExemptions, [],
  `No role declares these any more — remove them from SCOPE_NOT_PORTAL:\n${
    staleExemptions.map((s) => `  ${s}`).join('\n')}`,
);

// ── The reported case, spelled out ─────────────────────────────────────────
// The role the tester was signed in as, and the menu it must resolve to.
{
  const r = roles.find((x) => x.key === 'branch-compliance-officer');
  ok(r, 'branch-compliance-officer not found in the role matrix');
  checks += 1;
  assert.strictEqual(
    byRolePortal[String(r.portal).trim().toLowerCase()], 'branch',
    'branch-compliance-officer must resolve to the branch menu whatever tenant it sits in. '
    + 'That is tracker 11-17.',
  );
}

const resolved = {};
for (const r of roles) {
  const menu = byRolePortal[String(r.portal || '').trim().toLowerCase()] || '(tenant)';
  resolved[menu] = (resolved[menu] || 0) + 1;
}
console.log(
  `portal-follows-role: ${checks} assertions passed (${roles.length} roles — `
  + `${Object.entries(resolved).map(([m, n]) => `${m}:${n}`).join(', ')})`,
);
