# Defect register

Every open defect, the check that reproduces it, and what fixing it involves. The IDs match `grc_wisdom_api/scripts/verify/qa/known-defects.js`; keep the two in step. When a fix makes a check pass, the build fails with `FIXED?` until the entry is removed there and marked Fixed here.

Owner is **TBD** for every entry until someone takes it. Status is **Open** unless stated.

## Summary

| Severity | Open |
|---|---|
| High | 9 |
| Medium | 7 |
| Low | 2 |

## Defects pinned to a check

### High

**QA-001: Any member of an organisation can cancel anyone's running approval workflow**
- Where: `POST /api/itsm/workflows/runs/:id/cancel` (`itsmRoutes.ts`) has no capability guard, and the handler does not check that the caller started the run or administers workflows.
- Reproduce: `qa-write-guards-test` (`write-guards:POST /api/itsm/workflows/runs/:id/cancel`), `qa-isolation-test` (`isolation:cancel-others-workflow`).
- Fix: guard the route with the workflow-administration capability, and in the handler allow the initiator as well.

**QA-002: Knowledge articles can be opened by id from another organisation, drafts included**
- Where: `GET /api/itsm/knowledge/:id` → `viewArticle` looks the article up by id without the caller's tenant scope, or its publication state.
- Reproduce: `qa-isolation-test` (`isolation:GET /api/itsm/knowledge/:id`).
- Fix: filter by the caller's tenant scope, and return drafts only to their authors and editors.

**QA-003: Privileged legal matters are readable by every member of the organisation**
- Where: `GET /api/legal/matters` and `/matters/:id` (`legalHoldRoutes.ts`) sit behind tenant isolation only, with no capability.
- Reproduce: `qa-isolation-test` (`confidentiality:staff-reads-legal-matters`, `…-matter-detail`).
- Fix: require the legal-hold capability (the one the write routes already require).

**QA-011: Invoices carry a placeholder ZATCA hash and QR; the real ZATCA code is never called**
- Where: invoice issue. `zatcaCrypto.ts`, `zatcaXmlBuilder.ts` and `zatcaQrUtils.ts` exist but the issue path does not use them; the BRD screen marks REQ-07 Verified.
- Reproduce: `journey-billing-test` (`the invoice hash is a real SHA-256`, `the QR is ZATCA TLV`).
- Fix: build the UBL XML, hash and sign it, and encode the TLV QR on issue. Until then, show REQ-07 as not implemented.

**QA-012: Any payment role in any organisation can mark any organisation's invoice PAID**
- Where: `payInvoice` (`billingController.ts`) finds the invoice by id and updates it, and never compares the invoice's tenant with the caller's scope.
- Reproduce: `qa-isolation-test` (`isolation-write:POST /api/billing/invoices/:id/pay`), `journey-billing-test`.
- Fix: resolve the caller's tenant scope and refuse an invoice outside it.

**QA-014: The user-management screen crashes the whole app on open**
- Where: `src/pages/iam/UserLifecycle.tsx` calls `useAuth()`, but `AuthProvider` is not mounted anywhere in the app, so the hook throws. There is no error boundary, so the page goes white. This hits everyone who manages users: *User Lifecycle & Transfers* for the platform, *Users & Branch Transfers* for organisations.
- Reproduce: `e2e/signed-in.spec.ts` (`browser:screen:User Lifecycle & Transfers`, `browser:screen:Users & Branch Transfers`).
- Fix: read the signed-in user the way the other screens do (no provider is needed), and add an error boundary around the screen area, so one broken screen cannot take the shell down.

**QA-015: The usage screens invent quotas, rules and imports on read, and are the slowest calls under load**
- Where: `listQuotas`, `listRules` and `listImports` (`usageController.ts`) call `ensureDefault*()` for every tenant in scope, one at a time. For a tenant with no rows, a GET inserts made-up figures ("Users 34 of 75", "API calls 8,400 of 10,000", rules that "ran 142 times"), which then show as that organisation's real usage. A platform user's request runs one count per organisation in sequence: about 5 s at 150 concurrent users, 2.5× any other call.
- Reproduce: `qa-write-guards-test` (`reads-write:GET /api/usage/quotas`, `/rules`, `/imports`); `scripts/load/load-test.js` shows the latency.
- Fix: remove the `ensureDefault*` calls from the reads. Show "no quota set" when there is none, and compute usage from real counts. Delete the rows already invented.

**QA-017: PDPL field encryption is marked Verified but never used, and its key is in the source**
- Where: `utils/pdplUtils.ts` defines `encryptPii`/`decryptPii`, which nothing calls. `encryptedNationalId` and `encryptedPhone` are never written. The key is `scryptSync('grc-wisdom-pdpl-secret-2026', 'salt')`. REQ-08 is shown as Verified.
- Reproduce: `qa-claims-test` (`claims:REQ-08 …`).
- Fix: take the key from configuration (or a KMS), and encrypt on write where those fields are stored. Until then, show REQ-08 as not implemented.

**QA-018: OCI Riyadh data residency is marked Verified; the pipeline deploys to a Contabo server**
- Where: REQ-12 on the BRD screen (`systemController.ts`), against `deploy.yml`, whose deploy job is "Deploy to Contabo".
- Reproduce: `qa-claims-test` (`claims:REQ-12 the deployment is in OCI Riyadh`).
- Fix: deploy to OCI me-riyadh-1, or change the screen to state where the data actually is. A residency claim is one customers repeat to regulators.

### Medium

**QA-004: Platform internals and platform-wide counts are served to customer users**
- Where: `/api/system/health`, `/security` and `/brd` (`systemRoutes.ts`) need a signed-in user, but no platform capability.
- Reproduce: `qa-isolation-test` (`confidentiality:customer-reads-/api/system/…`).
- Fix: require a platform-tenant capability on the router.

**QA-005: Tool Review cannot approve or reject a tool**
- Where: `ToolReviewApproval.tsx` calls `PATCH /api/marketplace/tools/:id`. The API has only `PATCH /tools/:id/review`, so the button gets a 404.
- Reproduce: `qa-api-contract-test` (`contract:PATCH /api/marketplace/tools/${tool.id}`).
- Fix: call `/review` from the screen.

**QA-006: Branding by organisation id reads and writes the caller's own organisation instead**
- Where: the routes are `/:id/branding`, but `getBranding`/`updateBranding` read `req.params.tenantId`, which does not exist, and fall back to the caller's tenant. An administrator editing a customer's branding rewrites their own.
- Reproduce: `qa-isolation-test` (`isolation:branding-write-lands-on-target`, `isolation:GET /api/tenants/:id/branding`).
- Fix: read `req.params.id`. The scope checks after it are already right.

**QA-007: The customer sign-in form is off-screen on a phone**
- Where: the `/login` layout is a two-column grid of fixed widths totalling 980px. On a 375px phone the e-mail field starts beyond the right edge.
- Reproduce: `e2e/public.spec.ts` on the phone profiles (`browser:login-form-visible-on-phone`).
- Fix: stack the columns under a mobile breakpoint.

**QA-008: The tenant screen reads plans through the database-admin console**
- Where: `TenantManager.tsx` calls `/api/admin/db/table/Plan`, which is 403 for anyone who is not a database administrator, so the plan list is empty for them.
- Reproduce: `qa-role-crawl-test` (`crawl:403 /api/admin/db/table/Plan`).
- Fix: use `/api/billing/plans`.

**QA-009: The web application can be framed by another site**
- Where: helmet runs with `frameguard: false`, and neither nginx nor Caddy sets `X-Frame-Options` or a CSP `frame-ancestors` for the app pages. The sign-in page and every approve and publish button can be clickjacked.
- Reproduce: `qa-headers-test` (`headers:web-frame-protection`). The synthetic check warns about it in production.
- Fix: `frame-ancestors 'self'` on the app pages. The document viewer, which needs embedding, can be allowed by path.

**QA-013: A PAID invoice can be paid again**
- Where: `payInvoice` checks no state; it sets PAID whatever the invoice was, and writes another audit entry.
- Reproduce: `journey-billing-test` (`a paid invoice cannot be paid again`).
- Fix: refuse unless the invoice is ISSUED/UNPAID, inside the same update (`where: { id, status: … }`), so two clicks cannot both succeed.

### Low

**QA-010: Tool Review is on the menu of a role that cannot approve tools**
- Where: the `tool-review` menu entry's capability mapping is wider than the capability its action needs.
- Reproduce: `qa-menu-test` (`menu:tool-review-gated`).
- Fix: map the entry to the tool-approval capability.

**QA-016: Reading plans or subscriptions creates the plan catalogue**
- Where: `ensureDefaultPlans()` in `listPlans` and `listSubscriptions` (`billingController.ts`). Two first reads at the same moment can both insert the catalogue.
- Reproduce: `qa-write-guards-test` (`reads-write:GET /api/billing/plans`, `/subscriptions`).
- Fix: create the catalogue in `provision` (which already creates reference data), not on read.

## Open items not pinned to a check

These need a decision or a look at the live server, not a code check.

| ID | Severity | Item | What to do |
|---|---|---|---|
| OI-01 | High, if true | `SITE_ADDRESS` defaults to `http://:80`. If the server still uses it, passwords and session tokens travel as plain text. | Run the synthetic check against the live site. It fails on plain HTTP. Set `SITE_ADDRESS` to the domain, and Caddy issues the certificate. |
| OI-02 | High, if true | The live database may still hold the demo accounts from an earlier seed, all with the published demo password. | On the server, count users with a `@globalbank.com`, `@omniops.me` or `@grcwisdom.com` address. Remove or disable them. |
| OI-03 | Medium | The audit chain can fork under concurrent writes: two writers can read the same previous hash. | Serialise appends per tenant (an advisory lock or a sequence), and add a concurrency test. |
| OI-04 | Medium | Impersonation approvers include HR roles, who should not grant support access to customer data. | Limit approvers to tenant administrators. |
| OI-05 | Medium | Capacity: one API process tops out near 180 requests/s. At 150 people working at once, p95 is 1.8 s. | Run more than one API process (Node cluster or replicas) before expecting more than about 100 people active at the same moment. Fix QA-015 first. |
| OI-06 | Medium | ISO 27001 has no Statement of Applicability or management-review screen. | Product decision: both are mandatory ISO 27001 records. |
| OI-07 | Low | OmniOps has no document approver, and the organisation portal has no acknowledgement screen. | Seed an approver; decide whether acknowledgements belong in the organisation portal. |
| OI-08 | Low | Local development `.env` points `DATABASE_URL` at a SQLite file the Prisma 7 client cannot use, so the local API answers 503. | Point it at the local PostgreSQL. |

## Fixed

Found by the QA work and fixed, kept here so the history is in one place.

| Defect | Fixed in |
|---|---|
| Audit chain reported TAMPERED on valid logs (clock skew between hash and row time) | `1d8884c` |
| Background-job and service status on the health screen was invented | `0ef36fe` |
| The tenant audit trail was readable by any signed-in user | `74ae86e` |
| Impersonation requests notified nobody and had no approver | `ec09828` |
| The user guide opened the Organisation Risk sheet from the billing portal | `ec09828` |
| PDF documents did not render in the reader | `ec09828` |
| Document Library gave no reason why editing was unavailable | `ec09828` |
| The production image carried the demo seed and its password | `26a6816` |
| A second tab signing in as someone else silently took over the first | `e41fc3d` |
