/**
 * Every capability in the role matrix governs something.
 *
 * An administrator opens Roles & Permissions, sees a capability listed against
 * a role, and reasonably concludes that granting it changes what that person
 * can do. Two kinds of entry break that promise, and both were present:
 *
 *   1. A capability granted in rbacData.json that capabilityEngine does not
 *      define. requireCapability can never be called with it, so the grant is
 *      decoration. Seven of these existed, including
 *      "manage-partner-client-workspaces-and-engagements" on five roles.
 *
 *   2. A capability the engine defines but no route guards. ASSESS_VENDOR was
 *      one: defined, granted, and unused, because the vendor routes asked for
 *      three different capabilities instead. A role holding only
 *      "assess-and-remediate-a-vendor" could not touch a vendor.
 *
 * Neither is a security hole on its own -- the API stays closed either way --
 * but both make the role matrix describe a permission model the product does
 * not implement, which is how an operator ends up certain a person is
 * restricted when they are not, or blocked when they should not be.
 *
 * The allow-list is the point: an entry may stay only with a reason and a
 * packet that will resolve it.
 *
 *   node scripts/verify/capabilities-mean-something-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/**
 * Granted in rbacData but undefined by the engine.
 *
 * These describe duties the product has not built. They are left in place
 * because removing them would quietly shrink the role matrix the owner
 * designed; they are listed so the number cannot grow unnoticed.
 */
const UNDEFINED_BUT_GRANTED = {
  'acknowledge-or-monitor-a-policy': 'publishing and acknowledgement are not built — plan packet 4.1',
  'assign-or-complete-learning': 'no training module exists',
  'configure-an-integration': 'no integration configuration endpoint exists',
  'manage-franchise-governance': 'franchise governance has no distinct endpoints',
  'manage-group-or-regional-governance': 'group governance has no distinct endpoints',
  'manage-partner-client-workspaces-and-engagements': 'no engagement model exists — plan packets 6.2 and tracker 4/5',
};

/** Defined by the engine but guarding no route. */
const DEFINED_BUT_UNUSED = {
  OPERATE_SECURITY_SERVICES: 'Wisdom Eye and Eye Phish are mock screens with no API — plan packet 6.2',
};

let checks = 0;

// ── Parse the engine's capability constants ────────────────────────────────
const engine = read('services/capabilityEngine.ts');
const block = engine.match(/export const CAP = \{([\s\S]*?)\} as const;/);
assert.ok(block, 'CAP block not found in capabilityEngine.ts');

const byName = {};
for (const m of block[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)) byName[m[1]] = m[2];
const values = new Set(Object.values(byName));

checks += 1;
assert.ok(Object.keys(byName).length >= 25, `expected the capability list; found ${Object.keys(byName).length}`);

// ── Every granted capability is one the engine defines ─────────────────────
{
  const rbac = JSON.parse(read('utils/rbacData.json'));
  const roles = Array.isArray(rbac) ? rbac : rbac.roles;
  checks += 1;
  assert.ok(Array.isArray(roles) && roles.length > 0, 'roles not found in rbacData.json');

  const granted = new Map();
  for (const r of roles) {
    for (const c of (r.capabilities || [])) {
      if (!granted.has(c)) granted.set(c, []);
      granted.get(c).push(r.key);
    }
  }

  const undefinedGrants = [...granted.keys()].filter((c) => !values.has(c));
  const unexpected = undefinedGrants.filter((c) => !(c in UNDEFINED_BUT_GRANTED));
  checks += 1;
  assert.deepStrictEqual(
    unexpected, [],
    'These capabilities are granted to roles but capabilityEngine does not define them, so '
    + `nothing can ever check them:\n${unexpected.map((c) => `  ${c} — on ${granted.get(c).join(', ')}`).join('\n')}\n`
    + 'Define and enforce it, or add it to UNDEFINED_BUT_GRANTED with the reason.',
  );

  // A stale exemption is worse than none: it says a gap is known when it is closed.
  const stale = Object.keys(UNDEFINED_BUT_GRANTED).filter((c) => !undefinedGrants.includes(c));
  checks += 1;
  assert.deepStrictEqual(
    stale, [],
    `These are listed as undefined but the engine now defines them — remove them from `
    + `UNDEFINED_BUT_GRANTED:\n${stale.map((c) => `  ${c}`).join('\n')}`,
  );
}

// ── Every defined capability guards at least one route ─────────────────────
{
  const dir = path.join(SRC, 'routes');
  let routes = '';
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.ts')) routes += fs.readFileSync(path.join(dir, f), 'utf8');
  }

  const used = new Set([...routes.matchAll(/CAP\.(\w+)/g)].map((m) => m[1]));
  const unused = Object.keys(byName).filter((n) => !used.has(n));
  const unexpected = unused.filter((n) => !(n in DEFINED_BUT_UNUSED));
  checks += 1;
  assert.deepStrictEqual(
    unexpected, [],
    `These capabilities are defined and granted but guard no route:\n${
      unexpected.map((n) => `  CAP.${n} — ${byName[n]}`).join('\n')}\n`
    + 'Attach it to the routes it describes, or add it to DEFINED_BUT_UNUSED with the reason.',
  );

  const stale = Object.keys(DEFINED_BUT_UNUSED).filter((n) => used.has(n));
  checks += 1;
  assert.deepStrictEqual(
    stale, [],
    `These now guard a route — remove them from DEFINED_BUT_UNUSED:\n${
      stale.map((n) => `  CAP.${n}`).join('\n')}`,
  );
}

console.log(
  `capabilities-mean-something: ${checks} assertions passed `
  + `(${Object.keys(byName).length} defined, ${Object.keys(UNDEFINED_BUT_GRANTED).length} granted-but-undefined, `
  + `${Object.keys(DEFINED_BUT_UNUSED).length} defined-but-unused)`,
);
