/**
 * A leaver hands over what they held, and then stops being able to act.
 *
 * Nothing in this API reassigned ownership of anything from one person to
 * another -- not one updateMany touched an owner, assignee or approver column
 * -- so the only way to remove somebody was the platform database console,
 * whose delete is four lines with no audit entry, no transaction and no tenant
 * scoping.
 *
 * The plan called it "roughly ninety ownership references". The count is right
 * and the word is wrong: 89 fields are typed User with a relation, and only 25
 * of them are a live responsibility. The rest record who did something --
 * signed an approval, acknowledged a policy, validated a control, placed a
 * legal hold, wrote a version -- and reassigning those would forge history.
 *
 * Two things are neither: an AcknowledgementRequest names the one person who
 * may sign it and has no cancel anywhere in the API, so a leaver would sit on
 * "who has not signed this" forever; and a document checked out by the leaver
 * is locked for everybody else, with the only release gated on a different
 * capability that has no caller. Both are withdrawn.
 *
 * And the account had to actually close. User.status was read by NOTHING in
 * the auth path -- login never consulted it, requireAuth never loaded the User
 * row, refresh checked only the token -- so marking somebody Inactive did not
 * stop them working. Suspension had the same hole.
 *
 *   node scripts/verify/offboarding-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(API, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/** Comments are prose. Only what runs counts. */
const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const schema = read(API, '..', 'prisma', 'schema.prisma');
const svcSrc = read(API, 'services', 'offboarding.ts');
const ctrl = code(read(API, 'controllers', 'offboardingController.ts'));
const auth = code(read(API, 'middlewares', 'authMiddleware.ts'));
const routes = read(API, 'routes', 'iamRoutes.ts');
const engine = read(API, 'services', 'capabilityEngine.ts');
const rbac = JSON.parse(read(API, 'utils', 'rbacData.json'));
const nav = read(WEB, 'pages', 'navCapabilities.ts');
const directory = code(read(WEB, 'pages', 'iam', 'UserDirectory.tsx'));
const deploy = read(WEB, '..', '.github', 'workflows', 'deploy.yml');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

const {
  planOffboarding, planApprovalHandover, summariseHandover,
  HANDOVER_TARGETS, WITHDRAW_TARGETS, NEVER_MOVE,
} = require('../../dist/services/offboarding');

const person = (over) => Object.assign(
  { id: 'u-leaver', tenantId: 't1', status: 'Active', name: 'Sam' }, over,
);
const LEAVER = person({});
const SUCCESSOR = person({ id: 'u-next', name: 'Alex' });
const BASE = { actorId: 'u-admin', leaver: LEAVER, successor: SUCCESSOR, reason: 'Left the organisation' };

// ─── The rules run without a database ───────────────────────────────────────
{
  ok(
    !/from ['"]@prisma\/client['"]|require\(['"]@prisma/.test(svcSrc)
    && !/from ['"]\.\.\/db['"]/.test(svcSrc),
    'every refusal must be provable without Postgres',
  );
}

// ─── Who may be offboarded, and by whom ─────────────────────────────────────
{
  ok(planOffboarding(BASE).ok, 'a leaver with a successor and a reason is offboarded');

  eq(
    planOffboarding({ ...BASE, leaver: null }).code, 'LEAVER_NOT_FOUND',
    'somebody outside the organisation is not offboardable from it',
  );
  eq(
    planOffboarding({ ...BASE, actorId: 'u-leaver' }).code, 'CANNOT_OFFBOARD_SELF',
    'THE RECORD NEEDS TWO PEOPLE: nobody hands their own work over and closes their own '
    + 'account in one act',
  );
  eq(
    planOffboarding({ ...BASE, successor: null }).code, 'SUCCESSOR_REQUIRED',
    'THE PACKET: deactivating without a successor leaves every risk, control and document '
    + 'they owned pointing at an account that cannot act',
  );
  eq(
    planOffboarding({ ...BASE, successor: person({ id: 'u-leaver' }) }).code, 'SUCCESSOR_IS_LEAVER',
    'the successor cannot be the person leaving',
  );
  eq(
    planOffboarding({ ...BASE, successor: person({ id: 'u-next', tenantId: 't2' }) }).code,
    'SUCCESSOR_OTHER_TENANT',
    'and must not be in another organisation, or the handover moves records out of the '
    + 'tenant that owns them',
  );
  for (const status of ['Suspended', 'Inactive']) {
    eq(
      planOffboarding({ ...BASE, successor: person({ id: 'u-next', status }) }).code,
      'SUCCESSOR_NOT_ACTIVE',
      `handing over to a ${status.toLowerCase()} account moves the work to another account `
      + 'that cannot act',
    );
  }
  eq(
    planOffboarding({ ...BASE, leaver: person({ status: 'Inactive' }) }).code, 'ALREADY_OFFBOARDED',
    'and it does not happen twice',
  );
  eq(
    planOffboarding({ ...BASE, reason: 'no' }).code, 'OFFBOARD_REASON_REQUIRED',
    'the reason is the one line explaining the handover in the audit log',
  );

  // Ordering: self-offboarding is refused before the successor is considered,
  // so the message names the actual problem.
  eq(
    planOffboarding({ ...BASE, actorId: 'u-leaver', successor: null }).code,
    'CANNOT_OFFBOARD_SELF',
    'and the refusal names the first thing wrong, not the last',
  );
}

// ─── What moves, and what must never ────────────────────────────────────────
{
  eq(
    HANDOVER_TARGETS.length, 25,
    'the 89 User relations are not 89 ownership references. 25 are a live responsibility; '
    + 'the rest record who did something, and moving those would forge history',
  );

  const cols = HANDOVER_TARGETS.map((t) => t.column);
  for (const forbidden of NEVER_MOVE) {
    ok(
      !cols.includes(forbidden),
      `${forbidden} must never be handed over. It records who did something, and `
      + 'reassigning it would put the successor\'s name on an act they did not perform',
    );
  }
  ok(
    NEVER_MOVE.includes('validatedById') && NEVER_MOVE.includes('preparedById'),
    'the two most mistakable ones are named: an independent validation and a prepared '
    + 'workpaper are acts, and three separation-of-duties gates compare a caller against '
    + 'preparedById',
  );

  // The two columns whose meaning depends on the row's state.
  const approvals = HANDOVER_TARGETS.find((t) => t.model === 'approvalQueue');
  assert.deepStrictEqual(
    approvals.where, { status: 'PENDING' },
    'only an UNDECIDED approval moves. A decided row carries signatureHash, signerRole and '
    + 'sessionInfo, so rewriting approverId would re-attribute a digital signature to '
    + 'somebody who never signed',
  );
  checks += 1;
  const rcsa = HANDOVER_TARGETS.find((t) => t.model === 'rcsaAssessment');
  assert.deepStrictEqual(
    rcsa.where, { status: 'Pending' },
    'and only an unanswered attestation. A submitted one is a statement the leaver made',
  );
  checks += 1;

  // Every target must be a real model with a real column.
  for (const t of HANDOVER_TARGETS) {
    const model = t.model.charAt(0).toUpperCase() + t.model.slice(1);
    const block = schema.slice(schema.indexOf(`model ${model} {`));
    const body = block.slice(0, block.indexOf('\n}'));
    checks += 1;
    assert.ok(
      schema.includes(`model ${model} {`),
      `HANDOVER_TARGETS names model ${model}, which the schema does not define`,
    );
    checks += 1;
    assert.ok(
      new RegExp(`\\b${t.column}\\b`).test(body),
      `${model} has no column ${t.column}. A handover target that does not exist fails at `
      + 'runtime, in the middle of a transaction, on somebody\'s last day',
    );
    // The tenant-scoping flag must match the model, or the query throws or,
    // worse, silently crosses organisations.
    checks += 1;
    assert.strictEqual(
      /^\s*tenantId\s+String/m.test(body), t.tenantScoped,
      `${model}.tenantScoped is wrong. A model without tenantId cannot be filtered by it, `
      + 'and one with it must be',
    );
  }

  ok(WITHDRAW_TARGETS.length === 2, 'two things are withdrawn rather than moved');
}

// ─── Separation of duties on the approvals that move ────────────────────────
{
  const row = (over) => Object.assign(
    { id: 'a1', documentId: 'd1', editorIds: [], otherApproverIds: [] }, over,
  );

  const clean = planApprovalHandover([row({})], 'u-next');
  assert.deepStrictEqual(clean.move, ['a1'], 'an ordinary pending approval moves');
  checks += 1;

  const edited = planApprovalHandover([row({ editorIds: ['u-next'] })], 'u-next');
  eq(edited.move.length, 0, 'but not to somebody who wrote the version');
  eq(
    edited.withdraw.length, 1,
    'THE DEADLOCK: handing a signature to the person who wrote the version would create a '
    + 'document the approve endpoint refuses forever, and an approval slot held by a '
    + 'deactivated leaver is a document nobody can advance either. It is withdrawn',
  );
  ok(/cannot approve it/.test(edited.withdraw[0].why), 'and the reason is recorded');

  const already = planApprovalHandover([row({ otherApproverIds: ['u-next'] })], 'u-next');
  eq(
    already.withdraw.length, 1,
    'nor to somebody already approving that document — one person cannot hold two '
    + 'signatures on it',
  );

  ok(
    /approvalsWithdrawn: approvals\.withdraw,/.test(ctrl)
    && !/approvalsWithdrawn: approvals\.withdraw\.length/.test(ctrl),
    'and each withdrawal is NAMED in the audit entry, not counted. Withdrawing an approval '
    + 'changes the quorum for that document',
  );
}

// ─── Counting ───────────────────────────────────────────────────────────────
{
  const s = summariseHandover([
    { label: 'risks owned', model: 'risk', column: 'ownerId', count: 3 },
    { label: 'assets owned', model: 'asset', column: 'ownerId', count: 0 },
    { label: 'documents owned', model: 'document', column: 'ownerId', count: 2 },
  ]);
  eq(s.total, 5, 'the total is what actually moves');
  eq(s.moving.length, 2, 'and empty kinds are not listed');
  eq(s.ownsNothing, false, 'this person owned things');

  eq(
    summariseHandover([]).ownsNothing, true,
    'somebody who owned nothing and somebody whose records were already moved look '
    + 'identical in a total, and an offboarding reporting "0 records" must say which',
  );
}

// ─── The account actually closes ────────────────────────────────────────────
{
  ok(
    /prisma\.user\.findUnique\(\{[\s\S]{0,200}?select: \{ status: true \}/.test(auth),
    'THE HOLE: requireAuth never loaded the User row, so User.status was read by nothing in '
    + 'the auth path and marking somebody Inactive did not stop them working',
  );
  ok(
    /actor\.status === 'Suspended' \|\| actor\.status === 'Inactive'/.test(auth),
    'and both closed states are refused — suspension had the same hole',
  );
  ok(
    /if \(actor &&/.test(auth),
    'but an account whose row could not be read must NOT lock everybody out of a working '
    + 'system over a transient database error',
  );
  ok(
    /refreshTokenHash: null/.test(ctrl),
    'and offboarding must end the session as well as the account, or the leaver keeps '
    + 'working for the life of their refresh token',
  );
}

// ─── The handover itself ────────────────────────────────────────────────────
{
  ok(
    /for \(const target of HANDOVER_TARGETS\)[\s\S]{0,600}?updateMany\(/.test(ctrl),
    'the controller must drive off the classified list, not a hand-written set of updates '
    + 'that can drift from it',
  );
  ok(
    /\{ timeout: HANDOVER_TIMEOUT_MS \}/.test(ctrl),
    "Prisma's interactive transactions default to five seconds and nothing else in this API "
    + 'raises it. Twenty-five updateMany statements plus an audit append would hit P2028 on '
    + 'a real tenant and roll the whole handover back having done nothing',
  );
  ok(
    /if \(target\.tenantScoped\) where\.tenantId = tenantId;/.test(ctrl),
    'and every scoped target must carry its tenant filter. A handover that lost it would '
    + "reassign another organisation's records",
  );
  ok(
    /action: 'USER_OFFBOARDED'/.test(ctrl)
    && /leaver: \{/.test(ctrl) && /successor: \{/.test(ctrl),
    'ONE audit entry, naming both people',
  );
  ok(
    (ctrl.match(/writeAudit\(/g) || []).length === 1,
    'exactly one. writeAudit hashes only the previous hash, action, payload and timestamp, '
    + 'so two entries with the same action and payload in one millisecond collide on the '
    + 'unique currentHash and fail the transaction',
  );
  ok(
    /acknowledgementRequest\.deleteMany\(\{ where: \{ userId: id \} \}\)/.test(ctrl),
    'acknowledgement requests are withdrawn. The API has exactly one write to that table, a '
    + 'createMany, and acknowledgeDocument writes the caller\'s own id — so a leaver would '
    + 'sit on "who has not signed this" forever, holding coverage below full with no way out',
  );
  ok(
    /checkedOutBy: null/.test(ctrl),
    'and checkouts are released, or the successor inherits a document nobody can open',
  );
  ok(
    !/user\.delete\(|users\.delete\(/.test(ctrl),
    'the user row is NEVER deleted. Their name is on approvals they signed and audit '
    + 'entries they caused, and all of that has to stay readable',
  );
  ok(
    /status: 'Inactive'/.test(ctrl) && /successorId: successor!\.id/.test(ctrl),
    'the row records that they left and who took over',
  );
}

// ─── The capability is its own ──────────────────────────────────────────────
{
  ok(
    /OFFBOARD_USER: 'offboard-a-user-with-handover'/.test(engine),
    'offboarding has its own capability',
  );
  ok(
    /OFFBOARD_USER: 'offboard-a-user-with-handover'/.test(nav),
    'mirrored on the frontend, which nav-capabilities-test requires in both directions',
  );

  const holders = (r) => rbac.roles.filter((x) => (x.capabilities || []).includes(r)).length;
  const offboard = holders('offboard-a-user-with-handover');
  const addUser = holders('add-a-user-with-role-based-access');
  ok(offboard > 0, 'and somebody holds it');
  ok(
    offboard < addUser,
    'THE PACKET: it must be NARROWER than add-user, which doubles as the suspend grant and '
    + `is held by ${addUser} roles including branch HR and support coordinators. Offboarding `
    + `reassigns everything somebody owned and ends their access (offboard: ${offboard})`,
  );
  ok(
    rbac.capabilities.some((c) => c.key === 'offboard-a-user-with-handover'),
    'and it is declared in the matrix, or capabilities-mean-something-test calls it decoration',
  );

  ok(
    /router\.post\('\/users\/:id\/offboard', requireCapability\(CAP\.OFFBOARD_USER\)/.test(routes),
    'the route carries it',
  );
  ok(
    /router\.get\('\/users\/:id\/offboard-preview', requireCapability\(CAP\.OFFBOARD_USER\)/.test(routes),
    'and so does the preview, which discloses everything the person owns',
  );
  ok(
    /requireCapability\(CAP\.ADD_USER\), setUserStatus/.test(routes),
    'while suspension keeps the grant it had — this packet does not quietly change who can '
    + 'suspend somebody',
  );
}

// ─── The screen ─────────────────────────────────────────────────────────────
{
  ok(
    /offboard-preview/.test(directory),
    'the administrator is shown what the leaver holds BEFORE being asked to confirm. An '
    + 'offboarding moves every risk, control, document and project they own, and a confirm '
    + 'dialog alone asks somebody to authorise a blast radius they were never shown',
  );
  ok(
    /<Can do=\{MAY\.OFFBOARD_USER\}>[\s\S]{0,400}?offboard\s*<\/button>/.test(directory),
    'and the action is gated in the UI as well as on the route',
  );
  ok(
    /This person holds nothing that needs handing over/.test(directory),
    'somebody who owns nothing must be told that, not shown an empty list',
  );
  ok(
    /disabled=\{dialogBusy \|\| !preview \|\| !successorId/.test(directory),
    'and the button must stay disabled until a successor and a reason are given, rather '
    + 'than letting the server refuse what the screen invited',
  );
  ok(
    /their name stays on the approvals they/.test(directory),
    'the screen must say history stays with the leaver — it is the part an administrator is '
    + 'most likely to assume works the other way',
  );

  // The successor picker must filter on a field the endpoint actually sends.
  //
  // It compared `c.tenantId === dialog.u.tenantId`, and listUsers' Prisma
  // select emitted only a nested `tenant: {id,name,type}` — so both sides were
  // undefined, the comparison was true for every row, and a platform-scope
  // operator was offered successors from other tenants that
  // planOffboarding then refuses, after the blast-radius preview and the
  // reason had been filled in. The same missing field made UserDirectory's
  // role filter always false. A picker must not offer what the server refuses;
  // tenant-provisioning-test.js:213 asserts the same rule for its own screen.
  {
    const users = code(read(API, 'controllers', 'userController.ts'));
    const list = users.slice(users.indexOf('export const listUsers'));
    const select = list.slice(list.indexOf('select: {'), list.indexOf('orderBy:'));
    const filtered = [...directory.matchAll(/\bc\.(\w+) === dialog\.u\.(\w+)/g)];
    ok(
      filtered.length > 0,
      'the successor picker must restrict candidates on something',
    );
    for (const [, left, right] of filtered) {
      checks += 1;
      assert.ok(
        new RegExp(`\\b${left}: true`).test(select),
        `the successor picker filters on user.${left}, which listUsers does not select. `
        + 'Both sides are undefined at runtime, so the filter passes every row and the '
        + 'server refuses the choice after the operator has filled the form',
      );
      checks += 1;
      assert.strictEqual(
        left, right,
        'and it must compare the same field on both sides',
      );
    }
  }

  ok(
    /offboarding-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next packet can delete',
  );
}

// ─── The migration adds, and does not take away ─────────────────────────────
{
  const dir = path.join(API, '..', 'prisma', 'migrations', '20260922020000_offboarding');
  const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8');
  ok(/ADD COLUMN\s+"offboardedAt"/.test(sql), 'the leaving is recorded on the row');
  ok(/ADD COLUMN\s+"successorId"/.test(sql), 'along with who took over');
  ok(
    !/DROP |ALTER COLUMN|TRUNCATE/i.test(sql),
    'and nothing is dropped or narrowed. This runs against live tenants',
  );
}

console.log(
  `offboarding: ${checks} assertions passed `
  + `(${HANDOVER_TARGETS.length} ownership targets of 89 User relations; `
  + `${WITHDRAW_TARGETS.length} withdrawn)`,
);
