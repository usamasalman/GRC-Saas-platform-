/**
 * A published policy reaches somebody, and the tracker can name who it did not.
 *
 * The build plan said "Publish was never built". That is wrong, and saying so
 * precisely is what sized this packet: publishDocument existed, guarded
 * APPROVED, wrote the status in a transaction and audited it, and the route was
 * registered behind CAP.SIGN_DOCUMENT. Two seeded documents were already
 * PUBLISHED. What it lacked was a caller -- a grep of the whole frontend for
 * "/publish" returned one hit, an unrelated regex in a mock file -- so through
 * the product a document reached APPROVED and stopped, while the approval
 * response told the user it was "ready for publication".
 *
 * What was genuinely missing is everything publication is FOR:
 *
 *   - No audience. Document had no column naming a recipient set and no join
 *     table, role list or team to point at. The only thing that executed as an
 *     audience was a denominator: getAcknowledgements divided signatures by
 *     user.count({ tenantId, status: 'Active' }), so a policy issued to one
 *     department reported as a few percent read. getDocumentStats made the same
 *     assumption again, independently.
 *
 *   - Nothing raised. Acknowledgement could only ever record a COMPLETED
 *     signature -- documentId, userId, completedAt defaulted to now(), and an
 *     IP address. There was no status and no requestedAt, so the schema could
 *     not represent "asked and not yet signed". The non-signers were never
 *     materialised, so "who has not read the policy" -- the only question a
 *     tracker exists to answer -- was unanswerable.
 *
 *   - Nobody told. documentController imported no notification service at all.
 *
 *   - No version binding. A signature on v1.0 was indistinguishable from one on
 *     v3.0, so a revised policy would show as already read by everyone who had
 *     seen the old one.
 *
 *   - And the screen called AcknowledgementTracker tracked nothing: it listed
 *     every published document with a button on each, its own interface
 *     declared `acknowledgedByMe` and nothing ever set it, and the endpoint
 *     that answers "who has signed" had no caller.
 *
 *   node scripts/verify/document-publication-test.js
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

const schema = read(API, '..', 'prisma', 'schema.prisma');
const ctrl = read(API, 'controllers', 'documentController.ts');
const ctrlCode = code(ctrl);
const routes = read(API, 'routes', 'documentRoutes.ts');
const library = code(read(WEB, 'pages', 'documents', 'DocumentLibrary.tsx'));
const tracker = code(read(WEB, 'pages', 'documents', 'AcknowledgementTracker.tsx'));

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

const {
  planPublication, coverage, AUDIENCE_KINDS, MAX_AUDIENCE,
} = require('../../dist/services/documentPublication');

const APPROVED = { status: 'APPROVED', version: '2.0', publishedVersion: null };
const PEOPLE = [
  { id: 'u1', name: 'Ann', status: 'Active', department: 'Finance', role: 'analyst' },
  { id: 'u2', name: 'Bo', status: 'Active', department: 'Finance', role: 'manager' },
  { id: 'u3', name: 'Cy', status: 'Active', department: 'IT', role: 'analyst' },
  { id: 'u4', name: 'Di', status: 'Suspended', department: 'Finance', role: 'analyst' },
];
const base = { document: APPROVED, users: PEOPLE, alreadyAsked: [] };

// ── The rules run without a database ─────────────────────────────────────
{
  const svc = read(API, 'services', 'documentPublication.ts');
  checks += 1;
  assert.ok(
    !/from '\.\.\/db'|@prisma\/client/.test(svc),
    'documentPublication must stay pure. It decides who is asked to read a mandatory policy, '
    + 'and a rule that needs a database to exercise is a rule nobody exercises.',
  );
}

// ── An audience is required, and must resolve to somebody ────────────────
{
  const noKind = planPublication({ ...base, kind: '', value: '' });
  checks += 1;
  assert.ok(
    noKind.ok === false && noKind.code === 'AUDIENCE_REQUIRED',
    'publishing without naming an audience must be refused. Publishing to nobody in '
    + 'particular is how a policy goes live that nobody is ever asked to read — which is '
    + 'exactly what the old handler did, every time.',
  );

  const noValue = planPublication({ ...base, kind: 'Department', value: '  ' });
  ok(noValue.ok === false && noValue.code === 'AUDIENCE_VALUE_REQUIRED', 'a named kind needs a value');

  const empty = planPublication({ ...base, kind: 'Department', value: 'Legal' });
  checks += 1;
  assert.ok(
    empty.ok === false && empty.code === 'AUDIENCE_EMPTY',
    'an audience nobody is in must be refused. Publishing to it would ask nobody to read the '
    + 'policy and then report full coverage of an empty set.',
  );

  const draft = planPublication({
    ...base, document: { ...APPROVED, status: 'DRAFT' }, kind: 'Everyone', value: '',
  });
  ok(draft.ok === false && draft.code === 'NOT_APPROVED', 'only an approved document publishes');

  const huge = planPublication({
    ...base,
    kind: 'Everyone',
    value: '',
    users: Array.from({ length: MAX_AUDIENCE + 5 }, (_, i) => ({
      id: `x${i}`, name: `P${i}`, status: 'Active', department: null, role: null,
    })),
  });
  ok(huge.ok === false && huge.code === 'AUDIENCE_TOO_LARGE', 'the blast-radius cap holds');
}

// ── Who is actually asked ────────────────────────────────────────────────
{
  const everyone = planPublication({ ...base, kind: 'Everyone', value: '' });
  ok(everyone.ok === true, 'Everyone is a valid audience');
  checks += 1;
  assert.deepStrictEqual(
    everyone.recipientIds, ['u1', 'u2', 'u3'],
    'only ACTIVE people are asked. A suspended account cannot sign in, so counting it would '
    + 'make the coverage figure permanently unreachable.',
  );
  ok(everyone.value === null, 'Everyone carries no value');

  const dept = planPublication({ ...base, kind: 'Department', value: 'finance' });
  checks += 1;
  assert.deepStrictEqual(
    dept.recipientIds, ['u1', 'u2'],
    'a department audience matches case-insensitively and excludes the suspended member',
  );

  const role = planPublication({ ...base, kind: 'Role', value: 'analyst' });
  checks += 1;
  assert.deepStrictEqual(role.recipientIds, ['u1', 'u3']);

  // Re-publishing the same version must not ask anybody twice.
  const again = planPublication({ ...base, kind: 'Everyone', value: '', alreadyAsked: ['u1', 'u2'] });
  checks += 1;
  assert.deepStrictEqual(
    again.recipientIds, ['u3'],
    'people already asked for this version must not be asked again',
  );
  ok(
    again.warnings.some((w) => /already asked/.test(w)),
    'and the publisher is told how many were skipped',
  );

  const allAsked = planPublication({
    ...base, kind: 'Everyone', value: '', alreadyAsked: ['u1', 'u2', 'u3'],
  });
  ok(allAsked.ok === true && allAsked.recipientIds.length === 0, 'a full re-publish is a no-op');
  ok(
    allAsked.warnings.some((w) => /changes nothing for them/.test(w)),
    'and says so rather than reporting a successful issue to nobody',
  );

  // A revision re-asks, and the publisher is warned that it does.
  const revised = planPublication({
    ...base,
    document: { status: 'APPROVED', version: '3.0', publishedVersion: '2.0' },
    kind: 'Everyone',
    value: '',
  });
  checks += 1;
  assert.ok(
    revised.warnings.some((w) => /acknowledged the earlier one is asked again/.test(w)),
    'a new version must re-ask. A signature is against the version that was read, and a '
    + 'revised policy showing as already acknowledged is the defect the version binding exists '
    + 'to prevent.',
  );
}

// ── What the tracker may state ───────────────────────────────────────────
{
  const unpublished = coverage({ requested: 0, signed: 0, published: false });
  checks += 1;
  assert.ok(
    unpublished.percent === null && /has not been published/.test(unpublished.caveat),
    'an unpublished document has no coverage. Zero and a hundred both read as a finding when '
    + 'the truth is that nobody was asked.',
  );

  const noAudience = coverage({ requested: 0, signed: 0, published: true });
  ok(noAudience.percent === null, 'and neither does one published before an audience existed');
  ok(/no set of people to measure against/.test(noAudience.caveat), 'with a reason');

  const part = coverage({ requested: 4, signed: 1, published: true });
  checks += 1;
  assert.deepStrictEqual(
    { r: part.requested, s: part.signed, o: part.outstanding, p: part.percent },
    { r: 4, s: 1, o: 3, p: 25 },
    'the denominator is the people asked, not every active user in the organisation',
  );

  const full = coverage({ requested: 3, signed: 3, published: true });
  ok(full.percent === 100 && full.outstanding === 0 && full.caveat === null, 'full coverage states itself');

  // Signatures cannot exceed the ask.
  const over = coverage({ requested: 2, signed: 5, published: true });
  checks += 1;
  assert.ok(
    over.signed === 2 && over.percent === 100,
    'coverage must never exceed 100%. The duplicate guard is not atomic and there is no unique '
    + 'constraint on the signature table, so two concurrent posts can both insert.',
  );
}

// ── Publishing issues, records and tells ─────────────────────────────────
{
  ok(/planPublication\(\{/.test(ctrlCode), 'publish must go through the rule');
  checks += 1;
  assert.ok(
    /tx\.acknowledgementRequest\.createMany/.test(ctrlCode),
    'publishing must RAISE the acknowledgement requests. It used to flip one status column and '
    + 'write an audit row, so a published policy asked nobody for anything.',
  );
  ok(/skipDuplicates: true/.test(ctrlCode), 'and a repeated publish must be idempotent');

  checks += 1;
  assert.ok(
    /notify\(tx, plan\.recipientIds\.map/.test(ctrlCode),
    'and must tell the people asked. This module called notify() nowhere at all.',
  );

  for (const field of ['publishedAt', 'publishedById', 'publishedVersion', 'audienceKind']) {
    ok(
      new RegExp(`${field}:`).test(ctrlCode),
      `publishing must record ${field} — the model had no publish-specific column of any kind`,
    );
  }

  checks += 1;
  assert.ok(
    /audienceKind: plan\.kind,[\s\S]{0,200}?asked: plan\.recipientIds\.length/.test(ctrlCode),
    'the audit entry must record who it went to. An entry saying a policy went live without '
    + 'saying to whom cannot answer the question an auditor asks of it.',
  );
}

// ── The schema can express an outstanding request ────────────────────────
{
  ok(/model AcknowledgementRequest \{/.test(schema), 'the request side must be modelled');
  checks += 1;
  assert.ok(
    /@@unique\(\[documentId, version, userId\]\)/.test(schema),
    'keyed per VERSION, not per document. Keyed per document, a revision could not re-ask, and '
    + 'the same publish run could double-ask.',
  );
  ok(
    /version     String\?/.test(schema),
    'and a signature must record the version it was against',
  );

  const dir = path.join(API, '..', 'prisma', 'migrations');
  const mig = fs.readdirSync(dir).filter((d) => /document_publication$/.test(d));
  ok(mig.length === 1, 'exactly one migration for this');
  const sql = fs.readFileSync(path.join(dir, mig[0], 'migration.sql'), 'utf8');
  checks += 1;
  assert.ok(
    !/\bDROP\b|ALTER COLUMN/i.test(sql),
    'the migration must be additive. This database holds signed acknowledgements, and a '
    + 'destructive statement is not recoverable by editing the file afterwards.',
  );
}

// ── The tracker names who has not signed ─────────────────────────────────
{
  const at = ctrlCode.indexOf('export const getAcknowledgements');
  ok(at > 0, 'getAcknowledgements not found');
  const body = ctrlCode.slice(at, ctrlCode.indexOf('\nexport const ', at + 1));

  checks += 1;
  assert.ok(
    !/user\.count\(\{ where: \{ tenantId, status: 'Active' \} \}\)/.test(body),
    'the completion rate must stop dividing by every active user in the organisation. A policy '
    + 'issued to one department reported as a few percent read.',
  );
  checks += 1;
  assert.ok(
    /acknowledgementRequest\.findMany/.test(body) && /outstanding/.test(body),
    'it must read the requests and name the people who have not signed. The non-signers used '
    + 'to be an arithmetic difference and could never be listed.',
  );
  ok(/coverage\(\{/.test(body), 'and the figure must go through the rule');
}

// ── Every new endpoint is routed, ahead of the wildcard ──────────────────
{
  for (const r of [
    "router.get('/my-acknowledgements', myAcknowledgements);",
    "router.get('/audience-options', publishOptions);",
  ]) {
    ok(routes.includes(r), `${r} must be routed`);
    const at = routes.indexOf(r);
    const wildcard = routes.indexOf("router.get('/:id', getDocument);");
    checks += 1;
    assert.ok(
      at > 0 && wildcard > 0 && at < wildcard,
      `${r} must be registered before the '/:id' wildcard, which would otherwise match it and `
      + 'answer "Document not found" for a literal path segment',
    );
  }
}

// ── The screens reach all of it ──────────────────────────────────────────
{
  checks += 1;
  assert.ok(
    /\/publish`/.test(library),
    'the library must offer Publish. The endpoint was routed and guarded for the life of this '
    + 'module and no screen ever called it, so a document reached APPROVED and stopped there '
    + 'while the approval response said it was ready for publication.',
  );
  ok(
    /doc\.status === 'APPROVED'/.test(library),
    'and only on a document that can be published',
  );
  ok(/MAY\.SIGN_DOCUMENT/.test(library), 'behind the same capability the route enforces');
  ok(
    /audience-options/.test(library),
    'the audience values must come from the server rather than a copy in the browser',
  );

  ok(
    /my-acknowledgements/.test(tracker),
    'the acknowledgement screen must list what the reader was ASKED to read, not every '
    + 'published document in the organisation',
  );
  checks += 1;
  assert.ok(
    /!r\.acknowledgedByMe && \(/.test(tracker),
    'and offer the button only where it can succeed. It used to render on every row — the '
    + 'screen declared acknowledgedByMe and nothing ever set it — so a second click produced a '
    + '409 rendered inside the success banner.',
  );
  checks += 1;
  assert.ok(
    /\/acknowledgements`/.test(tracker) && /outstanding\.map/.test(tracker),
    'and the coverage view must call the tracker endpoint and name the people outstanding. '
    + 'That endpoint existed, routed, with no caller anywhere in the frontend.',
  );
  ok(
    /coverage\.caveat/.test(tracker),
    'and must render the caveat rather than a figure the data cannot support',
  );
}

console.log(
  `document-publication: ${checks} assertions passed `
  + `(pure rules, audiences: ${AUDIENCE_KINDS.join(', ')}, cap ${MAX_AUDIENCE})`,
);
