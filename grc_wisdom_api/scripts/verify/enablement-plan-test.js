/**
 * The admission decision for enabling standards across an estate.
 *
 * planEnablement is the whole of it: which pairings may be written, which are
 * already how the caller asked for them, and when the entire request is refused
 * instead. It is pure so it can be exercised here against every case without a
 * database — the only kind of test this repository's CI can run.
 *
 * What makes this worth pinning rather than trusting: the mistakes a bulk write
 * makes are not symmetrical. Enabling one entity too many is noise the owner can
 * undo. Enabling another organisation's private framework is a disclosure.
 * Refusing an entity the operator is entitled to is a product that looks broken.
 * Silently applying half of a request is the worst of the three, because the
 * operator walks away believing an estate is covered when it is not.
 *
 *   npm run build && node scripts/verify/enablement-plan-test.js
 */
const assert = require('assert');
const { planEnablement, APPLICABILITY, MAX_PAIRS } = require('../../dist/services/standardEnablement');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.deepStrictEqual(a, b, what); };

// ── A world to plan against ───────────────────────────────────────────────
const T = {
  alpha: { id: 't-alpha', name: 'Alpha Holding' },
  beta: { id: 't-beta', name: 'Beta Branch' },
  gamma: { id: 't-gamma', name: 'Gamma Unit' },
};
const S = {
  iso: { id: 's-iso', code: 'ISO27001', tenantId: null },
  pdpl: { id: 's-pdpl', code: 'PDPL', tenantId: null },
  // Authored by Alpha, for Alpha. Visible only inside Alpha's scope.
  house: { id: 's-house', code: 'ALPHA-SEC', tenantId: 't-alpha' },
};

const base = {
  mode: 'enable',
  scopeTenantIds: [T.alpha.id, T.beta.id, T.gamma.id],
  targets: [T.alpha, T.beta, T.gamma],
  standards: [S.iso, S.pdpl, S.house],
  existing: [],
};
const plan = (over) => planEnablement({ ...base, ...over });

// ── The ordinary case ─────────────────────────────────────────────────────
{
  const r = plan({ requestedTenantIds: [T.alpha.id, T.beta.id], requestedStandardIds: [S.iso.id] });
  ok(r.ok, 'a plain enable across two entities must be allowed');
  eq(r.apply.map((p) => p.tenantId).sort(), [T.alpha.id, T.beta.id], 'both entities planned');
  eq(r.skip, [], 'nothing to skip when nothing is enabled');
  checks += 1;
  assert.strictEqual(r.applicability, 'Full', 'applicability defaults to Full');
  checks += 1;
  assert.strictEqual(r.apply[0].standardCode, 'ISO27001', 'the plan carries the code for the audit payload');
  checks += 1;
  assert.strictEqual(r.apply[0].tenantName, 'Alpha Holding', 'the plan carries the name for the report');
}

// ── Re-running the same request is safe ───────────────────────────────────
// The operator will re-run it: the first attempt half-failed, another admin got
// there first, or the screen was reloaded. An already-enabled pairing must be a
// skip, never an error, or a bulk enable can never be retried.
{
  const r = plan({
    requestedTenantIds: [T.alpha.id, T.beta.id],
    requestedStandardIds: [S.iso.id],
    existing: [{ tenantId: T.alpha.id, standardId: S.iso.id }],
  });
  ok(r.ok, 'a partly-enabled request must still be allowed');
  eq(r.apply.map((p) => p.tenantId), [T.beta.id], 'only the entity that needs it is planned');
  eq(r.skip.map((p) => p.tenantId), [T.alpha.id], 'the one already enabled is skipped, not failed');
}

// ── Disable is the mirror ─────────────────────────────────────────────────
{
  const r = plan({
    mode: 'disable',
    requestedTenantIds: [T.alpha.id, T.beta.id],
    requestedStandardIds: [S.iso.id],
    existing: [{ tenantId: T.alpha.id, standardId: S.iso.id }],
  });
  ok(r.ok, 'disable must be allowed');
  eq(r.apply.map((p) => p.tenantId), [T.alpha.id], 'only the enabled one is disabled');
  eq(r.skip.map((p) => p.tenantId), [T.beta.id], 'one that was never enabled is a skip');
}

// ── Out of scope refuses the WHOLE request ────────────────────────────────
// Not a partial apply. An operator who named an entity outside their scope has
// misunderstood something, and half-applying their intention while dropping the
// rest is how an estate ends up believed covered when it is not.
{
  const r = plan({ requestedTenantIds: [T.alpha.id, 't-stranger'], requestedStandardIds: [S.iso.id] });
  checks += 1;
  assert.strictEqual(r.ok, false, 'an entity outside scope must refuse the request');
  checks += 1;
  assert.strictEqual(r.status, 403);
  checks += 1;
  assert.strictEqual(r.code, 'OUT_OF_SCOPE');
  checks += 1;
  assert.ok(
    /Nothing was changed/.test(r.message),
    'the refusal must say nothing was changed — otherwise the operator has to guess',
  );
  checks += 1;
  assert.ok(
    !r.message.includes('t-stranger'),
    'the refusal must not echo the id. Confirming an id is real is the disclosure being refused.',
  );
}

// ── A private framework belonging to someone else cannot be named ─────────
// The controller loads only visible standards, so an invisible one simply is
// not in `standards`. This is the assertion that the absence refuses rather
// than being silently dropped from the plan.
{
  const r = plan({
    requestedTenantIds: [T.beta.id],
    requestedStandardIds: [S.iso.id, 's-someone-elses-private'],
    standards: [S.iso, S.pdpl],
  });
  checks += 1;
  assert.strictEqual(r.ok, false, 'a standard the caller cannot see must refuse the request');
  checks += 1;
  assert.strictEqual(r.status, 404);
  checks += 1;
  assert.strictEqual(r.code, 'STANDARD_NOT_FOUND', 'not 403 — "exists but is not yours" is the leak');
}

// ── A deleted entity is not a silent drop ────────────────────────────────
{
  const r = plan({
    requestedTenantIds: [T.alpha.id, T.gamma.id],
    requestedStandardIds: [S.iso.id],
    targets: [T.alpha],
  });
  checks += 1;
  assert.strictEqual(r.ok, false, 'an entity that no longer exists must refuse the request');
  checks += 1;
  assert.strictEqual(r.code, 'TENANT_NOT_FOUND');
}

// ── Scope is checked before existence ─────────────────────────────────────
// Answering "no such entity" for one that exists outside the caller's scope
// would confirm it does not exist, which is both wrong and a disclosure.
{
  const r = plan({
    requestedTenantIds: ['t-stranger'],
    requestedStandardIds: [S.iso.id],
    targets: [],
  });
  checks += 1;
  assert.strictEqual(r.code, 'OUT_OF_SCOPE', 'scope must be decided before existence');
}

// ── Nothing named ─────────────────────────────────────────────────────────
for (const [t, s] of [[[], [S.iso.id]], [[T.alpha.id], []], [[], []]]) {
  const r = plan({ requestedTenantIds: t, requestedStandardIds: s });
  checks += 1;
  assert.strictEqual(r.ok, false, 'an empty selection must refuse rather than write nothing silently');
  checks += 1;
  assert.strictEqual(r.code, 'MISSING_TARGETS');
}

// ── Applicability ─────────────────────────────────────────────────────────
{
  ok(APPLICABILITY.length >= 2, 'the applicability list must exist');
  for (const good of APPLICABILITY) {
    const r = plan({
      requestedTenantIds: [T.alpha.id], requestedStandardIds: [S.iso.id], applicability: good,
    });
    checks += 1;
    assert.ok(r.ok, `${good} is offered by the dialog and must be accepted`);
  }
  const r = plan({
    requestedTenantIds: [T.alpha.id], requestedStandardIds: [S.iso.id], applicability: 'full',
  });
  checks += 1;
  assert.strictEqual(r.ok, false, 'a near-miss must be refused, not silently defaulted to Full');
  checks += 1;
  assert.strictEqual(r.code, 'BAD_APPLICABILITY');

  // Disabling has no applicability, so a stray value must not refuse it.
  const d = plan({
    mode: 'disable',
    requestedTenantIds: [T.alpha.id],
    requestedStandardIds: [S.iso.id],
    existing: [{ tenantId: T.alpha.id, standardId: S.iso.id }],
    applicability: 'nonsense',
  });
  checks += 1;
  assert.strictEqual(d.ok, true, 'applicability is meaningless for a disable and must be ignored');
}

// ── Blast radius ──────────────────────────────────────────────────────────
{
  const many = Array.from({ length: 60 }, (_, i) => `t-${i}`);
  const std = Array.from({ length: 5 }, (_, i) => `s-${i}`);
  const r = planEnablement({
    mode: 'enable',
    scopeTenantIds: many,
    requestedTenantIds: many,
    requestedStandardIds: std,
    targets: many.map((id) => ({ id, name: id })),
    standards: std.map((id) => ({ id, code: id, tenantId: null })),
    existing: [],
  });
  checks += 1;
  assert.strictEqual(r.ok, false, `${many.length * std.length} pairings must exceed the limit`);
  checks += 1;
  assert.strictEqual(r.code, 'TOO_MANY_PAIRS');
  checks += 1;
  assert.ok(r.message.includes(String(MAX_PAIRS)), 'the refusal must name the limit so it can be split');
}

// ── Duplicates in the request do not multiply the work ───────────────────
{
  const r = plan({
    requestedTenantIds: [T.alpha.id, T.alpha.id, T.alpha.id],
    requestedStandardIds: [S.iso.id, S.iso.id],
  });
  ok(r.ok, 'a repeated id is a client mistake, not a refusal');
  checks += 1;
  assert.strictEqual(r.apply.length, 1, 'a pairing named twice must be planned once, or it hits the unique index');
}

// ── Every planned pairing is inside the caller's scope ───────────────────
// The invariant the whole function exists for, asserted over the cross product.
{
  const r = plan({
    requestedTenantIds: [T.alpha.id, T.beta.id, T.gamma.id],
    requestedStandardIds: [S.iso.id, S.pdpl.id, S.house.id],
  });
  ok(r.ok, 'the full cross product inside scope must be allowed');
  const scoped = new Set(base.scopeTenantIds);
  const escaped = [...r.apply, ...r.skip].filter((p) => !scoped.has(p.tenantId));
  eq(escaped, [], 'no planned pairing may name a tenant outside the callerScope');
  checks += 1;
  assert.strictEqual(r.apply.length, 9, 'three entities by three standards');
}

console.log(`enablement-plan: ${checks} assertions passed (pure, no database)`);
