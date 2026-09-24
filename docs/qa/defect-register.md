# Defect register

Every open defect, the check that reproduces it, and what fixing it involves. The IDs match `grc_wisdom_api/scripts/verify/qa/known-defects.js`; keep the two in step. When a fix makes a check pass, the build fails with `FIXED?` until the entry is removed there and marked Fixed here.

Owner is **TBD** for every entry until someone takes it. Status is **Open** unless stated.

## Summary

| Severity | Open |
|---|---|
| High | 5 |
| Medium | 9 |
| Low | 3 |

## Defects pinned to a check

### High

**QA-011: Invoices carry a placeholder ZATCA hash and QR; the real ZATCA code is never called**
- Where: invoice issue. `zatcaCrypto.ts`, `zatcaXmlBuilder.ts` and `zatcaQrUtils.ts` exist but the issue path does not use them; the BRD screen marks REQ-07 Verified.
- Reproduce: `journey-billing-test` (`the invoice hash is a real SHA-256`, `the QR is ZATCA TLV`).
- Fix: build the UBL XML, hash and sign it, and encode the TLV QR on issue. Until then, show REQ-07 as not implemented.

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

### Low

**QA-010: Tool Review is on the menu of a role that cannot approve tools**
- Where: the `tool-review` menu entry's capability mapping is wider than the capability its action needs.
- Reproduce: `qa-menu-test` (`menu:tool-review-gated`).
- Fix: map the entry to the tool-approval capability.

**QA-016: Reading plans or subscriptions creates the plan catalogue**
- Where: `ensureDefaultPlans()` in `listPlans` and `listSubscriptions` (`billingController.ts`). Two first reads at the same moment can both insert the catalogue.
- Reproduce: `qa-write-guards-test` (`reads-write:GET /api/billing/plans`, `/subscriptions`).
- Fix: create the catalogue in `provision` (which already creates reference data), not on read.

### Capacity

Found by measurement (see [monitoring-and-load.md](monitoring-and-load.md)), pinned by `qa-capacity-test`.

**QA-019 (Medium): The request limit is per network address, so one office of about 25 busy people is refused**
- Where: `apiLimiter` in `app.ts` has no `keyGenerator`, so it counts per address, 300 a minute. A customer's staff share their office's address.
- Reproduce: `qa-capacity-test` (`capacity:the request limit is counted per person, not per office address`); `load-test.js` with `OFFICES=1`: 40 people, a screen every ~10 s, 29% refused.
- Fix: key the limit on the signed-in user, falling back to the address for anonymous calls.

**QA-020 (Medium): Failed sign-ins are counted per address; ten typos in one office lock everyone there out**
- Where: `authLimiter` in `app.ts` counts failures per address for 15 minutes.
- Reproduce: `qa-capacity-test` (`capacity:failed sign-ins lock an account, not an office`).
- Fix: count failures per account (e-mail) and address together, with a much higher per-address ceiling.

**QA-021 (Medium): Lists stop at a fixed number of rows with no paging; records past the cap vanish silently**
- Where: 31 list handlers use `take: N` (50 to 2,000) and none accepts a page or cursor. The risk register returns 500, sorted by residual score, so the lowest-rated risks disappear without notice.
- Reproduce: `qa-capacity-test` (`capacity:lists that cap their rows can page past the cap`).
- Fix: cursor paging on the lists, and a total count so the screen can say "500 of 5,000".

**QA-022 (Medium): Verifying the audit trail loads the whole history into memory**
- Where: `verifyAuditTrail` (`dbAdminController.ts`) reads every audit row of every organisation in one query each. Measured: +225 MB for 200,000 rows, in one click.
- Reproduce: `qa-capacity-test` (`capacity:verifying the audit trail reads in batches`).
- Fix: walk the chain in batches (`take` + cursor), carrying the previous hash between batches.

**QA-023 (Low): Background jobs start in every API process**
- Where: `server.ts` starts the SLA escalation and risk-review scanners unconditionally, so a second process runs every job twice.
- Reproduce: `qa-capacity-test` (`capacity:background jobs can be confined to one process`).
- Fix: start them only where an environment flag says so, and set it on exactly one process.

## Open items not pinned to a check

These need a decision or a look at the live server, not a code check.

| ID | Severity | Item | What to do |
|---|---|---|---|
| OI-01 | **High, confirmed 2026-09-24** | The live site (http://161.97.120.202) is plain HTTP: port 443 does not answer, so passwords and session tokens cross the network readable. `synthetic-check.js` fails on it. | Point a domain's A record at the server, set `SITE_ADDRESS` to that domain (no `http://`) in the server's `deploy/.env`, open ports 80 and 443, and restart Caddy; it obtains the certificate itself. No rebuild: the app calls its API on its own origin. Then change every password that was used over plain HTTP. |
| OI-02 | High, if present | The live database may still hold the demo seed's 66 accounts, which share one published password. | Run `grc_wisdom_api/scripts/ops/demo-accounts-find.sql` on the server (read only), then `demo-accounts-suspend.sql`: suspends, deletes nothing (168 relations cascade on a user delete), keeps any address you list, and refuses if it would leave no active platform account. Tested against a seeded database. |
| OI-03 | Medium | The audit chain can fork under concurrent writes: two writers can read the same previous hash. | Serialise appends per tenant (an advisory lock or a sequence), and add a concurrency test. |
| OI-04 | Medium | Impersonation approvers include HR roles, who should not grant support access to customer data. | Limit approvers to tenant administrators. |
| OI-05 | Medium | Capacity: one API process tops out at 100 to 180 requests/s, limited by its single CPU core; each request makes about 14 queries one after another. | Fix QA-015 and QA-023, then run one process per core before expecting more than about 100 people active at the same moment. Keep the database on the same host until queries per request come down. |
| OI-06 | Medium | ISO 27001 has no Statement of Applicability or management-review screen. | Product decision: both are mandatory ISO 27001 records. |
| OI-07 | Low | OmniOps has no document approver, and the organisation portal has no acknowledgement screen. | Seed an approver; decide whether acknowledgements belong in the organisation portal. |
| OI-08 | Low | Local development `.env` points `DATABASE_URL` at a SQLite file the Prisma 7 client cannot use, so the local API answers 503. | Point it at the local PostgreSQL. |
| OI-09 | Medium | The live site runs `134e399`: none of the fixes committed since, including Phase 1, are deployed. | Push when ready; CI runs every suite, then deploys. |
| OI-10 | Low | First visit to the live site downloads one 1.36 MB script (344 KB compressed) at 35–60 KB/s from the server, against 280–580 KB/s from a CDN on the same connection: about 7 s before the app appears. Later visits are cached. | Split the bundle (Vite warns it is over 500 KB), and check the server's bandwidth or put the static files behind a CDN. |

## Fixed

Found by the QA work and fixed, kept here so the history is in one place.

| Defect | Fixed in |
|---|---|
| QA-012 Any payment role could mark any organisation's invoice paid. The invoice is now checked against the caller's organisations, and one outside them reads as not found | `1e34744` |
| QA-013 A paid invoice could be paid again. The payment is now conditional on UNPAID inside the update, so a double click cannot pay twice (409) | `6c33423` |
| QA-002 Knowledge articles opened by id across organisations, drafts included. Now scoped to the caller's organisations; drafts only for the author and article writers, in the list too | `fe1fb5c` |
| QA-001 Any member could cancel anyone's running approval. Now only whoever started it, or a workflow administrator (403 otherwise) | `630c594` |
| QA-003 Privileged legal matters were readable by every member. Reading matters now needs the legal-hold capability, and the menu entry follows | `5c8ca33` |
| QA-006 Branding by organisation id read and wrote the caller's own organisation. The route parameter now matches what the handlers read; a write to a foreign organisation is refused | `533180a` |
| Audit chain reported TAMPERED on valid logs (clock skew between hash and row time) | `1d8884c` |
| Background-job and service status on the health screen was invented | `0ef36fe` |
| The tenant audit trail was readable by any signed-in user | `74ae86e` |
| Impersonation requests notified nobody and had no approver | `ec09828` |
| The user guide opened the Organisation Risk sheet from the billing portal | `ec09828` |
| PDF documents did not render in the reader | `ec09828` |
| Document Library gave no reason why editing was unavailable | `ec09828` |
| The production image carried the demo seed and its password | `26a6816` |
| A second tab signing in as someone else silently took over the first | `e41fc3d` |
