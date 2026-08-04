# GRC Wisdom — Technical Requirements Document & Production Readiness Plan

| | |
|---|---|
| **Document type** | Technical Requirements Document (TRD) + Production Engineering Plan |
| **Product** | GRC Wisdom — multilayer SaaS GRC/ITSM/Security platform |
| **Prepared for** | Engineering leadership / build team |
| **Source basis** | Direct extraction from the 42 role manuals + Common Onboarding Manual + Manual Catalogue (`v1.0`, baseline 25 Jul 2026), reconciled against the existing prototype roadmap |
| **Status** | Draft v1.0 — for engineering review |
| **Prepared** | 26 Jul 2026 |

---

### Contents
0. How to read this document · 1. Executive Summary · 2. Scope Derived From Evidence · 3. Actors & RBAC Model · 4. Domain Model · 5. Functional Requirements (30 capabilities) · 6. Cross-Cutting System Requirements · 7. Module Technical Specifications · 8. Non-Functional Requirements · 9. Reference Architecture · 10. API & Data Standards · 11. Production Readiness Engineering Process · 12. Engineering Risk Register · Appendix A (42-role matrix) · Appendix B (capability index) · Appendix C (glossary)

---

## 0. How to read this document

This TRD is written the way a senior engineer would actually approach a system like this: **derive requirements from evidence of real product behavior first, then design the architecture, then sequence the build.** The 42 role manuals in this project are not marketing collateral — they are a fairly literal specification of screens, workflows, data fields, and control requirements, written for end users but precise enough to reverse-engineer a domain model from. I read the manual catalogue, the common onboarding manual in full, and six role manuals in full (Platform Super Admin, Platform Security Admin, Platform Billing Admin, Platform Service Desk Manager, Wisdom Eye Security Analyst, Open Source Marketplace Curator), then extracted the "Job / Persona / Portal / Scope / Core Responsibilities" block from all 42 manuals and cross-indexed every recurring numbered procedure across the entire manual set.

That produced two hard facts that change the shape of the build:

1. **The functional surface is a closed set of ~30 canonical business capabilities**, reused in different combinations across 42 roles. This is good news — it means the backend has a bounded, learnable set of domain operations rather than 42 bespoke feature sets.
2. **The tenancy model has five distinct operating shapes** (SaaS control plane, Holding/Group, Multibranch, Branch/single-entity, Franchise network, Partner/MSP-and-Client-Workspace), each with its own portal and scope semantics. The pasted roadmap's Phase 1 ("Tenant Provisioning") treats this as a single `operatingModel` enum field — that's necessary but not sufficient; the scope/inheritance rules differ per model and have to be designed, not just flagged.

**Verdict on the existing roadmap:** it is directionally correct (auth first, then users, then DMS as MVP) but it underscopes the platform by roughly half. It has no line item for: digital signatures (SHA-256 signing with re-authentication), WORM audit hash-chaining, retention/legal hold, the generic approval/automation workflow engine, feature flags, Wisdom Eye (ASM) findings lifecycle, Eye Phish campaigns, the open-source marketplace supply-chain review pipeline, franchise/holding/partner tenancy semantics, or ZATCA e-invoicing certification risk (which is a real external dependency with its own timeline, not just a coding task). Section 12 gives a corrected phase plan. Everything in this document is written against **real, production implementations — no mock services, no stub data, no fake auth** — because that is what "no mock thing" means for a platform whose entire value proposition is being an auditable system of record.

---

## 1. Executive Summary

GRC Wisdom is a multi-tenant SaaS platform delivering: SaaS administration, group/holding governance, branch operations, document management with legal-grade approval and signature, risk/compliance/audit (GRC core), third-party risk (TPRM), asset management, ITSM, commercial billing (including Saudi ZATCA e-invoicing), an attack-surface-management and phishing-simulation security service ("Wisdom Eye" / "Eye Phish"), a curated open-source tool marketplace, a learning/awareness module, and an integrations/public API layer — all wrapped in one RBAC model that spans 42 named personas across six tenancy shapes.

The current build state (per the supplied roadmap) is a UI shell with one real API endpoint, a designed-but-unwired Prisma/SQLite schema, and no real authentication. The objective of this TRD is to define **what "done" means** for each subsystem in terms a backend engineer can build against directly — data model, state machine, authorization rule, and audit requirement — and to sequence that build so nothing is ever demoed on top of fake data.

---

## 2. Scope Derived From Evidence

### 2.1 The five tenancy operating models

The manual catalogue's "Portal Context" column and the Common Onboarding Manual's "Understanding the Multilayer Structure" section together define the tenancy shapes the data model must support natively — not as an afterthought bolted onto a single-tenant table:

| Operating model | Portal | Hierarchy | Example tenant (from manuals) | Distinguishing roles |
|---|---|---|---|---|
| **SaaS Control Plane** | `Saas` | Platform → all customer tenants (break-glass) | GRC Wisdom itself | Platform Super Admin, Platform Security Admin, Platform Billing Admin, Platform Service Desk Manager, Marketplace Curator, Customer Success Manager, Wisdom Eye Security Analyst |
| **Holding / Group** | `Holding` | Group → Region → Entity | Al Noor Holding Group | Group Admin, Regional Admin, Group Compliance/Risk/HR/Finance Manager |
| **Multibranch** | `Multibranch` | Organization → Branch | OmniOps | Organization Admin, Org GRC/Support roles, Risk/HR/Finance Manager, Wisdom Eye Manager |
| **Branch / single entity** | `Branch` | One entity, locally scoped | Hayat National Hospital — Madinah | Branch Admin, Branch Compliance Officer, Branch Finance/HR User |
| **Franchise network** | `Franchise` | Franchisor → Franchisee location | RetailCo Franchise Network | Franchisor Admin, Franchisee Admin, Franchise Support Manager |
| **Partner / MSP** | `Partner` → `Client Workspace` | Partner firm → Client engagement → Client workspace | GRC Consulting Partners | Partner Owner, Engagement Manager, Pre-/Post-Sales Manager, Consultant, Client Administrator, Client Contributor |

Three further scoped portals exist as **views over the tenant graph rather than separate tenancy shapes**: `Document` (Compliance Manager/Approver, Staff Employee), `Auditor` (External Auditor — read-only, engagement-scoped), `Tenant Assurance` / `Tenant GRC Operations` / `Tenant Asset Management` / `Tenant Third-Party Risk` (Internal Auditor, Control Owner, Asset Owner, Vendor Owner — each scoped to one functional slice of a tenant).

**Engineering consequence:** the tenant table cannot be a flat `tenants` row with a `parentId`. It needs a **materialized-path tree** (the roadmap already correctly names this) *plus* an `operating_model` enum *plus* a per-model **scope resolver** that answers "what entity IDs can this role see" differently depending on model (e.g., a Regional Admin's scope is a *subset of entities*, not a subtree; a Franchisee Admin's scope is exactly one location with no downward reach at all).

### 2.2 Cross-platform services

Independent of tenancy shape, eight services are addressable from any portal where entitled: **ITSM**, **Document Management (DMS)**, **GRC Core** (standards, controls, risk, audit, assets, vendors), **Wisdom Eye** (attack surface management), **Eye Phish** (human-risk phishing simulation), **Learning** (awareness/courses), **Marketplace** (open-source tool curation and installation), **Integrations & Public API**.

---

## 3. Actors & RBAC Model

### 3.1 Design principle

Every one of the 42 manuals reduces to the same 4-tuple: **Persona → Portal → Operational Context (tenant instance) → Authorized Scope**, plus a `Core responsibilities` list drawn from the canonical 30-capability catalogue (Section 5). This means RBAC should **not** be modeled as 42 hardcoded role checks in application code. It should be modeled as:

```
Role = { key, portal_family, capability_grants[], default_scope_rule }
User = { identity, tenant_id, role_id, scope_override? }
Capability = one of the ~30 canonical business capabilities (Section 5)
Permission check = user.role.capability_grants.includes(capability)
                    AND scope_resolver(user, target_record) == ALLOWED
```

This is exactly what the platform itself exposes to admins ("Maintain roles and permissions" — capability 5 in the canonical list): **the RBAC engine is itself a first-class product feature (custom role builder), not just an internal authorization layer.** Build it once, expose it twice (as enforcement middleware, and as an admin UI over the same rule table).

### 3.2 Segregation of Duties (SoD) — non-negotiable, appears in every manual

Recurring, verbatim, across every single manual's "Security, Privacy and Audit Responsibilities" section:

> "Do not approve your own high-risk access or production change where segregation is required." / "Prevent incompatible actions such as author approving own document."

This must be a **hard, server-side, data-driven rule**, not UI-hidden buttons. Minimum SoD rules the engine must enforce at write-time:
- A document's `authorId` may never equal an `ApprovalQueue` record's `approverId` for the same version.
- A user cannot approve their own access grant or role change.
- A user cannot both create and independently validate the same audit finding closure.
- A user cannot both submit and approve the same invoice adjustment above a configurable threshold.

### 3.3 Full role register

The complete 42-role matrix (Portal, Operating Context, Scope, and granted capabilities) is in **Appendix A**. It is the literal backlog for the `roles` seed data and the RBAC test matrix — every row is a test fixture ("as Vendor Owner, I can Assess-and-remediate-a-vendor and Assess-and-treat-a-risk but cannot Publish-a-module").

---

## 4. Domain Model — Core Entities

This is the entity list the Prisma schema needs to converge on. Fields are the minimum implied by the manuals' step-by-step procedures (e.g., "Enter title, unique code, category, department, owner and classification" is a field list, not prose).

| Entity | Key fields (evidence-derived) | Notes |
|---|---|---|
| **Tenant** | id, legalName, displayName, country, operatingModel enum(`SAAS_ROOT`,`HOLDING`,`MULTIBRANCH`,`BRANCH`,`FRANCHISE`,`PARTNER`), materializedPath, hostingRegion, residencyRequirement, planId, contractDates | Root of isolation |
| **Entity/Branch** | id, tenantId, parentEntityId (nullable), name, type(`ENTITY`,`BRANCH`,`FRANCHISE_LOCATION`,`CLIENT_WORKSPACE`), status | Sub-tree under Tenant |
| **User** | id, tenantId, entityScope[], email, passwordHash, mfaEnabled, mfaSecret, roleId, department, manager, status, startDate, expiryDate | No self-signup — admin-invited only (Sec 8.2) |
| **Role** | id, tenantId(nullable=platform role), key, businessPurpose, capabilityGrants[], scopeRule, requiresMfa, requiresSecondaryApproval | Custom role builder backs this |
| **InviteToken** | id, userId, tokenHash, expiresAt(48h), consumedAt | One-time, short-lived |
| **Document** | id, tenantId, entityId, title, code(unique), category, department, ownerId, classification, retentionClassId, reviewFrequency, status enum(`Draft`,`InReview`,`Approved`,`Published`,`Archived`) | |
| **DocumentVersion** | id, documentId, versionNumber, changeType(`Minor`,`Major`), content/fileRef, checkedOutBy, checkedOutAt, changeSummary, hash | Checkout/checkin locking |
| **ApprovalQueue** | id, subjectType, subjectId, routeStep, approverId, decision(`Pending`,`Approved`,`Rejected`,`Returned`), decidedAt, signatureHash, sessionInfo | SoD-enforced |
| **Acknowledgement** | id, documentId/policyId, userId, completedAt, ipAddress, quizScore | |
| **RetentionClass** / **LegalHold** | id, name, schedule, wormLocked, matter, custodian, reason, approverId, appliedAt, releasedAt | Freezes disposal timers |
| **Standard/Framework** | id, code, title, authority, version, clauses[] | ISO 27001, SOC 2, Saudi PDPL, NCA ECC, etc. |
| **TenantStandardEnablement** | id, tenantId, standardId, applicability, ownerId | Per-tenant activation within plan limits |
| **Control** | id, standardClauseRefs[], title, objective | |
| **ControlImplementation** | id, controlId, tenantId, ownerId, operatorId, frequency, successCriteria, status enum(`NotStarted`,`InProgress`,`Implemented`,`Verified`), effectiveness, nextDueDate | |
| **Evidence** | id, implementationId/findingId/vendorId, fileRef, uploadedBy, classification, retentionClassId | Polymorphic evidence attach |
| **Risk** | id, tenantId, entityId, causeEventImpact, processRef, assetRefs[], ownerId, inherentLikelihood, inherentImpact, controlsLinked[], residualLikelihood, residualImpact, appetiteComparison, treatmentType enum(`Accept`,`Mitigate`,`Transfer`,`Avoid`) | |
| **RiskScoreSnapshot** | id, riskId, capturedAt, inherentScore, residualScore | Trend history |
| **RiskTreatmentAction** | id, riskId, ownerId, dueDate, status | |
| **Audit** | id, tenantId, objective, scope, criteria, independenceStatement, schedule, auditorIds[], status | |
| **AuditFinding** | id, auditId, criterion, condition, cause, riskRating, recommendation, correctiveActionOwnerId, correctiveActionDueDate, closureValidatedBy, reopenedCount | Independent-closure rule |
| **Asset** | id, tenantId, entityId, name, type, ownerId, custodianId, location, status, confidentiality, integrity, availability, criticality, linkedApplications[], linkedVendors[], linkedControls[], linkedRisks[], reviewDate | |
| **Vendor** | id, tenantId, ownerId, name, category, criticality, country, dataAccessLevel, linkedApplications[], inherentRisk, residualRisk, nextReviewDate | |
| **VendorAssessment** | id, vendorId, questionnaireTemplateId, sentAt, respondedAt, findings[] | |
| **Ticket** | id, tenantId, type enum(`Incident`,`ServiceRequest`,`AccessRequest`,`Change`,`SecurityEvent`), subject, description, impact, urgency, priority(computed), assignmentGroup, slaTargetAt, status, workNotes[], comments[] | |
| **KnowledgeArticle** | id, title, body, linkedTicketTypes[] | |
| **Plan** | id, tier(`Essentials`,`Professional`,`Assurance`,`EnterpriseIntelligence`), operatingModelsAllowed[], includedModules[], quotas{users,branches,storage,frameworks,...}, priceAnnual, trialDays | |
| **Subscription** | id, tenantId, planId, orderRef, startDate, commitmentDate, renewalDate, billingSchedule, currency, vatRate, supportTier, status | Amendment records, never overwritten |
| **Invoice** | id, tenantId, subscriptionId, lineItems[], subtotal, vat, total, issueDate, dueDate, currency, zatcaXml, zatcaHash, zatcaQr, isCleared, status | |
| **Payment** | id, invoiceId, method, amount, valueDate, reference, remittanceEvidenceRef, reconciledAt | |
| **ResourceUsageCounter** | id, tenantId, metric enum(users,branches,storage,aiCalls,monitoredAssets,campaigns,learners,apiCalls), currentValue, quotaValue, overrideExpiresAt | |
| **Asset (Wisdom Eye)** — `MonitoredAsset` | id, tenantId, ownerAuthorizationRef, domain/IP/range, scanProfileId | Distinct from GRC `Asset` |
| **ScanProfile** | id, frequency, window, exclusions[], rateLimits | |
| **ExposureFinding** | id, monitoredAssetId, category(services,certs,DNS,leaks,cloud,vuln), severity, falsePositive, remediationTicketId, retestedAt | |
| **PhishCampaign** | id, tenantId, approvals{hr,exec,privacy}, sendingInfraRef, templateLang, targetAudience, sentAt | |
| **PhishResult** | id, campaignId, aggregateOnly=true, failureRate, reportRate, remedialLearningAssignedCount | Individual-level privacy protected |
| **Course/LearningPath** | id, title, language, passingScore, dueDate, audienceRule | |
| **LearningAssignment** | id, courseId, userId, status, completedAt, certificateRef | |
| **MarketplaceTool** | id, sourceProvenance, license, maintainerActivityScore, scanResults{dependency,container,secret,malware,vuln}, isolationReview, dataResidencyReview, supportedVersion, rollbackPlanRef, status(`UnderReview`,`Piloted`,`Released`,`Deprecated`) | |
| **TenantToolInstallation** | id, tenantId, toolId, connectorHealth, installedAt | |
| **FeatureFlag** | id, key, owner, expiryDate, defaultState, rolloutPercentage, tenantOverrides[], monitoringTriggerRef | |
| **Module** | id, owner, version, maturity, declaredPermissions[], quotas, dependencies[], apiSurface[], operatingModelsAllowed[] | |
| **WorkflowDefinition** | id, trigger, scope, entryConditions, steps[](`submit`,`review`,`approve`,`reject`,`notify`,`wait`,`task`), sodRules[], escalationRules[] | Generic automation engine |
| **WorkflowRun** | id, definitionId, subjectId, currentStep, status, history[] | |
| **IntegrationConnector** | id, tenantId, direction(`in`,`out`,`bidi`), authType(`oauth`,`serviceAccount`), scopeObjects[], mapping, schedule/webhookUrl, retryPolicy, deadLetterQueueRef | |
| **ApiKey** | id, tenantId, hashedKey, scopes[], rotatedAt | |
| **WebhookEndpoint** | id, tenantId, url, secret, hmacAlgo=`HMAC-SHA256`, subscribedEvents[] | |
| **AuditLog** | id, tenantId, userId, role, action, subjectType, subjectId, prevValue, newValue, sessionId, networkOrigin, timestamp, previousHash, currentHash=SHA256(action+payload+previousHash), wormLocked=true | Append-only, never updated or deleted |
| **ReportGenerationHistory** | id, templateId, requestedBy, tenantScope, filters, language, format, classification, watermark, generatedAt, fileRef | |

---

## 5. Functional Requirements — The 30 Canonical Business Capabilities

Every one of the 42 manuals draws its "Core responsibilities" exclusively from this set (confirmed by cross-indexing all 42 manuals — no manual contains a capability outside this list). **This is the actual functional requirements backlog.** Each capability below is specified as: trigger, primary actor(s) (by role family), state change, and the mandatory audit/evidence requirement pulled verbatim from the manuals' "Completion check" pattern (*"Confirm the record status, audit history, scope and any generated task/ticket/report before leaving the page"* — i.e., every write operation must be independently verifiable after the fact, which is a testable API contract: every mutating endpoint must produce a queryable audit-log entry and, where applicable, a status transition on the affected record).

| # | Capability | Module | Core state machine / API shape |
|---|---|---|---|
| 1 | First-time login and MFA | Auth | `POST /auth/activate` → `POST /auth/mfa/setup` → `POST /auth/mfa/verify` → session |
| 2 | Create an ITSM ticket | ITSM | `POST /tickets` with type/impact/urgency → server computes priority+SLA |
| 3 | Create or manage a tenant | Platform | `POST /tenants` (operating model, plan, region, quotas, initial admin) |
| 4 | Add a user with role-based access | IAM | `POST /users/invite` → invite token → `POST /auth/set-password` |
| 5 | Maintain roles and permissions | IAM | Role CRUD + effective-permission preview + SoD validator |
| 6 | Transfer a user between branches or entities | IAM | `POST /users/:id/transfer` — reassigns open tasks, revokes old scope |
| 7 | Publish or enable a module | Platform | Module CRUD → feature-flag-gated rollout → release approval |
| 8 | Govern a feature flag | Platform | Flag CRUD with rollout %, tenant targeting, expiry, rollback trigger |
| 9 | Create an approval or automation workflow | Workflow Engine | `WorkflowDefinition` CRUD with SoD + escalation |
| 10 | Configure an integration | Integrations | Connector CRUD, OAuth/service-account, least-privilege scopes |
| 11 | Monitor security and handle incidents | Security | Alert → `SecurityIncident` create/link → containment → lessons-learned |
| 12 | Create or select a commercial plan | Billing | `Plan` CRUD, VAT/rate card, discount approval |
| 13 | Manage a subscription | Billing | `Subscription` lifecycle: create → amend (never overwrite) → renew/terminate |
| 14 | Generate or review an invoice | Billing | `Invoice` create from subscription/usage → VAT calc → issue |
| 15 | Record and reconcile a payment | Billing | `Payment` create → allocate to invoice(s) → reconcile |
| 16 | Monitor resource usage and quotas | Billing/Platform | Usage counters vs. plan quotas, override with expiry |
| 17 | Create, import and version a document | DMS | Checkout → edit → checkin(Minor/Major) → link standards/controls/risks |
| 18 | Review, approve and digitally sign a document | DMS | Approval route → re-auth → SHA-256 sign → publish |
| 19 | Acknowledge or monitor a policy | DMS | Acknowledgement create + manager rollup dashboard |
| 20 | Apply retention and legal hold | DMS | `LegalHold` apply/release with WORM freeze |
| 21 | Import or enable a standard | GRC Core | Standard import (rights-checked) → clause mapping → tenant enablement |
| 22 | Manage a control implementation and evidence | GRC Core | `ControlImplementation` CRUD + `Evidence` attach + independent validation |
| 23 | Assess and treat a risk | GRC Core | `Risk` CRUD with dedup search, inherent/residual scoring, treatment actions |
| 24 | Plan and execute an audit | GRC Core | `Audit` → workpapers → `AuditFinding` → CAP → independent closure validation |
| 25 | Maintain an asset | GRC Core | `Asset` CRUD, CIA+criticality classification, periodic certification |
| 26 | Assess and remediate a vendor | TPRM | `Vendor` → questionnaire → scoring → findings → remediation → next review |
| 27 | Generate and distribute a report | Reporting | Template + scope + filters → EN/AR → PDF/Word/Excel/CSV → watermark |
| 28 | Operate Wisdom Eye and Eye Phish | Security Services | Authorization record → scan/campaign → triage → remediation/learning |
| 29 | Assign or complete learning | Learning | Course assignment → completion tracking → certificates |
| 30 | Onboard or purchase an open-source tool | Marketplace | Supply-chain review → pilot → release; or purchase → entitlement → install |
| — | Manage and resolve support tickets | ITSM | Queue triage → SLA-aware resolution → knowledge article |
| — | Manage group or regional governance | Holding | Group/region rollup views, cross-entity policy push |
| — | Manage franchise governance | Franchise | Network-wide standard push, per-location compliance rollup |
| — | Manage partner/client workspaces and engagements | Partner/MSP | Client workspace provisioning, engagement scoping, task assignment |

*(The last four appear in the role summaries as additional distinct capability labels tied to the Holding/Franchise/Partner operating models — they are genuinely separate from the 30 "universal" ones because they only exist for those tenancy shapes.)*

---

## 6. Cross-Cutting System Requirements

These are the requirements that don't belong to one module but that every module's implementation must satisfy. In practice they should be built as **shared platform primitives** before module teams start, because retrofitting audit-chaining or SoD into 20 already-built modules is far more expensive than building it once underneath all of them.

### 6.1 Immutable, hash-chained audit trail

Every manual's "What the audit trail records" section is identical and must be treated as a literal spec:

> User identity and role · Tenant and organizational scope · Action performed and record affected · Date, time, session and network origin · Previous and new values for controlled changes · Approval, signature or acknowledgement evidence · Hash or integrity reference for protected artifacts.

**Implementation:** every mutating service call writes an `AuditLog` row inside the same DB transaction as the business write. `currentHash = SHA256(action + serialize(payload) + previousHash)`. The `AuditLog` table has `wormLocked = true` enforced by a Postgres `BEFORE UPDATE/DELETE` trigger that raises an exception — application-level enforcement is not sufficient because a compromised app-tier credential must not be able to rewrite history. Hash-chain continuity should be periodically self-verified by a scheduled job that walks the chain and alerts on any break.

### 6.2 Digital signature (document approval)

"Approve & Sign and re-authenticate" → "Verify signer, role, timestamp, session/network information and SHA-256 hash." This is a step-up-auth flow: the approve action requires a **fresh authentication assertion** (re-enter password or re-confirm MFA within the last N minutes, not just a valid session token), and the resulting `ApprovalQueue` record stores the signer identity, role-at-time-of-signing, timestamp, session ID, network origin, and a SHA-256 hash of the signed content — sufficient to support a non-repudiation claim later.

### 6.3 Retention & legal hold

Every record type with a retention class must support: a disposal schedule/trigger, and an independent legal-hold flag that (a) freezes the disposal timer, (b) sets the record read-only/WORM regardless of normal edit permissions, and (c) requires matter/custodian/reason/approver metadata to apply, and authorization to release. This needs to be a **generic capability attachable to any entity** (Document, Evidence, Ticket, AuditLog) via a polymorphic `retentionClassId` / `legalHoldId` FK — not a document-only feature.

### 6.4 Segregation of Duties (SoD) engine

A rules table, not scattered `if` statements: `SodRule { actionA, actionB, sameSubjectRequired: bool }`. Examples the manuals make explicit: author ≠ approver of the same document version; access requester ≠ access approver; audit finding closer ≠ auditor who raised the finding, unless independently re-validated. The Role & Permission admin UI must surface SoD conflicts at role-design time ("Review segregation-of-duties warnings and obtain approval" — step 65 in onboarding), not just block them at write-time.

### 6.5 Entitlements, quotas, feature flags

Three related but distinct gates must all pass before a module/action is available to a user:
1. **Plan entitlement** — is the module included in the tenant's `Plan`?
2. **Feature flag** — is the flag enabled for this tenant (rollout %, explicit override)?
3. **RBAC** — does the user's role grant the capability, and is the target record in scope?
4. **Quota** — for usage-metered features (storage, monitored assets, AI calls, learners, API calls), is the tenant under its quota, or does it have a time-bound authorized override?

All four must be middleware-enforced server-side on every request; the frontend hiding a nav item is a UX nicety, never a security control.

### 6.6 Workflow / automation engine

A single generic engine backs "Create an approval or automation workflow," used identically for document approval routing, access-request approval, invoice approval, and audit-finding sign-off. Steps: `submit → review → approve/reject → notify → wait → task`, with per-step role assignment, due dates, reminders, escalation rules, and SoD constraints. Build this once as a state-machine service (e.g., a step-function-style JSON definition executed by a worker), not as bespoke approval logic duplicated per module — the manuals show the exact same procedure text reused for documents, tenants, users, and billing, which is strong evidence the original product spec intended one engine.

---

## 7. Module Technical Specifications

### 7.1 Document Management System (DMS)

- **Lifecycle:** `Draft → CheckedOut(by:userId) → CheckedIn(version+1) → SubmittedForApproval → Approved/Rejected/Returned → Published → Archived`.
- **Locking:** `checkout` sets an exclusive lock (`checkedOutBy`, `checkedOutAt`); any other user's `PUT` is rejected with 409 until `checkin` or an admin force-release (which itself must be audit-logged with justification).
- **Versioning:** Minor vs Major checkin, full version history retained forever (no hard delete — "restore by creating a new controlled version, never deleting history"); version diff endpoint required.
- **Approval routing:** uses the generic Workflow Engine (6.6); enforces author≠approver SoD.
- **Linking:** documents link to standards, controls, risks, and target audiences — these are join tables, not embedded arrays, because they need independent queryability ("show all documents mapped to ISO 27001 A.12").

### 7.2 GRC Core

- **Standards/Frameworks:** imported via a controlled template with row-level validation (code, version, authority, controls) before commit; mapped to common controls; then explicitly enabled per tenant within plan limits (`TenantStandardEnablement`).
- **Controls & Implementations:** an `Implementation` is the tenant-specific instantiation of a library `Control` — objective, owner, operator, frequency, success criteria, plus a many-to-many link to standards/risks/assets/vendors/documents. Evidence is polymorphic and must record relevance/sufficiency/authenticity/currency as first-class reviewer-facing fields, not free text. Submission for "independent validation" requires validator ≠ implementer.
- **Risk register:** mandatory duplicate-search before create; scoring uses a configurable likelihood×impact matrix (approved criteria per tenant, not hardcoded 5×5); residual score is computed after linked-control effectiveness is applied; treatment actions have owner+due date; time-bound risk acceptance requires an approval record, not just a status flag.
- **Audit programme:** `Audit → workpapers/evidence requests → Findings (criterion/condition/cause/riskRating/recommendation) → CAP (owner+due date) → supervisory review → report → independent closure validation`, with explicit reopen-if-insufficient path.
- **Assets:** CIA + criticality classification is mandatory metadata, not optional; periodic certification or retirement through an approved lifecycle (no silent deletion).
- **Vendors (TPRM):** service/owner/criticality/data-access captured at intake; assessment dispatch and evidence collection through a secure exchange channel (not email attachments); inherent vs residual scoring; escalation rule for expired evidence, critical risk, or contract gaps.

### 7.3 ITSM

- **Ticket types:** `Incident | ServiceRequest | AccessRequest | Change | SecurityEvent`.
- **Priority/SLA:** server computes priority from `(impact, urgency)` matrix — never client-supplied — and stamps `slaTargetAt`. From the pasted roadmap's SLA table (retained as the default config, tenant-overridable): P1 Critical 1h, P2 High 8h, P3 Medium 3d, P4 Low 5d.
- **Notes vs comments:** internal `workNotes` (never requester-visible) vs `comments` (requester-visible) must be schema-distinct fields, not a `isInternal` boolean on a single comments table, to make the visibility rule impossible to get wrong at the query layer.
- **Escalation:** a background job scans for at-risk/breached SLA every 5 minutes and escalates per assignment-group rules; recurring resolutions should prompt creation of a `KnowledgeArticle`.

### 7.4 Commercial / Billing

- **Plan/Package model:** operating model is orthogonal to capability tier (a plan declares which operating models it supports *and* which modules/quotas it includes) — don't conflate "Enterprise" with "Holding."
- **Subscription lifecycle:** amendments and renewals are new linked records, never in-place overwrites of the original subscription — this preserves a billing history audit trail and is required for accurate revenue recognition later.
- **Invoicing:** line items → subtotal → VAT (15% Saudi VAT default, configurable) → total; disputes must reference an exact line + contract basis, which means invoice line items need stable IDs referenced in dispute tickets.
- **ZATCA e-invoicing (Saudi compliance):** generate ZATCA-compliant XML per invoice, QR code per spec, submit for clearance via the ZATCA API, store `zatcaXml/zatcaHash/zatcaQr/isCleared`. **Flag this as an external certification dependency, not pure engineering** — ZATCA integration requires a registered, certified solution provider process with the Saudi tax authority; this has its own lead time and should be started in parallel with Phase 0, not sequenced after all other billing work.
- **Payments:** reconciliation matches gateway/bank evidence to invoices by reference/amount/date; unmatched and duplicate transactions must be surfaced for investigation, not silently dropped.
- **Quotas:** usage counters for users/branches/storage/frameworks/AI/monitored-assets/campaigns/learners/API calls, each checked against plan limits with pre-hard-limit customer notification and an auditable override-with-expiry path.

### 7.5 Wisdom Eye (Attack Surface Management) & Eye Phish

- **Authorization-first:** no scan may start without a recorded asset-owner authorization on file — this is a hard precondition, not a UI checkbox that's ignorable server-side.
- **Scan configuration:** profile, frequency, window, exclusions, and rate limits are per-tenant configuration, enforced by the scan orchestrator (protects both the target and GRC Wisdom's own sending/scanning infrastructure reputation).
- **Findings:** categories = services, certificates, DNS, leaks, cloud, vulnerabilities; each finding has severity, false-positive flag, and a retest-before-closure requirement — closure without a recorded retest should be blocked.
- **Eye Phish:** requires recorded HR/executive/privacy approval before a campaign can send; must use approved sending infrastructure (dedicated reputation-managed domains/IPs, separate from transactional email); **must never capture real credentials** — the capture mechanism should be a hardcoded safe-simulation (e.g., store only "clicked" / "submitted-any-value" booleans, never the actual submitted string); results surfaced only in aggregate to protect individual privacy, with remedial learning auto-assignment as the only individual-level action permitted.

### 7.6 Marketplace & Integrations

- **Curation pipeline (Marketplace Curator):** provenance/license/maintainer-activity review → dependency/container/secret/malware/vulnerability scanning → tenant-isolation/auth/egress/privacy/data-residency review → supported-version/update/monitoring/support/rollback plan → pilot/performance testing → release approval. This is a **supply-chain security gate**, not a simple app-store listing form — model it as a multi-stage workflow with mandatory scan-result attachments per stage, using the generic Workflow Engine (6.6).
- **Purchase path:** maturity/license/data-flow/price/permissions review → approved purchase → entitlement grant → invoice → ITSM-tracked installation request → post-install connector-health validation.
- **Integrations/API:** connectors declare direction (`in`/`out`/`bidi`), use OAuth or a managed service account (secrets in a managed secret store, never in plaintext config), least-privilege scopes, field mapping, schedule or webhook trigger, retry policy with dead-letter queue, and reconciliation. All tested in non-production before approval; sync health/error rate/API quota are monitored continuously; credentials are rotated on a schedule.
- **Public API & webhooks:** outbound webhook payloads are HMAC-SHA256 signed; public read endpoints (`GET /api/v1/risks`, `GET /api/v1/documents`, etc.) are scoped by `ApiKey`, rate-limited, and fully covered by the same audit-log requirement as UI-driven writes.

### 7.7 Reporting

Every module funnels into one reporting subsystem: select template → scope to authorized tenant/entity/branch/client → period/filters → preview with missing/stale-data detection → narrative → **English, Arabic, or bilingual output** (this is a hard localization requirement, including RTL layout for Arabic, not a "nice to have") → PDF/Word/Excel/CSV → classification + watermark + authorized-recipient list → retained generation history. Build this as one templating service parameterized by report definition, not per-module bespoke exporters.

---

## 8. Non-Functional Requirements

| Category | Requirement | Evidence / rationale |
|---|---|---|
| **Data residency** | Primary hosting in-region (OCI Riyadh per existing infra decision); tenant `hostingRegion` and `residencyRequirement` are first-class fields checked at provisioning | "Set hosting region and residency requirements" (tenant creation flow); Saudi PDPL / NCA ECC targets |
| **Localization** | Full English/Arabic bilingual UI and reporting, RTL support | "Select English, Arabic or bilingual output" appears in every reporting procedure |
| **Availability** | Target 99.9% for core auth/API path; ITSM SLA engine itself must never be the single point of failure for the platform's own incident response | Platform is sold partly *as* an assurance/ITSM system — an outage undermines the product's own value proposition |
| **Backup / DR** | Point-in-time recovery on primary DB; documented RPO/RTO; backup-integrity alerts feed the Platform Super Admin's security monitoring procedure | "backup alerts" explicitly named in incident-monitoring steps |
| **Auditability** | Every mutating action reconstructable from `AuditLog` alone, independent of current record state | Section 6.1 |
| **Compliance targets** | Architecture should support eventual ISO 27001 / SOC 2 attestation of the platform itself, since it sells GRC to regulated customers (banking, healthcare per manual examples) | Global Bank, Hayat National Hospital tenant examples imply regulated-industry customers |
| **Browser/device** | "Supported, updated browser," no stated legacy-browser requirement | Onboarding manual, Section 3 |
| **Performance** | List/search views must page and filter server-side (no full-tenant client-side loads) once tenants scale past pilot size | Implied by "Use filters for status, owner, date and scope" as the *only* documented way to find records — client-side scan doesn't scale |
| **Privacy** | Individual Eye Phish results and individual learning scores must never be exposed outside aggregate reporting except to the individual and their direct manager | "protect individual privacy" stated explicitly, twice, for Eye Phish and Learning |

---

## 9. Reference Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React/Vite) — role-aware shell, i18n (en/ar, RTL)     │
└───────────────────────────────┬───────────────────────────────────┘
                                 │ HTTPS (JWT access token)
┌───────────────────────────────▼───────────────────────────────────┐
│  API Gateway / Express — authN, rate limiting, request logging     │
└──────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┘
       │         │         │         │         │         │
   ┌───▼──┐  ┌───▼───┐ ┌───▼───┐ ┌───▼────┐ ┌──▼───┐ ┌───▼──────┐
   │ IAM/ │  │  DMS   │ │  GRC  │ │ ITSM   │ │Billing│ │ Wisdom Eye│
   │ RBAC │  │        │ │ Core  │ │        │ │/ZATCA │ │/Eye Phish │
   └───┬──┘  └───┬───┘ └───┬───┘ └───┬────┘ └──┬───┘ └───┬──────┘
       │         │         │         │          │         │
       └─────────┴────┬────┴─────────┴──────────┴─────────┘
                       │
         ┌─────────────▼─────────────┐      ┌───────────────────┐
         │  Shared platform primitives │      │  Workflow Engine   │
         │  (Section 6): audit-chain,  │◄────►│  (approvals/       │
         │  SoD, retention/legal-hold, │      │  automation runs)  │
         │  entitlements/quotas/flags  │      └───────────────────┘
         └─────────────┬─────────────┘
                        │
   ┌────────────────────┼─────────────────────┬──────────────────┐
┌──▼───────┐   ┌─────────▼────────┐   ┌────────▼───────┐   ┌──────▼─────┐
│PostgreSQL│   │ Object Storage    │   │ Redis + BullMQ │   │  Search    │
│(tenant-  │   │ (OCI/S3 — docs,   │   │ (SLA timers,   │   │ (records / │
│ scoped   │   │  evidence, scans) │   │  email queue,  │   │  global    │
│ RLS)     │   │                   │   │  scan jobs)    │   │  search)   │
└──────────┘   └───────────────────┘   └────────────────┘   └────────────┘
```

**Key architecture decisions and why:**

| Decision | Choice | Rationale |
|---|---|---|
| Database | PostgreSQL, **with Row-Level Security (RLS)** on every tenant-scoped table | The roadmap already calls for the SQLite→Postgres migration; RLS is the addition — it makes tenant isolation a database-enforced invariant, not just an application-layer `WHERE tenantId = ?` that every query must remember to add. Given 42 roles and 6 tenancy shapes, relying on every hand-written query to get scoping right is a guaranteed future breach. |
| Object storage | OCI Object Storage / S3-compatible | Document versions, evidence attachments, scan artifacts, invoices/ZATCA XML |
| Background jobs | BullMQ + Redis | SLA breach detection, scan orchestration, email queue, report generation, webhook delivery with retry/dead-letter |
| Workflow engine | Custom lightweight state-machine service (JSON step definitions) | One engine, many consumers (Section 6.6) — avoids 6+ bespoke approval implementations |
| Auth | JWT access (short-lived) + refresh token rotation + TOTP MFA | Matches roadmap Phase 0, extended with step-up re-auth for signing (7.1/6.2) |
| Multi-tenancy isolation | Shared DB, shared schema, `tenantId` FK everywhere + Postgres RLS + materialized-path entity tree | Balances cost (vs. DB-per-tenant) against the isolation guarantees a GRC product's customers will contractually demand |
| Search | Postgres full-text to start; evaluate OpenSearch only if/when scale demands it | "Use global search for a known code or title" doesn't imply relevance-ranked search at MVP — avoid premature infra |

---

## 10. API & Data Standards

- **REST, versioned** (`/api/v1/...`), resource-oriented, JSON:API-lite envelope: `{ data, meta, errors[] }`.
- **Every mutating endpoint** (`POST`/`PUT`/`PATCH`/`DELETE`) requires: (1) valid JWT, (2) RBAC+scope check, (3) SoD check where applicable, (4) writes an `AuditLog` row in the same transaction, (5) returns the updated record's new status.
- **Idempotency:** all `POST` endpoints that create financial or irreversible records (invoices, payments, approvals) accept an `Idempotency-Key` header; duplicate keys return the original result rather than creating a duplicate record.
- **Pagination:** cursor-based on all list endpoints; no unbounded `GET /documents` without a scope+filter.
- **Errors:** structured `{ code, message, field? }`, never a raw stack trace to the client; every error still audit-logged if it followed a failed authorization/SoD check (security-relevant negative events matter too).
- **Webhooks:** `X-GRCWisdom-Signature: sha256=...` HMAC header, replayable via `X-GRCWisdom-Delivery-Id`, retried with exponential backoff into a dead-letter queue after N attempts.

---

## 11. Production Readiness — How This Gets Built

### 11.1 Engineering principles ("no mock thing," made concrete)

1. **A feature is not done when the UI renders it. It's done when the write persists, the read reflects it, the audit log records it, and a test proves all three.** No `renderMockView()`, no hardcoded arrays standing in for a query, no `localStorage` standing in for a session — ever, in any branch that can reach `main`.
2. **Contract-first.** Every module's API shape (Section 4/5/10) is agreed and documented before frontend work starts on that module, so frontend never builds against an imagined response shape that backend later has to bend to match.
3. **Migrations, not schema edits.** Every schema change is a versioned, reversible Prisma migration checked into git — never a manual `ALTER TABLE` against a shared environment.
4. **Shared primitives before module logic.** Section 6 (audit chain, SoD engine, retention/legal-hold, entitlements, workflow engine) is infrastructure every module depends on. Build it in Phase 0/1, not incrementally re-invented per module — this is the single biggest schedule risk in the original roadmap, which had no line item for it at all.
5. **Security and audit are gates, not backlog items.** A module doesn't ship without: RBAC+SoD enforcement, audit-log coverage, and a passing security review — the same bar the manuals impose on end users ("every controlled action may be audited") has to be true of the code that implements those actions.
6. **Feature flags for everything customer-visible**, so "publish or enable a module" is a real, testable platform capability from day one, not a manual redeploy.
7. **Test the RBAC matrix, not just the happy path.** Appendix A is 42 rows of "as role X, I can/cannot do Y" — that is a literal parametrized test suite, not prose to be read once and forgotten.

### 11.2 Corrected Phase Plan

The pasted roadmap's sequencing logic (auth → users → DMS → everything else) is sound and is preserved below. What changes is: (a) shared primitives get pulled forward into Phase 0/1 instead of being invented ad hoc inside DMS, (b) tenancy-shape-specific work (Holding/Franchise/Partner) is called out explicitly instead of assumed to fall out of a generic `operatingModel` enum, (c) two external, non-engineering-controlled dependencies (ZATCA certification, Wisdom Eye/Eye Phish sending & scanning infrastructure reputation) are pulled to the front because their lead time doesn't compress just because engineering hours are added.

| Phase | Scope | New vs. original roadmap | Est. effort |
|---|---|---|---|
| **0 — Foundations** | Real bcrypt+JWT+refresh auth, TOTP MFA, Postgres+RLS schema for all 6 tenancy shapes, immutable hash-chained `AuditLog` primitive, base RBAC/scope-resolver engine | Adds: RLS, audit-chain primitive, multi-shape tenant tree (roadmap assumed single hierarchy) | 15–18 days |
| **0b — Kick off external dependencies (parallel, non-blocking)** | Begin ZATCA solution-provider registration/certification process; begin Wisdom Eye scanning infra + Eye Phish sending-domain reputation setup | **New** — these have external lead times measured in weeks and shouldn't be sequenced after Phase 5/6 engineering work | Parallel, ~0 dev days, owner = platform/compliance lead |
| **1 — Tenant & User Lifecycle + Platform Primitives** | Tenant provisioning per operating model, invite-only user lifecycle, custom Role/Permission builder with SoD validator, generic Workflow Engine (skeleton), Feature Flags, Entitlements/Quota engine | Adds: SoD engine, Workflow Engine, Feature Flags, Quota engine (none in original roadmap) | 25–30 days |
| **2 — Document Management System** | Full lifecycle incl. checkout/checkin/versioning, approval routing via Workflow Engine, step-up-auth digital signature, acknowledgements, retention & legal hold | Adds: legal hold as a generic attachable primitive; digital-signature step-up auth | 22–28 days |
| **3 — ITSM** | Tickets, priority/SLA engine, escalation, knowledge base — can start once Phase 1 primitives exist, largely parallel to Phase 2 | Same as original, using shared Workflow Engine for change/approval flows | 15–20 days |
| **4 — GRC Core** | Standards/frameworks, controls & implementations & evidence, risk register & scoring, audit programme & findings/CAP, assets, vendors/TPRM | Broadly matches original Phase 4, now explicitly built on shared evidence/retention primitives | 40–55 days |
| **5 — Commercial / Billing** | Plans, subscriptions (amendment-based lifecycle), invoicing, payments/reconciliation, quota enforcement UI, ZATCA integration completion (cert should be in progress since Phase 0b) | Adds explicit ZATCA cert dependency tracking; amendment-not-overwrite subscription model | 25–35 days |
| **6 — Wisdom Eye & Eye Phish** | Authorized-scanning workflow, findings triage/retest, phishing campaign approval chain, safe-simulation capture, aggregate-only reporting | **New — entirely absent from original roadmap** | 20–28 days |
| **7 — Marketplace & Integrations/API** | Supply-chain curation pipeline, purchase/entitlement/install flow, connector framework (OAuth/webhooks/retry/dead-letter), public API + HMAC webhooks | **New — entirely absent from original roadmap** | 25–32 days |
| **8 — Holding / Franchise / Partner governance views** | Group/regional rollups, franchise network governance push, partner/client-workspace provisioning & engagement scoping | **New — original roadmap assumed one flat tenant model** | 15–20 days |
| **9 — Reporting engine** | Single templated EN/AR bilingual reporting service consumed by all modules (PDF/Word/Excel/CSV, watermark, classification, generation history) | Build incrementally per-module in practice, but budget as one consolidated service to avoid 8 bespoke exporters | 12–15 days |
| **10 — Learning module** | Course/path assignment, completion tracking, certificates, remedial-learning trigger from Eye Phish | Smaller, can trail | 8–10 days |

**Total: ~222–291 person-days** (vs. the original roadmap's 135–185), reflecting the real scope evidenced in the 42 manuals. With one senior full-stack engineer plus the DevOps/infra work in Section 11.5–11.6 running in parallel, this is realistically **9–13 calendar months** to a genuinely production-ready, sellable multi-module platform — not the 5–7 months in the original estimate. If the business timeline is fixed at 5–7 months, the honest options are: (a) add a second engineer for Phases 4–7 (they parallelize reasonably well once Phase 0/1 primitives exist), or (b) cut Phase 6–8 from the launch scope and sell DMS+ITSM+GRC Core+Billing as v1.0, which is a coherent, defensible MVP on its own (this matches the original roadmap's own MVP recommendation, just with an honest phase 0-4 estimate of roughly 100–130 days rather than 55–75).

### 11.3 Definition of Ready / Definition of Done

**A ticket is Ready when:** the target entity/fields are in the Section 4 domain model (or the model is updated first), the RBAC/SoD rule for the action is identified, the audit-log fields it must populate are known, and — if it's a workflow step — the Workflow Engine definition it plugs into is identified.

**A ticket is Done when:**
- [ ] Real DB write/read; no mock/stub data path remains reachable in the shipped code.
- [ ] RBAC + scope + SoD enforced server-side and covered by a test using the relevant Appendix A role row(s).
- [ ] Mutating action writes a valid `AuditLog` entry (verified by test, not just by code review).
- [ ] Migration is additive/reversible and reviewed.
- [ ] API response matches the documented contract (Section 10); breaking changes are versioned.
- [ ] Errors handled without leaking stack traces; negative/authorization-failure paths tested.
- [ ] Feature is behind a flag if customer-visible and not yet fully rolled out.
- [ ] Localization strings externalized (EN/AR) where user-facing.

### 11.4 Testing Strategy

| Layer | What it covers | Notes |
|---|---|---|
| Unit | Business logic (scoring, priority/SLA calculation, VAT calc, hash chaining) | Fast, run on every commit |
| Integration | API endpoint ↔ DB ↔ RLS policy | Use a real Postgres test instance, not sqlite-in-memory, so RLS behavior is actually exercised |
| **RBAC/SoD matrix** | Every row of Appendix A × relevant capability | Parametrized test generation directly from the role table — this is the highest-value test suite in the whole system given 42 roles |
| **Audit-chain integrity** | Hash-chain continuity, WORM enforcement (attempt an UPDATE/DELETE on `AuditLog` and expect a DB-level rejection) | Run as a scheduled job in staging/prod, not just CI |
| Multi-tenant isolation | Attempt cross-tenant reads/writes with a valid-but-wrong-tenant token; must fail at the RLS layer even if application code has a bug | Treat as a security test, run in CI and periodically as a pen-test exercise |
| Contract/E2E | Critical user journeys per module (create→approve→publish a document; raise→remediate→retest a Wisdom Eye finding; issue→pay→reconcile an invoice) | Playwright/Cypress against a seeded staging environment |
| Security | SAST on every PR, dependency/SCA scanning (directly reusable for the Marketplace curation pipeline's own scanning requirement — same tooling, two consumers), periodic DAST and external penetration test before each major go-live | ZATCA and financial data flows get extra scrutiny |
| Load | SLA-timer accuracy and report generation under realistic tenant/record volume | Before Phase 5 go-live at minimum |

### 11.5 CI/CD & Environments

- **Environments:** `dev` (ephemeral per-branch or shared sandbox) → `staging` (production-shaped data volumes, used for the manuals' own "training tenant" concept — the Common Onboarding Manual explicitly assumes a sandbox/training tenant exists) → `production`.
- **Pipeline:** lint → unit → integration → migration dry-run against a staging snapshot → SAST/SCA → build → deploy to staging → E2E smoke → manual/automated promotion to production behind feature flags.
- **Migrations:** additive-only in the same release as the code that needs them; destructive migrations (column drops) only after the reading code has been fully rolled back for at least one release cycle.
- **Rollback:** every production deploy must be revertible via redeploying the previous artifact; feature flags are the primary rollback mechanism for behavior, not just deploys.

### 11.6 Observability

- **Structured logs** correlated by request ID and, where applicable, cross-referenced to the `AuditLog` entry ID they produced — so a support engineer can go from "user reports approval didn't fire" to the exact audit row and the exact log line in one query.
- **Metrics:** SLA-timer accuracy/lag, queue depth (BullMQ), webhook delivery success rate, ZATCA clearance success rate, scan-job success rate, per-tenant quota headroom.
- **Alerting:** feeds directly into the platform's own ITSM module (dogfooding — "backup alerts," "malware/vulnerability/availability alerts" are explicitly named in the Platform Super Admin's own incident-monitoring procedure, meaning the product should monitor itself using itself once ITSM exists).
- **Tracing:** distributed tracing across API → workflow engine → job queue, given how much of the system's correctness depends on multi-step workflows completing correctly.

### 11.7 Release Management

- New modules/capabilities launch behind a `FeatureFlag` (Section 4), default-off, enabled first for an internal pilot tenant, then expanded by rollout percentage or explicit tenant targeting — this mirrors "Govern a feature flag" (capability 8) exactly, so the release process for engineering is literally exercising the same primitive the product sells to Platform Super Admins.
- Rollback triggers (error-rate thresholds, support-ticket-volume spikes) are defined per flag before rollout begins, not improvised during an incident.

### 11.8 Production Go-Live Checklist (per major release, and mandatory before first customer go-live)

- [ ] External penetration test completed and critical/high findings remediated.
- [ ] Multi-tenant isolation test suite passing, including an adversarial cross-tenant attempt.
- [ ] Audit-chain integrity verifier running on a schedule with alerting wired up.
- [ ] Backup restore actually tested end-to-end (not just "backups are running").
- [ ] Data residency confirmed for each tenant's configured hosting region.
- [ ] ZATCA clearance certification confirmed complete (Phase 0b dependency) before any customer invoice is issued.
- [ ] DR runbook exists and has been rehearsed at least once.
- [ ] On-call rotation and ITSM escalation paths staffed and tested with a real P1 drill.
- [ ] Legal/compliance review of retention schedules and default classification labels.
- [ ] Support/service-desk team trained and able to work the manuals' own troubleshooting table (Section "Troubleshooting and Support" in every manual) — if support can't reproduce what the manual promises, the manual is wrong or the build is incomplete.

---

## 12. Engineering Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Scope was undercounted at project start** (this is not hypothetical — it happened with the pasted roadmap) | Occurred | High — timeline/budget credibility | This TRD is the correction; re-baseline stakeholder expectations against Section 11.2 now, not mid-build |
| **SoD/RBAC complexity underestimated** — 42 roles × ~30 capabilities × scope rules is a large state space | Medium | High — a missed SoD rule is a real audit/compliance failure for customers, not just a bug | Build the SoD engine as data-driven rules (6.4), not code branches; make Appendix A a literal test fixture |
| **ZATCA certification timeline slips** | Medium | High — blocks any real invoicing to Saudi customers | Kick off registration in Phase 0b, track as an external dependency with its own status, not an engineering ticket |
| **Multi-tenant isolation bug** (RLS misconfiguration, missing `tenantId` filter) | Medium | Critical — cross-tenant data exposure is the single worst possible failure for a GRC product | Postgres RLS as a DB-enforced backstop (9), dedicated isolation test suite (11.4), external pen test before go-live |
| **WORM/legal-hold logic incorrectly allows deletion or edit** | Low-Medium | Critical — undermines the product's core evidentiary value proposition | DB-level trigger enforcement (6.1), not application-only checks; automated chain-integrity verification job |
| **Franchise/Holding/Partner scope-resolver bugs** (a role sees more or less than intended) | Medium | High | Explicit per-operating-model scope resolver design (2.1), tested against Appendix A per tenancy shape |
| **Workflow engine becomes a bottleneck if built too late** (each module reinvents approval logic) | Medium | Medium — technical debt, inconsistent SoD enforcement across modules | Sequence it in Phase 1 (11.2), not deferred |
| **Eye Phish infrastructure reputation/deliverability issues** delay campaigns or damage sending domain reputation | Medium | Medium | Dedicated sending infrastructure, gradual warm-up, kicked off in Phase 0b |
| **Marketplace curation pipeline becomes a rubber stamp under delivery pressure** | Medium | High — supply-chain compromise risk propagates to every tenant that installs a flagged tool | Make each curation stage's scan-result attachment mandatory at the data layer, not just process discipline |
| **Team size vs. 9–13 month estimate mismatch** | High if only one engineer | Schedule | Present both the single-engineer and parallelized-team timeline explicitly to stakeholders (11.2) so the tradeoff is a conscious business decision |

---

## Appendix A — Full Role / Capability Matrix (42 roles)

Extracted directly from each manual's "Job / Persona / Portal / Authorized Scope / Core Responsibilities" block. This is the seed data for the `roles` table and the source for the RBAC/SoD parametrized test suite (11.4).

| # | Role | Portal | Scope | Granted capabilities |
|---|---|---|---|---|
| 01 | Platform Super Admin | Saas | All tenants under break-glass |  Create an ITSM ticket,  Create or manage a tenant,  Add a user with role-based access,  Maintain roles and permissions,  Publish or enable a module,  Govern a feature flag,  Create an approval or automation workflow,  Configure an integration,  Monitor security and handle incidents |
| 02 | Platform Security Admin | Saas | Security configuration and logs |  Create an ITSM ticket,  Monitor security and handle incidents,  Maintain roles and permissions,  Govern a feature flag,  Configure an integration,  Create an approval or automation workflow,  Generate and distribute a report |
| 03 | Platform Billing Admin | Saas | Subscriptions and finance |  Create an ITSM ticket,  Create or select a commercial plan,  Manage a subscription,  Generate or review an invoice,  Record and reconcile a payment,  Monitor resource usage and quotas,  Generate and distribute a report |
| 04 | Group Admin | Holding | Assigned group tree |  Create an ITSM ticket,  Manage group or regional governance,  Add a user with role-based access,  Transfer a user between branches or entities,  Maintain roles and permissions,  Import or enable a standard,  Generate and distribute a report |
| 05 | Regional Admin | Holding | Selected entities |  Create an ITSM ticket,  Manage group or regional governance,  Add a user with role-based access,  Transfer a user between branches or entities,  Maintain roles and permissions,  Assess and treat a risk,  Generate and distribute a report |
| 06 | Organization Admin | Multibranch | Assigned organization |  Create an ITSM ticket,  Add a user with role-based access,  Transfer a user between branches or entities,  Maintain roles and permissions,  Import or enable a standard,  Publish or enable a module,  Onboard or purchase an open-source tool,  Generate and distribute a report |
| 07 | Branch Admin | Branch | Assigned branch |  Create an ITSM ticket,  Add a user with role-based access,  Transfer a user between branches or entities,  Maintain roles and permissions,  Manage a control implementation and evidence,  Assess and treat a risk,  Generate and distribute a report |
| 08 | Compliance Manager | Document | Document owner and assigned frameworks |  Create an ITSM ticket,  Create, import and version a document,  Review, approve and digitally sign a document,  Apply retention and legal hold,  Manage a control implementation and evidence,  Acknowledge or monitor a policy,  Generate and distribute a report |
| 09 | Compliance Approver | Document | Approval queue and published policies |  Create an ITSM ticket,  Review, approve and digitally sign a document,  Apply retention and legal hold,  Acknowledge or monitor a policy,  Generate and distribute a report |
| 10 | Staff Employee | Document | Assigned acknowledgements |  Create an ITSM ticket,  Acknowledge or monitor a policy,  Assign or complete learning |
| 11 | External Auditor | Auditor | Selected engagement, read-only |  Create an ITSM ticket,  Plan and execute an audit,  Review, approve and digitally sign a document,  Generate and distribute a report |
| 12 | Partner Owner | Partner | Partner and assigned clients |  Create an ITSM ticket,  Manage partner/client workspaces and engagements,  Add a user with role-based access,  Maintain roles and permissions,  Manage a subscription,  Onboard or purchase an open-source tool,  Generate and distribute a report |
| 13 | Engagement Manager | Partner | Assigned client engagements |  Create an ITSM ticket,  Manage partner/client workspaces and engagements,  Manage a control implementation and evidence,  Assess and treat a risk,  Create, import and version a document,  Generate and distribute a report |
| 14 | Franchisor Admin | Franchise | Entire franchise network |  Create an ITSM ticket,  Manage franchise governance,  Add a user with role-based access,  Import or enable a standard,  Operate Wisdom Eye and Eye Phish,  Generate and distribute a report |
| 15 | Franchisee Admin | Franchise | Own franchise location |  Create an ITSM ticket,  Manage franchise governance,  Add a user with role-based access,  Manage a control implementation and evidence,  Assess and treat a risk,  Acknowledge or monitor a policy,  Generate and distribute a report |
| 16 | Platform Service Desk Manager | Saas | All customer tickets and SLA queues |  Create an ITSM ticket,  Manage and resolve support tickets,  Create an approval or automation workflow,  Generate and distribute a report,  Add a user with role-based access |
| 17 | Open Source Marketplace Curator | Saas | Tool review, publishing and tenant installations |  Create an ITSM ticket,  Onboard or purchase an open-source tool,  Publish or enable a module,  Configure an integration,  Monitor security and handle incidents,  Monitor resource usage and quotas |
| 18 | Customer Success Manager | Saas | Onboarding, adoption, renewals and escalations |  Create an ITSM ticket,  Create or manage a tenant,  Manage a subscription,  Manage and resolve support tickets,  Assign or complete learning,  Generate and distribute a report |
| 19 | Wisdom Eye Security Analyst | Saas | Authorized tenant attack surfaces and findings |  Create an ITSM ticket,  Operate Wisdom Eye and Eye Phish,  Monitor security and handle incidents,  Manage and resolve support tickets,  Generate and distribute a report |
| 20 | Group Compliance Manager | Holding | Group standards, controls and documents |  Create an ITSM ticket,  Import or enable a standard,  Manage a control implementation and evidence,  Create, import and version a document,  Review, approve and digitally sign a document,  Apply retention and legal hold,  Generate and distribute a report |
| 21 | Group Risk Manager | Holding | Consolidated risk across assigned entities |  Create an ITSM ticket,  Assess and treat a risk,  Manage a control implementation and evidence,  Manage group or regional governance,  Generate and distribute a report |
| 22 | Group HR Manager | Holding | Group people operations and awareness |  Create an ITSM ticket,  Add a user with role-based access,  Transfer a user between branches or entities,  Acknowledge or monitor a policy,  Assign or complete learning,  Operate Wisdom Eye and Eye Phish,  Generate and distribute a report |
| 23 | Group Finance Manager | Holding | Group invoices, allocations and payments |  Create an ITSM ticket,  Generate or review an invoice,  Record and reconcile a payment,  Manage a subscription,  Monitor resource usage and quotas,  Generate and distribute a report |
| 24 | Organization GRC Manager | Multibranch | Organization-wide GRC operations |  Create an ITSM ticket,  Import or enable a standard,  Manage a control implementation and evidence,  Assess and treat a risk,  Plan and execute an audit,  Create, import and version a document,  Generate and distribute a report |
| 25 | Risk Manager | Multibranch | Organization and assigned branches |  Create an ITSM ticket,  Assess and treat a risk,  Manage a control implementation and evidence,  Generate and distribute a report |
| 26 | HR Manager | Multibranch | Organization people operations |  Create an ITSM ticket,  Add a user with role-based access,  Transfer a user between branches or entities,  Acknowledge or monitor a policy,  Assign or complete learning,  Operate Wisdom Eye and Eye Phish,  Generate and distribute a report |
| 27 | Finance Manager | Multibranch | Tenant billing, invoices and payments |  Create an ITSM ticket,  Generate or review an invoice,  Record and reconcile a payment,  Manage a subscription,  Onboard or purchase an open-source tool,  Generate and distribute a report |
| 28 | Organization Support Coordinator | Multibranch | Organization tickets and service requests |  Create an ITSM ticket,  Manage and resolve support tickets,  Create an approval or automation workflow,  Generate and distribute a report,  Add a user with role-based access |
| 29 | Wisdom Eye Manager | Multibranch | All authorized organization assets and phishing campaigns |  Create an ITSM ticket,  Operate Wisdom Eye and Eye Phish,  Assign or complete learning,  Manage and resolve support tickets,  Generate and distribute a report |
| 30 | Branch Compliance Officer | Branch | Assigned branch controls and evidence |  Create an ITSM ticket,  Manage a control implementation and evidence,  Create, import and version a document,  Assess and treat a risk,  Plan and execute an audit,  Generate and distribute a report |
| 31 | Branch Finance User | Branch | Branch allocations and invoice visibility |  Create an ITSM ticket,  Generate or review an invoice,  Record and reconcile a payment,  Generate and distribute a report |
| 32 | Branch HR User | Branch | Branch staff, awareness and acknowledgements |  Create an ITSM ticket,  Add a user with role-based access,  Acknowledge or monitor a policy,  Assign or complete learning,  Operate Wisdom Eye and Eye Phish,  Generate and distribute a report |
| 33 | Pre-Sales Manager | Partner | Solutions, proposals, demos and marketplace offers |  Create an ITSM ticket,  Create or select a commercial plan,  Onboard or purchase an open-source tool,  Create or manage a tenant,  Manage a subscription,  Generate and distribute a report |
| 34 | Post-Sales Customer Success Manager | Partner | Client onboarding, adoption, tickets and renewals |  Create an ITSM ticket,  Manage partner/client workspaces and engagements,  Manage and resolve support tickets,  Assign or complete learning,  Generate and distribute a report |
| 35 | Franchise Support Manager | Franchise | Network tickets, location onboarding and escalations |  Create an ITSM ticket,  Manage and resolve support tickets,  Create an approval or automation workflow,  Generate and distribute a report,  Add a user with role-based access |
| 36 | Internal Auditor | Tenant Assurance | Assigned audit universe |  Create an ITSM ticket,  Plan and execute an audit,  Manage a control implementation and evidence,  Create, import and version a document,  Generate and distribute a report |
| 37 | Control Owner | Tenant GRC Operations | Assigned controls and implementations |  Create an ITSM ticket,  Manage a control implementation and evidence,  Create, import and version a document,  Assess and treat a risk,  Generate and distribute a report |
| 38 | Asset Owner | Tenant Asset Management | Assigned assets |  Create an ITSM ticket,  Maintain an asset,  Assess and treat a risk,  Generate and distribute a report |
| 39 | Vendor Owner | Tenant Third-Party Risk | Assigned vendors |  Create an ITSM ticket,  Assess and remediate a vendor,  Assess and treat a risk,  Create, import and version a document,  Generate and distribute a report |
| 40 | Consultant | Consulting Partner / MSP | Assigned clients and tasks |  Create an ITSM ticket,  Manage partner/client workspaces and engagements,  Manage a control implementation and evidence,  Assess and treat a risk,  Plan and execute an audit,  Create, import and version a document,  Generate and distribute a report |
| 41 | Client Administrator | Client Workspace | Own client workspace |  Create an ITSM ticket,  Add a user with role-based access,  Transfer a user between branches or entities,  Maintain roles and permissions,  Import or enable a standard,  Manage partner/client workspaces and engagements,  Generate and distribute a report |
| 42 | Client Contributor | Client Workspace | Assigned evidence and tasks |  Create an ITSM ticket,  Manage a control implementation and evidence,  Create, import and version a document,  Acknowledge or monitor a policy |

---

## Appendix B — Canonical Capability Catalogue (cross-reference)

See Section 5 for the full specification of each of the 30 canonical capabilities plus the 4 tenancy-shape-specific governance capabilities. This appendix is a pointer, not a duplicate, to keep the document navigable — search Section 5 for capability detail when implementing Appendix A role permissions.

---

## Appendix C — Glossary (platform-native terms, as defined in the Common Onboarding Manual)

| Term | Meaning |
|---|---|
| Tenant | A customer workspace isolated from other customers |
| Entity | A legal company, subsidiary or governed organization unit |
| Branch | An operational location with locally scoped users and records |
| Role | A named set of job permissions |
| Scope | The organizations, branches, clients or records the role may access |
| MFA | A second authentication factor used in addition to a password |
| Control | A requirement or safeguard designed to manage risk or meet an obligation |
| Implementation | How a control operates in practice |
| Evidence | A record demonstrating that an activity or control occurred |
| Finding | An audit or assessment issue requiring action |
| SLA | A service target such as response or resolution time |
| Legal hold | A freeze that prevents normal deletion or disposal |
| Entitlement | A purchased or assigned right to use a module or feature |
| Quota | A plan limit for users, branches, storage, AI, monitored assets or another resource |
| Audit trail | Protected history of actions and changes |

---

*End of document. This TRD should be treated as a living artifact — update it when the platform's real behavior diverges from the manuals (Section 5's "Training Governance" rule from the manual catalogue applies equally to this document: "must be updated when the approved workflow changes").*

