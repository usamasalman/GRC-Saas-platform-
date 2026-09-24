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
  'POST /api/impersonation/:id/end': 'Handler requires the requester or the customer\'s approver.',
  'POST /api/itsm/workflows/runs/:id/decide': 'workflowEngine checks the step\'s requiredCapability and SoD rules.',
  'POST /api/grc/rcsa-assessments/:assessmentId/submit': 'Handler requires the assessment\'s own respondent.',
  'POST /api/grc/issues/:id/submit-closure': 'Handler requires the corrective action\'s owner.',
  'POST /api/notifications/:id/read': 'Scoped to the caller\'s own notifications (recipientId).',
  'POST /api/notifications/read-all': 'Scoped to the caller\'s own notifications (recipientId).',
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

v.finish(`${writes.length} write routes, ${unguarded.length} unguarded`);
