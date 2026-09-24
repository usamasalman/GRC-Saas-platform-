# Requirements traceability

The twelve requirements on the BRD Traceability screen (`GET /api/system/brd`), the tests that exercise each, and what those tests found. The last column is what the tests support.

The screen used to mark all twelve **Verified** by string, with a compliance figure of 100. It now takes each status from the defect register (`src/qa/known-defects.json`): a requirement is Verified only while no open defect names it, and the screen lists the defects that do. Today that is 8 of 12 (67%): REQ-02 (QA-029), REQ-07 (QA-011), REQ-08 (QA-017) and REQ-12 (QA-018) show Not verified. The Platform Security and architecture pages take their statuses from the same register (QA-028). `qa-claims-test` keeps it that way.

| ID | Requirement | Tests | Result | Tests support "Verified"? |
|---|---|---|---|---|
| REQ-01 | Multi-tenant isolation | `qa-isolation-test` (92 read and 372 write probes across organisations), `platform-scope-test`, `document-access-test`, `uploads-not-public-test`, `tenant-suspension-test`, `journey-billing-test` | Four cross-organisation holes found and fixed (QA-001, 002, 006, 012). A write to a foreign organisation's branding is now checked too | Yes |
| REQ-02 | Cryptographic WORM audit chain | `audit-chain-test`, `audit-concurrency-test`, `audit-trail-access-test`, `audit-tabs-test` | Chain verifies, and an altered row is caught and named; reading it needs a capability. The security screen had its own check that sampled 100 rows across organisations and reported false tampering; it now uses the same verifier (QA-027). Open: audited requests arriving together fork the chain, and the verifier then reports tampering on untouched records (QA-029) | **No** |
| REQ-03 | Capability-based authorisation | `qa-write-guards-test` (260 write routes), `capabilities-mean-something-test`, `guarded-actions-test`, `nav-capabilities-test`, `qa-menu-test`, `qa-role-crawl-test` (44 role shapes, 1,611 screen loads), `portal-follows-role-test` | QA-001, 003, 004 and 010 fixed, and QA-025 (a platform role in a customer organisation) found and fixed | Yes |
| REQ-04 | Segregation of duties | `project-delivery-test` (verifier ≠ doer), `journey-document-lifecycle-test` (approver ≠ author, password re-entry), `document-editors-test`, `offboarding-test` | Holds where tested. The SoD rule editor has no end-to-end test | Yes, for documents and delivery |
| REQ-05 | Standards, controls and evidence | `journey-iso-controls-test`, `standards-enablement-test`, `enablement-plan-test`, `project-standards-test`, `criteria-versioning-test`, `residual-feedback-test`, `risk-lifecycle-loops`, `risk-import-test`, `asset-*` | Holds. The framework import routes acted on risk, asset and vendor imports; fixed (QA-026). Gaps for ISO 27001: no SoA or management-review records (OI-06) | Yes, with the ISO gaps noted |
| REQ-06 | Workflow-engine ITSM | `workflow-authoring-test`, `work-notification-test`, `journey-impersonation-test`, `qa-write-guards-test` | QA-001 and QA-002 fixed | Yes |
| REQ-07 | ZATCA Phase 2 e-invoicing | `journey-billing-test`, `invoicing-test` | Hash and QR are placeholders (QA-011). Paying another organisation's invoice, or paying twice, is fixed (QA-012, 013) | **No** |
| REQ-08 | PDPL encrypted PII fields | `qa-claims-test` | Encryption never called; key in source (QA-017) | **No** |
| REQ-09 | Customer-authorised support impersonation | `journey-impersonation-test`, `reported-defects-test` | Holds. Approver set too wide (OI-04) | Yes |
| REQ-10 | Usage and quota management | `qa-write-guards-test` (reads that write), `scripts/load/load-test.js` | Nothing is invented any more (QA-015 fixed). Usage figures are what an administrator records, not measured from use | Partly |
| REQ-11 | Wisdom Eye and Eye Phish | `capabilities-mean-something-test`, `audit-trail-access-test` (routes guarded) | Guarding is tested; the scanning and phishing results are not | **Untested** beyond access control |
| REQ-12 | OCI Riyadh sovereign cloud | `qa-claims-test` | Deploys to Contabo (QA-018) | **No** |

## Reading this table

- **Tests** are the suites that would fail if the requirement broke. A suite named here runs in CI on every push, except the load test.
- Four of the twelve requirements (REQ-02, 07, 08, 12) are contradicted by a failing check today; REQ-01, 03 and 10 were, until the Phase 1 and 2 fixes. The BRD screen now shows them as Not verified, from the register.
- REQ-11 needs a journey: run a scan and a phishing campaign against a test target, and check what the screen reports against what happened.

## Business processes (journeys)

| Journey | People | Requirements | Checks |
|---|---|---|---|
| Document lifecycle: draft → approve → publish → read | Compliance manager, approver, staff | REQ-01, 03, 04 | 14 |
| Support impersonation: request → approve → act → end → audit | Platform support, tenant admin | REQ-02, 09 | 12 |
| Billing: preview → issue → pay → cannot pay twice → cannot pay another's | Billing, finance roles in two organisations | REQ-01, 07 | 12 (2 known defects, both QA-011) |
| ISO 27001 controls: enable → assign → implement → assess → coverage report | GRC manager, risk manager, internal auditor | REQ-05 | 12 |
