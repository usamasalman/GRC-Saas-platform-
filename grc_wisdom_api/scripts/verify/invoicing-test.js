/**
 * Invoicing a client for a period.
 *
 * An invoice was a single number typed by hand: no period, no plan reference,
 * no line items. createInvoice took the number, multiplied by 1.15 and saved
 * the total -- the net and the VAT were not kept, so even the tax could only
 * be recovered by division.
 *
 * This tests the rules in services/invoicing.ts:
 *   - Periods are calendar-aligned half-open ranges [start, end).
 *   - Billable months count when the subscription was active for any of the month.
 *   - Lines are derived from the plan on the subscription.
 *   - Money is integer minor units (halalas) to prevent float drift.
 *   - Billing the same period twice for the same subscription is refused.
 *   - The subscription ledger accurately computes paid against outstanding.
 *
 * node scripts/verify/invoicing-test.js
 */
const assert = require('assert');
const {
  periodFor,
  billableMonths,
  toMinor,
  toMajor,
  invoiceTotals,
  planInvoice,
  subscriptionLedger,
} = require('../../dist/services/invoicing');

let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

console.log('Running invoicing verification suite...');

// 1. Periods: Half-open calendar alignment
{
  const q1 = periodFor('Quarter', new Date('2026-02-15T00:00:00Z'));
  ok(q1.label === 'Q1 2026', `expected Q1 2026, got ${q1.label}`);
  ok(q1.start.toISOString() === '2026-01-01T00:00:00.000Z', 'Q1 start mismatch');
  ok(q1.end.toISOString() === '2026-04-01T00:00:00.000Z', 'Q1 end mismatch');

  const q2 = periodFor('Quarter', '2026-04-01T00:00:00Z');
  ok(q2.label === 'Q2 2026', `expected Q2 2026, got ${q2.label}`);
  ok(q2.start.toISOString() === '2026-04-01T00:00:00.000Z', 'Q2 start mismatch');
  ok(q2.end.toISOString() === '2026-07-01T00:00:00.000Z', 'Q2 end mismatch');

  const month = periodFor('Month', '2026-05-18');
  ok(month.label === '2026-05', `expected 2026-05, got ${month.label}`);
  ok(month.start.toISOString() === '2026-05-01T00:00:00.000Z', 'month start mismatch');
  ok(month.end.toISOString() === '2026-06-01T00:00:00.000Z', 'month end mismatch');
}

// 2. Billable months inside a period
{
  const period = periodFor('Quarter', '2026-02-01');
  // Subscription started mid-quarter (February 10)
  const bm = billableMonths(period, {
    startDate: '2026-02-10T00:00:00Z',
    endDate: null,
  });
  ok(bm.months.length === 2, `expected 2 months (Feb, Mar), got ${bm.months.length}`);
  ok(bm.months[0] === '2026-02' && bm.months[1] === '2026-03', 'month names mismatch');

  // Subscription cancelled during first month of quarter
  const bmCancelled = billableMonths(period, {
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2026-01-15T00:00:00Z',
  });
  ok(bmCancelled.months.length === 1 && bmCancelled.months[0] === '2026-01', 'expected only Jan billable');
}

// 3. Money & Rounding: No float drift
{
  ok(toMinor(1333.33) === 133333, 'toMinor float conversion');
  ok(toMajor(133333) === 1333.33, 'toMajor conversion');

  const lines = [
    { description: 'Professional Plan', quantity: 3, unitPriceMinor: 500000, amountMinor: 1500000 },
  ];
  const totals = invoiceTotals(lines, 0.15);
  ok(totals.netMinor === 1500000, 'net minor mismatch');
  ok(totals.vatMinor === 225000, 'vat minor mismatch (15% of 15000 is 2250)');
  ok(totals.totalMinor === 1725000, 'total minor mismatch');
}

// 4. Deriving invoice from plan (planInvoice)
{
  const sub = {
    id: 'sub-001',
    status: 'ACTIVE',
    startDate: '2026-01-01T00:00:00Z',
    endDate: null,
    plan: { name: 'Professional', priceMonthly: 5000 },
  };

  const decision = planInvoice({
    subscription: sub,
    kind: 'Quarter',
    anchor: '2026-01-15',
    alreadyInvoiced: [],
  });

  ok(decision.ok === true, 'expected planInvoice to succeed');
  ok(decision.period.label === 'Q1 2026', 'expected Q1 2026');
  ok(decision.lines.length === 1, 'expected 1 line item');
  ok(decision.lines[0].quantity === 3, 'expected 3 months quantity');
  ok(decision.lines[0].unitPriceMinor === 500000, 'expected 5000.00 unit price');
  ok(decision.lines[0].amountMinor === 1500000, 'expected 15000.00 line amount');
  ok(decision.totals.vatMinor === 225000, 'expected 2250.00 VAT');
  ok(decision.totals.totalMinor === 1725000, 'expected 17250.00 Total');
}

// 5. Refusal rules:
// Refuse billing same period twice
{
  const sub = {
    id: 'sub-001',
    status: 'ACTIVE',
    startDate: '2026-01-01T00:00:00Z',
    endDate: null,
    plan: { name: 'Professional', priceMonthly: 5000 },
  };

  const periodQ1 = periodFor('Quarter', '2026-01-01');
  const refusal = planInvoice({
    subscription: sub,
    kind: 'Quarter',
    anchor: '2026-01-15',
    alreadyInvoiced: [periodQ1.start.toISOString()],
  });

  ok(refusal.ok === false, 'expected duplicate period refusal');
  ok(refusal.code === 'PERIOD_ALREADY_INVOICED', `expected PERIOD_ALREADY_INVOICED, got ${refusal.code}`);
}

// Refuse subscription with no plan
{
  const refusal = planInvoice({
    subscription: {
      id: 'sub-002',
      status: 'ACTIVE',
      startDate: '2026-01-01T00:00:00Z',
      endDate: null,
      plan: null,
    },
    kind: 'Quarter',
    anchor: '2026-01-15',
    alreadyInvoiced: [],
  });

  ok(refusal.ok === false, 'expected no plan refusal');
  ok(refusal.code === 'SUBSCRIPTION_HAS_NO_PLAN', `expected SUBSCRIPTION_HAS_NO_PLAN, got ${refusal.code}`);
}

// Refuse when subscription was not live during period
{
  const refusal = planInvoice({
    subscription: {
      id: 'sub-003',
      status: 'ACTIVE',
      startDate: '2026-07-01T00:00:00Z',
      endDate: null,
      plan: { name: 'Essentials', priceMonthly: 2500 },
    },
    kind: 'Quarter',
    anchor: '2026-01-15', // Q1, subscription starts in Q3
    alreadyInvoiced: [],
  });

  ok(refusal.ok === false, 'expected not subscribed refusal');
  ok(refusal.code === 'NOT_SUBSCRIBED_IN_PERIOD', `expected NOT_SUBSCRIBED_IN_PERIOD, got ${refusal.code}`);
}

// 6. Subscription Ledger: Paid vs. Outstanding
{
  const invoices = [
    { amount: 17250, status: 'PAID' },
    { amount: 17250, status: 'UNPAID' },
  ];
  const ledger = subscriptionLedger(invoices);
  ok(ledger.invoiced === 34500, `expected invoiced 34500, got ${ledger.invoiced}`);
  ok(ledger.paid === 17250, `expected paid 17250, got ${ledger.paid}`);
  ok(ledger.outstanding === 17250, `expected outstanding 17250, got ${ledger.outstanding}`);
  ok(ledger.invoiceCount === 2, 'expected 2 invoices');
  ok(ledger.unpaidCount === 1, 'expected 1 unpaid');
  ok(ledger.neverInvoiced === false, 'expected neverInvoiced false');

  const emptyLedger = subscriptionLedger([]);
  ok(emptyLedger.neverInvoiced === true, 'expected neverInvoiced true');
  ok(emptyLedger.outstanding === 0, 'expected outstanding 0');
}

console.log(`invoicing: ${checks} assertions passed`);
