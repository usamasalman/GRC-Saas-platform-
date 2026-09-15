/**
 * Nothing the product records lives in process memory.
 *
 * The module catalogue and the feature flags were mutable module-scope arrays
 * in marketplaceController. Publishing a module, changing its configuration or
 * toggling a flag mutated those arrays, which meant three things at once:
 *
 *   The change was lost on the next restart or deploy.
 *   Any other API instance never saw it at all.
 *   The WORM audit log recorded it as having happened.
 *
 * The third is the serious one. An immutable, hash-chained trail asserting
 * changes that the system silently reverted is worse than no trail, because it
 * is believed. A customer reading it would see a module disabled on a date when
 * the module was, in fact, running.
 *
 * Two further defects came with them, and both are pinned here:
 *
 *   The catalogue is one global list, and PUBLISH_MODULE is held by
 *   organization-admin as well as the platform roles. Neither handler checked
 *   anything beyond the capability, so a customer's own administrator could
 *   rename, reconfigure or disable a platform module for every other customer.
 *
 *   The flags carried tenantOverrides as a string array of identifiers —
 *   'HOLDING_1', 'ORG_2' — that matched no tenant in any database, with no
 *   endpoint to change them. An override that cannot be set is not an override.
 *
 *   node scripts/verify/persisted-state-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

/** Comments and string literals are prose. Only live code counts. */
function stripped(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

// ── No controller keeps mutable state at module scope ────────────────────
// The general rule, not just the two that were found. A `let x = [...]` or a
// `const x = new Map()` at the top of a controller is state the next restart
// throws away, and every request after a deploy disagrees with every request
// before it.
{
  /**
   * The same defect, found by this check on its first run, and left standing
   * for now with the reason and the work that closes it.
   *
   * Listed rather than silently tolerated so the number cannot grow: a new
   * in-memory store fails this suite even though these two do not.
   */
  const KNOWN = {
    'billingController.ts — gatewayConfigStore':
      'the payment gateway settings, including the VAT rate and the invoice sequence prefix. '
      + 'An operator changing either loses it on the next deploy, and invoices numbered afterwards '
      + 'disagree with the ones before. One row, and the more urgent of the two — plan packet 6.1.',
    'marketplaceController.ts — installationsStore':
      'tenant tool installations. Installing writes a real ITSM ticket and a memory-only '
      + 'installation, so after a restart the ticket survives and the thing it refers to does not '
      + '— plan packet 6.2.',
    'marketplaceController.ts — installationsStore (mutable array at module scope)':
      'the same store, matched twice by this check.',
  };

  const dir = path.join(API, 'controllers');
  const found = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const code = stripped(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const m of code.matchAll(/^(?:let|const)\s+(\w*(?:Store|Cache|Registry|State)\w*)\s*(?::[^=]+)?=\s*(\[|new Map|new Set|\{)/gm)) {
      found.push(`${f} — ${m[1]}`);
    }
    for (const m of code.matchAll(/^let\s+(\w+)\s*(?::[^=]+)?=\s*\[/gm)) {
      found.push(`${f} — ${m[1]} (mutable array at module scope)`);
    }
  }
  const offenders = [...new Set(found)].filter((o) => !(o in KNOWN));

  // A stale exemption claims a gap is known when it is closed.
  const stale = Object.keys(KNOWN).filter((k) => !found.includes(k));
  checks += 1;
  assert.deepStrictEqual(
    stale, [],
    `These are listed as known but no longer exist — remove them:\n${
      stale.map((x) => `  ${x}`).join('\n')}`,
  );

  checks += 1;
  assert.deepStrictEqual(
    [...new Set(offenders)], [],
    `These controllers hold state in process memory:\n${
      [...new Set(offenders)].map((o) => `  ${o}`).join('\n')}\n`
    + 'It is lost on restart, invisible to other instances, and — if anything audits it — recorded '
    + 'as a change that then un-happens. Put it in a table.',
  );
}

// ── The catalogue and the flags are rows ─────────────────────────────────
{
  const ctrl = fs.readFileSync(path.join(API, 'controllers', 'marketplaceController.ts'), 'utf8');
  const code = stripped(ctrl);

  for (const gone of ['grcModulesStore', 'featureFlagsStore']) {
    ok(!code.includes(gone), `${gone} must not come back — it was the defect, not the design`);
  }
  for (const model of ['prisma.platformModule', 'prisma.featureFlag']) {
    ok(code.includes(model), `${model} must be the source of truth`);
  }

  const schema = fs.readFileSync(path.join(API, '..', 'prisma', 'schema.prisma'), 'utf8');
  for (const model of ['model PlatformModule', 'model FeatureFlag', 'model FeatureFlagOverride']) {
    ok(schema.includes(model), `${model} must exist in the schema`);
  }
  ok(
    /@@unique\(\[flagId, tenantId\]\)/.test(schema),
    'one organisation cannot be held both on and off for the same flag',
  );
  ok(
    /tenant\s+Tenant\s+@relation\(fields: \[tenantId\][^)]*onDelete: Cascade/.test(schema),
    'an override must reference a real organisation and disappear with it — the old ones were '
    + 'invented strings that matched no tenant anywhere',
  );
}

// ── Writing to the catalogue is the platform's alone ─────────────────────
// The capability cannot express this: PUBLISH_MODULE is held by
// organization-admin too, and the catalogue is one global list.
{
  const ctrl = fs.readFileSync(path.join(API, 'controllers', 'marketplaceController.ts'), 'utf8');
  for (const handler of ['createModule', 'configureModule', 'createFeatureFlag', 'toggleFeatureFlag', 'setFlagOverride']) {
    const at = ctrl.indexOf(`export const ${handler} =`);
    ok(at > 0, `${handler} not found`);
    const end = ctrl.indexOf('\nexport const ', at + 1);
    const body = ctrl.slice(at, end > 0 ? end : ctrl.length);
    ok(
      /refuseIfNotPlatform/.test(body),
      `${handler} writes to a list every customer reads, so it must confirm the caller operates the `
      + 'platform. The capability says what kind of act it is, not whose catalogue it is.',
    );
  }
}

// ── Every audit write joins a transaction ───────────────────────
// writeAudit(prisma, ...) writes the record outside the transaction that made
// the change it describes, so one can commit without the other. In the
// marketplace it was worse than that: the "change" was a push onto an array,
// and there was no transaction for it to join at all.
//
// A budget rather than a clean zero, because eight of these predate this work
// and sit in handlers it does not touch. What the budget buys is that the
// number cannot grow: a new one anywhere fails, including in the same files.
{
  const BUDGET = {
    // Plans, subscriptions and invoices. These DO write to the database, so
    // the audit row and the record it describes can disagree -- plan packet 6.1.
    'billingController.ts': 5,
    // Tool submission, review and installation -- plan packet 6.2.
    'marketplaceController.ts': 3,
  };

  const dir = path.join(API, 'controllers');
  const counts = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const code = stripped(fs.readFileSync(path.join(dir, f), 'utf8'));
    const n = [...code.matchAll(/writeAudit\(\s*(\w+)/g)].filter((m) => m[1] !== 'tx').length;
    if (n > 0) counts[f] = n;
  }

  const over = Object.entries(counts)
    .filter(([f, n]) => n > (BUDGET[f] || 0))
    .map(([f, n]) => `${f}: ${n}, budget ${BUDGET[f] || 0}`);
  checks += 1;
  assert.deepStrictEqual(
    over, [],
    `These files write audit records outside a transaction more often than allowed:\n${
      over.map((o) => `  ${o}`).join('\n')}
`
    + 'writeAudit must take the transaction client, so the record and the change commit together.',
  );

  // A budget nobody is using should come down, or the number stops meaning
  // anything.
  const slack = Object.entries(BUDGET)
    .filter(([f, n]) => (counts[f] || 0) < n)
    .map(([f, n]) => `${f}: ${counts[f] || 0} left, budget still ${n}`);
  checks += 1;
  assert.deepStrictEqual(
    slack, [],
    `Fewer of these remain than the budget allows — lower it:\n${
      slack.map((x) => `  ${x}`).join('\n')}`,
  );
}

// ── The shipped catalogue invents no customers ───────────────────────────
{
  const cat = fs.readFileSync(path.join(API, 'utils', 'platformCatalogue.ts'), 'utf8');
  const code = stripped(cat);
  ok(
    !/tenantOverrides/.test(code),
    'the shipped catalogue must not carry tenant overrides — they are rows against real '
    + 'organisations now, and there are none to ship',
  );
  // The stripped code, not the raw file: the docstring quotes the old
  // identifiers verbatim, and quoting a defect is how it stays understood.
  for (const invented of ['HOLDING_1', 'ORG_2', 'ORG_1']) {
    ok(
      !code.includes(invented),
      `${invented} was an identifier that matched no tenant in any database`,
    );
  }
}

// ── And it is converged on deploy, not only seeded for demos ─────────────
{
  const prov = fs.readFileSync(path.join(API, 'provision.ts'), 'utf8');
  ok(
    /provisionModuleCatalogue/.test(prov) && /provisionFeatureFlags/.test(prov),
    'the catalogue is reference data like the capabilities and the SoD rules, so it belongs in the '
    + 'production bootstrap. Seeding it only for demos leaves a real deployment with an empty '
    + 'marketplace.',
  );
  // Whatever an operator decided must survive the next deploy, exactly as
  // provisionSodRules refuses to re-assert isActive.
  const at = prov.indexOf('async function provisionModuleCatalogue');
  const body = prov.slice(at, prov.indexOf('\nasync function ', at + 1));
  // The two branches are checked separately. A window measured from `update(`
  // runs straight into the `create` beneath it, which legitimately DOES set a
  // status — so a loose window reports the create branch as the offender.
  for (const [fn, decided] of [
    ['provisionModuleCatalogue', ['status', 'maturity', 'commercialModel', 'config']],
    ['provisionFeatureFlags', ['status', 'rolloutPercentage', 'expiryDate']],
  ]) {
    const a = prov.indexOf(`async function ${fn}`);
    const b = prov.indexOf('\nasync function ', a + 1);
    const fnBody = prov.slice(a, b > 0 ? b : prov.length);

    // What the UPDATE branch passes, and only that.
    // `[^}]*` cannot cross the nested `where: { ... }`, so match forward from
    // the call instead.
    const updAt = fnBody.indexOf('.update({');
    const upd = updAt < 0 ? null : fnBody.slice(updAt, updAt + 160).match(/data: (\w+)\s*\}/);
    checks += 1;
    assert.ok(
      upd,
      `${fn} must converge existing rows through a named data object, so what it re-asserts is `
      + 'readable in one place.',
    );

    // Non-greedy to the first `};`, so a one-line object matches as well as a
    // multi-line one.
    const declared = fnBody.match(new RegExp(`const ${upd[1]} = \\{([\\s\\S]*?)\\};`));
    checks += 1;
    assert.ok(declared, `${fn}: could not read what ${upd[1]} contains`);

    const reasserted = decided.filter((k) => new RegExp(`\\b${k}:`).test(declared[1]));
    checks += 1;
    assert.deepStrictEqual(
      reasserted, [],
      `${fn} re-asserts ${reasserted.join(', ')} on every deploy. Those are the operator's `
      + 'decisions — a module disabled deliberately must not come back running, exactly as '
      + 'provisionSodRules refuses to re-assert isActive.',
    );
  }
}

console.log(`persisted-state: ${checks} assertions passed`);
