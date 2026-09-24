/**
 * Journey: a customer is invoiced for a period and the payment is recorded.
 *
 *   Billing admin previews the next invoice for a subscription
 *   → issues it (15% VAT, lines derived from the plan)
 *   → the same period cannot be invoiced twice
 *   → the invoice carries a ZATCA hash and QR
 *   → the billing admin records the payment
 *   → a paid invoice cannot be paid again.
 *
 * And who may not: a compliance manager cannot issue invoices, and a customer's
 * finance manager cannot mark somebody else's invoice paid.
 *
 * Requirements: REQ-07 (ZATCA Phase 2 e-invoicing), REQ-01 (tenant isolation),
 * REQ-03 (capability-based authorisation). See docs/qa/traceability.md.
 *
 *   API=http://127.0.0.1:3000 node scripts/verify/journey-billing-test.js
 */
const q = require('./qa/lib');

/** ZATCA's QR is base64 of TLV records: tag 1 seller, 2 VAT no, 3 time, 4 total, 5 VAT. */
function isZatcaTlv(b64) {
  let buf;
  try { buf = Buffer.from(String(b64 || ''), 'base64'); } catch { return false; }
  const tags = [];
  for (let i = 0; i + 2 <= buf.length;) {
    const tag = buf[i];
    const len = buf[i + 1];
    if (i + 2 + len > buf.length) return false;
    tags.push(tag);
    i += 2 + len;
  }
  return [1, 2, 3, 4, 5].every((t, n) => tags[n] === t);
}

(async () => {
  const v = q.verdicts('journey-billing');
  const step = async (name, ok, detail) => { v.record(`journey:billing:${name}`, ok, detail); await q.pace(); };

  const billing = await q.login('billing@grcwisdom.com');       // Platform Billing Admin
  const compliance = await q.login('eleanor.vance@globalbank.com'); // no invoicing capability
  const customerFinance = await q.login('finance.manager@omniops.me');

  const subs = await q.call('GET', '/api/billing/subscriptions', { token: billing.token });
  const sub = (subs.json?.subscriptions || []).find((s) => s.status === 'ACTIVE' || s.status === 'Active')
    || (subs.json?.subscriptions || [])[0];
  await step('the billing admin can see subscriptions', subs.status === 200 && Boolean(sub), `HTTP ${subs.status}`);
  if (!sub) return v.finish();

  // A month nobody has invoiced yet, found by asking rather than guessed: the
  // first version picked a fixed month and a second run on the same database
  // was refused with 409, which is the API being right and the test being wrong.
  let period = null;
  for (let m = 36; m < 36 + 120 && !period; m += 1) {
    const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + m, 1));
    const candidate = { subscriptionId: sub.id, periodKind: 'Month', anchor: d.toISOString().slice(0, 10) };
    const p = await q.call('POST', '/api/billing/invoices/preview', { token: billing.token, body: candidate });
    await q.pace();
    if (p.status === 200) period = candidate;
    else if (p.status !== 409) break;
  }
  if (!period) { await step('finds a month not yet invoiced', false, 'no free month in ten years'); return v.finish(); }

  const preview = await q.call('POST', '/api/billing/invoices/preview', { token: billing.token, body: period });
  await step('previews the next invoice', preview.status === 200, `HTTP ${preview.status} ${preview.json?.message || ''}`);

  const denied = await q.call('POST', '/api/billing/invoices', { token: compliance.token, body: period });
  await step('a compliance manager cannot issue invoices', denied.status === 403, `HTTP ${denied.status}`);

  const issued = await q.call('POST', '/api/billing/invoices', { token: billing.token, body: period });
  const inv = issued.json?.invoice;
  await step('issues it', issued.status === 201 && Boolean(inv?.id), `HTTP ${issued.status} ${issued.json?.message || ''}`);
  if (!inv?.id) return v.finish();

  const vatRate = Number(inv.vatRate);
  await step('at 15% VAT', Math.abs(vatRate - 0.15) < 1e-9 || Math.abs(vatRate - 15) < 1e-9, `vatRate=${inv.vatRate}`);

  const again = await q.call('POST', '/api/billing/invoices', { token: billing.token, body: period });
  await step('the same period cannot be invoiced twice', again.status >= 400 && again.status < 500,
    `HTTP ${again.status} ${again.json?.code || ''}`);

  // ZATCA Phase 2: the hash is SHA-256 of the signed XML, the QR is TLV.
  await step('the invoice hash is a real SHA-256',
    /^[A-Za-z0-9+/]{43}=$/.test(String(inv.zatcaHash)) || /^[a-f0-9]{64}$/i.test(String(inv.zatcaHash)),
    `zatcaHash is "${String(inv.zatcaHash).slice(0, 40)}"`);
  await step('the QR is ZATCA TLV', isZatcaTlv(inv.zatcaQr),
    `zatcaQr begins "${String(inv.zatcaQr).slice(0, 40)}"`);

  const stolen = await q.call('POST', `/api/billing/invoices/${inv.id}/pay`, { token: customerFinance.token });
  await step('a customer cannot mark another organisation\'s invoice paid',
    [403, 404].includes(stolen.status) || inv.tenantId === customerFinance.user.tenantId,
    `HTTP ${stolen.status} as ${customerFinance.user.role} @ ${customerFinance.user.tenantName}`);

  const paid = await q.call('POST', `/api/billing/invoices/${inv.id}/pay`, { token: billing.token });
  await step('the billing admin records the payment', paid.status === 200 && paid.json?.invoice?.status === 'PAID',
    `HTTP ${paid.status} ${paid.json?.invoice?.status || ''}`);

  const twice = await q.call('POST', `/api/billing/invoices/${inv.id}/pay`, { token: billing.token });
  await step('a paid invoice cannot be paid again', twice.status === 409, `HTTP ${twice.status} ${twice.json?.message || ''}`);

  const theirs = await q.call('GET', '/api/billing/invoices', { token: customerFinance.token });
  const foreign = (theirs.json?.invoices || []).filter((i) => (i.tenantId || i.tenant?.id) !== customerFinance.user.tenantId);
  await step('a customer sees only their own invoices', theirs.status === 200 && foreign.length === 0,
    `${foreign.length} invoice(s) from other organisations visible`);

  v.finish();
})().catch((e) => { console.error(e); process.exit(1); });
