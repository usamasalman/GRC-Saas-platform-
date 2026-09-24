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
 * The ids match docs/qa/defect-register.md, which carries the reproduction,
 * root cause and owner for each. Keep the two in step.
 */
module.exports = {
  'QA-011': {
    severity: 'High',
    title: 'Invoices carry a placeholder ZATCA hash and QR; the real ZATCA code is never called',
    checks: ['journey:billing:the invoice hash is a real SHA-256', 'journey:billing:the QR is ZATCA TLV'],
  },
  'QA-017': {
    severity: 'High',
    title: 'PDPL field encryption is marked Verified but never used, and its key is written in the source',
    checks: ['claims:REQ-08 PII is encrypted when it is stored', 'claims:REQ-08 the encryption key comes from configuration'],
  },
  'QA-018': {
    severity: 'High',
    title: 'OCI Riyadh data residency is marked Verified; the pipeline deploys to a Contabo server',
    checks: ['claims:REQ-12 the deployment is in OCI Riyadh'],
  },
  'QA-021': {
    severity: 'Medium',
    title: 'Lists stop at a fixed number of rows with no paging; records past the cap vanish silently',
    checks: ['capacity:lists that cap their rows can page past the cap'],
  },
};
