# GRC Wisdom — Routes Map (`routes.md`)

> **Generated**: 2026-07-27 — verified against `App.tsx`, `AppShell.tsx`, `app.ts`, and all controllers.

---

## 1. Frontend Routes (React Router)

| Path Pattern | Component | File | Description |
|---|---|---|---|
| `/` | `PortalDirectory` | `src/pages/PortalDirectory.tsx` | Landing page — 8 portal selection cards |
| `/login/:portalId` | `PortalLogin` | `src/pages/PortalLogin.tsx` | Per-portal login with demo identity picker |
| `/app/*` | `AppShell` | `src/pages/AppShell.tsx` | Main dashboard — internal nav via state |
| `*` (catch-all) | `Navigate to /` | `src/App.tsx` | Redirect unknown routes to landing |

### Valid `portalId` Values

`saas` · `holding` · `multibranch` · `branch` · `document` · `auditor` · `partner` · `franchise`

### Unused Pages (Defined but NOT in Router)

| Component | File | Purpose |
|---|---|---|
| `LoginGateway` | `src/pages/LoginGateway.tsx` | Real-API JWT login form |
| `SaasPortal` | `src/pages/SaasPortal.tsx` | Alternative SaaS admin dashboard |

---

## 2. AppShell Internal Navigation (State-Based, Not URL)

The `AppShell.tsx` uses an `activePage` state string. Clicking a sidebar item sets this state, which determines the HTML output of `renderMockView(activePage, account, apiData)`.

### SaaS Admin Portal (`portal = "saas"`)

| Section | Page Key | Label |
|---|---|---|
| Platform Control | `dashboard` | SaaS Dashboard |
| | `tenants` | Manage Tenants |
| | `impersonation` | Impersonation Sessions |
| Users, Teams & Access | `saas-users` | SaaS Admin Users |
| | `org-users` | Organization Users |
| | `branch-users` | Branch Users |
| | `team-directory` | Teams & Departments |
| | `user-admin` | User Lifecycle & Transfers |
| | `role-matrix` | Roles & Permissions |
| Service Management | `itsm` | ITSM Service Desk |
| | `ticket-queues` | Ticket Queues |
| | `service-catalog` | Service Catalog |
| | `sla` | SLA & Escalations |
| | `knowledge` | Knowledge Base |
| Security Services | `wisdom-eye` | Wisdom Eye ASM |
| | `eye-phish` | Eye Phish |
| | `asm-tenants` | Security Service Tenants |
| Modules & Entitlements | `marketplace` | GRC Module Marketplace |
| | `tool-marketplace` | Open Source Tool Marketplace |
| | `tool-review` | Tool Review & Approval |
| | `tool-installations` | Tenant Tool Installations |
| | `standard-repository` | Standard Repository |
| | `tenant-standards` | Tenant Standard Enablement |
| | `feature-flags` | Feature Flags |
| Subscriptions & Billing | `subscriptions` | Subscriptions |
| | `plans` | Plans & Catalogue |
| | `invoices` | Invoices |
| | `payments` | Payments |
| | `payment-gateway` | Payment Gateway & Tax |
| Usage & Automation | `quotas` | Resource Usage & Quotas |
| | `automation` | Rules, Jobs & Execution |
| | `imports` | Imports & Migration |
| System & Infrastructure | `health` | Health, Jobs & API Status |
| | `security` | Platform Security |
| | `architecture` | OCI Riyadh Architecture |
| | `brd` | BRD Traceability |

### Holding / Group Portal (`portal = "holding"`)

| Section | Page Key | Label |
|---|---|---|
| Group Control Plane | `dashboard` | Group Dashboard |
| | `hierarchy` | Group Hierarchy |
| | `subsidiaries` | Subsidiary Scorecards |
| | `shared-services` | Shared Services |
| Assurance | `tasks` | To Do & Approvals |
| | `standards` | Group Standards |
| | `controls` | Mandated Controls |
| | `implementations` | Implementations & Evidence |
| | `risk` | Group Risk |
| | `audits` | Group Audit Programme |
| | `vendors` | Group Vendor Master |
| People & Support | `team-directory` | Group Teams |
| | `user-admin` | Users & Entity Transfers |
| | `role-matrix` | Roles & Permissions |
| | `itsm` | ITSM Service Desk |
| | `knowledge` | Knowledge Base |
| Security Services | `wisdom-eye` | Wisdom Eye ASM |
| | `eye-phish` | Eye Phish |
| Services & Billing | `marketplace` | GRC Module Marketplace |
| | `tool-marketplace` | Open Source Tool Marketplace |
| | `invoices` | Invoices |
| | `payments` | Payments |

### Multi-Branch Portal (`portal = "multibranch"`)

| Section | Page Key | Label |
|---|---|---|
| Organization Control | `dashboard` | Organization Dashboard |
| | `branches` | Branch Scorecards |
| | `branch-lifecycle` | Branch Lifecycle |
| Assurance | `tasks` | To Do & Approvals |
| | `standards` | Organization Standards |
| | `controls` | Mandated Controls |
| | `implementations` | Implementations & Evidence |
| | `risk` | Consolidated Risk |
| | `audits` | Consolidated Audits |
| | `vendors` | Consolidated Vendors |
| People & Support | `team-directory` | Teams & Departments |
| | `user-admin` | Users & Branch Transfers |
| | `role-matrix` | Roles & Permissions |
| | `itsm` | ITSM Service Desk |
| | `knowledge` | Knowledge Base |
| Security Services | `wisdom-eye` | Wisdom Eye ASM |
| | `eye-phish` | Eye Phish |
| Services & Billing | `marketplace` | GRC Module Marketplace |
| | `tool-marketplace` | Open Source Tool Marketplace |
| | `invoices` | Invoices |
| | `payments` | Payments |

### Branch Portal (`portal = "branch"`)

| Section | Page Key | Label |
|---|---|---|
| Branch Operations | `dashboard` | Branch Dashboard |
| Assurance | `tasks` | To Do & Approvals |
| | `standards` | Local Standards |
| | `controls` | Local Controls |
| | `implementations` | Implementations & Evidence |
| | `risk` | Local Risk |
| | `audits` | Local Audits |
| | `vendors` | Local Vendors |
| People & Support | `team-directory` | Local Teams |
| | `user-admin` | Local Users |
| | `itsm` | ITSM Service Desk |
| | `knowledge` | Knowledge Base |
| Security Services | `wisdom-eye` | Wisdom Eye ASM |
| | `eye-phish` | Eye Phish |
| Services | `marketplace` | GRC Module Marketplace |
| | `tool-marketplace` | Open Source Tool Marketplace |

### Document Governance Portal (`portal = "document"`)

| Section | Page Key | Label |
|---|---|---|
| Document Lifecycle | `dashboard` | Document Dashboard |
| | `library` | Document Library |
| | `tasks` | To Do & Approvals |
| | `acknowledgements` | My Acknowledgements |
| Governance | `retention` | Retention Schedules |
| | `legal-hold` | Legal Hold |
| | `logs` | Immutable Audit Log |
| People & Support | `team-directory` | Governance Teams |
| | `itsm` | Document Service Desk |
| | `knowledge` | Knowledge Base |

### External Auditor Portal (`portal = "auditor"`)

| Section | Page Key | Label |
|---|---|---|
| Audit Engagement | `dashboard` | Engagement Dashboard |
| | `library` | Assurance Evidence |
| Verification | `logs` | Immutable Audit Log |
| | `hash-check` | Cryptographic Verification |
| | `exports` | Verified Exports |
| Support | `itsm` | Auditor Support Desk |
| | `contacts` | Engagement Contacts |

### Consulting Partner Portal (`portal = "partner"`)

| Section | Page Key | Label |
|---|---|---|
| Partner Portfolio | `dashboard` | Portfolio Dashboard |
| | `clients` | Client Workspaces |
| | `engagements` | Engagement Tracking |
| IP & Content | `partner-library` | Partner Library |
| | `standards` | Partner Standards |
| People & Support | `team-directory` | Partner Teams |
| | `user-admin` | Consultants & Access |
| | `itsm` | Partner Service Desk |
| | `knowledge` | Knowledge Base |
| Security Services | `wisdom-eye` | Wisdom Eye ASM |
| | `eye-phish` | Eye Phish |
| Services & Billing | `marketplace` | GRC Module Marketplace |
| | `tool-marketplace` | Open Source Tool Marketplace |
| | `wholesale-billing` | Wholesale Invoices |
| | `workspace-transfer` | Workspace Transfer |

### Franchise Portal (`portal = "franchise"`)

| Section | Page Key | Label |
|---|---|---|
| Network Control Plane | `dashboard` | Network Dashboard |
| | `hierarchy` | Franchise Hierarchy |
| | `locations` | Location Scorecards |
| | `exceptions` | Exception Workflows |
| Assurance | `tasks` | To Do & Approvals |
| | `standards` | Mandatory Baseline |
| | `controls` | Mandated Controls |
| | `implementations` | Implementations & Evidence |
| | `risk` | Network Risk |
| | `audits` | Network Audit Programme |
| | `vendors` | Network Vendors |
| People & Support | `team-directory` | Network Teams |
| | `user-admin` | Users & Location Transfers |
| | `role-matrix` | Roles & Permissions |
| | `itsm` | ITSM Service Desk |
| | `knowledge` | Knowledge Base |
| Security Services | `wisdom-eye` | Wisdom Eye ASM |
| | `eye-phish` | Eye Phish |
| Services & Billing | `marketplace` | GRC Module Marketplace |
| | `tool-marketplace` | Open Source Tool Marketplace |
| | `invoices` | Invoices |
| | `payments` | Payments |

---

## 3. Backend Routes (Express)

### Currently Mounted

| Method | Path | Handler | File | Auth | Status |
|---|---|---|---|---|---|
| GET | `/health` | Inline | `app.ts:24` | None | ✅ Active |
| GET | `/api/data` | Inline | `app.ts:35` | None | ✅ Active |

### Planned (Controllers Exist, No Routes Mounted)

| Method | Path (Proposed) | Handler | Controller File |
|---|---|---|---|
| GET | `/api/tenants/tree` | `getEntityTree` | `tenantController.ts` |
| POST | `/api/tenants/distribute` | `distributePolicy` | `tenantController.ts` |
| POST | `/api/documents/:id/checkout` | `checkOutDocument` | `documentController.ts` |
| POST | `/api/documents/:id/checkin` | `checkInDocument` | `documentController.ts` |
| POST | `/api/approvals/:id/sign` | `submitESignature` | `documentController.ts` |
| GET | `/api/audit/export` | `exportAuditLogs` | `auditorController.ts` |
| POST | `/api/ai/ask` | `askAiComplianceQuestion` | `aiController.ts` |
| POST | `/api/subscriptions` | `createSubscription` | `subscriptionController.ts` |
| GET | `/api/plans` | `getPlans` | `planController.ts` |
| POST | `/api/plans` | `createPlan` | `planController.ts` |
| POST | `/api/keys` | `generateApiKey` | `apiKeysController.ts` |
| POST | `/api/webhooks` | `registerWebhook` | `webhooksController.ts` |
