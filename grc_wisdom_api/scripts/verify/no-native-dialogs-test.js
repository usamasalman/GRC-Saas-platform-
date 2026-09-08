/**
 * No browser dialogs in the frontend.
 *
 * window.alert, window.confirm and window.prompt render as "161.97.120.202
 * says" with the server's IP address at the top, which reads to a customer as
 * the machine talking rather than the product. They cannot be styled, cannot
 * explain what an action will do, cannot validate what was typed -- a prompt
 * can only report a problem AFTER closing, which is how "that is too short"
 * ends up as an alert on a screen the value has already left -- and they block
 * the whole tab while open.
 *
 * The replacements live in src/components: Dialog.tsx (ConfirmDialog,
 * PromptDialog, ReasonDialog), FormDialog.tsx for multi-field input, and
 * DeleteRecordButton.tsx for deletes. Errors belong in the page's inline banner
 * rather than in any dialog at all.
 *
 * There were 178 of these across 29 files. This is the ratchet that stops the
 * number going back up: the count may fall freely, and any increase fails.
 *
 *   node scripts/verify/no-native-dialogs-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const WEB = path.join(__dirname, '..', '..', '..', 'src');

/**
 * Occurrences in comments and string literals are prose, not calls.
 *
 * Several files legitimately mention these names while explaining why they are
 * gone -- Dialog.tsx's own header is the clearest case -- and counting those
 * would make the ratchet unfixable by writing a good comment.
 */
function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

const CALL = /\bwindow\.(alert|confirm|prompt)\s*\(/g;

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
})(WEB);

const offenders = [];
let total = 0;
for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  const code = stripCommentsAndStrings(raw);
  const hits = code.match(CALL);
  if (!hits) continue;
  total += hits.length;
  offenders.push({ file: path.relative(WEB, file), count: hits.length });
}
offenders.sort((a, b) => b.count - a.count);

/**
 * The high-water mark. Lower this as files are converted; never raise it.
 *
 * A budget rather than zero because the conversion is being done screen by
 * screen, and a half-migrated screen that mixes both kinds of dialog is worse
 * than either on its own -- so files are finished one at a time rather than all
 * at once.
 */
const BUDGET = 0;

if (total > BUDGET) {
  assert.fail(
    `${total} native browser dialog call${total === 1 ? '' : 's'} in the frontend, `
    + `budget is ${BUDGET}:\n`
    + offenders.map((o) => `  ${String(o.count).padStart(3)}  ${o.file}`).join('\n')
    + '\n\nUse components/Dialog.tsx, components/FormDialog.tsx or '
    + 'components/DeleteRecordButton.tsx. Errors go in the page\'s inline banner, '
    + 'not in a dialog with one OK button.',
  );
}

if (total < BUDGET) {
  assert.fail(
    `Only ${total} native dialog calls remain but the budget is still ${BUDGET}. `
    + 'Lower BUDGET in this file to lock the improvement in — a ratchet that is not '
    + 'tightened lets the count creep back up to the old number.',
  );
}

console.log(
  `no-native-dialogs: ${files.length} files scanned, ${total} calls (budget ${BUDGET})`,
);
