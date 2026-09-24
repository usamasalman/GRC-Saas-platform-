# Production check and load test

Two scripts that run outside CI. Both are single files with no dependencies beyond Node 18+.

## Production synthetic check

`grc_wisdom_api/scripts/monitor/synthetic-check.js` asks the live site the questions a user would find out the hard way:

| Check | Fails when |
|---|---|
| API answers `/health` | the API process is down |
| API reaches its database | `/api/auth/bootstrap-status` answers 503, or reports an **empty user table** (the first-admin form would be open to anyone) |
| App page and its script load | the page is not the app, or `index.html` points at a script that is not there (a white page with a 200) |
| Sign-in address serves the app | `/login` is a 404 |
| HTTPS | the site is plain HTTP on a public name (see OI-01), or the certificate expires within 3 days |
| Headers | `nosniff` is missing. Warns on missing Referrer-Policy, HSTS or frame protection, and on a visible Server banner |
| Sign-in (optional) | a real sign-in and a signed-in read do not work |

It reads, never writes. The only POST is the optional sign-in.

```bash
SITE=https://app.example.com node grc_wisdom_api/scripts/monitor/synthetic-check.js
```

With a sign-in, use an account made for the purpose: the least privileged role, no MFA, never a real person's.

```bash
SITE=https://app.example.com MONITOR_EMAIL=monitor@example.com MONITOR_PASSWORD='…' node grc_wisdom_api/scripts/monitor/synthetic-check.js
```

Exit codes: `0` healthy (warnings printed), `1` broken, `2` misconfigured. `MONITOR_STRICT=1` makes warnings fail; `MONITOR_JSON=1` prints one JSON line for log collectors. A wrong monitor password counts against the sign-in limit of 10 failures per 15 minutes, and the check says so when that is why it failed.

### Scheduling it

Run it from a machine that is **not** the server: a server cannot report that it has dropped off the internet. Any Linux box with Node, every 5 minutes, alerting by e-mail on failure:

```cron
MAILTO=ops@example.com
*/5 * * * * cd /opt/grc-monitor && SITE=https://app.example.com node synthetic-check.js > /tmp/grc-synthetic.log 2>&1 || cat /tmp/grc-synthetic.log
```

cron mails whatever a job prints, so this prints only on failure. Keep the monitor password out of the crontab: put `MONITOR_EMAIL`/`MONITOR_PASSWORD` in a file readable only by the cron user, and `set -a; . /opt/grc-monitor/env; set +a;` before the command.

Without Node on that machine:

```cron
*/5 * * * * docker run --rm -e SITE=https://app.example.com -v /opt/grc-monitor:/m:ro node:22-alpine node /m/synthetic-check.js > /tmp/grc-synthetic.log 2>&1 || cat /tmp/grc-synthetic.log
```

## Load test

`grc_wisdom_api/scripts/load/load-test.js` signs in seven seeded people from three portals. Each simulated person then opens screens from their own menu, firing the requests each screen makes on open, together, as the browser does, and pauses between screens like a person reading. Screens a role cannot open are left out during warm-up, so it measures work rather than refusals.

**Only against a throwaway server with the demo seed.** It refuses any address that is not local or private. Each simulated person sends its own `X-Forwarded-For`, so the per-address rate limit applies per person as it does in production. Caddy overwrites that header, so this cannot be used through the live site.

```bash
API=http://127.0.0.1:3100 node grc_wisdom_api/scripts/load/load-test.js
API=http://127.0.0.1:3100 USERS=150 DURATION=60 THINK_MS=500 LOGIN_BURST=30 OUT=load.json node grc_wisdom_api/scripts/load/load-test.js
```

Thresholds (exit 1 when crossed): `P95_MS=1000`, `P99_MS=2500`, `MAX_ERROR_RATE=0.01` (server errors and dropped connections), `LOGIN_P95_MS=3000`. Any 429 also fails, because each simulated person stays under the limit. `OUT` writes the full result to compare between releases.

### Baseline (2026-09-24, one API process, laptop, PostgreSQL 18 local)

| Scenario | Throughput | p50 | p95 | p99 | Errors | Result |
|---|---|---|---|---|---|---|
| 10 sign in at once | — | 173 ms | 242 ms | — | 0 | pass |
| 25 people, 1 s between screens, 60 s | 52 req/s | 30 ms | 67 ms | 87 ms | 0 | pass |
| 30 sign in at once | — | 387 ms | 684 ms | — | 0 | pass |
| 150 people, 0.5 s between screens, 60 s | 181 req/s | 1,154 ms | 1,772 ms | 2,056 ms | 0 | fail (p95) |

No errors at any load, so it degrades by queueing, not by failing. One process tops out near 180 requests/s. The slowest calls under load are the three usage reads (about 5 s), which is QA-015. Fix that, then run more than one API process before expecting more than about 100 people active at once (OI-05).
