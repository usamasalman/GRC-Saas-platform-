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
  'QA-019': {
    severity: 'Medium',
    title: 'The request limit is per network address, so one office of about 25 busy people is refused',
    checks: ['capacity:the request limit is counted per person, not per office address'],
  },
  'QA-020': {
    severity: 'Medium',
    title: 'Failed sign-ins are counted per address: ten typos in one office lock everyone there out',
    checks: ['capacity:failed sign-ins lock an account, not an office'],
  },
  'QA-021': {
    severity: 'Medium',
    title: 'Lists stop at a fixed number of rows with no paging; records past the cap vanish silently',
    checks: ['capacity:lists that cap their rows can page past the cap'],
  },
  'QA-022': {
    severity: 'Medium',
    title: 'Verifying the audit trail loads the whole history into memory; at scale one click can exhaust it',
    checks: ['capacity:verifying the audit trail reads in batches'],
  },
  'QA-023': {
    severity: 'Low',
    title: 'Background jobs start in every API process, so a second process would run every job twice',
    checks: ['capacity:background jobs can be confined to one process'],
  },
  'QA-024': {
    severity: 'Medium',
    title: 'The platform dashboard shows invented figures: fallback counts and trends written into the page',
    checks: ['claims:dashboards show only figures they computed'],
  },
};
