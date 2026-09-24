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
 * screen someone can usefully read stays visible.
 *
 * An earlier version of this comment finished that sentence with "what they
 * cannot do on it is already hidden by the buttons themselves". That was not
 * true and is worth recording as false, because the narrowing below was partly
 * justified by it: no button in this frontend reads capabilities. Every action
 * renders for every role and fails at the API. Until a guard exists around
 * destructive and administrative controls, leaving a screen visible means
 * leaving its buttons visible too -- which is how a Platform Security Admin was
 * shown a Delete on controls that their role can never use.
 */

export const CAP = {
  MANAGE_TENANT: 'create-or-manage-a-tenant',
  ADD_USER: 'add-a-user-with-role-based-access',
  MAINTAIN_ROLES: 'maintain-roles-and-permissions',
  TRANSFER_USER: 'transfer-a-user-between-branches-or-entities',
  OFFBOARD_USER: 'offboard-a-user-with-handover',
  MONITOR_SECURITY: 'monitor-security-and-handle-incidents',
  READ_AUDIT_TRAIL: 'read-the-tenant-audit-trail',
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
  AUTHOR_WORKFLOW: 'create-an-approval-or-automation-workflow',
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
 * nav key -> the capabilities that make the entry worth showing.
 *
 * Any one of them is enough. Several screens are reachable by more than one
 * duty, and requiring all of them would hide the screen from everybody.
 *
 * Deliberately short. The first version gated 34 entries, including the whole
 * of Subscriptions & Billing, quotas, the tool marketplace, the security
 * services and the service desk. That was wrong twice over.
 *
 * It contradicted the rule written above it: every one of those screens has an
 * unguarded GET, so any signed-in user may already read the data. Hiding a
 * readable screen is not enforcement, it is just concealment.
 *
 * And it produced an absurd result for the one role that matters most here.
 * platform-super-admin holds 14 of the 29 capabilities, because billing belongs
 * to platform-billing-admin and the service desk to platform-service-desk-manager
 * by deliberate separation of duties -- so the platform owner signed in to their
 * own control plane and found half of it missing.
 *
 * What is left is administration: of tenants, users, roles and flags, and of
 * the commercial relationship. A read-only auditor no longer sees Manage
 * Tenants or Roles & Permissions, and a compliance officer no longer sees
 * Invoices. Everything operational stays visible, and what a person cannot do
 * on it is hidden by the buttons on the screen itself -- see Can.tsx, which is
 * the guard that claim needed and did not have.
 */
export const NAV_CAPABILITY: Record<string, readonly string[]> = {
  // Creating tenants, taking over a session, granting access, changing what a
  // role may do, turning features on for other people. There is nothing on
  // these worth reading without the duty behind them.
  tenants: [CAP.MANAGE_TENANT],
  impersonation: [CAP.MANAGE_TENANT],
  'role-matrix': [CAP.MAINTAIN_ROLES],
  'saas-users': [CAP.ADD_USER],
  'org-users': [CAP.ADD_USER],
  'branch-users': [CAP.ADD_USER],
  'user-admin': [CAP.ADD_USER, CAP.TRANSFER_USER],
  'feature-flags': [CAP.GOVERN_FLAG],
  // The screen exists to approve or reject a tool, and the API refuses that
  // without the onboarding duty; it was on the menu for everyone (QA-010).
  'tool-review': [CAP.ONBOARD_TOOL],

  // The exception to the rule written at the top of this file.
  //
  // Every other entry here gates an administrative ACT, because a register
  // anybody may read should stay visible and hiding it would be concealment
  // rather than enforcement. GET /api/audit-logs is the one read the server
  // now genuinely refuses: the trail carries the substance of what everybody
  // did, in the raw payload of each entry, and a contributor on one register
  // could read who was offboarded last month.
  //
  // So this pair is not concealment. Someone without the capability gets a 403
  // from the API, and hiding the entry spares them clicking into it to find out.
  logs: [CAP.READ_AUDIT_TRAIL],
  'hash-check': [CAP.READ_AUDIT_TRAIL],
  // The second such read. A legal matter's title and description are counsel's
  // privileged work, and the API now refuses them without the legal-hold duty
  // (QA-003). Why a single document is held stays readable to everyone, from
  // the document itself.
  'legal-hold': [CAP.RETENTION_HOLD],

  // Commercial administration. Tracker issues 11 to 17 are seven reports of
  // one sentence -- "he has nothing to do with this" -- against exactly these
  // entries, and issue 6 is the same complaint from the other direction: an
  // invoice raised from a Group Admin account instead of finance.
  //
  // A first attempt at this was reverted because it hid billing from
  // platform-super-admin, which looked absurd. It was not absurd: the owner's
  // own role matrix puts billing on platform-billing-admin and keeps it off
  // the super admin, and that separation is what issue 6 asks for. If the
  // platform owner should see billing, the fix is to grant the capability in
  // Roles & Permissions, where the decision is visible and audited -- not to
  // have the menu ignore what the matrix says.
  //
  // Unlike the operational registers, these screens exist to perform
  // commercial acts, and every act on them is capability-checked server-side.
  // Gating them is not concealment of a readable screen; it is the menu
  // agreeing with the API about whose job this is.
  //
  // Each portal keeps them through its own finance role: platform-billing-admin,
  // group-finance-manager, finance-manager, branch-finance-user, partner-owner.
  subscriptions: [CAP.MANAGE_SUBSCRIPTION],
  // A subscription manager has to read the catalogue they are subscribing to.
  plans: [CAP.SELECT_PLAN, CAP.MANAGE_SUBSCRIPTION],
  invoices: [CAP.REVIEW_INVOICE, CAP.RECONCILE_PAYMENT],
  'wholesale-billing': [CAP.REVIEW_INVOICE, CAP.MANAGE_SUBSCRIPTION],
  payments: [CAP.RECONCILE_PAYMENT, CAP.REVIEW_INVOICE],
  'payment-gateway': [CAP.RECONCILE_PAYMENT],
  quotas: [CAP.MONITOR_QUOTAS],
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

/**
 * What the server requires before a write succeeds on each register.
 *
 * Mirrors the guards in grc_wisdom_api/src/routes/grcRoutes.ts so that a
 * control can be hidden from someone the API would refuse. Holding any one of
 * the listed capabilities is enough, which is what requireAnyCapability means
 * on the routes themselves.
 *
 * These sets are wider than they look, on purpose, and the width is the
 * server's decision rather than a convenience here. Maintaining the asset
 * inventory admits MANAGE_IMPLEMENTATION and ASSESS_RISK because the inventory
 * is the first step of both; gating it on MAINTAIN_ASSET alone left only Asset
 * Owner able to add an asset. Copying a narrower rule into the browser would
 * hide a button that works.
 *
 * Kept in step with the routes by scripts/verify/guarded-actions-test.js, which
 * reads both files and fails when they disagree. Drift here is worse than no
 * guard at all: a widened route with a stale entry hides a control the person
 * is entitled to, and nothing in the product would say why.
 */
export const MAY = {
  /** POST, PATCH, DELETE /api/grc/risks and everything beneath a risk. */
  MANAGE_RISK: [CAP.ASSESS_RISK],
  /** POST, PATCH, DELETE /api/grc/assets. */
  MAINTAIN_ASSET: [CAP.MAINTAIN_ASSET, CAP.MANAGE_IMPLEMENTATION, CAP.ASSESS_RISK],
  /** POST, PATCH, DELETE /api/grc/vendors and vendor assessments. */
  MANAGE_VENDOR: [CAP.ASSESS_VENDOR, CAP.ASSESS_RISK, CAP.MANAGE_IMPLEMENTATION, CAP.MANAGE_TENANT],
  /** POST, PATCH, DELETE /api/grc/issues. */
  MANAGE_ISSUE: [CAP.EXECUTE_AUDIT, CAP.MANAGE_IMPLEMENTATION, CAP.MONITOR_SECURITY],
  /** Answering a finding — the side being audited, not the auditor. */
  RESPOND_TO_ISSUE: [CAP.MANAGE_IMPLEMENTATION, CAP.ASSESS_RISK, CAP.MANAGE_TENANT],
  /** Assigning a corrective action plan against a finding. */
  ASSIGN_CAP: [CAP.EXECUTE_AUDIT, CAP.MANAGE_IMPLEMENTATION],
  /** Closing, reopening and escalating an issue — audit's decision alone. */
  CLOSE_ISSUE: [CAP.EXECUTE_AUDIT],
  /** POST /api/documents/:id/publish — issuing a policy to its readers. */
  SIGN_DOCUMENT: [CAP.SIGN_DOCUMENT],
  /**
   * POST /api/retention/documents/:id/dispose, and everything that sets how
   * long a record is kept. Destroying a record and deciding when it may be
   * destroyed are the same decision a month apart, so they carry one grant.
   */
  DISPOSE_RECORD: [CAP.RETENTION_HOLD],
  /**
   * POST /api/iam/users/:id/offboard — handing over everything somebody owned
   * and ending their access. Not ADD_USER, which merely suspends.
   */
  OFFBOARD_USER: [CAP.OFFBOARD_USER],
  /**
   * POST /api/itsm/workflows and /api/itsm/sla-policies — authoring the
   * approval routes other people then have to follow, and setting the targets
   * every SLA figure is measured against.
   */
  AUTHOR_WORKFLOW: [CAP.AUTHOR_WORKFLOW],
  /** POST, PATCH, DELETE /api/grc/standards and /api/grc/clauses. */
  AUTHOR_STANDARD: [CAP.ENABLE_STANDARD],
  /** POST, PATCH, DELETE /api/grc/controls and clause mapping. */
  AUTHOR_CONTROL: [CAP.ENABLE_STANDARD, CAP.MANAGE_IMPLEMENTATION],
  /** POST, PATCH /api/grc/implementations and evidence. */
  MANAGE_IMPLEMENTATION: [CAP.MANAGE_IMPLEMENTATION],
  /** Staffing a delivery engagement: POST/PATCH/DELETE /api/projects/:id/members. */
  MANAGE_PROJECT: [CAP.MANAGE_PROJECT],
  /**
   * Executing project work: attaching evidence, updating task status, submitting.
   * Mirrors requireCapability(CAP.EXECUTE_PROJECT_WORK) on attachEvidence and
   * related task-execution routes. MANAGE_PROJECT is a separate, heavier guard.
   */
  EXECUTE_WORK: [CAP.EXECUTE_PROJECT_WORK],
  /** POST, PATCH, DELETE /api/grc/shared-services. */
  MANAGE_SHARED_SERVICE: [CAP.MANAGE_TENANT, CAP.MANAGE_IMPLEMENTATION],
} as const;
