/**
 * A customer gets what its package says, and the platform decides the rest.
 *
 * A plan card read "Named users: 5 · Enabled frameworks: 1 · Encrypted storage:
 * 5 GB" and nothing checked any of it; and customers enabled, wrote and
 * imported frameworks themselves (QA-031). Here, against a real API:
 *
 *   - frameworks are enabled, written and imported by the platform only;
 *   - a plan must state all three limits;
 *   - a customer on a tiny package (2 users, 1 framework, 0 GB) is refused past
 *     each limit, with the limit and the package named, and a branch shares
 *     its parent's package rather than getting one of its own.
 *
 *   API=http://127.0.0.1:3000 ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/verify/package-limits-test.js
 */
const q = require('./qa/lib');

const v = q.verdicts('package-limits');
const stamp = Date.now().toString(36);

(async () => {
  const { email, password } = q.adminCredentials();
  if (!email || !password) {
    console.log('package-limits: skipped — no ADMIN_EMAIL/ADMIN_PASSWORD for the platform administrator');
    return;
  }
  const admin = await q.login(email, password);
  const as = (who) => (method, url, body) => q.call(method, url, { token: who.token, body });
  const platform = as(admin);
  // Plans belong to the platform's billing role, not to the super admin.
  const commercial = as(await q.login('billing@grcwisdom.com'));

  const roles = (await platform('GET', '/api/iam/roles')).json?.roles || [];
  const roleId = (name) => roles.find((r) => r.name === name)?.id;
  const standards = ((await platform('GET', '/api/grc/standards')).json?.standards || []).filter((s) => s.clauseCount > 0);
  // The first framework is one the platform writes itself: once enabled for a
  // customer, the customer must see it — filed under the platform's own
  // organisation, it was invisible to them.
  const written = await platform('POST', '/api/grc/standards', {
    code: `QA031-LIB-${stamp}`, title: 'QA-031 platform framework', authority: 'QA', version: '1.0',
    clauses: [{ ref: '1', title: 'First clause' }, { ref: '2', title: 'Second clause' }],
  });
  const stdA = written.json?.standard;
  const stdB = standards[0];
  v.record('package-limits:the platform writes a framework into the shared library', written.status === 201 && stdA?.tenantId === null,
    `HTTP ${written.status} ${written.json?.message || ''}`);

  // ── A plan states its limits ─────────────────────────────────────────────
  const unstated = await commercial('POST', '/api/billing/plans', { name: `QA-031 unstated ${stamp}`, priceMonthly: 1, maxUsers: 2, features: {} });
  v.record('package-limits:a plan must state its framework and storage limits', unstated.status === 400,
    `HTTP ${unstated.status} ${unstated.json?.message || ''}`);

  const plan = await commercial('POST', '/api/billing/plans', {
    name: `QA-031 tiny ${stamp}`, priceMonthly: 1, maxUsers: 2, features: { frameworks: 1, storageGb: 0 },
  });
  const planId = plan.json?.plan?.id;

  // ── A customer on it, with a branch that shares it ───────────────────────
  const onboard = await platform('POST', '/api/tenants/onboard', {
    name: `QA-031 Customer ${stamp}`, type: 'MULTIBRANCH', planId,
    admin: { email: `qa031-admin-${stamp}@example.com`, name: 'QA-031 Admin', roleId: roleId('Organization GRC Manager') },
  });
  const customer = onboard.json?.tenant;
  if (!planId || !customer) {
    v.record('package-limits:a customer can be onboarded on a package', false,
      `plan HTTP ${plan.status}, onboarding HTTP ${onboard.status} ${onboard.json?.message || ''}`);
    v.finish();
    return;
  }
  const branch = (await platform('POST', '/api/tenants', { name: `QA-031 Branch ${stamp}`, type: 'BRANCH', parentId: customer.id })).json?.tenant;

  const noPlan = await platform('POST', '/api/tenants/onboard', {
    name: `QA-031 Unpackaged ${stamp}`, type: 'MULTIBRANCH',
    admin: { email: `qa031-none-${stamp}@example.com`, name: 'QA-031 None', roleId: roleId('Organization GRC Manager') },
  });
  v.record('package-limits:an organisation with no package cannot be given users', noPlan.status === 403 && noPlan.json?.code === 'NO_PACKAGE',
    `HTTP ${noPlan.status} ${noPlan.json?.code || ''}`);

  // ── Frameworks: the platform enables, within the package ─────────────────
  const first = await platform('POST', '/api/grc/standards/enable', { standardId: stdA.id, tenantId: customer.id });
  v.record('package-limits:the platform enables a framework within the package', first.status === 201, `HTTP ${first.status} ${first.json?.message || ''}`);

  const sameForBranch = branch
    ? await platform('POST', '/api/grc/standards/enable', { standardId: stdA.id, tenantId: branch.id })
    : { status: 0 };
  v.record('package-limits:the same framework for a branch is not a second framework', sameForBranch.status === 201,
    `HTTP ${sameForBranch.status} ${sameForBranch.json?.message || ''}`);

  const second = await platform('POST', '/api/grc/standards/enable', { standardId: stdB.id, tenantId: customer.id });
  v.record('package-limits:a framework past the package is refused, naming the limit',
    second.status === 403 && second.json?.code === 'PACKAGE_LIMIT' && /allows 1 framework/.test(second.json?.message || ''),
    `HTTP ${second.status} ${second.json?.message || ''}`);

  const bulk = await platform('POST', '/api/grc/standards/bulk-enable', { standardIds: [stdB.id], tenantIds: [customer.id, branch?.id].filter(Boolean) });
  v.record('package-limits:the grid refuses it too, pair by pair, with the reason',
    bulk.status === 200 && (bulk.json?.counts?.enabled ?? -1) === 0
      && (bulk.json?.failed || []).length >= 1 && bulk.json.failed.every((f) => f.code === 'PACKAGE_LIMIT'),
    `HTTP ${bulk.status} ${JSON.stringify(bulk.json?.counts || bulk.json?.message)}`);

  const matrix = await platform('GET', '/api/grc/standards/enablement-matrix');
  const seen = matrix.json?.packages?.[customer.id];
  v.record('package-limits:the grid shows each organisation its package and its use',
    seen?.plan?.name === `QA-031 tiny ${stamp}` && seen?.used?.frameworks === 1 && seen?.limits?.frameworks === 1,
    JSON.stringify(seen?.used || null));

  // ── Customers read frameworks; they do not enable, write or import them ──
  const customerAdmin = await q.login('group.admin@alnoor.com');
  const cust = as(customerAdmin);
  const refused = [];
  for (const [method, url, body] of [
    ['POST', '/api/grc/standards/enable', { standardId: stdA.id }],
    ['POST', '/api/grc/standards/bulk-enable', { standardIds: [stdA.id], tenantIds: [customerAdmin.user.tenantId] }],
    ['POST', '/api/grc/standards', { code: `QA031-${stamp}`, title: 'x', authority: 'x', version: '1' }],
    ['POST', '/api/grc/imports', { kind: 'Clause', fileName: 'x.csv', fileData: Buffer.from('ref,title\n1,x').toString('base64') }],
  ]) {
    const r = await cust(method, url, body);
    if (r.status !== 403) refused.push(`${method} ${url}: HTTP ${r.status}`);
  }
  v.record('package-limits:a customer cannot enable, write or import a framework', refused.length === 0, refused.join(' | '));

  // ── Named users: two seats, shared with the branch ───────────────────────
  const invite = (tenantId, n) => platform('POST', '/api/iam/users/invite', {
    email: `qa031-u${n}-${stamp}@example.com`, name: `QA-031 User ${n}`, roleId: roleId('Organization GRC Manager'), tenantId,
  });
  const second_seat = await invite(customer.id, 2);
  v.record('package-limits:a user within the package is added', second_seat.status === 201, `HTTP ${second_seat.status} ${second_seat.json?.message || ''}`);
  const third = await invite(customer.id, 3);
  v.record('package-limits:a user past the package is refused, naming the limit',
    third.status === 403 && third.json?.code === 'PACKAGE_LIMIT' && /allows 2 named users/.test(third.json?.message || ''),
    `HTTP ${third.status} ${third.json?.message || ''}`);
  const inBranch = branch ? await invite(branch.id, 4) : { status: 0 };
  v.record('package-limits:a branch draws on the same seats', inBranch.status === 403, `HTTP ${inBranch.status}`);

  const userTwo = second_seat.json?.user?.id;
  const suspend = userTwo ? await platform('POST', `/api/iam/users/${userTwo}/status`, { status: 'Suspended', reason: 'QA-031 frees a seat' }) : { status: 0 };
  const afterSuspend = await invite(customer.id, 5);
  v.record('package-limits:suspending someone frees their seat', suspend.status === 200 && afterSuspend.status === 201,
    `suspend HTTP ${suspend.status}, invite HTTP ${afterSuspend.status}`);
  const back = userTwo ? await platform('POST', `/api/iam/users/${userTwo}/status`, { status: 'Active', reason: 'QA-031 reactivation' }) : { status: 0 };
  v.record('package-limits:reactivating past the package is refused', back.status === 403 && back.json?.code === 'PACKAGE_LIMIT',
    `HTTP ${back.status} ${back.json?.message || ''}`);

  // ── Storage: 0 GB, so any stored file is refused ─────────────────────────
  const tmp = onboard.json.temporaryPassword;
  const custEmail = `qa031-admin-${stamp}@example.com`;
  const newPassword = `Qa031-${stamp}-Rotated!`;
  const first_login = await q.call('POST', '/api/auth/login', { body: { email: custEmail, password: tmp } });
  await q.call('POST', '/api/auth/change-password', { token: first_login.json?.token, body: { currentPassword: tmp, newPassword } });
  const owner = await q.login(custEmail, newPassword);
  const withFile = await q.call('POST', '/api/documents', {
    token: owner.token,
    body: {
      code: `QA031-F-${stamp}`, title: 'With a file', category: 'Policy', classification: 'Internal', content: 'x',
      fileName: 'policy.txt', fileType: 'text/plain', fileData: Buffer.from('a stored file').toString('base64'),
    },
  });
  v.record('package-limits:a file past the package storage is refused, naming the limit',
    withFile.status === 403 && withFile.json?.code === 'PACKAGE_LIMIT' && /allows 0 GB of storage/.test(withFile.json?.message || ''),
    `HTTP ${withFile.status} ${withFile.json?.message || ''}`);
  const noFile = await q.call('POST', '/api/documents', {
    token: owner.token,
    body: { code: `QA031-N-${stamp}`, title: 'No file', category: 'Policy', classification: 'Internal', content: 'text only' },
  });
  v.record('package-limits:a document with no file stores nothing and is accepted', noFile.status === 201, `HTTP ${noFile.status} ${noFile.json?.message || ''}`);

  const theirs = await q.call('GET', '/api/grc/standards', { token: owner.token });
  const seen_by_customer = (theirs.json?.standards || []).find((s) => s.id === stdA?.id);
  v.record('package-limits:a framework the platform wrote and enabled is visible to the customer',
    Boolean(seen_by_customer?.isEnabledHere) && seen_by_customer?.clauseCount === 2,
    seen_by_customer ? `isEnabledHere ${seen_by_customer.isEnabledHere}` : 'not in the customer\'s library');

  const mine = await q.call('GET', '/api/billing/package', { token: owner.token });
  const p = mine.json?.package;
  v.record('package-limits:a customer sees its package and what it has used',
    p?.plan?.name === `QA-031 tiny ${stamp}` && p?.used?.users === 2 && p?.used?.frameworks === 1 && p?.limits?.storageGb === 0,
    JSON.stringify(p?.used || mine.json?.message || null));

  v.finish(`tiny package: ${p ? `${p.used.users}/${p.limits.users} users, ${p.used.frameworks}/${p.limits.frameworks} frameworks` : 'unread'}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
