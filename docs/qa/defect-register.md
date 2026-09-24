# Defect register

Every open defect, the check that reproduces it, and what fixing it involves. The IDs match `grc_wisdom_api/scripts/verify/qa/known-defects.js`; keep the two in step. When a fix makes a check pass, the build fails with `FIXED?` until the entry is removed there and marked Fixed here.

Owner is **TBD** for every entry until someone takes it. Status is **Open** unless stated.

## Summary

| Severity | Open |
|---|---|
| High | 3 |
| Medium | 5 |
| Low | 1 |

## Defects pinned to a check

### High

**QA-011: Invoices carry a placeholder ZATCA hash and QR; the real ZATCA code is never called**
- Where: invoice issue. `zatcaCrypto.ts`, `zatcaXmlBuilder.ts` and `zatcaQrUtils.ts` exist but the issue path does not use them; the BRD screen marks REQ-07 Verified.
- Reproduce: `journey-billing-test` (`the invoice hash is a real SHA-256`, `the QR is ZATCA TLV`).
- Fix: build the UBL XML, hash and sign it, and encode the TLV QR on issue. Until then, show REQ-07 as not implemented.

**QA-017: PDPL field encryption is marked Verified but never used, and its key is in the source**
- Where: `utils/pdplUtils.ts` defines `encryptPii`/`decryptPii`, which nothing calls. `encryptedNationalId` and `encryptedPhone` are never written. The key is `scryptSync('grc-wisdom-pdpl-secret-2026', 'salt')`. REQ-08 is shown as Verified.
- Reproduce: `qa-claims-test` (`claims:REQ-08 …`).
- Fix: take the key from configuration (or a KMS), and encrypt on write where those fields are stored. Until then, show REQ-08 as not implemented.

**QA-018: OCI Riyadh data residency is marked Verified; the pipeline deploys to a Contabo server**
- Where: REQ-12 on the BRD screen (`systemController.ts`), against `deploy.yml`, whose deploy job is "Deploy to Contabo".
- Reproduce: `qa-claims-test` (`claims:REQ-12 the deployment is in OCI Riyadh`).
- Fix: deploy to OCI me-riyadh-1, or change the screen to state where the data actually is. A residency claim is one customers repeat to regulators.

### Medium

**QA-024: The platform dashboard shows invented figures**
- Where: `RealtimeDashboardPage.tsx` falls back to literal numbers when a count is missing (`|| 84` organisations, `|| 81` subscriptions) and writes trends into the markup ("+4 this quarter", "96.4% active", "+18.7% YoY"). They read as measurements.
- Reproduce: `qa-claims-test` (`claims:dashboards show only figures they computed`).
- Fix: show a dash where a figure is not computed, and compute the trends or remove them.

### Low

None open outside the capacity findings below.

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
| QA-014 The user-management screen blanked the whole app. It takes the signed-in account from the shell; an error boundary now contains any screen that fails; the unused AuthContext is removed | `6986e7c` |
| QA-005 Tool Review approve and reject called a route that does not exist. They call `/tools/:id/review` | `fae6feb` |
| QA-010 Tool Review was on the menu of roles that cannot approve. Gated on ONBOARD_TOOL | `6f2d46e` |
| QA-008 The tenant screen read plans through the database console. It reads `/api/billing/plans` | `9546c83` |
| QA-016 Reading plans created the plan catalogue. `provision` creates it, only into an empty table | `7e07883` |
| QA-004 Platform internals were served to customer users. `/api/system` is platform-only; customer dashboards no longer ask | `0f8a157` |
| QA-025 A customer's user holding a platform role was given the platform control plane. Found by the role crawl once QA-004 was fixed; the platform portal now goes only to platform-organisation users | `d72c7da` |
| QA-009 The app could be framed by another site. X-Frame-Options and frame-ancestors on the app pages at the edge | `9025b13` |
| QA-007 The customer sign-in form was off-screen on a phone. One column, form first, below 900px | `c86c84e` |
| QA-015 The usage screens invented quotas, rules and imports. The reads only read; `scripts/ops/invented-usage-*.sql` clears rows already invented | `1d866c4` |
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
