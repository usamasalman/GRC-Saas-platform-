/**
 * Open defects, each pinned to the check that reproduces it.
 *
 * This is how a found defect stays found. Every QA suite runs its checks and
 * reports each failure against this list:
 *
 *   - a failing check with an entry here is a KNOWN defect and does not fail
 *     the build — it is already recorded, owned and prioritised;
 *   - a failing check with NO entry here is a NEW defect and fails the build;
 *   - a check with an entry here that now PASSES fails the build too, with a
 *     message saying the defect looks fixed. Remove the entry, and mark it
 *     Fixed in docs/qa/defect-register.md. A list that is never pruned stops
 *     meaning anything.
 *
 * The entries live in src/qa/known-defects.json, because the product reads
 * them too: the BRD Traceability screen shows a requirement as Verified only
 * while no open defect names it in `requirements`. So the screen and the build
 * cannot disagree about what is known to be broken. Edit that file; this one
 * only loads it.
 *
 * The ids match docs/qa/defect-register.md, which carries the reproduction,
 * root cause and owner for each. Keep the two in step.
 */
module.exports = require('../../../src/qa/known-defects.json');
