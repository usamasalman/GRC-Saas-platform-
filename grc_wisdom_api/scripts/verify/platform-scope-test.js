/**
 * Sitting in the platform tenant is not a job description.
 *
 * Tracker issue 8: "Why the Engagement Manager is getting a view of the Issues
 * of other clients where he has nothing to do with them." He was getting it
 * because resolveTenantScope asked one question -- is this tenant a SAAS
 * tenant -- and answered PLATFORM, which is every tenant in the database. Any
 * user record created in the platform tenant read every customer's data,
 * whatever they were employed to do.
 *
 * Now a platform tenant is necessary and a platform duty is also required.
 * Everyone else in that tenant reads the platform tenant only, which is never
 * an empty scope: an empty scope answers 200 with nothing on every screen and
 * is indistinguishable from deleted data.
 *
 * Two ways this breaks silently, both checked:
 *
 *   1. A platform role holds none of the listed duties and is locked out of
 *      the control plane it exists to run. All seven are checked by name.
 *   2. The list grows until it means nothing -- add a capability every tenant
 *      role holds and break-glass is back for everybody.
 *
 *   node scripts/verify/platform-scope-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const scope = read('services', 'scopeResolver.ts');
const engine = read('services', 'capabilityEngine.ts');
const rbac = JSON.parse(read('utils', 'rbacData.json'));
const roles = Array.isArray(rbac) ? rbac : rbac.roles;

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

// ── The capability constants ───────────────────────────────────────────────
const capBlock = engine.match(/export const CAP = \{([\s\S]*?)\} as const;/);
assert.ok(capBlock, 'CAP block not found in capabilityEngine.ts');
const capValue = {};
for (const m of capBlock[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)) capValue[m[1]] = m[2];

// ── The duties that justify reading across tenants ─────────────────────────
const dutyBlock = scope.match(/const PLATFORM_DUTIES: readonly string\[\] = \[([\s\S]*?)\];/);
assert.ok(
  dutyBlock,
  'PLATFORM_DUTIES not found in scopeResolver. Break-glass must be justified by a duty, '
  + 'not by which tenant a user record happens to sit in.',
);
const dutyNames = [...dutyBlock[1].matchAll(/CAP\.(\w+)/g)].map((m) => m[1]);
ok(dutyNames.length > 0, 'PLATFORM_DUTIES is empty');

const unknown = dutyNames.filter((n) => !(n in capValue));
checks += 1;
assert.deepStrictEqual(unknown, [], `PLATFORM_DUTIES names capabilities CAP does not define: ${unknown}`);
const duties = new Set(dutyNames.map((n) => capValue[n]));

// ── The decision is actually taken ─────────────────────────────────────────
ok(
  /export function hasPlatformDuty\(/.test(scope),
  'hasPlatformDuty must be exported so the decision can be tested without a database',
);
{
  const at = scope.indexOf('if (PLATFORM_TYPES.has(own.type))');
  ok(at > 0, 'the platform branch of resolveTenantScope not found');
  const branch = scope.slice(at, scope.indexOf('SUBTREE_TYPES.has', at));
  ok(
    branch.indexOf('hasPlatformDuty') >= 0
    && branch.indexOf('hasPlatformDuty') < branch.indexOf("kind: 'PLATFORM'"),
    'resolveTenantScope must check the duty before returning PLATFORM',
  );
  ok(
    /kind: 'SELF'/.test(branch),
    'a platform-tenant user without a platform duty must fall back to their own tenant, '
    + 'not to an empty scope',
  );
}

// ── No caller can pass a bare tenant id any more ───────────────────────────
// The signature takes an actor so the compiler enumerates every site; this
// catches a `{ tenantId }` literal assembled to satisfy it, which would drop
// the capabilities and silently restore the old answer.
{
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (full.endsWith('.ts')) files.push(full);
    }
  })(SRC);

  const offenders = [];
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    for (const m of code.matchAll(/(?:resolveTenantScope|guardProject)\(\s*\{([^}]*)\}/g)) {
      if (!/capabilities/.test(m[1])) {
        offenders.push(`${path.relative(SRC, f).split(path.sep).join('/')} — { ${m[1].trim()} }`);
      }
    }
  }
  checks += 1;
  assert.deepStrictEqual(
    offenders, [],
    'These pass an object literal without capabilities, so the actor\'s duties are lost:\n'
    + `${offenders.map((o) => `  ${o}`).join('\n')}\n`
    + 'Pass req.user, which carries the id the grants are read from.',
  );
}

// ── Every platform role keeps its control plane ────────────────────────────
{
  const platformRoles = roles.filter((r) => String(r.portal || '').trim().toLowerCase() === 'saas');
  ok(platformRoles.length >= 7, `expected the platform roles; found ${platformRoles.length}`);

  const lockedOut = platformRoles
    .filter((r) => !(r.capabilities || []).some((c) => duties.has(c)))
    .map((r) => r.key);
  checks += 1;
  assert.deepStrictEqual(
    lockedOut, [],
    'These roles run the platform and hold none of PLATFORM_DUTIES, so they would read only '
    + `the platform tenant and find the control plane empty:\n${
      lockedOut.map((l) => `  ${l}`).join('\n')}`,
  );
}

// ── The reported case ──────────────────────────────────────────────────────
// The role the tester was signed in as. It is a partner role; a user record for
// it inside the platform tenant must not read every customer.
{
  const em = roles.find((r) => r.key === 'engagement-manager');
  ok(em, 'engagement-manager not found in the role matrix');
  const held = (em.capabilities || []).filter((c) => duties.has(c));
  checks += 1;
  assert.deepStrictEqual(
    held, [],
    'engagement-manager now holds a platform duty, so a user record for it in the platform '
    + `tenant reads every customer again — tracker issue 8: ${held.join(', ')}`,
  );
}

// ── The list must stay a list of platform duties ───────────────────────────
// A capability most tenant-side roles hold is not a platform duty; adding one
// hands break-glass back to everybody in the platform tenant.
{
  const tenantRoles = roles.filter((r) => String(r.portal || '').trim().toLowerCase() !== 'saas');
  const tooCommon = [...duties].filter((c) => {
    const n = tenantRoles.filter((r) => (r.capabilities || []).includes(c)).length;
    return n > tenantRoles.length / 2;
  });
  checks += 1;
  assert.deepStrictEqual(
    tooCommon, [],
    'More than half of the non-platform roles hold these, so they do not describe a platform '
    + `duty:\n${tooCommon.map((t) => `  ${t}`).join('\n')}`,
  );
}

const reach = roles.filter((r) => (r.capabilities || []).some((c) => duties.has(c))).length;
console.log(
  `platform-scope: ${checks} assertions passed (${duties.size} platform duties; `
  + `${reach} of ${roles.length} roles would keep break-glass if placed in the platform tenant)`,
);
