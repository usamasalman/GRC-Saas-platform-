/**
 * People are told they have work, and can see what they have.
 *
 * Two gaps of the same kind, both established by reading and then adversarially
 * re-checked: the machinery existed and nothing connected it.
 *
 * Being GIVEN a task told nobody. projectPlanController did not import the
 * notification service at all -- createTask wrote assigneeId and went straight
 * to the audit entry, and updateTask, which is also the reassignment path, did
 * the same. So somebody learned they had work by being told in a meeting. The
 * ticket module next door already did this correctly on the same helper.
 *
 * And the inbox those notifications go to was unreachable. Four endpoints
 * existed -- list, unread count, mark one read, mark all read -- all routed and
 * correctly scoped to the recipient, and NOTHING in the frontend called any of
 * them. The bell in the shell was a button with no onClick and a CSS dot
 * rendered unconditionally: a permanent red "you have something" that opened
 * nothing. Every project notification ever written went to a table nothing
 * read.
 *
 * Three smaller holes in the same picture: a blocker raised through
 * POST /:id/impediments did not tell the task's assignee even though
 * POST /tasks/:taskId/block did, so whether the person trying to do the work
 * found out depended on which endpoint was used; clearing a blocker told only
 * whoever raised it, never the assignee whose task had just become workable;
 * and being staffed onto an engagement told nobody at all.
 *
 * And there was no way to ask "what is assigned to me". ProjectTask has carried
 * @@index([assigneeId, status]) since the module was written with no reader:
 * every multi-row task query was scoped to a single project.
 *
 *   node scripts/verify/work-notification-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(__dirname, '..', '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/** Comments are prose. Only what runs counts. */
const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const plan = code(read(API, 'controllers', 'projectPlanController.ts'));
const imped = code(read(API, 'controllers', 'projectImpedimentController.ts'));
const member = code(read(API, 'controllers', 'projectMemberController.ts'));
const notifCtrl = read(API, 'controllers', 'notificationController.ts');
const routes = read(API, 'routes', 'projectRoutes.ts');
const bell = code(read(WEB, 'components', 'NotificationBell.tsx'));
const shell = code(read(WEB, 'pages', 'AppShell.tsx'));
const myWorkScreen = code(read(WEB, 'pages', 'grc', 'project', 'MyWork.tsx'));

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

const {
  assignmentAudience, bucketWork, summarise, bucketRank, WORK_BUCKETS, DUE_SOON_DAYS,
} = require('../../dist/services/myWork');

// ── The rules run without a database ─────────────────────────────────────
{
  const svc = read(API, 'services', 'myWork.ts');
  checks += 1;
  assert.ok(
    !/from '\.\.\/db'|@prisma\/client/.test(svc),
    'myWork must stay pure. It decides what somebody is told and what their day looks like, '
    + 'and a rule that needs a database to exercise is a rule nobody exercises.',
  );
}

// ── Who hears about an assignment ────────────────────────────────────────
{
  const none = assignmentAudience({ previousAssigneeId: null, nextAssigneeId: null });
  ok(none.length === 0, 'a task nobody held and nobody holds notifies nobody');

  const same = assignmentAudience({ previousAssigneeId: 'u1', nextAssigneeId: 'u1' });
  checks += 1;
  assert.deepStrictEqual(
    same, [],
    're-sending the same assignee is not a change. Editing a task name must not tell its '
    + 'assignee they have been given it again.',
  );

  const given = assignmentAudience({ previousAssigneeId: null, nextAssigneeId: 'u2' });
  checks += 1;
  assert.deepStrictEqual(given, [{ recipientId: 'u2', kind: 'Assigned' }]);

  const moved = assignmentAudience({ previousAssigneeId: 'u1', nextAssigneeId: 'u2' });
  checks += 1;
  assert.deepStrictEqual(
    moved,
    [{ recipientId: 'u2', kind: 'Assigned' }, { recipientId: 'u1', kind: 'Unassigned' }],
    'both ends of a reassignment are news. Telling only the new assignee is how two people '
    + 'both think a task is theirs, or neither does.',
  );

  const taken = assignmentAudience({ previousAssigneeId: 'u1', nextAssigneeId: null });
  checks += 1;
  assert.deepStrictEqual(taken, [{ recipientId: 'u1', kind: 'Unassigned' }]);

  // An empty string is how a form clears a select. It must read as "nobody".
  const cleared = assignmentAudience({ previousAssigneeId: 'u1', nextAssigneeId: '' });
  checks += 1;
  assert.deepStrictEqual(
    cleared, [{ recipientId: 'u1', kind: 'Unassigned' }],
    'an empty string must mean unassigned, not a new assignee named ""',
  );
}

// ── What the person can act on ───────────────────────────────────────────
{
  const now = new Date('2026-09-16T12:00:00Z');
  const at = (over) => bucketWork(
    { status: 'InProgress', dueDate: null, blockers: 0, ...over }, now,
  );

  // The two that remove the reader's ability to act are tested FIRST in the
  // implementation, and that order is the rule being pinned.
  checks += 1;
  assert.strictEqual(
    at({ status: 'InProgress', dueDate: '2026-01-01', blockers: 2 }), 'Blocked',
    'a task that is overdue AND blocked belongs in Blocked. Sorting it as overdue sends '
    + 'somebody to work they cannot start, and counts it in a total that reads as an '
    + 'instruction.',
  );
  checks += 1;
  assert.strictEqual(
    at({ status: 'SubmittedForVerification', dueDate: '2026-01-01' }), 'WithReviewer',
    'and so does one that is overdue but sitting with a reviewer',
  );
  ok(at({ status: 'Blocked' }) === 'Blocked', 'the Blocked status alone is enough');

  ok(at({ status: 'Rejected', dueDate: '2027-01-01' }) === 'SentBack', 'rework is its own bucket');
  ok(at({ dueDate: '2026-01-01' }) === 'Overdue', 'past its date is overdue');
  ok(at({ dueDate: '2026-09-18' }) === 'DueSoon', 'within the week is due soon');
  ok(at({ dueDate: '2027-01-01' }) === 'Open', 'beyond the window is just open');
  ok(at({ dueDate: null }) === 'Open', 'no date is open, not overdue');
  ok(at({ status: 'Done' }) === 'Done', 'finished work is finished');
  ok(at({ status: 'Verified', dueDate: '2026-01-01' }) === 'Done', 'and so is confirmed work');

  // Due today is not yet late.
  checks += 1;
  assert.strictEqual(
    at({ dueDate: '2026-09-16' }), 'DueSoon',
    'a task due today is not overdue. Comparing instants rather than days would make it late '
    + 'from one minute past midnight.',
  );

  ok(DUE_SOON_DAYS === 7, 'the soon window is a week');
}

// ── The headline splits what it must not add together ────────────────────
{
  const s = summarise([
    'SentBack', 'Overdue', 'Overdue', 'DueSoon', 'Open',
    'WithReviewer', 'WithReviewer', 'Blocked', 'Done',
  ]);
  checks += 1;
  assert.strictEqual(
    s.needsYou, 5,
    'work the reader can act on is counted on its own',
  );
  checks += 1;
  assert.strictEqual(
    s.waitingOnOthers, 3,
    'and work whose next move belongs to somebody else is counted apart. "You have 8 open '
    + 'items" is useless when three of them are with a reviewer, and adding them together is '
    + 'the same kind of figure that reads as an instruction when it is not one.',
  );
  ok(s.byBucket.Done === 1, 'finished work is neither');

  const empty = summarise([]);
  checks += 1;
  assert.ok(
    empty.needsYou === 0 && WORK_BUCKETS.every((b) => empty.byBucket[b] === 0),
    'an empty list reports zeroes for every bucket rather than undefined',
  );

  // The order is the product decision.
  checks += 1;
  assert.deepStrictEqual(
    [...WORK_BUCKETS].sort((a, b) => bucketRank(a) - bucketRank(b)),
    ['SentBack', 'Overdue', 'DueSoon', 'Open', 'WithReviewer', 'Blocked', 'Done'],
    'the two buckets the reader cannot act on sit below the ones they can',
  );
}

// ── Assignment actually notifies ─────────────────────────────────────────
{
  ok(
    /from '\.\.\/services\/notificationService'/.test(plan),
    'the plan controller must import the notification service. It did not import it at all.',
  );
  checks += 1;
  assert.strictEqual(
    (plan.match(/tellAboutAssignment\(tx,/g) || []).length, 2,
    'both createTask and updateTask must tell the people whose work changed hands. updateTask '
    + 'IS the reassignment path, so covering only creation leaves handing work over silent.',
  );
  ok(
    /previousAssigneeId: existing\.assigneeId/.test(plan),
    'the reassignment call must pass the outgoing assignee, or only one end is told',
  );
  ok(
    /PROJECT_TASK_ASSIGNED/.test(plan) && /PROJECT_TASK_UNASSIGNED/.test(plan),
    'the two directions are different events',
  );

  // Inside the transaction, like every other notification in this codebase.
  const at = plan.indexOf('await tellAboutAssignment(tx,');
  const txAt = plan.lastIndexOf('prisma.$transaction', at);
  checks += 1;
  assert.ok(
    txAt > 0 && txAt < at,
    'the notification must be written inside the transaction that makes the change, or '
    + 'somebody is told about an assignment that rolled back',
  );
}

// ── The smaller holes in the same picture ────────────────────────────────
{
  checks += 1;
  assert.ok(
    /scope\.assigneeId/.test(imped),
    'a blocker raised against a task must reach the person holding it. blockTask told them and '
    + 'this path did not, so whether the person trying to do the work found out depended on '
    + 'which endpoint the blocker came in through.',
  );
  checks += 1;
  assert.ok(
    /blockedAssigneeId/.test(imped),
    'clearing a blocker must tell the assignee whose task just became workable. Only the '
    + 'raiser was told, so the person who had been unable to start learned nothing.',
  );
  checks += 1;
  assert.ok(
    /notify\(tx,/.test(member) && /PROJECT_MEMBER_ADDED/.test(member),
    'being staffed onto an engagement must tell the person staffed. They were expected to '
    + 'discover it by opening a project they had no reason to look at.',
  );
}

// ── My work: the endpoint that finally reads the index ───────────────────
{
  ok(/export const myWork/.test(plan), 'the cross-project view must be served');
  ok(
    /assigneeId: userId/.test(plan),
    'and must filter by the caller. This is the first query in the API to use '
    + 'ProjectTask @@index([assigneeId, status]), which had no reader at all.',
  );
  checks += 1;
  assert.ok(
    /projectWhere\(scope\)/.test(plan),
    'and must ALSO apply the caller\'s read scope. A task can be reassigned to somebody whose '
    + 'access to the engagement has since been withdrawn, and their own inbox must not become '
    + 'the back door to it.',
  );

  ok(routes.includes("router.get('/my-work', myWork);"), 'routed');
  const at = routes.indexOf("router.get('/my-work'");
  const wildcard = routes.indexOf("router.get('/:id', getProject);");
  checks += 1;
  assert.ok(
    at > 0 && wildcard > 0 && at < wildcard,
    'and registered before the \'/:id\' wildcard, which would otherwise match it and answer '
    + '"Project not found" for a literal path segment',
  );
}

// ── The inbox is reachable ───────────────────────────────────────────────
{
  for (const call of [
    '/api/notifications/unread-count',
    '/api/notifications',
    '/api/notifications/read-all',
  ]) {
    ok(bell.includes(call), `the bell must call ${call} — nothing in the frontend called any of them`);
  }
  ok(/\/read`/.test(bell), 'and must be able to mark one read');

  checks += 1;
  assert.ok(
    /\{unread > 0 && <i className="notification-dot"/.test(bell),
    'the dot must be lit only when there is something. It was rendered unconditionally, so '
    + 'every user saw a permanent red "you have mail" indicator on a button that opened '
    + 'nothing — which teaches people to ignore the one place the product has to tell them '
    + 'something.',
  );

  checks += 1;
  assert.ok(
    /<NotificationBell onNavigate=\{setCurrentPage\}/.test(shell),
    'the shell must mount the bell and let it navigate. The button it replaced had no onClick.',
  );
  checks += 1;
  assert.ok(
    !/id="notifyBtn" title="Notifications">/.test(shell),
    'and the decorative button must be gone, not merely hidden',
  );

  // The unread-sorts-last defect.
  checks += 1;
  assert.ok(
    /readAt: \{ sort: 'asc', nulls: 'first' \}/.test(notifCtrl),
    'unread notifications must sort first. This is Postgres, where ASC puts NULLs LAST and '
    + 'readAt is null exactly on the unread ones — so the intended ordering did the opposite, '
    + 'and with take: 100 somebody holding a hundred read notifications would have seen none '
    + 'of their unread ones at all.',
  );
}

// ── The screen exists and is reachable ───────────────────────────────────
{
  ok(myWorkScreen.includes('/api/projects/my-work'), 'the screen must call the endpoint');
  ok(/<MyWork/.test(shell), 'the shell must render it');
  ok(
    /currentPage === 'my-work'/.test(shell),
    'on its own page key',
  );
  checks += 1;
  assert.ok(
    (shell.match(/\['my-work', '✓', 'My Work'\]/g) || []).length >= 4,
    'and it must be in the sidebar of every portal that runs delivery projects, or the page '
    + 'exists and nobody can reach it',
  );

  // The screen must keep the grouping honest.
  checks += 1;
  assert.ok(
    /\['Needs you', summary\.needsYou\]/.test(myWorkScreen)
    && /\['Waiting on somebody else', summary\.waitingOnOthers\]/.test(myWorkScreen),
    'the headline must show the two totals apart, never one combined figure',
  );
  checks += 1;
  assert.ok(
    /r\.blockers\.map\(/.test(myWorkScreen),
    'a blocked row must name its blocker. "Blocked" with nothing beside it is the status '
    + 'everyone asks about and nobody can answer.',
  );
}

console.log(`work-notification: ${checks} assertions passed (pure rules, no database)`);
