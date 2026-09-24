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
 * the chain of that person's organisation is verified.
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

  // Each of these writes a PLATFORM_CROSS_TENANT_READ entry to the
  // administrator's own organisation.
  const burst = await Promise.all(
    Array.from({ length: BURST }, () => q.call('GET', '/api/system/health', { token })),
  );
  v.record('audit-concurrency:the burst of audited requests is answered',
    burst.every((r) => r.status === 200),
    `statuses: ${[...new Set(burst.map((r) => r.status))].join(', ')}`);

  const verify = await q.call('GET', '/api/admin/db/verify-audit', { token });
  const mine = (verify.json?.results || []).find((r) => r.tenantId === user.tenantId);
  v.record('audit-concurrency:the chain stays verifiable when requests arrive together',
    verify.status === 200 && Boolean(mine) && mine.status !== 'TAMPERED',
    mine
      ? `after ${BURST} requests at once, ${mine.tenantName} reads ${mine.status}`
        + `${mine.firstTamperedLogId ? ` from entry ${mine.firstTamperedLogId}` : ''}, though nothing was changed`
      : `the verifier answered HTTP ${verify.status} without this organisation`);

  v.finish(`${BURST} audited requests at once`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
