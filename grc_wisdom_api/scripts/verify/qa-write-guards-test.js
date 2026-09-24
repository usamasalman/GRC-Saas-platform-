/**
 * Every route that changes something is guarded, or says why it need not be.
 *
 * A write route with no capability check on the route or its router is either
 * self-service — a person acting on their own account, their own
 * notifications, a step already assigned to them — or a hole. The difference
 * cannot be read from the route line, so each unguarded one is listed below
 * with the check its handler makes instead. A new unguarded write route fails
 * this suite until somebody either guards it or adds it here with a reason.
 *
 * Found this way: POST /api/itsm/workflows/runs/:id/cancel, which lets any
 * member of an organisation cancel anyone's running approval (QA-001).
 *
 * And the other half: a READ must not write. A GET that inserts rows turns
 * "look at the screen" into "change the data", races with itself, and is how
 * the usage screens came to show invented numbers as a tenant's real usage
 * (QA-015). Every GET handler is followed into its controller, and into the
 * helpers it awaits in the same file; a database write there fails the check
 * unless it is listed below with a reason. Audit rows are exempt — recording
 * that someone looked is the point of them.
 *
 *   node scripts/verify/qa-write-guards-test.js
 */
const q = require('./qa/lib');

/** method + path -> the check the handler makes instead of a route guard. */
const SELF_SERVICE = {
  'POST /api/auth/login': 'Public by definition; rate-limited; verifies the password.',
  'POST /api/auth/mfa/challenge': 'Public second factor; bound to a short-lived MFA token; rate-limited.',
  'POST /api/auth/refresh': 'Bound to the caller\'s own refresh token; rate-limited.',
  'POST /api/auth/register-admin': 'Self-closing bootstrap: refuses once any administrator exists.',
  'POST /api/auth/logout': 'Acts on the caller\'s own session only.',
  'POST /api/auth/mfa/setup': 'Acts on the caller\'s own account only.',
  'POST /api/auth/mfa/verify': 'Acts on the caller\'s own account only.',
  'POST /api/auth/change-password': 'Acts on the caller\'s own account; requires the current password.',
  'POST /api/documents/:id/acknowledge': 'The caller acknowledges for themselves; published documents in their own organisation only.',
  'POST /api/password-reset/request': 'Public; answers identically whether or not the account exists.',
  'POST /api/password-reset/complete': 'Requires an administrator-approved, expiring reset code.',
  'POST /api/impersonation': 'Handler requires MONITOR_SECURITY or RESOLVE_TICKETS (canRequest).',
  'POST /api/impersonation/:id/approve': 'Handler requires the target tenant and MAINTAIN_ROLES or ADD_USER (canApprove).',
  'POST /api/impersonation/:id/deny': 'Handler requires the target tenant and canApprove.',
  'POST /api/impersonation/:id/start': 'Handler requires the requester and an APPROVED session.',
  'POST /api/itsm/workflows/runs/:id/cancel': 'Handler allows only the run\'s starter, or AUTHOR_WORKFLOW, within the caller\'s organisations (QA-001).',
  'POST /api/impersonation/:id/end': 'Handler requires the requester or the customer\'s approver.',
  'POST /api/itsm/workflows/runs/:id/decide': 'workflowEngine checks the step\'s requiredCapability and SoD rules.',
  'POST /api/grc/rcsa-assessments/:assessmentId/submit': 'Handler requires the assessment\'s own respondent.',
  'POST /api/grc/issues/:id/submit-closure': 'Handler requires the corrective action\'s owner.',
  'POST /api/notifications/:id/read': 'Scoped to the caller\'s own notifications (recipientId).',
  'POST /api/notifications/read-all': 'Scoped to the caller\'s own notifications (recipientId).',
};

/** GET routes whose write is the purpose of the call. */
const READ_SIDE_EFFECTS = {
  'GET /api/itsm/knowledge/:id': 'Counts a view on the article; the view count is what the call is for.',
};

const v = q.verdicts('qa-write-guards');
const writes = q.routeTable().filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method));
const unguarded = writes.filter((r) => !q.isGuarded(r));

for (const r of unguarded) {
  const key = `${r.method} ${r.path}`;
  v.record(`write-guards:${key}`, Boolean(SELF_SERVICE[key]),
    SELF_SERVICE[key] ? '' : `no guard on the route or its router, and not listed as self-service (${r.file})`);
}

// The list is kept honest in the other direction too: an entry for a route
// that is now guarded, or no longer exists, is noise that hides the real ones.
for (const key of Object.keys(SELF_SERVICE)) {
  v.record(`write-guards:listed ${key}`, unguarded.some((r) => `${r.method} ${r.path}` === key),
    'listed as self-service but it is guarded now, or gone — remove it from SELF_SERVICE');
}

// ─── reads do not write ─────────────────────────────────────────────────────

const path = require('path');
const fs = require('fs');
const WRITE = /prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;
const controllerCache = {};
/** name -> body, for every async function in a controller file. */
function functionsIn(file) {
  if (controllerCache[file]) return controllerCache[file];
  const src = q.strip(fs.readFileSync(file, 'utf8'));
  const starts = [...src.matchAll(/(?:export\s+)?(?:const\s+(\w+)\s*=\s*async|async\s+function\s+(\w+))/g)]
    .map((m) => ({ name: m[1] || m[2], at: m.index }));
  const out = {};
  starts.forEach((f, i) => { out[f.name] = src.slice(f.at, i + 1 < starts.length ? starts[i + 1].at : src.length); });
  return (controllerCache[file] = out);
}
function writesIn(fns, name, seen = new Set()) {
  if (!fns[name] || seen.has(name)) return [];
  seen.add(name);
  const found = [...fns[name].matchAll(WRITE)].map((m) => `${m[1]}.${m[2]}`).filter((w) => !w.startsWith('auditLog.'));
  for (const m of fns[name].matchAll(/await\s+(\w+)\(/g)) {
    found.push(...writesIn(fns, m[1], seen).map((w) => `${m[1]}() → ${w}`));
  }
  return found;
}

const reads = q.routeTable().filter((r) => r.method === 'GET' && r.file !== 'app.ts');
let followed = 0;
for (const r of reads) {
  const routeSrc = q.read(path.join(q.API_SRC, 'routes', r.file));
  // Which controller file each imported handler comes from, in THIS route file:
  // three controllers have a listRules/listImports/listPlans of their own.
  const from = {};
  for (const m of routeSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\.\/controllers\/(\w+)'/g)) {
    for (const n of m[1].split(',')) {
      const [orig, alias] = n.trim().split(/\s+as\s+/);
      if (orig) from[(alias || orig).trim()] = { file: path.join(q.API_SRC, 'controllers', `${m[2]}.ts`), name: orig.trim() };
    }
  }
  const handler = (r.guards.match(/\w+/g) || []).reverse().find((t) => from[t]);
  if (!handler) continue;
  followed += 1;
  const key = `${r.method} ${r.path}`;
  const w = [...new Set(writesIn(functionsIn(from[handler].file), from[handler].name))];
  v.record(`reads-write:${key}`, w.length === 0 || Boolean(READ_SIDE_EFFECTS[key]),
    `a GET that writes: ${w.join(', ')}`);
}
for (const key of Object.keys(READ_SIDE_EFFECTS)) {
  v.record(`reads-write:listed ${key}`, reads.some((r) => `${r.method} ${r.path}` === key),
    'listed in READ_SIDE_EFFECTS but the route is gone — remove it');
}

v.finish(`${writes.length} write routes, ${unguarded.length} unguarded; ${followed} of ${reads.length} read routes followed into their controllers`);
