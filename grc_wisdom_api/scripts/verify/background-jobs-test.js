/**
 * The System Health screen reports the workers that exist, from what they did.
 *
 * It listed five. Two exist. The other three — a WORM chain audit, a daily
 * NCA/ISO standards sync, a ZATCA e-invoice signer — were object literals
 * whose `lastRun` was `new Date(Date.now() - 1800000)`, so the figure moved
 * every time the page was refreshed and looked live. An operator asking "is
 * the chain audit running?" was told it ran half an hour ago and took 420ms.
 * Nothing ran. JOB-SYS-04, the retention worker, had already been removed for
 * the same reason. The two workers server.ts genuinely starts, the SLA
 * escalation scanner and the risk review scanner, were not on the list.
 *
 * The "Run now" button was worse. It accepted any string as a job id, ran
 * nothing, wrote SYSTEM_JOB_TRIGGERED into the WORM audit log, and answered
 *
 *   { status: 'Success', durationMs: Math.floor(Math.random() * 300) + 150 }
 *
 * A random number shown to an operator as a measurement, and a permanent
 * compliance record asserting that work succeeded when it never began.
 * "JOB-SYS-99" executed successfully too.
 *
 * The nine services had the same problem more quietly: `latencyMs` and
 * `uptimePercent` were literals in an array, so "99.99% availability" was a
 * claim about the past year from a process that cannot see past its own boot,
 * served unchanged while the database was unreachable.
 *
 *   node scripts/verify/background-jobs-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(API, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const reportingSrc = read(API, 'services', 'jobReporting.ts');
const reporting = code(reportingSrc);
const controller = code(read(API, 'controllers', 'systemController.ts'));
const sla = code(read(API, 'services', 'slaService.ts'));
const risk = code(read(API, 'services', 'riskLifecycle.ts'));
const server = code(read(API, 'server.ts'));
const screen = code(read(WEB, 'pages', 'system', 'SystemHealthStatus.tsx'));
const deploy = read(WEB, '..', '.github', 'workflows', 'deploy.yml');

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };
const eq = (a, b, what) => { checks += 1; assert.strictEqual(a, b, what); };

const {
  JOB_DEFINITIONS, KNOWN_JOB_IDS, describeJob, describeInterval,
  planTrigger, observe, recordRun, lastRun, resetRuns,
} = require('../../dist/services/jobReporting');

// ─── The register matches the timers that actually start ────────────────────
{
  ok(
    !/from ['"]@prisma\/client['"]|from ['"]\.\.\/db['"]/.test(reportingSrc),
    'the register and its reporting run without a database',
  );

  const started = (server.match(/start\w*Scanner\(\)/g) || []);
  eq(
    JOB_DEFINITIONS.length, started.length,
    'THE PACKET: the register is exactly as long as the list of scanners '
    + `server.ts starts (${started.length}). A row nobody drives is the defect `
    + 'this file exists to have removed',
  );

  ok(
    KNOWN_JOB_IDS.includes('JOB-SLA-ESCALATION') && KNOWN_JOB_IDS.includes('JOB-RISK-REVIEW'),
    'and it names the two that do run',
  );
  ok(
    !/JOB-SYS-0/.test(reporting) && !/JOB-SYS-0/.test(controller),
    'the five JOB-SYS rows are gone from both the register and the endpoint',
  );

  // Scoped to the health handler on purpose. The same file still serves the
  // platform-security grades and the OCI architecture list, which carry
  // hardcoded 'A+' and 'Healthy' values of their own. Those are a separate
  // surface and a separate packet; asserting over the whole file here would
  // either fail on them or quietly pretend they had been dealt with.
  const healthHandler = controller.slice(
    controller.indexOf('export const getSystemHealth'),
    controller.indexOf('export const triggerSystemJob'),
  );
  ok(
    !/ZATCA|Standards Sync|Cryptographic Chain Audit/i.test(healthHandler),
    'including the ZATCA signer, the standards sync and the chain audit, none '
    + 'of which were ever built',
  );

  for (const d of JOB_DEFINITIONS) {
    ok(d.description.length > 30, `${d.id} says what it does in an operator's words`);
    ok(d.measures.length > 0, `${d.id} names the units it reports, so a run of zero still reads as a run`);
    ok(d.intervalMs > 0, `${d.id} has a real interval`);
  }
}

// ─── A worker that has not run says so ──────────────────────────────────────
{
  const def = JOB_DEFINITIONS[0];
  const never = describeJob(def, null);
  eq(never.status, 'NeverRun', 'a worker with no recorded run reports NeverRun');
  eq(never.lastRun, null, 'THE PACKET: and a null last run, never a plausible timestamp');
  eq(never.nextRun, null, 'and no next run, because there is nothing to count forward from');
  eq(never.durationMs, null, 'and no duration');
  eq(never.counts, null, 'and no counts');

  // A constant offset, not a subtraction. `Date.now() - dbStart` two lines up
  // is the one real measurement in the handler; banning the operator would
  // have taken that with it.
  ok(
    !/Date\.now\(\) [-+] \d/.test(controller) && !/Date\.now\(\) [-+] \d/.test(reporting),
    'THE PACKET: no row is built by offsetting the clock by a constant. '
    + '`Date.now() - 1800000` moves on every refresh, which is exactly what '
    + 'made the invented rows look like live ones',
  );
  ok(
    !/Math\.random/.test(controller) && !/Math\.random/.test(reporting),
    'THE PACKET: and no figure on this screen comes from Math.random()',
  );
}

// ─── A run that happened is reported from what happened ─────────────────────
{
  const def = JOB_DEFINITIONS[0];
  const ran = describeJob(def, {
    startedAt: '2026-09-23T10:00:00.000Z',
    finishedAt: '2026-09-23T10:00:00.250Z',
    durationMs: 250,
    outcome: 'Success',
    counts: { breached: 4, escalated: 4 },
  });
  eq(ran.status, 'Idle', 'a successful run reports Idle');
  eq(ran.durationMs, 250, 'the duration is the measured one');
  eq(ran.counts.breached, 4, 'and the counts are what the scan returned');
  eq(
    ran.nextRun, new Date(Date.parse('2026-09-23T10:00:00.250Z') + def.intervalMs).toISOString(),
    'the next run follows the interval from the last finish',
  );

  const failed = describeJob(def, {
    startedAt: '2026-09-23T10:00:00.000Z',
    finishedAt: '2026-09-23T10:00:00.010Z',
    durationMs: 10,
    outcome: 'Failed',
    error: 'connection reset',
  });
  eq(failed.status, 'Failed', 'THE PACKET: a scan that threw reports Failed');
  eq(failed.error, 'connection reset', 'and carries the reason. A failed scan reporting Idle is how a screen comes to be trusted for something it never checked');

  ok(/Every 5 minutes/.test(describeInterval(5 * 60_000)), 'the schedule reads in minutes');
  ok(/Every 2 hours/.test(describeInterval(120 * 60_000)), 'and in hours when that is clearer');
}

async function main() {
  // ─── observe() measures rather than invents ──────────────────────────────
  {
    resetRuns();
    const id = 'JOB-SLA-ESCALATION';

    const r = await observe(id, async () => ({ breached: 2, escalated: 2 }));
    eq(r.outcome, 'Success', 'a scan that returns is a success');
    eq(r.counts.breached, 2, 'and its counts are kept');
    ok(typeof r.durationMs === 'number' && r.durationMs >= 0, 'the duration is measured, not chosen');
    ok(lastRun(id) !== null, 'and the run is recorded');

    const bad = await observe(id, async () => { throw new Error('db gone'); });
    eq(bad.outcome, 'Failed', 'THE PACKET: a scan that throws is recorded as Failed');
    ok(/db gone/.test(bad.error), 'with the reason');
    eq(
      lastRun(id).outcome, 'Failed',
      'and it overwrites the previous success rather than being swallowed',
    );
    ok(
      /recordRun\(jobId, run\);/.test(reporting.slice(reporting.indexOf('catch (err'))),
      'the failure path records too. Recording only successes is the same lie '
      + 'told more slowly',
    );
    resetRuns();
  }

  // ─── The trigger refuses what it cannot run ───────────────────────────────
  {
    const none = planTrigger('');
    eq(none.ok, false, 'a trigger with no job id is refused');
    eq(none.code, 'JOB_REQUIRED', 'and says so');

    const unknown = planTrigger('JOB-SYS-99');
    eq(unknown.ok, false, 'THE PACKET: an unknown job id is refused rather than reported successful');
    eq(unknown.status, 404, 'as a not-found');
    ok(/JOB-SLA-ESCALATION/.test(unknown.message), 'and the refusal names what this API does run');

    const good = planTrigger('JOB-RISK-REVIEW');
    eq(good.ok, true, 'a real one is allowed');
  }

  // ─── The controller runs the scan and audits what it did ──────────────────
  {
    const trigger = controller.slice(controller.indexOf('export const triggerSystemJob'));

    ok(
      /const plan = planTrigger\(req\.body\?\.jobId\)/.test(trigger),
      'the endpoint asks the register whether the job exists',
    );
    ok(
      /observe\(plan\.id, RUNNABLE\[plan\.id\], \{ manual: true \}\)/.test(trigger),
      'THE PACKET: and then actually runs it, measured',
    );
    ok(
      /outcome: run\.outcome/.test(trigger) && /durationMs: run\.durationMs/.test(trigger)
      && /counts: run\.counts \?\? null/.test(trigger) && /error: run\.error \?\? null/.test(trigger),
      'the audit entry records the real outcome, the real duration and what the '
      + 'scan changed. An entry saying a scan ran is worth little; one saying it '
      + 'breached four tickets is the record',
    );
    ok(
      /run\.outcome === 'Failed'/.test(trigger) && /code: 'JOB_FAILED'/.test(trigger),
      'a failed run answers as a failure. The old shape had no way to express one',
    );
    ok(
      !/executed successfully/.test(trigger),
      'and nothing is described as executed successfully on the way past',
    );

    const health = controller.slice(
      controller.indexOf('export const getSystemHealth'),
      controller.indexOf('export const triggerSystemJob'),
    );
    ok(
      /const jobs = reportAllJobs\(\);/.test(health),
      'the job list comes from the register',
    );
    ok(
      /jobsNote:/.test(health),
      'and the response says plainly that the history is per-process, so a '
      + 'restart is not read as a missed run',
    );
    ok(
      !/uptimePercent/.test(health) && !/latencyMs: \d/.test(health),
      'THE PACKET: no service carries an invented latency or an availability '
      + 'figure. Nothing in this process measures uptime',
    );
    ok(
      /status: 'Mounted' as const/.test(health),
      'what it reports instead is the one thing it knows: the router is in this build',
    );
  }

  // ─── Both scanners record every tick ──────────────────────────────────────
  {
    ok(
      /observe\(SLA_ESCALATION_JOB, runEscalationScan\)/.test(sla),
      'the SLA scanner records its runs',
    );
    ok(
      /timer = setInterval\(tick, intervalMs\)/.test(sla),
      'on every tick, not only the first',
    );
    ok(
      /observe\(RISK_REVIEW_JOB, runRiskReviewScan\)/.test(risk),
      'and so does the risk review scanner',
    );
    ok(
      /timer = setInterval\(tick, intervalMs\)/.test(risk),
      'on every tick',
    );
  }

  // ─── The screen shows the absence rather than filling it ──────────────────
  {
    ok(
      /not since restart/.test(screen),
      'THE PACKET: a worker that has not run shows so in words, not as a date',
    );
    ok(
      /after its first run/.test(screen),
      'and an unknown next run says why it is unknown',
    );
    ok(
      !/uptimePercent|Availability SLA|Response Time/.test(screen),
      'the availability and response-time columns are gone with the numbers '
      + 'that filled them',
    );
    ok(
      /What it did/.test(screen),
      'the table shows what each run changed, which is the column an operator '
      + 'came for',
    );
    ok(
      /j\.error/.test(screen),
      'and a failed run shows its reason',
    );
    ok(
      !/triggered successfully/.test(screen),
      'running a job no longer reports "triggered successfully" — that was the '
      + 'wording used when nothing ran',
    );
    ok(
      /result\?\.counts/.test(screen) && /durationMs/.test(screen),
      'it reports what the run actually did and how long it took',
    );
  }

  // ─── CI ───────────────────────────────────────────────────────────────────
  ok(
    /background-jobs-test\.js/.test(deploy),
    'CI must run this. A rule that is not in the workflow is one the next '
    + 'packet can delete',
  );

  console.log(
    `background-jobs: ${checks} assertions passed `
    + `(${JOB_DEFINITIONS.length} workers registered, matching ${JOB_DEFINITIONS.length} started in server.ts)`,
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
