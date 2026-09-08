/**
 * Every request handler is on a route.
 *
 * A controller that is written, exported, typechecked and never registered is
 * invisible: `npx tsc` is happy, the function is covered by no test because no
 * test can reach it, and the only symptom is a 404 from a screen that calls it.
 * This exact mistake happened while adding the edit and delete endpoints --
 * updateIssue, deleteIssue, updateKri, deleteKri, updateSharedService and
 * deleteSharedService were all written and none were routed, and two of them
 * already had UI wired against them. It was caught by counting router.patch
 * lines and noticing the number was one higher instead of four.
 *
 * So: anything with the shape of an Express handler for an authenticated
 * request must appear in a route file, or be listed below as deliberately
 * unreachable with the reason.
 *
 *   node scripts/verify/routes-reachable-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', '..', 'src');

/**
 * Handlers that exist on purpose without a route.
 *
 * Each of these is a feature that was built and never wired up. They are listed
 * rather than fixed because reaching them is a product decision -- an API key
 * endpoint nobody can call is not the same kind of bug as a delete endpoint a
 * button already points at -- but they are listed rather than ignored so the
 * count cannot quietly grow.
 */
const KNOWN_UNREACHABLE = {
  'aiController.ts::askAiComplianceQuestion': 'AI assistant never exposed',
  'apiKeysController.ts::generateApiKey': 'API key management never exposed',
  'apiKeysController.ts::listApiKeys': 'API key management never exposed',
  'apiKeysController.ts::revokeApiKey': 'API key management never exposed',
  'auditorController.ts::exportAuditLogs': 'auditor export never exposed',
  'webhooksController.ts::registerWebhook': 'webhook registration never exposed',
};

/**
 * Only the router registrations, with the import blocks stripped out.
 *
 * Searching the whole file was the first attempt and it does not work: a
 * controller that is imported and then never registered still matches its own
 * import line, so the check passes on exactly the file it is meant to catch.
 * Verified by deleting a router.delete line and watching the test stay green.
 */
const routeSource = fs.readdirSync(path.join(SRC, 'routes'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => fs.readFileSync(path.join(SRC, 'routes', f), 'utf8'))
  .join('\n')
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']*';/g, '')
  .replace(/import\s+\w+\s+from\s*'[^']*';/g, '');

const handlers = [];
for (const file of fs.readdirSync(path.join(SRC, 'controllers')).sort()) {
  if (!file.endsWith('.ts')) continue;
  const src = fs.readFileSync(path.join(SRC, 'controllers', file), 'utf8');
  const re = /^export const (\w+) = async \(req: AuthenticatedRequest/gm;
  let m;
  while ((m = re.exec(src)) !== null) handlers.push({ file, fn: m[1] });
}

assert.ok(handlers.length > 100, `expected to find the controllers; found ${handlers.length}`);

const unreachable = [];
for (const h of handlers) {
  if (!new RegExp(`\\b${h.fn}\\b`).test(routeSource)) {
    unreachable.push(`${h.file}::${h.fn}`);
  }
}

const unexpected = unreachable.filter((k) => !(k in KNOWN_UNREACHABLE));
assert.deepStrictEqual(
  unexpected, [],
  'These handlers take a request and are on no route, so nothing can call them:\n'
  + unexpected.map((u) => `  ${u}`).join('\n')
  + '\n\nRegister them in src/routes, or add them to KNOWN_UNREACHABLE with the reason.',
);

// The other direction: an entry that is no longer unreachable should be removed
// from the list, otherwise it stops meaning anything.
const staleExemptions = Object.keys(KNOWN_UNREACHABLE).filter((k) => !unreachable.includes(k));
assert.deepStrictEqual(
  staleExemptions, [],
  `These are listed as unreachable but are now routed — drop them from KNOWN_UNREACHABLE:\n${
    staleExemptions.map((u) => `  ${u}`).join('\n')}`,
);

console.log(
  `routes-reachable: ${handlers.length} handlers checked, `
  + `${unreachable.length} known-unreachable, 0 unexpected`,
);
