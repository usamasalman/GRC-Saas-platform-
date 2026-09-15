/**
 * Who is on an engagement, and how much of them it has.
 *
 * ProjectMember modelled this completely from the start: which side of the
 * engagement a person answers to, their role, R/A/C/I, the share of their time,
 * and an active flag so removal keeps history. It even carries an index on
 * [userId, active], which exists for one question — which projects is this
 * person on.
 *
 * None of it was used. The table was written in exactly one place in the whole
 * API, a createMany at project creation adding the owner and the manager, and
 * read nowhere. No endpoint could add, remove or change anybody. Meanwhile the
 * portfolio rendered a member count, so the product displayed the size of a set
 * that could never move off two.
 *
 * The owner's words: "who will be inculde and manage ... one person works on
 * differrent project this will be specify that organization which have the
 * resourses".
 *
 *   npm run build && node scripts/verify/project-membership-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  planMemberAdd, planMemberRemove, commitments, RACI, SIDES,
} = require('../../dist/services/projectMembership');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const is = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

// ── An engagement ─────────────────────────────────────────────────────────
const project = {
  id: 'p1',
  tenantId: 'client',
  providerTenantId: 'provider',
  ownerId: 'u-owner',
  managerId: 'u-manager',
  status: 'Active',
};
const internal = { ...project, providerTenantId: null };

const U = (id, tenantId, name) => ({ id, tenantId, name });
const M = (over = {}) => ({
  id: 'm1', userId: 'u1', userName: 'Dana', side: 'Client',
  roleLabel: 'ISMS Manager', raci: 'R', allocation: null, active: true, ...over,
});

const add = (over) => planMemberAdd({
  project,
  candidate: U('u1', 'client', 'Dana'),
  scopeTenantIds: ['client', 'provider'],
  existing: [],
  roleLabel: 'ISMS Manager',
  ...over,
});

// ── The ordinary case ─────────────────────────────────────────────────────
{
  const r = add({});
  ok(r.ok, 'somebody from the client organisation can join');
  is(r.side, 'Client', 'client by default');
  is(r.raci, 'R', 'responsible by default');
  is(r.allocation, null, 'and no allocation claimed unless stated');

  const provider = add({
    candidate: U('u2', 'provider', 'Sam'), side: 'Provider', raci: 'A', allocation: 40,
  });
  ok(provider.ok, 'and somebody from the delivery provider can join on the provider side');
  is(provider.allocation, 40);
}

// ── Nobody from an unrelated organisation ────────────────────────────────
// This is the one that matters: without it, an engagement becomes a way to name
// somebody from another customer as accountable for work they cannot see.
{
  const r = add({ candidate: U('u9', 'stranger', 'Outsider') });
  is(r.ok, false, 'a person from an organisation not on the engagement must be refused');
  is(r.code, 'NOT_ON_THIS_ENGAGEMENT');
  ok(/client and, where there is one, the delivery provider/.test(r.message), 'and say who may staff it');

  // Even when the caller's scope is wide enough to see them.
  const wide = planMemberAdd({
    project,
    candidate: U('u9', 'stranger', 'Outsider'),
    scopeTenantIds: ['client', 'provider', 'stranger'],
    existing: [],
    roleLabel: 'Anything',
  });
  is(
    wide.ok, false,
    'a platform operator can SEE every organisation, which must not make every person staffable '
    + 'onto every engagement',
  );
  is(wide.code, 'NOT_ON_THIS_ENGAGEMENT');
}

// ── And nobody outside the caller's reach ────────────────────────────────
{
  const r = planMemberAdd({
    project,
    candidate: U('u2', 'provider', 'Sam'),
    scopeTenantIds: ['client'],
    existing: [],
    roleLabel: 'Lead Consultant',
    side: 'Provider',
  });
  is(r.ok, false, 'a caller who cannot write to the provider cannot staff from it');
  is(r.code, 'OUT_OF_SCOPE');
}

// ── Provider only means something when there is a provider ───────────────
{
  const r = planMemberAdd({
    project: internal,
    candidate: U('u1', 'client', 'Dana'),
    scopeTenantIds: ['client'],
    existing: [],
    roleLabel: 'ISMS Manager',
    side: 'Provider',
  });
  is(r.ok, false, 'an internal programme has no provider side');
  is(r.code, 'NO_PROVIDER');
}

// ── The vocabulary is fixed ──────────────────────────────────────────────
{
  for (const raci of RACI) ok(add({ raci }).ok, `${raci} is a valid RACI`);
  is(add({ raci: 'X' }).code, 'BAD_RACI', 'and anything else is refused');
  is(add({ side: 'Vendor' }).code, 'BAD_SIDE', 'a side outside the list is refused');
  // Each valid side, with somebody who actually belongs to that organisation.
  ok(add({ side: 'Client' }).ok, 'Client is valid for a client-tenant person');
  ok(
    add({ candidate: U('u2', 'provider', 'Sam'), side: 'Provider' }).ok,
    'Provider is valid for a provider-tenant person',
  );

  is(add({ roleLabel: '   ' }).code, 'ROLE_REQUIRED', 'a blank role is refused');
  ok(
    /cannot be read by anybody who was not there/.test(add({ roleLabel: '' }).message),
    'and the refusal says why a list of names without roles is useless',
  );
}

// ── The side must match the organisation the person belongs to ───────────
// Validating it only against the list and against the project having a provider
// let a client-tenant person be stored as Provider, which nothing would ever
// contradict: the team list, the engagement payload and every report reading
// this column would all say they answer to the delivery firm. Nothing
// authorises off it, so it is a labelling error rather than a hole — but a RACI
// chart that misstates which firm somebody answers to is the kind of record
// this product exists to keep straight.
{
  const wrongWay = add({ side: 'Provider' });
  is(wrongWay.ok, false, 'a client-tenant person cannot be recorded on the provider side');
  is(wrongWay.code, 'SIDE_MISMATCH');
  ok(/client organisation/.test(wrongWay.message), 'and the refusal names which side they are on');

  const otherWay = add({ candidate: U('u2', 'provider', 'Sam'), side: 'Client' });
  is(otherWay.ok, false, 'nor a provider-tenant person on the client side');
  is(otherWay.code, 'SIDE_MISMATCH');

  // Unstated is derived, not defaulted. Defaulting to Client would be wrong for
  // every provider-side person, and the screen has no business asking for a
  // fact that follows from which organisation somebody belongs to.
  const derivedProvider = add({ candidate: U('u2', 'provider', 'Sam'), side: undefined });
  ok(derivedProvider.ok, 'an unstated side is derived rather than refused');
  is(derivedProvider.side, 'Provider', 'and derived from the organisation they belong to');

  const derivedClient = add({ side: undefined });
  ok(derivedClient.ok);
  is(derivedClient.side, 'Client');
}

// ── Allocation is a whole percentage, or genuinely unstated ──────────────
{
  is(add({ allocation: 0 }).allocation, 0, 'zero is a real answer');
  is(add({ allocation: 100 }).allocation, 100);
  is(add({ allocation: null }).allocation, null, 'and blank stays blank');
  is(add({ allocation: '' }).allocation, null, 'an empty string is blank, not zero');
  for (const bad of [101, -1, 12.5, 'half']) {
    is(add({ allocation: bad }).code, 'BAD_ALLOCATION', `${bad} is not an allocation`);
  }
}

// ── Somebody already on it ───────────────────────────────────────────────
{
  const r = add({ existing: [M({ userId: 'u1', roleLabel: 'ISMS Manager' })] });
  is(r.ok, false, 'adding the same person twice is refused');
  is(r.code, 'ALREADY_A_MEMBER');
  ok(/ISMS Manager/.test(r.message), 'and says what they already are');

  // Somebody taken off before can come back.
  const returning = add({ existing: [M({ userId: 'u1', active: false })] });
  ok(returning.ok, 'somebody previously removed can rejoin');
}

// ── A closed engagement's team is part of the record ─────────────────────
{
  for (const status of ['Closed', 'Cancelled', 'Completed']) {
    is(add({ project: { ...project, status } }).code, 'PROJECT_CLOSED', `${status} is settled`);
    const rm = planMemberRemove({ project: { ...project, status }, member: M() });
    is(rm.code, 'PROJECT_CLOSED', `and nobody is removed from a ${status} engagement`);
  }
}

// ── The owner and the manager are on the team by definition ──────────────
// createProject puts them there for that reason. Removing either would leave an
// engagement accountable to nobody, and there is no other way to name a
// replacement from this screen.
{
  for (const [userId, which] of [['u-owner', 'owner'], ['u-manager', 'manager']]) {
    const r = planMemberRemove({ project, member: M({ userId, userName: 'Chris' }) });
    is(r.ok, false, `the ${which} must not be removable from the team list`);
    is(r.code, 'ACCOUNTABLE_MEMBER');
    ok(
      new RegExp(`Change the ${which} on the engagement itself`).test(r.message),
      'and the refusal must say where to do it instead',
    );
  }

  const ordinary = planMemberRemove({ project, member: M({ userId: 'u1' }) });
  ok(ordinary.ok, 'anybody else can be taken off');

  is(planMemberRemove({ project, member: null }).code, 'NOT_A_MEMBER');
  is(
    planMemberRemove({ project, member: M({ active: false }) }).code, 'NOT_A_MEMBER',
    'somebody already off the engagement cannot be taken off again',
  );
}

// ── What each person is committed to ─────────────────────────────────────
{
  const rows = [
    { userId: 'a', userName: 'Ada', projectId: 'p1', projectRef: 'PRJ-1', projectName: 'One', roleLabel: 'Lead', raci: 'A', allocation: 60 },
    { userId: 'a', userName: 'Ada', projectId: 'p2', projectRef: 'PRJ-2', projectName: 'Two', roleLabel: 'Reviewer', raci: 'C', allocation: 60 },
    { userId: 'b', userName: 'Ben', projectId: 'p1', projectRef: 'PRJ-1', projectName: 'One', roleLabel: 'Analyst', raci: 'R', allocation: 50 },
    { userId: 'c', userName: 'Cal', projectId: 'p1', projectRef: 'PRJ-1', projectName: 'One', roleLabel: 'Analyst', raci: 'R', allocation: null },
  ];
  const people = commitments(rows);

  const ada = people.find((p) => p.userId === 'a');
  is(ada.projects.length, 2, 'Ada is on two engagements');
  is(ada.totalAllocation, 120, 'and her stated allocations add up past a full person');
  is(ada.overCommitted, true);
  is(people[0].userId, 'a', 'over-committed people lead the list');

  const ben = people.find((p) => p.userId === 'b');
  is(ben.overCommitted, false, 'half a person is not over-committed');

  // The conservative half, and the important one.
  const cal = people.find((p) => p.userId === 'c');
  is(cal.totalAllocation, null, 'nobody stated an allocation, so there is no total');
  is(
    cal.overCommitted, false,
    'unstated must never be treated as a number — but it must also not be treated as zero, which '
    + 'would report a full-time person as free',
  );
  is(cal.unstated, 1, 'so it is counted separately and reported');

  is(commitments([]).length, 0, 'nobody is nobody');
}

// ── Mixed stated and unstated ────────────────────────────────────────────
{
  const people = commitments([
    { userId: 'd', userName: 'Dee', projectId: 'p1', projectRef: 'R1', projectName: 'One', roleLabel: 'Lead', raci: 'A', allocation: 80 },
    { userId: 'd', userName: 'Dee', projectId: 'p2', projectRef: 'R2', projectName: 'Two', roleLabel: 'Lead', raci: 'A', allocation: null },
  ]);
  const dee = people[0];
  is(dee.totalAllocation, 80, 'the total is what was actually stated');
  is(dee.unstated, 1, 'and the engagement with no figure is reported rather than assumed');
  is(
    dee.overCommitted, false,
    'she may well be over-committed, but the product does not know it and must not claim to',
  );
}

// ── Wired up, and the table is read as well as written ───────────────────
{
  const API = path.join(__dirname, '..', '..', 'src');
  const routes = fs.readFileSync(path.join(API, 'routes', 'projectRoutes.ts'), 'utf8');
  for (const r of ["'/:id/members'", "'/:id/members/:memberId'", "'/commitments'"]) {
    ok(routes.includes(r), `${r} must be routed`);
  }
  // Express matches in order, so the literal must precede '/:id'.
  checks += 1;
  assert.ok(
    routes.indexOf("'/commitments'") < routes.indexOf("router.get('/:id'"),
    "'/commitments' must be declared above '/:id', or it is read as a project id",
  );

  const ctrl = fs.readFileSync(path.join(API, 'controllers', 'projectMemberController.ts'), 'utf8');
  ok(/planMemberAdd\(/.test(ctrl) && /planMemberRemove\(/.test(ctrl), 'the controller must delegate the decisions');
  ok(
    /data: \{ active: false \}/.test(ctrl),
    'removal must deactivate rather than delete — who was on an engagement while a decision was '
    + 'taken has to stay answerable after they leave it',
  );
  checks += 1;
  assert.ok(
    !/projectMember\.delete\b/.test(ctrl),
    'nothing may hard-delete a membership row',
  );

  const svc = fs.readFileSync(path.join(API, 'services', 'projectMembership.ts'), 'utf8');
  ok(!/from '\.\.\/db'/.test(svc) && !/prisma\./.test(svc), 'the service must stay pure');
}

console.log(`project-membership: ${checks} assertions passed (pure, no database)`);
