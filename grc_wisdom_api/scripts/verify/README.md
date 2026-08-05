# Verification scripts

End-to-end checks that exercise the GRC workflows against a running API. They
assert on the *controls* — that the platform refuses what it should refuse —
not just that endpoints return 200.

## Running them

The API must be up on `http://localhost:3000` with a freshly seeded database:

```bash
npx tsx src/seed.ts
npm run dev
```

Then, from the repo root:

```bash
bash grc_wisdom_api/scripts/verify/issue-test.sh
```

All seeded users share the password `Demo@2026`.

> Several scripts create records (audits, campaigns, issues). Re-running them
> without reseeding accumulates data — reference numbers advance and totals
> grow. Reseed for a clean read.

## What each covers

| Script | Covers |
| --- | --- |
| `planning-test.sh` | Audit universe scoring, annual plan, high-risk coverage gate, capacity, preparer ≠ approver |
| `fieldwork-test.sh` | Risk & control matrix, sampling, conclusion consistency, immutable results, workpaper review sign-off |
| `issue-test.sh` | Management response gate, cross-source register, dispute and escalation, independent closure, reopen voiding the response |
| `erm-test.sh` | Risk appetite thresholds and approval, appetite gating risk acceptance, RCSA campaign lifecycle, KRI bands, loss events |
| `sod-close.sh` | Capability gate blocking closure by a non-audit role |
| `sod-overlap.sh` | The harder case — one user holding both capabilities still cannot validate their own remediation |
| `audit-test.sh` | Audit lifecycle and finding closure |
| `itsm-test.sh` | Ticket priority, SLA escalation, catalogue routing |
| `imp-test.sh` | Impersonation session issue and the read-only write block |

## Reading the output

Each step prints the server's own message. Lines beginning with an error code
are the point of the test — `SOD_VIOLATION`, `NO_MANAGEMENT_RESPONSE`,
`BEYOND_RISK_TOLERANCE` and friends mean the control fired correctly. A step
that was expected to be blocked but instead succeeded is the failure signal.
