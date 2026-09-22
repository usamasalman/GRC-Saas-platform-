/**
 * Anyone who edited a version cannot approve it, by either route.
 *
 * SoD looked at DOCUMENT_CREATED and DOCUMENT_CHECKED_IN. The library Edit
 * modal writes DOCUMENT_UPDATED against the current version without a
 * checkout, so a co-editor who used it was never the checkout holder, passed
 * the rule, and could approve the words they typed. createdById is one person.
 * Approval has to test the set of everybody who actually wrote the version.
 *
 *   node scripts/verify/document-editors-test.js
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
const svcSrc = read(API, 'services', 'documentEditors.ts');
const ctrl = code(read(API, 'controllers', 'documentController.ts'));
const library = code(read(WEB, 'pages', 'documents', 'DocumentLibrary.tsx'));
const deploy = read(WEB, '..', '.github', 'workflows', 'deploy.yml');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

const {
  versionEditorIds, selfApprovalRefusal, approversWhoDidNotEdit, EDITOR_VIA,
} = require('../../dist/services/documentEditors');

// ── The rules run without a database ─────────────────────────────────────
{
  ok(
    !/\bfrom ['"]@prisma\/client['"]|require\(['"]@prisma/.test(svcSrc)
    && !/from ['"]\.\.\/db['"]/.test(svcSrc),
    'documentEditors must stay pure. A rule that needs a database to exercise is a rule nobody exercises.',
  );
}

// ── The editor set is a set, not the checkout holder ─────────────────────
{
  const ids = versionEditorIds({
    createdById: 'u-checkout',
    editors: [{ userId: 'u-checkout' }, { userId: 'u-modal' }, { userId: 'u-modal' }],
  });
  ok(ids.includes('u-checkout') && ids.includes('u-modal'), 'checkout holder and modal editor are both on the set');
  ok(ids.filter((id) => id === 'u-modal').length === 1, 'the same person is not listed twice');
  ok(
    versionEditorIds({ createdById: null, editors: [] }).length === 0,
    'an empty set is empty — it is not invented',
  );
}

// ── Approval is refused for anyone on that set ───────────────────────────
{
  const editors = ['u-author', 'u-modal'];
  const modal = selfApprovalRefusal('u-modal', editors);
  ok(modal && modal.status === 403 && modal.code === 'SELF_APPROVAL', 'the Edit-modal editor cannot approve');
  ok(/edited this version/.test(modal.message), 'the refusal names why');

  const checkin = selfApprovalRefusal('u-author', editors);
  ok(checkin && checkin.code === 'SELF_APPROVAL', 'the checkout holder cannot approve either');

  ok(selfApprovalRefusal('u-other', editors) === null, 'someone who did not write it still can');
  ok(
    selfApprovalRefusal('u-modal', []) === null,
    'an empty set is not "nobody wrote it" — we do not know, so this refusal stays silent and SoD still runs',
  );
}

// ── Submit cannot nominate the people who wrote it ───────────────────────
{
  const cleaned = approversWhoDidNotEdit(
    ['u-owner', 'u-modal', 'u-reviewer', 'u-modal', ''],
    ['u-modal'],
    'u-owner',
  );
  assert.deepStrictEqual(cleaned, ['u-reviewer']);
  checks += 1;
}

ok(EDITOR_VIA.UPDATE === 'UPDATE' && EDITOR_VIA.CHECKIN === 'CHECKIN' && EDITOR_VIA.CREATE === 'CREATE',
  'the three write routes have names, so a typo cannot invent a fourth');

// ── The table exists, and it is a set per version ────────────────────────
{
  ok(/model DocumentVersionEditor/.test(schema), 'the editor set is a model, not a comment');
  ok(/@@unique\(\[versionId, userId\]\)/.test(schema), 'one row per person per version');
  ok(
    /editors\s+DocumentVersionEditor\[\]/.test(schema)
    && /model DocumentVersion \{[\s\S]*?editors\s+DocumentVersionEditor/.test(schema),
    'the set hangs off the version, not the document, so a later version does not inherit the last one\'s editors',
  );
}

// ── Both write routes record, and approval tests the set ─────────────────
{
  ok(
    /rememberEditor\(tx,\s*version\.id,\s*userId,\s*EDITOR_VIA\.CREATE\)/.test(ctrl),
    'creating a document records the author on v1.0',
  );
  ok(
    /rememberEditor\(tx,\s*current\.id,\s*userId,\s*EDITOR_VIA\.UPDATE\)/.test(ctrl),
    'the Edit modal records the co-editor on the current version',
  );
  ok(
    /rememberEditor\(tx,\s*version\.id,\s*userId,\s*EDITOR_VIA\.CHECKIN\)/.test(ctrl),
    'check-in records the checkout holder on the new version',
  );
  ok(
    /selfApprovalRefusal\(userId,\s*editorIds\)/.test(ctrl)
    && /approveDocument/.test(ctrl),
    'approve tests the editor set, not only the audit log of checkout',
  );
  ok(
    /approversWhoDidNotEdit\(approvers,\s*editorIds,\s*doc\.ownerId\)/.test(ctrl),
    'submit will not put an editor on the queue just to have approve refuse them',
  );
  ok(
    /error\?\.code === 'SELF_APPROVAL'/.test(ctrl),
    'a self-approval is rethrown as 403, not swallowed into a 500',
  );
}

// ── The hole is still there in the UI, on purpose ────────────────────────
{
  ok(
    /put\(`\/api\/documents\/\$\{editingDoc\.id\}`/.test(library),
    'the library still has an Edit modal that PUTs without checkout — that is the route we now record',
  );
  ok(
    /post\(`\/api\/documents\/\$\{docId\}\/checkin`/.test(library),
    'and a check-in route — that is the other one',
  );
}

ok(
  /document-editors-test\.js/.test(deploy),
  'CI must run this. A rule that is not in the workflow is a rule that can be deleted by the next packet.',
);

console.log(`document-editors-test: ${checks} assertions passed`);
