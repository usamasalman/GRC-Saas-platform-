/**
 * The audit chain has to survive requests that arrive together.
 *
 * writeAudit reads an organisation's last entry and chains the new one to it,
 * with nothing stopping a second request doing the same in the same instant.
 * Two entries then share one predecessor: the chain forks, each entry
 * individually intact, and every verifier reports the organisation's trail as
 * TAMPERED although nobody changed a thing (QA-029).
 *
 * This is not a race that needs load to show. A platform administrator opening
 * one screen sends several requests at once, each audited, and after an
 * ordinary walk through the product one organisation's chain held three forks.
 *
 * Here: a burst of audited requests from one person at the same moment, then
 * the chain of that person's organisation is verified. writeAudit now numbers
 * each entry under a per-organisation lock, so the chain must come back in
 * one line: nothing tampered, nothing forked.
 *
 *   API=http://127.0.0.1:3000 ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/verify/audit-concurrency-test.js
 */
const q = require('./qa/lib');

const v = q.verdicts('audit-concurrency');
const BURST = 12;

(async () => {
  const { email, password } = q.adminCredentials();
  if (!email || !password) {
    console.log('audit-concurrency: skipped — no ADMIN_EMAIL/ADMIN_PASSWORD for the platform administrator');
    return;
  }
  const { token, user } = await q.login(email, password);
  const chainOf = async () => {
    const r = await q.call('GET', '/api/admin/db/verify-audit', { token });
    return { status: r.status, mine: (r.json?.results || []).find((x) => x.tenantId === user.tenantId) };
  };
  const before = await chainOf();

  // Each of these writes a PLATFORM_CROSS_TENANT_READ entry to the
  // administrator's own organisation.
  const burst = await Promise.all(
    Array.from({ length: BURST }, () => q.call('GET', '/api/system/health', { token })),
  );
  v.record('audit-concurrency:the burst of audited requests is answered',
    burst.every((r) => r.status === 200),
    `statuses: ${[...new Set(burst.map((r) => r.status))].join(', ')}`);

  const verify = await chainOf();
  const mine = verify.mine;
  // A chain can only look clean if the entries were written. An audit write
  // that times out is logged and swallowed on this path, so a writer that
  // fails under contention would pass every check below: count them.
  const written = mine && before.mine ? mine.logCount - before.mine.logCount : -1;
  v.record('audit-concurrency:every request in the burst is written to the trail',
    written >= BURST,
    `${written} of ${BURST} audited requests reached the trail`);
  v.record('audit-concurrency:the chain stays verifiable when requests arrive together',
    verify.status === 200 && Boolean(mine) && mine.status !== 'TAMPERED',
    mine
      ? `after ${BURST} requests at once, ${mine.tenantName} reads ${mine.status}`
        + `${mine.firstTamperedLogId ? ` from entry ${mine.firstTamperedLogId}` : ''}, though nothing was changed`
      : `the verifier answered HTTP ${verify.status} without this organisation`);
  // Stricter than "not tampered": entries written from now on must not fork
  // at all. The verifier forgives a fork only among entries older than
  // appends being serialised, so a fork here would be a writer that races
  // again, merely reported more politely.
  v.record('audit-concurrency:entries written together still form one line',
    Boolean(mine) && mine.forkedCount === 0 && mine.verifiedCount === mine.logCount,
    mine
      ? `${mine.forkedCount} forked, ${mine.verifiedCount} of ${mine.logCount} entries recomputed in line`
      : 'no result for this organisation');

  v.finish(`${BURST} audited requests at once`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
