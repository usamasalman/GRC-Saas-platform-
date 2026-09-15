/**
 * Suspending an organisation, without suspending yourself.
 *
 * There was no way to stop a customer using the platform. deleteTenant refuses
 * while the tenant holds users, documents or invoices — which every real
 * customer does — so the only two answers available were "fully operational"
 * and "impossible".
 *
 * The dangerous part of adding one is not the suspension, it is the
 * irreversibility. A suspension takes effect on the caller's NEXT request, and
 * the next request is the one that would lift it. So an operator who suspends
 * their own organisation, or any organisation containing it, or the platform
 * tenant, cannot undo it from inside the product at all. Those three are
 * checked before anything else and are the first thing pinned here.
 *
 * The second thing is the cascade. A group whose branches keep trading is not
 * suspended, so suspension reaches the subtree — but a branch suspended
 * separately, for its own reasons, must not be reactivated by lifting the
 * parent. Each row records which decision put it there, and only that decision
 * lifts it.
 *
 *   npm run build && node scripts/verify/tenant-suspension-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { planSuspension, suspensionMessage } = require('../../dist/services/tenantSuspension');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const is = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

// ── An estate ─────────────────────────────────────────────────────────────
const T = (id, name, p, type, suspendedAt = null, suspendedRootId = null) => ({
  id, name, path: p, type, suspendedAt, suspendedRootId,
});

const platform = T('t-plat', 'GRC Wisdom Platform', '/PLAT/', 'SAAS');
const group = T('t-grp', 'Northwind Group', '/NW/', 'HOLDING');
const branchA = T('t-a', 'Northwind Riyadh', '/NW/RUH/', 'BRANCH');
const branchB = T('t-b', 'Northwind Jeddah', '/NW/JED/', 'BRANCH');
const other = T('t-oth', 'Contoso Retail', '/CT/', 'MULTIBRANCH');

const estate = [platform, group, branchA, branchB, other];

const plan = (over) => planSuspension({
  mode: 'suspend',
  inScope: estate,
  actorTenantId: platform.id,
  ...over,
});

// ── The ordinary case, and the cascade ───────────────────────────────────
{
  const r = plan({ target: group });
  ok(r.ok, 'an operator must be able to suspend a customer');
  checks += 1;
  assert.deepStrictEqual(
    r.affected.map((t) => t.id).sort(), [branchA.id, branchB.id, group.id].sort(),
    'suspending a group must reach its branches — a group whose branches keep trading is not suspended',
  );
  is(r.rootId, group.id, 'every affected row points at the decision that suspended it');

  const leaf = plan({ target: branchA });
  ok(leaf.ok, 'a single branch can be suspended on its own');
  checks += 1;
  assert.deepStrictEqual(leaf.affected.map((t) => t.id), [branchA.id], 'and reaches nothing else');

  const unrelated = plan({ target: other });
  ok(unrelated.ok, 'an unrelated organisation is unaffected by path prefixes');
  checks += 1;
  assert.deepStrictEqual(unrelated.affected.map((t) => t.id), [other.id]);
}

// ── The three ways to lock yourself out ──────────────────────────────────
// All refused before any other check, because all three are unrecoverable from
// inside the product: the suspension lands on the request that would undo it.
{
  const self = plan({ target: platform, actorTenantId: platform.id });
  is(self.ok, false, 'suspending the organisation you are signed in to must be refused');
  is(self.code, 'CANNOT_SUSPEND_SELF');
  checks += 1;
  assert.ok(
    /lift it/.test(self.message),
    'the refusal must say why — that the suspension would cover the request to undo it',
  );

  // An operator whose own tenant sits beneath the target.
  const inside = planSuspension({
    mode: 'suspend', target: group, inScope: estate, actorTenantId: branchA.id,
  });
  is(inside.ok, false, 'suspending an ancestor of your own organisation must be refused');
  is(inside.code, 'CANNOT_SUSPEND_ANCESTOR');

  // The platform tenant, from anywhere.
  const plat = planSuspension({
    mode: 'suspend', target: platform, inScope: estate, actorTenantId: other.id,
  });
  is(plat.ok, false, 'the platform tenant must never be suspendable');
  is(plat.code, 'CANNOT_SUSPEND_PLATFORM');

  for (const type of ['SAAS', 'SAAS_UNIT', 'saas']) {
    const r = planSuspension({
      mode: 'suspend',
      target: T('x', 'Some Platform Unit', '/X/', type),
      inScope: [T('x', 'Some Platform Unit', '/X/', type), other],
      actorTenantId: other.id,
    });
    is(r.ok, false, `a tenant of type ${type} runs the platform and must not be suspendable`);
  }
}

// ── Reactivating lifts only what this decision suspended ─────────────────
{
  // Group suspended, cascading to both branches.
  const sGroup = T('t-grp', 'Northwind Group', '/NW/', 'HOLDING', new Date(), 't-grp');
  const sA = T('t-a', 'Northwind Riyadh', '/NW/RUH/', 'BRANCH', new Date(), 't-grp');
  // ...and one branch that was ALREADY suspended in its own right beforehand.
  const sB = T('t-b', 'Northwind Jeddah', '/NW/JED/', 'BRANCH', new Date(), 't-b');
  const world = [platform, sGroup, sA, sB, other];

  const r = planSuspension({
    mode: 'reactivate', target: sGroup, inScope: world, actorTenantId: platform.id,
  });
  ok(r.ok, 'a suspended group must be reactivatable');
  checks += 1;
  assert.deepStrictEqual(
    r.affected.map((t) => t.id).sort(), [sA.id, sGroup.id].sort(),
    'reactivating the group must NOT lift a branch that was suspended separately — that branch was '
    + 'stopped for its own reasons and nobody has decided to restart it',
  );

  // And the separately-suspended branch can still be lifted on its own.
  const solo = planSuspension({
    mode: 'reactivate', target: sB, inScope: world, actorTenantId: platform.id,
  });
  ok(solo.ok, 'a directly-suspended branch can be reactivated on its own');
  checks += 1;
  assert.deepStrictEqual(solo.affected.map((t) => t.id), [sB.id]);
}

// ── A branch suspended BY an ancestor cannot be lifted alone ─────────────
// Doing so would leave an operating branch inside a suspended group, which is
// the state the cascade exists to prevent.
{
  const sGroup = T('t-grp', 'Northwind Group', '/NW/', 'HOLDING', new Date(), 't-grp');
  const sA = T('t-a', 'Northwind Riyadh', '/NW/RUH/', 'BRANCH', new Date(), 't-grp');
  const r = planSuspension({
    mode: 'reactivate', target: sA, inScope: [platform, sGroup, sA], actorTenantId: platform.id,
  });
  is(r.ok, false, 'a branch suspended by its parent must not be reactivated alone');
  is(r.code, 'SUSPENDED_BY_ANCESTOR');
  checks += 1;
  assert.ok(
    /Northwind Group/.test(r.message),
    'and the refusal must name the organisation to reactivate instead',
  );
}

// ── Suspending twice, reactivating what is not suspended ─────────────────
{
  const sAll = estate.map((t) => (t.path.startsWith('/NW/')
    ? T(t.id, t.name, t.path, t.type, new Date(), 't-grp') : t));
  const again = planSuspension({
    mode: 'suspend', target: sAll.find((t) => t.id === 't-grp'), inScope: sAll, actorTenantId: platform.id,
  });
  is(again.ok, false, 'suspending an already-suspended group must not rewrite its rows');
  is(again.code, 'ALREADY_SUSPENDED');

  const notSusp = planSuspension({
    mode: 'reactivate', target: other, inScope: estate, actorTenantId: platform.id,
  });
  is(notSusp.ok, false, 'reactivating something that is not suspended must be refused');
  is(notSusp.code, 'NOT_SUSPENDED');
}

// ── A target outside scope is simply not found ───────────────────────────
// The controller passes only tenants it loaded from the caller's scope, so an
// out-of-scope id arrives as null. Answering "not found" rather than "not
// yours" is the same rule the standards endpoints follow.
{
  const r = planSuspension({
    mode: 'suspend', target: null, inScope: estate, actorTenantId: platform.id,
  });
  is(r.ok, false, 'an unknown or out-of-scope target must be refused');
  is(r.code, 'TENANT_NOT_FOUND');
  checks += 1;
  assert.ok(/outside your scope/.test(r.message), 'without confirming which of the two it was');
}

// ── An affected list is never empty ──────────────────────────────────────
// A plan that writes nothing but reports success tells an operator a customer
// was stopped when nothing happened.
{
  for (const mode of ['suspend', 'reactivate']) {
    const r = planSuspension({ mode, target: group, inScope: estate, actorTenantId: platform.id });
    checks += 1;
    assert.ok(
      !r.ok || r.affected.length > 0,
      `a successful ${mode} plan must name at least one organisation`,
    );
  }
}

// ── What the refused user is told ────────────────────────────────────────
{
  ok(/suspended/i.test(suspensionMessage(null)), 'the refusal must say the organisation is suspended');
  ok(
    /Unpaid invoices/.test(suspensionMessage('Unpaid invoices')),
    'and must carry the operator\'s reason — "contact your administrator" is useless to someone '
    + 'who does not know what happened',
  );
  ok(
    /operator/i.test(suspensionMessage('   ')),
    'a blank reason must fall back to telling them who to contact, not print an empty reason',
  );
}

// ── Enforced once per request, not route by route ────────────────────────
{
  const API = path.join(__dirname, '..', '..', 'src');
  const mw = fs.readFileSync(path.join(API, 'middlewares', 'authMiddleware.ts'), 'utf8');
  ok(
    /TENANT_SUSPENDED/.test(mw),
    'requireAuth must refuse a suspended organisation. Enforcing this route by route means the next '
    + 'route added will not have it.',
  );
  ok(
    /suspendedAt: true/.test(mw),
    'the middleware must select suspendedAt — it already loads this row, so the column is free',
  );
  checks += 1;
  assert.ok(
    /status\(403\)[\s\S]{0,200}TENANT_SUSPENDED/.test(mw),
    'a suspended organisation is a 403, not a 401: the credential is valid, and a 401 sends the '
    + 'browser round a sign-in loop that ends at the same refusal with less information.',
  );

  const auth = fs.readFileSync(path.join(API, 'controllers', 'authController.ts'), 'utf8');
  const at = auth.indexOf('export const login');
  ok(at > 0, 'login not found');
  const body = auth.slice(at, auth.indexOf('\nexport const ', at + 1));
  ok(/TENANT_SUSPENDED/.test(body), 'sign-in must refuse a suspended organisation too');
  checks += 1;
  assert.ok(
    body.indexOf('passwordMatches') < body.indexOf('TENANT_SUSPENDED'),
    'the suspension check must come AFTER the password verifies, or the sign-in page becomes an '
    + 'oracle for which organisations are suspended.',
  );
}

// ── The list says which organisations are stopped ───────────────────────
{
  const API = path.join(__dirname, '..', '..', 'src');
  const ctrl = fs.readFileSync(path.join(API, 'controllers', 'tenantController.ts'), 'utf8');
  const at = ctrl.indexOf('export const listTenants');
  ok(at > 0, 'listTenants not found');
  const body = ctrl.slice(at, ctrl.indexOf('\nexport const ', at + 1));
  for (const field of ['suspendedAt', 'suspendedRootId', 'suspendedReason']) {
    ok(
      body.includes(field),
      `listTenants must return ${field}. Without it a suspended organisation looks identical to an `
      + 'operating one in the only list that manages them.',
    );
  }

  const WEB = path.join(__dirname, '..', '..', '..', 'src');
  const screen = fs.readFileSync(path.join(WEB, 'pages', 'tenants', 'TenantManager.tsx'), 'utf8');
  const code = screen
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  // The URL is built from a ternary, so neither literal path appears in the
  // source. Assert on what is actually written.
  ok(
    /'suspend' : 'reactivate'/.test(code) && /api\/tenants\/\$\{/.test(code),
    'the screen must call both the suspend and reactivate endpoints',
  );
  ok(
    /setSuspended\(t, false\)/.test(code) && /setSuspending\(t\)/.test(code),
    'both directions must be reachable from a row',
  );
  checks += 1;
  assert.ok(
    /suspendedRootId === t\.id/.test(code),
    'reactivate must be offered only where it can succeed. A tenant suspended because its parent '
    + 'was is refused by the server, and a button whose only outcome is a refusal is worse than '
    + 'no button.',
  );
  checks += 1;
  assert.ok(
    /actionErr/.test(code),
    'the server\'s refusal must be surfaced. These refusals are the useful part — they name why a '
    + 'suspension would have locked the operator out.',
  );
}

console.log(`tenant-suspension: ${checks} assertions passed (pure, no database)`);
