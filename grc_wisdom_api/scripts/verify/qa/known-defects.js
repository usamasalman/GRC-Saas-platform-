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
  'QA-001': {
    severity: 'High',
    title: 'Any member of an organisation can cancel anyone\'s running approval workflow',
    checks: ['write-guards:POST /api/itsm/workflows/runs/:id/cancel', 'isolation:cancel-others-workflow'],
  },
  'QA-003': {
    severity: 'High',
    title: 'Privileged legal matters are readable by every member of the organisation',
    checks: ['confidentiality:staff-reads-legal-matters', 'confidentiality:staff-reads-legal-matter-detail'],
  },
  'QA-004': {
    severity: 'Medium',
    title: 'Platform internals and platform-wide counts are served to customer users',
    checks: [
      'confidentiality:customer-reads-/api/system/health',
      'confidentiality:customer-reads-/api/system/security',
      'confidentiality:customer-reads-/api/system/brd',
    ],
  },
  'QA-005': {
    severity: 'Medium',
    title: 'Tool Review approve/reject calls a route that does not exist',
    checks: ['contract:PATCH /api/marketplace/tools/${tool.id}'],
  },
  'QA-006': {
    severity: 'Medium',
    title: 'Editing another organisation\'s branding writes the caller\'s own',
    // The GET shows the same fault from the read side: another organisation's
    // id returns the caller's own branding with a 200.
    checks: ['isolation:branding-write-lands-on-target', 'isolation:GET /api/tenants/:id/branding'],
  },
  'QA-007': {
    severity: 'Medium',
    title: 'The customer sign-in form is off-screen on a phone',
    checks: ['browser:login-form-visible-on-phone'],
  },
  'QA-008': {
    severity: 'Medium',
    title: 'The tenant screen reads plans through the database-admin console',
    checks: ['crawl:403 /api/admin/db/table/Plan'],
  },
  'QA-009': {
    severity: 'Medium',
    title: 'The web application can be framed by another site (no frame protection)',
    checks: ['headers:web-frame-protection'],
  },
  'QA-011': {
    severity: 'High',
    title: 'Invoices carry a placeholder ZATCA hash and QR; the real ZATCA code is never called',
    checks: ['journey:billing:the invoice hash is a real SHA-256', 'journey:billing:the QR is ZATCA TLV'],
  },
  'QA-010': {
    severity: 'Low',
    title: 'Tool Review is on the menu of a role that cannot approve tools',
    checks: ['menu:tool-review-gated'],
  },
  'QA-014': {
    severity: 'High',
    title: 'The user-management screen crashes the whole app on open (useAuth without an AuthProvider)',
    checks: ['browser:screen:User Lifecycle & Transfers', 'browser:screen:Users & Branch Transfers'],
  },
  'QA-015': {
    severity: 'High',
    title: 'Usage screens invent quotas, rules and imports on read, and are the slowest calls under load',
    checks: ['reads-write:GET /api/usage/quotas', 'reads-write:GET /api/usage/rules', 'reads-write:GET /api/usage/imports'],
  },
  'QA-016': {
    severity: 'Low',
    title: 'Reading plans or subscriptions creates the plan catalogue; two first reads at once can duplicate it',
    checks: ['reads-write:GET /api/billing/plans', 'reads-write:GET /api/billing/subscriptions'],
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
};
