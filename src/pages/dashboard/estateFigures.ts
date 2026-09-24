/**
 * The platform dashboard's figures, computed from the organisations list
 * (GET /api/tenants) and nothing else.
 *
 * Every number the dashboard showed was either a literal fallback (`|| 84`) or
 * written into the markup ("+4 this quarter", "+18.7% YoY", "63% paid plans",
 * a growth chart drawn from fixed points) (QA-024). A figure that cannot be
 * computed from records is not shown: the page shows a dash instead.
 *
 * Pure, so it can be checked without a browser.
 */

export interface EstateTenant {
  plan?: string | null;
  planPrice?: number | string | null;
  createdAt?: string | null;
  suspendedAt?: string | null;
  counts?: { users?: number; tickets?: number } | null;
}

export interface EstateFigures {
  organisations: number;
  /** Organisations with an active subscription. */
  withActivePlan: number;
  /** withActivePlan as a whole-number percentage of organisations; null with none. */
  activeShare: number | null;
  newLast90Days: number;
  /** Active plans' monthly list prices × 12; null when no organisation has a plan. */
  annualListRevenue: number | null;
  /** Organisations per active plan, largest first. */
  byPlan: { name: string; count: number }[];
  /** Organisations on the platform at the end of each of the last six months, oldest first. */
  growth: { label: string; total: number }[];
  users: number;
  tickets: number;
}

const DAY = 86_400_000;

export function estateFigures(tenants: EstateTenant[], now: Date = new Date()): EstateFigures {
  const organisations = tenants.length;
  const planned = tenants.filter((t) => t.plan);
  const created = (t: EstateTenant) => (t.createdAt ? new Date(t.createdAt).getTime() : NaN);

  const byPlanMap = new Map<string, number>();
  for (const t of planned) byPlanMap.set(String(t.plan), (byPlanMap.get(String(t.plan)) || 0) + 1);

  const growth: EstateFigures['growth'] = [];
  for (let back = 5; back >= 0; back -= 1) {
    // The last instant of the month `back` months ago.
    const end = new Date(now.getFullYear(), now.getMonth() - back + 1, 1).getTime() - 1;
    const label = new Date(now.getFullYear(), now.getMonth() - back, 1)
      .toLocaleDateString(undefined, { month: 'short' });
    growth.push({ label, total: tenants.filter((t) => created(t) <= end).length });
  }

  const monthly = planned.reduce((sum, t) => sum + (Number(t.planPrice) || 0), 0);

  return {
    organisations,
    withActivePlan: planned.length,
    activeShare: organisations ? Math.round((planned.length / organisations) * 100) : null,
    newLast90Days: tenants.filter((t) => created(t) >= now.getTime() - 90 * DAY).length,
    annualListRevenue: planned.length ? monthly * 12 : null,
    byPlan: [...byPlanMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    growth,
    users: tenants.reduce((sum, t) => sum + (t.counts?.users || 0), 0),
    tickets: tenants.reduce((sum, t) => sum + (t.counts?.tickets || 0), 0),
  };
}
