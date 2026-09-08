/**
 * Which capability a menu entry needs before it is worth showing.
 *
 * The sidebar rendered every entry in a portal to every role, so a read-only
 * auditor saw Manage Tenants, Roles & Permissions, Subscriptions and Feature
 * Flags, and discovered which of them were real by clicking one and reading a
 * 403. That is the reported problem: "if any user have specific roles and read
 * only thing so there only that thing in that portal nothing extra".
 *
 * Two things this is not.
 *
 * It is not a permission check. The server checks the grants on every route
 * regardless of what the menu shows, and it is the only thing that decides. If
 * this file and the API ever disagree, the API wins and the user gets a 403 —
 * which is the correct failure, just an ugly one. Hiding an entry is a courtesy.
 *
 * It is not a list of everything. A key absent from this map is always shown,
 * which is deliberate: most of the product is a register that any member of the
 * tenant may read, and read is not a capability in this model — the grants
 * describe acts, not screens. Listing every key would mean inventing view
 * capabilities that the server does not enforce, and a menu filtered on
 * permissions nothing checks is worse than an unfiltered one, because it looks
 * like security.
 *
 * So only entries whose whole purpose is an administrative act appear here. A
 * screen someone can usefully read stays visible; what they cannot do on it is
 * already hidden by the buttons themselves.
 */

export const CAP = {
  MANAGE_TENANT: 'create-or-manage-a-tenant',
  ADD_USER: 'add-a-user-with-role-based-access',
  MAINTAIN_ROLES: 'maintain-roles-and-permissions',
  TRANSFER_USER: 'transfer-a-user-between-branches-or-entities',
  MONITOR_SECURITY: 'monitor-security-and-handle-incidents',
  GOVERN_FLAG: 'govern-a-feature-flag',
  PUBLISH_MODULE: 'publish-or-enable-a-module',
  MANAGE_SUBSCRIPTION: 'manage-a-subscription',
  SELECT_PLAN: 'create-or-select-a-commercial-plan',
  REVIEW_INVOICE: 'generate-or-review-an-invoice',
  RECONCILE_PAYMENT: 'record-and-reconcile-a-payment',
  MONITOR_QUOTAS: 'monitor-resource-usage-and-quotas',
  MANAGE_IMPLEMENTATION: 'manage-a-control-implementation-and-evidence',
  ENABLE_STANDARD: 'import-or-enable-a-standard',
  ASSESS_RISK: 'assess-and-treat-a-risk',
  EXECUTE_AUDIT: 'plan-and-execute-an-audit',
  ASSESS_VENDOR: 'assess-and-remediate-a-vendor',
  MAINTAIN_ASSET: 'maintain-an-asset',
  VERSION_DOCUMENT: 'create-import-and-version-a-document',
  SIGN_DOCUMENT: 'review-approve-and-digitally-sign-a-document',
  RETENTION_HOLD: 'apply-retention-and-legal-hold',
  RESOLVE_TICKETS: 'manage-and-resolve-support-tickets',
  CREATE_TICKET: 'create-an-itsm-ticket',
  REPORT: 'generate-and-distribute-a-report',
  OPERATE_SECURITY_SERVICES: 'operate-wisdom-eye-and-eye-phish',
  ONBOARD_TOOL: 'onboard-or-purchase-an-open-source-tool',
  MANAGE_PROJECT: 'manage-a-delivery-project',
  EXECUTE_PROJECT_WORK: 'execute-project-work',
  VERIFY_PROJECT_WORK: 'verify-project-delivery',
} as const;

/**
 * nav key → the capabilities that make the entry worth showing.
 *
 * Any one of them is enough. Several screens are reachable by more than one
 * duty — the risk register is used by whoever assesses risk and by whoever runs
 * the audit that reads it — and requiring all of them would hide the screen
 * from both.
 */
export const NAV_CAPABILITY: Record<string, readonly string[]> = {
  // Platform administration. Nothing on these screens is readable in a useful
  // sense without the corresponding duty.
  tenants: [CAP.MANAGE_TENANT],
  'asm-tenants': [CAP.MANAGE_TENANT, CAP.OPERATE_SECURITY_SERVICES],
  impersonation: [CAP.MANAGE_TENANT],
  'role-matrix': [CAP.MAINTAIN_ROLES],
  'saas-users': [CAP.ADD_USER],
  'org-users': [CAP.ADD_USER],
  'branch-users': [CAP.ADD_USER],
  'user-admin': [CAP.ADD_USER, CAP.TRANSFER_USER],
  'feature-flags': [CAP.GOVERN_FLAG],

  // Billing. A tenant that cannot see its own invoices cannot reconcile them,
  // so the read-heavy entries take the review and reconcile duties too.
  subscriptions: [CAP.MANAGE_SUBSCRIPTION],
  plans: [CAP.SELECT_PLAN, CAP.MANAGE_SUBSCRIPTION],
  invoices: [CAP.REVIEW_INVOICE, CAP.RECONCILE_PAYMENT],
  'wholesale-billing': [CAP.REVIEW_INVOICE, CAP.RECONCILE_PAYMENT],
  payments: [CAP.RECONCILE_PAYMENT],
  'payment-gateway': [CAP.RECONCILE_PAYMENT],
  quotas: [CAP.MONITOR_QUOTAS],

  // Modules and tooling.
  marketplace: [CAP.PUBLISH_MODULE, CAP.ONBOARD_TOOL],
  'tool-marketplace': [CAP.ONBOARD_TOOL],
  'tool-review': [CAP.ONBOARD_TOOL, CAP.PUBLISH_MODULE],
  'tool-installations': [CAP.ONBOARD_TOOL],
  'standard-repository': [CAP.ENABLE_STANDARD],
  'tenant-standards': [CAP.ENABLE_STANDARD],
  'framework-authoring': [CAP.ENABLE_STANDARD],

  // Security services are a separate product surface, not a view of this one.
  'wisdom-eye': [CAP.OPERATE_SECURITY_SERVICES],
  'eye-phish': [CAP.OPERATE_SECURITY_SERVICES],
  security: [CAP.MONITOR_SECURITY],

  // Governance of documents. The library itself is deliberately absent: reading
  // policy is most of what a document management system is for.
  retention: [CAP.RETENTION_HOLD],
  'legal-hold': [CAP.RETENTION_HOLD],

  // Service desk. Raising a ticket is a lower bar than working the queues.
  'ticket-queues': [CAP.RESOLVE_TICKETS],
  'service-catalog': [CAP.RESOLVE_TICKETS, CAP.CREATE_TICKET],
  sla: [CAP.RESOLVE_TICKETS],

  // Delivery. Verifying is held apart from managing on purpose, so a client-side
  // reviewer who may only confirm work still reaches the screen.
  'project-delivery': [CAP.MANAGE_PROJECT, CAP.EXECUTE_PROJECT_WORK, CAP.VERIFY_PROJECT_WORK],

  // Reporting and exports.
  exports: [CAP.REPORT],
  brd: [CAP.REPORT, CAP.MANAGE_TENANT],
};

/**
 * Whether a menu entry should appear.
 *
 * Unmapped keys are shown. So is everything, if the capability list is missing
 * altogether — an older token that predates this field, or a response shape
 * that changed, should degrade to the menu working as it did before rather than
 * to a person signing in and finding an empty sidebar. The API is still
 * enforcing either way.
 */
export function navVisible(key: string, capabilities: string[] | null | undefined): boolean {
  if (!capabilities) return true;
  const required = NAV_CAPABILITY[key];
  if (!required) return true;
  return required.some((c) => capabilities.includes(c));
}
