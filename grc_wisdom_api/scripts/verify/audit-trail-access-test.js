/**
 * Reading the audit trail is a duty, not a side effect of signing in.
 *
 * GET /api/audit-logs carried requireAuth and nothing else. Tenant scoping was
 * correct — nobody saw another organisation's entries — but inside their own
 * tenancy every signed-in person could read the 200 most recent entries with
 * the raw `payload` on each one. Those payloads are the substance, not
 * metadata: an offboarding entry names the leaver and their successor, a
 * document entry names the policy and who approved it, an SLA entry carries the
 * old and new targets, an invoice entry carries the figures. A contributor
 * working one register could read who was let go last month, and the screen
 * that served it was on the menu for every role in the portal.
 *
 * This is the one place in this model where a READ is a capability. Everywhere
 * else the grants describe acts, because the registers exist to be read by the
 * people working in them — navCapabilities.ts argues that at length and it is
 * right. The audit trail is the exception because it exists to be read by the
 * people assuring them, and a menu gated on a capability the server does not
 * enforce would be concealment rather than security. Here the server enforces it.
 *
 *   node scripts/verify/audit-trail-access-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(API, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const appSrc = read(API, 'app.ts');
const app = code(appSrc);
const engine = read(API, 'services', 'capabilityEngine.ts');
const nav = read(WEB, 'pages', 'navCapabilities.ts');
const navCode = code(nav);
const screen = code(read(WEB, 'pages', 'documents', 'AuditLogViewer.tsx'));
const shell = code(read(WEB, 'pages', 'AppShell.tsx'));
const rbac = JSON.parse(read(API, 'utils', 'rbacData.json'));
const deploy = read(WEB, '..', '.github', 'workflows', 'deploy.yml');

const KEY = 'read-the-tenant-audit-trail';

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

// ─── 1. The route ───────────────────────────────────────────────────────────
{
  const line = (app.match(/app\.get\('\/api\/audit-logs'[^\n]*/) || [''])[0];
  ok(line.length > 0, 'the audit-log endpoint is still declared in app.ts');

  ok(
    /requireCapability\(CAP\.READ_AUDIT_TRAIL\)/.test(line),
    'THE PACKET: GET /api/audit-logs carries the capability. requireAuth alone '
    + 'means every signed-in member of the tenancy reads 200 raw payloads',
  );
  ok(
    /requireAuth/.test(line),
    'and still requires a session, so an anonymous caller is refused before '
    + 'the capability is even looked up',
  );
  // Sliced to this handler. app.ts declares three more inline endpoints —
  // /api/tickets, /api/asm/assets, /api/phish/campaigns — and every one of them
  // resolves a scope the same way, so searching the whole file would have found
  // their scoping and called it this one's. The negative control that removed
  // the scoping from the audit handler passed against the unsliced check.
  const handlerAt = app.indexOf("app.get('/api/audit-logs'");
  const handler = app.slice(handlerAt, app.indexOf("app.get('/api/tickets'", handlerAt));
  ok(handler.length > 0 && handler.length < app.length, 'the handler body is isolated');

  ok(
    /resolveTenantScope\(req\.user\)/.test(handler)
    && /tenantId: \{ in: scope\.tenantIds \}/.test(handler),
    'the tenant scoping that was already right is still there. The capability '
    + 'is a second gate, not a replacement for the first — a holder of it must '
    + 'still only see their own organisation',
  );
  ok(
    /auditCrossTenantRead\(scope, req\.user\.id, 'audit-logs\.list'\)/.test(handler),
    'and reading across tenants is itself written to the trail',
  );
}

// ─── 2. One string, in all four places ──────────────────────────────────────
{
  ok(
    new RegExp(`READ_AUDIT_TRAIL: '${KEY}'`).test(engine),
    'capabilityEngine defines it',
  );
  ok(
    new RegExp(`READ_AUDIT_TRAIL: '${KEY}'`).test(nav),
    'and the browser names it identically. Two spellings of one capability is a '
    + 'menu that hides a screen the API would have served',
  );

  const defined = rbac.capabilities.find((c) => c.key === KEY);
  ok(defined, 'rbacData defines it, so it appears in Roles & Permissions and can be granted');
  eq(
    defined.tenancySpecific, true,
    'and it is tenancy-specific — the trail it opens is one organisation\'s',
  );
}

// ─── 3. Granted to a duty, not to everybody ─────────────────────────────────
{
  const holders = rbac.roles.filter((r) => (r.capabilities || []).includes(KEY));

  ok(holders.length > 0, 'somebody holds it, or the screen is dead for everyone');
  ok(
    holders.length < rbac.roles.length,
    'THE PACKET: and not everybody does. A capability granted to all 42 roles '
    + 'is requireAuth with extra steps, which is the bug this closes',
  );

  // Named individually. "Fewer than all" would be satisfied by withholding it
  // from one role, and the point is WHICH roles.
  const MUST = [
    ['internal-auditor', 'the trail is their evidence'],
    ['external-auditor', 'same, from outside'],
    ['consultant', 'runs assurance engagements for the client'],
    ['group-compliance-manager', 'assurance across the group'],
    ['organization-grc-manager', 'assurance for the organisation'],
    ['branch-compliance-officer', 'assurance for the branch'],
    ['platform-super-admin', 'platform incident response'],
    ['platform-security-admin', 'platform incident response'],
    ['wisdom-eye-security-analyst', 'platform incident response'],
    ['group-admin', 'accountable for the tenancy'],
    ['organization-admin', 'accountable for the tenancy'],
    ['client-administrator', 'accountable for their workspace'],
    ['compliance-manager', 'places legal holds and sets retention — needs the trail proving it'],
    ['compliance-approver', 'same duty, same need'],
  ];
  for (const [key, why] of MUST) {
    const role = rbac.roles.find((r) => r.key === key);
    ok(role, `${key} exists`);
    ok(
      (role.capabilities || []).includes(KEY),
      `${key} holds it — ${why}`,
    );
  }

  const MUST_NOT = [
    ['staff-employee', 'acknowledges policies; has no business reading who was offboarded'],
    ['asset-owner', 'maintains an inventory'],
    ['control-owner', 'operates controls'],
    ['vendor-owner', 'manages suppliers'],
    ['client-contributor', 'contributes to a workspace'],
    ['group-hr-manager', 'HR reads HR records, not every act in the tenancy'],
    ['group-finance-manager', 'finance reads finance'],
    ['platform-billing-admin', 'bills; the trail is not a billing record'],
    ['open-source-marketplace-curator',
      'holds monitor-security for vetting tools before they reach the marketplace, '
      + 'which is not incident response on tenant data'],
  ];
  for (const [key, why] of MUST_NOT) {
    const role = rbac.roles.find((r) => r.key === key);
    ok(role, `${key} exists`);
    ok(
      !(role.capabilities || []).includes(KEY),
      `${key} does NOT hold it — ${why}`,
    );
  }
}

// ─── 4. No portal loses the screen entirely ─────────────────────────────────
{
  // nav-capabilities-test owns this rule in general: it reads AppShell's own
  // menu map and fails when an entry is gated on a capability no role in that
  // portal holds. Restated here only for the portal that actually broke.
  //
  // The first attempt at this packet gated `logs` without granting the
  // capability to any Document-portal role, and nav-capabilities-test caught it
  // — the Governance entry vanished for compliance-manager and
  // compliance-approver, who are precisely the people who place legal holds and
  // set retention. Whoever freezes a record for litigation has to be able to
  // read the trail proving it was frozen and nothing was disposed.
  //
  // Asserting this for EVERY portal would be wrong and was the first version of
  // this check: Tenant GRC Operations holds one role, control-owner, which is on
  // the MUST_NOT list above. A portal whose people should not read the trail
  // does not surface the entry, and nothing is lost.
  const documentPortal = rbac.roles.filter((r) => r.portal === 'Document');
  ok(documentPortal.length > 0, 'the Document portal has roles');
  ok(
    documentPortal.some((r) => (r.capabilities || []).includes(KEY)),
    'a Document-portal role holds it, so the Governance menu keeps its audit '
    + 'entry for the people who govern records',
  );
}

// ─── 5. The menu agrees with the server ─────────────────────────────────────
{
  ok(
    /logs: \[CAP\.READ_AUDIT_TRAIL\]/.test(navCode),
    'the Immutable Audit Log entry is gated on the capability the API now requires',
  );
  ok(
    /'hash-check': \[CAP\.READ_AUDIT_TRAIL\]/.test(navCode),
    'and so is Cryptographic Verification, which renders the same screen',
  );
  ok(
    /currentPage === 'logs' \|\| currentPage === 'hash-check'/.test(shell),
    'both keys still route to AuditLogViewer — gating a key that renders nothing '
    + 'would hide the wrong thing',
  );
}

// ─── 6. The screen stops calling a failure a result ─────────────────────────
{
  ok(
    !/Verification check completed/.test(screen),
    'THE PACKET: a failed verification no longer answers "Verification check '
    + 'completed." That catch block turned every error — including the 403 this '
    + 'packet now makes common — into what reads as a clean bill of health',
  );
  ok(
    /The chain was NOT verified/.test(screen),
    'it says the chain was not verified instead',
  );
  ok(
    /code === 403/.test(screen),
    'and distinguishes "your role cannot run this" from "the verifier broke"',
  );
  ok(
    /unverifiable > 0/.test(screen) && /cannot be verified/.test(screen),
    'a chain with entries nobody can check is not reported as INTACT. After the '
    + 'hashedAt fix a tenant can be integrityVerified with fifty-one unverifiable '
    + 'rows, and one word for both states is the wrong word for one of them',
  );
  ok(
    !/verifyStatus\.includes\('INTACT'\)/.test(screen),
    'and the banner colour is carried beside the message rather than sniffed out '
    + 'of it — "INTACT for 64 entries, 51 unverifiable" would have painted green',
  );
  ok(
    /<Can do=\{CAP\.MONITOR_SECURITY\}>/.test(screen),
    'the Verify button is hidden from roles the endpoint refuses, rather than '
    + 'shown so they can discover the 403 by pressing it',
  );
}

// ─── CI ─────────────────────────────────────────────────────────────────────
{
  ok(
    /audit-trail-access-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next '
    + 'packet can delete',
  );
}

console.log(
  `audit-trail-access: ${checks} assertions passed `
  + `(granted to ${rbac.roles.filter((r) => (r.capabilities || []).includes(KEY)).length} `
  + `of ${rbac.roles.length} roles)`,
);
