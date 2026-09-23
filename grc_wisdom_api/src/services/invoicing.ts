/**
 * Billing a client for a period.
 *
 * An Invoice carried a single `amount` typed by hand and nothing else: no
 * period, no reference to the subscription it was for, and no line items. So a
 * finance manager could not bill a duration, could not see which package a
 * client was on, and could not answer "what is this figure made of" for any
 * invoice ever issued. createInvoice took the number, added 15% and stored the
 * total -- the net and the tax were not kept, so even the VAT could only be
 * recovered by dividing back out.
 *
 * `poNumber` was accepted in the request body, written into the audit payload,
 * and never stored on the invoice. A purchase-order number that exists only in
 * the audit log cannot be printed on the document the client pays against.
 *
 * ── Money is integers ───────────────────────────────────────────────────────
 *
 * Every amount here is in minor units -- halalas for SAR, cents for USD -- and
 * every rate is applied with a single rounding at the end. A quarter at
 * 1,333.33 a month is not three times a rounded month, and doing it in floats
 * gives 3999.9899999999998. The column is a Decimal; the arithmetic is not
 * allowed to be a float.
 *
 * ── Whole months, not prorated days ─────────────────────────────────────────
 *
 * A plan has priceMonthly and nothing finer, so a line is a whole month.
 * Billing a part-month by dividing by 30 would invent a daily rate the plan
 * does not have, and be wrong in February. A subscription that covers part of
 * a period is billed for the months it actually covered, and the invoice says
 * which ones.
 *
 * Pure, and with no Prisma import, so every refusal runs without a database.
 */

/** Saudi VAT. Was an un-named 0.15 inline in the controller. */
export const DEFAULT_VAT_RATE = 0.15;

export const PERIOD_KINDS = ['Month', 'Quarter', 'Year'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

const MONTHS_IN: Record<PeriodKind, number> = { Month: 1, Quarter: 3, Year: 12 };

// ─── Periods ────────────────────────────────────────────────────────────────

export interface Period {
  /** First instant of the period, UTC. */
  start: Date;
  /** First instant AFTER the period, UTC — a half-open range. */
  end: Date;
  label: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The period containing this date, aligned to the calendar.
 *
 * Half-open [start, end): a quarter ends at the first instant of the next one,
 * so two consecutive periods can never both contain the same moment and a
 * month boundary cannot be billed twice.
 */
export function periodFor(kind: PeriodKind, anchor: Date | string): Period {
  const d = anchor instanceof Date ? anchor : new Date(String(anchor));
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();

  if (kind === 'Year') {
    return {
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year + 1, 0, 1)),
      label: String(year),
    };
  }
  if (kind === 'Quarter') {
    const q = Math.floor(month / 3);
    return {
      start: new Date(Date.UTC(year, q * 3, 1)),
      end: new Date(Date.UTC(year, q * 3 + 3, 1)),
      label: `Q${q + 1} ${year}`,
    };
  }
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
    label: `${year}-${pad(month + 1)}`,
  };
}

/** Whole calendar months a subscription covers inside a period. */
export function billableMonths(
  period: { start: Date; end: Date },
  subscription: { startDate: Date | string; endDate: Date | string | null },
): { months: string[]; from: Date | null; to: Date | null } {
  const subStart = new Date(String(
    subscription.startDate instanceof Date ? subscription.startDate.toISOString() : subscription.startDate,
  ));
  const subEnd = subscription.endDate
    ? new Date(String(
      subscription.endDate instanceof Date ? subscription.endDate.toISOString() : subscription.endDate,
    ))
    : null;

  const months: string[] = [];
  let first: Date | null = null;
  let last: Date | null = null;

  const cursor = new Date(period.start.getTime());
  while (cursor < period.end) {
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));

    // A month counts when the subscription was live for any of it. The
    // alternative -- requiring the whole month -- drops the month a client
    // signed up in, which is the one they expect to be charged for.
    const liveByThen = subStart < monthEnd;
    const stillLive = !subEnd || subEnd > monthStart;
    if (liveByThen && stillLive) {
      months.push(`${monthStart.getUTCFullYear()}-${pad(monthStart.getUTCMonth() + 1)}`);
      if (!first) first = monthStart;
      last = monthEnd;
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return { months, from: first, to: last };
}

// ─── Money ──────────────────────────────────────────────────────────────────

/** Round half away from zero, which is what an invoice is expected to do. */
function roundMinor(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** A major-unit figure (12.34) as minor units (1234). */
export function toMinor(major: number | string): number {
  return roundMinor(Number(major) * 100);
}

/** Minor units back to a major-unit number, for display and storage. */
export function toMajor(minor: number): number {
  return Math.round(minor) / 100;
}

export interface InvoiceLine {
  description: string;
  /** Whole months. */
  quantity: number;
  /** Minor units. */
  unitPriceMinor: number;
  /** Minor units — quantity × unitPrice, rounded once. */
  amountMinor: number;
}

export interface InvoiceTotals {
  netMinor: number;
  vatMinor: number;
  totalMinor: number;
  vatRate: number;
}

/**
 * Totals from lines.
 *
 * VAT is computed on the summed net and rounded ONCE. Rounding each line's tax
 * and adding them up drifts by a halala per line, and an invoice whose total
 * does not equal its own lines is the one a finance manager will not sign.
 */
export function invoiceTotals(
  lines: readonly InvoiceLine[],
  vatRate: number = DEFAULT_VAT_RATE,
): InvoiceTotals {
  const netMinor = lines.reduce((n, l) => n + l.amountMinor, 0);
  const vatMinor = roundMinor(netMinor * vatRate);
  return { netMinor, vatMinor, totalMinor: netMinor + vatMinor, vatRate };
}

// ─── Deriving an invoice from a plan ────────────────────────────────────────

export interface InvoiceRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface InvoiceDecision {
  ok: true;
  period: Period;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  months: string[];
}

export function planInvoice(input: {
  subscription: {
    id: string;
    status: string;
    startDate: Date | string;
    endDate: Date | string | null;
    plan: { name: string; priceMonthly: number | string } | null;
  } | null;
  kind: unknown;
  anchor: Date | string;
  /** Periods already invoiced for this subscription, as ISO period starts. */
  alreadyInvoiced: readonly string[];
  vatRate?: number;
}): InvoiceRefusal | InvoiceDecision {
  if (!input.subscription) {
    return {
      ok: false,
      status: 404,
      code: 'NO_SUBSCRIPTION',
      message: 'That client has no subscription, so there is no plan to bill them for.',
    };
  }
  if (!input.subscription.plan) {
    return {
      ok: false,
      status: 409,
      code: 'SUBSCRIPTION_HAS_NO_PLAN',
      message: 'This subscription names no plan, so an invoice from it would have no lines.',
    };
  }

  const kind = String(input.kind ?? '').trim();
  if (!(PERIOD_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_PERIOD',
      message: `A billing period is one of: ${PERIOD_KINDS.join(', ')}.`,
    };
  }

  const period = periodFor(kind as PeriodKind, input.anchor);

  // Billing the same subscription for the same period twice is the mistake
  // that reaches a client's inbox, so it is refused by the rule as well as by
  // the unique index behind it.
  if (input.alreadyInvoiced.map(String).includes(period.start.toISOString())) {
    return {
      ok: false,
      status: 409,
      code: 'PERIOD_ALREADY_INVOICED',
      message: `${period.label} has already been invoiced for this subscription.`,
    };
  }

  const { months } = billableMonths(period, input.subscription);
  if (months.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'NOT_SUBSCRIBED_IN_PERIOD',
      message: `This subscription was not live during ${period.label}, so there is nothing to bill.`,
    };
  }

  const unitPriceMinor = toMinor(input.subscription.plan.priceMonthly);
  if (unitPriceMinor <= 0) {
    return {
      ok: false,
      status: 409,
      code: 'PLAN_HAS_NO_PRICE',
      message: `The ${input.subscription.plan.name} plan has no monthly price, so its lines would all be zero.`,
    };
  }

  const lines: InvoiceLine[] = [{
    description: `${input.subscription.plan.name} — ${months.length} month`
      + `${months.length === 1 ? '' : 's'} (${months[0]}`
      + `${months.length > 1 ? ` to ${months[months.length - 1]}` : ''})`,
    quantity: months.length,
    unitPriceMinor,
    amountMinor: unitPriceMinor * months.length,
  }];

  return {
    ok: true,
    period,
    lines,
    totals: invoiceTotals(lines, input.vatRate ?? DEFAULT_VAT_RATE),
    months,
  };
}

// ─── Paid against outstanding ───────────────────────────────────────────────

export interface Ledger {
  invoiced: number;
  paid: number;
  outstanding: number;
  invoiceCount: number;
  unpaidCount: number;
  /**
   * Said rather than derived from a zero. A subscription that has never been
   * invoiced and one whose invoices are all settled both show nothing
   * outstanding, and only the first is somebody forgetting to bill.
   */
  neverInvoiced: boolean;
}

export function subscriptionLedger(
  invoices: readonly { amount: number | string; status: string }[],
): Ledger {
  let invoicedMinor = 0;
  let paidMinor = 0;
  let unpaidCount = 0;

  for (const inv of invoices) {
    const minor = toMinor(inv.amount);
    invoicedMinor += minor;
    if (String(inv.status).toUpperCase() === 'PAID') paidMinor += minor;
    else unpaidCount += 1;
  }

  return {
    invoiced: toMajor(invoicedMinor),
    paid: toMajor(paidMinor),
    outstanding: toMajor(invoicedMinor - paidMinor),
    invoiceCount: invoices.length,
    unpaidCount,
    neverInvoiced: invoices.length === 0,
  };
}
