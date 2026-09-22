/**
 * A legal hold is a matter, not a string on a document.
 *
 * A hold was four columns -- legalHoldMatter, legalHoldReason, legalHoldBy,
 * legalHoldAt -- and the matter was free text typed per document. Three things
 * followed:
 *
 *   One document could be held by ONE matter. applyLegalHold returns 409 when
 *   legalHoldAt is already set, so a document relevant to two investigations
 *   could be recorded against only one, and releasing that one unfroze it for
 *   the other.
 *
 *   There was no matter. "Ivanov v. Acme" typed on forty documents was forty
 *   strings; nobody could ask what a matter covered, and a typo on the
 *   fortieth silently made it a different matter.
 *
 *   Releasing destroyed the history. releaseLegalHold nulls all four columns,
 *   so a released document carried no trace of having been frozen -- and
 *   "were you ever held, for what, and between when and when" is the question
 *   asked at the END of a matter.
 *
 * And none of the three endpoints had a caller. The Legal Hold menu entry
 * rendered AuditLogViewer, the same component 'retention' and 'logs' rendered,
 * so it showed the raw hash-chained trail and nothing about holds.
 *
 *   node scripts/verify/legal-hold-test.js
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
const svcSrc = read(API, 'services', 'legalHold.ts');
const ctrl = code(read(API, 'controllers', 'legalHoldController.ts'));
const docCtrl = code(read(API, 'controllers', 'documentController.ts'));
const routes = read(API, 'routes', 'legalHoldRoutes.ts');
const app = read(API, 'app.ts');
const shell = code(read(WEB, 'pages', 'AppShell.tsx'));
const page = code(read(WEB, 'pages', 'documents', 'LegalHoldMatters.tsx'));
const deploy = read(WEB, '..', '.github', 'workflows', 'deploy.yml');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

const {
  planMatter, planHoldPlacement, planRelease, summariseMatter, heldForDays,
  stillFrozen, isLegacyHold, MAX_DOCUMENTS_PER_ACTION, MATTER_STATUSES,
} = require('../../dist/services/legalHold');

// ─── The rules run without a database ───────────────────────────────────────
{
  ok(
    !/from ['"]@prisma\/client['"]|require\(['"]@prisma/.test(svcSrc)
    && !/from ['"]\.\.\/db['"]/.test(svcSrc),
    'every refusal must be provable without Postgres',
  );
  assert.deepStrictEqual([...MATTER_STATUSES], ['Open', 'Released'], 'a matter is open or released');
  checks += 1;
}

// ─── The matter ─────────────────────────────────────────────────────────────
{
  const base = { reference: 'LIT-2026-004', title: 'Ivanov v. Acme', takenReferences: [] };

  const good = planMatter(base);
  ok(good.ok && good.reference === 'LIT-2026-004', 'a matter is accepted');
  eq(
    planMatter({ ...base, reference: 'lit-2026-004' }).reference, 'LIT-2026-004',
    'a reference is upper-cased, so two spellings cannot be two matters',
  );
  eq(planMatter({ ...base, reference: '' }).code, 'MATTER_REFERENCE_REQUIRED', 'a matter needs a reference');
  eq(planMatter({ ...base, title: 'no' }).code, 'MATTER_TITLE_REQUIRED', 'and a title somebody will recognise');
  eq(
    planMatter({ ...base, takenReferences: ['LIT-2026-004'] }).code, 'MATTER_REFERENCE_TAKEN',
    'two matters cannot share a reference — a hold would point at both',
  );
  eq(
    planMatter({ ...base, takenReferences: ['lit-2026-004'] }).code, 'MATTER_REFERENCE_TAKEN',
    'and the clash is case-insensitive, or the upper-casing above would create one',
  );
}

// ─── Placing holds ──────────────────────────────────────────────────────────
{
  const base = {
    matterStatus: 'Open',
    requested: ['d1', 'd2'],
    found: ['d1', 'd2'],
    activeForMatter: [],
    reason: 'Preserved for disclosure',
  };

  const good = planHoldPlacement(base);
  ok(good.ok, 'two documents are held');
  assert.deepStrictEqual(good.place, ['d1', 'd2'], 'both of them');
  checks += 1;

  eq(
    planHoldPlacement({ ...base, matterStatus: 'Released' }).code, 'MATTER_NOT_OPEN',
    'a released matter holds nothing new — it would record a hold nothing is enforcing',
  );
  eq(
    planHoldPlacement({ ...base, found: ['d1'] }).code, 'DOCUMENT_NOT_FOUND',
    'an id that does not resolve refuses the whole request. A hold that silently skipped '
    + 'what it could not find would leave somebody believing a document was frozen',
  );
  eq(planHoldPlacement({ ...base, requested: [] }).code, 'NOTHING_TO_HOLD', 'something must be named');
  eq(planHoldPlacement({ ...base, reason: 'no' }).code, 'HOLD_REASON_REQUIRED', 'and a reason given');

  const tooMany = Array.from({ length: MAX_DOCUMENTS_PER_ACTION + 1 }, (_, i) => `d${i}`);
  eq(
    planHoldPlacement({ ...base, requested: tooMany, found: tooMany }).code, 'TOO_MANY_DOCUMENTS',
    'a blast-radius limit: a hold freezes every document named against eight operations',
  );

  const repeat = planHoldPlacement({ ...base, activeForMatter: ['d1'] });
  assert.deepStrictEqual(repeat.place, ['d2'], 'a document already held by this matter is not held twice');
  checks += 1;
  assert.deepStrictEqual(repeat.alreadyHeld, ['d1'], 'and is reported rather than silently dropped');
  checks += 1;
  ok(repeat.warnings.length === 1, 'with a warning that says so');

  const noop = planHoldPlacement({ ...base, activeForMatter: ['d1', 'd2'] });
  ok(
    noop.ok && noop.place.length === 0 && /already held by this matter/.test(noop.warnings[0]),
    'and holding what is already held changes nothing, and says nothing changed',
  );

  const dupes = planHoldPlacement({ ...base, requested: ['d1', 'd1', 'd2'] });
  assert.deepStrictEqual(dupes.place, ['d1', 'd2'], 'asking twice is a client quirk, not an error');
  checks += 1;
}

// ─── Two matters, one document ──────────────────────────────────────────────
{
  ok(
    stillFrozen(1),
    'THE PACKET: a document held by two matters stays frozen when one of them is '
    + 'released. This is the whole reason a hold is a record rather than a flag',
  );
  ok(!stillFrozen(0), 'and thaws only when the last hold goes');

  ok(
    /const active = await tx\.legalHold\.count\(\{\s*where: \{ documentId, releasedAt: null \}/.test(ctrl),
    'the freeze flag is derived by COUNTING active holds, not set by whichever release '
    + 'happened to run last',
  );
  ok(
    /if \(!doc\?\.legalHoldAt\) \{/.test(ctrl),
    'and re-holding an already-frozen document must not move the date the freeze began',
  );
}

// ─── Releasing keeps the record ─────────────────────────────────────────────
{
  eq(planRelease({ activeHolds: 0, reason: 'Matter concluded' }).code, 'NOTHING_HELD', 'nothing to release');
  eq(planRelease({ activeHolds: 1, reason: 'no' }).code, 'RELEASE_REASON_REQUIRED', 'a release needs a reason');
  ok(planRelease({ activeHolds: 1, reason: 'Matter concluded' }).ok, 'and then it is allowed');

  const release = ctrl.slice(ctrl.indexOf('export const releaseHold'));
  ok(
    !/legalHold\.delete\(|legalHold\.deleteMany\(/.test(ctrl),
    'THE PACKET: releasing must NOT delete the hold row. releaseLegalHold nulled all four '
    + 'columns, so a released document carried no trace of having been frozen — and being '
    + 'able to show what was preserved, and for how long, is the point of a hold',
  );
  ok(
    /releasedAt: new Date\(\), releasedById: userId, releaseReason: plan\.reason/.test(release),
    'it stamps the row instead',
  );
  ok(
    /stillFrozen: stillHeld/.test(release),
    'and the audit entry records whether the document is actually free now, which is the '
    + 'part that matters operationally',
  );

  eq(
    heldForDays({ placedAt: '2026-01-01T09:00:00.000Z', releasedAt: '2026-01-31T18:00:00.000Z' }), 30,
    'how long a hold lasted, in whole days',
  );
  eq(
    heldForDays({ placedAt: '2026-01-01T00:00:00.000Z', releasedAt: null }), null,
    'and null while it is still in force, rather than zero',
  );
}

// ─── Reporting ──────────────────────────────────────────────────────────────
{
  const s = summariseMatter([
    { releasedAt: null }, { releasedAt: null }, { releasedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  eq(s.documentsHeld, 2, 'two still held');
  eq(s.documentsReleased, 1, 'one released');
  eq(s.total, 3, 'three in all');
  eq(s.neverHeldAnything, false, 'and this matter has held things');

  eq(
    summariseMatter([]).neverHeldAnything, true,
    'a matter that never held anything and a matter whose holds are all released are '
    + 'different things, and only the first is somebody forgetting to add the documents',
  );
}

// ─── The hold placed before matters existed ─────────────────────────────────
{
  ok(
    isLegacyHold({ legalHoldAt: '2026-01-01T00:00:00.000Z', activeHoldCount: 0 }),
    'a document frozen by the old four-column hold has no matter behind it',
  );
  ok(
    !isLegacyHold({ legalHoldAt: '2026-01-01T00:00:00.000Z', activeHoldCount: 1 }),
    'one held through a matter is not legacy',
  );
  ok(
    !isLegacyHold({ legalHoldAt: null, activeHoldCount: 0 }),
    'and an unfrozen document is not a hold at all',
  );
  ok(
    /legacyHolds:/.test(ctrl) && /legacy document(s)? (is|are) frozen|frozen by a hold/.test(page),
    'legacy holds must be SURFACED. They stay frozen — taking the freeze off records '
    + 'somebody deliberately froze would be the worst reading of this change — but nothing '
    + 'listed them, so they would sit in a state no screen showed',
  );
}

// ─── The eight enforcement sites still work ─────────────────────────────────
{
  const sites = (docCtrl.match(/isFrozenByLegalHold\(doc\)/g) || []).length;
  ok(
    sites >= 8,
    'the frozen flag must still be what refuses an operation. Eight handlers read it — '
    + 'update, checkout, checkin, submit, approve, publish, archive, delete — and rewriting '
    + `them to consult a join table would risk eight enforcement sites to gain nothing (found ${sites})`,
  );
  ok(
    /legalHoldAt\s+DateTime\?/.test(schema),
    'so the column stays',
  );
  ok(
    /const everHeld = await prisma\.legalHold\.count\(\{ where: \{ documentId: id \} \}\)/.test(docCtrl),
    'and deleting a document that has hold history must be refused with something a person '
    + 'can act on, not surface as a foreign-key error reading "Failed to delete document"',
  );
}

// ─── The table keeps the history ────────────────────────────────────────────
{
  const model = schema.slice(schema.indexOf('model LegalHold {'));
  const body = model.slice(0, model.indexOf('\n}'));

  ok(
    /onDelete: Restrict/.test(body),
    'a hold record must not vanish with its document. Cascade would lose the evidence that '
    + 'the document had been preserved',
  );
  ok(
    /@@unique\(\[matterId, documentId\]\)/.test(body),
    'a matter holds a document once, so re-holding reopens the row rather than starting a '
    + 'second thread of history for the same pair',
  );
  ok(
    /@@index\(\[documentId, releasedAt\]\)/.test(body),
    '"is this document still held by anything" is asked on every release and must be indexed',
  );
  ok(
    /releasedAt\s+DateTime\?/.test(body) && /releaseReason String\?/.test(body),
    'and the row records when it ended and why',
  );

  const matter = schema.slice(schema.indexOf('model LegalMatter {'));
  ok(
    /@@unique\(\[tenantId, reference\]\)/.test(matter.slice(0, matter.indexOf('\n}'))),
    'one reference per organisation',
  );
}

// ─── Wiring ─────────────────────────────────────────────────────────────────
{
  ok(/app\.use\('\/api\/legal', legalHoldRoutes\)/.test(app), 'the router is mounted');
  ok(
    /router\.post\('\/matters', requireCapability\(CAP\.RETENTION_HOLD\)/.test(routes)
    && /router\.post\('\/matters\/:id\/holds', requireCapability\(CAP\.RETENTION_HOLD\)/.test(routes)
    && /router\.post\('\/matters\/:id\/release', requireCapability\(CAP\.RETENTION_HOLD\)/.test(routes)
    && /router\.post\('\/holds\/:holdId\/release', requireCapability\(CAP\.RETENTION_HOLD\)/.test(routes),
    'opening, holding and releasing all carry the retention capability',
  );
  ok(
    /router\.get\('\/documents\/:id\/holds', documentHolds\)/.test(routes),
    'and reading what holds a document is open — somebody who cannot edit a policy should '
    + 'be told it is held and for what, rather than left with a 423 and no explanation',
  );

  // Literals before the wildcard, or '/documents' and '/holds' are read as ids.
  ok(
    routes.indexOf("'/documents/:id/holds'") < routes.indexOf("'/matters/:id'"),
    "literal segments before '/:id' or the wildcard answers for them",
  );
}

// ─── The screen ─────────────────────────────────────────────────────────────
{
  ok(
    /currentPage === 'legal-hold'\) \{[\s\S]{0,140}?<LegalHoldMatters/.test(shell),
    "'legal-hold' must render its own page",
  );
  {
    const at = shell.indexOf('<AuditLogViewer');
    const branch = shell.slice(shell.lastIndexOf('if (', at), at);
    ok(
      !/'legal-hold'/.test(branch),
      'and must not still show the raw audit trail, which said nothing about holds',
    );
  }
  ok(
    /No matter has been opened/.test(page),
    'a tenant with no matter must be told what a matter is for, not shown an empty list',
  );
  ok(
    /This matter holds nothing yet/.test(page),
    'and a matter holding nothing must say so — an empty list reads as a load failure',
  );
  ok(
    /Released<\/span>|'Released'/.test(page),
    'released holds must be shown, not hidden. The record of having been held is the thing '
    + 'releasing used to destroy',
  );
  ok(
    /<Can do=\{MAY\.DISPOSE_RECORD\}>[\s\S]{0,700}?Release\s*<\/button>/.test(page),
    'and releasing must be gated in the UI as well as on the route',
  );

  ok(
    /legal-hold-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next packet can delete',
  );
}

// ─── The migration adds, and does not take away ─────────────────────────────
{
  const dir = path.join(API, '..', 'prisma', 'migrations', '20260922010000_legal_matters');
  const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8');
  ok(/CREATE TABLE "LegalMatter"/.test(sql) && /CREATE TABLE "LegalHold"/.test(sql), 'both tables are created');
  ok(
    !/DROP |ALTER COLUMN|TRUNCATE/i.test(sql),
    'and nothing is dropped or narrowed — the four legalHold columns stay, because eight '
    + 'handlers read one of them',
  );
  ok(
    /ON DELETE RESTRICT/.test(sql),
    'with the hold record protected from its own document being removed',
  );
}

console.log(
  `legal-hold: ${checks} assertions passed `
  + `(statuses ${MATTER_STATUSES.join('/')}; cap ${MAX_DOCUMENTS_PER_ACTION} documents per action)`,
);
