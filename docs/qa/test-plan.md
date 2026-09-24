# Test plan

What is tested, how, when, and what "done" means. The companion documents:

- [defect-register.md](defect-register.md) — every open defect, with reproduction and owner
- [traceability.md](traceability.md) — each requirement and the tests that prove it
- [uat-scripts.md](uat-scripts.md) — scripts for people to run before a release
- [monitoring-and-load.md](monitoring-and-load.md) — the load test and the production check

## Scope

In scope: the web application (`src/`), the API (`grc_wisdom_api/`), the deploy configuration (`deploy/`, `Dockerfile*`, `.github/workflows/deploy.yml`) and the running site.

Out of scope for automated testing: third-party services the platform calls (payment gateways, e-mail delivery, ZATCA's own servers), and the look of screens beyond "it renders and fits". Visual design is reviewed by people.

## The risks, in order

Tests are weighted by what failure would cost, not by how easy they are to write.

| Risk | Why it ranks here | Where it is tested |
|---|---|---|
| One organisation sees or changes another's data | A single leak ends a GRC vendor | `qa-isolation-test`, `platform-scope-test`, `document-access-test`, journeys |
| Someone does what their role does not allow | The product sells control | `qa-write-guards-test`, `capabilities-mean-something-test`, `qa-role-crawl-test`, `qa-menu-test` |
| The audit trail can be altered or read by the wrong person | It is the evidence customers show auditors | `audit-chain-test`, `audit-trail-access-test`, `audit-tabs-test` |
| A deploy destroys data | It has happened once | `deploy-safety-test` |
| The product states something that is not true | Customers repeat it to regulators | `qa-claims-test`, `no-invented-data-test`, `report-honesty-test`, `qa-write-guards-test` (reads that write) |
| A screen breaks for a role, a browser or a phone | The most visible failure | Playwright suite in `e2e/` |
| It slows down or falls over under use | Found in production otherwise | `scripts/load/load-test.js` |
| The live site is down or misconfigured | Nobody is watching it | `scripts/monitor/synthetic-check.js` |

## The layers

Each layer catches what the one before it cannot. They run in this order because each is slower than the last.

| Layer | What it proves | How many | Where it runs |
|---|---|---|---|
| Source invariants | Rules that can be read from the code: every write route is guarded, every read route only reads, every menu entry maps to a screen and a capability, headers are configured, claims have code behind them, capacity limits | 48 suites | CI, every push, seconds |
| Pure logic | Schedule arithmetic, report rendering read back | 3 suites | CI, every push |
| HTTP suites | The API against a real PostgreSQL: isolation, lifecycles, imports, reports, the role crawl, fuzzed input, the audit chain under simultaneous requests | 18 suites, reseeded between each | CI, every push |
| Journeys | A business process end to end as the people who do it — document approval, support impersonation, billing, ISO 27001 controls | 4 of the HTTP suites | CI, every push |
| Browser | Every menu entry clicked, as four people, in Chromium, Firefox and WebKit, at desktop and phone size; the two-tab session rule in real browsers | 3 spec files × 5 browser profiles | CI, every push |
| Load | Latency and errors with many people signed in at once | 1 script | On demand, before a release |
| Synthetic | The live site answers, reaches its database, serves the app, uses HTTPS and signs in | 1 script | Every 5 minutes, from another machine |
| UAT | A person does the job the product exists for | 10 scripts | Before a release |

## Environments

Every automated test runs against a **throwaway** database: CI's service container, or a local one created for the run. They reseed and delete data freely, so they must never be pointed at a database anyone cares about. The seed refuses to run when `NODE_ENV=production` for the same reason.

The load test refuses non-private addresses. The synthetic check only reads, and signs in only with a dedicated monitor account.

## Defects

A defect found by any suite is pinned to the check that reproduces it in `grc_wisdom_api/src/qa/known-defects.json`, with the requirements it contradicts, and described in [defect-register.md](defect-register.md). The product reads the same file, so the BRD Traceability screen cannot call a requirement Verified while a defect against it is open. The suites read the register:

- a failing check listed there is **known**: the build stays green, the defect is owned and prioritised;
- a failing check not listed is **new**: the build fails;
- a listed check that passes is **probably fixed**: the build fails until the entry is removed and the register marks it Fixed.

So a defect cannot be forgotten, and a fix cannot go unrecorded.

Severity:

- **High**: data exposure across organisations or roles, a false compliance claim, loss of data, or a core screen unusable for a whole role.
- **Medium**: a control weaker than stated, a screen that breaks for some people, a misleading figure.
- **Low**: cosmetic, or a rough edge with an easy workaround.

## Entry and exit criteria

A change may be merged when:

1. `npx tsc -b` (web and browser tests) and `npx tsc` (API) pass with `strict` on.
2. Every CI suite passes: no NEW defects, no FIXED? entries left.
3. A change to a screen has been clicked through in the browser suite, or has a reason why not.

A release may go out when, in addition:

1. No open **High** defect affects the feature being released (see the register).
2. The load test passes at the expected number of concurrent people.
3. The UAT scripts touching the release have been run and signed off.
4. The synthetic check passes against the live site after the deploy.

## Measures

Reported in each release note, taken from the suite output:

- checks run, passed, known, new; open defects by severity, and opened and closed since the last release
- requirements with a test, out of the requirements claimed
- load: p50/p95/p99 and throughput at the agreed concurrency
- production: synthetic check failures in the last 30 days

## Retrospective

After each release, one page: what escaped to production and which layer should have caught it, which suite was flaky and why, and which register entries are older than 30 days and why. An escaped defect gets a check before it gets a fix.
