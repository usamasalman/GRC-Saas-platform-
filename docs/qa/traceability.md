# Requirements traceability

The twelve requirements on the BRD Traceability screen (`GET /api/system/brd`), the tests that exercise each, and what those tests found. The screen marks all twelve **Verified**. The last column is what the tests support.

| ID | Requirement | Tests | Result | Tests support "Verified"? |
|---|---|---|---|---|
| REQ-01 | Multi-tenant isolation | `qa-isolation-test` (92 read and 372 write probes across organisations), `platform-scope-test`, `document-access-test`, `uploads-not-public-test`, `tenant-suspension-test`, `journey-billing-test` | Four cross-organisation holes: QA-002, QA-006, QA-012, and QA-001 (cancel) | **No**, until those are fixed |
| REQ-02 | Cryptographic WORM audit chain | `audit-chain-test`, `audit-trail-access-test`, `audit-tabs-test` | Chain verifies; reading it needs a capability. Open: concurrent appends can fork it (OI-03) | Partly |
| REQ-03 | Capability-based authorisation | `qa-write-guards-test` (260 write routes), `capabilities-mean-something-test`, `guarded-actions-test`, `nav-capabilities-test`, `qa-menu-test`, `qa-role-crawl-test` (44 role shapes, 1,611 screen loads), `portal-follows-role-test` | QA-001, QA-003, QA-004, QA-010 | **No**, until the High ones are fixed |
| REQ-04 | Segregation of duties | `project-delivery-test` (verifier ≠ doer), `journey-document-lifecycle-test` (approver ≠ author, password re-entry), `document-editors-test`, `offboarding-test` | Holds where tested. The SoD rule editor has no end-to-end test | Yes, for documents and delivery |
| REQ-05 | Standards, controls and evidence | `journey-iso-controls-test`, `standards-enablement-test`, `enablement-plan-test`, `project-standards-test`, `criteria-versioning-test`, `residual-feedback-test`, `risk-lifecycle-loops`, `risk-import-test`, `asset-*` | Holds. Gaps for ISO 27001: no SoA or management-review records (OI-06) | Yes, with the ISO gaps noted |
| REQ-06 | Workflow-engine ITSM | `workflow-authoring-test`, `work-notification-test`, `journey-impersonation-test`, `qa-write-guards-test` | QA-001, QA-002 | Partly |
| REQ-07 | ZATCA Phase 2 e-invoicing | `journey-billing-test`, `invoicing-test` | Hash and QR are placeholders (QA-011) | **No** |
| REQ-08 | PDPL encrypted PII fields | `qa-claims-test` | Encryption never called; key in source (QA-017) | **No** |
| REQ-09 | Customer-authorised support impersonation | `journey-impersonation-test`, `reported-defects-test` | Holds. Approver set too wide (OI-04) | Yes |
| REQ-10 | Usage and quota management | `qa-write-guards-test` (reads that write), `scripts/load/load-test.js` | Quotas, rules and imports are invented on read (QA-015) | **No** |
| REQ-11 | Wisdom Eye and Eye Phish | `capabilities-mean-something-test`, `audit-trail-access-test` (routes guarded) | Guarding is tested; the scanning and phishing results are not | **Untested** beyond access control |
| REQ-12 | OCI Riyadh sovereign cloud | `qa-claims-test` | Deploys to Contabo (QA-018) | **No** |

## Reading this table

- **Tests** are the suites that would fail if the requirement broke. A suite named here runs in CI on every push, except the load test.
- Six of the twelve requirements (REQ-01, 03, 07, 08, 10, 12) are contradicted by a failing check today. The BRD screen should not say Verified for them until the defects are closed. The simplest honest fix is for that screen to read its status from the build, not from a string in `systemController.ts`.
- REQ-11 needs a journey: run a scan and a phishing campaign against a test target, and check what the screen reports against what happened.

## Business processes (journeys)

| Journey | People | Requirements | Checks |
|---|---|---|---|
| Document lifecycle: draft → approve → publish → read | Compliance manager, approver, staff | REQ-01, 03, 04 | 14 |
| Support impersonation: request → approve → act → end → audit | Platform support, tenant admin | REQ-02, 09 | 12 |
| Billing: preview → issue → pay → cannot pay twice → cannot pay another's | Billing, finance roles in two organisations | REQ-01, 07 | 12 (4 known defects) |
| ISO 27001 controls: enable → assign → implement → assess → coverage report | GRC manager, risk manager, internal auditor | REQ-05 | 12 |
