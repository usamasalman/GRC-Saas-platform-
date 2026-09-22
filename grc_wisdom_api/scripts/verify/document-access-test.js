/**
 * A marked document is invisible to people it was not for, and the read is on
 * the record.
 *
 * `Document.classification` held one of four words on every row and nothing
 * anywhere branched on it. In listDocuments it was a caller-supplied FILTER --
 * `if (classification) where.classification = classification` -- so
 * ?classification=Restricted SELECTED the restricted documents rather than
 * withholding them. getDocument and downloadDocument had `{ id, tenantId }` as
 * their entire access decision, so any tenant member could open any document
 * by id: a Restricted policy, or somebody else's unapproved draft, together
 * with every acknowledger's name and email. downloadDocument stamped
 * "Classification : Restricted" into the banner of a file it handed to anyone
 * who asked, above a footer reading "CONFIDENTIAL GRC RECORD".
 *
 * Nor was any of it written down. Of the 222 writeAudit calls in the API, four
 * are read-shaped and none is a document; getDocument and downloadDocument
 * open no transaction at all. "Who has read this Restricted policy" had no
 * query behind it -- not a slow one, none. The acknowledgement tables answer a
 * different question: who was ASKED to sign, and who SAID they had read it,
 * for the published audience only.
 *
 * Two holes in the same class were found while closing this one and are
 * covered here: governingDocuments answered "which policies govern this
 * control" with every linked document's code and title, and getDocumentStats
 * counted the whole tenant, so the tile would have read 12 above a list
 * showing five -- and the difference would have said how many Restricted
 * documents exist.
 *
 *   node scripts/verify/document-access-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/** Comments are prose. Only what runs counts. */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const schema = read(API, '..', 'prisma', 'schema.prisma');
const svcSrc = read(API, 'services', 'documentAccess.ts');
const guardSrc = code(read(API, 'services', 'documentReadGuard.ts'));
const ctrl = code(read(API, 'controllers', 'documentController.ts'));
const linkCtrl = code(read(API, 'controllers', 'documentLinkController.ts'));
const routes = read(API, 'routes', 'documentRoutes.ts');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

const {
  readDecision, classificationRank, accessDay, summariseAccess, openAudienceGap,
  recordingIsMandatory, chainWorthy, CLASSIFICATIONS, NEED_TO_KNOW_FROM,
  READ_EVERYTHING, ACCESS_ACTION, UNISSUED_STATUSES,
} = require('../../dist/services/documentAccess');
const { REPORT_MARKINGS } = require('../../dist/services/tenantBranding');

const GOVERNS = READ_EVERYTHING;
const member = { id: 'u-stranger', tenantId: 't1', capabilities: [] };
const owner = { id: 'u-owner', tenantId: 't1', capabilities: [] };
const approver = { id: 'u-approver', tenantId: 't1', capabilities: [] };
const records = { id: 'u-records', tenantId: 't1', capabilities: [GOVERNS] };
const author = { id: 'u-author', tenantId: 't1', capabilities: ['create-import-and-version-a-document'] };
const outsider = { id: 'u-other', tenantId: 't2', capabilities: [GOVERNS] };

const doc = (over) => Object.assign({
  id: 'd1',
  tenantId: 't1',
  ownerId: 'u-owner',
  status: 'PUBLISHED',
  classification: 'Internal',
  approverIds: ['u-approver'],
  inAudience: false,
  audienceKind: 'Everyone',
}, over);

// ─── The ordering is the one that already existed ───────────────────────────
{
  assert.deepStrictEqual(
    [...CLASSIFICATIONS], [...REPORT_MARKINGS],
    'the four words must be the SAME list tenantBranding already ranks. A second '
    + 'ordering would be the third in this codebase and the first to disagree with the others',
  );
  checks += 1;

  ok(
    classificationRank('Public') < classificationRank('Internal')
    && classificationRank('Internal') < classificationRank('Confidential')
    && classificationRank('Confidential') < classificationRank('Restricted'),
    'Public < Internal < Confidential < Restricted',
  );
  eq(NEED_TO_KNOW_FROM, 'Confidential', 'need-to-know begins at Confidential');
  ok(
    !/\bfrom ['"]@prisma\/client['"]|require\(['"]@prisma/.test(svcSrc)
    && !/from ['"]\.\.\/db['"]/.test(svcSrc),
    'the decision must run without a database, so every refusal is provable without one',
  );
  ok(
    /from '\.\/tenantBranding'/.test(svcSrc),
    'and must take its ordering from the module that already has one',
  );

  // An unrecognised word is not a hole. classification is a bare String with
  // no database default and nothing validates it.
  eq(
    classificationRank('Secret'), classificationRank('Confidential'),
    'an unknown marking must land at Confidential — "somebody must be named" — '
    + 'so a typo cannot publish a document to the whole organisation',
  );
  eq(classificationRank(null), classificationRank('Confidential'), 'and so must an absent one');
  eq(classificationRank(''), classificationRank('Confidential'), 'and an empty one');
}

// ─── Who gets in, and on what basis ─────────────────────────────────────────
{
  const v = readDecision(owner, doc({ classification: 'Restricted', status: 'DRAFT' }));
  ok(v.allowed && v.basis === 'owner', 'an author always keeps their own document');

  const a = readDecision(approver, doc({ classification: 'Restricted', status: 'IN_REVIEW' }));
  ok(a.allowed && a.basis === 'approver', 'somebody asked to sign it can read what they are signing');

  const g = readDecision(records, doc({ classification: 'Restricted', inAudience: false }));
  ok(g.allowed && g.basis === 'governance', 'the records team reads the whole library');

  eq(
    GOVERNS, 'apply-retention-and-legal-hold',
    'the override must be the NARROW capability. Three roles hold it; the authoring '
    + 'capability is held by eleven including client-contributor and vendor-owner, and '
    + 'granting those sight of every Restricted policy makes the marking decorative again',
  );
  ok(
    !readDecision(author, doc({ classification: 'Restricted' })).allowed,
    'so holding the AUTHORING capability must not be sight of every Restricted document',
  );

  ok(
    !readDecision(outsider, doc({ classification: 'Public' })).allowed,
    'another organisation is refused even holding the governing capability, and even for '
    + 'a Public document',
  );
}

// ─── The marking now does something ─────────────────────────────────────────
{
  ok(
    readDecision(member, doc({ classification: 'Public' })).allowed
    && readDecision(member, doc({ classification: 'Internal' })).allowed,
    'Public and Internal stay readable by the organisation — that is what they mean, and '
    + 'what they did yesterday',
  );
  eq(
    readDecision(member, doc({ classification: 'Internal' })).basis, 'tenant',
    'and say so',
  );

  ok(
    !readDecision(member, doc({ classification: 'Restricted', inAudience: false })).allowed,
    'THE PACKET: a Restricted document is refused to a member who was not issued it',
  );
  ok(
    !readDecision(member, doc({ classification: 'Confidential', inAudience: false })).allowed,
    'and so is a Confidential one',
  );
  ok(
    readDecision(member, doc({ classification: 'Restricted', inAudience: true })).allowed,
    'while the people it was published to keep it',
  );
  eq(
    readDecision(member, doc({ classification: 'Restricted', inAudience: true })).basis,
    'audience',
    'on the basis that they were issued it',
  );
  ok(
    !readDecision(member, doc({ classification: 'Secret', inAudience: false })).allowed,
    'a typo in the marking must fail CLOSED, not open',
  );
}

// ─── A draft is the author's working copy ───────────────────────────────────
{
  assert.deepStrictEqual(
    [...UNISSUED_STATUSES], ['DRAFT', 'RETURNED'],
    'the statuses in which a document is still being written',
  );
  checks += 1;

  for (const status of UNISSUED_STATUSES) {
    ok(
      !readDecision(member, doc({ classification: 'Public', status })).allowed,
      `a ${status} document is refused to a colleague even when marked Public — reading `
      + "somebody's half-written policy and acting on it is the failure, and classification "
      + 'does not come into it',
    );
  }
  ok(
    readDecision(records, doc({ status: 'DRAFT' })).allowed,
    'the records team still reaches a draft, so a library cannot be made unauditable by '
    + 'leaving things unsubmitted',
  );
  ok(
    readDecision(approver, doc({ status: 'RETURNED' })).allowed,
    'and so does the person it was sent back from',
  );
}

// ─── The legacy publication, preserved and reported ─────────────────────────
{
  // THE REGRESSION THIS BLOCK EXISTS FOR.
  //
  // The rule was first written as `doc.publishedAt && !doc.audienceKind`.
  // publishedAt was added by migration 20260916000000 as a nullable column
  // with no backfill, and publishDocument is its only writer — so it is null
  // on exactly the rows this rule protects. Keyed on it, the clause could
  // never fire: every policy a live tenant published before that migration and
  // marked Confidential or above would have gone dark for the whole
  // organisation on deploy, silently, with openAudienceGap not even reporting
  // it. The decision must not consult publishedAt at all.
  {
    // Comment-stripped: this module's own prose explains the bug at length and
    // names the column, which is precisely what must NOT survive in the code.
    const svcCode = code(svcSrc);
    const fn = svcCode.slice(svcCode.indexOf('export function readDecision'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    ok(
      !/publishedAt/.test(body),
      'readDecision must not consult publishedAt. It is null on every row published '
      + 'before migration 20260916000000 — precisely the population the legacy rule '
      + 'exists to protect — so a decision that reads it is wrong exactly where it matters',
    );
    const gap = svcCode.slice(svcCode.indexOf('export function openAudienceGap'));
    ok(
      !/publishedAt/.test(gap.slice(0, gap.indexOf('\n}'))),
      'and neither must openAudienceGap, or the hole goes unreported as well as unopened',
    );
    // Proven by behaviour too, not only by source: the legacy row shape as it
    // actually exists in a live database.
    const liveLegacyRow = {
      id: 'd9',
      tenantId: 't1',
      ownerId: 'u-owner',
      status: 'PUBLISHED',
      classification: 'Confidential',
      approverIds: [],
      inAudience: false,
      audienceKind: null,
    };
    ok(
      readDecision(member, liveLegacyRow).allowed,
      'a Confidential document published before audiences existed must stay readable by '
      + 'the organisation it was already readable by',
    );
    ok(
      openAudienceGap(liveLegacyRow),
      'and must be reported so somebody can act on it',
    );
  }

  const legacy = doc({ classification: 'Restricted', audienceKind: null, inAudience: false });
  const v = readDecision(member, legacy);
  ok(
    v.allowed && v.basis === 'legacy-publication',
    'a document published before audiences were recorded keeps the reach it had. Taking it '
    + 'away would remove access people have today on a rule nobody told them, and the first '
    + 'sign of it would be a policy nobody can open',
  );
  ok(
    openAudienceGap(legacy),
    'and it must be REPORTED as a gap, not silently preserved — one re-publish ends it',
  );
  ok(
    !openAudienceGap(doc({ classification: 'Internal', audienceKind: null })),
    'an Internal document readable by everyone is not a gap. That is what Internal means',
  );
  ok(
    !openAudienceGap(doc({ classification: 'Restricted', audienceKind: 'Role' })),
    'nor is one whose audience was recorded',
  );
  ok(
    !openAudienceGap(doc({ classification: 'Restricted', status: 'DRAFT', audienceKind: null })),
    'nor is an unpublished one, which was never reachable in the first place',
  );

  ok(
    !readDecision(member, doc({
      classification: 'Restricted', audienceKind: 'Department', inAudience: false,
    })).allowed,
    'once an audience IS recorded, not being in it is a refusal',
  );
}

// ─── A refusal must not confirm the document exists ─────────────────────────
{
  ok(
    /NOT_FOUND_MESSAGE/.test(guardSrc) && /Document not found/.test(guardSrc),
    'the refusal carries the same message as a genuine miss',
  );
  for (const [name, src] of [['documentController', ctrl], ['documentLinkController', linkCtrl]]) {
    ok(
      !/status\(403\)[\s\S]{0,400}?(Restricted|classification|clearance)/i.test(src),
      `${name} must not answer a refused read with a 403 naming the marking. "You may not read `
      + 'this" confirms the id is real and that somebody thought it worth protecting, which is '
      + 'the disclosure the marking exists to prevent',
    );
  }
}

// ─── Every read surface is gated ────────────────────────────────────────────
{
  const gated = (src, handler, needle) => {
    const at = src.indexOf(`export const ${handler}`);
    checks += 1;
    assert.ok(at >= 0, `${handler} must exist`);
    const body = src.slice(at, at + 2600);
    checks += 1;
    assert.ok(
      needle.test(body),
      `${handler} must apply the reach decision. A rule enforced in one handler and not `
      + 'the next is not enforced',
    );
  };

  gated(ctrl, 'getDocument', /loadReadable\(/);
  gated(ctrl, 'downloadDocument', /loadReadable\(/);
  gated(ctrl, 'documentAccessHistory', /loadReadable\(/);
  gated(ctrl, 'listDocuments', /decideRead\(/);
  gated(ctrl, 'getDocumentStats', /decideRead\(/);
  gated(ctrl, 'getAcknowledgements', /loadReadable\(/);
  gated(linkCtrl, 'listDocumentLinks', /loadReadable\(/);
  gated(linkCtrl, 'governingDocuments', /decideRead\(/);

  // Calling the decision is not the same as OBEYING it, and a presence check
  // cannot tell the difference. Each site below is pinned to the exact shape
  // that uses the answer, because every one of these was defeated by a
  // one-token edit that left the call in place.
  ok(
    /return verdict\.allowed \? \{ doc, verdict \} : null;/.test(guardSrc),
    'loadReadable must WITHHOLD on a refusal, not merely consult the decision. Six handlers '
    + 'rest on this one line; leaving the call in place and returning the document anyway '
    + 'defeats all of them at once',
  );
  ok(
    /const visible = documents\.filter\(\(d\) =>\n\s*decideRead\(/.test(ctrl),
    'the library must list the filtered set',
  );
  ok(
    /const mine = rows\.filter\(\(d\) => decideRead\(/.test(ctrl),
    'and the stats must count it',
  );
  ok(
    /const visible = links\.filter\(\(l\) => decideRead\(/.test(linkCtrl),
    'and the reverse direction must show it',
  );

  // A blunt rule, and the right kind: a reach decision that is always true is
  // indistinguishable from no reach decision, and reads as enforcement in a
  // diff. Banned outright in the four files that carry this packet.
  for (const [name, src] of [
    ['documentController', ctrl],
    ['documentLinkController', linkCtrl],
    ['documentReadGuard', guardSrc],
    ['documentAccess', code(svcSrc)],
  ]) {
    ok(
      !/true \|\||\|\| true|&& false|false &&/.test(src),
      `${name} must not short-circuit a decision. "true || decideRead(...)" still names the `
      + 'function, still reads as a guard, and enforces nothing',
    );
  }

  // The reverse direction leaked what the forward one protects.
  const gd = linkCtrl.slice(linkCtrl.indexOf('export const governingDocuments'));
  ok(
    /count: visible\.length/.test(gd),
    'and the count must be of what was shown. "3 documents" above a list of one says a '
    + 'Restricted policy is there',
  );

  // The stats tile and the list beside it must be the same number.
  const stats = ctrl.slice(ctrl.indexOf('export const getDocumentStats'));
  ok(
    !/prisma\.document\.count\(/.test(stats),
    'a tenant-wide count() beside a filtered list disagrees with it, and the difference is '
    + 'how many Restricted documents exist',
  );

  // The decision runs before the expensive include.
  const get = ctrl.slice(ctrl.indexOf('export const getDocument'));
  ok(
    get.indexOf('loadReadable(') < get.indexOf('acknowledgements:'),
    'getDocument must decide BEFORE assembling every version, approval and acknowledger '
    + "name and email — that include is the disclosure, not just the document's body",
  );
}

// ─── listDocuments: the filter that was the only thing reading the word ─────
{
  const list = ctrl.slice(ctrl.indexOf('export const listDocuments'), ctrl.indexOf('export const getDocument'));
  ok(
    /where\.classification = classification/.test(list),
    'the caller-chosen filter stays — narrowing a list on request is legitimate',
  );
  ok(
    list.indexOf('decideRead(') > list.indexOf('findMany'),
    'but the restriction must run AFTER the query, so a search term can never match the '
    + 'content of a document the searcher may not read',
  );
}

// ─── Recording: the window, not the request ─────────────────────────────────
{
  eq(ACCESS_ACTION, 'DOCUMENT_ACCESSED', 'the action an auditor greps for');

  eq(accessDay('2026-03-04T23:59:59.999Z'), '2026-03-04', 'the UTC day of a read');
  eq(accessDay('2026-03-05T00:00:00.000Z'), '2026-03-05', 'and the next one');
  eq(
    accessDay(new Date('2026-03-04T21:30:00.000Z')), '2026-03-04',
    'a Date and its ISO string must land in the SAME window. A local midnight puts a '
    + '23:30 read in Riyadh on a different day from the row it should increment',
  );
  eq(
    accessDay(new Date('2026-03-04T21:30:00.000Z')),
    accessDay('2026-03-04T21:30:00.000Z'),
    'whichever form the caller passes',
  );
  {
    // Asserted on the source as well as the behaviour, because whether a
    // local-time day number differs from the UTC one depends on the machine
    // the test happens to run on. This holds in every timezone.
    const fn = svcSrc.slice(svcSrc.indexOf('export function accessDay'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    ok(
      !/\.getFullYear\(\)|\.getMonth\(\)|\.getDate\(\)/.test(body),
      'accessDay must use UTC parts only. A local-midnight day number is correct on a '
      + 'developer machine in one timezone and wrong on the server, and the bug is a read '
      + 'landing in a different window from the row it should have incremented',
    );
    ok(
      /getUTCFullYear|toISOString/.test(body),
      'and must say so',
    );
  }

  ok(
    recordingIsMandatory('Restricted') && recordingIsMandatory('Confidential'),
    'handing over a marked document and being unable to say to whom is the failure the '
    + 'record exists to prevent, so it does not happen',
  );
  ok(
    !recordingIsMandatory('Internal') && !recordingIsMandatory('Public'),
    'while an unmarked document is not worth blocking somebody over',
  );
  eq(
    chainWorthy('Restricted'), true,
    'a marked read belongs in the tamper-evident chain',
  );
  eq(chainWorthy('Internal'), false, 'an ordinary one does not');

  // The four hazards in writeAudit, each answered in the code.
  ok(
    /documentAccess\.create\(/.test(guardSrc)
    && guardSrc.indexOf('documentAccess.create(') < guardSrc.indexOf("=== 'P2002'"),
    'the insert is attempted FIRST and a unique violation is the answer, not an error — no '
    + 'separate existence check can tell a new window from an open one without a race',
  );
  ok(
    /openedNow && chainWorthy\(/.test(guardSrc),
    'the chain is appended only when a window OPENS, and only above the threshold. A row per '
    + "GET forks a chain that writeAudit's own comment says is not serialized",
  );
  {
    const pay = guardSrc.slice(guardSrc.indexOf('action: ACCESS_ACTION'));
    const block = pay.slice(pay.indexOf('payload: {'), pay.indexOf('},', pay.indexOf('payload: {')));
    ok(
      !/code|classification/.test(block),
      'the payload must NOT name the code or the marking. GET /api/audit-logs is guarded by '
      + 'requireAuth alone and returns raw payloads to any tenant member, so putting them '
      + 'here hands back through the audit log exactly what the guard withholds',
    );
  }
  ok(
    /payload: \{[\s\S]{0,300}?actorId[\s\S]{0,300}?documentId/.test(guardSrc),
    'the payload must carry actorId and documentId. writeAudit hashes the payload but NOT '
    + 'the actor or subject columns, and currentHash is @unique — without them two people '
    + 'opening the same document in the same millisecond hash identically and one '
    + 'transaction dies',
  );
  ok(
    /catch \(error: any\) \{[\s\S]{0,200}?return false;/.test(guardSrc),
    'and a logging failure returns false rather than throwing, so the CALLER decides whether '
    + 'a policy fails to open — 221 of 222 writeAudit sites fail the operation',
  );
  for (const handler of ['getDocument', 'downloadDocument']) {
    const body = ctrl.slice(ctrl.indexOf(`export const ${handler}`), ctrl.indexOf(`export const ${handler}`) + 2600);
    ok(
      /!recorded && recordingIsMandatory\(gate\.doc\.classification\)/.test(body),
      `${handler} must refuse when a MARKED document's read could not be recorded — and must `
      + "ask about THIS document's classification. recordingIsMandatory('Internal') is always "
      + 'false, still names the function, and releases every Restricted document unrecorded',
    );
  }
  ok(
    /via: 'VIEW'/.test(ctrl),
    'opening a document is recorded as a view',
  );
  ok(
    /disposition\) === 'preview' \? 'PREVIEW' : 'DOWNLOAD'/.test(ctrl),
    'and the download endpoint must take a declared disposition. The reader pane fetches '
    + 'through the SAME endpoint, so without this every on-screen read counts as a copy '
    + 'taken away and the download figure means nothing',
  );
  ok(
    /const isPreview = input\.via === 'PREVIEW';/.test(guardSrc)
    && /views: isDownload \|\| isPreview \? undefined : \{ increment: 1 \}/.test(guardSrc),
    'a PREVIEW must open a window if none is open — so nothing delivers bytes unrecorded — '
    + 'but must NOT increment a view. Opening a document calls getDocument and then the '
    + 'reader pane, so counting both made every Views figure exactly double',
  );
  ok(
    /recordAccess\(\{[\s\S]{0,700}?via: String\(req\.query\.disposition\)/.test(ctrl),
    'the disposition must only choose which counter moves — the access row and the chain '
    + 'entry are written either way, so declaring "preview" cannot hide a read',
  );
}

// ─── Reporting it back ──────────────────────────────────────────────────────
{
  const rows = [
    { userId: 'a', day: '2026-03-01', views: 3, downloads: 1, basis: 'audience', firstAt: 'x', lastAt: 'y' },
    { userId: 'a', day: '2026-03-02', views: 1, downloads: 0, basis: 'audience', firstAt: 'x', lastAt: 'y' },
    { userId: 'b', day: '2026-03-01', views: 2, downloads: 0, basis: 'owner', firstAt: 'x', lastAt: 'y' },
  ];
  const s = summariseAccess(rows);
  eq(s.readers, 2, 'distinct people, not rows');
  eq(s.windows, 3, 'and the person-days they read on');
  eq(s.views, 6, 'every view');
  eq(s.downloads, 1, 'every download');
  eq(s.downloaders, 1, 'and how many took a copy away, which is the sharper question');

  const empty = summariseAccess([]);
  ok(
    empty.neverOpened === true,
    'a document nobody has opened must SAY so. A zero cannot distinguish that from reads '
    + 'that were never recorded, and only one of them is a finding',
  );
  eq(summariseAccess(rows).neverOpened, false, 'and one that has been opened must not');

  const hist = ctrl.slice(ctrl.indexOf('export const documentAccessHistory'));
  ok(
    /recordedSince/.test(hist),
    'the history must say reads before this existed were never written down, so an empty '
    + 'list is not read as proof that nobody opened the document',
  );
  ok(
    /viewer\.capabilities\.includes\(READ_EVERYTHING\)/.test(hist)
    && /gate\.doc\.ownerId !== userId && !governs/.test(hist),
    'who has been reading a policy is its own disclosure — the owner and the records team, '
    + 'not every colleague. Asked of the VIEWER, not read off the verdict basis: '
    + "readDecision returns 'approver' before 'governance', and all three roles holding "
    + 'retention also hold the signing capability, so a compliance approver assigned to a '
    + 'document came back as an approver and lost the history on every document they had '
    + 'ever been asked to sign',
  );
  ok(
    /truncated: summary\.windows > rows\.length/.test(hist),
    'and a page that stops at 500 must say so, rather than presenting the page as the total',
  );
  ok(
    /groupBy\(\{[\s\S]{0,120}?by: \['userId'\]/.test(hist),
    'the totals must be computed over EVERY row, not over the truncated page — a figure '
    + 'that reads as a measurement when it is a sample is the defect this repo has already '
    + 'fixed twice',
  );
}

// ─── The table, and the route ───────────────────────────────────────────────
{
  const model = schema.slice(schema.indexOf('model DocumentAccess {'));
  const body = model.slice(0, model.indexOf('\n}'));
  ok(
    /@@unique\(\[documentId, userId, day\]\)/.test(body),
    'the window is the unique key, and is also how a repeat read is told from a first one',
  );
  ok(
    /@@index\(\[documentId, firstAt\]\)/.test(body),
    '"who has read this document" must be indexed — it is the question the packet exists for',
  );
  ok(
    /@@index\(\[tenantId, userId, firstAt\]\)/.test(body),
    'and so must "what has this person been reading", which offboarding will ask',
  );
  ok(
    /classification String/.test(body),
    'the marking is snapshotted, so a later re-classification cannot rewrite what a document '
    + 'was marked at the moment somebody was handed it',
  );
  ok(/basis\s+String/.test(body), 'and the history says what entitled each reader');

  ok(
    /router\.get\('\/:id\/access', documentAccessHistory\)/.test(routes),
    'the history must be reachable',
  );
  const wildcard = routes.indexOf("router.get('/:id',");
  for (const literal of ['/stats', '/my-acknowledgements', '/link-options', '/audience-options']) {
    ok(
      routes.indexOf(`'${literal}'`) < wildcard,
      `${literal} must be registered before '/:id' or the wildcard swallows it`,
    );
  }
  ok(
    !/requireCapability\([^)]*\), documentAccessHistory/.test(routes),
    "a route-level capability would lock an owner out of their own document's history; the "
    + 'handler narrows it instead',
  );
}

// ─── The migration adds, and does not take away ─────────────────────────────
{
  const dir = path.join(__dirname, '..', '..', 'prisma', 'migrations', '20260916020000_document_access');
  const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8');
  ok(/CREATE TABLE "DocumentAccess"/.test(sql), 'the table is created');
  ok(
    !/DROP |ALTER COLUMN|TRUNCATE/i.test(sql),
    'and nothing is dropped or narrowed. This runs against live tenants',
  );
  ok(
    /CREATE UNIQUE INDEX "DocumentAccess_documentId_userId_day_key"/.test(sql),
    'with the window constraint the recorder relies on to tell a new read from a repeat',
  );
}

// ─── The screen ─────────────────────────────────────────────────────────────
{
  const WEB = path.join(API, '..', '..', 'src');
  const detail = fs.readFileSync(path.join(WEB, 'pages', 'documents', 'DocumentDetail.tsx'), 'utf8');
  const detailCode = detail
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  ok(
    /'governs' \| 'access'/.test(detailCode),
    'the detail page must have somewhere to show who has read the document',
  );
  ok(
    /maySeeAccess && \(/.test(detailCode),
    'and the tab must appear only when the server allowed the history — a 403 there is the '
    + 'server saying this is not yours to see, not an error to render',
  );
  ok(
    /disposition=preview/.test(detailCode),
    'the reader pane must declare itself a preview, or opening a document would count as '
    + 'downloading it',
  );
  ok(
    /reach\?\.openAudienceGap/.test(detailCode),
    'and a marked document that is still readable by everyone must SAY so on the screen '
    + 'where somebody can act on it, rather than only in a service',
  );
  ok(
    /Nobody has opened this document/.test(detailCode),
    'an empty history must read as a fact about the document',
  );
  ok(
    /accessNote \|\|/.test(detailCode),
    'qualified by when recording began, so nobody reads an empty list as proof',
  );
  ok(
    !/var\(--warn-(bg|line)\)|var\(--warn\)/.test(detail),
    'the banner must use tokens that exist — --warning-bg, --warning-line, --warning — or '
    + 'it renders with no background at all',
  );
}

console.log(
  `document-access: ${checks} assertions passed `
  + `(${CLASSIFICATIONS.join(' < ')}; need-to-know from ${NEED_TO_KNOW_FROM}; `
  + `action ${ACCESS_ACTION})`,
);
