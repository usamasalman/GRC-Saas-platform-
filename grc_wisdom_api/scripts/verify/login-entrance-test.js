/**
 * The two sign-in entrances, and the order the check happens in.
 *
 * The ordering is the part worth pinning. The entrance check has to sit AFTER
 * the password comparison: refusing before it would turn either page into an
 * enumeration oracle -- type an address, read the response, learn whether it
 * belongs to a platform operator. Someone who has already supplied the correct
 * password learns nothing new from being told they are at the wrong door.
 *
 * It also has to sit BEFORE the MFA branch, or an operator with MFA enabled
 * would be issued a challenge token at the customer entrance and complete
 * sign-in through it, which is the separation not existing.
 *
 * Both are positional facts in one function, so they are checked by reading it.
 *
 *   node scripts/verify/login-entrance-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', '..', 'src');
const { entranceFor, checkEntrance } = require(path.join(__dirname, '..', '..', 'dist', 'services', 'loginEntrance.js'));

let checks = 0;
const is = (actual, expected, what) => {
  checks += 1;
  assert.strictEqual(actual, expected, `${what}: expected ${expected}, got ${actual}`);
};

// ── Which entrance a tenant type belongs to ─────────────────────────────────
is(entranceFor('SAAS'), 'platform', 'the control-plane tenant is the platform entrance');
is(entranceFor('SAAS_UNIT'), 'platform', 'so is a unit of it');
is(entranceFor('saas'), 'platform', 'the comparison is case-insensitive');
is(entranceFor('HOLDING'), 'tenant', 'a customer holding company is a customer');
is(entranceFor('MULTIBRANCH'), 'tenant', 'so is a multi-branch organisation');
is(entranceFor('BRANCH'), 'tenant', 'and a branch');
is(entranceFor('PARTNER'), 'tenant', 'and a partner');
is(entranceFor('AUDITOR'), 'tenant', 'and an external auditor');
is(entranceFor('DOCUMENT'), 'tenant', 'and a document-only workspace');
// An unknown or missing type must not resolve to the operator entrance: the
// safe default is the one with nothing privileged behind it.
is(entranceFor('SOMETHING_NEW'), 'tenant', 'an unrecognised type is a customer, not an operator');
is(entranceFor(null), 'tenant', 'a missing type is a customer');
is(entranceFor(undefined), 'tenant', 'so is undefined');
is(entranceFor(''), 'tenant', 'so is empty');

// ── The refusal itself ──────────────────────────────────────────────────────
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

ok(checkEntrance('SAAS', 'platform').ok, 'an operator at the operator entrance passes');
ok(checkEntrance('HOLDING', 'tenant').ok, 'a customer at the customer entrance passes');

const operatorAtCustomerDoor = checkEntrance('SAAS', 'tenant');
ok(!operatorAtCustomerDoor.ok, 'an operator is refused at the customer entrance');
is(operatorAtCustomerDoor.belongs, 'platform', 'and told which entrance is theirs');
ok(
  !/control-plane|\/platform/.test(operatorAtCustomerDoor.message),
  'without naming the address — the whole point is that it is not discoverable from here',
);

const customerAtOperatorDoor = checkEntrance('BRANCH', 'platform');
ok(!customerAtOperatorDoor.ok, 'a customer is refused at the operator entrance');
is(customerAtOperatorDoor.belongs, 'tenant', 'and pointed at the main login page');

// Older clients and the reset flow post no entrance at all. Enforcing a page
// separation is not worth breaking their sign-in over.
ok(checkEntrance('SAAS', undefined).ok, 'an absent entrance is treated as matching');
ok(checkEntrance('HOLDING', null).ok, 'so is null');
ok(checkEntrance('SAAS', 'nonsense').ok, 'and so is a value that is neither entrance');

// ── Where the check sits inside login() ─────────────────────────────────────
const src = fs.readFileSync(path.join(SRC, 'controllers', 'authController.ts'), 'utf8');
const login = src.slice(src.indexOf('export const login ='), src.indexOf('export const', src.indexOf('export const login =') + 10));

const posPassword = login.indexOf('bcrypt.compare');
const posEntrance = login.indexOf('checkEntrance(');
const posMfa = login.indexOf('user.mfaEnabled');

checks += 1;
assert.ok(posPassword >= 0 && posEntrance >= 0 && posMfa >= 0,
  'login() should contain the password check, the entrance check and the MFA branch');

checks += 1;
assert.ok(
  posEntrance > posPassword,
  'The entrance check must come AFTER bcrypt.compare. Before it, either sign-in page '
  + 'becomes an oracle: submit an address, read the refusal, learn whether it belongs to a '
  + 'platform operator.',
);

checks += 1;
assert.ok(
  posEntrance < posMfa,
  'The entrance check must come BEFORE the MFA branch. After it, an operator with MFA '
  + 'enabled is issued a challenge token at the customer entrance and can finish signing in '
  + 'through it.',
);

// ── The operator entrance stays unlinked ────────────────────────────────────
// The whole feature is that it is not discoverable from inside the product.
const WEB = path.join(SRC, '..', '..', 'src');
const linked = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (entry.name === 'PlatformLogin.tsx' || entry.name === 'App.tsx') continue;
    if (fs.readFileSync(full, 'utf8').includes('control-plane')) {
      linked.push(path.relative(WEB, full));
    }
  }
};
walk(WEB);
checks += 1;
assert.deepStrictEqual(
  linked, [],
  `The platform entrance is linked from:\n${linked.map((l) => `  ${l}`).join('\n')}\n`
  + 'It is reached by typing the address; a link from inside the product undoes the point of it.',
);

console.log(`login-entrance: ${checks} assertions passed`);
