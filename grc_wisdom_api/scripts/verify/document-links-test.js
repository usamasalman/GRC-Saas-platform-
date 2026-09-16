/**
 * A policy can say what it governs.
 *
 * Linking a document to the control it mandates, the risk it treats or the
 * framework clause it satisfies is the most GRC-specific thing the brief asks
 * for, and it had no representation anywhere. Exactly five models declared a
 * field of type Document -- DocumentVersion, ApprovalQueue, Acknowledgement,
 * AcknowledgementRequest and DocumentChunk -- and the generated SQL agreed:
 * five foreign keys pointed at the table, none of them from Control, Risk,
 * StandardClause, ControlImplementation, Issue, Audit, Asset or Vendor. Risk
 * carries a comment block headed "the linkage spine" and had no document
 * vertebra. Evidence cannot point at a Document either, so "the policy IS the
 * evidence" was not expressible without re-uploading the file and losing its
 * version, approval and acknowledgement history.
 *
 * The gap was ADVERTISED, which is worse than silent. Three pieces of guide
 * content promised it, all reachable in the running product:
 *
 *   "Always include framework mappings (e.g. ISO 27001, NCA ECC) in the
 *    document metadata"                                 -- no such field
 *   "...and map relevant regulatory standard clauses"   -- phase one of the
 *    documented Document Governance Lifecycle, with no step behind it
 *   "...compliance clause coverage"                     -- on a screen with
 *    neither a diff nor coverage
 *
 * The only place a clause could actually be written was the free-prose body,
 * whose own placeholder invites exactly that. All three now describe what the
 * product does.
 *
 *   node scripts/verify/document-links-test.js
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
const ctrl = code(read(API, 'controllers', 'documentLinkController.ts'));
const routes = read(API, 'routes', 'documentRoutes.ts');
const detail = code(read(WEB, 'pages', 'documents', 'DocumentDetail.tsx'));
const guide = read(WEB, 'data', 'userGuideData.ts');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

const {
  planDocumentLinks, summariseLinks, targetOf, LINK_TARGETS, MAX_LINKS_PER_CALL,
} = require('../../dist/services/documentLinks');

const OWN = { id: 'c1', label: 'CTRL-001', tenantId: 't1' };
const LIBRARY = { id: 'c2', label: 'CTRL-LIB', tenantId: null };
const FOREIGN = { id: 'c3', label: 'THEIRS-01', tenantId: 't9' };
const base = {
  documentTenantId: 't1',
  documentStatus: 'PUBLISHED',
  target: 'control',
  existing: [],
};

// ── The rules run without a database ─────────────────────────────────────
{
  const svc = read(API, 'services', 'documentLinks.ts');
  checks += 1;
  assert.ok(
    !/from '\.\.\/db'|@prisma\/client/.test(svc),
    'documentLinks must stay pure. Every refusal is a sentence somebody reads, and a rule that '
    + 'needs a database to exercise is a rule nobody exercises.',
  );
}

// ── The refusals ─────────────────────────────────────────────────────────
{
  const badKind = planDocumentLinks({ ...base, target: 'vendor', requested: ['c1'], found: [OWN] });
  ok(badKind.ok === false && badKind.code === 'BAD_LINK_TARGET', 'only the three targets');

  const empty = planDocumentLinks({ ...base, requested: [], found: [] });
  ok(empty.ok === false && empty.code === 'NOTHING_TO_LINK', 'an empty request is refused');

  // The house rule this follows: a 400 naming what did not resolve, NOT a
  // silent drop and a success count.
  const missing = planDocumentLinks({ ...base, requested: ['c1', 'nope'], found: [OWN] });
  checks += 1;
  assert.ok(
    missing.ok === false && missing.code === 'LINK_TARGET_NOT_FOUND',
    'an id that does not resolve must refuse the whole request. setRiskControls and '
    + 'setServiceControls silently drop unresolvable ids and then report a success count, so a '
    + 'caller told "3 linked" when they asked for five cannot discover the other two.',
  );
  ok(/Nothing was linked/.test(missing.message), 'and must say nothing was written');

  const foreign = planDocumentLinks({ ...base, requested: ['c3'], found: [FOREIGN] });
  checks += 1;
  assert.ok(
    foreign.ok === false && foreign.status === 403 && foreign.code === 'LINK_TARGET_OUT_OF_SCOPE',
    'a policy cannot claim to govern another organisation\'s control. Beyond being wrong, it '
    + 'would disclose that control through this document\'s own screens.',
  );
  ok(/THEIRS-01/.test(foreign.message), 'and the refusal names it, not its uuid');

  const archived = planDocumentLinks({
    ...base, documentStatus: 'ARCHIVED', requested: ['c1'], found: [OWN],
  });
  checks += 1;
  assert.ok(
    archived.ok === false && archived.code === 'DOCUMENT_ARCHIVED',
    'an archived policy is a record of what applied. Adding to what it claims to govern would '
    + 'rewrite that record.',
  );

  const many = planDocumentLinks({
    ...base,
    requested: Array.from({ length: MAX_LINKS_PER_CALL + 1 }, (_, i) => `x${i}`),
    found: [],
  });
  ok(many.ok === false && many.code === 'TOO_MANY_LINKS', 'the blast-radius cap holds');
}

// ── What is allowed ──────────────────────────────────────────────────────
{
  const mine = planDocumentLinks({ ...base, requested: ['c1'], found: [OWN] });
  ok(mine.ok === true && mine.target === 'control', 'an own-tenant control links');
  checks += 1;
  assert.deepStrictEqual(mine.add, ['c1']);

  const lib = planDocumentLinks({ ...base, requested: ['c2'], found: [LIBRARY] });
  checks += 1;
  assert.ok(
    lib.ok === true,
    'a platform library row (tenantId null) is available to every organisation, the same rule '
    + 'projectStandards applies to a published framework',
  );

  // Duplicates in the request are a client quirk, not a 400.
  const dup = planDocumentLinks({ ...base, requested: ['c1', 'c1'], found: [OWN] });
  checks += 1;
  assert.deepStrictEqual(dup.add, ['c1'], 'a repeated id is tolerated and linked once');

  // Re-linking what is already linked changes nothing and says so.
  const again = planDocumentLinks({ ...base, requested: ['c1'], found: [OWN], existing: ['c1'] });
  checks += 1;
  assert.ok(
    again.ok === true && again.add.length === 0 && again.alreadyLinked.length === 1,
    're-linking an existing link is a no-op rather than an error',
  );
  ok(
    again.warnings.some((w) => /already linked/.test(w)),
    'and the caller is told nothing changed',
  );

  const partial = planDocumentLinks({
    ...base, requested: ['c1', 'c2'], found: [OWN, LIBRARY], existing: ['c1'],
  });
  checks += 1;
  assert.deepStrictEqual(partial.add, ['c2'], 'only the genuinely new ones are added');
  ok(partial.warnings.some((w) => /1 of them/.test(w)), 'and the skipped count is stated');

  for (const target of LINK_TARGETS) {
    const r = planDocumentLinks({
      ...base, target, requested: ['c1'], found: [OWN],
    });
    ok(r.ok === true && r.target === target, `${target} is a valid target`);
  }
}

// ── Reading a row back ───────────────────────────────────────────────────
{
  checks += 1;
  assert.strictEqual(targetOf({ controlId: 'x', riskId: null, clauseId: null }), 'control');
  checks += 1;
  assert.strictEqual(targetOf({ controlId: null, riskId: 'x', clauseId: null }), 'risk');
  checks += 1;
  assert.strictEqual(targetOf({ controlId: null, riskId: null, clauseId: 'x' }), 'clause');
  ok(targetOf({}) === null, 'a row pointing at nothing reads as nothing, not as a control');

  const sum = summariseLinks([
    { controlId: 'a' }, { controlId: 'b' }, { riskId: 'r' }, { clauseId: 'c' },
  ]);
  checks += 1;
  assert.deepStrictEqual(
    { c: sum.controls, r: sum.risks, k: sum.clauses, t: sum.total, n: sum.claimsNothing },
    { c: 2, r: 1, k: 1, t: 4, n: false },
  );

  const none = summariseLinks([]);
  checks += 1;
  assert.ok(
    none.claimsNothing === true,
    'governing nothing must be stated rather than left as a zero. A template that governs '
    + 'nothing and a security policy that should govern something are not the same, and a bare '
    + '"0" does not tell them apart.',
  );
}

// ── The schema ───────────────────────────────────────────────────────────
{
  ok(/model DocumentLink \{/.test(schema), 'the link must be modelled');

  for (const u of [
    '@@unique([documentId, controlId])',
    '@@unique([documentId, riskId])',
    '@@unique([documentId, clauseId])',
  ]) {
    ok(schema.includes(u), `${u} must stop the same pair being linked twice`);
  }
  for (const i of ['@@index([controlId])', '@@index([riskId])', '@@index([clauseId])']) {
    ok(
      schema.includes(i),
      `${i} must exist — "which policy governs this control" is the direction an auditor asks `
      + 'in, and is the one ControlClauseLink forgot to index',
    );
  }

  checks += 1;
  assert.ok(
    /linkedBy   User\?    @relation\("DocumentLinker", fields: \[linkedById\], references: \[id\], onDelete: SetNull\)/.test(schema),
    'the actor must be SetNull, not Cascade. Deleting a person must not delete the record of '
    + 'what they connected — which is what ProjectStandard and ProjectTaskClause both do.',
  );

  // Risk's own "linkage spine" gains its document vertebra.
  const riskAt = schema.indexOf('model Risk {');
  const riskBody = schema.slice(riskAt, schema.indexOf('\n}', riskAt));
  ok(/documentLinks/.test(riskBody), 'Risk must be reachable from a policy');

  const dir = path.join(API, '..', 'prisma', 'migrations');
  const mig = fs.readdirSync(dir).filter((d) => /document_links$/.test(d));
  ok(mig.length === 1, 'exactly one migration');
  const sql = fs.readFileSync(path.join(dir, mig[0], 'migration.sql'), 'utf8');
  checks += 1;
  assert.ok(
    !/\bDROP\b|ALTER COLUMN/i.test(sql),
    'the migration must be additive. This database holds signed acknowledgements and approval '
    + 'signatures, and a destructive statement is not recoverable by editing the file.',
  );
}

// ── The controller ───────────────────────────────────────────────────────
{
  ok(/planDocumentLinks\(\{/.test(ctrl), 'writes must go through the rule');
  ok(/skipDuplicates: true/.test(ctrl), 'and be idempotent');
  checks += 1;
  assert.ok(
    /DOCUMENT_LINKS_ADDED/.test(ctrl) && /DOCUMENT_LINK_REMOVED/.test(ctrl),
    'both directions must be audited — a claim that a policy covers a clause is an assertion '
    + 'with audit consequences',
  );
  checks += 1;
  assert.ok(
    /linked: plan\.add\.map\(\(x\) => labelOf\.get\(x\) \|\| x\)/.test(ctrl),
    'the audit payload must carry codes and refs, not uuids. An entry nobody can read without '
    + 'three more queries is an entry nobody reads.',
  );

  // A clause inherits tenancy from its standard.
  checks += 1;
  assert.ok(
    /tenantId: r\.standard\.tenantId/.test(ctrl),
    'a clause is reachable when its STANDARD is: a platform framework is available to everyone, '
    + 'a privately authored one is not',
  );

  ok(
    /export const governingDocuments/.test(ctrl),
    'the reverse direction must be served, or the link is write-only from one side',
  );
}

// ── Routed, and literals before the wildcard ─────────────────────────────
{
  for (const r of [
    "router.get('/:id/links', listDocumentLinks);",
    "router.post('/:id/links', requireCapability(CAP.VERSION_DOCUMENT), addDocumentLinks);",
    "router.delete('/links/:linkId', requireCapability(CAP.VERSION_DOCUMENT), removeDocumentLink);",
    "router.get('/link-options', linkOptions);",
    "router.get('/governing/:target/:targetId', governingDocuments);",
  ]) {
    ok(routes.includes(r), `${r} must be routed`);
  }

  const wildcard = routes.indexOf("router.get('/:id', getDocument);");
  for (const lit of ["router.get('/link-options'", "router.get('/governing/"]) {
    const at = routes.indexOf(lit);
    checks += 1;
    assert.ok(
      at > 0 && at < wildcard,
      `${lit} must be registered before the '/:id' wildcard. Segment counts happen to make one `
      + 'of these safe either way, but the rule worth keeping is "literals first", not the '
      + 'counting that makes an exception survive.',
    );
  }
}

// ── The screen ───────────────────────────────────────────────────────────
{
  checks += 1;
  assert.ok(
    /'reader' \| 'file' \| 'versions' \| 'approvals' \| 'governs'/.test(detail),
    'the document must have a fifth tab. It had exactly four and none concerned linkage.',
  );
  ok(/\/links`/.test(detail), 'which calls the endpoint');
  ok(/removeLink/.test(detail), 'and can remove a link');
  ok(
    /link-options/.test(detail),
    'and offers only what can be linked, from the server rather than a copy in the browser',
  );
  checks += 1;
  assert.ok(
    /does not say what it governs/.test(detail),
    'an unlinked policy must say so. A policy with no links cannot be shown as evidence for a '
    + 'clause, and that is worth stating rather than rendering an empty list.',
  );
}

// ── The guide stops promising what does not exist ────────────────────────
{
  checks += 1;
  assert.ok(
    !/in the document metadata to streamline audit evidence/.test(guide),
    'the guide told people to include framework mappings "in the document metadata". There was '
    + 'no such field, and there still is not — the mapping is a link, made on the Governs tab.',
  );
  checks += 1;
  assert.ok(
    !/side-by-side content changes, compliance clause coverage/.test(guide),
    'and described a review screen with a diff and clause coverage. It has neither.',
  );
  ok(
    /Governs tab/.test(guide),
    'the guide must point at the thing that now exists',
  );
  checks += 1;
  assert.ok(
    !/standardized code \(e\.g\. POL-SEC-001\) and map relevant regulatory standard clauses/.test(guide),
    'and the lifecycle step must describe where the mapping actually happens, rather than '
    + 'presenting it as part of creating the draft',
  );
}

console.log(
  `document-links: ${checks} assertions passed `
  + `(pure rules, targets: ${LINK_TARGETS.join(', ')}, cap ${MAX_LINKS_PER_CALL})`,
);
