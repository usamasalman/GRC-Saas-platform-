/**
 * A tenant the product creates can be signed in to.
 *
 * The only tenant-creation screen posted to POST /api/tenants, which makes an
 * organisation and nobody in it. The tenant then existed, appeared in every
 * list, and could not be entered by anyone at all — not its own staff, who had
 * no account, and not the operator, who has break-glass over its data but no
 * way to become a user of it.
 *
 * POST /api/tenants/onboard had existed the whole time: routed, capability
 * guarded, creating the tenant and its first administrator in one transaction
 * with one audit record and a temporary password. Nothing called it. That is
 * the same class of defect as the six controllers found unrouted earlier —
 * work that was done, and then not connected — except worse, because the
 * disconnected path was the one that worked.
 *
 * So what is pinned here is the connection, in both directions: the screen
 * sends an administrator, and the server still refuses without one.
 *
 *   node scripts/verify/tenant-provisioning-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(__dirname, '..', '..', '..', 'src');

const tenantCtrl = fs.readFileSync(path.join(API, 'controllers', 'tenantController.ts'), 'utf8');
const userCtrl = fs.readFileSync(path.join(API, 'controllers', 'userController.ts'), 'utf8');
const routes = fs.readFileSync(path.join(API, 'routes', 'tenantRoutes.ts'), 'utf8');
const screen = fs.readFileSync(path.join(WEB, 'pages', 'tenants', 'TenantManager.tsx'), 'utf8');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

/** Comments are prose. Only what runs counts. */
function code(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const screenCode = code(screen);

// ── The screen provisions rather than creates ────────────────────────────
ok(
  screenCode.includes("apiClient.post('/api/tenants/onboard'"),
  'TenantManager must create tenants through /api/tenants/onboard. Posting to /api/tenants makes '
  + 'an organisation with no users, which nobody can sign in to and which the operator has no way '
  + 'to enter.',
);

checks += 1;
assert.ok(
  !/apiClient\.post\('\/api\/tenants'/.test(screenCode),
  'TenantManager still posts to /api/tenants somewhere. That endpoint creates a tenant without an '
  + 'administrator; every tenant made that way is unreachable.',
);

// ── And it collects what onboarding needs ────────────────────────────────
for (const field of ['adminName', 'adminEmail', 'adminRoleId']) {
  ok(
    screenCode.includes(field),
    `TenantManager no longer collects ${field}. onboardTenant refuses without admin.name, `
    + 'admin.email and admin.roleId, so dropping one turns provisioning into a 400 the operator '
    + 'cannot act on.',
  );
}
ok(
  /\/api\/iam\/roles/.test(screenCode),
  'the role list must be loaded — a role id cannot be chosen from nothing',
);

// ── The server keeps refusing without one ────────────────────────────────
{
  const at = tenantCtrl.indexOf('export const onboardTenant =');
  ok(at > 0, 'onboardTenant not found');
  // To the end of the handler, not a fixed window — onboardTenant is long, and a
  // window that stops short reports a missing guarantee that is in fact present.
  const end = tenantCtrl.indexOf('\nexport const ', at + 1);
  const body = tenantCtrl.slice(at, end > 0 ? end : tenantCtrl.length);
  ok(
    /ADMIN_REQUIRED/.test(body),
    'onboardTenant must refuse without an administrator. The screen sending one is a courtesy; '
    + 'this is the guarantee.',
  );
  ok(
    /mustChangePassword: true/.test(body),
    'the first administrator must be forced to change the temporary password at first sign-in',
  );
  ok(
    /writeAudit\(tx,/.test(body),
    'onboarding must write its audit row inside the transaction that creates the tenant and user',
  );
}

// ── The route is still there and still guarded ───────────────────────────
{
  const line = routes.split('\n').find((l) => l.includes("'/onboard'"));
  ok(line, "POST /onboard is not routed");
  ok(
    /requireCapability\(CAP\.MANAGE_TENANT\)/.test(line || ''),
    'the onboard route must carry the same capability as tenant creation',
  );
}

// ── An organisation that already has nobody can be given someone ─────────
// Every tenant created before this change is in that state, and so is any made
// through the API directly. inviteUser has always accepted a tenantId and
// checked it against scope; nothing sent one.
{
  ok(
    /apiClient\.post\('\/api\/iam\/users\/invite'/.test(screenCode),
    'TenantManager must be able to create the first administrator for an organisation that has '
    + 'none — otherwise every tenant that predates this change stays unreachable forever.',
  );
  ok(
    /tenantId: adopting\.id/.test(screenCode),
    'the invite must name the tenant being adopted. Without a tenantId it targets the operator\'s '
    + 'own tenant, which is how the platform tenant accumulates other organisations\' admins.',
  );

  const at = userCtrl.indexOf('export const inviteUser =');
  ok(at > 0, 'inviteUser not found');
  const end = userCtrl.indexOf('\nexport const ', at + 1);
  const body = userCtrl.slice(at, end > 0 ? end : userCtrl.length);
  ok(
    /scope\.tenantIds\.includes\(targetTenantId\)/.test(body),
    'inviteUser must check the target tenant against the caller\'s scope',
  );
  ok(
    /excessCapabilities\(/.test(body),
    'inviteUser must apply the delegation ceiling — nobody grants a role they do not hold',
  );
}

// ── The temporary password exists once, and must not be kept ─────────────
// Both endpoints hash it and return the plaintext in that single response.
// There is no endpoint that can produce it again, so the screen has to show it
// deliberately — and must not quietly persist it anywhere a later reader could
// find it.
{
  ok(
    /temporaryPassword/.test(screenCode),
    'the screen must surface the temporary password; it is the only time it exists',
  );
  ok(
    /will not be shown again/i.test(screen),
    'the screen must say the password will not be shown again — an operator who closes it '
    + 'assuming they can look it up later has locked the customer out',
  );

  const leaks = [];
  for (const m of screenCode.matchAll(/localStorage\.setItem\(([^)]*)\)/g)) leaks.push(`localStorage: ${m[1]}`);
  for (const m of screenCode.matchAll(/console\.(log|info|warn|error)\(([^)]*)\)/g)) {
    if (/password|temporaryPassword|provisioned/i.test(m[2])) leaks.push(`console: ${m[2]}`);
  }
  checks += 1;
  assert.deepStrictEqual(
    leaks, [],
    `The provisioning screen persists or logs something it should not:\n${
      leaks.map((l) => `  ${l}`).join('\n')}\n`
    + 'A one-time credential belongs in the operator\'s clipboard and nowhere else.',
  );
}

// ── The adopt dialog must not carry the last person's details ────────────
// It shares the create form's state. Without an explicit clear, opening "add
// administrator" for one organisation offers the name and email of whoever was
// provisioned into the previous one, pre-filled and ready to submit against the
// wrong tenant — the operator's mistake to make, handed to them.
{
  const at = screenCode.indexOf('setAdopting(t)');
  ok(at > 0, 'the add-administrator control was not found');
  const around = screenCode.slice(Math.max(0, at - 400), at);
  ok(
    /adminName: ''/.test(around) && /adminEmail: ''/.test(around),
    'opening the add-administrator dialog must clear the administrator fields first',
  );
}

// ── The first administrator holds a role nobody else can take away ───────
// onboardTenant resolved admin.roleId with a bare findUnique and never checked
// role.tenantId, while inviteUser and assignRole both refuse exactly that and
// transferUser treats it as an invariant. The delegation ceiling does not cover
// it either: excessCapabilities returns an empty list unconditionally for a
// platform actor, who is also the actor whose scope reaches every custom role
// in the estate.
//
// The consequence is the failure onboarding exists to prevent. A custom Role
// cascades away with its owning tenant, User.roleId is SetNull, and the new
// organisation's only administrator is left with no capabilities at all.
{
  const at = tenantCtrl.indexOf('export const onboardTenant =');
  const end = tenantCtrl.indexOf('\nexport const ', at + 1);
  const body = tenantCtrl.slice(at, end > 0 ? end : tenantCtrl.length);

  // Both the branch and its code: an error code left inside a disabled branch
  // reads as a guard and is not one.
  ok(
    /if \(role\.tenantId\)/.test(body) && /ROLE_NOT_GLOBAL/.test(body),
    'onboardTenant must refuse a tenant-owned role. A tenant that does not exist yet cannot own '
    + 'one, so anything with a tenantId belongs to somebody else.',
  );
  checks += 1;
  assert.ok(
    body.indexOf('role.tenantId') < body.indexOf('tx.user.create'),
    'the check must happen before the administrator is created',
  );

  // And the picker must not offer what the server will refuse.
  ok(
    /rolesFor\(null\)/.test(screenCode),
    'the provisioning role picker must offer global roles only. Offering the rest just moves the '
    + 'refusal to after the operator has filled the form.',
  );
  ok(
    /r\.tenantId/.test(screenCode),
    'the screen must read tenantId from the role list — it is already in the payload and was ignored',
  );
}

console.log(`tenant-provisioning: ${checks} assertions passed`);
