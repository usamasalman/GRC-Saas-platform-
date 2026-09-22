/**
 * Records are kept to a schedule, and destroyed to one.
 *
 * The Governance menu has offered "Retention Schedules" since the beginning
 * and the entry rendered AuditLogViewer -- the same component 'legal-hold' and
 * 'logs' rendered, so three menu items were one page. There was no model, no
 * column, no route and nothing that computed a disposal date.
 *
 * The promise was made in four other places. platformCatalogue ships the
 * document module with `config: { autoArchiveDays: 365, defaultRetentionYears: 7 }`
 * and nothing anywhere read either number. The System Health screen reported
 * a job called "Evidence Expiry & Retention Reminder Worker" as Idle, type
 * "Cron (Daily 06:00)", with a last run eight hours ago and a duration of
 * 890ms -- for a worker that did not exist. An operator asking whether
 * retention was running was told it ran at six that morning. And an unreachable
 * mock of this very screen sat in appMockEngine quoting 18 schedules and 37
 * documents in the disposition queue.
 *
 * Two holes in the existing legal hold were found while building this and are
 * covered here: a held document could still be approved and published, because
 * isFrozenByLegalHold guarded update, checkout, checkin, submit, archive and
 * delete, and those two were missed.
 *
 *   node scripts/verify/retention-test.js
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
const svcSrc = read(API, 'services', 'retention.ts');
const ctrl = code(read(API, 'controllers', 'retentionController.ts'));
const docCtrl = code(read(API, 'controllers', 'documentController.ts'));
// Comment-stripped: the removal is explained in a comment that names the job,
// and it is the CODE that must no longer contain it.
const sysCtrl = code(read(API, 'controllers', 'systemController.ts'));
const routes = read(API, 'routes', 'retentionRoutes.ts');
const app = read(API, 'app.ts');
const shell = code(read(WEB, 'pages', 'AppShell.tsx'));
const page = code(read(WEB, 'pages', 'documents', 'RetentionSchedules.tsx'));
const deploy = read(WEB, '..', '.github', 'workflows', 'deploy.yml');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

const {
  planSchedule, planDisposal, dispositionState, daysUntilDisposal,
  summariseDisposition, disposalDateFor, triggerMomentFor, addMonthsUtc, utcDay,
  RETENTION_TRIGGERS, DEFAULT_RETAIN_MONTHS, DEFAULT_REVIEW_WINDOW_DAYS,
  MIN_RETAIN_MONTHS, MAX_RETAIN_MONTHS, DISPOSITION_STATES, inDispositionQueue,
} = require('../../dist/services/retention');

const NOW = new Date('2026-06-15T12:00:00.000Z');
const held = (over) => Object.assign({
  disposalDueAt: null,
  legalHoldAt: null,
  disposedAt: null,
  reviewWindowDays: 30,
}, over);

// ─── The rules run without a database ───────────────────────────────────────
{
  ok(
    !/from ['"]@prisma\/client['"]|require\(['"]@prisma/.test(svcSrc)
    && !/from ['"]\.\.\/db['"]/.test(svcSrc),
    'every refusal must be provable without Postgres',
  );
}

// ─── Months, in the UTC frame, clamped ──────────────────────────────────────
{
  eq(
    addMonthsUtc('2026-01-31T00:00:00.000Z', 1).toISOString().slice(0, 10), '2026-02-28',
    '31 January plus one month is 28 February, not 3 March. The three existing '
    + 'setMonth helpers in this codebase roll over, which silently moves a '
    + 'disposal date into the following month for any record whose clock started '
    + 'on the 29th, 30th or 31st',
  );
  eq(
    addMonthsUtc('2024-01-31T00:00:00.000Z', 1).toISOString().slice(0, 10), '2024-02-29',
    'and 29 February in a leap year',
  );
  eq(
    addMonthsUtc('2026-01-15T00:00:00.000Z', 84).toISOString().slice(0, 10), '2033-01-15',
    'seven years is eighty-four months',
  );
  eq(
    addMonthsUtc('2026-12-31T00:00:00.000Z', 2).toISOString().slice(0, 10), '2027-02-28',
    'and it crosses a year boundary without drifting',
  );

  // The house rule, and the thing three other services get wrong.
  const fn = code(svcSrc).slice(code(svcSrc).indexOf('export function addMonthsUtc'));
  ok(
    !/\.getFullYear\(\)|\.getMonth\(\)|\.getDate\(\)/.test(fn.slice(0, fn.indexOf('\n}'))),
    'the month arithmetic must use UTC accessors only. A local-frame helper gives '
    + "a different disposal date depending on the server's timezone",
  );

  eq(
    utcDay('2026-06-15T23:59:59.999Z'), utcDay('2026-06-15T00:00:00.000Z'),
    'a day is a day whatever time of it a record was touched',
  );
}

// ─── A disposal date, or honestly none ──────────────────────────────────────
{
  eq(
    disposalDateFor('2026-01-15T00:00:00.000Z', 24).toISOString().slice(0, 10), '2028-01-15',
    'THE PACKET: a two-year schedule falls due two years on',
  );
  eq(
    disposalDateFor(null, 84), null,
    'a schedule whose trigger has not fired yet produces NO date. Saying "now plus '
    + 'seven years" would put a destruction date on a record whose retention has not begun',
  );
  eq(disposalDateFor('2026-01-15T00:00:00.000Z', 0), null, 'and a zero period produces none');
  eq(disposalDateFor('not a date', 24), null, 'and so does a value that is not a date');

  assert.deepStrictEqual(
    [...RETENTION_TRIGGERS], ['Published', 'Archived', 'Created'],
    'what can start the clock',
  );
  checks += 1;

  eq(
    triggerMomentFor('Published', { publishedAt: 'P', archivedAt: 'A', createdAt: 'C' }), 'P',
    'a Published schedule counts from publication',
  );
  eq(
    triggerMomentFor('Archived', { publishedAt: 'P', archivedAt: 'A', createdAt: 'C' }), 'A',
    'an Archived schedule from archiving',
  );
  eq(
    triggerMomentFor('Published', { publishedAt: null, createdAt: 'C' }), null,
    'and an unpublished document on a Published schedule has no moment at all — it '
    + 'must NOT fall back to creation, which would date a record by when somebody '
    + 'started typing it',
  );
  ok(
    /archivedAt\s+DateTime\?/.test(schema),
    'archiving must record its moment. It wrote only status ARCHIVED, so an Archived '
    + 'schedule had nothing to count from',
  );
  ok(
    /status: 'ARCHIVED', archivedAt: new Date\(\)/.test(docCtrl),
    'and the handler must write it',
  );
}

// ─── Held beats due ─────────────────────────────────────────────────────────
{
  const overdue = { disposalDueAt: '2020-01-01T00:00:00.000Z' };

  eq(
    dispositionState(held(overdue), NOW), 'Due',
    'a document past its date is due',
  );
  eq(
    dispositionState(held({ ...overdue, legalHoldAt: '2026-01-01T00:00:00.000Z' }), NOW), 'Held',
    'THE PACKET: a document under legal hold is HELD, not DUE, however far past its '
    + 'date it is. Showing it as due would put it in a queue whose whole purpose is '
    + 'to be worked through, and the one thing that must not happen to it is disposal',
  );
  eq(
    dispositionState(held({ ...overdue, disposedAt: '2026-02-02T00:00:00.000Z' }), NOW), 'Disposed',
    'and one already disposed of is not offered again',
  );
  eq(
    dispositionState(held({}), NOW), 'NotScheduled',
    'a document on no schedule says so rather than reading as "not due yet"',
  );

  eq(
    dispositionState(held({ disposalDueAt: '2026-06-30T00:00:00.000Z' }), NOW), 'DueSoon',
    'fifteen days out, inside a thirty-day window, is due soon',
  );
  eq(
    dispositionState(held({ disposalDueAt: '2026-08-30T00:00:00.000Z' }), NOW), 'NotDue',
    'and beyond the window it is not',
  );
  eq(
    dispositionState(held({ disposalDueAt: '2026-06-30T00:00:00.000Z', reviewWindowDays: 3 }), NOW),
    'NotDue',
    'the window is the schedule\'s own, not a constant',
  );
  eq(
    dispositionState(held({ disposalDueAt: '2026-06-15T09:00:00.000Z' }), NOW), 'Due',
    'due today is due, whatever time of day the date carries — a disposal date is a '
    + 'calendar date, not an instant',
  );

  eq(daysUntilDisposal(held({ disposalDueAt: '2026-06-25T00:00:00.000Z' }), NOW), 10, 'ten days out');
  eq(
    daysUntilDisposal(held({ disposalDueAt: '2026-06-05T00:00:00.000Z' }), NOW), -10,
    'and ten days overdue is negative, not zero',
  );
  eq(daysUntilDisposal(held({}), NOW), null, 'an unscheduled document has no countdown');

  ok(
    inDispositionQueue('Due') && inDispositionQueue('DueSoon'),
    'the queue is what needs a decision',
  );
  ok(
    !inDispositionQueue('Held') && !inDispositionQueue('NotDue')
    && !inDispositionQueue('Disposed') && !inDispositionQueue('NotScheduled'),
    'and nothing else',
  );
  ok(DISPOSITION_STATES.indexOf('Held') === 0, 'Held is checked first');
}

// ─── A schedule an organisation can be held to ──────────────────────────────
{
  const base = { code: 'RET-7Y', name: 'Policy records', retainMonths: 84, trigger: 'Published', takenCodes: [] };

  const good = planSchedule(base);
  ok(good.ok && good.retainMonths === 84, 'a seven-year schedule is accepted');
  eq(good.reviewWindowDays, DEFAULT_REVIEW_WINDOW_DAYS, 'and gets the default review window');
  eq(
    planSchedule({ ...base, code: 'ret-7y' }).code, 'RET-7Y',
    'a code is upper-cased, so RET-7Y and ret-7y cannot both exist and be told apart by eye',
  );

  eq(
    planSchedule({ ...base, retainMonths: 0 }).code, 'RETAIN_TOO_SHORT',
    'a zero-month schedule would make a document disposable the moment it was published',
  );
  eq(planSchedule({ ...base, retainMonths: 1.5 }).code, 'BAD_RETAIN_MONTHS', 'a period is whole months');
  eq(
    planSchedule({ ...base, retainMonths: MAX_RETAIN_MONTHS + 1 }).code, 'RETAIN_TOO_LONG',
    'and beyond a hundred years the number means "never", which is a decision to record '
    + 'rather than a schedule',
  );
  eq(planSchedule({ ...base, trigger: 'Whenever' }).code, 'BAD_TRIGGER', 'the trigger is one of three');
  eq(planSchedule({ ...base, code: '' }).code, 'SCHEDULE_CODE_REQUIRED', 'a schedule needs a code');
  eq(planSchedule({ ...base, name: '  ' }).code, 'SCHEDULE_NAME_REQUIRED', 'and a name');
  eq(
    planSchedule({ ...base, takenCodes: ['RET-7Y'] }).code, 'SCHEDULE_CODE_TAKEN',
    'two schedules with one code cannot be told apart in a disposal record',
  );
  eq(
    planSchedule({ ...base, takenCodes: ['ret-7y'] }).code, 'SCHEDULE_CODE_TAKEN',
    'and the clash is case-insensitive, or the upper-casing above would create one',
  );
  eq(
    planSchedule({ ...base, reviewWindowDays: 900 }).code, 'BAD_REVIEW_WINDOW',
    'the review window is bounded',
  );
  eq(
    DEFAULT_RETAIN_MONTHS, 84,
    'the default is the number the platform already advertised: platformCatalogue ships '
    + 'the document module with defaultRetentionYears: 7 and nothing read it',
  );
}

// ─── Disposal ───────────────────────────────────────────────────────────────
{
  const due = { disposalDueAt: '2020-01-01T00:00:00.000Z' };
  const args = { reason: 'Retention period elapsed', now: NOW, mayDispose: true };

  ok(planDisposal({ doc: held(due), ...args }).ok, 'a document past its date may be destroyed');

  const onHold = planDisposal({
    doc: held({ ...due, legalHoldAt: '2026-01-01T00:00:00.000Z' }),
    ...args,
  });
  eq(
    onHold.code, 'DOCUMENT_ON_LEGAL_HOLD',
    'THE PACKET: a document under legal hold cannot be disposed of, however overdue',
  );
  eq(
    onHold.status, 423,
    'and it refuses with 423, the status this codebase already returns for a frozen '
    + 'document, rather than a second way of saying the same thing',
  );

  // The hold check must come before everything, including the capability.
  eq(
    planDisposal({
      doc: held({ ...due, legalHoldAt: '2026-01-01T00:00:00.000Z' }),
      ...args,
      mayDispose: false,
    }).code,
    'DOCUMENT_ON_LEGAL_HOLD',
    'the hold is checked FIRST. It is the one refusal that exists to survive somebody '
    + 'being certain they want to proceed',
  );

  eq(
    planDisposal({ doc: held(due), ...args, mayDispose: false }).code, 'DISPOSAL_NOT_PERMITTED',
    'destroying a record needs the capability',
  );
  eq(
    planDisposal({ doc: held({}), ...args }).code, 'NO_SCHEDULE',
    'nothing may be destroyed without a rule saying when — the disposal record has to '
    + 'name what it was carried out under',
  );
  eq(
    planDisposal({ doc: held({ disposalDueAt: '2030-01-01T00:00:00.000Z' }), ...args }).code,
    'NOT_YET_DUE',
    'destroying a record ahead of its schedule is the same failure as keeping one past it',
  );
  eq(
    planDisposal({ doc: held({ ...due, disposedAt: '2026-01-01T00:00:00.000Z' }), ...args }).code,
    'ALREADY_DISPOSED',
    'and it does not happen twice',
  );
  eq(
    planDisposal({ doc: held(due), ...args, reason: 'ok' }).code, 'DISPOSAL_REASON_REQUIRED',
    'the reason IS the disposal record',
  );
}

// ─── The queue counts what it says ──────────────────────────────────────────
{
  const docs = [
    held({ disposalDueAt: '2020-01-01T00:00:00.000Z' }),
    held({ disposalDueAt: '2020-01-01T00:00:00.000Z' }),
    held({ disposalDueAt: '2026-06-20T00:00:00.000Z' }),
    held({ disposalDueAt: '2020-01-01T00:00:00.000Z', legalHoldAt: '2026-01-01T00:00:00.000Z' }),
    held({}),
    held({ disposalDueAt: '2020-01-01T00:00:00.000Z', disposedAt: '2026-01-01T00:00:00.000Z' }),
  ];
  const s = summariseDisposition(docs, NOW, 2);
  eq(s.due, 2, 'two due');
  eq(s.dueSoon, 1, 'one due soon');
  eq(s.held, 1, 'one held');
  eq(s.notScheduled, 1, 'one on no schedule');
  eq(s.disposed, 1, 'one already disposed');
  eq(s.noSchedulesDefined, false, 'and this organisation has schedules');

  eq(
    summariseDisposition([], NOW, 0).noSchedulesDefined, true,
    'a tenant with no schedules and a tenant whose schedules are all satisfied both show '
    + 'an empty queue, and only one of them has retention. It must be said, not left to a zero',
  );
}

// ─── Wiring ─────────────────────────────────────────────────────────────────
{
  ok(/app\.use\('\/api\/retention', retentionRoutes\)/.test(app), 'the router is mounted');
  ok(/router\.get\('\/schedules', listSchedules\)/.test(routes), 'schedules are readable');
  ok(
    /router\.post\('\/schedules', requireCapability\(CAP\.RETENTION_HOLD\)/.test(routes)
    && /router\.put\('\/schedules\/:id', requireCapability\(CAP\.RETENTION_HOLD\)/.test(routes),
    'and only the retention capability changes one',
  );
  ok(
    /router\.post\('\/documents\/:id\/dispose', requireCapability\(CAP\.RETENTION_HOLD\), disposeDocument\)/.test(routes),
    'disposal is guarded on the route',
  );
  ok(
    /const mayDispose = await hasCapability\(userId, CAP\.RETENTION_HOLD\)/.test(ctrl),
    'and in the handler as well. A rule that exists only as a route guard cannot be '
    + 'tested without standing up Express, and the pure refusal would be dead code',
  );
  ok(
    /router\.put\('\/documents\/:id\/schedule', requireCapability\(CAP\.RETENTION_HOLD\)/.test(routes),
    'binding a schedule carries the same grant as disposal — setting a one-month schedule '
    + 'is the same decision as disposing of the record next month',
  );

  const literals = routes.indexOf("'/schedules'");
  const wildcard = routes.indexOf("'/schedules/:id'");
  ok(literals < wildcard, "literal segments before '/:id' or the wildcard answers for them");
}

// ─── The clock actually starts ──────────────────────────────────────────────
{
  ok(
    /await recomputeDisposalDue\(tx as any, id\)/.test(docCtrl),
    'publishing and archiving must recompute the disposal date',
  );
  const occurrences = (docCtrl.match(/recomputeDisposalDue\(/g) || []).length;
  ok(
    occurrences >= 2,
    'BOTH of them. A disposal date written only when a schedule is bound would be wrong '
    + `for every document whose trigger fired afterwards (found ${occurrences})`,
  );
  ok(
    /const bound = await tx\.document\.findMany\(\{\s*where: \{ retentionScheduleId: id \}/.test(ctrl),
    'and changing a period must move the dates that derive from it, or the schedule says '
    + 'one thing and the queue another — and the queue is what somebody acts on',
  );
}

// ─── Disposal keeps the record ──────────────────────────────────────────────
{
  const dispose = ctrl.slice(ctrl.indexOf('export const disposeDocument'));
  ok(
    !/\.delete\(|deleteMany\(/.test(dispose),
    'disposal must NOT delete the row. Seven foreign keys cascade off Document — '
    + 'approvals and signatures, acknowledgements, acknowledgement requests, versions, '
    + 'version editors, read history and links — so deleting it would destroy the '
    + 'evidence that the document existed, was approved and was read, which is the '
    + 'opposite of disposing of a record',
  );
  ok(
    /content: ''/.test(dispose) && /fileUrl: null/.test(dispose),
    'it destroys the content',
  );
  ok(
    /fs\.unlinkSync\(/.test(dispose),
    'and the stored file. A disposal that leaves the bytes on disk is a disposal that '
    + 'did not happen',
  );
  ok(
    dispose.indexOf('fs.unlinkSync(') > dispose.indexOf('writeAudit('),
    'the file goes AFTER the audit entry commits. A filesystem delete cannot be rolled '
    + 'back, and bytes gone with no record of who authorised it is the unrecoverable order',
  );
  ok(
    /warning: doc\.fileUrl && !fileRemoved/.test(dispose),
    'and a file that could not be removed is reported, not swallowed',
  );
  ok(
    /action: 'DOCUMENT_DISPOSED'/.test(dispose) && /scheduleCode:/.test(dispose),
    'the audit entry names the schedule it was carried out under',
  );
  ok(
    /disposedAt\s+DateTime\?/.test(schema) && /disposalReason\s+String\?/.test(schema),
    'and the row keeps what proves the disposal was authorised',
  );
}

// ─── The two holes in the existing legal hold ───────────────────────────────
{
  for (const handler of ['approveDocument', 'publishDocument']) {
    const at = docCtrl.indexOf(`export const ${handler}`);
    checks += 1;
    assert.ok(at >= 0, `${handler} must exist`);
    const body = docCtrl.slice(at, at + 3000);
    checks += 1;
    assert.ok(
      /isFrozenByLegalHold\(doc\)/.test(body),
      `${handler} must refuse a document under legal hold. The predicate guarded update, `
      + 'checkout, checkin, submit, archive and delete, and this one was missed — so a '
      + 'document frozen as evidence in a matter could be signed off and issued to an '
      + 'audience with notifications, which is the opposite of frozen',
    );
  }
}

// ─── The screen, and the promises that had nothing behind them ──────────────
{
  ok(
    /currentPage === 'retention'\) \{[\s\S]{0,120}?<RetentionSchedules/.test(shell),
    "'retention' must render its own page. It rendered AuditLogViewer, so Retention "
    + 'Schedules, Legal Hold and Immutable Audit Log were three menu entries showing one page',
  );
  {
    // The condition that selects AuditLogViewer, not merely the text near it:
    // the retention branch sits directly above it, so any proximity test
    // matches whether or not the bug is present.
    const at = shell.indexOf('<AuditLogViewer');
    const branch = shell.slice(shell.lastIndexOf('if (', at), at);
    ok(
      !/'retention'/.test(branch),
      'and must not still fall through to the audit log',
    );
  }

  ok(
    /This organisation has no retention schedule/.test(page),
    'a tenant with no schedule must be told that, not shown an empty list',
  );
  ok(
    /An empty queue here does not mean everything is up to date/.test(page),
    'and an empty queue must distinguish "nothing is due" from "nothing is scheduled". '
    + 'Testing only that the flag is referenced passes however the sentence is reworded, '
    + 'and the sentence is the whole point',
  );
  ok(
    /will never appear here/.test(page),
    'and must say how many documents are on no schedule at all, since those never reach '
    + 'the queue however long they are kept',
  );
  ok(
    /Held, and not disposable/.test(page),
    'a held document must be visible as held rather than simply absent, or the reason '
    + 'disposal cannot proceed is invisible',
  );
  ok(
    /<Can do=\{MAY\.DISPOSE_RECORD\}>[\s\S]{0,400}?Dispose\s*<\/button>/.test(page),
    'and the Dispose button specifically must be inside the capability gate. The page '
    + 'names MAY.DISPOSE_RECORD for its New schedule and Edit buttons too, so merely '
    + 'finding the constant proves nothing about the one that destroys a record',
  );

  ok(
    !/Evidence Expiry & Retention Reminder Worker/.test(sysCtrl),
    'the System Health screen must not report a retention worker that does not exist. It '
    + 'said Idle, last run eight hours ago, 890ms — for a job nothing performs. An '
    + 'operator asking whether retention was running was told it ran at six that morning',
  );

  ok(
    /retention-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next packet can delete',
  );
}

// ─── The migration adds, and does not take away ─────────────────────────────
{
  const dir = path.join(API, '..', 'prisma', 'migrations', '20260922000000_retention_schedules');
  const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8');
  ok(/CREATE TABLE "RetentionSchedule"/.test(sql), 'the schedule table is created');
  ok(
    !/DROP |ALTER COLUMN|TRUNCATE/i.test(sql),
    'and nothing is dropped or narrowed. This runs against live tenants',
  );
  ok(
    /CREATE UNIQUE INDEX "RetentionSchedule_tenantId_code_key"/.test(sql),
    'one code per organisation, or a disposal record naming RET-7Y has two schedules it '
    + 'could mean',
  );
  ok(
    /CREATE INDEX "Document_tenantId_disposalDueAt_idx"/.test(sql),
    'and the queue is an indexed query rather than a scan of every document in the tenant',
  );
  ok(
    /@@index\(\[tenantId, disposalDueAt\]\)/.test(schema),
    'and the schema must still declare it. Asserting only on the migration lets somebody '
    + 'drop it from schema.prisma while the old SQL keeps the test green',
  );
  ok(
    /@@unique\(\[tenantId, code\]\)/.test(
      schema.slice(schema.indexOf('model RetentionSchedule {'), schema.indexOf('model RetentionSchedule {') + 2200),
    ),
    'and the one-code-per-organisation rule must be on THIS model, not merely somewhere '
    + 'in the file — two other models carry the same constraint',
  );
}

console.log(
  `retention: ${checks} assertions passed `
  + `(triggers ${RETENTION_TRIGGERS.join('/')}; default ${DEFAULT_RETAIN_MONTHS} months; `
  + `bounds ${MIN_RETAIN_MONTHS}-${MAX_RETAIN_MONTHS})`,
);
