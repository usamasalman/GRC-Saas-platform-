/**
 * Four defects reported from the running product, and the rules that keep them
 * fixed. Each one is the same shape: the screen showed something that was not
 * so, or did not say what was.
 *
 *   1. An impersonation request sat PENDING with nobody told. The register said
 *      "awaiting customer" and nothing else — not who could approve, not that
 *      anybody had been asked. The reporter, a Platform Super Admin, could find
 *      no way to act on it, which is correct (approval belongs inside the
 *      customer's tenant) and was indistinguishable from broken.
 *
 *   2. The user guide offered a working "Go to" on every feature in the
 *      platform. A user in the billing portal pressed the risk entry and landed
 *      on the Organization Risk Register — a screen in a portal that was not
 *      theirs, reached by setCurrentPage with no check of any kind.
 *
 *   3. The document reader put every attachment in an <iframe> under the words
 *      "LIVE IN-APP PDF READER". A browser frame does not render XLSX, DOCX,
 *      PPTX or ZIP, so the library's spreadsheet produced an empty box under a
 *      heading claiming to be reading it. A refused download was worse: the
 *      error was a console.warn and the pane fell through to a page laid out
 *      like a governance record.
 *
 *   4. The document library removed Edit, Checkout, Submit and Delete on any
 *      status outside DRAFT and RETURNED and said nothing, so the absence read
 *      as a permission problem — "only enabled for the Admin and the owner".
 *      The server refuses on STATUS alone.
 *
 *   node scripts/verify/reported-defects-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(API, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const impCtrl = code(read(API, 'controllers', 'impersonationController.ts'));
const impScreen = code(read(WEB, 'pages', 'impersonation', 'ImpersonationSessions.tsx'));
const shell = code(read(WEB, 'pages', 'AppShell.tsx'));
const guide = code(read(WEB, 'components', 'UserGuideModal.tsx'));
const detail = code(read(WEB, 'pages', 'documents', 'DocumentDetail.tsx'));
const library = code(read(WEB, 'pages', 'documents', 'DocumentLibrary.tsx'));
const docCtrl = code(read(API, 'controllers', 'documentController.ts'));
const deploy = read(WEB, '..', '.github', 'workflows', 'deploy.yml');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

// ─── 1. An impersonation request reaches somebody ───────────────────────────
{
  const request = impCtrl.slice(
    impCtrl.indexOf('export const requestSession'),
    impCtrl.indexOf('export const approveSession'),
  );

  ok(
    /const approvers = await approversFor\(subject\.tenantId, subject\.id\)/.test(request),
    'the request resolves who inside the customer tenant can authorise it',
  );
  ok(
    /await notify\(tx, approvers\.map\(/.test(request),
    'THE PACKET: and notifies them. A request written to a register and left to '
    + 'be noticed is a request that sits PENDING forever',
  );
  ok(
    /notifiedApprovers: approvers\.map\(\(a\) => a\.email\)/.test(request),
    'the audit entry names who was asked. "Nobody approved it" and "nobody could '
    + 'have approved it" are different findings',
  );
  ok(
    /approvers\.length > 0/.test(request) && /NOBODY at/.test(request),
    'THE PACKET: and a tenant where nobody holds the capability is told so at '
    + 'request time, rather than leaving a row that looks normal and never moves',
  );
  ok(
    /link: 'impersonation'/.test(request),
    'the notification points at the screen that can act on it',
  );

  // The subject cannot approve their own session — approveSession refuses it —
  // so offering their name as the person to chase would send somebody nowhere.
  ok(
    /excludeUserId/.test(impCtrl) && /if \(m\.id === excludeUserId\) continue;/.test(impCtrl),
    'the subject of a session is excluded from its approver list',
  );
  ok(
    /if \(await canApprove\(m\.id\)\) out\.push\(m\)/.test(impCtrl),
    'and membership is decided by the capability engine — the same call approve '
    + 'will make — rather than by matching role names',
  );

  const approve = impCtrl.slice(
    impCtrl.indexOf('export const approveSession'),
    impCtrl.indexOf('export const denySession'),
  );
  ok(
    /event: 'IMPERSONATION_APPROVED'/.test(approve) && /recipientId: session\.requestedById/.test(approve),
    'an approval reaches the requester, who is in another tenancy and has no '
    + 'reason to keep the register open',
  );

  const deny = impCtrl.slice(impCtrl.indexOf('export const denySession'));
  ok(
    /event: 'IMPERSONATION_DENIED'/.test(deny) && /recipientId: session\.requestedById/.test(deny),
    'and so does a refusal, which is the answer most worth delivering',
  );

  ok(
    !/req\.user!\.name/.test(impCtrl),
    'no notification is built from req.user.name — that field does not exist on '
    + 'the token payload and produced "undefined approved your request"',
  );
  ok(
    /async function actorName\(/.test(impCtrl),
    'the acting name is looked up instead',
  );

  const list = impCtrl.slice(
    impCtrl.indexOf('export const listSessions'),
    impCtrl.indexOf('export const requestSession'),
  );
  ok(
    /pendingApprovers: s\.status === 'PENDING' \? \(approverIndex\.get\(s\.tenantId\) \?\? \[\]\) : null/.test(list),
    'the register carries the approver list on pending rows only',
  );

  ok(
    !/awaiting customer/.test(impScreen),
    'THE PACKET: the screen no longer says only "awaiting customer", which read '
    + 'identically whether twelve people had been notified or none existed',
  );
  ok(
    /awaiting \{s\.pendingApprovers\[0\]\.name\}/.test(impScreen),
    'it names who is being waited on',
  );
  ok(
    /nobody at \{s\.tenant\.name\} can approve this/.test(impScreen),
    'and says plainly when the answer is that nobody there can',
  );
}

// ─── 2. The user guide cannot open a screen outside the portal ──────────────
{
  ok(
    /const reachableKeys = useMemo\(/.test(shell) && /const allNavKeys = useMemo\(/.test(shell),
    'AppShell derives what this account can reach and what any portal defines',
  );
  ok(
    /if \(allNavKeys\.has\(tabId\) && !reachableKeys\.has\(tabId\)\) return;/.test(shell),
    'THE PACKET: the guide\'s navigation is refused for a key in another portal. '
    + 'setCurrentPage was called with no check at all, which is how a finance '
    + 'user reached the Organization Risk Register',
  );
  ok(
    /reachableKeys\.has\(tabId\)/.test(shell) && /allNavKeys\.has\(tabId\)/.test(shell),
    'and an unknown key still passes — failing closed on unrecognised data is '
    + 'how one release turns into a product nobody can navigate',
  );

  ok(
    /const canOpen = \(tabId: string\): boolean =>/.test(guide),
    'the guide knows which features it can actually open',
  );
  ok(
    /if \(!reachableKeys \|\| !allNavKeys\) return true;/.test(guide),
    'a caller that does not supply the sets behaves as before rather than losing '
    + 'every button',
  );
  ok(
    /if \(!canOpen\(tabId\)\) return;/.test(guide),
    'and the jump handler checks too, because a jump can arrive from a workflow '
    + 'step or a related-feature chip, not only from a button',
  );

  const jumps = (guide.match(/handleJumpToTab\(/g) || []).length;
  ok(jumps >= 4, `the guide still offers its jumps (${jumps} call sites)`);
  ok(
    /Not in your portal — reference only/.test(guide),
    'a feature outside the portal reads as documentation and says so',
  );
  ok(
    /disabled=\{!canOpen\(st\.tabId\)\}/.test(guide),
    'a workflow step on somebody else\'s screen is shown but not offered — the '
    + 'walkthrough crosses portals by design',
  );
}

// ─── 3. The reader shows the file, or says why it cannot ────────────────────
{
  ok(
    /function browserCanRender\(/.test(detail),
    'the reader decides whether a browser frame can display this format',
  );
  ok(
    /RENDERABLE_MIME/.test(detail) && /RENDERABLE_EXT/.test(detail),
    'on the served content type, falling back to the extension when the server '
    + 'says only octet-stream',
  );
  ok(
    /pdfBlobUrl && browserCanRender\(previewMime, document\.fileName\)/.test(detail),
    'THE PACKET: the frame renders only what a frame can render. An XLSX in an '
    + 'iframe is an empty box under a heading claiming to be reading it',
  );
  ok(
    /cannot be displayed in the browser/.test(detail),
    'and a format it cannot show says so, rather than showing nothing',
  );
  ok(
    !/LIVE IN-APP PDF READER/.test(detail),
    'the pane no longer calls itself a live PDF reader while holding a spreadsheet',
  );

  ok(
    /setPreviewError\(/.test(detail),
    'THE PACKET: a refused download is shown',
  );
  ok(
    !/console\.warn\('\[PDF Blob Load Warning\]/.test(detail),
    'not swallowed into a console warning. That fell through to a canvas laid '
    + 'out like a governance record — a reader refused on retention, legal hold '
    + 'or need-to-know saw a document-shaped page and no refusal',
  );
  ok(
    /raw instanceof Blob/.test(detail),
    'and the server\'s message is read back out of the blob, because responseType '
    + 'blob turns the JSON refusal into bytes',
  );
  ok(
    /This file was not served/.test(detail),
    'the refusal is stated in the pane where the file would have been',
  );
}

// ─── 4. The library says why an action is missing ───────────────────────────
{
  ok(
    /Cannot edit a document in/.test(docCtrl),
    'the server refuses an edit on status',
  );
  ok(
    !/ownerId !== userId/.test(docCtrl.slice(
      docCtrl.indexOf('export const updateDocument'),
      docCtrl.indexOf('export const updateDocument') + 2000,
    )),
    'and NOT on ownership — the reading that the controls belong to "the Admin '
    + 'and the owner" is what the silence produced',
  );

  ok(
    /!\['DRAFT', 'RETURNED'\]\.includes\(doc\.status\)/.test(library),
    'THE PACKET: the row explains itself on any other status',
  );
  ok(
    /read-only while \{doc\.status/.test(library),
    'naming the status, which is the actual reason',
  );
  ok(
    /Editing resumes if it is returned/.test(library),
    'and saying what would change it, so nobody chases an access request that '
    + 'would not have helped',
  );
}

// ─── CI ─────────────────────────────────────────────────────────────────────
{
  ok(
    /reported-defects-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next '
    + 'packet can delete',
  );
}

console.log(`reported-defects: ${checks} assertions passed`);
